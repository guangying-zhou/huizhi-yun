package aims

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
)

func TestPlanningRuntimeErrorClassification(t *testing.T) {
	for _, tc := range []struct {
		code   string
		status int
	}{
		{"product_planning_revision_conflict", http.StatusConflict},
		{"priority_queue_conflict", http.StatusConflict},
		{"planning_dependency_order_invalid", http.StatusConflict},
		{"product_planning_readonly", http.StatusConflict},
		{"planning_cycle_revision_conflict", http.StatusConflict},
		{"planning_cycle_readonly", http.StatusConflict},
		{"product_planning_revision_required", http.StatusBadRequest},
		{"product_planning_sources_invalid", http.StatusBadRequest},
		{"product_planning_impact_required", http.StatusBadRequest},
	} {
		t.Run(tc.code, func(t *testing.T) {
			err := productRuntimeError(&productcenter.RuleError{Code: tc.code, Message: "planning command rejected"})
			var response httperror.Error
			if !errors.As(err, &response) || response.Status != tc.status {
				t.Fatalf("expected HTTP %d, got %v", tc.status, err)
			}
		})
	}
}

func TestPlanningRuntimeRequiresExactCapabilitiesBeforeDatabase(t *testing.T) {
	var adapter Adapter
	for _, action := range []string{"comment-history", "comment-list", "comment-create", "comment-edit", "comment-delete", "create", "list", "view", "edit", "cycle-list", "cycle-view", "cycle-create", "cycle-edit", "cycle-open", "cycle-close", "cycle-review", "review-list", "observation-list", "observation-view", "consumption-view", "consumption-confirm", "budget-change", "budget-preview", "withdraw", "withdrawal-preview", "observation-create", "candidate-list", "candidate-add", "assessment-create", "assessment-list", "queue-move", "queue-preview", "matrix-view", "capacity-view", "selection-preview", "selection", "dependencies-view", "dependencies-edit"} {
		handler := adapter.handleProductPlanningCreateRuntime
		capability := "create"
		if action == "list" {
			handler = adapter.handleProductPlanningListRuntime
			capability = "read"
		}
		if action == "view" {
			handler = adapter.handleProductPlanningViewRuntime
			capability = "read"
		}
		if action == "edit" {
			handler = adapter.handleProductPlanningEditRuntime
			capability = "edit"
		}
		path := "/v1/aims/internal/products/P1/planning-items:" + action
		for _, commentAction := range []string{"history", "list", "create", "edit", "delete"} {
			if action == "comment-"+commentAction {
				handler = adapter.handleProductPlanningCommentsRuntime
				capability = "comment"
				if commentAction == "list" || commentAction == "history" {
					capability = "read"
				}
				path = "/v1/aims/internal/products/P1/planning-comments:" + commentAction
			}
		}
		if action == "cycle-list" {
			handler = adapter.handleProductPlanningCycleListRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-cycles:list"
		}
		if action == "cycle-view" {
			handler = adapter.handleProductPlanningCycleViewRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-cycles:view"
		}
		if action == "cycle-create" {
			handler = adapter.handleProductPlanningCycleCreateRuntime
			capability = "create"
			path = "/v1/aims/internal/products/P1/planning-cycles:create"
		}
		if action == "cycle-edit" {
			handler = adapter.handleProductPlanningCycleEditRuntime
			capability = "edit"
			path = "/v1/aims/internal/products/P1/planning-cycles:edit"
		}
		if action == "observation-view" {
			handler = adapter.handleProductPlanningObservationViewRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-observations:view"
		}
		if action == "consumption-view" {
			handler = adapter.handleProductPlanningConsumptionViewRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-consumption:view"
		}
		if action == "consumption-confirm" {
			handler = adapter.handleProductPlanningConsumptionConfirmRuntime
			capability = "consumption-confirm"
			path = "/v1/aims/internal/products/P1/planning-consumption:confirm"
		}
		if action == "withdraw" {
			handler = adapter.handleProductPlanningWithdrawalRuntime
			capability = "withdraw"
			path = "/v1/aims/internal/products/P1/planning-withdrawal:withdraw"
		}
		if action == "withdrawal-preview" {
			handler = adapter.handleProductPlanningWithdrawalPreviewRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-withdrawal:preview"
		}
		if action == "budget-change" {
			handler = adapter.handleProductPlanningBudgetChangeRuntime
			capability = "budget-change"
			path = "/v1/aims/internal/products/P1/planning-budget:change"
		}
		if action == "budget-preview" {
			handler = adapter.handleProductPlanningBudgetPreviewRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-budget:preview"
		}
		if action == "review-list" {
			handler = adapter.handleProductPlanningReviewListRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-reviews:list"
		}
		if action == "observation-list" {
			handler = adapter.handleProductPlanningObservationListRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-observations:list"
		}
		if action == "observation-create" {
			handler = adapter.handleProductPlanningObservationCreateRuntime
			capability = "observe"
			path = "/v1/aims/internal/products/P1/planning-observations:create"
		}
		if action == "cycle-review" {
			handler = adapter.handleProductPlanningCycleReviewRuntime
			capability = "cycle-review"
			path = "/v1/aims/internal/products/P1/planning-cycles:review"
		}
		if action == "cycle-close" {
			handler = adapter.handleProductPlanningCycleCloseRuntime
			capability = "cycle-close"
			path = "/v1/aims/internal/products/P1/planning-cycles:close"
		}
		if action == "cycle-open" {
			handler = adapter.handleProductPlanningCycleOpenRuntime
			capability = "cycle-open"
			path = "/v1/aims/internal/products/P1/planning-cycles:open"
		}
		if action == "candidate-list" {
			handler = adapter.handleProductPlanningCandidateListRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-candidates:list"
		}
		if action == "candidate-add" {
			handler = adapter.handleProductPlanningCandidateAddRuntime
			capability = "edit"
			path = "/v1/aims/internal/products/P1/planning-candidates:add"
		}
		if action == "assessment-create" {
			handler = adapter.handleProductPlanningAssessmentCreateRuntime
			capability = "assess"
			path = "/v1/aims/internal/products/P1/planning-assessments:create"
		}
		if action == "assessment-list" {
			handler = adapter.handleProductPlanningAssessmentListRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-assessments:list"
		}
		if action == "queue-move" {
			handler = adapter.handleProductPlanningQueueMoveRuntime
			capability = "move"
			path = "/v1/aims/internal/products/P1/planning-queue:move"
		}
		if action == "queue-preview" {
			handler = adapter.handleProductPlanningQueuePreviewRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-queue:preview"
		}
		if action == "dependencies-view" {
			handler = adapter.handleProductPlanningDependenciesReadRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-dependencies:view"
		}
		if action == "dependencies-edit" {
			handler = adapter.handleProductPlanningDependenciesEditRuntime
			capability = "edit"
			path = "/v1/aims/internal/products/P1/planning-dependencies:edit"
		}

		if action == "selection" {
			handler = adapter.handleProductPlanningSelectionRuntime
			capability = "select"
			path = "/v1/aims/internal/products/P1/planning-selection:select"
		}

		if action == "selection-preview" {
			handler = adapter.handleProductPlanningSelectionPreviewRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-selection:preview"
		}

		if action == "capacity-view" {
			handler = adapter.handleProductPlanningCapacityRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-capacity:view"
		}

		if action == "matrix-view" {
			handler = adapter.handleProductPlanningMatrixRuntime
			capability = "read"
			path = "/v1/aims/internal/products/P1/planning-matrix:view"
		}
		valid := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-priorities:" + capability}}
		for _, missing := range []string{"current_user", "hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
			q := url.Values{}
			for k, v := range valid {
				q[k] = append([]string(nil), v...)
			}
			q.Del(missing)
			_, _, handled, err := handler(context.Background(), http.MethodPost, path, q, nil)
			var e httperror.Error
			expected := 403
			if missing == "current_user" {
				expected = http.StatusUnauthorized
			}
			if !handled || !errors.As(err, &e) || e.Status != expected {
				t.Fatalf("%s missing %s: %v", action, missing, err)
			}
		}
		for _, wrong := range []string{"aims:product-requests:" + capability, "aims:product-priorities:*"} {
			valid.Set("current_user_scopes", wrong)
			_, _, _, err := handler(context.Background(), http.MethodPost, path, valid, nil)
			var e httperror.Error
			if !errors.As(err, &e) || e.Status != 403 {
				t.Fatalf("%s wrong scope %s: %v", action, wrong, err)
			}
		}
	}
}

