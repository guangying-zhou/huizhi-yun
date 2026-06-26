package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) createWorkItemFromServiceTicket(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	ticketCode = strings.TrimSpace(ticketCode)
	if ticketCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_ticket_code", "ticketCode is required")
	}

	projectCode := serviceTicketText(body, "aimsProjectCode", "aims_project_code", "projectCode", "project_code")
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	project, err := aimsQueryOneMap(ctx, tx, `
		SELECT id, project_code, name, leader_uid
		FROM aims_projects
		WHERE project_code = ?
		  AND lifecycle_status <> 'archived'
		LIMIT 1
		FOR UPDATE
	`, projectCode)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "project not found")
	}
	projectID, err := int64MapValue(project, "id")
	if err != nil {
		return nil, err
	}
	projectCode = strings.TrimSpace(fmt.Sprint(project["project_code"]))
	if err := ensureAimsProjectCounter(ctx, tx, projectID); err != nil {
		return nil, err
	}

	templateKey := serviceTicketTemplateKey(ticketCode)
	existing, err := aimsQueryOneMap(ctx, tx, `
		SELECT *
		FROM work_items
		WHERE project_id = ?
		  AND template_key = ?
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, projectID, templateKey)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"workItem": existing, "created": false, "idempotent": true}, nil
	}

	milestoneID, err := serviceTicketMilestoneID(ctx, tx, projectID, body)
	if err != nil {
		return nil, err
	}
	createdBy := firstNonEmptyText(serviceTicketText(body, "createdBy", "created_by", "operatorUid", "operator_uid", "current_user"), "system")
	workItemType, tier := serviceTicketWorkItemType(serviceTicketText(body, "ticketType", "ticket_type", "type"))
	priority := serviceTicketPriority(serviceTicketText(body, "priority"))
	status := "todo"
	if tier == "target" {
		status = "planning"
	}
	title := firstNonEmptyText(serviceTicketText(body, "title", "name"), ticketCode)
	description := serviceTicketWorkItemDescription(ticketCode, body)
	itemNumber, err := nextDecomposeItemNumber(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}
	itemKey := fmt.Sprintf("%s-%d", projectCode, itemNumber)

	result, err := tx.ExecContext(ctx, `
		INSERT INTO work_items (
		  project_id, milestone_id, item_number, item_key, tier, type, title, description,
		  status, priority, severity, weight, assignee_uid, reporter_uid, due_date,
		  estimated_hours, parent_id, sort_order, review_level, template_key
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, 0, 1, ?)
	`, projectID,
		milestoneID,
		itemNumber,
		itemKey,
		tier,
		workItemType,
		title,
		nullableText(description),
		status,
		priority,
		serviceTicketSeverity(workItemType, priority),
		nullableText(serviceTicketText(body, "assigneeUid", "assignee_uid", "handlerUserId", "handler_user_id")),
		nullableText(firstNonEmptyText(serviceTicketText(body, "reporterUid", "reporter_uid", "ownerUserId", "owner_user_id"), createdBy)),
		nullableText(serviceTicketDateText(body, "dueDate", "due_date", "resolutionDueAt", "resolution_due_at")),
		nullableServiceTicketFloat(body, "estimatedHours", "estimated_hours"),
		templateKey)
	if err != nil {
		return nil, err
	}
	workItemID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO work_item_changelog (work_item_id, field_name, old_value, new_value, changed_by)
		VALUES (?, 'source', NULL, ?, ?)
	`, workItemID, fmt.Sprintf("altoc:service_ticket:%s", ticketCode), createdBy); err != nil {
		return nil, err
	}

	workItem, err := aimsQueryOneMap(ctx, tx, "SELECT * FROM work_items WHERE id = ? LIMIT 1", workItemID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"workItem": workItem, "created": true, "idempotent": false}, nil
}

func serviceTicketMilestoneID(ctx context.Context, tx *sql.Tx, projectID int64, body map[string]any) (int64, error) {
	if milestoneID, ok, err := optionalBodyID(body, "milestoneId", "milestone_id"); err != nil {
		return 0, err
	} else if ok && milestoneID > 0 {
		existing, err := aimsQueryOneMap(ctx, tx, `
			SELECT id
			FROM milestones
			WHERE id = ?
			  AND project_id = ?
			LIMIT 1
			FOR UPDATE
		`, milestoneID, projectID)
		if err != nil {
			return 0, err
		}
		if existing == nil {
			return 0, httperror.New(http.StatusBadRequest, "invalid_milestone_id", "milestoneId does not belong to project")
		}
		return milestoneID, nil
	}

	return ensureServiceOpsMilestone(ctx, tx, projectID, firstNonEmptyText(serviceTicketText(body, "createdBy", "created_by", "operatorUid", "operator_uid", "current_user"), "system"))
}

