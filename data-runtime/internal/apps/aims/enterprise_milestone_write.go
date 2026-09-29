package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseMilestoneTxKey struct{}
type milestoneSQL interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (a *Adapter) milestoneDB(ctx context.Context) milestoneSQL {
	if tx, ok := ctx.Value(enterpriseMilestoneTxKey{}).(*sql.Tx); ok {
		return tx
	}
	return a.DB()
}

// Only the server-authenticated project command context enables this lane.
// Lock the owning project before the milestone, then recheck its ownership.
func (a *Adapter) enterpriseMilestoneWrite(ctx context.Context, projectID, milestoneID int64, query url.Values, write func(context.Context) (any, error), receipt *enterprisePlanReceiptConfig) (any, error) {
	id, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enabled {
		return write(ctx)
	}
	if id.ActorUID != query.Get("current_user") || id.CommandScope == nil {
		return nil, httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	if id.Tenant != "" && !validDeliverableReceiptIdentity(ctx) {
		return nil, httperror.New(400, "idempotency_key_required", "Idempotency-Key is required")
	}
	if milestoneID > 0 {
		if err := a.DB().QueryRowContext(ctx, "SELECT project_id FROM milestones WHERE id=?", milestoneID).Scan(&projectID); err != nil {
			if err == sql.ErrNoRows {
				return nil, httperror.New(404, "milestone_not_found", "Milestone not found")
			}
			return nil, err
		}
	}
	tx, repo, err := a.beginDeliverableWrite(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = requireEnterpriseDeliverableProjectScopeTx(ctx, tx, id.ActorUID, projectID, true); err != nil {
		return nil, err
	}
	if milestoneID > 0 {
		var actual int64
		if err = tx.QueryRowContext(ctx, "SELECT project_id FROM milestones WHERE id=? FOR UPDATE", milestoneID).Scan(&actual); err != nil {
			if err == sql.ErrNoRows {
				return nil, httperror.New(404, "milestone_not_found", "Milestone not found")
			}
			return nil, err
		}
		if actual != projectID {
			return nil, httperror.New(409, "milestone_project_changed", "Milestone owner changed")
		}
	}
	writeCtx := context.WithValue(ctx, enterpriseMilestoneTxKey{}, tx)
	var result any
	if receipt == nil {
		result, err = write(writeCtx)
	} else {
		result, err = executeEnterprisePlanReceipt(writeCtx, tx, repo, *receipt, func(ctx context.Context) (map[string]any, error) {
			if milestoneID > 0 {
				if err := requireMilestoneCompletionUnlockedTx(ctx, tx, milestoneID); err != nil {
					return nil, err
				}
			}
			value, err := write(ctx)
			if err != nil {
				return nil, err
			}
			if row, ok := value.(map[string]any); ok {
				return row, nil
			}
			if strings.HasSuffix(receipt.Action, "-delete") {
				return map[string]any{"id": milestoneID, "projectId": projectID, "deleted": true}, nil
			}
			return map[string]any{"id": milestoneID, "projectId": projectID, "updated": true}, nil
		})
	}
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}

func (a *Adapter) createProjectMilestone(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	if err := rejectEnterpriseMilestoneCompletionFields(ctx, body); err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	receipt := enterprisePlanReceiptConfig{Action: "milestone-create", Capability: "aims:project-milestones:edit", BizType: "milestone", Command: map[string]any{"projectId": rawProjectID, "payload": body}, BizCode: func(value map[string]any) string {
		return fmt.Sprint(projectID) + ":" + fmt.Sprint(value["id"])
	}, Replay: func(_ context.Context, code string) (map[string]any, error) {
		id, err := milestoneReceiptID(code, projectID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": id}, nil
	}}
	result, err := a.enterpriseMilestoneWrite(ctx, projectID, 0, query, func(ctx context.Context) (any, error) {
		return a.createProjectMilestoneBody(ctx, rawProjectID, query, body)
	}, &receipt)
	if err != nil {
		return nil, err
	}
	row, ok := result.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("milestone create returned unexpected result")
	}
	return row, nil
}
func (a *Adapter) updateDirectMilestone(ctx context.Context, rawID string, query url.Values, body map[string]any) (any, error) {
	if err := rejectEnterpriseMilestoneCompletionFields(ctx, body); err != nil {
		return nil, err
	}
	milestoneID, err := parseID(rawID, "milestone_id")
	if err != nil {
		return nil, err
	}
	receipt := enterprisePlanReceiptConfig{Action: "milestone-update", Capability: "aims:project-milestones:edit", BizType: "milestone", Command: map[string]any{"milestoneId": rawID, "payload": body}, BizCode: func(value map[string]any) string {
		return fmt.Sprint(value["projectId"]) + ":" + rawID
	}, Replay: func(_ context.Context, code string) (map[string]any, error) {
		parts := strings.SplitN(code, ":", 2)
		if len(parts) != 2 || parts[1] != rawID {
			return nil, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
		}
		return map[string]any{"id": milestoneID, "updated": true}, nil
	}}
	return a.enterpriseMilestoneWrite(ctx, 0, milestoneID, query, func(ctx context.Context) (any, error) {
		return a.updateDirectMilestoneBody(ctx, rawID, query, body)
	}, &receipt)
}

// Host milestone CRUD cannot change completion state; that transition belongs
// exclusively to the verified Workflow callback. Standalone Aims keeps its
// existing command contract until its separate migration.
func rejectEnterpriseMilestoneCompletionFields(ctx context.Context, body map[string]any) error {
	if _, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); !enterprise {
		return nil
	}
	for _, key := range []string{
		"status", "statusCode", "status_code", "lifecycleStatus", "lifecycle_status",
		"completed", "isCompleted", "is_completed", "completedAt", "completed_at",
		"closed", "isClosed", "is_closed", "closedAt", "closed_at",
		"completionLockRequestId", "completion_lock_request_id",
	} {
		if _, supplied := body[key]; supplied {
			return httperror.New(400, "milestone_completion_workflow_required", "milestone completion requires Workflow approval")
		}
	}
	return nil
}
func (a *Adapter) deleteDirectMilestone(ctx context.Context, rawID string, query url.Values) (any, error) {
	milestoneID, err := parseID(rawID, "milestone_id")
	if err != nil {
		return nil, err
	}
	if _, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); enterprise {
		var owner int64
		err := a.DB().QueryRowContext(ctx, "SELECT project_id FROM milestones WHERE id=?", milestoneID).Scan(&owner)
		if err == sql.ErrNoRows {
			return a.replayDeletedEnterpriseMilestone(ctx, milestoneID, query)
		}
		if err != nil {
			return nil, err
		}
	}
	receipt := enterprisePlanReceiptConfig{Action: "milestone-delete", Capability: "aims:project-milestones:edit", BizType: "milestone", Command: map[string]any{"milestoneId": rawID}, BizCode: func(value map[string]any) string {
		return fmt.Sprint(value["projectId"]) + ":" + rawID
	}, Replay: func(_ context.Context, code string) (map[string]any, error) {
		parts := strings.SplitN(code, ":", 2)
		if len(parts) != 2 || parts[1] != rawID {
			return nil, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
		}
		return map[string]any{"id": milestoneID, "deleted": true}, nil
	}}
	return a.enterpriseMilestoneWrite(ctx, 0, milestoneID, query, func(ctx context.Context) (any, error) {
		return a.deleteDirectMilestoneBody(ctx, rawID, query)
	}, &receipt)
}

