package codocs

// Department document collaboration (Runtime batch R1). See
// docs/Codocs-Host-Department-Collaboration-Design.md.
//
// Personal sessions authorize the session opener and are re-checked only when a
// share changes (which advances the epoch in the same transaction). A
// department session instead depends on the Directory relation R, which changes
// without any Codocs transaction. So every step that lets a participant keep
// writing (ticket issue, ticket redemption, lease renewal, publication)
// re-verifies each participant against a freshly locked Directory read.
//
// Directory and Codocs are different schemas/databases. The lock order is
// always: Directory shared locks (held by the caller-supplied
// DepartmentRoleLocker, on Directory's own connection) -> Codocs document row ->
// snapshot head -> session/ticket/participants -> candidate. Codocs
// transactions never query directory_* tables.

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	// DepartmentCollaborationSessionTTL is the shorter department lease: Collab
	// renews every <=30s and each renewal re-verifies the participants, so a
	// Collab that goes silent leaves at most this window open.
	DepartmentCollaborationSessionTTL = 90 * time.Second
	// DepartmentCollaborationWriterLimit is the concurrent writer cap per document.
	DepartmentCollaborationWriterLimit = 20
	// departmentCollaborationOpenLimit is the per (user, document) opens per minute.
	departmentCollaborationOpenLimit = 6
	departmentRecheckAttempts        = 3

	collaborationPolicyPrivate    = "private"
	collaborationPolicyDepartment = "department"
)

// DepartmentCollabRole is the Directory relation reduced to what the document
// rules need. It is produced only by a locked Directory read.
type DepartmentCollabRole struct{ CanWrite, CanManage bool }

// DepartmentRoleLocker takes shared Directory locks for the given users in one
// department and returns their relation. release ends the locks; the adapter
// calls it after its Codocs transaction has ended. An unavailable Directory
// must return an error (mapped to 503), never a guessed role.
type DepartmentRoleLocker func(ctx context.Context, dept string, uids []string) (roles map[string]DepartmentCollabRole, release func(), err error)

// ParticipantsRevokedError rejects a publication because connected participants
// no longer hold write access. Collab disconnects exactly these users.
type ParticipantsRevokedError struct {
	Base httperror.Error
	UIDs []string
}

func (e ParticipantsRevokedError) Error() string { return e.Base.Error() }
func (e ParticipantsRevokedError) Unwrap() error { return e.Base }

// ErrorDetails is rendered into the error body's details by the server.
func (e ParticipantsRevokedError) ErrorDetails() map[string]any {
	return map[string]any{"revokedUids": e.UIDs}
}

func errCollaborationSessionInvalid() error {
	return httperror.New(http.StatusConflict, "collaboration_session_invalid", "Collaboration session is no longer valid")
}

func errParticipantsChanged() error {
	return httperror.New(http.StatusConflict, "collaboration_participants_changed", "Collaboration participants changed; retry")
}

func isParticipantsChanged(err error) bool {
	var he httperror.Error
	return errors.As(err, &he) && he.Code == "collaboration_participants_changed"
}

func isMissingColumn(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1054
}

func departmentDeptValid(dept string) bool {
	return dept != "" && len(dept) <= 100 && strings.TrimSpace(dept) == dept
}

// --- document facts ---------------------------------------------------------

type departmentDocument struct {
	ID    int64
	Owner string
}

// lockDepartmentDocument locks the document row and checks it is a writable
// document of exactly this department. A document of another department is
// reported as out of scope without revealing whether it exists elsewhere.
func lockDepartmentDocument(ctx context.Context, tx *sql.Tx, dept, documentUUID string, exclusive bool) (departmentDocument, error) {
	statement := `SELECT id, owner_uid, doc_type, COALESCE(dept_code,''), COALESCE(project_code,''), readonly_flag, status, COALESCE(oss_path,'') FROM documents WHERE uuid = ? FOR SHARE`
	if exclusive {
		statement = `SELECT id, owner_uid, doc_type, COALESCE(dept_code,''), COALESCE(project_code,''), readonly_flag, status, COALESCE(oss_path,'') FROM documents WHERE uuid = ? FOR UPDATE`
	}
	var doc departmentDocument
	var kind, deptCode, project, ossPath string
	var readonly, status int
	err := tx.QueryRowContext(ctx, statement, documentUUID).Scan(&doc.ID, &doc.Owner, &kind, &deptCode, &project, &readonly, &status, &ossPath)
	if errors.Is(err, sql.ErrNoRows) {
		return doc, snapshotError(http.StatusNotFound, "document_not_found")
	}
	if err != nil {
		return doc, err
	}
	if kind != "department" || deptCode != dept || project != "" {
		return doc, httperror.New(http.StatusForbidden, "department_document_scope_denied", "Document is outside department scope")
	}
	if status == 0 {
		return doc, snapshotError(http.StatusNotFound, "document_not_found")
	}
	// Conversion whitelist (inventory Q4): weekly reports keep their own
	// revise/archive flow on the derived path and never become collaborative.
	if strings.Contains(ossPath, "/weekly-reports/") {
		return doc, snapshotError(http.StatusForbidden, "department_document_not_collaborative")
	}
	if status != 1 || readonly != 0 {
		return doc, snapshotError(http.StatusForbidden, "snapshot_document_not_writable")
	}
	return doc, nil
}

