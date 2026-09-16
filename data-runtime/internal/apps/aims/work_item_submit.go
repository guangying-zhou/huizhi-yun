package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type workItemSubmitItem struct {
	ID             int64
	ProjectID      int64
	ProjectCode    string
	ItemKey        string
	Title          string
	Description    sql.NullString
	StartDate      sql.NullString
	DueDate        sql.NullString
	AssigneeUID    sql.NullString
	ApprovalStatus string
}

type workItemSubmitChild struct {
	ID          int64
	Description sql.NullString
	StartDate   sql.NullString
	DueDate     sql.NullString
	AssigneeUID sql.NullString
}

type workItemSubmitDeliverable struct {
	TargetID           sql.NullInt64
	MatterID           sql.NullInt64
	Name               sql.NullString
	AcceptanceCriteria sql.NullString
}

func (a *Adapter) submitWorkItemBreakdown(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	reviewerUID := strings.TrimSpace(firstBodyText(body, "reviewerUid", "reviewer_uid"))
	if reviewerUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_reviewer", "请选择审核人")
	}

	item, err := a.workItemSubmitItem(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectManagerOrScopedAdmin(ctx, item.ProjectID, uid, query); err != nil {
		return nil, err
	}
	if item.ApprovalStatus == "pending" {
		return nil, httperror.New(http.StatusBadRequest, "approval_pending", "当前工作项已提交审批")
	}

	children, err := a.workItemSubmitChildren(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	deliverables, err := a.workItemSubmitDeliverables(ctx, item.ProjectID, workItemID)
	if err != nil {
		return nil, err
	}
	if err := validateWorkItemSubmitReadiness(item, children, deliverables); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO approval_records
			(project_owner_id, milestone_owner_id, work_item_owner_id,
			 entity_code, transition, title,
			 requested_by, request_comment, reviewer_uid, status,
			 project_id, project_code)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
	`, nil, nil, workItemID, item.ItemKey, "submit_breakdown", item.ItemKey+" 工作目标分解提交", uid, nullableText(firstBodyText(body, "requestComment", "request_comment")), reviewerUID, item.ProjectID, item.ProjectCode); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, "UPDATE work_items SET approval_status = ? WHERE id = ?", "pending", workItemID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{"id": workItemID, "approvalStatus": "pending"}, nil
}

func (a *Adapter) withdrawWorkItemBreakdown(ctx context.Context, rawWorkItemID string, query url.Values) (map[string]any, error) {
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	item, err := a.workItemSubmitItem(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectManagerOrScopedAdmin(ctx, item.ProjectID, uid, query); err != nil {
		return nil, err
	}
	if item.ApprovalStatus != "pending" {
		return nil, httperror.New(http.StatusBadRequest, "approval_not_pending", "当前工作项未处于待审批状态")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var approvalID int64
	err = tx.QueryRowContext(ctx, `
		SELECT id
		FROM approval_records
		WHERE project_id = ?
		  AND work_item_owner_id = ?
		  AND status = 'pending'
		  AND requested_by = ?
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE
	`, item.ProjectID, workItemID, uid).Scan(&approvalID)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "withdraw_approval_not_found", "未找到可撤回的审批记录")
	}
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE approval_records
		SET status = 'cancelled', reviewed_at = NOW(), review_comment = '发起人撤回'
		WHERE id = ?
	`, approvalID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE work_items SET approval_status = ? WHERE id = ?", "not_required", workItemID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return nil, nil
}

func (a *Adapter) workItemSubmitItem(ctx context.Context, workItemID int64) (workItemSubmitItem, error) {
	var item workItemSubmitItem
	err := a.DB().QueryRowContext(ctx, `
		SELECT wi.id, wi.project_id, p.project_code, wi.item_key, wi.title, wi.description,
		       wi.start_date, wi.due_date, wi.assignee_uid, wi.approval_status
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		WHERE wi.id = ?
	`, workItemID).Scan(
		&item.ID,
		&item.ProjectID,
		&item.ProjectCode,
		&item.ItemKey,
		&item.Title,
		&item.Description,
		&item.StartDate,
		&item.DueDate,
		&item.AssigneeUID,
		&item.ApprovalStatus,
	)
	if err == sql.ErrNoRows {
		return item, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}
	return item, err
}

func (a *Adapter) workItemSubmitChildren(ctx context.Context, workItemID int64) ([]workItemSubmitChild, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, description, start_date, due_date, assignee_uid
		FROM work_items
		WHERE parent_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, workItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	children := make([]workItemSubmitChild, 0)
	for rows.Next() {
		var child workItemSubmitChild
		if err := rows.Scan(&child.ID, &child.Description, &child.StartDate, &child.DueDate, &child.AssigneeUID); err != nil {
			return nil, err
		}
		children = append(children, child)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return children, nil
}

func (a *Adapter) workItemSubmitDeliverables(ctx context.Context, projectID int64, workItemID int64) ([]workItemSubmitDeliverable, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT target_id, matter_id, name, acceptance_criteria
		FROM deliverables
		WHERE project_id = ?
		  AND (
		    target_id = ?
		    OR matter_id IN (SELECT id FROM work_items WHERE parent_id = ?)
		  )
	`, projectID, workItemID, workItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deliverables := make([]workItemSubmitDeliverable, 0)
	for rows.Next() {
		var deliverable workItemSubmitDeliverable
		if err := rows.Scan(&deliverable.TargetID, &deliverable.MatterID, &deliverable.Name, &deliverable.AcceptanceCriteria); err != nil {
			return nil, err
		}
		deliverables = append(deliverables, deliverable)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return deliverables, nil
}

func validateWorkItemSubmitReadiness(item workItemSubmitItem, children []workItemSubmitChild, deliverables []workItemSubmitDeliverable) error {
	childIDs := make(map[int64]bool, len(children))
	for _, child := range children {
		childIDs[child.ID] = true
	}
	deliverablesByItem := make(map[int64][]workItemSubmitDeliverable)
	for _, deliverable := range deliverables {
		bucketID := int64(0)
		if deliverable.MatterID.Valid && childIDs[deliverable.MatterID.Int64] {
			bucketID = deliverable.MatterID.Int64
		} else if deliverable.TargetID.Valid {
			bucketID = deliverable.TargetID.Int64
		}
		if bucketID <= 0 {
			continue
		}
		deliverablesByItem[bucketID] = append(deliverablesByItem[bucketID], deliverable)
	}

	if len(children) == 0 {
		if strings.TrimSpace(item.AssigneeUID.String) == "" {
			return httperror.New(http.StatusBadRequest, "missing_direct_assignee", "直接指派模式下必须指定负责人")
		}
		if strings.TrimSpace(item.Description.String) == "" {
			return httperror.New(http.StatusBadRequest, "missing_direct_description", "直接指派模式下必须填写执行说明")
		}
		if !validSubmitDateRange(item.StartDate, item.DueDate) {
			return httperror.New(http.StatusBadRequest, "invalid_direct_date_range", "直接指派模式下必须填写合法的开始/结束日期")
		}
		if !hasSubmitDeliverableRequirement(deliverablesByItem[item.ID]) {
			return httperror.New(http.StatusBadRequest, "missing_direct_deliverable", "直接指派模式下必须填写成果要求和验收标准")
		}
		return nil
	}

	if !validSubmitDateRange(item.StartDate, item.DueDate) {
		return httperror.New(http.StatusBadRequest, "invalid_target_date_range", "请先为当前目标设置合法的开始/结束日期")
	}
	for index, child := range children {
		if strings.TrimSpace(child.Description.String) == "" {
			return httperror.New(http.StatusBadRequest, "missing_child_description", submitChildMessage(index, "缺少具体描述"))
		}
		if strings.TrimSpace(child.AssigneeUID.String) == "" {
			return httperror.New(http.StatusBadRequest, "missing_child_assignee", submitChildMessage(index, "缺少负责人"))
		}
		if !validSubmitDateRange(child.StartDate, child.DueDate) {
			return httperror.New(http.StatusBadRequest, "invalid_child_date_range", submitChildMessage(index, "缺少合法日期"))
		}
		if compareSubmitDate(child.StartDate.String, item.StartDate.String) < 0 || compareSubmitDate(child.DueDate.String, item.DueDate.String) > 0 {
			return httperror.New(http.StatusBadRequest, "child_date_out_of_range", submitChildMessage(index, "日期超出当前目标范围"))
		}
		if !hasSubmitDeliverableRequirement(deliverablesByItem[child.ID]) {
			return httperror.New(http.StatusBadRequest, "missing_child_deliverable", submitChildMessage(index, "缺少成果要求或验收标准"))
		}
	}
	return nil
}

func submitChildMessage(index int, suffix string) string {
	return "分项 " + strconv.Itoa(index+1) + " " + suffix
}

func validSubmitDateRange(start sql.NullString, due sql.NullString) bool {
	if strings.TrimSpace(start.String) == "" || strings.TrimSpace(due.String) == "" {
		return false
	}
	return compareSubmitDate(start.String, due.String) <= 0
}

func compareSubmitDate(left string, right string) int64 {
	leftTime, leftErr := time.Parse("2006-01-02", strings.TrimSpace(left))
	rightTime, rightErr := time.Parse("2006-01-02", strings.TrimSpace(right))
	if leftErr != nil || rightErr != nil {
		return 1
	}
	return leftTime.Unix() - rightTime.Unix()
}

func hasSubmitDeliverableRequirement(deliverables []workItemSubmitDeliverable) bool {
	if len(deliverables) == 0 {
		return false
	}
	return strings.TrimSpace(deliverables[0].Name.String) != "" && strings.TrimSpace(deliverables[0].AcceptanceCriteria.String) != ""
}