func (a *Adapter) replayDeletedEnterpriseMilestone(ctx context.Context, milestoneID int64, query url.Values) (any, error) {
	identity, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || !validDeliverableReceiptIdentity(ctx) || identity.ActorUID != query.Get("current_user") {
		return nil, httperror.New(404, "milestone_not_found", "Milestone not found")
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
	var status, code, originalActor string
	err = a.DB().QueryRowContext(ctx, `SELECT status,COALESCE(target_biz_code,''),COALESCE(original_actor_uid,'') FROM `+table+`
		WHERE tenant_code=? AND source_deployment_code=? AND deployment_code=?
		  AND source_app='enterprise' AND target_app='aims' AND operation_code=? AND idempotency_key=?`,
		identity.Tenant, identity.SourceDeployment, identity.TargetDeployment,
		"enterprise.aims.plan.milestone-delete.v1", identity.IdempotencyKey).Scan(&status, &code, &originalActor)
	if err == sql.ErrNoRows {
		return nil, httperror.New(404, "milestone_not_found", "Milestone not found")
	}
	if err != nil {
		return nil, err
	}
	if status != "succeeded" || originalActor != identity.ActorUID {
		return nil, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
	}
	parts := strings.SplitN(code, ":", 2)
	if len(parts) != 2 || parts[1] != strconv.FormatInt(milestoneID, 10) {
		return nil, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
	}
	projectID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || projectID <= 0 {
		return nil, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
	}
	receipt := enterprisePlanReceiptConfig{Action: "milestone-delete", Capability: "aims:project-milestones:edit", BizType: "milestone", Command: map[string]any{"milestoneId": strconv.FormatInt(milestoneID, 10)}, BizCode: func(map[string]any) string { return code }, Replay: func(context.Context, string) (map[string]any, error) {
		return map[string]any{"id": milestoneID, "projectId": projectID, "deleted": true}, nil
	}}
	return a.enterpriseMilestoneWrite(ctx, projectID, 0, query, func(context.Context) (any, error) {
		return nil, httperror.New(404, "milestone_not_found", "Milestone not found")
	}, &receipt)
}

func milestoneReceiptID(code string, projectID int64) (int64, error) {
	parts := strings.SplitN(code, ":", 2)
	if len(parts) != 2 || parts[0] != strconv.FormatInt(projectID, 10) {
		return 0, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(409, "receipt_result_unavailable", "Plan command result is unavailable")
	}
	return id, nil
}
