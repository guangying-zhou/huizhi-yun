package codocs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Isolated-MySQL suite for department collaboration (batch R1). Directory and
// Codocs live in two different schemas of one disposable server, exactly like
// production: Directory shared locks are held on Directory's own connection
// while the Codocs transaction runs. Run through
// scripts/test-codocs-department-collaboration-mysql.mjs.

type deptCollabEnv struct {
	t         *testing.T
	ctx       context.Context
	admin     *sql.DB
	dirDB     *sql.DB
	docDB     *sql.DB
	directory *directoryapp.Adapter
	a         *Adapter
	verify    SnapshotVerifier
}

const (
	dcTenant     = "tenant-1"
	dcDeployment = "codocs-dev"
)

func dcOpenDB(t *testing.T, socket, name string) *sql.DB {
	t.Helper()
	cfg := mysql.NewConfig()
	cfg.User, cfg.Net, cfg.Addr, cfg.DBName, cfg.ParseTime = "root", "unix", socket, name, true
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func dcExec(t *testing.T, db *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

// dcMigrationStatements splits a migration file into statements, dropping
// comment lines.
func dcMigrationStatements(t *testing.T, name string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("../../../../codocs/docs/migrations", name))
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		lines = append(lines, line)
	}
	var out []string
	for _, stmt := range strings.Split(strings.Join(lines, "\n"), ";") {
		if strings.TrimSpace(stmt) != "" {
			out = append(out, stmt)
		}
	}
	return out
}

func dcInstallCodocs(t *testing.T, db *sql.DB, withDepartmentMigration bool) {
	t.Helper()
	source, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"folders", "documents", "document_shares", "document_versions", "document_relations", "department_shares", "operation_logs"} {
		ddl := regexp.MustCompile("(?ms)^CREATE TABLE `" + table + "` \\(.*?^\\) ENGINE=.*?;").FindString(string(source))
		if ddl == "" {
			t.Fatalf("missing canonical schema for %s", table)
		}
		dcExec(t, db, ddl)
	}
	receipt := regexp.MustCompile(`(?ms)^CREATE TABLE IF NOT EXISTS service_command_receipt \(.*?^\) ENGINE=.*?;`).FindString(string(source))
	if receipt == "" {
		t.Fatal("missing service_command_receipt")
	}
	dcExec(t, db, receipt)
	for _, file := range []string{"20260920_document_snapshots.sql", "20260924_document_collaboration_sessions.sql"} {
		for _, stmt := range dcMigrationStatements(t, file) {
			// The canonical documents tables already carry document_versions.object_key.
			if strings.HasPrefix(strings.TrimSpace(stmt), "CREATE TABLE") {
				dcExec(t, db, stmt)
			}
		}
	}
	if withDepartmentMigration {
		for _, stmt := range dcMigrationStatements(t, "20260929_department_collaboration.sql") {
			dcExec(t, db, stmt)
		}
	}
}

func newDeptCollabEnv(t *testing.T) *deptCollabEnv {
	socket := os.Getenv("HZY_CODOCS_DEPT_COLLAB_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated disposable MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing nonisolated socket")
	}
	admin := dcOpenDB(t, socket, "")
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	dirName, docName := "dc_dir_"+suffix, "dc_doc_"+suffix
	for _, name := range []string{dirName, docName} {
		dcExec(t, admin, "CREATE DATABASE `"+name+"`")
		name := name
		t.Cleanup(func() { _, _ = admin.Exec("DROP DATABASE `" + name + "`") })
	}
	env := &deptCollabEnv{t: t, ctx: context.Background(), admin: admin, dirDB: dcOpenDB(t, socket, dirName), docDB: dcOpenDB(t, socket, docName)}
	for _, ddl := range []string{
		`CREATE TABLE directory_departments(dept_code VARCHAR(64) PRIMARY KEY, leader_uid VARCHAR(64), manager_uid VARCHAR(64), parent_dept_code VARCHAR(64), status VARCHAR(32), org_type VARCHAR(32)) ENGINE=InnoDB`,
		`CREATE TABLE directory_users(uid VARCHAR(64) PRIMARY KEY, status VARCHAR(32)) ENGINE=InnoDB`,
		`CREATE TABLE directory_user_departments(uid VARCHAR(64), dept_code VARCHAR(64), status VARCHAR(32), PRIMARY KEY(uid,dept_code)) ENGINE=InnoDB`,
	} {
		dcExec(t, env.dirDB, ddl)
	}
	dcExec(t, env.dirDB, `INSERT INTO directory_departments VALUES('D0','','pmgr',NULL,'active','department'),('D1','lead','mgr','D0','active','department'),('D2','','mgr2',NULL,'active','department')`)
	for _, uid := range []string{"owner", "writer", "reader", "outsider", "lead", "mgr", "pmgr", "mgr2"} {
		dcExec(t, env.dirDB, `INSERT INTO directory_users VALUES(?, 'active')`, uid)
	}
	for _, uid := range []string{"owner", "writer", "reader", "lead"} {
		dcExec(t, env.dirDB, `INSERT INTO directory_user_departments VALUES(?, 'D1', 'active')`, uid)
	}
	// Writer-cap fixtures: u01..u25 are ordinary members of D1.
	for i := 1; i <= 25; i++ {
		uid := fmt.Sprintf("u%02d", i)
		dcExec(t, env.dirDB, `INSERT INTO directory_users VALUES(?, 'active')`, uid)
		dcExec(t, env.dirDB, `INSERT INTO directory_user_departments VALUES(?, 'D1', 'active')`, uid)
	}
	dcInstallCodocs(t, env.docDB, true)
	env.directory = directoryapp.NewWithDB(env.dirDB, dcTenant, "", "")
	env.a = &Adapter{db: env.docDB}
	env.verify = func(context.Context, PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) error {
		return nil
	}
	return env
}

// --- helpers ----------------------------------------------------------------

func (e *deptCollabEnv) newDoc(owner, docType, dept string) string {
	e.t.Helper()
	u := uuid.NewString()
	var deptValue any
	if dept != "" {
		deptValue = dept
	}
	dcExec(e.t, e.docDB, `INSERT INTO documents (uuid,title,doc_type,dept_code,oss_path,owner_uid,status) VALUES (?, ?, ?, ?, 'legacy.md', ?, 1)`, u, "Doc "+u[:8], docType, deptValue, owner)
	return u
}

func (e *deptCollabEnv) share(docUUID, to, permission string) {
	e.t.Helper()
	dcExec(e.t, e.docDB, `INSERT INTO document_shares (document_id, owner_uid, shared_to_uid, permission) SELECT id, owner_uid, ?, ? FROM documents WHERE uuid = ?`, to, permission, docUUID)
}

func (e *deptCollabEnv) hostID(actor, key string) PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: dcTenant, Deployment: dcDeployment, Actor: actor, Client: "enterprise.runtime", RequestID: "req", Key: key}
}

