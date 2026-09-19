package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var EnterpriseWorkItemStateCapabilities = map[string]string{
	"start": "aims:work-item-start:execute", "reset": "aims:work-item-reset:execute", "reopen": "aims:work-item-reopen:execute",
}

// These are the V2 target/matter actions, not the retired task/pause model.
var enterpriseWorkItemStateEdges = map[string][2]string{
	"start": {"todo", "in_progress"}, "reset": {"in_progress", "todo"}, "reopen": {"completed", "in_progress"},
}

func validateEnterpriseWorkItemTransitionTx(ctx context.Context, tx *sql.Tx, project, tier, action, from, to string) error {
	var projectRules int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM workflow_transitions WHERE project_id=? AND entity_type=? FOR UPDATE", project, tier).Scan(&projectRules); err != nil {
		return err
	}
	var found int
	query := "SELECT COUNT(*) FROM workflow_transitions WHERE project_id=? AND entity_type=? AND transition_key=? AND from_status=? AND to_status=? FOR UPDATE"
	args := []any{project, tier, action, from, to}
	if projectRules == 0 {
		query = "SELECT COUNT(*) FROM workflow_transitions WHERE project_id IS NULL AND entity_type=? AND transition_key=? AND from_status=? AND to_status=? FOR UPDATE"
		args = args[1:]
	}
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&found); err != nil {
		return err
	}
	if found != 1 {
		return httperror.New(409, "work_item_transition_unavailable", "The configured project transition does not allow this action")
	}
	return nil
}