func TestPlanningEditRejectsCreateCapability(t *testing.T) {
	var adapter Adapter
	q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:product-priorities:create"}}
	_, _, handled, err := adapter.handleProductPlanningEditRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P1/planning-items:edit", q, nil)
	var e httperror.Error
	if !handled || !errors.As(err, &e) || e.Status != 403 {
		t.Fatalf("create authorized edit: %v", err)
	}
}

func TestPlanningCycleOpenRejectsOrdinaryWriteCapabilities(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"aims.write", "aims.write aims:product-priorities:create", "aims.write aims:product-priorities:edit", "aims.read aims:product-priorities:read"} {
		q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
		_, _, handled, err := adapter.handleProductPlanningCycleOpenRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P1/planning-cycles:open", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("ordinary scope %s authorized open: %v", scope, err)
		}
	}
}

func TestPlanningCandidateAddRejectsNonEditCapabilities(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"aims.write", "aims:product-priorities:create", "aims:product-priorities:read", "aims:product-priorities:cycle-open"} {
		q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
		_, _, handled, err := adapter.handleProductPlanningCandidateAddRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P1/planning-candidates:add", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("scope %s authorized candidate add: %v", scope, err)
		}
	}
}

func TestPlanningAssessmentRejectsNonAssessCapabilities(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"aims.write", "aims:product-priorities:edit", "aims:product-priorities:create", "aims:product-priorities:read", "aims:product-priorities:cycle-open"} {
		q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
		_, _, handled, err := adapter.handleProductPlanningAssessmentCreateRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P1/planning-assessments:create", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("scope %s authorized assessment: %v", scope, err)
		}
	}
}