// role locks the actor's Directory relation and returns it with its release.
func (e *deptCollabEnv) role(actor, dept string) (DepartmentCollabRole, func()) {
	e.t.Helper()
	role, tx, err := e.directory.LockEnterpriseCodocsDepartmentAccess(e.ctx, actor, dept)
	if err != nil {
		e.t.Fatal(err)
	}
	return DepartmentCollabRole{CanWrite: role.CanWrite(), CanManage: role.CanManage()}, func() { _ = tx.Rollback() }
}

func (e *deptCollabEnv) locker() DepartmentRoleLocker {
	return func(ctx context.Context, dept string, uids []string) (map[string]DepartmentCollabRole, func(), error) {
		roles, tx, err := e.directory.LockEnterpriseCodocsDepartmentAccessBatch(ctx, dept, uids)
		if err != nil {
			var he httperror.Error
			if errors.As(err, &he) {
				return nil, nil, err
			}
			return nil, nil, httperror.New(503, "department_directory_unavailable", "Directory unavailable")
		}
		out := map[string]DepartmentCollabRole{}
		for uid, r := range roles {
			out[uid] = DepartmentCollabRole{CanWrite: r.CanWrite(), CanManage: r.CanManage()}
		}
		return out, func() { _ = tx.Rollback() }, nil
	}
}

func (e *deptCollabEnv) wantStatus(err error, status int, code string) {
	e.t.Helper()
	var he httperror.Error
	if !errors.As(err, &he) || he.Status != status || (code != "" && he.Code != code) {
		e.t.Fatalf("want %d %q, got %v", status, code, err)
	}
}

func (e *deptCollabEnv) open(actor, docUUID string) (CollaborationSession, error) {
	e.t.Helper()
	role, release := e.role(actor, "D1")
	defer release()
	return e.a.OpenDepartmentCollaborationSession(e.ctx, e.hostID(actor, ""), "D1", docUUID, role)
}

func (e *deptCollabEnv) mustOpen(actor, docUUID string) CollaborationSession {
	e.t.Helper()
	s, err := e.open(actor, docUUID)
	if err != nil {
		e.t.Fatalf("open as %s: %v", actor, err)
	}
	return s
}

func (e *deptCollabEnv) admit(ticket string) (CollaborationAdmission, error) {
	e.t.Helper()
	peek, ok, err := e.a.PeekCollaborationTicket(e.ctx, dcTenant, dcDeployment, ticket)
	if err != nil {
		e.t.Fatal(err)
	}
	if !ok || peek.Policy != "department" {
		return e.a.AdmitCollaborationTicket(e.ctx, dcTenant, dcDeployment, ticket)
	}
	roles, release, err := e.locker()(e.ctx, peek.DeptCode, []string{peek.UserUID})
	if err != nil {
		return CollaborationAdmission{}, err
	}
	defer release()
	return e.a.AdmitDepartmentCollaborationTicket(e.ctx, dcTenant, dcDeployment, ticket, peek, roles[peek.UserUID])
}

func (e *deptCollabEnv) mustAdmit(ticket string) CollaborationAdmission {
	e.t.Helper()
	admission, err := e.admit(ticket)
	if err != nil {
		e.t.Fatalf("admit: %v", err)
	}
	return admission
}

func (e *deptCollabEnv) convert(docUUID, actor string) {
	e.t.Helper()
	role, release := e.role(actor, "D1")
	defer release()
	cmd := SnapshotCommand{UUID: docUUID, MarkdownSHA256: strings.Repeat("a", 64), MarkdownSize: 10}
	id := e.hostID(actor, "convert-"+docUUID)
	plan, err := e.a.PrepareDepartmentConversionSnapshot(e.ctx, id, "D1", role, cmd)
	if err != nil {
		e.t.Fatalf("convert prepare: %v", err)
	}
	if _, err = e.a.PublishDepartmentConversionSnapshot(e.ctx, id, "D1", role, cmd, dcObjects(plan, false), e.verify); err != nil {
		e.t.Fatalf("convert publish: %v", err)
	}
}

func dcObjects(plan SnapshotPlan, paired bool) SnapshotObjects {
	base := plan.Prefix + strings.Repeat("b", 32)
	objects := SnapshotObjects{Markdown: SnapshotObject{Key: base + "/body.md", Version: "v-md"}}
	if paired {
		objects.Yjs = &SnapshotObject{Key: base + "/state.yjs", Version: "v-yjs"}
	}
	return objects
}

// v2Doc creates a department document already converted to v2.
func (e *deptCollabEnv) v2Doc(owner string) string {
	e.t.Helper()
	u := e.newDoc(owner, "department", "D1")
	e.convert(u, owner)
	return u
}

func (e *deptCollabEnv) head(docUUID string) (generation, epoch int64) {
	e.t.Helper()
	if err := e.docDB.QueryRow(`SELECT generation, collaboration_epoch FROM document_snapshot_heads WHERE document_uuid = ?`, docUUID).Scan(&generation, &epoch); err != nil {
		e.t.Fatal(err)
	}
	return
}

func (e *deptCollabEnv) sessionStatus(sessionID string) string {
	e.t.Helper()
	var status string
	if err := e.docDB.QueryRow(`SELECT status FROM document_collaboration_sessions WHERE session_id = ?`, sessionID).Scan(&status); err != nil {
		e.t.Fatal(err)
	}
	return status
}

func (e *deptCollabEnv) participantStatus(sessionID, uid string) string {
	e.t.Helper()
	var status string
	if err := e.docDB.QueryRow(`SELECT status FROM document_collaboration_participants WHERE session_id = ? AND user_uid = ?`, sessionID, uid).Scan(&status); err != nil {
		e.t.Fatal(err)
	}
	return status
}

func (e *deptCollabEnv) cid(sessionID, key string) CollaborationIdentity {
	return CollaborationIdentity{Tenant: dcTenant, Deployment: dcDeployment, SessionID: sessionID, RequestID: "req", Key: key}
}

func (e *deptCollabEnv) renew(sessionID string, connected []string, reported bool) (time.Time, []string, error) {
	return e.a.RenewDepartmentCollaborationSession(e.ctx, e.cid(sessionID, ""), connected, reported, e.locker())
}

// publish runs prepare + publish through the session, as Collab does.
func (e *deptCollabEnv) publish(sessionID, key string, generation, epoch int64) (SnapshotPlan, error) {
	e.t.Helper()
	info, err := e.a.ResolveCollaborationSessionInfo(e.ctx, e.cid(sessionID, key))
	if err != nil {
		return SnapshotPlan{}, err
	}
	cmd := SnapshotCommand{UUID: info.DocumentUUID, Generation: generation, Epoch: epoch, MarkdownSHA256: strings.Repeat("c", 64), MarkdownSize: 20, YjsSHA256: strings.Repeat("d", 64), YjsSize: 30}
	plan, err := e.a.PrepareDepartmentCollaborationSnapshot(e.ctx, info.Identity, info.DeptCode, cmd)
	if err != nil {
		return plan, err
	}
	return e.a.PublishDepartmentCollaborationSnapshot(e.ctx, info.Identity, info.DeptCode, cmd, dcObjects(plan, true), e.verify, e.locker())
}