func (a *Adapter) TransitionEnterpriseWorkItem(ctx context.Context, id EnterpriseProjectUpdateIdentity, projectID, itemID, action string, command map[string]any) (map[string]any, error) {
	capability, ok := EnterpriseWorkItemStateCapabilities[action]
	expected, _ := command["expectedVersion"].(string)
	if !ok || len(command) != 1 || len(expected) != 64 || len(id.Personnel) > 0 {
		return nil, httperror.New(400, "work_item_state_input_invalid", "A supported action and content version are required")
	}
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	if a.enterpriseWrites.workerDeployment == "" {
		return nil, httperror.New(503, "work_item_state_worker_unbound", "Formal Aims worker deployment is required")
	}
	base := EnterpriseProjectCreateIdentity{Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID, IdempotencyKey: id.IdempotencyKey}
	receipt, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "action": action, "input": command, "projectScope": id.ProjectScope})
	if err != nil {
		return nil, err
	}
	receipt.OperationCode = "enterprise.aims.work-items." + action + ".v1"
	receipt.RequiredCapability = capability
	receipt.CommandSchemaVersion = "work-item-" + action + ".v1"
	tx, receipts, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := receipts.ExecuteInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		var leader, lifecycle string
		if err := tx.QueryRowContext(ctx, "SELECT leader_uid,lifecycle_status FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&leader, &lifecycle); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		var member int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_members WHERE project_id=? AND uid=? AND status='active' FOR UPDATE", projectID, id.ActorUID).Scan(&member); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}

		scope := url.Values{"current_user": {id.ActorUID}}
		for key, value := range id.ProjectScope {
			if !strings.HasPrefix(key, "current_user_project_admin_") && key != "current_user_is_project_admin" && key != "current_user_dept_codes" && key != "current_user_management_dept_codes" {
				return iop.ReceiptBusinessResult{}, httperror.New(400, "work_item_scope_invalid", "Unsupported trusted project scope")
			}
			scope.Set(key, value)
		}
		where, args := projectScopedAdminWhere(scope, "p")
		var scoped int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p WHERE p.id=? AND ("+where+") FOR UPDATE", append([]any{projectID}, args...)...).Scan(&scoped); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if leader != id.ActorUID && member == 0 && scoped == 0 {
			return iop.ReceiptBusinessResult{}, httperror.New(403, "project_access_denied", "Active project access is required")
		}
		if lifecycle != "active" {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "project_not_active", "Project must be active")
		}
		item, version, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, true)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if fmt.Sprint(item["project_id"]) != projectID {
			return iop.ReceiptBusinessResult{}, httperror.New(403, "work_item_project_mismatch", "Work item is outside the authorized project")
		}
		if version != expected {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_version_conflict", "Work item changed; reload before changing state")
		}
		tier := aimsMapText(item, "tier")
		edge := enterpriseWorkItemStateEdges[action]
		if (tier != "target" && tier != "matter") || aimsMapText(item, "status") != edge[0] {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_state_conflict", "Current state does not permit this action")
		}
		if err := a.requireEnterpriseWorkItemReviewUnlockedTx(ctx, tx, item); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if mid := serviceBodyInt(item, "milestone_id"); mid > 0 {
			if err := requireMilestoneCompletionUnlockedTx(ctx, tx, int64(mid)); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		if err := validateEnterpriseWorkItemTransitionTx(ctx, tx, projectID, tier, action, edge[0], edge[1]); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if tier == "target" && action == "start" {
			if leader != id.ActorUID {
				return iop.ReceiptBusinessResult{}, httperror.New(403, "work_item_start_leader_required", "Only the project leader starts target execution")
			}
			rows, err := tx.QueryContext(ctx, "SELECT project_id,status FROM work_items WHERE parent_id=? ORDER BY id FOR UPDATE", itemID)
			if err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			count := 0
			valid := true
			for rows.Next() {
				var project, status string
				if err := rows.Scan(&project, &status); err != nil {
					rows.Close()
					return iop.ReceiptBusinessResult{}, err
				}
				count++
				valid = valid && project == projectID && strings.TrimSpace(status) != "planning"
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if count == 0 || !valid {
				return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_target_not_distributed", "Target must have distributed children before execution")
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE work_items SET status=?,updated_at=UTC_TIMESTAMP(6) WHERE id=?", edge[1], itemID); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		outbound := base
		outbound.TargetDeployment = a.enterpriseWrites.workerDeployment
		if _, err := a.enqueueServiceTicketDeliveryOperationTx(ctx, tx, itemID, enterpriseCompletionStatusBody(outbound, edge[1])); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		changes := map[string]any{"from": edge[0], "to": edge[1], "transition": action}
		raw, _ := json.Marshal(changes)
		if _, err := tx.ExecContext(ctx, "INSERT INTO work_item_changelog(work_item_id,field_name,old_value,new_value,changed_by) VALUES(?,'status',?,?,?)", itemID, edge[0], edge[1], id.ActorUID); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,?,?,?,?)", projectID, itemID, action, id.ActorUID, raw, id.IdempotencyKey); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		_, afterVersion, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, false)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "work_item", TargetBizCode: itemID, HTTPStatus: 200, Value: map[string]any{"id": itemID, "status": edge[1], "editVersion": afterVersion}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing, "result": result.Value}, nil
}

func (a *Adapter) EnterpriseWorkItemStateActions(ctx context.Context, itemID, actor string, scope url.Values) ([]string, error) {
	actions := []string{}
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	reader := a.enterpriseWrites.writer
	reader.Operation = e.Read
	tx, _, err := a.enterpriseWrites.registry.BeginSnapshotReadTransaction(ctx, reader)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	item, _, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, false)
	if err != nil {
		return nil, err
	}
	where, args := projectScopedAdminWhere(scope, "p")
	var allowed int
	var leader, lifecycle string
	if err = tx.QueryRowContext(ctx, "SELECT p.leader_uid,p.lifecycle_status,(p.leader_uid=? OR EXISTS(SELECT 1 FROM aims_project_members m WHERE m.project_id=p.id AND m.uid=? AND m.status='active') OR ("+where+")) FROM aims_projects p WHERE p.id=?", append(append([]any{actor, actor}, args...), item["project_id"])...).Scan(&leader, &lifecycle, &allowed); err != nil {
		return nil, err
	}
	if allowed == 1 && lifecycle == "active" {
		locked := false
		if mid := serviceBodyInt(item, "milestone_id"); mid > 0 {
			var lock sql.NullInt64
			if err = tx.QueryRowContext(ctx, "SELECT completion_lock_request_id FROM milestones WHERE id=?", mid).Scan(&lock); err != nil {
				return nil, err
			}
			locked = lock.Valid
		}
		if _, ok := a.enterpriseWrites.binding.Domains["aims"].Tables["work_item_completion_requests"]; ok {
			var count int
			if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_item_completion_requests WHERE active_work_item_id IN (?,?)", itemID, item["parent_id"]).Scan(&count); err != nil {
				return nil, err
			}
			locked = locked || count > 0
		}
		if !locked {
			var projectRules int
			if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM workflow_transitions WHERE project_id=? AND entity_type=?", item["project_id"], item["tier"]).Scan(&projectRules); err != nil {
				return nil, err
			}
			for _, action := range []string{"start", "reset", "reopen"} {
				edge := enterpriseWorkItemStateEdges[action]
				if aimsMapText(item, "status") != edge[0] {
					continue
				}
				query := "SELECT COUNT(*) FROM workflow_transitions WHERE project_id=? AND entity_type=? AND transition_key=? AND from_status=? AND to_status=?"
				args := []any{item["project_id"], item["tier"], action, edge[0], edge[1]}
				if projectRules == 0 {
					query = "SELECT COUNT(*) FROM workflow_transitions WHERE project_id IS NULL AND entity_type=? AND transition_key=? AND from_status=? AND to_status=?"
					args = args[1:]
				}
				var count int
				if err = tx.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
					return nil, err
				}
				if count != 1 {
					continue
				}
				if aimsMapText(item, "tier") == "target" && action == "start" {
					if leader != actor {
						continue
					}
					var childCount, bad int
					if err = tx.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM(project_id<>? OR status='planning'),0) FROM work_items WHERE parent_id=?", item["project_id"], itemID).Scan(&childCount, &bad); err != nil {
						return nil, err
					}
					if childCount == 0 || bad != 0 {
						continue
					}
				}
				if tier := aimsMapText(item, "tier"); tier == "target" || tier == "matter" {
					actions = append(actions, action)
				}
			}
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return actions, nil
}
