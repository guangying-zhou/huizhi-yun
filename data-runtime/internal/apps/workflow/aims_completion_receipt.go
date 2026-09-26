package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	aimsCompletionWorkflowOperationCode = "aims.work-item.completion.workflow-submit.v1"
	aimsCompletionWorkflowCapability    = "workflow:work-item-complete:create"
	aimsCompletionWorkflowCallback      = "/api/v1/service/work-item-completion/workflow-callback"
)

func validateAimsCompletionCommand(command map[string]any) (int64, int64, error) {
	fields := map[string]bool{"completionRequestId": true, "workItemId": true, "workItemKey": true, "projectId": true, "actorUid": true, "snapshotSha256": true, "bizTitle": true, "bizContext": true, "formData": true, "idempotencyKey": true}
	kind := "target"
	if command["kind"] != nil {
		if command["kind"] != "matter" {
			return 0, 0, httperror.New(400, "aims_completion_command_invalid", "Invalid frozen work-item completion command")
		}
		kind = "matter"
		fields["kind"] = true
	}
	invalid := func() (int64, int64, error) {
		return 0, 0, httperror.New(400, "aims_completion_command_invalid", "Invalid frozen work-item completion command")
	}
	for field := range command {
		if !fields[field] {
			return invalid()
		}
	}
	ids := map[string]int64{}
	for _, field := range []string{"completionRequestId", "workItemId", "projectId"} {
		raw, err := json.Marshal(command[field])
		if err != nil || !regexp.MustCompile(`^[1-9][0-9]*$`).Match(raw) {
			return invalid()
		}
		id, err := strconv.ParseInt(string(raw), 10, 64)
		if err != nil {
			return invalid()
		}
		ids[field] = id
	}
	for field, limit := range map[string]int{"workItemKey": 100, "actorUid": 50, "bizTitle": 255, "idempotencyKey": 191} {
		value, ok := command[field].(string)
		if !ok || !utf8.ValidString(value) || strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > limit {
			return invalid()
		}
		if field != "bizTitle" && value != strings.TrimSpace(value) {
			return invalid()
		}
		if field == "actorUid" {
			for _, character := range value {
				if character < 32 || character == 127 {
					return invalid()
				}
			}
		}
	}
	hash, ok := command["snapshotSha256"].(string)
	if !ok || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(hash) {
		return invalid()
	}
	for _, field := range []string{"bizContext", "formData"} {
		if _, ok := command[field].(map[string]any); !ok {
			return invalid()
		}
	}
	biz := command["bizContext"].(map[string]any)
	form := command["formData"].(map[string]any)
	formLength := 4
	if kind == "matter" {
		formLength = 6
	}
	if len(biz) != 1 || len(form) != formLength || (kind == "matter" && (form["kind"] != "matter" || !validAimsMatterEvidenceSummary(form["evidenceSummary"]))) {
		return invalid()
	}
	equalNumber := func(value any, id int64) bool {
		raw, err := json.Marshal(value)
		return err == nil && string(raw) == strconv.FormatInt(id, 10)
	}
	if !equalNumber(biz["project_id"], ids["projectId"]) || !equalNumber(form["completionRequestId"], ids["completionRequestId"]) || !equalNumber(form["workItemId"], ids["workItemId"]) || !equalNumber(form["projectId"], ids["projectId"]) || form["snapshotSha256"] != hash {
		return invalid()
	}
	return ids["completionRequestId"], ids["workItemId"], nil
}

func validAimsMatterEvidenceSummary(value any) bool {
	summary, ok := value.(map[string]any)
	if !ok || len(summary) != 4 {
		return false
	}
	for _, field := range []string{"deliverableCount", "requiredDeliverableCount", "commitCount", "timeEntryCount"} {
		raw, err := json.Marshal(summary[field])
		if err != nil {
			return false
		}
		count, err := strconv.ParseUint(string(raw), 10, 32)
		if err != nil || strconv.FormatUint(count, 10) != string(raw) {
			return false
		}
	}
	return true
}

