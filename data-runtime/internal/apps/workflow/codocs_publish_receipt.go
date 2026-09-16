package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	codocsPublishWorkflowOperationCode = "codocs.publish-request.workflow-submit.v1"
	codocsPublishWorkflowCapability    = "workflow:document-publish:create"
	codocsPublishWorkflowCallback      = "/api/reviews/workflow-callback"
)

func (a *Adapter) executeCodocsPublishApproval(ctx context.Context, body map[string]any) (InstanceAPIResponse, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(body, "workflow", codocsPublishWorkflowOperationCode, codocsPublishWorkflowCapability)
	if err != nil {
		return InstanceAPIResponse{}, workflowServiceCommandError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "codocs" {
		return InstanceAPIResponse{}, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be codocs")
	}
	requestID := anyInt64(command["publishRequestId"])
	documentUUID := strings.TrimSpace(fmt.Sprint(command["documentUUID"]))
	actorUID := strings.TrimSpace(fmt.Sprint(command["actorUid"]))
	key := fmt.Sprintf("codocs:publish-request:%d:workflow-submit:v1", requestID)
	if requestID <= 0 || documentUUID == "" || actorUID == "" || strings.TrimSpace(fmt.Sprint(command["idempotencyKey"])) != key || receiptInput.IdempotencyKey != key {
		return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "service_command_identity_mismatch", "Codocs publish Workflow command identity is invalid")
	}
	if strings.TrimSpace(fmt.Sprint(body["current_user"])) != actorUID {
		return InstanceAPIResponse{}, httperror.New(http.StatusForbidden, "trusted_actor_mismatch", "trusted delegated actor does not match the frozen Codocs command")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		actionDef, err := actionDefByKeyOn(ctx, tx, "codocs", "documents", "publish")
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if actionDef == nil {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusNotFound, "action_def_not_found", "Codocs document publish action is not configured")
		}
		bizContext := workflowCommandMap(command["bizContext"])
		formData := workflowCommandMap(command["formData"])
		initiatorContext := workflowCommandMap(body["initiator_context"])
		bizID := "publish-request:" + strconv.FormatInt(requestID, 10)
		fullContext := prepareFlowContext(actorUID, initiatorContext, bizContext, bizID, strings.TrimSpace(fmt.Sprint(command["bizTitle"])), "", formData)
		routes, err := matchRoutesOn(ctx, tx, actionDef.ID, fullContext)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if len(routes) == 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "workflow_route_not_found", "Codocs document publish has no matching Workflow route")
		}
		created, err := a.createInstanceTx(ctx, tx, map[string]any{
			"action_def_id": actionDef.ID, "route_id": routes[0].ID,
			"biz_id": bizID, "biz_title": strings.TrimSpace(fmt.Sprint(command["bizTitle"])),
			"biz_url": "/reviews/" + strconv.FormatInt(requestID, 10), "biz_context": bizContext,
			"form_data": formData, "attachments": []any{}, "callback_url": codocsPublishWorkflowCallback,
			"current_user": actorUID, "initiator_context": initiatorContext,
		})
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		createdData, _ := created.Data.(map[string]any)
		instanceNo := strings.TrimSpace(fmt.Sprint(createdData["instance_no"]))
		if instanceNo == "" {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "workflow_instance_identity_missing", "Workflow instance number is required")
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "workflow_instance", TargetBizCode: instanceNo, HTTPStatus: http.StatusOK, Value: map[string]any{"instance": createdData, "effects": created.Effects}}, nil
	})
	if err != nil {
		return InstanceAPIResponse{}, workflowServiceCommandError(err)
	}
	result := executed.Value
	// A succeeded receipt stores its target business identity, not the arbitrary
	// response body. Recover the fixed Workflow instance identity on an
	// idempotent retry so Codocs can checkpoint the same source binding.
	if executed.Existing {
		var instanceID int64
		var instanceNo string
		err := a.db.QueryRowContext(ctx, `
			SELECT id, instance_no
			FROM flow_instances
			WHERE instance_no = ? AND app_code = 'codocs' AND resource_code = 'documents' AND action_code = 'publish'
			LIMIT 1`, executed.TargetBizCode).Scan(&instanceID, &instanceNo)
		if err == sql.ErrNoRows {
			return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "workflow_instance_identity_missing", "Workflow receipt target instance is unavailable")
		}
		if err != nil {
			return InstanceAPIResponse{}, err
		}
		result = map[string]any{"instance": map[string]any{"instance_id": instanceID, "instance_no": instanceNo}}
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{
		"receiptId": executed.ReceiptID, "receiptStatus": "succeeded", "operationId": receiptInput.OperationID,
		"operationCode": receiptInput.OperationCode, "idempotencyKey": receiptInput.IdempotencyKey,
		"commandSchemaVersion": receiptInput.CommandSchemaVersion, "commandSha256": receiptInput.CommandSHA256,
		"idempotent": executed.Existing, "targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256, "result": result,
	}}, nil
}