// allows applies the department-body collaboration rule: current Directory
// members and managers edit by default. Owner/share grants never substitute
// for current membership; leader, parent and outsiders remain read-only.
func (d departmentDocument) allows(_ context.Context, _ *sql.Tx, role DepartmentCollabRole, _ string) (bool, error) {
	return role.CanWrite, nil
}

// --- participants -----------------------------------------------------------

type participantRow struct{ UID, Status string }

type rowsQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readParticipants(ctx context.Context, q rowsQuerier, tenant, deployment, session string, forUpdate bool) ([]participantRow, error) {
	statement := `SELECT user_uid, status FROM document_collaboration_participants WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? ORDER BY user_uid`
	if forUpdate {
		statement += " FOR UPDATE"
	}
	rows, err := q.QueryContext(ctx, statement, tenant, deployment, session)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []participantRow
	for rows.Next() {
		var row participantRow
		if err = rows.Scan(&row.UID, &row.Status); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func activeParticipantUIDs(rows []participantRow) []string {
	var uids []string
	for _, row := range rows {
		if row.Status == "active" {
			uids = append(uids, row.UID)
		}
	}
	return uids
}

// --- session info -----------------------------------------------------------

// CollaborationSessionInfo is an active session with its authorization policy.
type CollaborationSessionInfo struct {
	Identity     PersonalFolderCreationIdentity
	DocumentUUID string
	Epoch        int64
	ExpiresAt    time.Time
	Policy       string
	DeptCode     string
}

// ResolveCollaborationSessionInfo is ResolveCollaborationSession plus the
// session policy. A database without the department columns only has private
// sessions, so a missing column reads as private.
func (a *Adapter) ResolveCollaborationSessionInfo(ctx context.Context, cid CollaborationIdentity) (CollaborationSessionInfo, error) {
	if !snapshotReadIdentityValid(cid.Tenant) || !snapshotReadIdentityValid(cid.Deployment) || !snapshotUUID.MatchString(cid.SessionID) {
		return CollaborationSessionInfo{}, snapshotError(http.StatusForbidden, "collaboration_identity_invalid")
	}
	info := CollaborationSessionInfo{Policy: collaborationPolicyPrivate}
	var openedBy string
	err := a.db.QueryRowContext(ctx, `SELECT document_uuid, opened_by, epoch, expires_at, policy, COALESCE(dept_code,'') FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()`,
		cid.Tenant, cid.Deployment, cid.SessionID).Scan(&info.DocumentUUID, &openedBy, &info.Epoch, &info.ExpiresAt, &info.Policy, &info.DeptCode)
	if isMissingColumn(err) {
		info.Policy, info.DeptCode = collaborationPolicyPrivate, ""
		err = a.db.QueryRowContext(ctx, `SELECT document_uuid, opened_by, epoch, expires_at FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()`,
			cid.Tenant, cid.Deployment, cid.SessionID).Scan(&info.DocumentUUID, &openedBy, &info.Epoch, &info.ExpiresAt)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return CollaborationSessionInfo{}, errCollaborationSessionInvalid()
	}
	if err != nil {
		return CollaborationSessionInfo{}, err
	}
	key := ""
	if cid.Key != "" {
		key = "collab:" + cid.SessionID + ":" + cid.Key
	}
	info.Identity = PersonalFolderCreationIdentity{Tenant: cid.Tenant, Deployment: cid.Deployment, Actor: openedBy, Client: "collab.runtime", RequestID: cid.RequestID, Key: key, Session: cid.SessionID}
	return info, nil
}

// --- open -------------------------------------------------------------------

// OpenDepartmentCollaborationSession opens (or renews) the department session
// of a v2 document for a verified writer and issues that writer's ticket. role
// must come from a Directory read whose shared locks the caller holds until
// this returns. Only writers get a session: leader and parent relations, and
// members without owner/write-share, are refused.
func (a *Adapter) OpenDepartmentCollaborationSession(ctx context.Context, id PersonalFolderCreationIdentity, dept, documentUUID string, role DepartmentCollabRole) (CollaborationSession, error) {
	if id.Client != "enterprise.runtime" || !snapshotReadIdentityValid(id.Tenant) || !snapshotReadIdentityValid(id.Deployment) || !snapshotReadIdentityValid(id.Actor) || !snapshotUUID.MatchString(documentUUID) || !departmentDeptValid(dept) {
		return CollaborationSession{}, snapshotError(http.StatusForbidden, "collaboration_identity_invalid")
	}
	if !role.CanWrite {
		return CollaborationSession{}, httperror.New(http.StatusForbidden, "department_writer_required", "Department writer required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return CollaborationSession{}, err
	}
	defer tx.Rollback()
	doc, err := lockDepartmentDocument(ctx, tx, dept, documentUUID, true)
	if err != nil {
		return CollaborationSession{}, err
	}
	allowed, err := doc.allows(ctx, tx, role, id.Actor)
	if err != nil {
		return CollaborationSession{}, err
	}
	if !allowed {
		return CollaborationSession{}, httperror.New(http.StatusForbidden, "department_document_write_denied", "Document write access required")
	}
	generation, epoch, err := lockSnapshotHead(ctx, tx, id, documentUUID, false)
	var he httperror.Error
	if (errors.As(err, &he) && he.Code == "snapshot_not_prepared") || (err == nil && generation < 1) {
		return CollaborationSession{}, httperror.New(http.StatusConflict, "document_not_on_snapshot_v2", "Document is not saved with the v2 snapshot protocol")
	}
	if err != nil {
		return CollaborationSession{}, err
	}
	var opens int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_collaboration_tickets t JOIN document_collaboration_sessions s ON s.tenant_code = t.tenant_code AND s.deployment_code = t.deployment_code AND s.session_id = t.session_id WHERE t.tenant_code = ? AND t.deployment_code = ? AND s.document_uuid = ? AND t.user_uid = ? AND t.created_at > CURRENT_TIMESTAMP - INTERVAL 60 SECOND`,
		id.Tenant, id.Deployment, documentUUID, id.Actor).Scan(&opens); err != nil {
		return CollaborationSession{}, err
	}
	if opens >= departmentCollaborationOpenLimit {
		return CollaborationSession{}, httperror.New(http.StatusTooManyRequests, "collaboration_open_rate_limited", "Too many collaboration opens; retry shortly")
	}
	var session CollaborationSession
	var policy, sessionDept string
	err = tx.QueryRowContext(ctx, `SELECT session_id, epoch, policy, COALESCE(dept_code,'') FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() AND epoch = ? ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`,
		id.Tenant, id.Deployment, documentUUID, epoch).Scan(&session.SessionID, &session.Epoch, &policy, &sessionDept)
	found := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CollaborationSession{}, err
	}
	if found && (policy != collaborationPolicyDepartment || sessionDept != dept) {
		// A session under another policy cannot govern this document any more.
		if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_sessions SET status = 'revoked' WHERE tenant_code = ? AND deployment_code = ? AND session_id = ?`, id.Tenant, id.Deployment, session.SessionID); err != nil {
			return CollaborationSession{}, err
		}
		found = false
	}
	expires := time.Now().UTC().Add(DepartmentCollaborationSessionTTL).Truncate(time.Second)
	if found {
		if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_sessions SET expires_at = ? WHERE tenant_code = ? AND deployment_code = ? AND session_id = ?`, expires, id.Tenant, id.Deployment, session.SessionID); err != nil {
			return CollaborationSession{}, err
		}
		session.Reused = true
	} else {
		session = CollaborationSession{SessionID: uuid.NewString(), Epoch: epoch}
		if _, err = tx.ExecContext(ctx, `INSERT INTO document_collaboration_sessions (tenant_code, deployment_code, session_id, document_uuid, epoch, opened_by, policy, dept_code, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'department', ?, ?)`,
			id.Tenant, id.Deployment, session.SessionID, documentUUID, epoch, id.Actor, dept, expires); err != nil {
			return CollaborationSession{}, err
		}
	}
	// Writer cap: distinct other users already admitted or holding a live ticket.
	var others int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM (
		SELECT user_uid FROM document_collaboration_participants WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active' AND user_uid <> ?
		UNION
		SELECT user_uid FROM document_collaboration_tickets WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND redeemed_at IS NULL AND expires_at > UTC_TIMESTAMP() AND user_uid <> ?
	) writers`, id.Tenant, id.Deployment, session.SessionID, id.Actor, id.Tenant, id.Deployment, session.SessionID, id.Actor).Scan(&others); err != nil {
		return CollaborationSession{}, err
	}
	if others >= DepartmentCollaborationWriterLimit {
		return CollaborationSession{}, httperror.New(http.StatusConflict, "collaboration_writer_limit_reached", "The document already has the maximum number of concurrent writers")
	}
	// A new ticket voids this user's earlier unredeemed ones for the session.
	if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_tickets SET expires_at = UTC_TIMESTAMP() WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND user_uid = ? AND redeemed_at IS NULL AND expires_at > UTC_TIMESTAMP()`,
		id.Tenant, id.Deployment, session.SessionID, id.Actor); err != nil {
		return CollaborationSession{}, err
	}
	session.Generation, session.ExpiresAt = generation, expires
	if session.Ticket, err = issueCollaborationTicket(ctx, tx, id, session.SessionID, "write"); err != nil {
		return CollaborationSession{}, err
	}
	return session, tx.Commit()
}

// --- admit ------------------------------------------------------------------

// CollaborationTicketPeek is the unauthenticated-side view of a ticket: which
// policy, department and user it is for. The server needs it to take the
// Directory lock before the Codocs redemption transaction. It grants nothing.
type CollaborationTicketPeek struct{ Policy, DeptCode, UserUID, DocumentUUID string }

// PeekCollaborationTicket returns ok=false for anything that is not a
// well-formed, known ticket; the normal admit path then produces the standard
// refusal.
func (a *Adapter) PeekCollaborationTicket(ctx context.Context, tenant, deployment, ticket string) (CollaborationTicketPeek, bool, error) {
	if !snapshotReadIdentityValid(tenant) || !snapshotReadIdentityValid(deployment) || len(ticket) != 64 {
		return CollaborationTicketPeek{}, false, nil
	}
	if _, err := hex.DecodeString(ticket); err != nil {
		return CollaborationTicketPeek{}, false, nil
	}
	var peek CollaborationTicketPeek
	err := a.db.QueryRowContext(ctx, `SELECT s.policy, COALESCE(s.dept_code,''), t.user_uid, s.document_uuid FROM document_collaboration_tickets t JOIN document_collaboration_sessions s ON s.tenant_code = t.tenant_code AND s.deployment_code = t.deployment_code AND s.session_id = t.session_id WHERE t.tenant_code = ? AND t.deployment_code = ? AND t.ticket_sha256 = ?`,
		tenant, deployment, ticketHash(ticket)).Scan(&peek.Policy, &peek.DeptCode, &peek.UserUID, &peek.DocumentUUID)
	if isMissingColumn(err) || errors.Is(err, sql.ErrNoRows) {
		return CollaborationTicketPeek{}, false, nil
	}
	if err != nil {
		return CollaborationTicketPeek{}, false, err
	}
	return peek, true, nil
}

// AdmitDepartmentCollaborationTicket redeems a department ticket. role is the
// ticket user's relation from a Directory read whose locks the caller holds;
// the transaction refuses it unless the ticket, session and document still
// match what that lock was taken for.
func (a *Adapter) AdmitDepartmentCollaborationTicket(ctx context.Context, tenant, deployment, ticket string, peek CollaborationTicketPeek, role DepartmentCollabRole) (CollaborationAdmission, error) {
	invalid := httperror.New(http.StatusForbidden, "collaboration_ticket_invalid", "Collaboration admission ticket is invalid")
	if peek.Policy != collaborationPolicyDepartment || !departmentDeptValid(peek.DeptCode) || !snapshotUUID.MatchString(peek.DocumentUUID) {
		return CollaborationAdmission{}, invalid
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return CollaborationAdmission{}, err
	}
	defer tx.Rollback()
	doc, err := lockDepartmentDocument(ctx, tx, peek.DeptCode, peek.DocumentUUID, false)
	if err != nil {
		return CollaborationAdmission{}, errCollaborationSessionInvalid()
	}
	var admission CollaborationAdmission
	var redeemed sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT session_id, user_uid, access, redeemed_at FROM document_collaboration_tickets WHERE tenant_code = ? AND deployment_code = ? AND ticket_sha256 = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
		tenant, deployment, ticketHash(ticket)).Scan(&admission.SessionID, &admission.UserUID, &admission.Access, &redeemed)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (redeemed.Valid || admission.UserUID != peek.UserUID || admission.Access != "write")) {
		return CollaborationAdmission{}, invalid
	}
	if err != nil {
		return CollaborationAdmission{}, err
	}
	var epoch int64
	var policy, sessionDept string
	err = tx.QueryRowContext(ctx, `SELECT document_uuid, epoch, expires_at, policy, COALESCE(dept_code,'') FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
		tenant, deployment, admission.SessionID).Scan(&admission.DocumentUUID, &epoch, &admission.ExpiresAt, &policy, &sessionDept)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (policy != collaborationPolicyDepartment || sessionDept != peek.DeptCode || admission.DocumentUUID != peek.DocumentUUID)) {
		return CollaborationAdmission{}, errCollaborationSessionInvalid()
	}
	if err != nil {
		return CollaborationAdmission{}, err
	}
	var headEpoch int64
	if err = tx.QueryRowContext(ctx, `SELECT generation, collaboration_epoch FROM document_snapshot_heads WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? FOR SHARE`,
		tenant, deployment, admission.DocumentUUID).Scan(&admission.Generation, &headEpoch); err != nil || headEpoch != epoch {
		return CollaborationAdmission{}, errCollaborationSessionInvalid()
	}
	allowed, err := doc.allows(ctx, tx, role, admission.UserUID)
	if err != nil {
		return CollaborationAdmission{}, err
	}
	if !allowed {
		return CollaborationAdmission{}, invalid
	}
	admission.Epoch = epoch
	admission.Policy, admission.DeptCode = collaborationPolicyDepartment, peek.DeptCode
	if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_tickets SET redeemed_at = UTC_TIMESTAMP() WHERE tenant_code = ? AND deployment_code = ? AND ticket_sha256 = ?`, tenant, deployment, ticketHash(ticket)); err != nil {
		return CollaborationAdmission{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO document_collaboration_participants (tenant_code, deployment_code, session_id, user_uid, access, status, checked_at) VALUES (?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE last_admitted_at = UTC_TIMESTAMP(), access = VALUES(access), status = 'active', checked_at = UTC_TIMESTAMP()`,
		tenant, deployment, admission.SessionID, admission.UserUID, admission.Access); err != nil {
		return CollaborationAdmission{}, err
	}
	return admission, tx.Commit()
}

