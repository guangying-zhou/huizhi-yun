package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// The delegated Host lane carries a verified actor and a short-lived project
// permit in context. Independent Aims writes keep their existing transaction.
func (a *Adapter) beginDeliverableWrite(ctx context.Context) (*sql.Tx, *iop.ReceiptRepository, error) {
	id, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if enterprise && id.IdempotencyKey != "" {
		return a.beginEnterpriseWrite(ctx, EnterpriseProjectCreateIdentity{
			Tenant: id.Tenant, SourceDeployment: id.SourceDeployment,
			TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID,
			ServiceClientID: id.ServiceClientID, RequestID: id.RequestID,
			IdempotencyKey: id.IdempotencyKey,
		})
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	return tx, nil, err
}

func enterpriseDeliverableReceiptInput(ctx context.Context, action, capability, schema string, command map[string]any) (iop.ReceiptCommandInput, error) {
	id, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || id.IdempotencyKey == "" {
		return iop.ReceiptCommandInput{}, httperror.New(500, "enterprise_deliverable_receipt_identity_missing", "Deliverable receipt identity missing")
	}
	// The actor is part of the immutable Host user intent. Project permits and
	// request IDs are intentionally excluded so a fresh permit can replay it.
	command["actorUid"] = id.ActorUID
	input, err := enterpriseProjectCreateReceiptInput(EnterpriseProjectCreateIdentity{
		Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment,
		ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID,
		IdempotencyKey: id.IdempotencyKey,
	}, command)
	if err != nil {
		return input, err
	}
	input.OperationCode = "enterprise.aims.deliverables." + action + ".v1"
	input.RequiredCapability = capability
	input.CommandSchemaVersion = schema
	return input, nil
}

func executeEnterpriseDeliverableReceipt(ctx context.Context, tx *sql.Tx, repo *iop.ReceiptRepository, action, capability, schema, bizType string, command map[string]any, replay map[string]any, write func() (map[string]any, string, error)) (map[string]any, error) {
	if repo == nil {
		value, _, err := write()
		return value, err
	}
	input, err := enterpriseDeliverableReceiptInput(ctx, action, capability, schema, command)
	if err != nil {
		return nil, err
	}
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(_ context.Context, _ *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		value, code, err := write()
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: bizType, TargetBizCode: code, HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	value := replay
	if first, ok := result.Value.(map[string]any); ok {
		value = first
	}
	out := make(map[string]any, len(value)+2)
	for key, item := range value {
		out[key] = item
	}
	out["receiptId"] = result.ReceiptID
	out["idempotent"] = result.Existing
	return out, nil
}

func validDeliverableReceiptIdentity(ctx context.Context) bool {
	id, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	return ok && strings.TrimSpace(id.IdempotencyKey) != "" && id.Tenant != "" && id.TargetDeployment != ""
}

func deliverableReceiptCode(value any) string { return fmt.Sprint(value) }

func requireNoOpenDeliverableQualityReviewTx(ctx context.Context, tx *sql.Tx, deliverableID int64) error {
	var openCount int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM deliverable_submissions WHERE deliverable_id=? AND status IN ('preparing_review','awaiting_review')", deliverableID).Scan(&openCount); err != nil {
		return err
	}
	if openCount > 0 {
		return httperror.New(http.StatusConflict, "deliverable_document_locked_for_quality_review", "document binding cannot change while a quality review is open")
	}
	return nil
}

// A successful delete removes the deliverable row. Its receipt stores only the
// owning project ID as target_biz_code, allowing current project authorization
// to be rechecked before the old result is replayed.
func (a *Adapter) replayDeletedEnterpriseDeliverable(ctx context.Context, deliverableID int64, actor string, query url.Values) (map[string]any, error) {
	id, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || !validDeliverableReceiptIdentity(ctx) || id.ActorUID != actor {
		return nil, httperror.New(http.StatusNotFound, "deliverable_not_found", "交付物不存在")
	}
	resolved, err := a.enterpriseWrites.registry.Resolve(a.enterpriseWrites.writer)
	if err != nil {
		return nil, err
	}
	table, err := resolved.Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	var status, projectCode, originalActor string
	err = a.DB().QueryRowContext(ctx, `SELECT status,target_biz_code,COALESCE(original_actor_uid,'') FROM `+table+`
		WHERE tenant_code=? AND source_deployment_code=? AND deployment_code=?
		  AND source_app='enterprise' AND target_app='aims' AND operation_code=? AND idempotency_key=?`,
		id.Tenant, id.SourceDeployment, id.TargetDeployment, "enterprise.aims.deliverables.project-delete.v1", id.IdempotencyKey).Scan(&status, &projectCode, &originalActor)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "deliverable_not_found", "交付物不存在")
	}
	if err != nil {
		return nil, err
	}
	if status != "succeeded" || originalActor != actor {
		return nil, httperror.New(http.StatusNotFound, "deliverable_not_found", "交付物不存在")
	}
	projectID, err := strconv.ParseInt(projectCode, 10, 64)
	if err != nil || projectID <= 0 {
		return nil, httperror.New(503, "deliverable_receipt_corrupt", "Deliverable receipt invalid")
	}
	tx, repo, err := a.beginDeliverableWrite(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := a.requireProjectManagerOrScopedAdmin(ctx, projectID, actor, query); err != nil {
		return nil, err
	}
	if err := requireEnterpriseDeliverableProjectScopeTx(ctx, tx, actor, projectID, true); err != nil {
		return nil, err
	}
	out, err := executeEnterpriseDeliverableReceipt(ctx, tx, repo, "project-delete", "aims:project-deliverables:edit", "deliverable-delete.v1", "deliverable-project", map[string]any{"deliverableId": deliverableID}, map[string]any{"id": deliverableID, "deleted": true}, func() (map[string]any, string, error) {
		return nil, "", httperror.New(http.StatusNotFound, "deliverable_not_found", "交付物不存在")
	})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
