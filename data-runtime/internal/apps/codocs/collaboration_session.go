package codocs

// Stage B collaboration sessions for v2 documents (see
// docs/Codocs-Document-Write-Coordination.md). Not registered until the stage B
// routes are enabled.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// CollaborationSessionTTL is the lease length; Collab renews while clients
// stay connected and the Host renews on every open.
const CollaborationSessionTTL = 5 * time.Minute

// CollaborationTicketTTL bounds how long a one-time admission ticket is valid.
const CollaborationTicketTTL = 60 * time.Second

type CollaborationSession struct {
	SessionID  string
	Epoch      int64
	Generation int64
	ExpiresAt  time.Time
	Reused     bool
	// Ticket is the one-time admission ticket for the opening user; only its
	// SHA-256 is stored. Returned once, never logged.
	Ticket string
}

// OpenCollaborationSession opens (or renews the active) session for a
// published v2 document on behalf of a verified writer. The document row lock
// is the same one v2 publication takes, so opening and Host saves serialize.
func (a *Adapter) OpenCollaborationSession(ctx context.Context, id PersonalFolderCreationIdentity, documentUUID string) (CollaborationSession, error) {
	if id.Client != "enterprise.runtime" || !snapshotReadIdentityValid(id.Tenant) || !snapshotReadIdentityValid(id.Deployment) || !snapshotReadIdentityValid(id.Actor) || !snapshotUUID.MatchString(documentUUID) {
		return CollaborationSession{}, snapshotError(http.StatusForbidden, "collaboration_identity_invalid")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return CollaborationSession{}, err
	}
	defer tx.Rollback()
	if _, err = lockSnapshotDocument(ctx, tx, id, documentUUID); err != nil {
		return CollaborationSession{}, err
	}
	generation, epoch, err := lockSnapshotHead(ctx, tx, id, documentUUID, false)
	var he httperror.Error
	if (errors.As(err, &he) && he.Code == "snapshot_not_prepared") || (err == nil && generation < 1) {
		// D5: stage B covers only documents already on v2.
		return CollaborationSession{}, httperror.New(http.StatusConflict, "document_not_on_snapshot_v2", "Document is not saved with the v2 snapshot protocol")
	}
	if err != nil {
		return CollaborationSession{}, err
	}
	var session CollaborationSession
	err = tx.QueryRowContext(ctx, `SELECT session_id, epoch FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() AND epoch = ? ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`,
		id.Tenant, id.Deployment, documentUUID, epoch).Scan(&session.SessionID, &session.Epoch)
	expires := time.Now().UTC().Add(CollaborationSessionTTL).Truncate(time.Second)
	switch {
	case err == nil:
		if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_sessions SET expires_at = ? WHERE tenant_code = ? AND deployment_code = ? AND session_id = ?`, expires, id.Tenant, id.Deployment, session.SessionID); err != nil {
			return CollaborationSession{}, err
		}
		session.Reused = true
	case errors.Is(err, sql.ErrNoRows):
		session = CollaborationSession{SessionID: uuid.NewString(), Epoch: epoch}
		if _, err = tx.ExecContext(ctx, `INSERT INTO document_collaboration_sessions (tenant_code, deployment_code, session_id, document_uuid, epoch, opened_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id.Tenant, id.Deployment, session.SessionID, documentUUID, epoch, id.Actor, expires); err != nil {
			return CollaborationSession{}, err
		}
	default:
		return CollaborationSession{}, err
	}
	session.Generation, session.ExpiresAt = generation, expires
	if session.Ticket, err = issueCollaborationTicket(ctx, tx, id, session.SessionID, "write"); err != nil {
		return CollaborationSession{}, err
	}
	return session, tx.Commit()
}

// refuseActiveCollaboration implements D3: while a document has an active
// session for its current epoch, a Host (non-collaboration) save is refused.
// Call under the document row lock.
func refuseActiveCollaboration(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, documentUUID string, epoch int64) error {
	var active int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() AND epoch = ?`,
		id.Tenant, id.Deployment, documentUUID, epoch).Scan(&active)
	if isMissingTable(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if active > 0 {
		return httperror.New(http.StatusConflict, "document_collaboration_active", "Document is being edited collaboratively")
	}
	return nil
}

// snapshotClientAllowed admits the Host, or Collab bound to a session.
func snapshotClientAllowed(id PersonalFolderCreationIdentity) bool {
	switch id.Client {
	case "enterprise.runtime":
		return id.Session == ""
	case "collab.runtime":
		return snapshotUUID.MatchString(id.Session)
	}
	return false
}

// checkCollaborationForWrite runs under the document and head locks. Host
// writes are refused while a session is active (D3); Collab writes need their
// own session to be active for the current epoch and a paired Yjs snapshot.
func checkCollaborationForWrite(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, cmd SnapshotCommand, epoch int64) error {
	if id.Client != "collab.runtime" {
		return refuseActiveCollaboration(ctx, tx, id, cmd.UUID, epoch)
	}
	if cmd.YjsSHA256 == "" {
		return snapshotError(http.StatusBadRequest, "collaboration_snapshot_pair_required")
	}
	return requireCollaborationSession(ctx, tx, id, cmd.UUID, epoch)
}

func requireCollaborationSession(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, documentUUID string, epoch int64) error {
	var active int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND document_uuid = ? AND opened_by = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() AND epoch = ?`,
		id.Tenant, id.Deployment, id.Session, documentUUID, id.Actor, epoch).Scan(&active)
	if err != nil {
		return err
	}
	if active != 1 {
		return httperror.New(http.StatusConflict, "collaboration_session_invalid", "Collaboration session is no longer valid")
	}
	return nil
}