// --- renew ------------------------------------------------------------------

// RenewDepartmentCollaborationSession extends a department session lease and
// re-verifies every participant. connected is Collab's list of users with a
// live connection (reported=false when Collab did not send one). Users who
// fail the check are marked revoked and returned; active participants missing
// from a reported list are marked left. A document-level failure, or every
// participant failing, ends the session (409 collaboration_session_invalid).
func (a *Adapter) RenewDepartmentCollaborationSession(ctx context.Context, cid CollaborationIdentity, connected []string, reported bool, lock DepartmentRoleLocker) (time.Time, []string, error) {
	if lock == nil {
		return time.Time{}, nil, httperror.New(http.StatusServiceUnavailable, "department_directory_unavailable", "Directory unavailable")
	}
	connectedSet := map[string]bool{}
	for _, uid := range connected {
		connectedSet[uid] = true
	}
	for attempt := 0; attempt < departmentRecheckAttempts; attempt++ {
		expires, revoked, err := a.renewDepartmentOnce(ctx, cid, connectedSet, reported, lock)
		if isParticipantsChanged(err) && attempt+1 < departmentRecheckAttempts {
			continue
		}
		return expires, revoked, err
	}
	return time.Time{}, nil, errParticipantsChanged()
}

func (a *Adapter) renewDepartmentOnce(ctx context.Context, cid CollaborationIdentity, connected map[string]bool, reported bool, lock DepartmentRoleLocker) (time.Time, []string, error) {
	info, err := a.ResolveCollaborationSessionInfo(ctx, cid)
	if err != nil {
		return time.Time{}, nil, err
	}
	if info.Policy != collaborationPolicyDepartment {
		return time.Time{}, nil, errCollaborationSessionInvalid()
	}
	pre, err := readParticipants(ctx, a.db, cid.Tenant, cid.Deployment, cid.SessionID, false)
	if err != nil {
		return time.Time{}, nil, err
	}
	want := map[string]bool{}
	for _, uid := range activeParticipantUIDs(pre) {
		want[uid] = true
	}
	for uid := range connected {
		want[uid] = true
	}
	uids := make([]string, 0, len(want))
	for uid := range want {
		uids = append(uids, uid)
	}
	sort.Strings(uids)
	roles := map[string]DepartmentCollabRole{}
	if len(uids) > 0 {
		var release func()
		roles, release, err = lock(ctx, info.DeptCode, uids)
		if err != nil {
			return time.Time{}, nil, err
		}
		defer release()
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return time.Time{}, nil, err
	}
	defer tx.Rollback()
	doc, err := lockDepartmentDocument(ctx, tx, info.DeptCode, info.DocumentUUID, true)
	if err != nil {
		return time.Time{}, nil, errCollaborationSessionInvalid()
	}
	var headEpoch int64
	if err = tx.QueryRowContext(ctx, `SELECT collaboration_epoch FROM document_snapshot_heads WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? FOR UPDATE`, cid.Tenant, cid.Deployment, info.DocumentUUID).Scan(&headEpoch); err != nil || headEpoch != info.Epoch {
		return time.Time{}, nil, errCollaborationSessionInvalid()
	}
	var policy, sessionDept string
	if err = tx.QueryRowContext(ctx, `SELECT policy, COALESCE(dept_code,'') FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() FOR UPDATE`, cid.Tenant, cid.Deployment, cid.SessionID).Scan(&policy, &sessionDept); err != nil || policy != collaborationPolicyDepartment || sessionDept != info.DeptCode {
		return time.Time{}, nil, errCollaborationSessionInvalid()
	}
	rows, err := readParticipants(ctx, tx, cid.Tenant, cid.Deployment, cid.SessionID, true)
	if err != nil {
		return time.Time{}, nil, err
	}
	known := map[string]bool{}
	for _, row := range rows {
		known[row.UID] = true
		if (row.Status == "active" || connected[row.UID]) && !want[row.UID] {
			return time.Time{}, nil, errParticipantsChanged()
		}
	}
	var revoked []string
	remaining := 0
	newStatus := map[string]string{}
	for _, row := range rows {
		status := row.Status
		if row.Status == "active" || connected[row.UID] {
			role, ok := roles[row.UID]
			if !ok {
				return time.Time{}, nil, errParticipantsChanged()
			}
			allowed, allowErr := doc.allows(ctx, tx, role, row.UID)
			if allowErr != nil {
				return time.Time{}, nil, allowErr
			}
			switch {
			case !allowed:
				status = "revoked"
				revoked = append(revoked, row.UID)
			case reported && !connected[row.UID]:
				status = "left"
			default:
				status = "active"
			}
		}
		if status != row.Status {
			newStatus[row.UID] = status
		}
		if status == "active" {
			remaining++
		}
	}
	for uid := range connected {
		if !known[uid] {
			revoked = append(revoked, uid) // connected without ever being admitted
		}
	}
	sort.Strings(revoked)
	for uid, status := range newStatus {
		if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_participants SET status = ?, checked_at = UTC_TIMESTAMP() WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND user_uid = ?`, status, cid.Tenant, cid.Deployment, cid.SessionID, uid); err != nil {
			return time.Time{}, nil, err
		}
	}
	if len(revoked) > 0 && remaining == 0 {
		// Nobody may write any more: end the session so Collab closes the room.
		if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_sessions SET status = 'revoked' WHERE tenant_code = ? AND deployment_code = ? AND session_id = ?`, cid.Tenant, cid.Deployment, cid.SessionID); err != nil {
			return time.Time{}, nil, err
		}
		if err = tx.Commit(); err != nil {
			return time.Time{}, nil, err
		}
		return time.Time{}, revoked, errCollaborationSessionInvalid()
	}
	expires := time.Now().UTC().Add(DepartmentCollaborationSessionTTL).Truncate(time.Second)
	if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_sessions SET expires_at = ? WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active'`, expires, cid.Tenant, cid.Deployment, cid.SessionID); err != nil {
		return time.Time{}, nil, err
	}
	return expires, revoked, tx.Commit()
}

