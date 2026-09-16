package aims

import (
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const productFeedbackCapability = "aims:product-request:create-from-feedback"
const productFeedbackOperation = "altoc.aims.product-request.create-from-feedback.v1"

// Reserved context is injected by authenticated runtime middleware, never by
// browser JSON. Product object authorization is still required after parsing.
func parseProductFeedbackCommand(body map[string]any, query url.Values) (integrationoperation.ReceiptCommandInput, error) {
	empty := integrationoperation.ReceiptCommandInput{}
	allowed := false
	for _, scope := range strings.Fields(query.Get("current_user_scopes")) {
		if scope == productFeedbackCapability {
			allowed = true
		}
	}
	if !allowed {
		return empty, httperror.New(403, "insufficient_scope", "product feedback capability required")
	}
	input, command, err := integrationoperation.ReceiptCommandFromBody(body, "aims", productFeedbackOperation, productFeedbackCapability)
	if err != nil {
		return empty, httperror.New(403, "product_feedback_command_invalid", "signed feedback command required")
	}
	feedback, err := productcenter.ParseFeedbackRequest(command)
	if err != nil {
		return empty, err
	}
	if input.TrustedContext.SourceApp != "altoc" || input.TrustedContext.ServiceClientID != "altoc.runtime" || input.CommandSchemaVersion != "product-feedback-create.v1" || query.Get("current_user") != feedback.ActorUID || query.Get("hzy_runtime_actor_delegated") != "1" || query.Get("hzy_runtime_actor_purpose") != "service-command" || query.Get("hzy_runtime_source_app") != "aims" || query.Get("hzy_runtime_tenant_code") != input.TrustedContext.TenantCode || query.Get("hzy_runtime_deployment_code") != input.TargetDeploymentCode {
		return empty, httperror.New(403, "product_feedback_command_invalid", "feedback actor or deployment binding invalid")
	}
	input.OriginalActorUID = feedback.ActorUID
	return input, nil
}
