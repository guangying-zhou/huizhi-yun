package aims

import (
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestProductFeedbackCommandBinding(t *testing.T) {
	command := map[string]any{"actorUid": "pm", "productCode": "P", "ticketCode": "ST-1", "requestBizId": "00000000-0000-4000-8000-000000000001", "title": "Feedback", "description": "Details", "action": "create"}
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "ALTOC",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "AIMS",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "altoc",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "aims",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "altoc.runtime",
		integrationoperation.ServiceCommandEnvelopeKey:                map[string]any{"operationId": "00000000-0000-4000-8000-000000000002", "operationCode": productFeedbackOperation, "requiredCapability": productFeedbackCapability, "targetApp": "aims", "idempotencyKey": "feedback:1", "commandSchemaVersion": "product-feedback-create.v1", "commandSha256": hash, "command": command},
	}
	query := url.Values{"current_user_scopes": {productFeedbackCapability}, "current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_actor_purpose": {"service-command"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"TENANT"}, "hzy_runtime_deployment_code": {"AIMS"}}
	input, err := parseProductFeedbackCommand(body, query)
	if err != nil || input.OriginalActorUID != "pm" {
		t.Fatalf("valid command %+v %v", input, err)
	}
	for key := range query {
		old := query.Get(key)
		query.Set(key, "forged")
		if _, err := parseProductFeedbackCommand(body, query); err == nil {
			t.Errorf("accepted forged %s", key)
		}
		query.Set(key, old)
	}
	for _, scope := range []string{"*", "aims.*", "aims.write"} {
		query.Set("current_user_scopes", scope)
		if _, err := parseProductFeedbackCommand(body, query); err == nil {
			t.Errorf("accepted wide scope %s", scope)
		}
	}
	query.Set("current_user_scopes", productFeedbackCapability)
	command["title"] = "tampered"
	if _, err := parseProductFeedbackCommand(body, query); err == nil {
		t.Fatal("accepted hash mismatch")
	}
}