// --- snapshot policy --------------------------------------------------------

// departmentSnapshotPolicy authorizes snapshot prepare/publish of department
// documents in two modes:
//
//   - host: the Enterprise Host converts a v1 document (expected generation 0)
//     on behalf of a locked Directory writer. It never writes later generations;
//     body changes after conversion flow only through Collab.
//   - collab: Collab writes under an active department session. The document
//     must still be a writable document of the session department. When
//     recheck is set (publish), every active participant is re-verified against
//     a fresh Directory lock; any failure rejects the publication.
type departmentSnapshotPolicy struct {
	dept    string
	host    bool
	actor   DepartmentCollabRole
	recheck bool
	locker  DepartmentRoleLocker

	roles map[string]DepartmentCollabRole
	doc   departmentDocument
}

func (p *departmentSnapshotPolicy) begin(ctx context.Context, a *Adapter, id PersonalFolderCreationIdentity, _ string) (func(), error) {
	noop := func() {}
	if !p.recheck {
		return noop, nil
	}
	if p.locker == nil {
		return noop, httperror.New(http.StatusServiceUnavailable, "department_directory_unavailable", "Directory unavailable")
	}
	rows, err := readParticipants(ctx, a.db, id.Tenant, id.Deployment, id.Session, false)
	if err != nil {
		return noop, err
	}
	uids := activeParticipantUIDs(rows)
	if len(uids) == 0 {
		p.roles = map[string]DepartmentCollabRole{}
		return noop, nil
	}
	roles, release, err := p.locker(ctx, p.dept, uids)
	if err != nil {
		return noop, err
	}
	p.roles = roles
	return release, nil
}

