package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func cabinetUploadIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-test", Actor: "owner-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "upload-key"}
}

func cabinetUploadPayload() map[string]any {
	return map[string]any{"original_name": "report.pdf", "file_ext": "pdf", "file_size": float64(12), "content_sha256": strings.Repeat("a", 64), "folder_id": nil}
}

func expectUploadFolder(mock sqlmock.Sqlmock, owner string) {
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \? FOR UPDATE`).WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Personal", "private", owner, nil, nil, nil))
}

func expectUploadFile(mock sqlmock.Sqlmock, uuid, owner, path, name, ext string, size, folder, status int64, deleted any) {
	mock.ExpectQuery(`SELECT id, owner_uid, dept_code, project_code, oss_path, original_name, file_ext, file_size, folder_id, status, deleted_at FROM cabinet_files WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs(uuid).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_uid", "dept_code", "project_code", "oss_path", "original_name", "file_ext", "file_size", "folder_id", "status", "deleted_at"}).AddRow(int64(11), owner, nil, nil, path, name, ext, size, folder, status, deleted))
}

func TestPlanPersonalCabinetUploadIsReadOnlyAndStable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetUploadIdentity()
	payload := cabinetUploadPayload()
	for i := 0; i < 2; i++ {
		mock.ExpectQuery(`SELECT id, owner_uid, dept_code, project_code, oss_path, original_name, file_ext, file_size, folder_id, status, deleted_at FROM cabinet_files WHERE uuid = \? LIMIT 1`).WithArgs(sqlmock.AnyArg()).WillReturnError(sql.ErrNoRows)
	}
	a := &Adapter{db: db}
	first, err := a.PlanPersonalCabinetUpload(context.Background(), id, payload)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.PlanPersonalCabinetUpload(context.Background(), id, payload)
	if err != nil {
		t.Fatal(err)
	}
	if first["uuid"] != second["uuid"] || first["oss_path"] != second["oss_path"] || first["owner_uid"] != id.Actor {
		t.Fatalf("unstable upload facts: first=%#v second=%#v", first, second)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalCabinetUploadFactsBindIdentityAndPayloadDigest(t *testing.T) {
	base, err := personalCabinetUploadFacts(cabinetUploadIdentity(), cabinetUploadPayload())
	if err != nil {
		t.Fatal(err)
	}
	changed := cabinetUploadPayload()
	changed["content_sha256"] = strings.Repeat("b", 64)
	other, err := personalCabinetUploadFacts(cabinetUploadIdentity(), changed)
	if err != nil {
		t.Fatal(err)
	}
	if base["uuid"] != other["uuid"] || base["oss_path"] == other["oss_path"] {
		t.Fatalf("same key must keep UUID but change immutable path: base=%#v other=%#v", base, other)
	}
	otherID := cabinetUploadIdentity()
	otherID.Key = "another-key"
	different, err := personalCabinetUploadFacts(otherID, cabinetUploadPayload())
	if err != nil || different["uuid"] == base["uuid"] {
		t.Fatalf("different identity must derive a different UUID: %#v err=%v", different, err)
	}
}

func TestPlanPersonalCabinetUploadRejectsRevokedFolderWithoutWrites(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	payload := cabinetUploadPayload()
	payload["folder_id"] = float64(7)
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \?`).WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Revoked", "private", "another-owner", nil, nil, nil))
	_, err = (&Adapter{db: db}).PlanPersonalCabinetUpload(context.Background(), cabinetUploadIdentity(), payload)
	var he httperror.Error
	if err == nil || !errors.As(err, &he) || he.Status != http.StatusForbidden {
		t.Fatalf("err=%v, want HTTP 403", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestValidatePersonalCabinetUploadRejectsFieldsTypesBoundsAndExtensionMismatch(t *testing.T) {
	valid := cabinetUploadPayload()
	if err := ValidatePersonalCabinetUpload(valid); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"extra":               func(p map[string]any) { p["owner_uid"] = "victim" },
		"bad size type":       func(p map[string]any) { p["file_size"] = int64(12) },
		"negative":            func(p map[string]any) { p["file_size"] = float64(-1) },
		"too large":           func(p map[string]any) { p["file_size"] = float64(100*1024*1024 + 1) },
		"fraction":            func(p map[string]any) { p["file_size"] = 1.5 },
		"hash":                func(p map[string]any) { p["content_sha256"] = "bad" },
		"extension":           func(p map[string]any) { p["original_name"] = "report.md" },
		"combined extensions": func(p map[string]any) { p["original_name"] = "report.doc docx"; p["file_ext"] = "doc docx" },
		"slash":               func(p map[string]any) { p["original_name"] = "../report.pdf" },
		"folder":              func(p map[string]any) { p["folder_id"] = float64(0) },
	} {
		candidate := cabinetUploadPayload()
		mutate(candidate)
		var he httperror.Error
		err := ValidatePersonalCabinetUpload(candidate)
		if err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
			t.Fatalf("%s err=%v, want HTTP 400", name, err)
		}
	}
}

func TestPersonalCabinetUploadPreservesLegacyExtensionsAndFullSizeLimit(t *testing.T) {
	for _, ext := range strings.Fields(personalCabinetExtensions) {
		payload := cabinetUploadPayload()
		payload["original_name"] = "中文&报价:" + "." + strings.ToUpper(ext)
		payload["file_ext"] = ext
		payload["file_size"] = float64(100 * 1024 * 1024)
		facts, err := personalCabinetUploadFacts(cabinetUploadIdentity(), payload)
		if err != nil || facts["filename"] != "中文&报价_."+strings.ToUpper(ext) {
			t.Fatalf("%s facts=%v err=%v", ext, facts, err)
		}
	}
}

func TestCommitPersonalCabinetUploadInsertsOnlyAfterScopedFolderAndUUIDChecks(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetUploadIdentity()
	payload := cabinetUploadPayload()
	payload["folder_id"] = float64(7)
	facts, err := personalCabinetUploadFacts(id, payload)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	expectUploadFolder(mock, id.Actor)
	mock.ExpectQuery(`SELECT id, owner_uid, dept_code, project_code, oss_path, original_name, file_ext, file_size, folder_id, status, deleted_at FROM cabinet_files WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs(facts["uuid"]).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`INSERT INTO cabinet_files`).WithArgs(facts["uuid"], facts["filename"], facts["original_name"], facts["file_ext"], facts["file_size"], facts["oss_path"], id.Actor, int64(7)).WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).CommitPersonalCabinetUpload(context.Background(), id, payload)
	if err != nil || got["id"] != int64(42) || got["owner_uid"] != id.Actor {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCommitPersonalCabinetUploadReplayDoesNotInsertAndRejectsChangedOrDeletedRows(t *testing.T) {
	for name, row := range map[string]struct {
		status int
		path   string
		name   string
	}{"replay": {1, "expected", "report.pdf"}, "deleted": {0, "expected", "report.pdf"}, "path changed": {1, "changed", "report.pdf"}} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := cabinetUploadIdentity()
			payload := cabinetUploadPayload()
			facts, err := personalCabinetUploadFacts(id, payload)
			if err != nil {
				t.Fatal(err)
			}
			path := facts["oss_path"].(string)
			if row.path == "changed" {
				path = "codocs/users/owner-1/cabinet/other/hash.pdf"
			}
			mock.ExpectBegin()
			expectUploadFile(mock, facts["uuid"].(string), id.Actor, path, row.name, "pdf", 12, 0, int64(row.status), nil)
			if row.status == 1 && row.path == "expected" {
				mock.ExpectCommit()
				got, err := (&Adapter{db: db}).CommitPersonalCabinetUpload(context.Background(), id, payload)
				if err != nil || got["id"] != int64(11) {
					t.Fatalf("replay result=%#v err=%v", got, err)
				}
			} else {
				mock.ExpectRollback()
				_, err := (&Adapter{db: db}).CommitPersonalCabinetUpload(context.Background(), id, payload)
				var he httperror.Error
				if err == nil || !errors.As(err, &he) || he.Status != http.StatusConflict {
					t.Fatalf("err=%v, want HTTP 409", err)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCommitPersonalCabinetUploadRejectsFolderRevocationAndOwnership(t *testing.T) {
	cases := []struct {
		name, owner string
		folder      bool
		status      int
		want        int
	}{
		{"folder other owner", "other", true, 1, http.StatusForbidden},
		{"existing other owner", "other", false, 1, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := cabinetUploadIdentity()
			payload := cabinetUploadPayload()
			if tc.folder {
				payload["folder_id"] = float64(7)
			}
			facts, err := personalCabinetUploadFacts(id, payload)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectBegin()
			if tc.folder {
				expectUploadFolder(mock, tc.owner)
			} else {
				expectUploadFile(mock, facts["uuid"].(string), tc.owner, facts["oss_path"].(string), "report.pdf", "pdf", 12, 0, int64(tc.status), nil)
			}
			mock.ExpectRollback()
			_, err = (&Adapter{db: db}).CommitPersonalCabinetUpload(context.Background(), id, payload)
			var he httperror.Error
			if err == nil || !errors.As(err, &he) || he.Status != tc.want {
				t.Fatalf("err=%v, want HTTP %d", err, tc.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCommitPersonalCabinetUploadRollsBackOnDatabaseFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetUploadIdentity()
	payload := cabinetUploadPayload()
	facts, err := personalCabinetUploadFacts(id, payload)
	if err != nil {
		t.Fatal(err)
	}
	dbErr := errors.New("insert failed")
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, owner_uid, dept_code, project_code, oss_path, original_name, file_ext, file_size, folder_id, status, deleted_at FROM cabinet_files WHERE uuid = \? LIMIT 1 FOR UPDATE`).WithArgs(facts["uuid"]).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`INSERT INTO cabinet_files`).WillReturnError(dbErr)
	mock.ExpectRollback()
	_, err = (&Adapter{db: db}).CommitPersonalCabinetUpload(context.Background(), id, payload)
	if !errors.Is(err, dbErr) {
		t.Fatalf("err=%v, want insert error", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
