package aims

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestProductHandoffRuntimeRejectsInsufficientCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"handoff-project:authorization", "planning-handoff:create"} {
		for _, scope := range []string{"aims.read", "aims.write", "aims:product-features:*", "aims:product-requests:edit", "aims:product-features:edit"} {
			query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
			_, _, handled, err := adapter.handleProductHandoffRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/"+action, query, nil)
			var result httperror.Error
			if !handled || !errors.As(err, &result) || result.Status != 403 {
				t.Fatalf("%s %s: %v", action, scope, err)
			}
		}
	}
}

func TestProductHandoffRuntimeRequiresVersionPermitForSimpleAndLegacyScopedInputs(t *testing.T) {
	adapter := Adapter{}
	query := url.Values{
		"current_user":                  {"pm"},
		"hzy_runtime_actor_delegated":   {"1"},
		"hzy_runtime_source_app":        {"aims"},
		"hzy_runtime_tenant_code":       {"t"},
		"hzy_runtime_deployment_code":   {"d"},
		"hzy_runtime_service_client_id": {"aims.runtime"},
		"current_user_scopes":           {"aims:product-priorities:handoff"},
	}
	base := map[string]any{
		"item_biz_id":                "00000000-0000-4000-8000-000000000001",
		"expected_revision":          1,
		"expected_item_revision":     1,
		"project_code":               "PRJ",
		"slice_key":                  "default",
		"operation":                  "create",
		"title":                      "handoff",
		"scope_summary":              "scope",
		"reason":                     "reason",
		"planned_version_id":         4,
		"planned_version_feature_id": 5,
	}
	for name, input := range map[string]map[string]any{
		"simple": base,
		"legacy-cycle": {
			"item_biz_id":                base["item_biz_id"],
			"expected_revision":          1,
			"expected_item_revision":     1,
			"cycle_biz_id":               "00000000-0000-4000-8000-000000000002",
			"expected_cycle_revision":    1,
			"expected_queue_revision":    1,
			"project_code":               "PRJ",
			"slice_key":                  "default",
			"operation":                  "create",
			"title":                      "handoff",
			"scope_summary":              "scope",
			"reason":                     "reason",
			"planned_version_id":         4,
			"planned_version_feature_id": 5,
		},
	} {
		t.Run(name, func(t *testing.T) {
			body := map[string]any{
				"input":                  input,
				"planning_authorization": map[string]any{},
				"project_authorization":  map[string]any{},
			}
			_, _, handled, err := adapter.handleProductHandoffRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/planning-handoff:create", query, body)
			var result httperror.Error
			if !handled || !errors.As(err, &result) || result.Status != 400 {
				t.Fatalf("expected missing version authorization before database access, got %v", err)
			}
		})
	}
}

func TestHandoffProjectFactsThroughRuntimeEnvelope(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectQuery("SELECT p.id,p.project_code.*FROM aims_projects p WHERE p.project_code=\\?").WithArgs("pm", "PRJ").WillReturnRows(sqlmock.NewRows([]string{"id", "code", "dept", "leader", "creator", "member"}).AddRow(42, "PRJ", "DEV", "lead", "creator", true))
	query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-priorities:project-authorization"}}
	result, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/handoff-project:authorization", query, map[string]any{"input": map[string]any{"project_code": "PRJ"}})
	if err != nil {
		t.Fatal(err)
	}
	envelope, ok := result.(map[string]any)
	if !ok || envelope["code"] != 0 {
		t.Fatalf("missing runtime envelope: %#v", result)
	}
	facts, ok := envelope["data"].(productHandoffProjectFacts)
	if !ok || facts.ProjectCode != "PRJ" || facts.ActorUID != "pm" {
		t.Fatalf("wrong payload: %#v", envelope)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
