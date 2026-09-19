package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// EnterpriseWorkItemDistributionCapabilities are the exact service capabilities
// for confirming or revoking a target's task distribution on the unified path.
var EnterpriseWorkItemDistributionCapabilities = map[string]string{
	"confirm-distribute": "aims:work-item-distribute-confirm:execute",
	"revoke-distribute":  "aims:work-item-distribute-revoke:execute",
	"confirm-append":     "aims:work-item-append-confirm:execute",
	"reject-append":      "aims:work-item-append-reject:execute",
}

// Receipt command schema versions are stored in a VARCHAR(30) column, so they
// are explicit short identifiers rather than derived from the action name.
var enterpriseWorkItemDistributionSchemaVersions = map[string]string{
	"confirm-distribute": "distribution-confirm.v1",
	"revoke-distribute":  "distribution-revoke.v1",
	"confirm-append":     "append-confirm.v1",
	"reject-append":      "append-reject.v1",
}

// Confirm moves every planned child task to todo; revoke moves every todo child
// back to planning. Append decisions act only on planned tasks added while the
// target executes: confirm moves them to todo, reject removes them. The target's
// own status is decided by its execution flow.
var enterpriseWorkItemDistributionEdges = map[string][2]string{
	"confirm-distribute": {"planning", "todo"},
	"revoke-distribute":  {"todo", "planning"},
	"confirm-append":     {"planning", "todo"},
	"reject-append":      {"planning", "removed"},
}

