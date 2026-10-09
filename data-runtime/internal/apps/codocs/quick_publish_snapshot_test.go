package codocs

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const quickPublishV2UUID = "00000000-0000-4000-8000-0000000000b1"

func quickPublishV2Body() map[string]any {
	return map[string]any{"operationId": "op", "targetPrefix": "codocs/company/rules/", "documentUuids": []any{quickPublishV2UUID}}
}

func expectQuickPublishV2Reservation(mock sqlmock.Sqlmock) {
	raw, _ := json.Marshal([]any{"admin", "codocs/company/rules/", []string{quickPublishV2UUID}})
	mock.ExpectBegin()
	mock.ExpectExec("INSERT IGNORE INTO company_asset_quick_publish_operations").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT actor_uid,command_sha256,plan_json,result_json").WillReturnRows(sqlmock.NewRows([]string{"actor_uid", "command_sha256", "plan_json", "result_json"}).AddRow("admin", companySummarySHA256(raw), `{"operationId":"op","items":[]}`, nil))
	mock.ExpectQuery("SELECT title,oss_path,dept_code FROM documents WHERE uuid=.*doc_type='department' AND status=1").WillReturnRows(sqlmock.NewRows([]string{"title", "oss_path", "dept_code"}).AddRow("Policy", "codocs/departments/D1/policy.md", "D1"))
}

// A snapshot-backed department document is published from its exact head. The
// stale mirror path must not be handed to the copier.
func TestQuickPublishPlansSnapshotBackedSourceFromExactVersion(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	key, version, sha, size := expectPublishedHead(t, mock, quickPublishV2UUID)
	expectQuickPublishV2Reservation(mock)
	expectSnapshotGenerationOf(mock, quickPublishV2UUID, int64(1))
	mock.ExpectExec("UPDATE company_asset_quick_publish_operations SET plan_json").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	result, err := (&Adapter{db: db}).quickPublishPrepare(context.Background(), quickPublishTestQuery(), quickPublishV2Body())
	if err != nil {
		t.Fatal(err)
	}
	items := result["plan"].(quickPublishPlan).Items
	if len(items) != 1 || items[0].SourcePath != "" {
		t.Fatalf("items = %#v, want mirror path withheld", items)
	}
	ref := items[0].BodyRef
	if ref["generation"] != int64(1) || ref["sha256"] != sha || ref["size"] != size || ref["markdown"].(map[string]any)["key"] != key || ref["markdown"].(map[string]any)["version"] != version {
		t.Fatalf("bodyRef = %#v", ref)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestQuickPublishRefusesToPlanAVersionThatAdvancedUnderTheLock(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	expectPublishedHead(t, mock, quickPublishV2UUID)
	expectQuickPublishV2Reservation(mock)
	expectSnapshotGenerationOf(mock, quickPublishV2UUID, int64(2))
	mock.ExpectRollback()
	_, err := (&Adapter{db: db}).quickPublishPrepare(context.Background(), quickPublishTestQuery(), quickPublishV2Body())
	var he httperror.Error
	if !errors.As(err, &he) || he.Status != 409 || he.Code != "document_snapshot_changed" {
		t.Fatalf("err = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestQuickPublishPlansV1SourceWithMirrorPathAsBefore(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	mock.ExpectQuery(`SELECT tenant_code, deployment_code FROM document_snapshot_heads`).WithArgs(quickPublishV2UUID).WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "deployment_code"}))
	expectQuickPublishV2Reservation(mock)
	expectNotSnapshotV2(mock, quickPublishV2UUID)
	mock.ExpectExec("UPDATE company_asset_quick_publish_operations SET plan_json").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	result, err := (&Adapter{db: db}).quickPublishPrepare(context.Background(), quickPublishTestQuery(), quickPublishV2Body())
	if err != nil {
		t.Fatal(err)
	}
	items := result["plan"].(quickPublishPlan).Items
	if len(items) != 1 || items[0].SourcePath != "codocs/departments/D1/policy.md" || items[0].BodyRef != nil {
		t.Fatalf("items = %#v", items)
	}
}
