package enterprisecontracts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// MilestoneReceivableService is the local, opt-in AA-04 core. It has no HTTP
// route: callers must pass the Aims BFF's already verified Workflow callback.
type MilestoneReceivableService struct {
	registry                *e.Registry
	altocWriter, aimsWriter e.ResolveRequest
	aimsScheduler           e.ResolveRequest
	aimsSource              io.TrustedContext
	aimsSourceRepository    *io.Repository
	altocReceiptRepository  *io.ReceiptRepository
	altoc                   *altoc.Adapter
	aims                    *aims.Adapter
	altocDeployment         string
	altocReceiptTable       string
}

func MilestoneReceivableAimsViews() []string {
	return append(ActivationAimsViews(), "approval_records")
}

func NewMilestoneReceivableService(ctx context.Context, registry *e.Registry, binding e.Binding, deployments DeploymentBinding, altocAdapter *altoc.Adapter, aimsAdapter *aims.Adapter) (*MilestoneReceivableService, error) {
	if registry == nil || altocAdapter == nil || aimsAdapter == nil || strings.TrimSpace(deployments.AltocDeployment) == "" || strings.TrimSpace(deployments.AimsDeployment) == "" {
		return nil, e.ErrBindingMismatch
	}
	requests := map[string]e.ResolveRequest{}
	for _, domain := range []string{"altoc", "aims"} {
		d, ok := binding.Domains[domain]
		if !ok {
			return nil, e.ErrBindingNotFound
		}
		requests[domain] = e.ResolveRequest{Key: binding.Key, Domain: domain, OwnerDeployment: d.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Write}
	}
	s := &MilestoneReceivableService{registry: registry, altocWriter: requests["altoc"], aimsWriter: requests["aims"], altoc: altocAdapter, aims: aimsAdapter, altocDeployment: deployments.AltocDeployment}
	s.aimsScheduler = s.aimsWriter
	s.aimsScheduler.Operation = e.Scheduler
	altocResolved, err := registry.Resolve(s.altocWriter)
	if err != nil {
		return nil, err
	}
	aimsResolved, err := registry.Resolve(s.aimsWriter)
	if err != nil {
		return nil, err
	}
	scheduled, err := registry.Resolve(s.aimsScheduler)
	if err != nil {
		return nil, err
	}
	if altocResolved.DB != aimsResolved.DB || aimsResolved.DB != scheduled.DB || altocResolved.Key != aimsResolved.Key || altocResolved.Generation != aimsResolved.Generation || altocResolved.SchemaVersion != aimsResolved.SchemaVersion {
		return nil, e.ErrBindingMismatch
	}
	if err = e.VerifyCompatibilityViews(ctx, altocResolved.DB, binding, "altoc", ActivationAltocViews()); err != nil {
		return nil, err
	}
	if err = e.VerifyCompatibilityViews(ctx, aimsResolved.DB, binding, "aims", MilestoneReceivableAimsViews()); err != nil {
		return nil, err
	}
	name := func(resolved e.Resolved, logical string) (string, error) { return resolved.Table(logical) }
	aimsNames := make([]string, 4)
	for i, logical := range []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable"} {
		aimsNames[i], err = name(aimsResolved, logical)
		if err != nil {
			return nil, err
		}
	}
	aimsTables, err := io.NewOutboxTables(aimsNames[0], aimsNames[1], aimsNames[2], aimsNames[3])
	if err != nil {
		return nil, err
	}
	s.aimsSourceRepository, err = io.NewRepository(aimsResolved.DB, io.WithOutboxTables(aimsTables))
	if err != nil {
		return nil, err
	}
	altocReceipt, err := name(altocResolved, "service_command_receipt")
	if err != nil {
		return nil, err
	}
	if altocReceipt == aimsNames[2] {
		return nil, e.ErrBindingMismatch
	}
	s.altocReceiptTable = altocReceipt
	s.altocReceiptRepository, err = io.NewReceiptRepository(altocResolved.DB, io.WithReceiptTable(altocReceipt))
	if err != nil {
		return nil, err
	}
	s.aimsSource = io.TrustedContext{TenantCode: binding.Key.Tenant, DeploymentCode: deployments.AimsDeployment, SourceApp: "aims", ServiceClientID: "aims.runtime", OutboxTables: &aimsTables}
	return s, nil
}

