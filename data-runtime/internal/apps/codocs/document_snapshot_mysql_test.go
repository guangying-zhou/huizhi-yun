package codocs

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestDocumentSnapshotsMySQL(t *testing.T) {
	socket := os.Getenv("HZY_CODOCS_SNAPSHOT_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated disposable MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing nonisolated socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	exec := func(db *sql.DB, q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	name := "hzy_snapshot_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec(root, "CREATE DATABASE `"+name+"`")
	defer func() { exec(root, "DROP DATABASE `"+name+"`") }()
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	source, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"folders", "documents", "document_shares", "document_versions"} {
		ddl := regexp.MustCompile("(?ms)^CREATE TABLE `" + table + "` \\(.*?^\\) ENGINE=.*?;").FindString(string(source))
		if ddl == "" {
			t.Fatalf("missing canonical schema for %s", table)
		}
		exec(db, ddl)
	}
	// v1 update receipts (used when the v2 guard is checked after replay).
	receiptDDL := regexp.MustCompile(`(?ms)^CREATE TABLE IF NOT EXISTS service_command_receipt \(.*?^\) ENGINE=.*?;`).FindString(string(source))
	if receiptDDL == "" {
		t.Fatal("missing canonical schema for service_command_receipt")
	}
	exec(db, receiptDDL)
	source, err = os.ReadFile("../../../../codocs/docs/migrations/20260920_document_snapshots.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, ddl := range regexp.MustCompile(`(?ms)^CREATE TABLE .*?^\) ENGINE=InnoDB;`).FindAllString(string(source), -1) {
		exec(db, ddl)
	}
	sessionsDDL, err := os.ReadFile("../../../../codocs/docs/migrations/20260924_document_collaboration_sessions.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, ddl := range regexp.MustCompile(`(?ms)^CREATE TABLE .*?^\) ENGINE=InnoDB;`).FindAllString(string(sessionsDDL), -1) {
		exec(db, ddl)
	}
	a := &Adapter{db: db}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	id := updatePlanIdentity()
	newDoc := func() SnapshotCommand {
		u := uuid.NewString()
		exec(db, `INSERT INTO documents (uuid,title,doc_type,oss_path,owner_uid) VALUES (?, 'Title','private','legacy.md',?)`, u, id.Actor)
		return SnapshotCommand{UUID: u, MarkdownSHA256: strings.Repeat("a", 64), MarkdownSize: 10}
	}
	objectsFor := func(plan SnapshotPlan, paired bool) SnapshotObjects {
		base := plan.Prefix + strings.Repeat("b", 32)
		objects := SnapshotObjects{Markdown: SnapshotObject{Key: base + "/body.md", Version: "version-md"}}
		if paired {
			objects.Yjs = &SnapshotObject{Key: base + "/state.yjs", Version: "version-yjs"}
		}
		return objects
	}
	verify := func(context.Context, PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) error {
		return nil
	} // no real OSS in this suite
	status := func(err error, want int) {
		t.Helper()
		var e httperror.Error
		if !errors.As(err, &e) || e.Status != want {
			t.Fatalf("want status %d, got %v", want, err)
		}
	}
	prepare := func(identity PersonalFolderCreationIdentity, cmd SnapshotCommand) SnapshotPlan {
		t.Helper()
		p, e := a.PrepareDocumentSnapshot(ctx, identity, cmd)
		if e != nil {
			t.Fatal(e)
		}
		return p
	}
	assertHead := func(cmd SnapshotCommand, generation int64, published int) {
		t.Helper()
		var got int64
		if err := db.QueryRow(`SELECT generation FROM document_snapshot_heads WHERE tenant_code=? AND deployment_code=? AND document_uuid=?`, id.Tenant, id.Deployment, cmd.UUID).Scan(&got); err != nil || got != generation {
			t.Fatalf("head=%d, err=%v", got, err)
		}
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM document_snapshot_candidates WHERE document_uuid=? AND state='published'`, cmd.UUID).Scan(&count); err != nil || count != published {
			t.Fatalf("published=%d err=%v", count, err)
		}
		var path string
		var size int64
		if err := db.QueryRow(`SELECT oss_path, content_size FROM documents WHERE uuid=?`, cmd.UUID).Scan(&path, &size); err != nil || path != "legacy.md" || (generation == 0 && size != 0) {
			t.Fatalf("legacy path=%q size=%d err=%v", path, size, err)
		}
	}
	t.Run("v1 content writers and collaboration refuse a v2 document", func(t *testing.T) {
		cmd := newDoc()
		if onV2, e := documentOnSnapshotV2(ctx, db, cmd.UUID); e != nil || onV2 {
			t.Fatalf("before publish onV2=%v err=%v", onV2, e)
		}
		// Before publication a v1 content plan is still allowed (it may fail
		// later for unrelated reasons, but never with the v2 conflict).
		contentPlan := map[string]any{"title": "Title", "content_sha256": strings.Repeat("a", 64), "content_size": float64(10), "save_mode": "overwrite"}
		if _, e := a.PlanPersonalDocumentUpdate(ctx, id, cmd.UUID, contentPlan); e != nil && strings.Contains(e.Error(), "document_on_snapshot_v2") {
			t.Fatalf("v1 plan refused before publication: %v", e)
		}
		// A v1 content save committed before the switch...
		v1 := id
		v1.Key = "v1-before-v2"
		v1Payload := map[string]any{"title": "Title", "content_sha256": strings.Repeat("a", 64), "content_size": float64(10), "save_mode": "overwrite", "oss_version_id": "v1-version"}
		if _, e := a.CommitPersonalDocumentUpdate(ctx, v1, cmd.UUID, v1Payload); e != nil {
			t.Fatalf("v1 commit before publication: %v", e)
		}
		identity := id
		identity.Key = "guard-publish"
		if _, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(prepare(identity, cmd), false), verify); e != nil {
			t.Fatal(e)
		}
		if onV2, e := documentOnSnapshotV2(ctx, db, cmd.UUID); e != nil || !onV2 {
			t.Fatalf("after publish onV2=%v err=%v", onV2, e)
		}
		conflict := func(label string, e error) {
			t.Helper()
			var he httperror.Error
			if !errors.As(e, &he) || he.Status != 409 || he.Code != "document_on_snapshot_v2" {
				t.Fatalf("%s: want document_on_snapshot_v2, got %v", label, e)
			}
		}
		_, e := a.PlanPersonalDocumentUpdate(ctx, id, cmd.UUID, contentPlan)
		conflict("host v1 content plan", e)
		// ...still replays its stored success, while a new v1 content commit is refused.
		if replay, e := a.CommitPersonalDocumentUpdate(ctx, v1, cmd.UUID, v1Payload); e != nil || replay["updated"] != true {
			t.Fatalf("v1 replay after publication: %#v %v", replay, e)
		}
		v1New := id
		v1New.Key = "v1-after-v2"
		_, e = a.CommitPersonalDocumentUpdate(ctx, v1New, cmd.UUID, v1Payload)
		conflict("host v1 content commit", e)
		_, e = a.collaborationContext(ctx, map[string][]string{"uuid": {cmd.UUID}})
		conflict("collaboration context", e)
		_, e = a.createCollaborationVersion(ctx, map[string]any{"uuid": cmd.UUID, "actorUid": id.Actor, "ossVersionId": "v", "contentSize": float64(1), "contentSha256": strings.Repeat("c", 64)})
		conflict("collaboration version", e)
		// Title-only edits carry no content and are not refused by the guard.
		if _, e = a.PlanPersonalDocumentUpdate(ctx, id, cmd.UUID, map[string]any{"title": "Renamed"}); e != nil && strings.Contains(e.Error(), "document_on_snapshot_v2") {
			t.Fatalf("title-only plan refused: %v", e)
		}
		// A database without the snapshot tables has no v2 documents.
		bare := name + "_bare"
		exec(root, "CREATE DATABASE `"+bare+"`")
		defer exec(root, "DROP DATABASE `"+bare+"`")
		bareCfg := *cfg
		bareCfg.DBName = bare
		bareDB, e := sql.Open("mysql", bareCfg.FormatDSN())
		if e != nil {
			t.Fatal(e)
		}
		defer bareDB.Close()
		if onV2, e := documentOnSnapshotV2(ctx, bareDB, cmd.UUID); e != nil || onV2 {
			t.Fatalf("missing tables onV2=%v err=%v", onV2, e)
		}
	})
	t.Run("collaboration sessions cover only v2 documents and block Host saves while active", func(t *testing.T) {
		cmd := newDoc()
		_, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		var he httperror.Error
		if !errors.As(e, &he) || he.Code != "document_not_on_snapshot_v2" {
			t.Fatalf("open before v2: %v", e)
		}
		identity := id
		identity.Key = "collab-publish-1"
		if _, e = a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(prepare(identity, cmd), false), verify); e != nil {
			t.Fatal(e)
		}
		first, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		if e != nil || first.SessionID == "" || first.Generation != 1 || first.Reused {
			t.Fatalf("open: %+v %v", first, e)
		}
		again, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		if e != nil || again.SessionID != first.SessionID || !again.Reused || !again.ExpiresAt.After(time.Now()) {
			t.Fatalf("reopen: %+v %v", again, e)
		}
		// D3: a Host save is refused while the session is active.
		next := SnapshotCommand{UUID: cmd.UUID, Generation: 1, MarkdownSHA256: strings.Repeat("c", 64), MarkdownSize: 3}
		hostSave := id
		hostSave.Key = "host-save-during-collab"
		_, e = a.PrepareDocumentSnapshot(ctx, hostSave, next)
		if !errors.As(e, &he) || he.Code != "document_collaboration_active" {
			t.Fatalf("host prepare during collaboration: %v", e)
		}
		// Once the lease lapses, Host saves work again.
		exec(db, `UPDATE document_collaboration_sessions SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE session_id = ?`, first.SessionID)
		if _, e = a.PublishDocumentSnapshot(ctx, hostSave, next, objectsFor(prepare(hostSave, next), false), verify); e != nil {
			t.Fatalf("host save after lease: %v", e)
		}
		// A reader without write permission cannot open a session.
		exec(db, `INSERT INTO document_shares (document_id, owner_uid, shared_to_uid, permission) SELECT id, owner_uid, 'reader-1', 'read' FROM documents WHERE uuid = ?`, cmd.UUID)
		reader := id
		reader.Actor = "reader-1"
		_, e = a.OpenCollaborationSession(ctx, reader, cmd.UUID)
		if !errors.As(e, &he) || he.Status != 403 {
			t.Fatalf("reader open: %v", e)
		}
	})
	t.Run("collab publishes paired snapshots only through a live session", func(t *testing.T) {
		cmd := newDoc()
		host := id
		host.Key = "collab-flow-host"
		if _, e := a.PublishDocumentSnapshot(ctx, host, cmd, objectsFor(prepare(host, cmd), false), verify); e != nil {
			t.Fatal(e)
		}
		session, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		if e != nil {
			t.Fatal(e)
		}
		cid := CollaborationIdentity{Tenant: id.Tenant, Deployment: id.Deployment, SessionID: session.SessionID, RequestID: "req", Key: "collab-store-1"}
		collab, docUUID, epoch, expiresAt, e := a.ResolveCollaborationSession(ctx, cid)
		if e != nil || docUUID != cmd.UUID || collab.Actor != id.Actor || collab.Client != "collab.runtime" || epoch != session.Epoch || !expiresAt.Equal(session.ExpiresAt) {
			t.Fatalf("resolve: %+v %s %d %v", collab, docUUID, epoch, e)
		}
		var he httperror.Error
		unpaired := SnapshotCommand{UUID: cmd.UUID, Generation: 1, Epoch: epoch, MarkdownSHA256: strings.Repeat("d", 64), MarkdownSize: 4}
		if _, e = a.PrepareDocumentSnapshot(ctx, collab, unpaired); !errors.As(e, &he) || he.Code != "collaboration_snapshot_pair_required" {
			t.Fatalf("unpaired collab prepare: %v", e)
		}
		paired := unpaired
		paired.YjsSHA256, paired.YjsSize = strings.Repeat("e", 64), 9
		if _, e = a.SnapshotUploadPrefix(ctx, collab, paired); !errors.As(e, &he) || he.Code != "snapshot_not_prepared" {
			t.Fatalf("upload before prepare: %v", e)
		}
		plan := prepare(collab, paired)
		if prefix, e := a.SnapshotUploadPrefix(ctx, collab, paired); e != nil || prefix != plan.Prefix {
			t.Fatalf("upload prefix: %q %v", prefix, e)
		}
		other := paired
		other.MarkdownSize = 5
		if _, e = a.SnapshotUploadPrefix(ctx, collab, other); !errors.As(e, &he) || he.Code != "snapshot_key_conflict" {
			t.Fatalf("upload for another command under the same key: %v", e)
		}
		if _, e = a.PublishDocumentSnapshot(ctx, collab, paired, objectsFor(plan, true), verify); e != nil {
			t.Fatalf("collab publish: %v", e)
		}
		if _, e = a.SnapshotUploadPrefix(ctx, collab, paired); !errors.As(e, &he) || he.Code != "snapshot_candidate_not_prepared" {
			t.Fatalf("upload after publish: %v", e)
		}
		read, e := a.ReadDocumentSnapshot(ctx, id, cmd.UUID)
		if e != nil || read.Generation != 2 || read.Objects == nil || read.Objects.Yjs == nil {
			t.Fatalf("after collab publish: %+v %v", read, e)
		}
		if _, e = a.RenewCollaborationSession(ctx, cid); e != nil {
			t.Fatalf("renew: %v", e)
		}
		// A share change revokes the session and advances the epoch.
		exec(db, `INSERT INTO document_shares (document_id, owner_uid, shared_to_uid, permission) SELECT id, owner_uid, 'writer-2', 'write' FROM documents WHERE uuid = ?`, cmd.UUID)
		var shareID string
		if err := db.QueryRow(`SELECT s.id FROM document_shares s JOIN documents d ON d.id = s.document_id WHERE d.uuid = ? AND s.shared_to_uid = 'writer-2'`, cmd.UUID).Scan(&shareID); err != nil {
			t.Fatal(err)
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err = invalidateCollaboration(ctx, tx, cmd.UUID); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		late := paired
		late.Generation, late.MarkdownSHA256 = 2, strings.Repeat("f", 64)
		cid.Key = "collab-store-late"
		if _, _, _, _, e = a.ResolveCollaborationSession(ctx, cid); !errors.As(e, &he) || he.Code != "collaboration_session_invalid" {
			t.Fatalf("revoked session resolve: %v", e)
		}
		// Even with a stale resolved identity, publication checks the session under the lock.
		stale := collab
		stale.Key = "collab:" + session.SessionID + ":collab-store-late"
		late.Epoch = epoch
		if _, e = a.PrepareDocumentSnapshot(ctx, stale, late); !errors.As(e, &he) || (he.Code != "snapshot_generation_conflict" && he.Code != "collaboration_session_invalid") {
			t.Fatalf("late collab prepare: %v", e)
		}
		if _, e = a.RenewCollaborationSession(ctx, cid); e == nil {
			t.Fatal("renew of a revoked session succeeded")
		}
		// A new session opens at the new epoch; close ends it.
		next, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		if e != nil || next.SessionID == session.SessionID || next.Epoch != epoch+1 {
			t.Fatalf("reopen after revocation: %+v %v", next, e)
		}
		if e = a.CloseCollaborationSession(ctx, CollaborationIdentity{Tenant: id.Tenant, Deployment: id.Deployment, SessionID: next.SessionID}); e != nil {
			t.Fatal(e)
		}
		hostAfter := id
		hostAfter.Key = "collab-flow-host-after"
		after := SnapshotCommand{UUID: cmd.UUID, Generation: 2, Epoch: epoch + 1, MarkdownSHA256: strings.Repeat("a", 64), MarkdownSize: 1}
		if _, e = a.PrepareDocumentSnapshot(ctx, hostAfter, after); e != nil {
			t.Fatalf("host save after close: %v", e)
		}
	})
	t.Run("one-time admission tickets and recorded participants", func(t *testing.T) {
		cmd := newDoc()
		host := id
		host.Key = "ticket-host"
		if _, e := a.PublishDocumentSnapshot(ctx, host, cmd, objectsFor(prepare(host, cmd), false), verify); e != nil {
			t.Fatal(e)
		}
		session, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		if e != nil || len(session.Ticket) != 64 {
			t.Fatalf("open: %+v %v", session, e)
		}
		var stored int
		if err := db.QueryRow(`SELECT COUNT(*) FROM document_collaboration_tickets WHERE ticket_sha256 = ?`, ticketHash(session.Ticket)).Scan(&stored); err != nil || stored != 1 {
			t.Fatalf("ticket hash stored=%d err=%v", stored, err)
		}
		var plain int
		if err := db.QueryRow(`SELECT COUNT(*) FROM document_collaboration_tickets WHERE ticket_sha256 = ?`, session.Ticket).Scan(&plain); err != nil || plain != 0 {
			t.Fatal("plaintext ticket must never be stored")
		}
		admission, e := a.AdmitCollaborationTicket(ctx, id.Tenant, id.Deployment, session.Ticket)
		if e != nil || admission.SessionID != session.SessionID || admission.DocumentUUID != cmd.UUID || admission.UserUID != id.Actor || admission.Access != "write" || admission.Epoch != session.Epoch || !admission.ExpiresAt.Equal(session.ExpiresAt) {
			t.Fatalf("admit: %+v %v", admission, e)
		}
		var he httperror.Error
		if _, e = a.AdmitCollaborationTicket(ctx, id.Tenant, id.Deployment, session.Ticket); !errors.As(e, &he) || he.Code != "collaboration_ticket_invalid" {
			t.Fatalf("replayed ticket: %v", e)
		}
		if _, e = a.AdmitCollaborationTicket(ctx, id.Tenant, id.Deployment, strings.Repeat("0", 64)); !errors.As(e, &he) || he.Code != "collaboration_ticket_invalid" {
			t.Fatalf("unknown ticket: %v", e)
		}
		// Expired ticket.
		again, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		if e != nil {
			t.Fatal(e)
		}
		exec(db, `UPDATE document_collaboration_tickets SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE ticket_sha256 = ?`, ticketHash(again.Ticket))
		if _, e = a.AdmitCollaborationTicket(ctx, id.Tenant, id.Deployment, again.Ticket); !errors.As(e, &he) || he.Code != "collaboration_ticket_invalid" {
			t.Fatalf("expired ticket: %v", e)
		}
		// A collaborative publish records the verified participants.
		collab, _, epoch, _, e := a.ResolveCollaborationSession(ctx, CollaborationIdentity{Tenant: id.Tenant, Deployment: id.Deployment, SessionID: session.SessionID, Key: "ticket-store"})
		if e != nil {
			t.Fatal(e)
		}
		paired := SnapshotCommand{UUID: cmd.UUID, Generation: 1, Epoch: epoch, MarkdownSHA256: strings.Repeat("d", 64), MarkdownSize: 4, YjsSHA256: strings.Repeat("e", 64), YjsSize: 9}
		if _, e = a.SnapshotUploadPrefix(ctx, collab, paired); !errors.As(e, &he) || he.Code != "snapshot_not_prepared" {
			t.Fatalf("upload before prepare: %v", e)
		}
		plan := prepare(collab, paired)
		if prefix, e := a.SnapshotUploadPrefix(ctx, collab, paired); e != nil || prefix != plan.Prefix {
			t.Fatalf("upload prefix: %q %v", prefix, e)
		}
		other := paired
		other.MarkdownSize = 5
		if _, e = a.SnapshotUploadPrefix(ctx, collab, other); !errors.As(e, &he) || he.Code != "snapshot_key_conflict" {
			t.Fatalf("upload for another command under the same key: %v", e)
		}
		if _, e = a.PublishDocumentSnapshot(ctx, collab, paired, objectsFor(plan, true), verify); e != nil {
			t.Fatalf("collab publish: %v", e)
		}
		if _, e = a.SnapshotUploadPrefix(ctx, collab, paired); !errors.As(e, &he) || he.Code != "snapshot_candidate_not_prepared" {
			t.Fatalf("upload after publish: %v", e)
		}
		var participants string
		if err := db.QueryRow(`SELECT participants_json FROM document_collaboration_publications WHERE candidate_key = ?`, plan.Candidate).Scan(&participants); err != nil || participants != `["`+id.Actor+`"]` {
			t.Fatalf("participants=%s err=%v", participants, err)
		}
		// A ticket for a session that was revoked after issue is refused.
		fresh, e := a.OpenCollaborationSession(ctx, id, cmd.UUID)
		if e != nil {
			t.Fatal(e)
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err = invalidateCollaboration(ctx, tx, cmd.UUID); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		if _, e = a.AdmitCollaborationTicket(ctx, id.Tenant, id.Deployment, fresh.Ticket); !errors.As(e, &he) || he.Code != "collaboration_session_invalid" {
			t.Fatalf("ticket after revocation: %v", e)
		}
	})
	t.Run("project transfer takes a v2 document out of v2", func(t *testing.T) {
		cmd := newDoc()
		identity := id
		identity.Key = "transfer-publish"
		if _, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(prepare(identity, cmd), false), verify); e != nil {
			t.Fatal(e)
		}
		transfer := id
		transfer.Key = "transfer-key-01"
		if _, e := a.TransferPersonalDocumentToProject(ctx, transfer, cmd.UUID, map[string]any{"project_code": "PRJ1", "source_oss_path": "legacy.md", "new_oss_path": "codocs/projects/PRJ1/docs/Title.md"}); e != nil {
			t.Fatalf("transfer: %v", e)
		}
		if onV2, e := documentOnSnapshotV2(ctx, db, cmd.UUID); e != nil || onV2 {
			t.Fatalf("after transfer onV2=%v err=%v", onV2, e)
		}
		// The project document cannot re-enter v2, and its v2 history row stays.
		next := identity
		next.Key = "transfer-after"
		_, e := a.PrepareDocumentSnapshot(ctx, next, SnapshotCommand{UUID: cmd.UUID, MarkdownSHA256: cmd.MarkdownSHA256, MarkdownSize: cmd.MarkdownSize})
		status(e, 403)
		var rows int
		if err := db.QueryRow(`SELECT COUNT(*) FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.uuid=? AND v.object_key IS NOT NULL`, cmd.UUID).Scan(&rows); err != nil || rows != 1 {
			t.Fatalf("v2 history rows=%d err=%v", rows, err)
		}
	})
	t.Run("authorized reader follows only published exact references", func(t *testing.T) {
		cmd := newDoc()
		legacy, e := a.ReadDocumentSnapshot(ctx, id, cmd.UUID)
		if e != nil || legacy.Generation != 0 || legacy.LegacyPath != "legacy.md" || legacy.Objects != nil {
			t.Fatalf("legacy read=%+v err=%v", legacy, e)
		}
		identity := id
		identity.Key = "read-reference"
		p := prepare(identity, cmd)
		objects := objectsFor(p, false)
		if _, e = a.PublishDocumentSnapshot(ctx, identity, cmd, objects, verify); e != nil {
			t.Fatal(e)
		}
		read, e := a.ReadDocumentSnapshot(ctx, id, cmd.UUID)
		if e != nil || read.Generation != 1 || read.LegacyPath != "" || read.Objects == nil || read.Objects.Markdown != objects.Markdown {
			t.Fatalf("published read=%+v err=%v", read, e)
		}
		var historyKey, historyVersion, historySHA string
		var historyCount int
		if err := db.QueryRow(`SELECT COUNT(*), MAX(object_key), MAX(oss_version_id), MAX(content_sha256) FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE d.uuid = ?`, cmd.UUID).Scan(&historyCount, &historyKey, &historyVersion, &historySHA); err != nil ||
			historyCount != 1 || historyKey != objects.Markdown.Key || historyVersion != objects.Markdown.Version || historySHA != cmd.MarkdownSHA256 {
			t.Fatalf("history row count=%d key=%q version=%q sha=%q err=%v", historyCount, historyKey, historyVersion, historySHA, err)
		}
		exec(db, `UPDATE document_snapshot_heads SET published_candidate=? WHERE document_uuid=?`, strings.Repeat("f", 64), cmd.UUID)
		_, e = a.ReadDocumentSnapshot(ctx, id, cmd.UUID)
		status(e, 503)
		exec(db, `UPDATE document_snapshot_heads SET published_candidate=? WHERE document_uuid=?`, p.Candidate, cmd.UUID)
		var docID int64
		if e = db.QueryRow(`SELECT id FROM documents WHERE uuid=?`, cmd.UUID).Scan(&docID); e != nil {
			t.Fatal(e)
		}
		exec(db, `INSERT INTO document_shares (document_id,owner_uid,shared_to_uid,permission) VALUES (?,?,?,'read')`, docID, id.Actor, "reader")
		shared := id
		shared.Actor = "reader"
		if read, e = a.ReadDocumentSnapshot(ctx, shared, cmd.UUID); e != nil || read.Generation != 1 {
			t.Fatalf("shared read=%+v err=%v", read, e)
		}
		exec(db, `DELETE FROM document_shares WHERE document_id=?`, docID)
		_, e = a.ReadDocumentSnapshot(ctx, shared, cmd.UUID)
		status(e, 404)
	})
	t.Run("competing writers and replay after later generation", func(t *testing.T) {
		cmd := newDoc()
		one := id
		one.Key = "first"
		two := id
		two.Key = "second"
		p1 := prepare(one, cmd)
		p2 := prepare(two, cmd)
		barrier := make(chan struct{})
		arrived := make(chan struct{}, 2)
		gate := func(context.Context, PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) error {
			arrived <- struct{}{}
			select {
			case <-barrier:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		type outcome struct {
			plan SnapshotPlan
			err  error
			id   PersonalFolderCreationIdentity
		}
		results := make(chan outcome, 2)
		for _, input := range []struct {
			id PersonalFolderCreationIdentity
			p  SnapshotPlan
		}{{one, p1}, {two, p2}} {
			go func(identity PersonalFolderCreationIdentity, p SnapshotPlan) {
				r, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(p, false), gate)
				results <- outcome{r, e, identity}
			}(input.id, input.p)
		}
		for range 2 {
			select {
			case <-arrived:
			case <-ctx.Done():
				t.Fatal("writers failed to reach verification barrier")
			}
		}
		close(barrier)
		x, y := <-results, <-results
		if x.err != nil {
			x, y = y, x
		}
		if x.err != nil {
			t.Fatal(x.err)
		}
		status(y.err, 409)
		assertHead(cmd, 1, 1)
		// Tab B submits its still-open draft only after tab A has committed.
		// A fresh command key cannot turn its old read generation into a write.
		lateTab := id
		lateTab.Key = "late-tab-from-generation-zero"
		_, e := a.PrepareDocumentSnapshot(ctx, lateTab, cmd)
		status(e, 409)
		// The losing prepared candidate is equally stale on a later retry.
		_, e = a.PrepareDocumentSnapshot(ctx, y.id, cmd)
		status(e, 409)
		next := cmd
		next.Generation = 1
		next.MarkdownSHA256 = strings.Repeat("c", 64)
		nextID := id
		nextID.Key = "third"
		p := prepare(nextID, next)
		if _, e = a.PublishDocumentSnapshot(ctx, nextID, next, objectsFor(p, false), verify); e != nil {
			t.Fatal(e)
		}
		// Successful retry must not need a verifier or inspect supplied objects.
		r, e := a.PublishDocumentSnapshot(ctx, x.id, cmd, SnapshotObjects{}, nil)
		if e != nil || !r.Replayed || r.Generation != 1 {
			t.Fatalf("replay=%+v err=%v", r, e)
		}
		assertHead(cmd, 2, 2)
		changed := cmd
		changed.MarkdownSize++
		_, e = a.PrepareDocumentSnapshot(ctx, x.id, changed)
		status(e, 409)
	})
	t.Run("storage failure and late SQL failure leave head and receipt unchanged", func(t *testing.T) {
		cmd := newDoc()
		identity := id
		identity.Key = "failure"
		p := prepare(identity, cmd)
		objects := objectsFor(p, false)
		_, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objects, func(context.Context, PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) error {
			return errors.New("storage")
		})
		status(e, 503)
		assertHead(cmd, 0, 0)
		exec(db, `CREATE TRIGGER snapshot_fail_update BEFORE UPDATE ON documents FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected metadata failure'`)
		_, e = a.PublishDocumentSnapshot(ctx, identity, cmd, objects, verify)
		if e == nil {
			t.Fatal("expected SQL failure")
		}
		assertHead(cmd, 0, 0)
		exec(db, `DROP TRIGGER snapshot_fail_update`)
		if _, e = a.PublishDocumentSnapshot(ctx, identity, cmd, objects, verify); e != nil {
			t.Fatal(e)
		}
		assertHead(cmd, 1, 1)
	})
	t.Run("revoked share during storage verification", func(t *testing.T) {
		cmd := newDoc()
		var docID int64
		if e := db.QueryRow(`SELECT id FROM documents WHERE uuid=?`, cmd.UUID).Scan(&docID); e != nil {
			t.Fatal(e)
		}
		exec(db, `INSERT INTO document_shares (document_id,owner_uid,shared_to_uid,permission) VALUES (?,?,?,'write')`, docID, id.Actor, "collaborator")
		identity := id
		identity.Actor = "collaborator"
		identity.Key = "revoke"
		p := prepare(identity, cmd)
		_, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(p, false), func(context.Context, PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) error {
			exec(db, `DELETE FROM document_shares WHERE document_id=?`, docID)
			return nil
		})
		status(e, 403)
		assertHead(cmd, 0, 0)
	})
	t.Run("epoch change and paired references", func(t *testing.T) {
		cmd := newDoc()
		cmd.YjsSHA256 = strings.Repeat("d", 64)
		cmd.YjsSize = 20
		identity := id
		identity.Key = "paired"
		p := prepare(identity, cmd)
		_, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(p, true), func(context.Context, PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) error {
			exec(db, `UPDATE document_snapshot_heads SET collaboration_epoch=1 WHERE document_uuid=?`, cmd.UUID)
			return nil
		})
		status(e, 409)
		assertHead(cmd, 0, 0)
		cmd.Epoch = 1
		identity.Key = "paired-epoch-1"
		p = prepare(identity, cmd)
		if _, e = a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(p, true), verify); e != nil {
			t.Fatal(e)
		}
		assertHead(cmd, 1, 1)
		var pair string
		if e = db.QueryRow(`SELECT objects_json FROM document_snapshot_heads WHERE document_uuid=?`, cmd.UUID).Scan(&pair); e != nil || !strings.Contains(pair, "version-yjs") || !strings.Contains(pair, "version-md") {
			t.Fatalf("pair=%s err=%v", pair, e)
		}
	})
	t.Run("same command concurrency creates one version", func(t *testing.T) {
		cmd := newDoc()
		identity := id
		identity.Key = "same-command"
		p := prepare(identity, cmd)
		type result struct {
			p SnapshotPlan
			e error
		}
		results := make(chan result, 2)
		for range 2 {
			go func() {
				p, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(p, false), verify)
				results <- result{p, e}
			}()
		}
		x, y := <-results, <-results
		if x.e != nil || y.e != nil || x.p.Replayed == y.p.Replayed || x.p.Generation != 1 || y.p.Generation != 1 {
			t.Fatalf("same command results: %+v %+v", x, y)
		}
		assertHead(cmd, 1, 1)
		// Replay is still subject to current authorization/state.
		exec(db, `UPDATE documents SET readonly_flag=1 WHERE uuid=?`, cmd.UUID)
		_, e := a.PublishDocumentSnapshot(ctx, identity, cmd, SnapshotObjects{}, nil)
		status(e, 403)
	})
	t.Run("schema rejects incomplete publication facts", func(t *testing.T) {
		cmd := newDoc()
		identity := id
		identity.Key = "schema"
		p := prepare(identity, cmd)
		for _, q := range []string{`UPDATE document_snapshot_heads SET generation=1 WHERE document_uuid=?`, `UPDATE document_snapshot_candidates SET state='published' WHERE document_uuid=?`, `UPDATE document_snapshot_heads SET collaboration_epoch=-1 WHERE document_uuid=?`} {
			if _, e := db.Exec(q, cmd.UUID); e == nil {
				t.Fatal("schema accepted invalid publication")
			}
		}
		_, e := a.PublishDocumentSnapshot(ctx, identity, cmd, objectsFor(p, false), nil)
		status(e, 503)
		assertHead(cmd, 0, 0)
	})
	t.Run("missing candidate cannot publish and identity scopes do not reuse receipts", func(t *testing.T) {
		cmd := newDoc()
		identity := id
		identity.Key = "isolation"
		prepare(identity, cmd)
		for _, mutate := range []func(*PersonalFolderCreationIdentity){func(i *PersonalFolderCreationIdentity) { i.Tenant = "other" }, func(i *PersonalFolderCreationIdentity) { i.Deployment = "other" }, func(i *PersonalFolderCreationIdentity) { i.Key = "other" }} {
			other := identity
			mutate(&other)
			_, e := a.PublishDocumentSnapshot(ctx, other, cmd, SnapshotObjects{}, nil)
			status(e, 409)
		}
		assertHead(cmd, 0, 0)
	})
}
