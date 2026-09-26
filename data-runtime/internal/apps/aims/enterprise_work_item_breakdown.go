package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const EnterpriseWorkItemBreakdownCapability = "aims:work-item-breakdown:execute"

// SaveEnterpriseWorkItemBreakdown is the unified form of saving a target's task
// breakdown before its distribution is confirmed. Every target deliverable is
// claimed by exactly one task, planned children are updated or removed, and
// the whole breakdown commits with its receipt and audit.
func (a *Adapter) SaveEnterpriseWorkItemBreakdown(ctx context.Context, id EnterpriseProjectUpdateIdentity, projectID, itemID string, command map[string]any) (map[string]any, error) {
	expected, _ := command["expectedVersion"].(string)
	rawSubtasks, isList := command["subtasks"].([]any)
	targetID, parseErr := strconv.ParseInt(itemID, 10, 64)
	if len(command) != 2 || len(expected) != 64 || !isList || len(rawSubtasks) > 50 || len(id.Personnel) > 0 || parseErr != nil || targetID <= 0 {
		return nil, httperror.New(400, "work_item_breakdown_input_invalid", "A content version and at most fifty tasks are required")
	}
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	supportsStartDate, err := a.hasWorkItemStartDateColumn(ctx)
	if err != nil {
		return nil, err
	}
	base := EnterpriseProjectCreateIdentity{Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID, IdempotencyKey: id.IdempotencyKey}
	receipt, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "action": "breakdown", "input": command, "projectScope": id.ProjectScope})
	if err != nil {
		return nil, err
	}
	receipt.OperationCode = "enterprise.aims.work-items.breakdown.v1"
	receipt.RequiredCapability = EnterpriseWorkItemBreakdownCapability
	receipt.CommandSchemaVersion = "breakdown-save.v1"
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
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_version_conflict", "Work item changed; reload before saving the breakdown")
		}
		if err := requireEnterpriseProjectManagerTx(ctx, tx, id, projectID, leader); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		target, err := loadDistributionTargetTx(ctx, tx, targetID, supportsStartDate)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if err := a.requireEnterpriseWorkItemReviewUnlockedTx(ctx, tx, item); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if mid := serviceBodyInt(item, "milestone_id"); mid > 0 {
			if err := requireMilestoneCompletionUnlockedTx(ctx, tx, int64(mid)); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		targetDeliverables, err := lockTargetDeliverablesTx(ctx, tx, targetID)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if len(targetDeliverables) == 0 {
			return iop.ReceiptBusinessResult{}, httperror.New(400, "target_deliverables_required", "目标尚未配置成果要求，请先在目标规划中添加")
		}
		targetDeliverableIDs := map[int64]bool{}
		for _, deliverable := range targetDeliverables {
			targetDeliverableIDs[deliverable.id] = true
		}
		existing, err := lockBreakdownChildrenTx(ctx, tx, target.projectID, targetID)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		for _, status := range existing {
			if status != "planning" {
				return iop.ReceiptBusinessResult{}, httperror.New(409, "distribution_locked", "任务分配已确认或任务已开始执行，无法修改。如需调整请先在流程面板点击\"撤回任务分配\"")
			}
		}
		subtasks, err := parseDistributionSubtasks(command, target, "任务", true, targetDeliverableIDs)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		// A task id may only name a planned child of this target.
		for index, subtask := range subtasks {
			if subtask.id != nil {
				if _, ok := existing[*subtask.id]; !ok {
					return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_breakdown_child_mismatch", fmt.Sprintf("任务 %d 不是该目标的规划态子任务", index+1))
				}
			}
		}
		if err := validateBreakdownClaims(subtasks, targetDeliverables); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if err := validateBreakdownHours(subtasks, target.estimatedHours); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if err := requireEnterpriseProjectAssigneesTx(ctx, tx, projectID, leader, subtasks, "任务"); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}

		incoming := map[int64]bool{}
		for _, subtask := range subtasks {
			if subtask.id != nil {
				incoming[*subtask.id] = true
			}
		}
		removed := []int64{}
		for childID := range existing {
			if incoming[childID] {
				continue
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE deliverables SET matter_id = NULL, status = 'pending', evidence_url = NULL, evidence_note = NULL,
				       document_uuid = NULL, document_title = NULL, submitted_by = NULL, submitted_at = NULL
				WHERE matter_id = ? AND target_id IS NOT NULL`, childID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM deliverables WHERE matter_id=? AND target_id IS NULL", childID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM work_items WHERE id=? AND parent_id=? AND status='planning'", childID, targetID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			removed = append(removed, childID)
		}

		childIDs := make([]int64, 0, len(subtasks))
		for _, subtask := range subtasks {
			var childID int64
			if subtask.id != nil {
				childID = *subtask.id
				setClauses := "title = ?, description = ?, assignee_uid = ?, "
				args := []any{subtask.title, nullableDistributionString(subtask.description), subtask.assigneeUID}
				if supportsStartDate {
					setClauses += "start_date = ?, "
					args = append(args, nullableDistributionString(subtask.startDate))
				}
				setClauses += "due_date = ?, estimated_hours = ?, priority = ?, updated_at = CURRENT_TIMESTAMP"
				args = append(args, nullableDistributionString(subtask.dueDate), nullableDistributionFloat(subtask.estimatedHours), target.priority, childID, targetID)
				if _, err := tx.ExecContext(ctx, "UPDATE work_items SET "+setClauses+" WHERE id = ? AND parent_id = ? AND status = 'planning'", args...); err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
			} else {
				childID, err = insertDistributionChild(ctx, tx, target, subtask, id.ActorUID, targetID, supportsStartDate)
				if err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
			}
			childIDs = append(childIDs, childID)
			if _, err := tx.ExecContext(ctx, "UPDATE deliverables SET matter_id = NULL WHERE matter_id = ? AND target_id IS NOT NULL", childID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if _, err := tx.ExecContext(ctx, "DELETE FROM deliverables WHERE matter_id = ? AND target_id IS NULL", childID); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			for index, deliverable := range subtask.deliverables {
				if deliverable.sourceDeliverableID != nil {
					if _, err := tx.ExecContext(ctx, "UPDATE deliverables SET matter_id = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND target_id = ?", childID, index, *deliverable.sourceDeliverableID, targetID); err != nil {
						return iop.ReceiptBusinessResult{}, err
					}
					continue
				}
				if err := insertOwnDeliverable(ctx, tx, target, childID, deliverable, index, id.ActorUID); err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
			}
		}
		raw, _ := json.Marshal(map[string]any{"transition": "breakdown", "childIds": childIDs, "removedIds": removed})
		if _, err := tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,?,?,?,?)", projectID, itemID, "breakdown", id.ActorUID, raw, id.IdempotencyKey); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		_, afterVersion, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, false)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "work_item", TargetBizCode: itemID, HTTPStatus: 200, Value: map[string]any{"targetId": itemID, "childIds": childIDs, "removedIds": removed, "editVersion": afterVersion}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing, "result": result.Value}, nil
}

type breakdownTargetDeliverable struct {
	id   int64
	name string
}

func lockTargetDeliverablesTx(ctx context.Context, tx *sql.Tx, targetID int64) ([]breakdownTargetDeliverable, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id, name FROM deliverables WHERE target_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC FOR UPDATE", targetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []breakdownTargetDeliverable
	for rows.Next() {
		var deliverable breakdownTargetDeliverable
		if err := rows.Scan(&deliverable.id, &deliverable.name); err != nil {
			return nil, err
		}
		out = append(out, deliverable)
	}
	return out, rows.Err()
}

func lockBreakdownChildrenTx(ctx context.Context, tx *sql.Tx, projectID, targetID int64) (map[int64]string, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id, status FROM work_items WHERE project_id = ? AND parent_id = ? FOR UPDATE", projectID, targetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	children := map[int64]string{}
	for rows.Next() {
		var id int64
		var status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, err
		}
		children[id] = strings.TrimSpace(status)
	}
	return children, rows.Err()
}

// validateBreakdownClaims keeps the legacy coverage rules: with any tasks,
// every target deliverable is claimed, and none is claimed twice.
func validateBreakdownClaims(subtasks []distributionSubtask, targetDeliverables []breakdownTargetDeliverable) error {
	claimCount := map[int64]int{}
	for _, subtask := range subtasks {
		for _, deliverable := range subtask.deliverables {
			if deliverable.sourceDeliverableID != nil {
				claimCount[*deliverable.sourceDeliverableID]++
			}
		}
	}
	if len(subtasks) > 0 {
		var uncovered []string
		for _, deliverable := range targetDeliverables {
			if claimCount[deliverable.id] == 0 {
				uncovered = append(uncovered, deliverable.name)
			}
		}
		if len(uncovered) > 0 {
			return httperror.New(400, "targets_uncovered", "目标成果未完全覆盖："+strings.Join(uncovered, "、"))
		}
	}
	var duplicated []string
	for _, deliverable := range targetDeliverables {
		if claimCount[deliverable.id] > 1 {
			duplicated = append(duplicated, deliverable.name)
		}
	}
	if len(duplicated) > 0 {
		return httperror.New(400, "targets_duplicated", "目标成果被重复承接："+strings.Join(duplicated, "、")+"（同一成果只能由一个任务承接）")
	}
	return nil
}

// validateBreakdownHours keeps the legacy estimate rules: no task exceeds the
// target's controlled hours and neither does their sum.
func validateBreakdownHours(subtasks []distributionSubtask, controlled *float64) error {
	if controlled == nil || *controlled <= 0 {
		return nil
	}
	control := *controlled
	total := 0.0
	for index, subtask := range subtasks {
		if subtask.estimatedHours == nil {
			continue
		}
		if *subtask.estimatedHours > control {
			return httperror.New(400, "hours_exceeded", fmt.Sprintf("任务 %d 的计划工时 %sh 超出目标控制工时 %sh", index+1, formatHours(*subtask.estimatedHours), formatHours(control)))
		}
		total += *subtask.estimatedHours
	}
	if total-control > 0.0001 {
		return httperror.New(400, "total_hours_exceeded", fmt.Sprintf("所有任务计划工时之和 %sh 超出目标控制工时 %sh", formatHours(math.Round(total*100)/100), formatHours(control)))
	}
	return nil
}

// requireEnterpriseProjectAssigneesTx applies the unified creation rule to
// distributed tasks: each assignee is the leader or an active project member.
func requireEnterpriseProjectAssigneesTx(ctx context.Context, tx *sql.Tx, projectID, leader string, subtasks []distributionSubtask, label string) error {
	for index, subtask := range subtasks {
		if subtask.assigneeUID == leader {
			continue
		}
		var member int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_members WHERE project_id=? AND uid=? AND status='active' FOR UPDATE", projectID, subtask.assigneeUID).Scan(&member); err != nil {
			return err
		}
		if member == 0 {
			return httperror.New(409, "work_item_assignee_not_member", fmt.Sprintf("%s %d 的负责人不是项目的活跃成员", label, index+1))
		}
	}
	return nil
}