// Complete executes only a callback already authenticated at the Aims BFF.
// The evidence remains bound to the locked request/snapshot in the Aims handler.
func (s *MilestoneReceivableService) Complete(ctx context.Context, callback aims.VerifiedMilestoneCompletionCallback) (map[string]any, error) {
	if s == nil || callback.RequestID() <= 0 || callback.InstanceID() == "" || callback.Status() != "approved" && callback.Status() != "rejected" {
		return nil, e.ErrBindingMismatch
	}
	if !callback.MatchesSource(s.aimsSource.TenantCode, s.aimsSource.DeploymentCode) {
		return nil, e.ErrBindingMismatch
	}
	if _, err := s.registry.Resolve(s.aimsScheduler); err != nil {
		return nil, err
	}
	tx, _, err := s.registry.BeginWriteTransaction(ctx, s.altocWriter, s.aimsWriter)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	body := callback.Body()
	body["current_user"] = "workflow"
	body[io.TrustedTenantCodeKey] = s.aimsSource.TenantCode
	body[io.TrustedDeploymentCodeKey] = s.aimsSource.DeploymentCode
	body[io.TrustedSourceAppKey] = s.aimsSource.SourceApp
	body[io.TrustedServiceClientIDKey] = s.aimsSource.ServiceClientID
	body[io.TrustedRequestIDKey] = "workflow:" + callback.InstanceID()
	body["__aims_milestone_receivable_trusted_context"] = s.aimsSource
	result, err := s.aims.ApplyMilestoneCompletionWorkflowCallbackInTransaction(ctx, tx, callback.RequestID(), callback.InstanceID(), callback.BizID(), callback.FormData(), callback.Status(), body)
	if err != nil {
		return nil, err
	}
	if callback.Status() == "approved" {
		if err = s.completeReceivableOperation(ctx, tx, result); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	// The BFF uses this status to decide whether a legacy external dispatch is
	// needed. Publish success only after the shared transaction has committed.
	if callback.Status() == "approved" {
		if operation, ok := result["receivableBillable"].(map[string]any); ok && operation["linked"] != false {
			operation["operationStatus"] = "succeeded"
		}
	}
	return result, nil
}

func (s *MilestoneReceivableService) completeReceivableOperation(ctx context.Context, tx *sql.Tx, result map[string]any) error {
	op, _ := result["receivableBillable"].(map[string]any)
	if op != nil && op["linked"] == false {
		return nil
	}
	key, _ := op["operationKey"].(string)
	key = strings.TrimSpace(key)
	if key == "" {
		project, _ := result["projectCode"].(string)
		project = strings.TrimSpace(project)
		milestone, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(result["milestoneId"])), 10, 64)
		if err != nil || milestone <= 0 {
			return fmt.Errorf("milestone receivable operation identity unavailable")
		}
		key = fmt.Sprintf("aims:milestone:%s:%d:accepted:v1", project, milestone)
		if project == "" {
			key = fmt.Sprintf("aims:milestone:%d:accepted:v1", milestone)
		}
	}
	claimed, err := s.aimsSourceRepository.ClaimByOperationKeyInTransaction(ctx, tx, s.aimsSource.TenantCode, s.aimsSource.DeploymentCode, "aims", key, s.aimsSource.ServiceClientID, time.Now().UTC(), time.Minute)
	if err != nil {
		return err
	}
	if claimed == nil {
		return s.verifyCompletedOperation(ctx, tx, key, result)
	}
	var command map[string]any
	if err = json.Unmarshal(claimed.Command, &command); err != nil {
		return err
	}
	term, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(command["paymentTermId"])), 10, 64)
	if err != nil || term <= 0 {
		return io.ErrImmutableIdentity
	}
	targetBody := map[string]any{io.TrustedServiceCommandTenantKey: s.aimsSource.TenantCode, io.TrustedServiceCommandSourceDeploymentKey: s.aimsSource.DeploymentCode, io.TrustedServiceCommandTargetDeploymentKey: s.altocDeployment, io.TrustedServiceCommandSourceAppKey: "aims", io.TrustedServiceCommandTargetAppKey: "altoc", io.TrustedServiceCommandSourceClientKey: s.aimsSource.ServiceClientID, io.TrustedRequestIDKey: claimed.OriginalRequestID, "current_user": command["operatorUid"], io.ServiceCommandEnvelopeKey: map[string]any{"operationId": claimed.OperationID, "operationCode": claimed.Identity.OperationCode, "targetApp": "altoc", "requiredCapability": claimed.RequiredCapability, "idempotencyKey": claimed.Identity.IdempotencyKey, "commandSchemaVersion": claimed.CommandSchemaVersion, "commandSha256": claimed.Identity.CommandSHA256, "command": command}}
	receipt, err := s.altoc.ExecuteMilestoneReceivableBillableInTransaction(ctx, tx, s.altocReceiptRepository, strconv.FormatInt(term, 10), targetBody)
	if err != nil {
		return err
	}
	evidence := io.ReceiptEvidence{ReceiptID: fmt.Sprint(receipt["receiptId"]), OperationID: fmt.Sprint(receipt["operationId"]), OperationCode: fmt.Sprint(receipt["operationCode"]), IdempotencyKey: fmt.Sprint(receipt["idempotencyKey"]), CommandSchemaVersion: fmt.Sprint(receipt["commandSchemaVersion"]), CommandSHA256: fmt.Sprint(receipt["commandSha256"]), TargetBizType: fmt.Sprint(receipt["targetBizType"]), TargetBizCode: fmt.Sprint(receipt["targetBizCode"]), ResponseSummarySHA256: fmt.Sprint(receipt["responseSummarySha256"])}
	expected := io.ReceiptEvidence{OperationID: claimed.OperationID, OperationCode: claimed.Identity.OperationCode, IdempotencyKey: claimed.Identity.IdempotencyKey, CommandSchemaVersion: claimed.CommandSchemaVersion, CommandSHA256: claimed.Identity.CommandSHA256, TargetBizType: "receivable_plan_set", TargetBizCode: fmt.Sprintf("payment-term:%d", term)}
	if err = io.ValidateReceiptEvidence(expected, evidence); err != nil {
		return err
	}
	_, err = s.aimsSourceRepository.RecordSuccessWithMutationInTransaction(ctx, tx, io.RecordSuccessInput{Lease: io.CompletionLease{OperationID: claimed.OperationID, Worker: claimed.Worker, FencingToken: claimed.FencingToken}, Now: time.Now().UTC(), HTTPStatus: 200, TargetReceiptID: evidence.ReceiptID, TargetBizType: expected.TargetBizType, TargetBizCode: expected.TargetBizCode, ResponseSummarySHA256: evidence.ResponseSummarySHA256}, nil)
	return err
}

