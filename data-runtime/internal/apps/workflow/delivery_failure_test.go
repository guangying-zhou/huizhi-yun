package workflow

import (
	"context"
	"errors"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestWorkflowDeliveryFailureStoresOnlyFixedMachineCodes(t *testing.T) {
	for _, item := range []struct{ input, want string }{
		{"actionable_not_found", "actionable_not_found"},
		{"callback_delivery_failed", "callback_delivery_failed"},
		{"Bearer private-token", "delivery_failed"},
		{"other_machine_code", "delivery_failed"},
	} {
		if got := workflowDeliveryFailureCode(map[string]any{"code": item.input}); got != item.want {
			t.Fatalf("unsafe or lost delivery code %q: %q", item.input, got)
		}
	}
	if workflowDeliveryHTTPStatus(map[string]any{"http_status": 99}) != nil || workflowDeliveryHTTPStatus(map[string]any{"http_status": 600}) != nil {
		t.Fatal("invalid HTTP status entered durable diagnosis")
	}
}

func TestWorkflowDeliveryMutationRequiresTrustedRuntimeContextBeforeDatabase(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	if _, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "7", map[string]any{"code": "notification_delivery_failed"}); err == nil {
		t.Fatal("failure checkpoint accepted missing trusted tenant/deployment")
	}
	trustedWithoutVersion := map[string]any{
		"hzy_runtime_tenant_code": "C000001", "hzy_runtime_deployment_code": "test-workflow", "hzy_runtime_service_client_id": "workflow.runtime",
	}
	for _, checkpoint := range []func(context.Context, string, map[string]any) (InstanceAPIResponse, string, error){
		adapter.failWorkflowNotificationOutbox,
		adapter.acknowledgeWorkflowNotificationOutbox,
		adapter.failActionableLifecycleOutbox,
		adapter.acknowledgeActionableLifecycleOutbox,
		adapter.failWorkflowCallback,
		adapter.acknowledgeWorkflowCallback,
	} {
		_, _, err := checkpoint(context.Background(), "7", trustedWithoutVersion)
		var known httperror.Error
		if !errors.As(err, &known) || known.Status != 400 || known.Code != "delivery_effect_version_required" {
			t.Fatalf("unfenced checkpoint must fail before DB with 400: %v", err)
		}
	}
	if _, _, err := adapter.recoverWorkflowDelivery(context.Background(), workflowNotificationDelivery, "7", map[string]any{
		"hzy_runtime_tenant_code": "C000001", "hzy_runtime_deployment_code": "test-workflow",
	}); err == nil {
		t.Fatal("recovery accepted missing trusted service identity")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("untrusted mutation reached database: %v", err)
	}
}
