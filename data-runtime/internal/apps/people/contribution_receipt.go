package people

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const aimsContributionOperation = "aims.people-contributions.replace-scope.v1"

func (a *Adapter) syncContributionsCommand(ctx context.Context, body map[string]any) (map[string]any, error) {
	if _, ok := body[integrationoperation.ServiceCommandEnvelopeKey]; !ok {
		return a.syncContributions(ctx, body)
	}
	input, command, err := integrationoperation.ReceiptCommandFromBody(body, "people", aimsContributionOperation, "people:write")
	if err != nil {
		return nil, peopleContributionReceiptError(err)
	}
	if input.TrustedContext.SourceApp != "aims" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be aims")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result, err := a.syncContributionsTx(ctx, tx, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "performance_contribution_scope", TargetBizCode: strings.TrimSpace(cleanBodyString(command, "cycle_code")) + ":" + strings.TrimSpace(cleanBodyString(command, "project_code")), HTTPStatus: http.StatusOK, Value: result}, nil
	})
	if err != nil {
		return nil, peopleContributionReceiptError(err)
	}
	return map[string]any{"receiptId": executed.ReceiptID, "receiptStatus": "succeeded", "operationId": input.OperationID, "operationCode": input.OperationCode, "idempotencyKey": input.IdempotencyKey, "commandSchemaVersion": input.CommandSchemaVersion, "commandSha256": input.CommandSHA256, "idempotent": executed.Existing, "targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode, "responseSummarySha256": executed.ResponseSummarySHA256, "result": executed.Value}, nil
}

func peopleContributionReceiptError(err error) error {
	switch {
	case errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch):
		return httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "service command payload mismatch")
	case errors.Is(err, integrationoperation.ErrReceiptInProgress):
		return httperror.New(http.StatusConflict, "service_command_in_progress", "service command is processing")
	default:
		return err
	}
}