func (p *departmentSnapshotPolicy) lockDocument(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, documentUUID string) (int64, error) {
	doc, err := lockDepartmentDocument(ctx, tx, p.dept, documentUUID, true)
	if err != nil {
		return 0, err
	}
	p.doc = doc
	if p.host {
		allowed, allowErr := doc.allows(ctx, tx, p.actor, id.Actor)
		if allowErr != nil {
			return 0, allowErr
		}
		if !allowed {
			return 0, httperror.New(http.StatusForbidden, "department_document_write_denied", "Document write access required")
		}
	}
	return doc.ID, nil
}

func (p *departmentSnapshotPolicy) checkWrite(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, cmd SnapshotCommand, epoch int64) error {
	if p.host {
		if cmd.YjsSHA256 != "" {
			return httperror.New(http.StatusBadRequest, "department_snapshot_conversion_invalid", "Department conversion publishes Markdown only")
		}
		if cmd.Generation != 0 {
			return httperror.New(http.StatusConflict, "department_snapshot_conversion_only", "Department body changes are saved by the collaboration session")
		}
		return refuseActiveCollaboration(ctx, tx, id, cmd.UUID, epoch)
	}
	if err := checkCollaborationForWrite(ctx, tx, id, cmd, epoch); err != nil {
		return err
	}
	if !p.recheck {
		return nil
	}
	rows, err := readParticipants(ctx, tx, id.Tenant, id.Deployment, id.Session, true)
	if err != nil {
		return err
	}
	active := activeParticipantUIDs(rows)
	if len(active) == 0 {
		return errCollaborationSessionInvalid()
	}
	var revoked []string
	for _, uid := range active {
		role, ok := p.roles[uid]
		if !ok {
			return errParticipantsChanged()
		}
		allowed, allowErr := p.doc.allows(ctx, tx, role, uid)
		if allowErr != nil {
			return allowErr
		}
		if !allowed {
			revoked = append(revoked, uid)
		}
	}
	if len(revoked) > 0 {
		return ParticipantsRevokedError{Base: httperror.New(http.StatusConflict, "collaboration_participant_revoked", "A connected participant no longer has write access"), UIDs: revoked}
	}
	return nil
}