func ensureServiceOpsMilestone(ctx context.Context, tx *sql.Tx, projectID int64, createdBy string) (int64, error) {
	existing, err := aimsQueryOneMap(ctx, tx, `
		SELECT id
		FROM milestones
		WHERE project_id = ?
		  AND template_key = 'service_ops'
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, projectID)
	if err != nil {
		return 0, err
	}
	if existing != nil {
		return int64MapValue(existing, "id")
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO milestones (
		  project_id, name, description, mode, status, pivr_stage, template_key, sort_order, created_by
		) VALUES (?, '运维服务', 'Altoc 服务工单回流容器', 'periodic', 'active', 'R', 'service_ops', 9000, ?)
	`, projectID, createdBy)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func ensureAimsProjectCounter(ctx context.Context, tx *sql.Tx, projectID int64) error {
	_, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO project_counters (project_id, counter)
		SELECT ?, COALESCE(MAX(item_number), 0)
		FROM work_items
		WHERE project_id = ?
	`, projectID, projectID)
	return err
}

func serviceTicketTemplateKey(ticketCode string) string {
	return truncateAimsText("altoc:service_ticket:"+ticketCode, 100)
}

func serviceTicketWorkItemType(ticketType string) (string, string) {
	switch strings.ToLower(strings.TrimSpace(ticketType)) {
	case "incident", "bug", "fault":
		return "bug", "matter"
	case "requirement", "需求":
		return "requirement", "target"
	case "change", "change_request", "变更":
		return "change_request", "matter"
	default:
		return "task", "matter"
	}
}

func serviceTicketPriority(priority string) string {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "p0", "urgent", "critical":
		return "P0"
	case "p1", "high":
		return "P1"
	case "p3", "low":
		return "P3"
	default:
		return "P2"
	}
}

func serviceTicketSeverity(workItemType string, priority string) any {
	if workItemType != "bug" {
		return nil
	}
	switch priority {
	case "P0":
		return "critical"
	case "P1":
		return "high"
	case "P3":
		return "low"
	default:
		return "medium"
	}
}

func serviceTicketWorkItemDescription(ticketCode string, body map[string]any) string {
	parts := []string{
		serviceTicketText(body, "description", "content", "remark"),
		fmt.Sprintf("Altoc 服务工单：%s", ticketCode),
	}
	for _, item := range []struct {
		label string
		keys  []string
	}{
		{"客户", []string{"customerName", "customer_name", "customerCode", "customer_code"}},
		{"合同", []string{"contractCode", "contract_code"}},
		{"维保合同", []string{"maintenanceContractCode", "maintenance_contract_code"}},
		{"交付视图", []string{"deliveryCode", "delivery_code"}},
		{"产品", []string{"productCode", "product_code"}},
		{"版本", []string{"productVersion", "product_version"}},
	} {
		value := serviceTicketText(body, item.keys...)
		if value != "" {
			parts = append(parts, item.label+"："+value)
		}
	}
	return strings.Join(nonEmptyStrings(parts...), "\n\n")
}

func nonEmptyStrings(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func serviceTicketText(body map[string]any, keys ...string) string {
	if value := firstBodyText(body, keys...); value != "" {
		return value
	}
	for _, container := range []string{"ticket", "serviceTicket", "service_ticket"} {
		nested, ok := body[container].(map[string]any)
		if !ok {
			continue
		}
		if value := firstBodyText(nested, keys...); value != "" {
			return value
		}
	}
	return ""
}

func serviceTicketDateText(body map[string]any, keys ...string) string {
	value := serviceTicketText(body, keys...)
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

func nullableServiceTicketFloat(body map[string]any, keys ...string) any {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed
		case int:
			return float64(typed)
		case int64:
			return float64(typed)
		default:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
			if err == nil {
				return parsed
			}
		}
	}
	return nil
}
