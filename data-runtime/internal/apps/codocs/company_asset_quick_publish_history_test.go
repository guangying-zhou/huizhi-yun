package codocs

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestQuickPublishHistoryRequiresAdministratorContext(t *testing.T) {
	for _, failure := range []string{"marker", "source", "actor", "path"} {
		t.Run(failure, func(t *testing.T) {
			q := quickPublishTestQuery()
			q.Set(quickPublishHistoryTrustedQueryKey, "1")
			path := "codocs/company/rules/policy.md"
			switch failure {
			case "marker":
				q.Del(quickPublishHistoryTrustedQueryKey)
			case "source":
				q.Set("hzy_runtime_source_app", "aims")
			case "actor":
				q.Del("hzy_runtime_actor_delegated")
			case "path":
				path = "codocs/users/private.md"
			}
			if _, err := (&Adapter{}).quickPublishHistoryByPath(context.Background(), q, path, "published"); err == nil {
				t.Fatal("unauthorized history request accepted")
			}
		})
	}
}
func TestQuickPublishHistoryProjectsCompletedOperationWithoutApproval(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	a := &Adapter{db: db}
	q := quickPublishTestQuery()
	q.Set(quickPublishHistoryTrustedQueryKey, "1")
	path := "codocs/company/rules/policy.md"
	raw, _ := json.Marshal(quickPublishPlan{OperationID: "op", Items: []quickPublishItem{{SourceUUID: "source", NewUUID: "published", Title: "Policy", OSSPath: path}}})
	mock.ExpectQuery("SELECT operation_id,actor_uid,plan_json,created_at,completed_at.*completed_at IS NOT NULL AND result_json IS NOT NULL.*JSON_CONTAINS").WithArgs("published", path).WillReturnRows(sqlmock.NewRows([]string{"operation_id", "actor_uid", "plan_json", "created_at", "completed_at"}).AddRow("op", "admin", string(raw), "2026-09-10 12:00:00", "2026-09-10 12:01:00"))
	record, err := a.quickPublishHistoryByPath(context.Background(), q, path, "published")
	if err != nil {
		t.Fatal(err)
	}
	if record["review_type"] != "管理员直接发布" || record["initiator_uid"] != "admin" || record["status"] != "published" {
		t.Fatalf("incorrect provenance: %v", record)
	}
	if len(record["flow_snapshot"].([]any)) != 0 {
		t.Fatal("quick publication must not invent an approval flow")
	}
	actions := record["actions"].([]map[string]any)
	if len(actions) != 1 || actions[0]["action"] != "quick_publish" {
		t.Fatalf("incorrect actions: %v", actions)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestQuickPublishHistoryRejectsMismatchedPlan(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	a := &Adapter{db: db}
	q := quickPublishTestQuery()
	q.Set(quickPublishHistoryTrustedQueryKey, "1")
	mock.ExpectQuery("SELECT operation_id,actor_uid,plan_json,created_at,completed_at").WillReturnRows(sqlmock.NewRows([]string{"operation_id", "actor_uid", "plan_json", "created_at", "completed_at"}).AddRow("op", "admin", `{"items":[{"newUuid":"other","ossPath":"codocs/company/rules/other.md"}]}`, "now", "now"))
	record, err := a.quickPublishHistoryByPath(context.Background(), q, "codocs/company/rules/policy.md", "published")
	if err != nil || record != nil {
		t.Fatalf("mismatched plan exposed: %v %v", record, err)
	}
}
