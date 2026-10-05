package aims

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const externalTaskCursorLayout = "2006-01-02 15:04:05.000000"

func (a *Adapter) handleExternalTasksRuntime(ctx context.Context, method, path string, query url.Values) (any, string, bool, error) {
	if path != "/v1/aims/service/tasks" {
		return nil, "", false, nil
	}
	if method != http.MethodGet {
		return nil, "aims.service.tasks.list", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
	data, err := a.externalTasks(ctx, query)
	return data, "aims.service.tasks.list", true, err
}

func (a *Adapter) externalTasks(ctx context.Context, query url.Values) (map[string]any, error) {
	limit := 100
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 || value > 200 {
			return nil, httperror.New(http.StatusBadRequest, "external_task_limit_invalid", "limit must be between 1 and 200")
		}
		limit = value
	}

	where := []string{"p.lifecycle_status <> 'archived'"}
	args := []any{}
	projectCodes, err := externalTaskCSV(query, 100, 50, "projectCodes", "project_codes")
	if err != nil {
		return nil, err
	}
	if len(projectCodes) > 0 {
		where = append(where, "p.project_code IN ("+externalTaskPlaceholders(len(projectCodes))+")")
		for _, value := range projectCodes {
			args = append(args, value)
		}
	}
	statuses, err := externalTaskCSV(query, 5, 32, "statuses", "status")
	if err != nil {
		return nil, err
	}
	allowedStatuses := map[string]bool{"planning": true, "todo": true, "in_progress": true, "in_review": true, "completed": true}
	for _, status := range statuses {
		if !allowedStatuses[status] {
			return nil, httperror.New(http.StatusBadRequest, "external_task_status_invalid", "status filter contains an unsupported value")
		}
	}
	if len(statuses) > 0 {
		where = append(where, "wi.status IN ("+externalTaskPlaceholders(len(statuses))+")")
		for _, value := range statuses {
			args = append(args, value)
		}
	}
	if assignee := strings.TrimSpace(firstQueryText(query, "assigneeUid", "assignee_uid")); assignee != "" {
		if len(assignee) > 64 || strings.ContainsAny(assignee, "\r\n") {
			return nil, httperror.New(http.StatusBadRequest, "external_task_assignee_invalid", "assigneeUid is invalid")
		}
		where = append(where, "wi.assignee_uid = ?")
		args = append(args, assignee)
	}

	cursorTime, cursorID, err := decodeExternalTaskCursor(strings.TrimSpace(query.Get("cursor")))
	if err != nil {
		return nil, err
	}
	if cursorID > 0 {
		where = append(where, "(wi.updated_at > ? OR (wi.updated_at = ? AND wi.id > ?))")
		args = append(args, cursorTime, cursorTime, cursorID)
	}
	args = append(args, limit+1)

	rows, err := a.DB().QueryContext(ctx, `
		SELECT wi.id, wi.item_key, wi.project_id, p.project_code, p.name,
		       wi.milestone_id, ml.name, wi.parent_id, wi.tier, wi.type,
		       wi.title, wi.description, wi.status, wi.priority, wi.severity,
		       wi.assignee_uid, wi.reporter_uid,
		       DATE_FORMAT(wi.start_date, '%Y-%m-%d'), DATE_FORMAT(wi.due_date, '%Y-%m-%d'),
		       wi.estimated_hours,
		       DATE_FORMAT(wi.created_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
		       DATE_FORMAT(wi.updated_at, '%Y-%m-%dT%H:%i:%s.%fZ'),
		       DATE_FORMAT(wi.updated_at, '%Y-%m-%d %H:%i:%s.%f'),
		       link.repo_project_code, link.issue_iid, link.issue_url, link.issue_state
		FROM work_items wi
		INNER JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN milestones ml ON ml.id = wi.milestone_id
		LEFT JOIN gitlab_issue_links link ON link.id = (
		  SELECT latest.id FROM gitlab_issue_links latest
		  WHERE latest.work_item_id = wi.id
		  ORDER BY latest.last_synced_at DESC, latest.id DESC LIMIT 1
		)
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY wi.updated_at ASC, wi.id ASC
		LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]map[string]any, 0, limit)
	hasMore := false
	var lastCursorTime string
	var lastCursorID int64
	for rows.Next() {
		var (
			id, projectID, milestoneID, parentID, issueIID                             sql.NullInt64
			itemKey, projectCode, projectName, tier, itemType, title, status, priority string
			milestoneName, description, severity, assignee, reporter                   sql.NullString
			startDate, dueDate, createdAt, updatedAt, cursorValue                      sql.NullString
			estimatedHours                                                             sql.NullFloat64
			repoCode, issueURL, issueState                                             sql.NullString
		)
		if err := rows.Scan(
			&id, &itemKey, &projectID, &projectCode, &projectName,
			&milestoneID, &milestoneName, &parentID, &tier, &itemType,
			&title, &description, &status, &priority, &severity,
			&assignee, &reporter, &startDate, &dueDate, &estimatedHours,
			&createdAt, &updatedAt, &cursorValue,
			&repoCode, &issueIID, &issueURL, &issueState,
		); err != nil {
			return nil, err
		}
		if len(items) == limit {
			hasMore = true
			break
		}
		item := map[string]any{
			"id": id.Int64, "key": itemKey, "projectId": projectID.Int64,
			"projectCode": projectCode, "projectName": projectName,
			"milestoneId": nullableInt64(milestoneID), "milestoneName": nullableString(milestoneName),
			"parentId": nullableInt64(parentID), "tier": tier, "type": itemType,
			"title": title, "description": nullableString(description), "status": status,
			"priority": priority, "severity": nullableString(severity),
			"assigneeUid": nullableString(assignee), "reporterUid": nullableString(reporter),
			"startDate": nullableString(startDate), "dueDate": nullableString(dueDate),
			"estimatedHours": nullableFloat64(estimatedHours),
			"createdAt":      nullableString(createdAt), "updatedAt": nullableString(updatedAt),
			"aimsPath":    fmt.Sprintf("/projects/%d/board/%d", projectID.Int64, id.Int64),
			"gitlabIssue": externalTaskGitlabIssue(repoCode, issueIID, issueURL, issueState),
		}
		items = append(items, item)
		lastCursorTime = cursorValue.String
		lastCursorID = id.Int64
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	nextCursor := ""
	if len(items) > 0 {
		nextCursor = encodeExternalTaskCursor(lastCursorTime, lastCursorID)
	}
	return map[string]any{
		"items": items, "limit": limit, "hasMore": hasMore, "nextCursor": nextCursor,
	}, nil
}

func externalTaskCSV(query url.Values, maxItems, maxLength int, keys ...string) ([]string, error) {
	raw := ""
	for _, key := range keys {
		if raw = strings.TrimSpace(query.Get(key)); raw != "" {
			break
		}
	}
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	if len(parts) > maxItems {
		return nil, httperror.New(http.StatusBadRequest, "external_task_filter_invalid", "task filter contains too many values")
	}
	result := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" || len(value) > maxLength || strings.ContainsAny(value, "\r\n") {
			return nil, httperror.New(http.StatusBadRequest, "external_task_filter_invalid", "task filter contains an invalid value")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, nil
}

func externalTaskPlaceholders(count int) string {
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func encodeExternalTaskCursor(updatedAt string, id int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte(updatedAt + "|" + strconv.FormatInt(id, 10)))
}

func decodeExternalTaskCursor(cursor string) (string, int64, error) {
	if cursor == "" {
		return "", 0, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return "", 0, httperror.New(http.StatusBadRequest, "external_task_cursor_invalid", "cursor is invalid")
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 2 {
		return "", 0, httperror.New(http.StatusBadRequest, "external_task_cursor_invalid", "cursor is invalid")
	}
	if _, err := time.Parse(externalTaskCursorLayout, parts[0]); err != nil {
		return "", 0, httperror.New(http.StatusBadRequest, "external_task_cursor_invalid", "cursor is invalid")
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || id <= 0 {
		return "", 0, httperror.New(http.StatusBadRequest, "external_task_cursor_invalid", "cursor is invalid")
	}
	return parts[0], id, nil
}

func externalTaskGitlabIssue(repoCode sql.NullString, issueIID sql.NullInt64, issueURL, issueState sql.NullString) any {
	if !repoCode.Valid || !issueIID.Valid || !issueURL.Valid {
		return nil
	}
	return map[string]any{
		"repoProjectCode": repoCode.String, "iid": issueIID.Int64,
		"url": issueURL.String, "state": nullableString(issueState),
	}
}