func (p *departmentSnapshotPolicy) recordPublication(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, candidateKey string) error {
	if p.host {
		return nil
	}
	// Users who left keep their authorship; revoked users are not recorded.
	return recordParticipantsPublication(ctx, tx, id, candidateKey, `SELECT user_uid FROM document_collaboration_participants WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status IN ('active', 'left') ORDER BY user_uid`)
}

// markParticipantsRevoked persists the outcome of a rejected publication (the
// rejecting transaction rolled back) so the next renew and publish do not
// re-discover the same users. The next successful check restores a user who
// regained access.
func (a *Adapter) markParticipantsRevoked(ctx context.Context, id PersonalFolderCreationIdentity, uids []string) {
	for _, uid := range uids {
		_, _ = a.db.ExecContext(ctx, `UPDATE document_collaboration_participants SET status = 'revoked', checked_at = UTC_TIMESTAMP() WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND user_uid = ? AND status = 'active'`, id.Tenant, id.Deployment, id.Session, uid)
	}
}

// --- host conversion --------------------------------------------------------

// PrepareDepartmentConversionSnapshot is the v1 -> v2 conversion prepare for
// a Directory-locked writer (generation 0 only, Markdown only).
func (a *Adapter) PrepareDepartmentConversionSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, dept string, role DepartmentCollabRole, cmd SnapshotCommand) (SnapshotPlan, error) {
	if !departmentDeptValid(dept) || !role.CanWrite || id.Client != "enterprise.runtime" {
		return SnapshotPlan{}, httperror.New(http.StatusForbidden, "department_writer_required", "Department writer required")
	}
	return a.prepareDocumentSnapshot(ctx, id, cmd, &departmentSnapshotPolicy{dept: dept, host: true, actor: role})
}

