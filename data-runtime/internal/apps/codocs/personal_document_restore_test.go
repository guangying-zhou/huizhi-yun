package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func restoreIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "t1", Deployment: "d1", Actor: "u1", Client: "enterprise.runtime", RequestID: "r1", Key: "restore-key"}
}
func restoreRows(status int64, owner, kind, path string, readonly ...int64) *sqlmock.Rows {
	flag := int64(0)
	if len(readonly) > 0 {
		flag = readonly[0]
	}
	return sqlmock.NewRows([]string{"id", "uuid", "title", "doc_type", "owner_uid", "folder_id", "oss_path", "status", "deleted_at", "updated_at", "readonly_flag"}).AddRow(9, "doc-restore", "Old", kind, owner, nil, path, status, "2026-01-01 00:00:00", "2026-01-01 00:00:00", flag)
}
func restoreHTTP(t *testing.T, err error, status int) {
	t.Helper()
	var e httperror.Error
	if err == nil || !errors.As(err, &e) || e.Status != status {
		t.Fatalf("err=%v want %d", err, status)
	}
}

func TestPlanPersonalDocumentRestoreUsesStableLegacyPathAndRejectsPayloadInjection(t *testing.T) {
	plan, err := personalRestorePlan(map[string]any{"uuid": "doc-restore", "title": "Old", "doc_type": "private", "owner_uid": "u1", "folder_id": nil, "oss_path": "recycle.bin/old.md", "status": int64(0), "deleted_at": "x", "updated_at": "y"}, "")
	if err != nil || !strings.HasPrefix(plan["target_path"].(string), "codocs/document-restores/doc-restore/") {
		t.Fatalf("plan=%#v err=%v", plan, err)
	}
	for _, payload := range []map[string]any{{"owner_uid": "x"}, {"oss_path": "x"}, {"folder_id": 7}, {"state_sha256": "bad"}} {
		restoreHTTP(t, ValidatePersonalDocumentRestore(payload, true), 400)
	}
}

func TestRestorePlanRejectsUnsafePathsAndSupportsAllPersonalKinds(t *testing.T) {
	doc := map[string]any{"uuid": "doc-restore", "title": "Old", "owner_uid": "u1", "status": int64(0)}
	for _, kind := range []string{"private", "slide", "worklog", "weekly-report"} {
		doc["doc_type"], doc["oss_path"] = kind, "codocs/original.md"
		plan, err := personalRestorePlan(doc, "Renamed")
		if err != nil || plan["source_path"] != plan["target_path"] || plan["title"] != "Renamed" {
			t.Fatalf("%s plan=%v err=%v", kind, plan, err)
		}
	}
	for _, path := range []string{"", "https://storage.example/doc.md", "other/doc.md", "codocs/../secret.md", "codocs//doc.md", "recycle.bin/./doc.md", "codocs/dir\\doc.md", "codocs/doc\n.md"} {
		doc["oss_path"] = path
		_, err := personalRestorePlan(doc, "")
		restoreHTTP(t, err, 409)
	}
}