// CollaborationIdentity is Collab's verified service call bound to a session.
type CollaborationIdentity struct {
	Tenant, Deployment, SessionID, RequestID, Key string
}

// ResolveCollaborationSession maps an active session to the identity Collab
// acts under: the verified writer who opened it. The opener's write access is
// re-checked by every later write under the document row lock.
func (a *Adapter) ResolveCollaborationSession(ctx context.Context, cid CollaborationIdentity) (PersonalFolderCreationIdentity, string, int64, time.Time, error) {
	if !snapshotReadIdentityValid(cid.Tenant) || !snapshotReadIdentityValid(cid.Deployment) || !snapshotUUID.MatchString(cid.SessionID) {
		return PersonalFolderCreationIdentity{}, "", 0, time.Time{}, snapshotError(http.StatusForbidden, "collaboration_identity_invalid")
	}
	var documentUUID, openedBy string
	var epoch int64
	var expiresAt time.Time
	err := a.db.QueryRowContext(ctx, `SELECT document_uuid, opened_by, epoch, expires_at FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()`,
		cid.Tenant, cid.Deployment, cid.SessionID).Scan(&documentUUID, &openedBy, &epoch, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return PersonalFolderCreationIdentity{}, "", 0, time.Time{}, httperror.New(http.StatusConflict, "collaboration_session_invalid", "Collaboration session is no longer valid")
	}
	if err != nil {
		return PersonalFolderCreationIdentity{}, "", 0, time.Time{}, err
	}
	key := ""
	if cid.Key != "" {
		// Own namespace so Collab retry keys never collide with Host keys.
		key = "collab:" + cid.SessionID + ":" + cid.Key
	}
	return PersonalFolderCreationIdentity{Tenant: cid.Tenant, Deployment: cid.Deployment, Actor: openedBy, Client: "collab.runtime", RequestID: cid.RequestID, Key: key, Session: cid.SessionID}, documentUUID, epoch, expiresAt, nil
}

// RenewCollaborationSession extends an active session whose epoch still
// matches the document head; CloseCollaborationSession ends it.
func (a *Adapter) RenewCollaborationSession(ctx context.Context, cid CollaborationIdentity) (time.Time, error) {
	id, documentUUID, epoch, _, err := a.ResolveCollaborationSession(ctx, cid)
	if err != nil {
		return time.Time{}, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback()
	if _, err = lockSnapshotDocument(ctx, tx, id, documentUUID); err != nil {
		return time.Time{}, err
	}
	_, headEpoch, err := lockSnapshotHead(ctx, tx, id, documentUUID, false)
	if err != nil {
		return time.Time{}, err
	}
	if headEpoch != epoch {
		return time.Time{}, httperror.New(http.StatusConflict, "collaboration_session_invalid", "Collaboration session is no longer valid")
	}
	expires := time.Now().UTC().Add(CollaborationSessionTTL).Truncate(time.Second)
	if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_sessions SET expires_at = ? WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active'`, expires, id.Tenant, id.Deployment, cid.SessionID); err != nil {
		return time.Time{}, err
	}
	return expires, tx.Commit()
}

func (a *Adapter) CloseCollaborationSession(ctx context.Context, cid CollaborationIdentity) error {
	if !snapshotReadIdentityValid(cid.Tenant) || !snapshotReadIdentityValid(cid.Deployment) || !snapshotUUID.MatchString(cid.SessionID) {
		return snapshotError(http.StatusForbidden, "collaboration_identity_invalid")
	}
	_, err := a.db.ExecContext(ctx, `UPDATE document_collaboration_sessions SET status = 'closed' WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active'`, cid.Tenant, cid.Deployment, cid.SessionID)
	return err
}

