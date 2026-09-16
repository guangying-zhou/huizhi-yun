package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"testing"
)

func quickPublishTestQuery() url.Values {
	return url.Values{"hzy_runtime_source_app": {"codocs"}, "current_user": {"admin"}, "hzy_runtime_actor_delegated": {"1"}, quickPublishTrustedQueryKey: {"1"}}
}
func TestQuickPublishRejectsUntrustedActor(t *testing.T) {
	for _, q := range []url.Values{{}, {"current_user": {"admin"}}, {"current_user": {"admin"}, "hzy_runtime_actor_delegated": {"1"}}} {
		if _, err := (&Adapter{}).quickPublishPrepare(context.Background(), q, map[string]any{}); err == nil {
			t.Fatal("untrusted request accepted")
		}
	}
}
func TestQuickPublishRejectsInvalidSource(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	a := &Adapter{db: db}
	body := map[string]any{"operationId": "op", "targetPrefix": "codocs/company/rules/", "documentUuids": []any{"11111111-1111-1111-1111-111111111111"}}
	mock.ExpectBegin()
	mock.ExpectExec("INSERT IGNORE INTO company_asset_quick_publish_operations").WillReturnResult(sqlmock.NewResult(1, 1))
	// Capture hash independently from the same public canonical command.
	raw, _ := json.Marshal([]any{"admin", "codocs/company/rules/", []string{"11111111-1111-1111-1111-111111111111"}})
	hash := companySummarySHA256(raw)
	mock.ExpectQuery("SELECT actor_uid,command_sha256,plan_json,result_json").WillReturnRows(sqlmock.NewRows([]string{"actor_uid", "command_sha256", "plan_json", "result_json"}).AddRow("admin", hash, `{"operationId":"op","items":[]}`, nil))
	mock.ExpectQuery("SELECT title,oss_path,dept_code FROM documents WHERE uuid=.*doc_type='department' AND status=1").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	if _, err := a.quickPublishPrepare(context.Background(), quickPublishTestQuery(), body); err == nil {
		t.Fatal("private/deleted source accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestQuickPublishCompleteReplayDoesNotWrite(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT actor_uid,plan_json,result_json").WithArgs("op").WillReturnRows(sqlmock.NewRows([]string{"actor_uid", "plan_json", "result_json"}).AddRow("admin", `{}`, `{"imported":[{"newUuid":"published"}],"skipped":[]}`))
	mock.ExpectRollback()
	result, err := a.quickPublishComplete(context.Background(), quickPublishTestQuery(), map[string]any{"operationId": "op"})
	if err != nil || result["imported"] == nil {
		t.Fatalf("replay failed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestQuickPublishCompleteTransaction(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "rollback"}[fail], func(t *testing.T) {
			db, mock, _ := sqlmock.New()
			defer db.Close()
			a := &Adapter{db: db}
			plan := quickPublishPlan{OperationID: "op", Items: []quickPublishItem{{SourceUUID: "source", Title: "Policy", NewUUID: "new", OSSPath: "codocs/company/rules/new.md"}}}
			raw, _ := json.Marshal(plan)
			mock.ExpectBegin()
			mock.ExpectQuery("SELECT actor_uid,plan_json,result_json").WillReturnRows(sqlmock.NewRows([]string{"actor_uid", "plan_json", "result_json"}).AddRow("admin", string(raw), nil))
			insert := mock.ExpectExec("INSERT INTO documents").WithArgs("new", "Policy", "codocs/company/rules/new.md", "admin", int64(10), "admin", "管理员直接发布（无审批、无通知）")
			if fail {
				insert.WillReturnError(sql.ErrConnDone)
				mock.ExpectRollback()
			} else {
				insert.WillReturnResult(sqlmock.NewResult(9, 1))
				mock.ExpectExec("UPDATE company_asset_quick_publish_operations SET result_json=").WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			}
			_, err := a.quickPublishComplete(context.Background(), quickPublishTestQuery(), map[string]any{"operationId": "op", "copies": []any{map[string]any{"newUuid": "new", "ossPath": "codocs/company/rules/new.md", "etag": "etag", "size": 10}}})
			if (err != nil) != fail {
				t.Fatalf("unexpected result: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestQuickPublishCommandRejectsPathTraversal(t *testing.T) {
	for _, prefix := range []string{"codocs/company/rules/../private/", "codocs/users/a/", "codocs/company/unknown/"} {
		_, _, _, err := quickPublishCommand(map[string]any{"operationId": "op", "targetPrefix": prefix, "documentUuids": []any{"11111111-1111-1111-1111-111111111111"}})
		if err == nil {
			t.Fatal("unsafe target accepted")
		}
	}
}
func TestQuickPublishRejectsOtherSourceApps(t *testing.T) {
	q := quickPublishTestQuery()
	q.Set("hzy_runtime_source_app", "aims")
	if _, err := (&Adapter{}).quickPublishPrepare(context.Background(), q, map[string]any{}); err == nil {
		t.Fatal("other app must not establish quick-publish administrator scope")
	}
}
func TestQuickPublishRejectsOperationReuseForDifferentCommand(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	a := &Adapter{db: db}
	mock.ExpectBegin()
	mock.ExpectExec("INSERT IGNORE INTO company_asset_quick_publish_operations").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT actor_uid,command_sha256,plan_json,result_json").WillReturnRows(sqlmock.NewRows([]string{"actor_uid", "command_sha256", "plan_json", "result_json"}).AddRow("admin", "different-command-hash", `{}`, nil))
	mock.ExpectRollback()
	_, err := a.quickPublishPrepare(context.Background(), quickPublishTestQuery(), map[string]any{"operationId": "op", "targetPrefix": "codocs/company/rules/", "documentUuids": []any{"11111111-1111-1111-1111-111111111111"}})
	if err == nil {
		t.Fatal("operation reuse with different command accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