// DistributeEnterpriseWorkItem is the unified form of confirm-distribute and
// revoke-distribute. The target, its children, receipt and audit are written
// in one registry-bound transaction.
func (a *Adapter) DistributeEnterpriseWorkItem(ctx context.Context, id EnterpriseProjectUpdateIdentity, projectID, itemID, action string, command map[string]any) (map[string]any, error) {
	capability, ok := EnterpriseWorkItemDistributionCapabilities[action]
	expected, _ := command["expectedVersion"].(string)
	if !ok || len(command) != 1 || len(expected) != 64 || len(id.Personnel) > 0 {
		return nil, httperror.New(400, "work_item_distribution_input_invalid", "A supported action and content version are required")
	}
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	base := EnterpriseProjectCreateIdentity{Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID, IdempotencyKey: id.IdempotencyKey}
	receipt, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "action": action, "input": command, "projectScope": id.ProjectScope})
	if err != nil {
		return nil, err
	}
	receipt.OperationCode = "enterprise.aims.work-items." + action + ".v1"
	receipt.RequiredCapability = capability
	receipt.CommandSchemaVersion = enterpriseWorkItemDistributionSchemaVersions[action]
	tx, receipts, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	edge := enterpriseWorkItemDistributionEdges[action]
	result, err := receipts.ExecuteInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		var leader, lifecycle string
		if err := tx.QueryRowContext(ctx, "SELECT leader_uid,lifecycle_status FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&leader, &lifecycle); err != nil {
			return iop.ReceiptBusinessResult{}, err
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
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_version_conflict", "Work item changed; reload before changing distribution")
		}
		if aimsMapText(item, "tier") != "target" {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "not_target", "Only target work items support task distribution")
		}
		if (action == "confirm-distribute" || action == "confirm-append") && aimsMapText(item, "type") == "requirement" {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "requirement_flow", "Requirement work items use the requirement review flow")
		}
		// Revoking reopens planning on the whole distribution, so it keeps the
		// legacy project-manager rule.
		if action == "revoke-distribute" {
			if err := requireEnterpriseProjectManagerTx(ctx, tx, id, projectID, leader); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		if err := a.requireEnterpriseWorkItemReviewUnlockedTx(ctx, tx, item); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if mid := serviceBodyInt(item, "milestone_id"); mid > 0 {
			if err := requireMilestoneCompletionUnlockedTx(ctx, tx, int64(mid)); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		children, err := lockEnterpriseDistributionChildren(ctx, tx, itemID)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		for _, child := range children {
			if child.project != projectID {
				return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_child_project_mismatch", "A child task belongs to another project")
			}
		}
		affected := children
		if action == "confirm-append" || action == "reject-append" {
			affected = nil
			for _, child := range children {
				if child.status == "planning" {
					affected = append(affected, child)
				}
			}
			if action == "confirm-append" && len(affected) == 0 {
				return iop.ReceiptBusinessResult{}, httperror.New(409, "no_planning_children", "There are no appended tasks to confirm")
			}
		} else {
			if len(children) == 0 {
				return iop.ReceiptBusinessResult{}, httperror.New(409, "no_children", "The target has no distributed tasks")
			}
			var blocked []string
			for _, child := range children {
				if child.status != edge[0] {
					blocked = append(blocked, fmt.Sprintf("%s[%s]", child.itemKey, child.status))
				}
			}
			if len(blocked) > 0 {
				if len(blocked) > 3 {
					blocked = blocked[:3]
				}
				code := "children_locked"
				if action == "revoke-distribute" {
					code = "children_not_todo"
				}
				return iop.ReceiptBusinessResult{}, httperror.New(409, code, "Every child task must be "+edge[0]+": "+strings.Join(blocked, ", "))
			}
		}
		affectedIDs := make([]string, 0, len(affected))
		for _, child := range affected {
			affectedIDs = append(affectedIDs, child.id)
			if action == "reject-append" {
				// A rejected task gives back any target deliverable it claimed
				// instead of deleting it, then its own deliverables go with it.
				if _, err := tx.ExecContext(ctx, "UPDATE deliverables SET matter_id=NULL WHERE matter_id=? AND target_id IS NOT NULL", child.id); err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
				if _, err := tx.ExecContext(ctx, "DELETE FROM deliverables WHERE matter_id=? AND target_id IS NULL", child.id); err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
				if _, err := tx.ExecContext(ctx, "DELETE FROM work_items WHERE id=? AND status='planning'", child.id); err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
				continue
			}
			if _, err := tx.ExecContext(ctx, "UPDATE work_items SET status=?,updated_at=UTC_TIMESTAMP(6) WHERE id=? AND status=?", edge[1], child.id, edge[0]); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO work_item_changelog(work_item_id,field_name,old_value,new_value,changed_by) VALUES(?,'status',?,?,?)", child.id, edge[0], edge[1], id.ActorUID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		raw, _ := json.Marshal(map[string]any{"from": edge[0], "to": edge[1], "transition": action, "mattersUpdated": len(affected), "workItemIds": affectedIDs})
		if _, err := tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,?,?,?,?)", projectID, itemID, action, id.ActorUID, raw, id.IdempotencyKey); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		_, afterVersion, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, false)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "work_item", TargetBizCode: itemID, HTTPStatus: 200, Value: map[string]any{"targetId": itemID, "mattersUpdated": len(affected), "workItemIds": affectedIDs, "editVersion": afterVersion}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing, "result": result.Value}, nil
}

type enterpriseDistributionChild struct {
	id, project, itemKey, status string
}

func lockEnterpriseDistributionChildren(ctx context.Context, tx *sql.Tx, itemID string) ([]enterpriseDistributionChild, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id,project_id,item_key,status FROM work_items WHERE parent_id=? AND tier='matter' ORDER BY id FOR UPDATE", itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var children []enterpriseDistributionChild
	for rows.Next() {
		var child enterpriseDistributionChild
		if err := rows.Scan(&child.id, &child.project, &child.itemKey, &child.status); err != nil {
			return nil, err
		}
		child.status = strings.TrimSpace(child.status)
		children = append(children, child)
	}
	return children, rows.Err()
}

// enterpriseDistributionScope accepts only the trusted project-admin scope keys
// the Host compiles from the actor's scoped authorization.
func enterpriseDistributionScope(id EnterpriseProjectUpdateIdentity) (url.Values, error) {
	scope := url.Values{"current_user": {id.ActorUID}}
	for key, value := range id.ProjectScope {
		if !strings.HasPrefix(key, "current_user_project_admin_") && key != "current_user_is_project_admin" && key != "current_user_dept_codes" && key != "current_user_management_dept_codes" {
			return nil, httperror.New(400, "work_item_scope_invalid", "Unsupported trusted project scope")
		}
		scope.Set(key, value)
	}
	return scope, nil
}
