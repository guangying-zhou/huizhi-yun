package altoc

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) handleProductFeedbackProgressRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if path != "/v1/altoc/internal/product-feedback:progress" {
		return nil, "", false, nil
	}
	operation := "altoc.product_feedback.progress"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	exact := false
	for _, scope := range strings.Fields(query.Get("scope")) {
		if scope == productFeedbackProgressCapability {
			exact = true
		}
	}
	if !exact {
		return nil, operation, true, httperror.New(403, "feedback_progress_scope_required", "exact feedback progress capability required")
	}
	receipt, _, err := integrationoperation.ReceiptCommandFromBody(body, "altoc", productFeedbackProgressOperation, productFeedbackProgressCapability)
	if err != nil {
		return nil, operation, true, serviceCommandReceiptError(err)
	}
	if query.Get("runtime_source_app") != "altoc" || query.Get("tenant") != receipt.TrustedContext.TenantCode || query.Get("deployment") != receipt.TargetDeploymentCode {
		return nil, operation, true, httperror.New(403, "feedback_progress_runtime_binding", "feedback target runtime binding is invalid")
	}
	result, err := receiveProductFeedbackProgress(ctx, a.DB(), receipt)
	if err != nil {
		return nil, operation, true, err
	}
	return runtimeOK(map[string]any{
		"operationId": receipt.OperationID, "operationCode": receipt.OperationCode, "idempotencyKey": receipt.IdempotencyKey,
		"commandSchemaVersion": receipt.CommandSchemaVersion, "commandSha256": receipt.CommandSHA256,
		"receiptId": result.ReceiptID, "receiptStatus": "succeeded", "idempotent": result.Existing,
		"targetBizType": result.TargetBizType, "targetBizCode": result.TargetBizCode, "responseSummarySha256": result.ResponseSummarySHA256, "result": result.Value,
	}), operation, true, nil
}