func TestRestorePersonalDocumentWritesReceiptAndUpdatesOnlyRestoreFields(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := restoreIdentity()
	doc := map[string]any{"uuid": "doc-restore", "title": "Old", "doc_type": "private", "owner_uid": "u1", "folder_id": nil, "oss_path": "codocs/document-creations/doc-restore/body.md", "status": int64(0), "deleted_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00"}
	plan, err := personalRestorePlan(doc, "")
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(restoreRows(0, "u1", "private", "codocs/document-creations/doc-restore/body.md"))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs("Old", "u1", "doc-restore", "private").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectExec(`UPDATE documents SET status = 1, deleted_at = NULL, title = \?, oss_path = \?, updated_at = NOW\(\) WHERE uuid = \?`).WithArgs("Old", "codocs/document-creations/doc-restore/body.md", "doc-restore").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	result, err := (&Adapter{db: db}).RestorePersonalDocument(context.Background(), id, "doc-restore", map[string]any{"state_sha256": plan["state_sha256"]})
	if err != nil || result["restored"] != true {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRestorePersonalDocumentRejectsReadonlyTypeAndActiveState(t *testing.T) {
	for name, row := range map[string]struct {
		status   int64
		kind     string
		readonly int64
	}{"readonly": {0, "private", 1}, "nonpersonal": {0, "department", 0}, "active": {1, "private", 0}} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			path := "codocs/document-creations/doc-restore/body.md"
			mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(restoreRows(row.status, "u1", row.kind, path, row.readonly))
			plan, planErr := personalRestorePlan(map[string]any{"uuid": "doc-restore", "title": "Old", "doc_type": row.kind, "owner_uid": "u1", "folder_id": nil, "oss_path": path, "status": row.status, "deleted_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00"}, "")
			if planErr != nil && name != "nonpersonal" {
				t.Fatal(planErr)
			}
			if name == "active" {
				expectRecycleReceiptMissing(mock)
				mock.ExpectExec(`INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
			}
			mock.ExpectRollback()
			state := strings.Repeat("a", 64)
			if plan != nil {
				state = plan["state_sha256"].(string)
			}
			_, err = (&Adapter{db: db}).RestorePersonalDocument(context.Background(), restoreIdentity(), "doc-restore", map[string]any{"state_sha256": state})
			want := 403
			if name == "active" {
				want = 409
			}
			restoreHTTP(t, err, want)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRestorePersonalDocumentReplayAfterAnotherDeletionAndChangedIntent(t *testing.T) {
	id := restoreIdentity()
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-documents.restore.v1", id.Tenant, id.Deployment, id.Actor, id.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	op := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	emptyTitle := sha256.Sum256(nil)
	digest, err := io.ValidateAndDigestCommand(map[string]any{"uuid": "doc-restore", "actor": id.Actor, "new_title_sha256": hex.EncodeToString(emptyTitle[:])})
	if err != nil {
		t.Fatal(err)
	}
	for _, changed := range []bool{false, true} {
		t.Run(fmt.Sprintf("changed intent=%v", changed), func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			// The document is deleted again, after the successful original restore.
			mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(restoreRows(0, "u1", "private", "codocs/new-location.md"))
			mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*FOR UPDATE`).WithArgs(id.Tenant, id.Deployment, id.Deployment, "codocs", "codocs", "codocs.personal-documents.restore.v1", key).WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).AddRow("receipt-1", op, "codocs:personal-documents:edit", "codocs-personal-restore.v1", digest, "succeeded", "document", "doc-restore", 200, strings.Repeat("a", 64), 1))
			payload := map[string]any{"state_sha256": strings.Repeat("b", 64)}
			if changed {
				payload["new_title"] = "Different intent"
				mock.ExpectRollback()
			} else {
				mock.ExpectExec(`UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			}
			result, err := (&Adapter{db: db}).RestorePersonalDocument(context.Background(), id, "doc-restore", payload)
			if changed {
				restoreHTTP(t, err, 409)
			} else if err != nil || result["replayed"] != true || result["restored"] != true {
				t.Fatalf("result=%v err=%v", result, err)
			}
			// No document UPDATE, folder lookup or title check is expected on replay.
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRestoreLegacyPathAndURLTitleRemainRecoverable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	path := "recycle.bin/legacy.md"
	title := "Reference https://example.org/design"
	doc := map[string]any{"uuid": "doc-restore", "title": "Old", "doc_type": "slide", "owner_uid": "u1", "folder_id": nil, "oss_path": path, "status": int64(0), "deleted_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00"}
	plan, err := personalRestorePlan(doc, title)
	if err != nil {
		t.Fatal(err)
	}
	if plan["target_path"] != "codocs/document-restores/doc-restore/"+plan["state_sha256"].(string)+".md" {
		t.Fatalf("unexpected target: %v", plan)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(restoreRows(0, "u1", "slide", path))
	expectRecycleReceiptMissing(mock)
	mock.ExpectExec(`INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs(title, "u1", "doc-restore", "slide").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectExec(`UPDATE documents SET status = 1, deleted_at = NULL, title = \?, oss_path = \?, updated_at = NOW\(\) WHERE uuid = \?`).WithArgs(title, plan["target_path"], "doc-restore").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	_, err = (&Adapter{db: db}).RestorePersonalDocument(context.Background(), restoreIdentity(), "doc-restore", map[string]any{"new_title": title, "state_sha256": plan["state_sha256"]})
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	doc["title"] = title
	doc["oss_path"] = "codocs/stable.md"
	plan, err = personalRestorePlan(doc, "")
	if err != nil || plan["title"] != title || plan["target_path"] != doc["oss_path"] {
		t.Fatalf("URL-title stable plan=%v err=%v", plan, err)
	}
}

func TestRestorePersonalDocumentTitleConflictRollsBack(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := restoreIdentity()
	doc := map[string]any{"uuid": "doc-restore", "title": "Old", "doc_type": "private", "owner_uid": "u1", "folder_id": nil, "oss_path": "codocs/document-creations/doc-restore/body.md", "status": int64(0), "deleted_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00"}
	plan, _ := personalRestorePlan(doc, "")
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(restoreRows(0, "u1", "private", doc["oss_path"].(string)))
	expectRecycleReceiptMissing(mock)
	mock.ExpectExec(`INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs("Old", "u1", "doc-restore", "private").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).RestorePersonalDocument(context.Background(), id, "doc-restore", map[string]any{"state_sha256": plan["state_sha256"]})
	restoreHTTP(t, err, 409)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRestorePersonalDocumentStateChangedAndUpdateFailureRollback(t *testing.T) {
	id := restoreIdentity()
	doc := map[string]any{"uuid": "doc-restore", "title": "Old", "doc_type": "private", "owner_uid": "u1", "folder_id": nil, "oss_path": "codocs/document-creations/doc-restore/body.md", "status": int64(0), "deleted_at": "2026-01-01 00:00:00", "updated_at": "2026-01-01 00:00:00"}
	plan, _ := personalRestorePlan(doc, "")
	for name, state := range map[string]string{"state changed": strings.Repeat("b", 64), "update failed": plan["state_sha256"].(string)} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(restoreRows(0, "u1", "private", doc["oss_path"].(string)))
			expectRecycleReceiptMissing(mock)
			mock.ExpectExec(`INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
			if name == "update failed" {
				mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE .*folder_id IS NULL`).WithArgs("Old", "u1", "doc-restore", "private").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
				mock.ExpectExec(`UPDATE documents SET status = 1`).WillReturnError(errors.New("write failed"))
			}
			mock.ExpectRollback()
			_, err = (&Adapter{db: db}).RestorePersonalDocument(context.Background(), id, "doc-restore", map[string]any{"state_sha256": state})
			if name == "state changed" {
				restoreHTTP(t, err, 409)
			} else if err == nil || err.Error() != "write failed" {
				t.Fatalf("update error=%v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRestorePersonalDocumentRejectsFolderOwnerAndRevokedShare(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := restoreIdentity()
	id.Actor = "u1"
	folderDoc := map[string]any{"uuid": "doc-restore", "title": "Old", "doc_type": "private", "owner_uid": "u1", "folder_id": int64(7), "oss_path": "codocs/document-creations/doc-restore/body.md", "status": int64(0), "deleted_at": "x", "updated_at": "y"}
	folderPlan, _ := personalRestorePlan(folderDoc, "")
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(sqlmock.NewRows([]string{"id", "uuid", "title", "doc_type", "owner_uid", "folder_id", "oss_path", "status", "deleted_at", "updated_at", "readonly_flag"}).AddRow(9, "doc-restore", "Old", "private", "u1", 7, "codocs/document-creations/doc-restore/body.md", 0, "x", "y", 0))
	expectRecycleReceiptMissing(mock)
	mock.ExpectExec(`INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Other", "private", "other", nil, nil, nil))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).RestorePersonalDocument(context.Background(), id, "doc-restore", map[string]any{"state_sha256": folderPlan["state_sha256"]})
	restoreHTTP(t, err, 403)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	db2, mock2, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	mock2.ExpectBegin()
	mock2.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs("doc-restore").WillReturnRows(restoreRows(0, "other", "private", "codocs/document-creations/doc-restore/body.md"))
	mock2.ExpectQuery(`SELECT permission\s+FROM document_shares.*FOR UPDATE`).WithArgs(int64(9), "u1").WillReturnError(sql.ErrNoRows)
	mock2.ExpectRollback()
	_, err = (&Adapter{db: db2}).RestorePersonalDocument(context.Background(), id, "doc-restore", map[string]any{"state_sha256": strings.Repeat("a", 64)})
	restoreHTTP(t, err, 403)
	if err := mock2.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
