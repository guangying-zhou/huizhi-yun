package codocs

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const departmentRestoreUUID = "00000000-0000-4000-8000-000000000017"

func departmentDeletedRows(folder any, path string, status int) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "uuid", "title", "owner_uid", "doc_type", "dept_code", "project_code", "folder_id", "oss_path", "status", "deleted_at", "updated_at"}).
		AddRow(17, departmentRestoreUUID, "Original", "author", "department", "D1", nil, folder, path, status, "2026-09-29 00:00:00", "2026-09-29 00:00:00")
}

func TestDepartmentRestorePlanRejectsUnsafePathsAndBindsFolderResolution(t *testing.T) {
	base := map[string]any{"uuid": departmentRestoreUUID, "owner_uid": "author", "doc_type": "department", "dept_code": "D1", "folder_id": int64(9), "title": "Original", "status": int64(0), "deleted_at": "a", "updated_at": "b", "oss_path": "recycle.bin/original.md"}
	first, err := departmentRestorePlan(base, 9, "Renamed")
	if err != nil || first["target_path"] != "codocs/document-restores/"+departmentRestoreUUID+"/"+first["state_sha256"].(string)+".md" {
		t.Fatalf("plan=%v err=%v", first, err)
	}
	root, err := departmentRestorePlan(base, 0, "Renamed")
	if err != nil || root["state_sha256"] == first["state_sha256"] || root["folder_id"] != nil {
		t.Fatalf("folder fallback not bound to hash: %v %v", root, err)
	}
	base["oss_path"] = "codocs/../other.md"
	if _, err := departmentRestorePlan(base, 9, "Renamed"); err == nil {
		t.Fatal("unsafe restore source accepted")
	}
}

func TestDepartmentRestorePlanDeletedOriginalFolderUsesRoot(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1`).WillReturnRows(departmentDeletedRows(9, "codocs/departments/D1/original.md", 0))
	mock.ExpectQuery(`SELECT MAX\(generation\) FROM document_snapshot_heads WHERE document_uuid = \?`).WillReturnRows(sqlmock.NewRows([]string{"MAX(generation)"}).AddRow(nil))
	mock.ExpectQuery(`SELECT folder_type,dept_code,project_code FROM folders WHERE id=\?`).WithArgs(int64(9)).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	plan, err := (&Adapter{db: db}).PlanEnterpriseDepartmentDocumentRestore(context.Background(), departmentFolderIdentity(), departmentRestoreUUID, map[string]any{}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err != nil || plan["folder_id"] != nil || plan["deleted"] != true {
		t.Fatalf("plan=%v err=%v", plan, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDepartmentRestoreCommitRechecksManagerBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).RestoreEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), departmentRestoreUUID, map[string]any{"state_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, func(context.Context, *sql.Tx, string, string) error { return sql.ErrNoRows })
	if err == nil {
		t.Fatal("revoked manager restored document")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDepartmentRestoreCommitRejectsStaleStateBeforeUpdate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WillReturnRows(departmentDeletedRows(nil, "codocs/departments/D1/original.md", 0))
	mock.ExpectQuery(`SELECT MAX\(generation\) FROM document_snapshot_heads WHERE document_uuid = \?`).WillReturnRows(sqlmock.NewRows([]string{"MAX(generation)"}).AddRow(nil))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).RestoreEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), departmentRestoreUUID, map[string]any{"state_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err == nil {
		t.Fatal("stale restore plan was accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDepartmentRestoreCommitUsesPlanHashAndReceiptInSameTransaction(t *testing.T) {
	doc := map[string]any{
		"id": int64(17), "uuid": departmentRestoreUUID, "title": "Original", "owner_uid": "author", "doc_type": "department", "dept_code": "D1", "project_code": nil,
		"folder_id": nil, "oss_path": "codocs/departments/D1/original.md", "status": int64(0), "deleted_at": "2026-09-29 00:00:00", "updated_at": "2026-09-29 00:00:00",
	}
	plan, err := departmentRestorePlan(doc, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT \* FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE`).WillReturnRows(departmentDeletedRows(nil, "codocs/departments/D1/original.md", 0))
	mock.ExpectQuery(`SELECT MAX\(generation\) FROM document_snapshot_heads WHERE document_uuid = \?`).WillReturnRows(sqlmock.NewRows([]string{"MAX(generation)"}).AddRow(nil))
	mock.ExpectQuery(`(?s)SELECT.*FROM service_command_receipt.*WHERE tenant_code = \?.*FOR UPDATE`).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents`).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`(?s)UPDATE documents SET status=1,deleted_at=NULL,title=\?,folder_id=\?,oss_path=\?,updated_at=NOW\(\)`).
		WithArgs("Original", nil, "codocs/departments/D1/original.md", departmentRestoreUUID, "D1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE service_command_receipt.*SET status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).RestoreEnterpriseDepartmentDocument(context.Background(), departmentFolderIdentity(), departmentRestoreUUID, map[string]any{"state_sha256": plan["state_sha256"]}, func(context.Context, *sql.Tx, string, string) error { return nil })
	if err != nil || got["restored"] != true {
		t.Fatalf("result=%v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRestorePlanSnapshotBackedBindsGenerationAndKeepsV1Hash(t *testing.T) {
	dept := map[string]any{"uuid": departmentRestoreUUID, "owner_uid": "author", "doc_type": "department", "dept_code": "D1", "folder_id": int64(9), "title": "Original", "status": int64(0), "deleted_at": "a", "updated_at": "b", "oss_path": "codocs/departments/D1/original.md"}
	v1, err := departmentRestorePlan(dept, 9, "")
	if err != nil || v1["snapshot_backed"] != false {
		t.Fatalf("v1 plan=%v err=%v", v1, err)
	}
	dept["snapshot_generation"] = int64(2)
	v2, err := departmentRestorePlan(dept, 9, "")
	if err != nil || v2["snapshot_backed"] != true || v2["state_sha256"] == v1["state_sha256"] || v2["target_path"] != dept["oss_path"] {
		t.Fatalf("v2 plan=%v err=%v", v2, err)
	}
	dept["snapshot_generation"] = int64(3)
	v3, _ := departmentRestorePlan(dept, 9, "")
	if v3["state_sha256"] == v2["state_sha256"] {
		t.Fatal("plan hash must change with the snapshot generation")
	}
	personal := map[string]any{"uuid": "p1", "title": "T", "doc_type": "private", "owner_uid": "u1", "folder_id": nil, "oss_path": "recycle.bin/p.md", "status": int64(0), "deleted_at": "x", "updated_at": "y", "snapshot_generation": int64(1)}
	plan, err := personalRestorePlan(personal, "")
	if err != nil || plan["snapshot_backed"] != true {
		t.Fatalf("personal plan=%v err=%v", plan, err)
	}
}
