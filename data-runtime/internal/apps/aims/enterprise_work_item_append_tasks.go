package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const EnterpriseWorkItemAppendTasksCapability = "aims:work-item-append-tasks:execute"

// AppendEnterpriseWorkItemTasks is the unified form of append-tasks: while a
// target executes, a project manager replaces its planned task drafts with new
// assigned tasks and their own deliverables. The drafts wait for
// confirm-append or reject-append.
func (a *Adapter) AppendEnterpriseWorkItemTasks(ctx context.Context, id EnterpriseProjectUpdateIdentity, projectID, itemID string, command map[string]any) (map[string]any, error) {
	expected, _ := command["expectedVersion"].(string)
	rawSubtasks, _ := command["subtasks"].([]any)
	targetID, parseErr := strconv.ParseInt(itemID, 10, 64)
	if len(command) != 2 || len(expected) != 64 || len(rawSubtasks) == 0 || len(rawSubtasks) > 50 || len(id.Personnel) > 0 || parseErr != nil || targetID <= 0 {
		return nil, httperror.New(400, "work_item_append_input_invalid", "A content version and one to fifty appended tasks are required")
	}
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	supportsStartDate, err := a.hasWorkItemStartDateColumn(ctx)
	if err != nil {
		return nil, err
	}
	base := EnterpriseProjectCreateIdentity{Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID, IdempotencyKey: id.IdempotencyKey}
	receipt, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "action": "append-tasks", "input": command, "projectScope": id.ProjectScope})
	if err != nil {
		return nil, err
	}
	receipt.OperationCode = "enterprise.aims.work-items.append-tasks.v1"
	receipt.RequiredCapability = EnterpriseWorkItemAppendTasksCapability
	receipt.CommandSchemaVersion = "append-tasks.v1"
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
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_version_conflict", "Work item changed; reload before appending tasks")
		}
		if err := requireEnterpriseProjectManagerTx(ctx, tx, id, projectID, leader); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		target, err := loadDistributionTargetTx(ctx, tx, targetID, supportsStartDate)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if target.tier != "target" {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "not_target", "Only target work items accept appended tasks")
		}
		if target.itemType == "requirement" {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "requirement_flow", "Requirement work items use the requirement review flow")
		}
		if !containsString([]string{"in_progress", "in_review", "completed"}, target.status) {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "target_not_executing", "Tasks can be appended only after the target starts executing")
		}
		if err := a.requireEnterpriseWorkItemReviewUnlockedTx(ctx, tx, item); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if mid := serviceBodyInt(item, "milestone_id"); mid > 0 {
			if err := requireMilestoneCompletionUnlockedTx(ctx, tx, int64(mid)); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		subtasks, err := parseDistributionSubtasks(command, target, "追加任务", false, nil)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		// Like unified work item creation, an assignee must belong to the project.
		if err := requireEnterpriseProjectAssigneesTx(ctx, tx, projectID, leader, subtasks, "追加任务"); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		replaced, err := planningChildIDs(ctx, tx, targetID)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		for _, childID := range replaced {
			if _, err := tx.ExecContext(ctx, "UPDATE deliverables SET matter_id=NULL WHERE matter_id=? AND target_id IS NOT NULL", childID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM deliverables WHERE matter_id=? AND target_id IS NULL", childID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM work_items WHERE id=? AND status='planning'", childID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		created := make([]int64, 0, len(subtasks))
		for _, subtask := range subtasks {
			childID, err := insertDistributionChild(ctx, tx, target, subtask, id.ActorUID, targetID, supportsStartDate)
			if err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			created = append(created, childID)
			for index, deliverable := range subtask.deliverables {
				if err := insertOwnDeliverable(ctx, tx, target, childID, deliverable, index, id.ActorUID); err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
			}
		}
		raw, _ := json.Marshal(map[string]any{"transition": "append-tasks", "createdIds": created, "replacedIds": replaced})
		if _, err := tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,?,?,?,?)", projectID, itemID, "append-tasks", id.ActorUID, raw, id.IdempotencyKey); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		_, afterVersion, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, false)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "work_item", TargetBizCode: itemID, HTTPStatus: 200, Value: map[string]any{"targetId": itemID, "createdIds": created, "replacedIds": replaced, "editVersion": afterVersion}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing, "result": result.Value}, nil
}

// requireEnterpriseProjectManagerTx keeps the legacy project-manager rule inside
// the write transaction: the leader, an active manager-role member, or a
// scoped project administrator.
func requireEnterpriseProjectManagerTx(ctx context.Context, tx *sql.Tx, id EnterpriseProjectUpdateIdentity, projectID, leader string) error {
	if leader == id.ActorUID {
		return nil
	}
	scope, err := enterpriseDistributionScope(id)
	if err != nil {
		return err
	}
	where, args := projectScopedAdminWhere(scope, "p")
	var allowed int
	query := "SELECT COUNT(*) FROM aims_projects p LEFT JOIN aims_project_members pm ON pm.project_id=p.id AND pm.uid=? AND COALESCE(pm.status,'active')='active' WHERE p.id=? AND (pm.role='manager' OR (" + where + ")) FOR UPDATE"
	if err := tx.QueryRowContext(ctx, query, append([]any{id.ActorUID, projectID}, args...)...).Scan(&allowed); err != nil {
		return err
	}
	if allowed == 0 {
		return httperror.New(403, "work_item_distribution_manager_required", "Only the project leader, a project manager or a scoped project administrator can change task distribution")
	}
	return nil
}

// loadDistributionTargetTx is loadDistributionTarget inside the write
// transaction, locking the target and reading its milestone bounds.
func loadDistributionTargetTx(ctx context.Context, tx *sql.Tx, workItemID int64, supportsStartDate bool) (distributionTargetRow, error) {
	startDateExpr := "NULL"
	if supportsStartDate {
		startDateExpr = "DATE_FORMAT(wi.start_date, '%Y-%m-%d')"
	}
	var row distributionTargetRow
	var estimatedHours sql.NullFloat64
	err := tx.QueryRowContext(ctx, `
		SELECT wi.id, wi.project_id, p.project_code, wi.milestone_id, wi.item_key,
		       wi.title, wi.priority, wi.status, wi.tier, wi.type,
		       `+startDateExpr+`,
		       DATE_FORMAT(wi.due_date, '%Y-%m-%d'),
		       wi.estimated_hours,
		       DATE_FORMAT(m.start_date, '%Y-%m-%d'),
		       DATE_FORMAT(m.end_date, '%Y-%m-%d')
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		JOIN milestones m ON m.id = wi.milestone_id
		WHERE wi.id = ?
		FOR UPDATE`, workItemID).
		Scan(&row.id, &row.projectID, &row.projectCode, &row.milestoneID, &row.itemKey,
			&row.title, &row.priority, &row.status, &row.tier, &row.itemType,
			&row.startDate, &row.dueDate, &estimatedHours,
			&row.milestoneStartDate, &row.milestoneEndDate)
	if errors.Is(err, sql.ErrNoRows) {
		return row, httperror.New(404, "work_item_not_found", "Target work item or its milestone was not found")
	}
	if err != nil {
		return row, err
	}
	if estimatedHours.Valid {
		row.estimatedHours = &estimatedHours.Float64
	}
	return row, nil
}