func (e *deptCollabEnv) manage(actor, action, docUUID string, payload map[string]any) error {
	e.t.Helper()
	role, release := e.role(actor, "D1")
	defer release()
	identity := departmentFolderIdentity()
	identity.Actor, identity.Key = actor, action+"-"+uuid.NewString()
	_, err := e.a.ManageEnterpriseDepartmentDocument(e.ctx, identity, action, docUUID, payload, func(context.Context, *sql.Tx, string, string) error {
		if !role.CanManage {
			return httperror.New(403, "department_manager_required", "Department manager required")
		}
		return nil
	})
	return err
}

// --- the suite --------------------------------------------------------------

func TestMySQLDepartmentCollaboration(t *testing.T) {
	env := newDeptCollabEnv(t)

	t.Run("migration path matches canonical schema", func(t *testing.T) {
		suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
		name := "dc_canon_" + suffix
		dcExec(t, env.admin, "CREATE DATABASE `"+name+"`")
		defer env.admin.Exec("DROP DATABASE `" + name + "`")
		socket := os.Getenv("HZY_CODOCS_DEPT_COLLAB_TEST_SOCKET")
		canon := dcOpenDB(t, socket, name)
		source, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
		if err != nil {
			t.Fatal(err)
		}
		for _, table := range []string{"document_snapshot_heads", "document_snapshot_candidates", "document_collaboration_sessions", "document_collaboration_tickets", "document_collaboration_participants", "document_collaboration_publications"} {
			ddl := regexp.MustCompile("(?ms)^CREATE TABLE " + table + " \\(.*?^\\) ENGINE=InnoDB;").FindString(string(source))
			if ddl == "" {
				t.Fatalf("missing canonical %s", table)
			}
			dcExec(t, canon, ddl)
		}
		alter := regexp.MustCompile(`(?m)^ALTER TABLE document_snapshot_heads ADD INDEX snapshot_head_document \(document_uuid\);`).FindString(string(source))
		if alter == "" {
			t.Fatal("canonical schema lacks the heads document index")
		}
		dcExec(t, canon, alter)
		describe := func(db *sql.DB) string {
			rows, err := db.Query(`SELECT c.table_name, c.column_name, c.column_type, c.is_nullable, COALESCE(c.column_default,'<null>'), COALESCE(c.collation_name,'') FROM information_schema.columns c WHERE c.table_schema = DATABASE() AND c.table_name LIKE 'document_%' AND c.table_name NOT IN ('documents','document_shares','document_versions','document_relations') ORDER BY c.table_name, c.column_name`)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var out []string
			for rows.Next() {
				var a, b, c, d, f, g string
				if err := rows.Scan(&a, &b, &c, &d, &f, &g); err != nil {
					t.Fatal(err)
				}
				out = append(out, strings.Join([]string{a, b, c, d, f, g}, "|"))
			}
			idx, err := db.Query(`SELECT table_name, index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index), non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name LIKE 'document_%' AND table_name NOT IN ('documents','document_shares','document_versions','document_relations') GROUP BY table_name, index_name, non_unique ORDER BY table_name, index_name`)
			if err != nil {
				t.Fatal(err)
			}
			defer idx.Close()
			for idx.Next() {
				var a, b, c string
				var d int
				if err := idx.Scan(&a, &b, &c, &d); err != nil {
					t.Fatal(err)
				}
				out = append(out, fmt.Sprintf("idx|%s|%s|%s|%d", a, b, c, d))
			}
			return strings.Join(out, "\n")
		}
		if migrated, canonical := describe(env.docDB), describe(canon); migrated != canonical {
			t.Fatalf("migration drifted from canonical schema\nmigrated:\n%s\ncanonical:\n%s", migrated, canonical)
		}
	})

	t.Run("only writers get a session and a ticket", func(t *testing.T) {
		doc := env.v2Doc("owner")
		// owner of the document.
		s := env.mustOpen("owner", doc)
		if s.Ticket == "" || len(s.Ticket) != 64 || s.Generation != 1 || s.Reused {
			t.Fatalf("session=%+v", s)
		}
		var stored int
		if err := env.docDB.QueryRow(`SELECT COUNT(*) FROM document_collaboration_tickets WHERE ticket_sha256 = ? AND session_id = ? AND user_uid = 'owner' AND access = 'write'`, ticketHash(s.Ticket), s.SessionID).Scan(&stored); err != nil || stored != 1 {
			t.Fatalf("hashed ticket rows=%d err=%v", stored, err)
		}
		if err := env.docDB.QueryRow(`SELECT COUNT(*) FROM document_collaboration_tickets WHERE ticket_sha256 = ?`, s.Ticket).Scan(&stored); err != nil || stored != 0 {
			t.Fatal("plaintext ticket stored")
		}
		var policy, dept string
		var expires time.Time
		if err := env.docDB.QueryRow(`SELECT policy, dept_code, expires_at FROM document_collaboration_sessions WHERE session_id = ?`, s.SessionID).Scan(&policy, &dept, &expires); err != nil || policy != "department" || dept != "D1" {
			t.Fatalf("policy=%q dept=%q err=%v", policy, dept, err)
		}
		if ttl := time.Until(expires.UTC().Add(0)); ttl > DepartmentCollaborationSessionTTL+2*time.Second || ttl < 60*time.Second {
			t.Fatalf("department lease ttl=%s", ttl)
		}
		// A member who is neither owner nor share-writer is refused.
		_, err := env.open("writer", doc)
		env.wantStatus(err, 403, "department_document_write_denied")
		env.share(doc, "reader", "read")
		_, err = env.open("reader", doc)
		env.wantStatus(err, 403, "department_document_write_denied")
		env.share(doc, "writer", "write")
		env.mustOpen("writer", doc)
		// The manager needs neither ownership nor a share.
		env.mustOpen("mgr", doc)
		// Leader (a member row too), parent manager and outsiders get no session.
		for _, uid := range []string{"lead", "pmgr", "outsider"} {
			_, err = env.open(uid, doc)
			env.wantStatus(err, 403, "department_writer_required")
		}
		// Document rules: wrong department, readonly, recycled, not v2.
		role, release := env.role("owner", "D1")
		defer release()
		_, err = env.a.OpenDepartmentCollaborationSession(env.ctx, env.hostID("owner", ""), "D2", doc, role)
		env.wantStatus(err, 403, "department_document_scope_denied")
		fresh := env.newDoc("owner", "department", "D1")
		_, err = env.open("owner", fresh)
		env.wantStatus(err, 409, "document_not_on_snapshot_v2")
		personal := env.newDoc("owner", "private", "")
		_, err = env.open("owner", personal)
		env.wantStatus(err, 403, "department_document_scope_denied")
		other := env.v2Doc("owner")
		dcExec(t, env.docDB, `UPDATE documents SET readonly_flag = 1 WHERE uuid = ?`, other)
		_, err = env.open("owner", other)
		env.wantStatus(err, 403, "snapshot_document_not_writable")
		dcExec(t, env.docDB, `UPDATE documents SET readonly_flag = 0, status = 0 WHERE uuid = ?`, other)
		_, err = env.open("owner", other)
		env.wantStatus(err, 404, "document_not_found")
	})

	t.Run("open replays reuse the session and void the earlier ticket", func(t *testing.T) {
		doc := env.v2Doc("owner")
		first := env.mustOpen("owner", doc)
		second := env.mustOpen("owner", doc)
		if !second.Reused || second.SessionID != first.SessionID || second.Ticket == first.Ticket {
			t.Fatalf("first=%+v second=%+v", first, second)
		}
		_, err := env.admit(first.Ticket)
		env.wantStatus(err, 403, "collaboration_ticket_invalid")
		admission := env.mustAdmit(second.Ticket)
		if admission.UserUID != "owner" || admission.Policy != "department" || admission.DeptCode != "D1" || admission.Access != "write" || admission.DocumentUUID != doc {
			t.Fatalf("admission=%+v", admission)
		}
		if env.participantStatus(first.SessionID, "owner") != "active" {
			t.Fatal("participant not active")
		}
		// Tickets are single use.
		_, err = env.admit(second.Ticket)
		env.wantStatus(err, 403, "collaboration_ticket_invalid")
		// Unknown tenant/deployment cannot redeem.
		third := env.mustOpen("owner", doc)
		if _, ok, _ := env.a.PeekCollaborationTicket(env.ctx, "other-tenant", dcDeployment, third.Ticket); ok {
			t.Fatal("ticket visible to another tenant")
		}
		if _, err = env.a.AdmitCollaborationTicket(env.ctx, "other-tenant", dcDeployment, third.Ticket); err == nil {
			t.Fatal("ticket redeemed by another tenant")
		}
		// Expired tickets are refused.
		dcExec(t, env.docDB, `UPDATE document_collaboration_tickets SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE ticket_sha256 = ?`, ticketHash(third.Ticket))
		_, err = env.admit(third.Ticket)
		env.wantStatus(err, 403, "collaboration_ticket_invalid")
	})

	t.Run("open rate limit is per user and document", func(t *testing.T) {
		doc := env.v2Doc("owner")
		for i := 0; i < departmentCollaborationOpenLimit; i++ {
			env.mustOpen("owner", doc)
		}
		_, err := env.open("owner", doc)
		env.wantStatus(err, 429, "collaboration_open_rate_limited")
		env.mustOpen("mgr", doc)
	})

	t.Run("writer cap of 20 counts admitted participants and live tickets", func(t *testing.T) {
		doc := env.v2Doc("owner")
		first := env.mustOpen("mgr", doc)
		env.mustAdmit(first.Ticket)
		for i := 1; i <= 19; i++ {
			uid := fmt.Sprintf("u%02d", i)
			dcExec(t, env.docDB, `INSERT INTO document_collaboration_participants (tenant_code, deployment_code, session_id, user_uid, access) VALUES (?, ?, ?, ?, 'write')`, dcTenant, dcDeployment, first.SessionID, uid)
		}
		// 20 writers now (mgr + u01..u19): the 21st is refused, the existing ones may reopen.
		env.share(doc, "writer", "write")
		_, err := env.open("writer", doc)
		env.wantStatus(err, 409, "collaboration_writer_limit_reached")
		env.mustOpen("mgr", doc)
		// A participant who left frees a slot.
		dcExec(t, env.docDB, `UPDATE document_collaboration_participants SET status = 'left' WHERE session_id = ? AND user_uid = 'u01'`, first.SessionID)
		w := env.mustOpen("writer", doc)
		// The outstanding ticket counts as a writer.
		env.share(doc, "reader", "write")
		_, err = env.open("reader", doc)
		env.wantStatus(err, 409, "collaboration_writer_limit_reached")
		env.mustAdmit(w.Ticket)
	})

	t.Run("directory lock spans the codocs transaction and admission re-checks", func(t *testing.T) {
		doc := env.v2Doc("owner")
		env.share(doc, "writer", "write")
		role, tx, err := env.directory.LockEnterpriseCodocsDepartmentAccess(env.ctx, "writer", "D1")
		if err != nil || !role.CanWrite() {
			t.Fatalf("role=%s err=%v", role, err)
		}
		removed := make(chan error, 1)
		go func() {
			_, e := env.dirDB.Exec(`UPDATE directory_user_departments SET status = 'inactive' WHERE uid = 'writer' AND dept_code = 'D1'`)
			removed <- e
		}()
		select {
		case e := <-removed:
			t.Fatalf("removal passed the shared lock: %v", e)
		case <-time.After(150 * time.Millisecond):
		}
		s, err := env.a.OpenDepartmentCollaborationSession(env.ctx, env.hostID("writer", ""), "D1", doc, DepartmentCollabRole{CanWrite: role.CanWrite(), CanManage: role.CanManage()})
		if err != nil {
			t.Fatal(err)
		}
		select {
		case e := <-removed:
			t.Fatalf("removal completed before the Directory lock was released: %v", e)
		case <-time.After(100 * time.Millisecond):
		}
		_ = tx.Rollback()
		select {
		case e := <-removed:
			if e != nil {
				t.Fatal(e)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("removal did not complete")
		}
		// The ticket was signed while the relation held; redemption re-checks and refuses.
		_, err = env.admit(s.Ticket)
		env.wantStatus(err, 403, "collaboration_ticket_invalid")
		dcExec(t, env.dirDB, `UPDATE directory_user_departments SET status = 'active' WHERE uid = 'writer' AND dept_code = 'D1'`)
	})

	t.Run("member removed mid-session: renew reports revokedUids and publish is rejected", func(t *testing.T) {
		doc := env.v2Doc("owner")
		env.share(doc, "writer", "write")
		a := env.mustOpen("owner", doc)
		env.mustAdmit(a.Ticket)
		b := env.mustOpen("writer", doc)
		env.mustAdmit(b.Ticket)
		if b.SessionID != a.SessionID {
			t.Fatal("expected one shared session")
		}
		// Healthy renew: lease refreshed, nobody revoked, missing user marked left.
		expires, revoked, err := env.renew(a.SessionID, []string{"owner", "writer"}, true)
		if err != nil || len(revoked) != 0 || time.Until(expires) > DepartmentCollaborationSessionTTL+2*time.Second {
			t.Fatalf("expires=%s revoked=%v err=%v", expires, revoked, err)
		}
		// Directory removes writer; a publish before the next renew is rejected with the uid.
		dcExec(t, env.dirDB, `UPDATE directory_user_departments SET status = 'inactive' WHERE uid = 'writer' AND dept_code = 'D1'`)
		generation, epoch := env.head(doc)
		_, err = env.publish(a.SessionID, "p1", generation, epoch)
		env.wantStatus(err, 409, "collaboration_participant_revoked")
		var revokedErr ParticipantsRevokedError
		if !errors.As(err, &revokedErr) || fmt.Sprint(revokedErr.UIDs) != "[writer]" || fmt.Sprint(revokedErr.ErrorDetails()["revokedUids"]) != "[writer]" {
			t.Fatalf("revoked error=%#v", err)
		}
		if g, _ := env.head(doc); g != generation {
			t.Fatal("rejected publication advanced the head")
		}
		if env.participantStatus(a.SessionID, "writer") != "revoked" || env.participantStatus(a.SessionID, "owner") != "active" {
			t.Fatal("rejection outcome not persisted")
		}
		// After Collab disconnects the user the retry publishes; writer is not recorded.
		if _, err = env.publish(a.SessionID, "p2", generation, epoch); err != nil {
			t.Fatal(err)
		}
		var recorded string
		if err = env.docDB.QueryRow(`SELECT participants_json FROM document_collaboration_publications WHERE session_id = ?`, a.SessionID).Scan(&recorded); err != nil || !strings.Contains(recorded, "owner") || strings.Contains(recorded, "writer") {
			t.Fatalf("participants=%s err=%v", recorded, err)
		}
		// Renew names an unadmitted connection and keeps the rest.
		_, revoked, err = env.renew(a.SessionID, []string{"owner", "writer"}, true)
		if err != nil || fmt.Sprint(revoked) != "[writer]" {
			t.Fatalf("revoked=%v err=%v", revoked, err)
		}
		_, revoked, err = env.renew(a.SessionID, []string{"owner", "ghost"}, true)
		if err != nil || fmt.Sprint(revoked) != "[ghost]" {
			t.Fatalf("revoked=%v err=%v", revoked, err)
		}
		// Owner leaving the department: every participant fails, the session ends.
		dcExec(t, env.dirDB, `UPDATE directory_user_departments SET status = 'inactive' WHERE uid = 'owner' AND dept_code = 'D1'`)
		_, _, err = env.renew(a.SessionID, []string{"owner"}, true)
		env.wantStatus(err, 409, "collaboration_session_invalid")
		if env.sessionStatus(a.SessionID) != "revoked" {
			t.Fatal("session not ended")
		}
		g, ep := env.head(doc)
		_, err = env.publish(a.SessionID, "p3", g, ep)
		env.wantStatus(err, 409, "collaboration_session_invalid")
		dcExec(t, env.dirDB, `UPDATE directory_user_departments SET status = 'active' WHERE dept_code = 'D1' AND uid IN ('owner','writer')`)
	})

	t.Run("manager change, user deactivation and share loss revoke on renew", func(t *testing.T) {
		doc := env.v2Doc("owner")
		env.share(doc, "writer", "write")
		o := env.mustOpen("owner", doc)
		env.mustAdmit(o.Ticket)
		env.mustAdmit(env.mustOpen("writer", doc).Ticket)
		env.mustAdmit(env.mustOpen("mgr", doc).Ticket)
		dcExec(t, env.dirDB, `UPDATE directory_departments SET manager_uid = 'someone' WHERE dept_code = 'D1'`)
		_, revoked, err := env.renew(o.SessionID, []string{"owner", "writer", "mgr"}, true)
		if err != nil || fmt.Sprint(revoked) != "[mgr]" {
			t.Fatalf("manager change: revoked=%v err=%v", revoked, err)
		}
		dcExec(t, env.dirDB, `UPDATE directory_departments SET manager_uid = 'mgr' WHERE dept_code = 'D1'`)
		dcExec(t, env.dirDB, `UPDATE directory_users SET status = 'disabled' WHERE uid = 'writer'`)
		_, revoked, err = env.renew(o.SessionID, []string{"owner", "writer"}, true)
		if err != nil || fmt.Sprint(revoked) != "[writer]" {
			t.Fatalf("deactivation: revoked=%v err=%v", revoked, err)
		}
		dcExec(t, env.dirDB, `UPDATE directory_users SET status = 'active' WHERE uid = 'writer'`)
		// Leader promotion: leader wins over member, so the promoted user loses write access.
		dcExec(t, env.dirDB, `UPDATE directory_departments SET leader_uid = 'owner' WHERE dept_code = 'D1'`)
		_, _, err = env.renew(o.SessionID, []string{"owner"}, true)
		env.wantStatus(err, 409, "collaboration_session_invalid")
		dcExec(t, env.dirDB, `UPDATE directory_departments SET leader_uid = 'lead' WHERE dept_code = 'D1'`)
	})

	t.Run("unreported participants are marked left without ending the session", func(t *testing.T) {
		doc := env.v2Doc("owner")
		env.share(doc, "writer", "write")
		o := env.mustOpen("owner", doc)
		env.mustAdmit(o.Ticket)
		env.mustAdmit(env.mustOpen("writer", doc).Ticket)
		if _, revoked, err := env.renew(o.SessionID, []string{"owner"}, true); err != nil || len(revoked) != 0 {
			t.Fatalf("revoked=%v err=%v", revoked, err)
		}
		if env.participantStatus(o.SessionID, "writer") != "left" {
			t.Fatal("writer not marked left")
		}
		// Renew without a report changes no participant status.
		if _, _, err := env.renew(o.SessionID, nil, false); err != nil {
			t.Fatal(err)
		}
		if env.participantStatus(o.SessionID, "owner") != "active" || env.participantStatus(o.SessionID, "writer") != "left" {
			t.Fatal("unreported renew altered participants")
		}
		// Publication still records the user who left (authorship), and succeeds.
		g, ep := env.head(doc)
		if _, err := env.publish(o.SessionID, "left", g, ep); err != nil {
			t.Fatal(err)
		}
		var recorded string
		if err := env.docDB.QueryRow(`SELECT participants_json FROM document_collaboration_publications WHERE session_id = ?`, o.SessionID).Scan(&recorded); err != nil || !strings.Contains(recorded, "writer") {
			t.Fatalf("participants=%s err=%v", recorded, err)
		}
	})

	t.Run("manager readonly mid-session revokes the session and advances the epoch", func(t *testing.T) {
		doc := env.v2Doc("owner")
		o := env.mustOpen("owner", doc)
		env.mustAdmit(o.Ticket)
		_, epochBefore := env.head(doc)
		// Un-freezing a document that is not frozen must not end the session.
		if err := env.manage("mgr", "readonly", doc, map[string]any{"readonly_flag": false}); err != nil {
			t.Fatal(err)
		}
		if env.sessionStatus(o.SessionID) != "active" {
			t.Fatal("readonly=false ended the session")
		}
		if err := env.manage("mgr", "readonly", doc, map[string]any{"readonly_flag": true}); err != nil {
			t.Fatal(err)
		}
		if env.sessionStatus(o.SessionID) != "revoked" {
			t.Fatal("session survived readonly")
		}
		if _, epochAfter := env.head(doc); epochAfter != epochBefore+1 {
			t.Fatalf("epoch %d -> %d", epochBefore, epochAfter)
		}
		_, _, err := env.renew(o.SessionID, []string{"owner"}, true)
		env.wantStatus(err, 409, "collaboration_session_invalid")
		g, ep := env.head(doc)
		_, err = env.publish(o.SessionID, "late", g, ep)
		env.wantStatus(err, 409, "collaboration_session_invalid")
		// A stale identity cannot publish either (document is read-only / epoch moved).
		stale := PersonalFolderCreationIdentity{Tenant: dcTenant, Deployment: dcDeployment, Actor: "owner", Client: "collab.runtime", Key: "collab:" + o.SessionID + ":late2", Session: o.SessionID}
		cmd := SnapshotCommand{UUID: doc, Generation: g, Epoch: epochBefore, MarkdownSHA256: strings.Repeat("c", 64), MarkdownSize: 20, YjsSHA256: strings.Repeat("d", 64), YjsSize: 30}
		_, err = env.a.PrepareDepartmentCollaborationSnapshot(env.ctx, stale, "D1", cmd)
		if err == nil {
			t.Fatal("late prepare accepted")
		}
		_, err = env.open("owner", doc)
		env.wantStatus(err, 403, "snapshot_document_not_writable")
	})

	t.Run("manager recycle mid-session revokes the session and advances the epoch", func(t *testing.T) {
		doc := env.v2Doc("owner")
		o := env.mustOpen("owner", doc)
		env.mustAdmit(o.Ticket)
		_, epochBefore := env.head(doc)
		if err := env.manage("mgr", "recycle", doc, map[string]any{}); err != nil {
			t.Fatal(err)
		}
		if env.sessionStatus(o.SessionID) != "revoked" {
			t.Fatal("session survived recycle")
		}
		if _, epochAfter := env.head(doc); epochAfter != epochBefore+1 {
			t.Fatalf("epoch %d -> %d", epochBefore, epochAfter)
		}
		_, _, err := env.renew(o.SessionID, []string{"owner"}, true)
		env.wantStatus(err, 409, "collaboration_session_invalid")
		_, err = env.open("owner", doc)
		env.wantStatus(err, 404, "document_not_found")
	})

	t.Run("share changes revoke department sessions too", func(t *testing.T) {
		doc := env.v2Doc("owner")
		env.share(doc, "writer", "write")
		o := env.mustOpen("owner", doc)
		env.mustAdmit(o.Ticket)
		var shareID string
		if err := env.docDB.QueryRow(`SELECT id FROM document_shares WHERE shared_to_uid = 'writer' AND document_id = (SELECT id FROM documents WHERE uuid = ?)`, doc).Scan(&shareID); err != nil {
			t.Fatal(err)
		}
		_, epochBefore := env.head(doc)
		if _, err := env.a.deleteDocumentShare(env.ctx, doc, shareID, map[string]any{"current_user": "owner"}); err != nil {
			t.Fatal(err)
		}
		if env.sessionStatus(o.SessionID) != "revoked" {
			t.Fatal("session survived share revocation")
		}
		if _, epochAfter := env.head(doc); epochAfter != epochBefore+1 {
			t.Fatalf("epoch %d -> %d", epochBefore, epochAfter)
		}
	})

	t.Run("edit-metadata does not disturb an active session", func(t *testing.T) {
		doc := env.v2Doc("owner")
		o := env.mustOpen("owner", doc)
		env.mustAdmit(o.Ticket)
		_, epochBefore := env.head(doc)
		role, release := env.role("owner", "D1")
		defer release()
		identity := departmentFolderIdentity()
		identity.Actor, identity.Key = "owner", "meta-"+uuid.NewString()
		if _, err := env.a.EditEnterpriseDepartmentDocumentMetadata(env.ctx, identity, doc, map[string]any{"title": "Renamed while editing"}, func(context.Context, *sql.Tx, string, string) (bool, bool, error) {
			return role.CanWrite, role.CanManage, nil
		}); err != nil {
			t.Fatal(err)
		}
		if _, epochAfter := env.head(doc); epochAfter != epochBefore || env.sessionStatus(o.SessionID) != "active" {
			t.Fatal("metadata edit disturbed the session")
		}
	})

	t.Run("v1 to v2 conversion: one winner, reading does not convert", func(t *testing.T) {
		doc := env.newDoc("owner", "department", "D1")
		env.share(doc, "writer", "write")
		read, err := env.a.ReadDepartmentDocumentSnapshot(env.ctx, env.hostID("reader", ""), "D1", doc)
		if err != nil || read.Generation != 0 || read.Objects != nil || read.LegacyPath != "legacy.md" {
			t.Fatalf("read=%+v err=%v", read, err)
		}
		var heads int
		if err = env.docDB.QueryRow(`SELECT COUNT(*) FROM document_snapshot_heads WHERE document_uuid = ?`, doc).Scan(&heads); err != nil || heads != 0 {
			t.Fatalf("reading created a head (%d): %v", heads, err)
		}
		// Only writers convert; leader/reader cannot.
		cmd := SnapshotCommand{UUID: doc, MarkdownSHA256: strings.Repeat("a", 64), MarkdownSize: 10}
		leadRole, release := env.role("lead", "D1")
		_, err = env.a.PrepareDepartmentConversionSnapshot(env.ctx, env.hostID("lead", "k-lead"), "D1", leadRole, cmd)
		release()
		env.wantStatus(err, 403, "department_writer_required")
		readerRole, release := env.role("reader", "D1")
		_, err = env.a.PrepareDepartmentConversionSnapshot(env.ctx, env.hostID("reader", "k-reader"), "D1", readerRole, cmd)
		release()
		env.wantStatus(err, 403, "department_document_write_denied")
		ownerRole, release := env.role("owner", "D1")
		bad := cmd
		bad.Generation = 1
		if _, err = env.a.PrepareDepartmentConversionSnapshot(env.ctx, env.hostID("owner", "k-gen"), "D1", ownerRole, bad); err == nil {
			t.Fatal("conversion accepted a non-zero generation")
		}
		bad = cmd
		bad.YjsSHA256, bad.YjsSize = strings.Repeat("d", 64), 5
		_, err = env.a.PrepareDepartmentConversionSnapshot(env.ctx, env.hostID("owner", "k-yjs"), "D1", ownerRole, bad)
		env.wantStatus(err, 400, "department_snapshot_conversion_invalid")
		release()

		// Two writers race to convert; exactly one publication wins.
		var wg sync.WaitGroup
		results := make([]error, 2)
		for i, actor := range []string{"owner", "writer"} {
			wg.Add(1)
			go func(i int, actor string) {
				defer wg.Done()
				role, release := env.role(actor, "D1")
				defer release()
				id := env.hostID(actor, "race-"+actor)
				plan, err := env.a.PrepareDepartmentConversionSnapshot(env.ctx, id, "D1", role, cmd)
				if err != nil {
					results[i] = err
					return
				}
				_, results[i] = env.a.PublishDepartmentConversionSnapshot(env.ctx, id, "D1", role, cmd, dcObjects(plan, false), env.verify)
			}(i, actor)
		}
		wg.Wait()
		wins := 0
		for _, err := range results {
			if err == nil {
				wins++
				continue
			}
			env.wantStatus(err, 409, "snapshot_generation_conflict")
		}
		if wins != 1 {
			t.Fatalf("winners=%d results=%v", wins, results)
		}
		var versions int
		if err = env.docDB.QueryRow(`SELECT COUNT(*) FROM document_versions WHERE document_id = (SELECT id FROM documents WHERE uuid = ?)`, doc).Scan(&versions); err != nil || versions != 1 {
			t.Fatalf("history rows=%d err=%v", versions, err)
		}
		if g, _ := env.head(doc); g != 1 {
			t.Fatalf("generation=%d", g)
		}
		// The loser re-reads the head (now generation 1) and opens the session.
		read, err = env.a.ReadDepartmentDocumentSnapshot(env.ctx, env.hostID("writer", ""), "D1", doc)
		if err != nil || read.Generation != 1 || read.Objects == nil {
			t.Fatalf("read=%+v err=%v", read, err)
		}
		env.mustOpen("writer", doc)
		// Same key replays the receipt; a different payload under the same key conflicts.
		winner := "owner"
		if results[0] != nil {
			winner = "writer"
		}
		role, release := env.role(winner, "D1")
		defer release()
		id := env.hostID(winner, "race-"+winner)
		replay, err := env.a.PublishDepartmentConversionSnapshot(env.ctx, id, "D1", role, cmd, dcObjects(SnapshotPlan{Prefix: snapshotPrefixFor(t, id, cmd)}, false), env.verify)
		if err != nil || !replay.Replayed || replay.Generation != 1 {
			t.Fatalf("replay=%+v err=%v", replay, err)
		}
		other := cmd
		other.MarkdownSHA256 = strings.Repeat("e", 64)
		_, err = env.a.PrepareDepartmentConversionSnapshot(env.ctx, id, "D1", role, other)
		env.wantStatus(err, 409, "snapshot_key_conflict")
		// After conversion the Host cannot write later generations, and v1 writers are refused.
		next := SnapshotCommand{UUID: doc, Generation: 1, MarkdownSHA256: strings.Repeat("f", 64), MarkdownSize: 4}
		_, err = env.a.PrepareDepartmentConversionSnapshot(env.ctx, env.hostID(winner, "k-next"), "D1", role, next)
		env.wantStatus(err, 409, "department_snapshot_conversion_only")
		env.wantStatus(refuseSnapshotV2Document(env.ctx, env.docDB, doc), 409, "document_on_snapshot_v2")
	})

	t.Run("directory failure is a 503 and never a permission verdict", func(t *testing.T) {
		doc := env.v2Doc("owner")
		env.share(doc, "writer", "write")
		o := env.mustOpen("owner", doc)
		env.mustAdmit(o.Ticket)
		failing := func(context.Context, string, []string) (map[string]DepartmentCollabRole, func(), error) {
			return nil, nil, httperror.New(503, "department_directory_unavailable", "Directory unavailable")
		}
		_, _, err := env.a.RenewDepartmentCollaborationSession(env.ctx, env.cid(o.SessionID, ""), []string{"owner"}, true, failing)
		env.wantStatus(err, 503, "department_directory_unavailable")
		g, ep := env.head(doc)
		info, err := env.a.ResolveCollaborationSessionInfo(env.ctx, env.cid(o.SessionID, "dirfail"))
		if err != nil {
			t.Fatal(err)
		}
		cmd := SnapshotCommand{UUID: doc, Generation: g, Epoch: ep, MarkdownSHA256: strings.Repeat("c", 64), MarkdownSize: 20, YjsSHA256: strings.Repeat("d", 64), YjsSize: 30}
		plan, err := env.a.PrepareDepartmentCollaborationSnapshot(env.ctx, info.Identity, "D1", cmd)
		if err != nil {
			t.Fatal(err)
		}
		_, err = env.a.PublishDepartmentCollaborationSnapshot(env.ctx, info.Identity, "D1", cmd, dcObjects(plan, true), env.verify, failing)
		env.wantStatus(err, 503, "department_directory_unavailable")
		if env.sessionStatus(o.SessionID) != "active" || env.participantStatus(o.SessionID, "owner") != "active" {
			t.Fatal("Directory outage altered session state")
		}
		if got, _ := env.head(doc); got != g {
			t.Fatal("publication happened during outage")
		}
		// A closed Directory connection (real failure) maps the same way.
		closed := directoryapp.NewWithDB(func() *sql.DB {
			db := dcOpenDB(t, os.Getenv("HZY_CODOCS_DEPT_COLLAB_TEST_SOCKET"), "")
			db.Close()
			return db
		}(), dcTenant, "", "")
		lockClosed := func(ctx context.Context, dept string, uids []string) (map[string]DepartmentCollabRole, func(), error) {
			_, _, err := closed.LockEnterpriseCodocsDepartmentAccessBatch(ctx, dept, uids)
			var he httperror.Error
			if err != nil && !errors.As(err, &he) {
				err = httperror.New(503, "department_directory_unavailable", "Directory unavailable")
			}
			return nil, nil, err
		}
		_, _, err = env.a.RenewDepartmentCollaborationSession(env.ctx, env.cid(o.SessionID, ""), []string{"owner"}, true, lockClosed)
		env.wantStatus(err, 503, "department_directory_unavailable")
	})

	t.Run("personal transfer accepted into a department ends the personal session", func(t *testing.T) {
		doc := env.newDoc("owner", "private", "")
		env.share(doc, "writer", "write")
		id := env.hostID("owner", "convert-personal-"+doc)
		cmd := SnapshotCommand{UUID: doc, MarkdownSHA256: strings.Repeat("a", 64), MarkdownSize: 10}
		plan, err := env.a.PrepareDocumentSnapshot(env.ctx, id, cmd)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = env.a.PublishDocumentSnapshot(env.ctx, id, cmd, dcObjects(plan, false), env.verify); err != nil {
			t.Fatal(err)
		}
		s, err := env.a.OpenCollaborationSession(env.ctx, id, doc)
		if err != nil {
			t.Fatal(err)
		}
		var docID int64
		if err = env.docDB.QueryRow(`SELECT id FROM documents WHERE uuid = ?`, doc).Scan(&docID); err != nil {
			t.Fatal(err)
		}
		res, err := env.docDB.Exec(`INSERT INTO department_shares(document_id,from_dept_code,dept_code,shared_by,status) VALUES(?,'','D1','owner','pending')`, docID)
		if err != nil {
			t.Fatal(err)
		}
		shareID, _ := res.LastInsertId()
		role, release := env.role("mgr", "D1")
		defer release()
		decideID := EnterpriseDepartmentShareIdentity{Tenant: dcTenant, SourceDeployment: "host", TargetDeployment: dcDeployment, Actor: "mgr", Client: "enterprise.runtime", RequestID: "r", Key: "accept-" + doc, Department: "D1"}
		_, epochBefore := env.head(doc)
		if _, err = env.a.DecideEnterpriseDepartmentShare(env.ctx, decideID, shareID, "accept", func(context.Context, *sql.Tx, string, string) error {
			if !role.CanManage {
				return httperror.New(403, "department_manager_required", "Manager required")
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if env.sessionStatus(s.SessionID) != "revoked" {
			t.Fatal("personal session survived the department transfer")
		}
		if g, epochAfter := env.head(doc); g != 1 || epochAfter != epochBefore+1 {
			t.Fatalf("head generation=%d epoch %d -> %d (head must stay, epoch must advance)", g, epochBefore, epochAfter)
		}
		// The former personal session cannot be used: personal open now refuses, department open works.
		if _, err = env.a.OpenCollaborationSession(env.ctx, id, doc); err == nil {
			t.Fatal("personal open accepted a department document")
		}
		env.mustOpen("owner", doc)
	})
}

// snapshotPrefixFor recomputes the upload prefix of a command, for replays.
func snapshotPrefixFor(t *testing.T, id PersonalFolderCreationIdentity, cmd SnapshotCommand) string {
	t.Helper()
	_, _, prefix, err := snapshotFacts(id, cmd)
	if err != nil {
		t.Fatal(err)
	}
	return prefix
}

// TestMySQLDepartmentCollaborationPersonalPathUnchanged runs the personal
// path against a database WITHOUT the department migration (production has
// neither installed) and against one with it. Behaviour must be identical.
func TestMySQLDepartmentCollaborationPersonalPathUnchanged(t *testing.T) {
	env := newDeptCollabEnv(t)
	socket := os.Getenv("HZY_CODOCS_DEPT_COLLAB_TEST_SOCKET")
	legacyName := "dc_legacy_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	dcExec(t, env.admin, "CREATE DATABASE `"+legacyName+"`")
	t.Cleanup(func() { _, _ = env.admin.Exec("DROP DATABASE `" + legacyName + "`") })
	legacy := dcOpenDB(t, socket, legacyName)
	dcInstallCodocs(t, legacy, false)

	for name, db := range map[string]*sql.DB{"without department migration": legacy, "with department migration": env.docDB} {
		t.Run(name, func(t *testing.T) {
			a := &Adapter{db: db}
			owner := env.hostID("owner", "")
			doc := uuid.NewString()
			dcExec(t, db, `INSERT INTO documents (uuid,title,doc_type,oss_path,owner_uid) VALUES (?, 'P', 'private', 'legacy.md', 'owner')`, doc)
			dcExec(t, db, `INSERT INTO document_shares (document_id, owner_uid, shared_to_uid, permission) SELECT id, 'owner', 'writer', 'write' FROM documents WHERE uuid = ?`, doc)
			dcExec(t, db, `INSERT INTO document_shares (document_id, owner_uid, shared_to_uid, permission) SELECT id, 'owner', 'reader', 'read' FROM documents WHERE uuid = ?`, doc)
			cmd := SnapshotCommand{UUID: doc, MarkdownSHA256: strings.Repeat("a", 64), MarkdownSize: 10}
			id := owner
			id.Key = "personal-" + doc
			plan, err := a.PrepareDocumentSnapshot(env.ctx, id, cmd)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.PublishDocumentSnapshot(env.ctx, id, cmd, dcObjects(plan, false), env.verify); err != nil {
				t.Fatal(err)
			}
			// Readers cannot open; the opener's write access authorizes the session.
			reader := env.hostID("reader", "")
			if _, err = a.OpenCollaborationSession(env.ctx, reader, doc); err == nil {
				t.Fatal("read-only sharer opened a session")
			}
			s, err := a.OpenCollaborationSession(env.ctx, env.hostID("writer", ""), doc)
			if err != nil {
				t.Fatal(err)
			}
			if ttl := time.Until(s.ExpiresAt); ttl < 4*time.Minute || ttl > CollaborationSessionTTL+2*time.Second {
				t.Fatalf("personal ttl=%s", ttl)
			}
			peek, ok, err := a.PeekCollaborationTicket(env.ctx, dcTenant, dcDeployment, s.Ticket)
			if err != nil || (ok && peek.Policy != "private") {
				t.Fatalf("peek=%+v ok=%v err=%v", peek, ok, err)
			}
			admission, err := a.AdmitCollaborationTicket(env.ctx, dcTenant, dcDeployment, s.Ticket)
			if err != nil || admission.UserUID != "writer" || admission.Policy != "" || admission.DeptCode != "" {
				t.Fatalf("admission=%+v err=%v", admission, err)
			}
			cid := CollaborationIdentity{Tenant: dcTenant, Deployment: dcDeployment, SessionID: s.SessionID, RequestID: "r", Key: "k1"}
			info, err := a.ResolveCollaborationSessionInfo(env.ctx, cid)
			if err != nil || info.Policy != "private" || info.DeptCode != "" || info.Identity.Actor != "writer" {
				t.Fatalf("info=%+v err=%v", info, err)
			}
			id2, docUUID, epoch, _, err := a.ResolveCollaborationSession(env.ctx, cid)
			if err != nil || id2 != info.Identity || docUUID != doc || epoch != info.Epoch {
				t.Fatalf("resolve mismatch %+v %v", id2, err)
			}
			if expires, err := a.RenewCollaborationSession(env.ctx, cid); err != nil || time.Until(expires) < 4*time.Minute {
				t.Fatalf("renew=%s err=%v", expires, err)
			}
			// Collab publishes as the session opener; participants are recorded unfiltered.
			ccmd := SnapshotCommand{UUID: doc, Generation: 1, Epoch: epoch, MarkdownSHA256: strings.Repeat("c", 64), MarkdownSize: 20, YjsSHA256: strings.Repeat("d", 64), YjsSize: 30}
			cplan, err := a.PrepareDocumentSnapshot(env.ctx, info.Identity, ccmd)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.PublishDocumentSnapshot(env.ctx, info.Identity, ccmd, dcObjects(cplan, true), env.verify); err != nil {
				t.Fatal(err)
			}
			var recorded string
			if err = db.QueryRow(`SELECT participants_json FROM document_collaboration_publications WHERE session_id = ?`, s.SessionID).Scan(&recorded); err != nil || recorded != `["writer"]` {
				t.Fatalf("participants=%s err=%v", recorded, err)
			}
			// Personal revoke path: share removal ends the session and advances the epoch.
			var shareID string
			if err = db.QueryRow(`SELECT id FROM document_shares WHERE shared_to_uid = 'writer' AND document_id = (SELECT id FROM documents WHERE uuid = ?)`, doc).Scan(&shareID); err != nil {
				t.Fatal(err)
			}
			if _, err = a.deleteDocumentShare(env.ctx, doc, shareID, map[string]any{"current_user": "owner"}); err != nil {
				t.Fatal(err)
			}
			if _, err = a.RenewCollaborationSession(env.ctx, cid); err == nil {
				t.Fatal("revoked personal session renewed")
			}
			// Personal sessions never accept the department-only calls.
			if _, _, err = a.RenewDepartmentCollaborationSession(env.ctx, cid, nil, false, env.locker()); err == nil {
				t.Fatal("department renew accepted a personal session")
			}
		})
	}
}
