package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"time"
)

const EnterpriseWorkItemCompletionReplayCapability = "aims:work-item-completion-replay:execute"

func (a *Adapter) ReplayEnterpriseWorkItemCompletion(ctx context.Context, id EnterpriseProjectUpdateIdentity, projectID, itemID string, command map[string]any) (map[string]any, error) {
	if err := a.verifyEnterpriseCompletionTables(ctx); err != nil {
		return nil, err
	}
	outbox, err := a.enterpriseOutbox()
	if err != nil {
		return nil, err
	}
	expected := completionPositiveNumber(command["expectedOperationVersion"])
	reason, ok := command["reason"].(string)
	if len(command) != 2 || expected <= 0 || !ok || reason == "" || len(id.Personnel) > 0 {
		return nil, httperror.New(400, "completion_replay_input_invalid", "Operation version and recovery reason are required")
	}
	base := EnterpriseProjectCreateIdentity{Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID, IdempotencyKey: id.IdempotencyKey}
	ri, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "input": command})
	if err != nil {
		return nil, err
	}
	ri.OperationCode = "enterprise.aims.work-items.completion-replay.v1"
	ri.RequiredCapability = EnterpriseWorkItemCompletionReplayCapability
	ri.CommandSchemaVersion = "completion-replay.v1"
	tx, receipts, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := receipts.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		var allowed int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p LEFT JOIN aims_project_members m ON m.project_id=p.id AND m.uid=? AND m.status='active' AND m.role='manager' WHERE p.id=? AND (p.leader_uid=? OR m.id IS NOT NULL) FOR UPDATE", id.ActorUID, projectID, id.ActorUID).Scan(&allowed); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if allowed != 1 {
			return iop.ReceiptBusinessResult{}, httperror.New(403, "completion_replay_project_denied", "Project management access is required")
		}
		item, _, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, true)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if fmt.Sprint(item["project_id"]) != projectID {
			return iop.ReceiptBusinessResult{}, httperror.New(403, "completion_replay_project_mismatch", "Work item is outside the project")
		}
		var request int
		var key string
		if err = tx.QueryRowContext(ctx, "SELECT id,operation_key FROM work_item_completion_requests WHERE active_work_item_id=? AND project_id=? FOR UPDATE", itemID, projectID).Scan(&request, &key); err != nil {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "completion_replay_request_inactive", "No active completion request can be recovered")
		}
		var operationID string
		if err = tx.QueryRowContext(ctx, outbox.SQL("SELECT operation_id FROM integration_operation WHERE operation_key=? AND tenant_code=? AND deployment_code=? AND source_app='aims' AND target_app='workflow' AND operation_code=? AND source_biz_type='work_item_completion_request' AND source_biz_code=? FOR UPDATE"), key, id.Tenant, a.enterpriseWrites.workerDeployment, workItemCompletionWorkflowOperation, fmt.Sprint(request)).Scan(&operationID); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		// View preflight resolves this logical queue to the registered store.
		repo, err := iop.NewRepository(a.DB())
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		checkpoint, err := repo.ReplayInTransaction(ctx, tx, iop.ReplayInput{TenantCode: id.Tenant, DeploymentCode: a.enterpriseWrites.workerDeployment, SourceApp: "aims", OperationID: operationID, ExpectedVersion: uint64(expected), ActorUID: id.ActorUID, Reason: reason, Now: time.Now().UTC()})
		if err != nil {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "completion_replay_rejected", "Operation changed or is not eligible for manual recovery")
		}
		if err = writeCompletionAuditTx(ctx, tx, projectID, itemID, id.ActorUID, id.IdempotencyKey, "completion_replay", map[string]any{"requestId": request, "operationId": operationID, "reason": reason, "operationVersion": checkpoint.Version}); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "work_item_completion_request", TargetBizCode: fmt.Sprint(request), HTTPStatus: http.StatusAccepted, Value: map[string]any{"requestId": request, "operationKey": key, "operationVersion": checkpoint.Version, "status": "pending"}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing, "result": result.Value}, nil
}