// InvalidateCollaboration advances the document epoch and revokes its active
// sessions, so late Collab publishes are refused. Used when access changes
// (share revocation) or the document leaves v2. Call under the document row lock.
func invalidateCollaboration(ctx context.Context, tx execer, documentUUID string) error {
	if _, err := tx.ExecContext(ctx, `UPDATE document_snapshot_heads SET collaboration_epoch = collaboration_epoch + 1 WHERE document_uuid = ?`, documentUUID); err != nil && !isMissingTable(err) {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE document_collaboration_sessions SET status = 'revoked' WHERE document_uuid = ? AND status = 'active'`, documentUUID); err != nil && !isMissingTable(err) {
		return err
	}
	return nil
}

func ticketHash(ticket string) string {
	sum := sha256.Sum256([]byte(ticket))
	return hex.EncodeToString(sum[:])
}

func issueCollaborationTicket(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, sessionID, access string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	ticket := hex.EncodeToString(raw)
	expires := time.Now().UTC().Add(CollaborationTicketTTL).Truncate(time.Second)
	if _, err := tx.ExecContext(ctx, `INSERT INTO document_collaboration_tickets (tenant_code, deployment_code, ticket_sha256, session_id, user_uid, access, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id.Tenant, id.Deployment, ticketHash(ticket), sessionID, id.Actor, access, expires); err != nil {
		return "", err
	}
	return ticket, nil
}

// CollaborationAdmission is what Collab learns when it redeems a ticket.
type CollaborationAdmission struct {
	SessionID, DocumentUUID, UserUID, Access string
	Epoch, Generation                        int64
	ExpiresAt                                time.Time
}

// AdmitCollaborationTicket redeems a one-time ticket (ADR-020 §5.1). It must
// succeed before Collab loads or sends any document state. The session must be
// active for the current epoch; the admitted user is recorded as a participant.
func (a *Adapter) AdmitCollaborationTicket(ctx context.Context, tenant, deployment, ticket string) (CollaborationAdmission, error) {
	invalid := httperror.New(http.StatusForbidden, "collaboration_ticket_invalid", "Collaboration admission ticket is invalid")
	if !snapshotReadIdentityValid(tenant) || !snapshotReadIdentityValid(deployment) || len(ticket) != 64 {
		return CollaborationAdmission{}, invalid
	}
	if _, err := hex.DecodeString(ticket); err != nil {
		return CollaborationAdmission{}, invalid
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return CollaborationAdmission{}, err
	}
	defer tx.Rollback()
	var admission CollaborationAdmission
	var redeemed sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT session_id, user_uid, access, redeemed_at FROM document_collaboration_tickets WHERE tenant_code = ? AND deployment_code = ? AND ticket_sha256 = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
		tenant, deployment, ticketHash(ticket)).Scan(&admission.SessionID, &admission.UserUID, &admission.Access, &redeemed)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && redeemed.Valid) {
		return CollaborationAdmission{}, invalid
	}
	if err != nil {
		return CollaborationAdmission{}, err
	}
	var epoch int64
	err = tx.QueryRowContext(ctx, `SELECT document_uuid, epoch, expires_at FROM document_collaboration_sessions WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP() FOR UPDATE`,
		tenant, deployment, admission.SessionID).Scan(&admission.DocumentUUID, &epoch, &admission.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CollaborationAdmission{}, httperror.New(http.StatusConflict, "collaboration_session_invalid", "Collaboration session is no longer valid")
	}
	if err != nil {
		return CollaborationAdmission{}, err
	}
	var headEpoch int64
	if err = tx.QueryRowContext(ctx, `SELECT generation, collaboration_epoch FROM document_snapshot_heads WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? FOR SHARE`,
		tenant, deployment, admission.DocumentUUID).Scan(&admission.Generation, &headEpoch); err != nil || headEpoch != epoch {
		return CollaborationAdmission{}, httperror.New(http.StatusConflict, "collaboration_session_invalid", "Collaboration session is no longer valid")
	}
	admission.Epoch = epoch
	if _, err = tx.ExecContext(ctx, `UPDATE document_collaboration_tickets SET redeemed_at = UTC_TIMESTAMP() WHERE tenant_code = ? AND deployment_code = ? AND ticket_sha256 = ?`, tenant, deployment, ticketHash(ticket)); err != nil {
		return CollaborationAdmission{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO document_collaboration_participants (tenant_code, deployment_code, session_id, user_uid, access) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE last_admitted_at = UTC_TIMESTAMP(), access = VALUES(access)`,
		tenant, deployment, admission.SessionID, admission.UserUID, admission.Access); err != nil {
		return CollaborationAdmission{}, err
	}
	return admission, tx.Commit()
}

// recordCollaborationPublication stores the verified participants of the
// session with a collaborative publication (ADR-020 §6.4). Same transaction.
func recordCollaborationPublication(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, candidateKey string) error {
	rows, err := tx.QueryContext(ctx, `SELECT user_uid FROM document_collaboration_participants WHERE tenant_code = ? AND deployment_code = ? AND session_id = ? ORDER BY user_uid`, id.Tenant, id.Deployment, id.Session)
	if err != nil {
		return err
	}
	participants := []string{}
	for rows.Next() {
		var uid string
		if err = rows.Scan(&uid); err != nil {
			rows.Close()
			return err
		}
		participants = append(participants, uid)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	raw, err := json.Marshal(participants)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO document_collaboration_publications (tenant_code, deployment_code, candidate_key, session_id, participants_json) VALUES (?, ?, ?, ?, ?)`, id.Tenant, id.Deployment, candidateKey, id.Session, string(raw))
	return err
}