// A lease that cannot be claimed is not proof of completion. Only an exact
// durable source/target receipt pair permits a successful callback replay.
func (s *MilestoneReceivableService) verifyCompletedOperation(ctx context.Context, tx *sql.Tx, key string, result map[string]any) error {
	table, err := s.aimsSource.OperationTable()
	if err != nil {
		return err
	}
	var matched int
	err = tx.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %s o JOIN %s r
 ON r.receipt_id=o.target_receipt_id AND r.operation_id=o.operation_id
 AND r.tenant_code=o.tenant_code AND r.source_deployment_code=o.deployment_code
 AND r.deployment_code=? AND r.source_app=o.source_app AND r.target_app=o.target_app
 AND r.operation_code=o.operation_code AND r.required_capability=o.required_capability
 AND r.idempotency_key=o.idempotency_key AND r.command_schema_version=o.command_schema_version
 AND r.command_sha256=o.command_sha256 AND r.target_biz_type=o.target_biz_type
 AND r.target_biz_code=o.target_biz_code AND r.response_summary_sha256=o.response_summary_sha256
 WHERE o.tenant_code=? AND o.deployment_code=? AND o.source_app='aims' AND o.target_app='altoc'
 AND o.operation_code='aims.milestone.receivable-billable.v1' AND o.operation_key=?
 AND o.status='succeeded' AND r.status='succeeded'
 AND o.locked_by IS NULL AND o.locked_until IS NULL AND r.locked_by IS NULL AND r.locked_until IS NULL`, table, s.altocReceiptTable),
		s.altocDeployment, s.aimsSource.TenantCode, s.aimsSource.DeploymentCode, key).Scan(&matched)
	if err != nil {
		return err
	}
	if matched == 1 {
		return nil
	}
	// A previously completed milestone without a payment term has no operation.
	// Do not mistake an occupied or missing linked operation for this case.
	var term sql.NullInt64
	if err = tx.QueryRowContext(ctx, "SELECT payment_term_id FROM milestones WHERE id=? FOR UPDATE", result["milestoneId"]).Scan(&term); err != nil {
		return err
	}
	if !term.Valid {
		var count int
		if err = tx.QueryRowContext(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE tenant_code=? AND deployment_code=? AND source_app='aims' AND operation_key=?", table), s.aimsSource.TenantCode, s.aimsSource.DeploymentCode, key).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return nil
		}
	}
	return io.ErrReceiptInProgress
}