func (a *Adapter) executeAimsCompletionApproval(ctx context.Context, body map[string]any) (InstanceAPIResponse, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(body, "workflow", aimsCompletionWorkflowOperationCode, aimsCompletionWorkflowCapability)
	if err != nil {
		return InstanceAPIResponse{}, workflowServiceCommandError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "aims" {
		return InstanceAPIResponse{}, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be aims")
	}
	runtimeContext, err := integrationoperation.TrustedContextFromMap(body, "workflow")
	if err != nil || runtimeContext.TenantCode != receiptInput.TrustedContext.TenantCode || runtimeContext.DeploymentCode != receiptInput.TargetDeploymentCode {
		return InstanceAPIResponse{}, httperror.New(http.StatusForbidden, "service_command_runtime_binding_mismatch", "Service command must match the authenticated target Runtime binding")
	}
	requestID, workItemID, err := validateAimsCompletionCommand(command)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	kind := "target"
	if command["kind"] == "matter" {
		kind = "matter"
	}
	if !aimsCompletionSchemaMatchesCommand(receiptInput.CommandSchemaVersion, command) {
		return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "service_command_schema_mismatch", "Completion command schema does not match its kind")
	}
	workItemKey := strings.TrimSpace(fmt.Sprint(command["workItemKey"]))
	actorUID := strings.TrimSpace(fmt.Sprint(command["actorUid"]))
	key := fmt.Sprintf("aims:work-item-completion:%d:workflow-submit:v1", requestID)
	if kind == "matter" {
		key = fmt.Sprintf("aims:work-item-completion:matter:%d:workflow-submit:v2", requestID)
	}
	if requestID <= 0 || workItemKey == "" || actorUID == "" || strings.TrimSpace(fmt.Sprint(command["idempotencyKey"])) != key || receiptInput.IdempotencyKey != key {
		return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "service_command_identity_mismatch", "Aims completion Workflow command identity is invalid")
	}
	if strings.TrimSpace(fmt.Sprint(body["current_user"])) != actorUID {
		return InstanceAPIResponse{}, httperror.New(http.StatusForbidden, "trusted_actor_mismatch", "trusted delegated actor does not match the frozen Aims command")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		actionDef, err := actionDefByKeyOn(ctx, tx, "aims", "tasks", "complete")
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if actionDef == nil {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusNotFound, "action_def_not_found", "Aims work-item completion action is not configured")
		}
		bizContext := workflowCommandMap(command["bizContext"])
		formData := workflowCommandMap(command["formData"])
		initiatorContext := workflowCommandMap(body["initiator_context"])
		bizID := strconv.FormatInt(workItemID, 10)
		fullContext := prepareFlowContext(actorUID, initiatorContext, bizContext, bizID, strings.TrimSpace(fmt.Sprint(command["bizTitle"])), "", formData)
		routes, err := matchRoutesOn(ctx, tx, actionDef.ID, fullContext)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if len(routes) == 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "workflow_route_not_found", "Aims work-item completion has no matching Workflow route")
		}
		created, err := a.createInstanceTx(ctx, tx, map[string]any{
			"action_def_id": actionDef.ID, "route_id": routes[0].ID,
			"biz_id": bizID, "biz_title": strings.TrimSpace(fmt.Sprint(command["bizTitle"])),
			"biz_url": "/work-items/" + strconv.FormatInt(workItemID, 10), "biz_context": bizContext,
			"form_data": formData, "attachments": []any{}, "callback_url": aimsCompletionWorkflowCallback,
			"current_user": actorUID, "initiator_context": initiatorContext,
		})
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		createdData, _ := created.Data.(map[string]any)
		if cleanAnyString(createdData["status"]) != "running" {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "completion_approval_route_required", "Work-item completion requires an active approval route")
		}
		instanceNo, hasInstanceNo := createdData["instance_no"].(string)
		if !hasInstanceNo || strings.TrimSpace(instanceNo) == "" || anyInt64(createdData["instance_id"]) < 1 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(http.StatusConflict, "workflow_instance_identity_missing", "Workflow instance number is required")
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "work_item_completion_workflow", TargetBizCode: "completion-request:" + strconv.FormatInt(requestID, 10), HTTPStatus: http.StatusOK, Value: map[string]any{"instance": createdData, "effects": created.Effects}}, nil
	})
	if err != nil {
		return InstanceAPIResponse{}, workflowServiceCommandError(err)
	}
	result := executed.Value
	// A succeeded receipt stores its target business identity, not the arbitrary
	// response body. Recover the fixed Workflow instance identity on an
	// idempotent retry so Aims can checkpoint the same source binding.
	if executed.Existing {
		if executed.TargetBizType != "work_item_completion_workflow" || executed.TargetBizCode != "completion-request:"+strconv.FormatInt(requestID, 10) {
			return InstanceAPIResponse{}, httperror.New(409, "workflow_receipt_identity_mismatch", "Workflow receipt identity is invalid")
		}
		instanceID, instanceNo, err := a.restoreCompletionInstance(ctx, command, requestID, workItemID, actorUID)
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

func aimsCompletionSchemaMatchesCommand(schema string, command map[string]any) bool {
	if command["kind"] == nil {
		return schema == "v1"
	}
	return command["kind"] == "matter" && schema == "v2"
}

func (a *Adapter) restoreCompletionInstance(ctx context.Context, command map[string]any, requestID, workItemID int64, actorUID string) (int64, string, error) {
	var count int
	var id int64
	var number string
	kindClause := " AND JSON_EXTRACT(form_data,'$.kind') IS NULL"
	if command["kind"] == "matter" {
		kindClause = " AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.kind')) = 'matter'"
	}
	err := a.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(MIN(id),0), COALESCE(MIN(instance_no),'') FROM flow_instances
		WHERE app_code = 'aims' AND resource_code = 'tasks' AND action_code = 'complete' AND biz_id = ? AND initiator_uid = ?
		AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.completionRequestId')) = ?
		AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.workItemId')) = ?
		AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.projectId')) = ?
		AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.snapshotSha256')) = ?`+kindClause, strconv.FormatInt(workItemID, 10), actorUID, strconv.FormatInt(requestID, 10), strconv.FormatInt(workItemID, 10), fmt.Sprint(command["projectId"]), command["snapshotSha256"]).Scan(&count, &id, &number)
	if err != nil {
		return 0, "", err
	}
	if count != 1 || id < 1 || strings.TrimSpace(number) == "" {
		return 0, "", httperror.New(409, "workflow_instance_identity_missing", "Workflow receipt target is missing or ambiguous")
	}
	return id, number, nil
}
