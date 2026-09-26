package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func cabinetConversionIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{Tenant: "tenant-1", Deployment: "codocs-test", Actor: "owner-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "conversion-key"}
}

func cabinetConversionPayload() map[string]any {
	return map[string]any{"title": "Converted report", "folder_id": nil, "content_sha256": strings.Repeat("b", 64), "content_size": float64(42)}
}

func cabinetConversionPlanPayload() map[string]any {
	return map[string]any{"title": "Converted report", "folder_id": nil}
}

func expectedCabinetSourceState() string {
	raw, _ := json.Marshal([]any{"source-1", "owner-1", "source", "docx", int64(42), 1, sql.NullString{}, sql.NullString{String: "2026-01-01", Valid: true}})
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

func expectConversionSource(mock sqlmock.Sqlmock, source, owner, ext, path string, size int64, status int, deleted any, updated any, lock ...bool) {
	suffix := `$`
	if len(lock) > 0 && lock[0] {
		suffix = ` FOR UPDATE$`
	}
	mock.ExpectQuery(`SELECT owner_uid, dept_code, project_code, oss_path, file_ext, file_size, status, deleted_at, converted_doc_uuid, updated_at FROM cabinet_files WHERE uuid = \? LIMIT 1` + suffix).WithArgs(source).
		WillReturnRows(sqlmock.NewRows([]string{"owner_uid", "dept_code", "project_code", "oss_path", "file_ext", "file_size", "status", "deleted_at", "converted_doc_uuid", "updated_at"}).AddRow(owner, nil, nil, path, ext, size, status, deleted, nil, updated))
}

func expectConversionTargetMissing(mock sqlmock.Sqlmock, uuid string, lock ...bool) {
	suffix := `$`
	if len(lock) > 0 && lock[0] {
		suffix = ` FOR UPDATE$`
	}
	mock.ExpectQuery(`SELECT owner_uid, doc_type, dept_code, project_code, oss_path, title, status FROM documents WHERE uuid = \? LIMIT 1` + suffix).WithArgs(uuid).WillReturnError(sql.ErrNoRows)
}

func expectConversionTitleFree(mock sqlmock.Sqlmock, title, owner, uuid string) {
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE title = \? AND owner_uid = \? AND uuid != \? AND status != 0 AND doc_type = \? AND folder_id IS NULL`).WithArgs(title, owner, uuid, "private").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
}

func TestPlanPersonalCabinetConversionValidatesPayloadAndIsStable(t *testing.T) {
	id := cabinetConversionIdentity()
	payload := cabinetConversionPlanPayload()
	facts, err := cabinetConversionFacts(id, "source-1", payload, false)
	if err != nil || !strings.HasPrefix(facts["target_prefix"].(string), "codocs/cabinet-conversions/") {
		t.Fatalf("facts=%#v err=%v", facts, err)
	}
	if facts["uuid"] != mustConversionUUID(id) {
		t.Fatalf("unstable intent UUID=%v", facts["uuid"])
	}
	for name, mutate := range map[string]func(map[string]any){
		"extra":                func(p map[string]any) { p["owner_uid"] = "victim" },
		"title type":           func(p map[string]any) { p["title"] = 12 },
		"folder type":          func(p map[string]any) { p["folder_id"] = "7" },
		"content hash in plan": func(p map[string]any) { p["content_sha256"] = strings.Repeat("c", 64) },
	} {
		candidate := cabinetConversionPlanPayload()
		mutate(candidate)
		var he httperror.Error
		if err := ValidatePersonalCabinetConversion(candidate, false); err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
			t.Fatalf("%s accepted/error=%v", name, err)
		}
	}
}

func TestCabinetConversionIntentBindsOnlyIdentityToUUIDAndPayloadToPrefix(t *testing.T) {
	id := cabinetConversionIdentity()
	basePayload := cabinetConversionPlanPayload()
	base, err := cabinetConversionFacts(id, "source-1", basePayload, false)
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*PersonalFolderCreationIdentity, map[string]any){
		"source": func(_ *PersonalFolderCreationIdentity, p map[string]any) { p["title"] = "Other title" },
		"folder": func(_ *PersonalFolderCreationIdentity, p map[string]any) { p["folder_id"] = float64(7) },
	} {
		candidate := cabinetConversionPlanPayload()
		mutate(&id, candidate)
		other, err := cabinetConversionFacts(id, "source-1", candidate, false)
		if err != nil || other["uuid"] != base["uuid"] || other["target_prefix"] == base["target_prefix"] {
			t.Fatalf("%s intent uuid/prefix = %#v err=%v", name, other, err)
		}
	}
	for name, mutate := range map[string]func(*PersonalFolderCreationIdentity){
		"actor":      func(i *PersonalFolderCreationIdentity) { i.Actor = "other-actor" },
		"tenant":     func(i *PersonalFolderCreationIdentity) { i.Tenant = "other-tenant" },
		"deployment": func(i *PersonalFolderCreationIdentity) { i.Deployment = "other-deployment" },
		"key":        func(i *PersonalFolderCreationIdentity) { i.Key = "other-key" },
	} {
		otherID := id
		mutate(&otherID)
		other, err := cabinetConversionFacts(otherID, "source-1", basePayload, false)
		if err != nil || other["uuid"] == base["uuid"] {
			t.Fatalf("%s identity UUID = %#v err=%v", name, other, err)
		}
	}
}

func mustConversionUUID(id PersonalFolderCreationIdentity) string {
	facts, err := cabinetConversionFacts(id, "source-1", cabinetConversionPlanPayload(), false)
	if err != nil {
		panic(err)
	}
	return facts["uuid"].(string)
}

func TestPlanPersonalCabinetConversionReadsSourceTargetAndTitleWithoutWrites(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetConversionIdentity()
	expectConversionSource(mock, "source-1", id.Actor, "docx", "codocs/users/owner-1/cabinet/source.docx", 42, 1, nil, "2026-01-01")
	uuid := mustConversionUUID(id)
	expectConversionTargetMissing(mock, uuid)
	expectConversionTitleFree(mock, "Converted report", id.Actor, uuid)
	got, err := (&Adapter{db: db}).PlanPersonalCabinetConversion(context.Background(), id, "source-1", cabinetConversionPlanPayload())
	if err != nil || got["source_uuid"] != "source-1" || got["replayed"] == true {
		t.Fatalf("facts=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPlanPersonalCabinetConversionRejectsSourceScopeStateAndType(t *testing.T) {
	cases := []struct {
		name, owner, ext string
		status           int
		deleted          any
		dept             any
		project          any
		want             int
	}{
		{"other owner", "other", "docx", 1, nil, nil, nil, http.StatusForbidden},
		{"department", "owner-1", "docx", 1, nil, "D1", nil, http.StatusForbidden},
		{"empty department is not NULL", "owner-1", "docx", 1, nil, "", nil, http.StatusForbidden},
		{"project", "owner-1", "docx", 1, nil, nil, "P1", http.StatusForbidden},
		{"empty project is not NULL", "owner-1", "docx", 1, nil, nil, "", http.StatusForbidden},
		{"deleted", "owner-1", "docx", 0, time.Now(), nil, nil, http.StatusConflict},
		{"unsupported type", "owner-1", "pdf", 1, nil, nil, nil, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := cabinetConversionIdentity()
			mock.ExpectQuery(`SELECT owner_uid, dept_code, project_code, oss_path, file_ext, file_size, status, deleted_at, converted_doc_uuid, updated_at FROM cabinet_files WHERE uuid = \? LIMIT 1`).WithArgs("source-1").
				WillReturnRows(sqlmock.NewRows([]string{"owner_uid", "dept_code", "project_code", "oss_path", "file_ext", "file_size", "status", "deleted_at", "converted_doc_uuid", "updated_at"}).AddRow(tc.owner, tc.dept, tc.project, "source", tc.ext, int64(42), tc.status, tc.deleted, nil, "2026-01-01"))
			_, err = (&Adapter{db: db}).PlanPersonalCabinetConversion(context.Background(), id, "source-1", cabinetConversionPlanPayload())
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

// SQLmock proves statement/transaction order, not MySQL's isolation behavior.
func TestCommitPersonalCabinetConversionInsertsDocumentRelationAndLinkInTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetConversionIdentity()
	payload := cabinetConversionPayload()
	planPayload := cabinetConversionPlanPayload()
	planned := map[string]any{}
	expectConversionSource(mock, "source-1", id.Actor, "docx", "codocs/users/owner-1/cabinet/source.docx", 42, 1, nil, "2026-01-01")
	uuid := mustConversionUUID(id)
	expectConversionTargetMissing(mock, uuid)
	expectConversionTitleFree(mock, "Converted report", id.Actor, uuid)
	// A plan is read-only; use its source state as the commit precondition.
	planned, err = (&Adapter{db: db}).PlanPersonalCabinetConversion(context.Background(), id, "source-1", planPayload)
	if err != nil {
		t.Fatal(err)
	}
	payload["source_state"] = planned["source_state"]
	mock.ExpectBegin()
	expectConversionSource(mock, "source-1", id.Actor, "docx", "codocs/users/owner-1/cabinet/source.docx", 42, 1, nil, "2026-01-01", true)
	expectConversionTargetMissing(mock, uuid, true)
	expectConversionTitleFree(mock, "Converted report", id.Actor, uuid)
	mock.ExpectExec(`INSERT INTO documents`).WithArgs(uuid, "Converted report", sqlmock.AnyArg(), id.Actor, nil, float64(42)).WillReturnResult(sqlmock.NewResult(91, 1))
	mock.ExpectExec(`INSERT INTO document_relations`).WithArgs(int64(91), uuid, id.Actor, "created_by_me", "document", "91", 1, 1, 0, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE cabinet_files SET converted_doc_uuid = \?, updated_at = NOW\(\) WHERE uuid = \?`).WithArgs(uuid, "source-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).CommitPersonalCabinetConversion(context.Background(), id, "source-1", payload)
	if err != nil || got["oss_path"] == nil {
		t.Fatalf("result=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCommitPersonalCabinetConversionReplayDoesNotInsertOrRelink(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetConversionIdentity()
	payload := cabinetConversionPayload()
	payload["source_state"] = strings.Repeat("a", 64)
	facts, err := cabinetConversionFacts(id, "source-1", payload, true)
	if err != nil {
		t.Fatal(err)
	}
	// The target row is supplied with the actual immutable target prefix; the
	// source state is recomputed from the locked source row before replay.
	mock.ExpectBegin()
	expectConversionSource(mock, "source-1", id.Actor, "docx", "source", 42, 1, nil, "2026-01-01", true)
	mock.ExpectQuery(`SELECT owner_uid, doc_type, dept_code, project_code, oss_path, title, status FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE$`).WithArgs(facts["uuid"]).
		WillReturnRows(sqlmock.NewRows([]string{"owner_uid", "doc_type", "dept_code", "project_code", "oss_path", "title", "status"}).AddRow(id.Actor, "private", nil, nil, facts["target_prefix"].(string)+strings.Repeat("a", 64)+"/"+strings.Repeat("b", 64)+".md", "Existing title", 1))
	mock.ExpectCommit()
	got, err := (&Adapter{db: db}).CommitPersonalCabinetConversion(context.Background(), id, "source-1", payload)
	if err != nil || got["replayed"] != true || got["title"] != "Existing title" {
		t.Fatalf("replay=%#v err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCommitPersonalCabinetConversionRejectsSourceChangeTitleConflictAndRollsBack(t *testing.T) {
	for _, name := range []string{"source state changed", "title conflict"} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := cabinetConversionIdentity()
			payload := cabinetConversionPayload()
			payload["source_state"] = strings.Repeat("a", 64)
			if name == "source state changed" {
				payload["source_state"] = strings.Repeat("f", 64)
			}
			uuid := mustConversionUUID(id)
			mock.ExpectBegin()
			expectConversionSource(mock, "source-1", id.Actor, "docx", "source", 42, 1, nil, "2026-01-01", true)
			expectConversionTargetMissing(mock, uuid, true)
			if name == "title conflict" {
				mock.ExpectQuery(`SELECT COUNT\(\*\) FROM documents WHERE title = \? AND owner_uid = \? AND uuid != \? AND status != 0 AND doc_type = \? AND folder_id IS NULL`).WithArgs("Converted report", id.Actor, uuid, "private").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
			} else {
				expectConversionTitleFree(mock, "Converted report", id.Actor, uuid)
			}
			mock.ExpectRollback()
			_, err = (&Adapter{db: db}).CommitPersonalCabinetConversion(context.Background(), id, "source-1", payload)
			var he httperror.Error
			if err == nil || !errors.As(err, &he) || he.Status != map[string]int{"source state changed": http.StatusConflict, "title conflict": http.StatusConflict}[name] {
				t.Fatalf("err=%v, want HTTP 409", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPlanPersonalCabinetConversionRejectsTargetScopeOrFolderOwnership(t *testing.T) {
	for _, tc := range []struct {
		name, owner, kind string
		status            int
		want              int
	}{
		{"target other owner", "other", "private", 1, http.StatusForbidden},
		{"target department type", "owner-1", "department", 1, http.StatusForbidden},
		{"target deleted", "owner-1", "private", 0, http.StatusConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := cabinetConversionIdentity()
			uuid := mustConversionUUID(id)
			expectConversionSource(mock, "source-1", id.Actor, "docx", "source", 42, 1, nil, "2026-01-01")
			mock.ExpectQuery(`SELECT owner_uid, doc_type, dept_code, project_code, oss_path, title, status FROM documents WHERE uuid = \? LIMIT 1$`).WithArgs(uuid).
				WillReturnRows(sqlmock.NewRows([]string{"owner_uid", "doc_type", "dept_code", "project_code", "oss_path", "title", "status"}).AddRow(tc.owner, tc.kind, nil, nil, "codocs/cabinet-conversions/other/immutable/", "Existing", tc.status))
			_, err = (&Adapter{db: db}).PlanPersonalCabinetConversion(context.Background(), id, "source-1", cabinetConversionPlanPayload())
			var he httperror.Error
			if err == nil || !errors.As(err, &he) || he.Status != tc.want {
				t.Fatalf("err=%v, want HTTP %d", err, tc.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	id := cabinetConversionIdentity()
	payload := cabinetConversionPlanPayload()
	payload["folder_id"] = float64(7)
	uuid := mustConversionUUID(id)
	expectConversionSource(mock, "source-1", id.Actor, "docx", "source", 42, 1, nil, "2026-01-01")
	expectConversionTargetMissing(mock, uuid)
	mock.ExpectQuery(`SELECT id, name, folder_type, owner_uid, dept_code, project_code, parent_id FROM folders WHERE id = \?`).WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "folder_type", "owner_uid", "dept_code", "project_code", "parent_id"}).AddRow(7, "Other", "private", "other", nil, nil, nil))
	_, err = (&Adapter{db: db}).PlanPersonalCabinetConversion(context.Background(), id, "source-1", payload)
	var he httperror.Error
	if err == nil || !errors.As(err, &he) || he.Status != http.StatusForbidden {
		t.Fatalf("folder error=%v, want HTTP 403", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCommitPersonalCabinetConversionRejectsInvalidCommitFieldsBeforeDB(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"source state": func(p map[string]any) { p["source_state"] = "bad" },
		"content hash": func(p map[string]any) { p["source_state"] = strings.Repeat("a", 64); p["content_sha256"] = "bad" },
		"content size": func(p map[string]any) { p["source_state"] = strings.Repeat("a", 64); p["content_size"] = 1.5 },
		"extra":        func(p map[string]any) { p["source_state"] = strings.Repeat("a", 64); p["owner_uid"] = "victim" },
	} {
		payload := cabinetConversionPayload()
		mutate(payload)
		var he httperror.Error
		if _, err := (&Adapter{}).CommitPersonalCabinetConversion(context.Background(), cabinetConversionIdentity(), "source-1", payload); err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
			t.Fatalf("%s err=%v, want HTTP 400", name, err)
		}
	}
}

func TestCommitPersonalCabinetConversionPropagatesSourceTargetAndInsertErrorsWithRollback(t *testing.T) {
	for _, stage := range []string{"source", "target", "insert"} {
		t.Run(stage, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			id := cabinetConversionIdentity()
			payload := cabinetConversionPayload()
			payload["source_state"] = strings.Repeat("a", 64)
			if stage == "insert" {
				payload["source_state"] = expectedCabinetSourceState()
			}
			uuid := mustConversionUUID(id)
			mock.ExpectBegin()
			if stage == "source" {
				mock.ExpectQuery(`SELECT owner_uid, dept_code, project_code, oss_path, file_ext, file_size, status, deleted_at, converted_doc_uuid, updated_at FROM cabinet_files WHERE uuid = \? LIMIT 1 FOR UPDATE$`).WithArgs("source-1").WillReturnError(errors.New("source read failed"))
			} else {
				expectConversionSource(mock, "source-1", id.Actor, "docx", "source", 42, 1, nil, "2026-01-01", true)
				if stage == "target" {
					mock.ExpectQuery(`SELECT owner_uid, doc_type, dept_code, project_code, oss_path, title, status FROM documents WHERE uuid = \? LIMIT 1 FOR UPDATE$`).WithArgs(uuid).WillReturnError(errors.New("target read failed"))
				} else {
					expectConversionTargetMissing(mock, uuid, true)
					expectConversionTitleFree(mock, "Converted report", id.Actor, uuid)
					mock.ExpectExec(`INSERT INTO documents`).WillReturnError(errors.New("document insert failed"))
				}
			}
			mock.ExpectRollback()
			if _, err := (&Adapter{db: db}).CommitPersonalCabinetConversion(context.Background(), id, "source-1", payload); err == nil {
				t.Fatal("conversion unexpectedly succeeded")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCommitPersonalCabinetConversionRollsBackWhenRelationOrLinkFails(t *testing.T) {
	for _, relationFailure := range []bool{true, false} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		id := cabinetConversionIdentity()
		payload := cabinetConversionPayload()
		planPayload := cabinetConversionPlanPayload()
		expectConversionSource(mock, "source-1", id.Actor, "docx", "source", 42, 1, nil, "2026-01-01")
		uuid := mustConversionUUID(id)
		expectConversionTargetMissing(mock, uuid)
		expectConversionTitleFree(mock, "Converted report", id.Actor, uuid)
		planned, err := (&Adapter{db: db}).PlanPersonalCabinetConversion(context.Background(), id, "source-1", planPayload)
		if err != nil {
			db.Close()
			t.Fatal(err)
		}
		payload["source_state"] = planned["source_state"]
		mock.ExpectBegin()
		expectConversionSource(mock, "source-1", id.Actor, "docx", "source", 42, 1, nil, "2026-01-01", true)
		expectConversionTargetMissing(mock, uuid, true)
		expectConversionTitleFree(mock, "Converted report", id.Actor, uuid)
		mock.ExpectExec(`INSERT INTO documents`).WillReturnResult(sqlmock.NewResult(91, 1))
		if relationFailure {
			mock.ExpectExec(`INSERT INTO document_relations`).WillReturnError(errors.New("relation failed"))
		} else {
			mock.ExpectExec(`INSERT INTO document_relations`).WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec(`UPDATE cabinet_files SET converted_doc_uuid = \?, updated_at = NOW\(\) WHERE uuid = \?`).WillReturnError(errors.New("link failed"))
		}
		mock.ExpectRollback()
		_, err = (&Adapter{db: db}).CommitPersonalCabinetConversion(context.Background(), id, "source-1", payload)
		if err == nil {
			t.Fatal("conversion failure unexpectedly succeeded")
		}
		if expectationsErr := mock.ExpectationsWereMet(); expectationsErr != nil {
			t.Fatal(expectationsErr)
		}
		db.Close()
	}
}