// PublishDepartmentConversionSnapshot publishes the converted generation 1.
func (a *Adapter) PublishDepartmentConversionSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, dept string, role DepartmentCollabRole, cmd SnapshotCommand, objects SnapshotObjects, verify SnapshotVerifier) (SnapshotPlan, error) {
	if !departmentDeptValid(dept) || !role.CanWrite || id.Client != "enterprise.runtime" {
		return SnapshotPlan{}, httperror.New(http.StatusForbidden, "department_writer_required", "Department writer required")
	}
	return a.publishDocumentSnapshot(ctx, id, cmd, objects, verify, &departmentSnapshotPolicy{dept: dept, host: true, actor: role})
}

// --- collab prepare / publish ----------------------------------------------

// PrepareDepartmentCollaborationSnapshot prepares a Collab candidate for a
// department session (document checks only; participants are re-verified at
// publication).
func (a *Adapter) PrepareDepartmentCollaborationSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, dept string, cmd SnapshotCommand) (SnapshotPlan, error) {
	return a.prepareDocumentSnapshot(ctx, id, cmd, &departmentSnapshotPolicy{dept: dept})
}

// PublishDepartmentCollaborationSnapshot publishes a Collab snapshot after
// re-verifying every active participant. A rejected participant set is
// persisted and returned as ParticipantsRevokedError.
func (a *Adapter) PublishDepartmentCollaborationSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, dept string, cmd SnapshotCommand, objects SnapshotObjects, verify SnapshotVerifier, lock DepartmentRoleLocker) (SnapshotPlan, error) {
	for attempt := 0; attempt < departmentRecheckAttempts; attempt++ {
		plan, err := a.publishDocumentSnapshot(ctx, id, cmd, objects, verify, &departmentSnapshotPolicy{dept: dept, recheck: true, locker: lock})
		var revoked ParticipantsRevokedError
		if errors.As(err, &revoked) {
			a.markParticipantsRevoked(ctx, id, revoked.UIDs)
			return plan, err
		}
		if isParticipantsChanged(err) && attempt+1 < departmentRecheckAttempts {
			continue
		}
		return plan, err
	}
	return SnapshotPlan{}, errParticipantsChanged()
}

