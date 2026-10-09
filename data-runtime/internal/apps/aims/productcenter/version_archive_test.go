package productcenter

import (
	"context"
	"database/sql"
	"testing"
)

func exerciseVersionArchive(t *testing.T, db *sql.DB, versionID, recordID int64) {
	t.Helper()
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-ACCEPT", "publisher", action)
		p.Resource = "product_versions"
		return p
	}
	detail, err := ReadProductCenterVersion(ctx, db, "P-ACCEPT", "publisher", permit("view"), versionID)
	if err != nil {
		t.Fatal(err)
	}
	var hash string
	if err = db.QueryRow(`SELECT content_hash FROM product_release_records WHERE id=?`, recordID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	input := ProductVersionArchiveInput{VersionID: versionID, ExpectedRevision: detail.WorkspaceRevision, ExpectedVersionRevision: detail.Revision, ExpectedScopeRevision: detail.ScopeRevision, Reason: "版本停止日常维护，保留历史"}
	identity := CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "publisher", Action: "product_versions:archive", IdempotencyKey: "archive"}
	run := func() (CommandResult, error) {
		return ArchiveProductVersion(ctx, db, identity, permit("archive"), input)
	}
	_, err = ArchiveProductVersion(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	input.ExpectedScopeRevision++
	_, err = run()
	requireProductRule(t, err, "product_version_revision_conflict")
	input.ExpectedScopeRevision--
	if _, err = db.Exec(`CREATE TRIGGER fail_archive BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='archive audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("failed audit archived version")
	}
	var state string
	if err = db.QueryRow(`SELECT status FROM product_versions WHERE id=?`, versionID).Scan(&state); err != nil || state != "released" {
		t.Fatalf("rollback %s %v", state, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_archive`); err != nil {
		t.Fatal(err)
	}
	saved, err := run()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run()
	if err != nil || !replay.Replayed || saved.ReceiptID != replay.ReceiptID {
		t.Fatalf("archive replay %+v %v", replay, err)
	}
	after, err := ReadProductCenterVersion(ctx, db, "P-ACCEPT", "publisher", permit("view"), versionID)
	if err != nil || after.Status != "archived" || after.CurrentReleaseRecordID == nil || *after.CurrentReleaseRecordID != recordID || after.ScopeRevision != detail.ScopeRevision || after.Revision != detail.Revision+1 {
		t.Fatalf("archive facts %+v %v", after, err)
	}
	record, err := ReadProductVersionRelease(ctx, db, "P-ACCEPT", "publisher", permit("view"), versionID, recordID)
	if err != nil || record.ContentHash != hash || record.Withdrawn || record.Superseded {
		t.Fatalf("archive changed publication %+v %v", record, err)
	}
}
