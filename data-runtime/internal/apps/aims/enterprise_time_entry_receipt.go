package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type timeEntryReceiptConfig[T any] struct {
	Action, Capability string
	Command            map[string]any
	BizCode            func(T) string
	Replay             func(context.Context, string) (T, error)
	Decorate           func(T, string, bool) T
}

func (a *Adapter) beginTimeEntryWrite(ctx context.Context, id EnterpriseProjectUpdateIdentity) (*sql.Tx, *iop.ReceiptRepository, error) {
	if id.IdempotencyKey == "" {
		tx, err := a.DB().BeginTx(ctx, nil)
		return tx, nil, err
	}
	return a.beginEnterpriseWrite(ctx, EnterpriseProjectCreateIdentity{
		Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment,
		ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID,
		IdempotencyKey: id.IdempotencyKey,
	})
}

func executeTimeEntryReceipt[T any](ctx context.Context, tx *sql.Tx, repo *iop.ReceiptRepository, config timeEntryReceiptConfig[T], write func(context.Context) (T, error)) (T, error) {
	if repo == nil {
		return write(ctx)
	}
	var zero T
	input, err := enterpriseDeliverableReceiptInput(ctx, config.Action, config.Capability, "time-entry.v1", config.Command)
	if err != nil {
		return zero, err
	}
	input.OperationCode = "enterprise.aims.time-entries." + config.Action + ".v1"
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(writeCtx context.Context, _ *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		value, err := write(writeCtx)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "time-entry", TargetBizCode: config.BizCode(value), HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return zero, aimsContractActivationReceiptError(err)
	}
	value, ok := result.Value.(T)
	if !ok {
		value, err = config.Replay(ctx, result.TargetBizCode)
		if err != nil {
			return zero, err
		}
	}
	return config.Decorate(value, result.ReceiptID, result.Existing), nil
}

func timeEntryIDCode(item timeEntryItem) string { return strconv.FormatInt(item.ID, 10) }
func timeEntryReplay(a *Adapter, ctx context.Context, code string) (timeEntryItem, error) {
	id, err := strconv.ParseInt(code, 10, 64)
	if err != nil || id <= 0 {
		return timeEntryItem{}, httperror.New(503, "time_entry_receipt_corrupt", "Time entry receipt invalid")
	}
	item, err := a.getTimeEntry(ctx, id)
	if denied, ok := err.(httperror.Error); ok && denied.Status == 404 {
		return timeEntryItem{ID: id}, nil
	}
	return item, err
}
func decorateTimeEntry(item timeEntryItem, receipt string, existing bool) timeEntryItem {
	item.ReceiptID, item.Idempotent = receipt, &existing
	return item
}
func decorateTimeEntryDelete(value map[string]any, receipt string, existing bool) map[string]any {
	result := make(map[string]any, len(value)+2)
	for key, item := range value {
		result[key] = item
	}
	result["receiptId"], result["idempotent"] = receipt, existing
	return result
}

func (a *Adapter) replayDeletedProjectTimeEntry(ctx context.Context, projectID, entryID string, query url.Values) (map[string]any, error) {
	id, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || !validDeliverableReceiptIdentity(ctx) || id.ActorUID != strings.TrimSpace(firstQueryText(query, "current_user")) {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}
	if a.enterpriseWrites == nil {
		return nil, httperror.New(503, "enterprise_aims_writer_unavailable", "Unified Aims writer is not configured")
	}
	resolved, err := a.enterpriseWrites.registry.Resolve(a.enterpriseWrites.writer)
	if err != nil {
		return nil, err
	}
	table, err := resolved.Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	var status, owner, storedProject string
	err = a.DB().QueryRowContext(ctx, `SELECT status,COALESCE(original_actor_uid,''),COALESCE(target_biz_code,'') FROM `+table+`
		WHERE tenant_code=? AND source_deployment_code=? AND deployment_code=? AND source_app='enterprise' AND target_app='aims' AND operation_code=? AND idempotency_key=?`,
		id.Tenant, id.SourceDeployment, id.TargetDeployment, "enterprise.aims.time-entries.project-delete.v1", id.IdempotencyKey).Scan(&status, &owner, &storedProject)
	if err == sql.ErrNoRows {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}
	if err != nil {
		return nil, err
	}
	if status != "succeeded" || owner != id.ActorUID || storedProject != projectID {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}
	config := timeEntryReceiptConfig[map[string]any]{Action: "project-delete", Capability: "aims:project-time-entries:edit", Command: map[string]any{"projectId": projectID, "entryId": entryID}, BizCode: func(map[string]any) string { return projectID }, Replay: func(context.Context, string) (map[string]any, error) {
		return map[string]any{"id": entryID, "deleted": true}, nil
	}, Decorate: decorateTimeEntryDelete}
	return enterpriseTimeEntryWrite(a, ctx, projectID, "", query, func(context.Context) (map[string]any, error) {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}, config)
}

func (a *Adapter) replayDeletedWorkItemTimeEntry(ctx context.Context, workItemID, entryID string, query url.Values) (map[string]any, error) {
	id, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || !validDeliverableReceiptIdentity(ctx) || id.ActorUID != strings.TrimSpace(firstQueryText(query, "current_user")) {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}
	if a.enterpriseWrites == nil {
		return nil, httperror.New(503, "enterprise_aims_writer_unavailable", "Unified Aims writer is not configured")
	}
	resolved, err := a.enterpriseWrites.registry.Resolve(a.enterpriseWrites.writer)
	if err != nil {
		return nil, err
	}
	table, err := resolved.Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	var status, owner, storedWorkItem string
	err = a.DB().QueryRowContext(ctx, `SELECT status,COALESCE(original_actor_uid,''),COALESCE(target_biz_code,'') FROM `+table+`
		WHERE tenant_code=? AND source_deployment_code=? AND deployment_code=? AND source_app='enterprise' AND target_app='aims' AND operation_code=? AND idempotency_key=?`,
		id.Tenant, id.SourceDeployment, id.TargetDeployment, "enterprise.aims.time-entries.work-item-delete.v1", id.IdempotencyKey).Scan(&status, &owner, &storedWorkItem)
	if err == sql.ErrNoRows {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}
	if err != nil {
		return nil, err
	}
	if status != "succeeded" || owner != id.ActorUID || storedWorkItem != workItemID {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}
	config := timeEntryReceiptConfig[map[string]any]{Action: "work-item-delete", Capability: "aims:work-item-time-entries:edit", Command: map[string]any{"workItemId": workItemID, "entryId": entryID}, BizCode: func(map[string]any) string { return workItemID }, Replay: func(context.Context, string) (map[string]any, error) {
		return map[string]any{"id": entryID, "deleted": true}, nil
	}, Decorate: decorateTimeEntryDelete}
	return enterpriseWorkItemTimeEntryWrite(a, ctx, workItemID, "", query, func(context.Context) (map[string]any, error) {
		return nil, httperror.New(404, "record_not_found", "time entry not found")
	}, config)
}