// RequireDepartmentSessionDocument confirms a department session's document is
// still a writable document of its department, for the non-writing Collab
// calls (read/download/upload).
func (a *Adapter) RequireDepartmentSessionDocument(ctx context.Context, dept, documentUUID string) error {
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = lockDepartmentDocument(ctx, tx, dept, documentUUID, false); err != nil {
		return errCollaborationSessionInvalid()
	}
	return tx.Commit()
}

// --- department snapshot read ----------------------------------------------

// ReadDepartmentDocumentSnapshot resolves the committed head of a department
// document for the Host (any department reader; the caller checked the
// Directory relation). It never creates a head: reading does not convert.
func (a *Adapter) ReadDepartmentDocumentSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, dept, documentUUID string) (SnapshotRead, error) {
	return a.readDepartmentSnapshot(ctx, id, dept, documentUUID, false)
}

// ReadDepartmentSessionSnapshot is the Collab read for a department session:
// the document must also still be writable.
func (a *Adapter) ReadDepartmentSessionSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, dept, documentUUID string) (SnapshotRead, error) {
	return a.readDepartmentSnapshot(ctx, id, dept, documentUUID, true)
}

func (a *Adapter) readDepartmentSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, dept, documentUUID string, writable bool) (SnapshotRead, error) {
	if !snapshotUUID.MatchString(documentUUID) || !snapshotClientAllowed(id) || !snapshotReadIdentityValid(id.Tenant) || !snapshotReadIdentityValid(id.Deployment) || !snapshotReadIdentityValid(id.Actor) || !departmentDeptValid(dept) {
		return SnapshotRead{}, snapshotError(http.StatusForbidden, "snapshot_identity_invalid")
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return SnapshotRead{}, err
	}
	defer tx.Rollback()
	var kind, deptCode, project, legacyPath string
	var readonly, status int
	err = tx.QueryRowContext(ctx, `SELECT doc_type, COALESCE(dept_code,''), COALESCE(project_code,''), COALESCE(oss_path,''), readonly_flag, status FROM documents WHERE uuid = ? FOR SHARE`, documentUUID).Scan(&kind, &deptCode, &project, &legacyPath, &readonly, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return SnapshotRead{}, snapshotError(http.StatusNotFound, "document_not_found")
	}
	if err != nil {
		return SnapshotRead{}, err
	}
	if kind != "department" || deptCode != dept || project != "" || status == 0 {
		return SnapshotRead{}, snapshotError(http.StatusNotFound, "document_not_found")
	}
	if writable && (status != 1 || readonly != 0) {
		return SnapshotRead{}, snapshotError(http.StatusForbidden, "snapshot_document_not_writable")
	}
	return readSnapshotHead(ctx, tx, id, documentUUID, legacyPath)
}