func TestPlanningMoveRejectsNonMoveCapabilities(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"aims.write", "aims:product-priorities:assess", "aims:product-priorities:edit", "aims:product-priorities:create", "aims:product-priorities:read", "aims:product-priorities:cycle-open"} {
		q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
		_, _, handled, err := adapter.handleProductPlanningQueueMoveRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P1/planning-queue:move", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("scope %s authorized move: %v", scope, err)
		}
	}
}

func TestPlanningSelectionDoesNotBorrowOtherWriteCapabilities(t *testing.T) {
	adapter := &Adapter{}
	for _, scope := range []string{"aims:product-priorities:read", "aims:product-priorities:edit", "aims:product-priorities:move", "aims:product-priorities:assess", "aims:product-priorities:cycle-open", "aims:write"} {
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
		_, _, handled, err := adapter.handleProductPlanningSelectionRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P1/planning-selection:select", query, nil)
		var failure httperror.Error
		if !handled || !errors.As(err, &failure) || failure.Status != 403 {
			t.Fatalf("selection borrowed %s: %v", scope, err)
		}
	}
}

func TestPlanningCycleCloseRejectsOrdinaryWriteCapabilities(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"aims.write aims:product-priorities:cycle-open", "aims.write aims:product-priorities:select", "aims.write aims:product-priorities:assess", "aims.write", "aims.write aims:product-priorities:create", "aims.write aims:product-priorities:edit", "aims.read aims:product-priorities:read"} {
		q := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {scope}}
		_, _, handled, err := adapter.handleProductPlanningCycleCloseRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P1/planning-cycles:close", q, nil)
		var e httperror.Error
		if !handled || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("ordinary scope %s authorized close: %v", scope, err)
		}
	}
}
