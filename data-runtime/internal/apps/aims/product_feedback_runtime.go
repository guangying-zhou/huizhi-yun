package aims

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductFeedbackRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	authorizationOnly := path == "/v1/aims/internal/product-requests:feedback-authorization"
	if path != "/v1/aims/internal/product-requests:from-feedback" && !authorizationOnly {
		return nil, "", false, nil
	}
	operation := "aims.product-requests.from-feedback"
	if authorizationOnly {
		operation = "aims.product-requests.feedback-authorization"
	}
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	input, err := parseProductFeedbackCommand(body, query)
	if err != nil {
		return nil, operation, true, err
	}
	if authorizationOnly {
		var command productcenter.FeedbackRequest
		if err = json.Unmarshal(input.Command, &command); err != nil {
			return nil, operation, true, err
		}
		facts, err := productcenter.LoadAuthorizationFacts(ctx, a.DB(), command.ProductCode, command.ActorUID)
		return facts, operation, true, productRuntimeError(err)
	}
	var permit productcenter.AuthorizationPermit
	if err = decodeProductCommandPart(body["authorization"], &permit); err != nil {
		return nil, operation, true, err
	}
	result, err := productcenter.ReceiveFeedbackWithReceipt(ctx, a.DB(), input, permit)
	if err != nil {
		return nil, operation, true, productRuntimeError(err)
	}
	return map[string]any{
		"operationId": input.OperationID, "operationCode": input.OperationCode, "idempotencyKey": input.IdempotencyKey,
		"commandSchemaVersion": input.CommandSchemaVersion, "commandSha256": input.CommandSHA256,
		"receiptId": result.ReceiptID, "receiptStatus": "succeeded", "idempotent": result.Existing,
		"targetBizType": result.TargetBizType, "targetBizCode": result.TargetBizCode,
		"responseSummarySha256": result.ResponseSummarySHA256, "result": result.Value,
	}, operation, true, nil
}
