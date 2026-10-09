package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// ContractActivationTarget is an in-process owning handler, never a network callback.
// The caller must hold both domains' Registry generation guard and authorization.
type ContractActivationTarget interface {
	CreateProjectFromContractCommandInTransaction(context.Context, *sql.Tx, *io.ReceiptRepository, map[string]any) (map[string]any, error)
	SyncPaymentMilestonesCommandInTransaction(context.Context, *sql.Tx, *io.ReceiptRepository, string, map[string]any) (map[string]any, error)
}

// ExecuteLocalContractActivationInTransaction preserves the frozen source commands,
// target receipts, and the original owning checkpoint algorithms. It owns no transaction.
// All repositories and deployment bindings are constructed by the trusted local caller.
func (a *Adapter) ExecuteLocalContractActivationInTransaction(ctx context.Context, tx *sql.Tx, source io.TrustedContext, targetDeployment string, sourceRepository *io.Repository, targetRepository *io.ReceiptRepository, target ContractActivationTarget, contractCode string, body map[string]any) (map[string]any, error) {
	if tx == nil || sourceRepository == nil || targetRepository == nil || target == nil || source.SourceApp != "altoc" || source.OutboxTables == nil || strings.TrimSpace(targetDeployment) == "" {
		return nil, fmt.Errorf("local activation requires registered caller transaction, owning repositories and bindings")
	}
	if err := source.OutboxTables.Validate(); err != nil {
		return nil, err
	}
	job, err := a.ExecuteContractActivationInTransaction(ctx, tx, contractCode, body)
	if err != nil {
		return nil, err
	}
	activated, err := a.ActivateContractDeliveryInTransaction(ctx, tx, contractCode, body, source)
	if err != nil {
		return nil, err
	}
	descriptors, ok := activated["integrationOperations"].([]contractActivationOperationRecord)
	if !ok {
		return nil, fmt.Errorf("frozen activation operations unavailable")
	}
	sort.SliceStable(descriptors, func(i, j int) bool { return descriptors[i].Sequence < descriptors[j].Sequence })
	projects := []any{}
	milestones := []any{}
	for _, descriptor := range descriptors {
		if descriptor.OperationCode != altocActivationProjectOperation && descriptor.OperationCode != altocActivationMilestoneOperation {
			return nil, io.ErrInvalidIdentity
		}
		claimed, err := sourceRepository.ClaimByOperationKeyInTransaction(ctx, tx, source.TenantCode, source.DeploymentCode, "altoc", descriptor.OperationKey, source.ServiceClientID, time.Now().UTC(), time.Minute)
		if err != nil {
			return nil, err
		}
		var operationID, op, capability, key, version, digest, status, targetApp string
		var raw []byte
		var priorReceipt sql.NullString
		err = tx.QueryRowContext(ctx, "SELECT operation_id,operation_code,required_capability,idempotency_key,command_schema_version,command_sha256,status,target_app,command_json,target_receipt_id FROM "+source.OutboxTables.Operation()+" WHERE tenant_code=? AND deployment_code=? AND source_app='altoc' AND operation_key=? FOR UPDATE", source.TenantCode, source.DeploymentCode, descriptor.OperationKey).Scan(&operationID, &op, &capability, &key, &version, &digest, &status, &targetApp, &raw, &priorReceipt)
		if err != nil {
			return nil, err
		}
		if operationID != descriptor.OperationID || op != descriptor.OperationCode || targetApp != "aims" || capability != altocActivationAimsCapability || key != descriptor.OperationKey {
			return nil, io.ErrImmutableIdentity
		}
		if claimed == nil && status != "succeeded" {
			return nil, fmt.Errorf("activation operation unavailable or dependency not completed")
		}
		var command map[string]any
		if err = json.Unmarshal(raw, &command); err != nil {
			return nil, err
		}
		body := map[string]any{io.TrustedServiceCommandTenantKey: source.TenantCode, io.TrustedServiceCommandSourceDeploymentKey: source.DeploymentCode, io.TrustedServiceCommandTargetDeploymentKey: targetDeployment, io.TrustedServiceCommandSourceAppKey: "altoc", io.TrustedServiceCommandTargetAppKey: "aims", io.TrustedServiceCommandSourceClientKey: source.ServiceClientID, io.TrustedRequestIDKey: source.RequestID, "current_user": altocActor(body), io.ServiceCommandEnvelopeKey: map[string]any{"operationId": operationID, "operationCode": op, "requiredCapability": capability, "idempotencyKey": key, "targetApp": "aims", "commandSchemaVersion": version, "commandSha256": digest, "command": command}}
		var receipt map[string]any
		if op == altocActivationProjectOperation {
			receipt, err = target.CreateProjectFromContractCommandInTransaction(ctx, tx, targetRepository, body)
		} else {
			receipt, err = target.SyncPaymentMilestonesCommandInTransaction(ctx, tx, targetRepository, descriptor.ProjectCode, body)
		}
		if err != nil {
			return nil, err
		}
		targetType, targetCode := altocIntegrationOperationExpectedTarget(op, command)
		evidence := io.ReceiptEvidence{ReceiptID: firstBodyText(receipt, "receiptId"), OperationID: firstBodyText(receipt, "operationId"), OperationCode: firstBodyText(receipt, "operationCode"), IdempotencyKey: firstBodyText(receipt, "idempotencyKey"), CommandSchemaVersion: firstBodyText(receipt, "commandSchemaVersion"), CommandSHA256: firstBodyText(receipt, "commandSha256"), TargetBizType: firstBodyText(receipt, "targetBizType"), TargetBizCode: firstBodyText(receipt, "targetBizCode"), ResponseSummarySHA256: firstBodyText(receipt, "responseSummarySha256")}
		if err = io.ValidateReceiptEvidence(io.ReceiptEvidence{OperationID: operationID, OperationCode: op, IdempotencyKey: key, CommandSchemaVersion: version, CommandSHA256: digest, TargetBizType: targetType, TargetBizCode: targetCode}, evidence); err != nil {
			return nil, err
		}
		if status == "succeeded" && (!priorReceipt.Valid || priorReceipt.String != evidence.ReceiptID) {
			return nil, fmt.Errorf("completed source receipt evidence differs from target")
		}
		if claimed != nil {
			if _, err = sourceRepository.RecordSuccessWithMutationInTransaction(ctx, tx, io.RecordSuccessInput{Lease: io.CompletionLease{OperationID: operationID, Worker: claimed.Worker, FencingToken: claimed.FencingToken}, Now: time.Now().UTC(), HTTPStatus: 200, TargetReceiptID: evidence.ReceiptID, TargetBizType: targetType, TargetBizCode: targetCode, ResponseSummarySHA256: evidence.ResponseSummarySHA256}, nil); err != nil {
				return nil, err
			}
		}
		result, _ := receipt["result"].(map[string]any)
		if result == nil {
			result = map[string]any{}
		}
		result["planKey"] = descriptor.PlanKey
		result["projectRole"] = descriptor.ProjectRole
		result["lineCodes"] = descriptor.LineCodes
		result["obligationCodes"] = descriptor.ObligationCodes
		if op == altocActivationProjectOperation {
			if result["project"] == nil {
				result["project"] = map[string]any{"project_code": descriptor.ProjectCode}
			}
			projects = append(projects, result)
		} else {
			milestones = append(milestones, result)
		}
	}
	jobIdentifier := fmt.Sprint(job["id"])
	// The existing job checkpoint owns relation writes, dependency status and audit.
	for _, step := range []struct {
		key    string
		result map[string]any
	}{{"altoc_activate_contract", map[string]any{"contract": activated["contract"], "createdReceivablePlans": activated["createdReceivablePlans"], "statusChanged": activated["statusChanged"]}}, {"altoc_receivable_plan", map[string]any{"receivablePlans": activated["receivablePlans"], "createdReceivablePlans": activated["createdReceivablePlans"]}}, {"aims_project_link", map[string]any{"projects": projects}}, {"aims_payment_milestones_sync", map[string]any{"items": milestones, "total": len(milestones)}}} {
		if step.key == "aims_project_link" && len(projects) == 0 || step.key == "aims_payment_milestones_sync" && len(milestones) == 0 {
			continue
		}
		checkpoint := map[string]any{}
		for k, v := range body {
			checkpoint[k] = v
		}
		checkpoint["status"] = "succeeded"
		checkpoint["result"] = step.result
		job, err = a.RecordContractActivationStepResultInTransaction(ctx, tx, contractCode, jobIdentifier, step.key, checkpoint)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"job": job, "activation": activated, "projects": projects, "milestones": milestones}, nil
}
