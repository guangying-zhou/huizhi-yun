package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type timeEntryItem struct {
	ID               int64   `json:"id"`
	WorkItemID       *int64  `json:"workItemId"`
	ProjectID        int64   `json:"projectId"`
	ProjectCode      string  `json:"projectCode"`
	ProjectName      string  `json:"projectName"`
	ProjectShortName string  `json:"projectShortName"`
	ItemKey          string  `json:"itemKey"`
	ItemTitle        string  `json:"itemTitle"`
	UID              string  `json:"uid"`
	EntryDate        string  `json:"entryDate"`
	Hours            float64 `json:"hours"`
	Description      *string `json:"description"`
	CreatedAt        string  `json:"createdAt"`
	UpdatedAt        string  `json:"updatedAt"`
}

func (a *Adapter) userTimeEntries(ctx context.Context, uid string, query url.Values) (map[string]any, error) {
	uid = strings.TrimSpace(uid)
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_uid", "uid is required")
	}
	if currentUser != "" && uid != currentUser {
		return nil, httperror.New(http.StatusForbidden, "forbidden_user_timesheet", "only current user's timesheet can be queried")
	}

	where := []string{"t.uid = ?", "t.weekly_report_id IS NULL"}
	args := []any{uid}
	appendTimeEntryDateRange(&where, &args, query)

	return a.listTimeEntries(ctx, where, args)
}

func (a *Adapter) projectTimeEntries(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_id", "project id is required")
	}

	if currentUser := strings.TrimSpace(query.Get("current_user")); currentUser != "" {
		if err := a.requireProjectTimesheetReadAccess(ctx, projectID, currentUser, query); err != nil {
			return nil, err
		}
	}

	where := []string{"t.project_id = ?", "t.weekly_report_id IS NULL"}
	args := []any{projectID}
	if uid := strings.TrimSpace(query.Get("uid")); uid != "" {
		where = append(where, "t.uid = ?")
		args = append(args, uid)
	}
	appendTimeEntryDateRange(&where, &args, query)

	return a.listTimeEntries(ctx, where, args)
}

func (a *Adapter) createProjectTimeEntry(ctx context.Context, projectID string, query url.Values, body map[string]any) (timeEntryItem, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "missing_project_id", "project id is required")
	}

	uid := currentUserFrom(query, body)
	if uid == "" {
		return timeEntryItem{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	entryDate := firstBodyText(body, "entryDate", "entry_date")
	if entryDate == "" {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "missing_entry_date", "entryDate is required")
	}

	hours, err := bodyFloat(body, "hours")
	if err != nil || hours <= 0 {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "invalid_hours", "hours must be greater than 0")
	}
	if hours > 24 {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "invalid_hours", "hours cannot exceed 24")
	}

	if err := a.requireProjectTimesheetAccess(ctx, projectID, uid, query); err != nil {
		return timeEntryItem{}, err
	}

	description := firstBodyText(body, "description")
	var descriptionValue any = nil
	if description != "" {
		descriptionValue = description
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO time_entries (project_id, work_item_id, uid, entry_date, hours, description)
		VALUES (?, NULL, ?, ?, ?, ?)
	`, projectID, uid, entryDate, hours, descriptionValue)
	if err != nil {
		return timeEntryItem{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return timeEntryItem{}, err
	}
	return a.getTimeEntry(ctx, id)
}

func (a *Adapter) createWorkItemTimeEntry(ctx context.Context, workItemID string, query url.Values, body map[string]any) (timeEntryItem, error) {
	workItemID = strings.TrimSpace(workItemID)
	if workItemID == "" {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "missing_work_item_id", "work item id is required")
	}

	uid := currentUserFrom(query, body)
	if uid == "" {
		return timeEntryItem{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	entryDate := firstBodyText(body, "entryDate", "entry_date")
	if entryDate == "" {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "missing_entry_date", "entryDate is required")
	}

	hours, err := bodyFloat(body, "hours")
	if err != nil || hours <= 0 {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "invalid_hours", "hours must be greater than 0")
	}
	if hours > 24 {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "invalid_hours", "hours cannot exceed 24")
	}

	description := firstBodyText(body, "description")
	var descriptionValue any = nil
	if description != "" {
		descriptionValue = description
	}

	projectID, err := a.workItemProjectID(ctx, workItemID)
	if err != nil {
		return timeEntryItem{}, err
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO time_entries (project_id, work_item_id, uid, entry_date, hours, description)
		VALUES (?, ?, ?, ?, ?, ?)
	`, projectID, workItemID, uid, entryDate, hours, descriptionValue)
	if err != nil {
		return timeEntryItem{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return timeEntryItem{}, err
	}
	return a.getTimeEntry(ctx, id)
}

func (a *Adapter) updateProjectTimeEntry(ctx context.Context, projectID string, entryID string, query url.Values, body map[string]any) (timeEntryItem, error) {
	projectID = strings.TrimSpace(projectID)
	entryID = strings.TrimSpace(entryID)
	if projectID == "" || entryID == "" {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "missing_time_entry_id", "project id and time entry id are required")
	}

	uid := currentUserFrom(query, body)
	if uid == "" {
		return timeEntryItem{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectTimesheetAccess(ctx, projectID, uid, query); err != nil {
		return timeEntryItem{}, err
	}

	var ownerUID string
	err := a.DB().QueryRowContext(ctx, `
		SELECT uid
		FROM time_entries
		WHERE id = ?
		  AND project_id = ?
		LIMIT 1
	`, entryID, projectID).Scan(&ownerUID)
	if err == sql.ErrNoRows {
		return timeEntryItem{}, httperror.New(http.StatusNotFound, "record_not_found", "time entry not found")
	}
	if err != nil {
		return timeEntryItem{}, err
	}
	if ownerUID != uid {
		return timeEntryItem{}, httperror.New(http.StatusForbidden, "forbidden_time_entry_update", "only the owner can update this time entry")
	}

	sets := make([]string, 0, 3)
	args := make([]any, 0, 4)
	if hasAnyBodyKey(body, "entryDate", "entry_date") {
		entryDate := firstBodyText(body, "entryDate", "entry_date")
		if entryDate == "" {
			return timeEntryItem{}, httperror.New(http.StatusBadRequest, "missing_entry_date", "entryDate is required")
		}
		sets = append(sets, "entry_date = ?")
		args = append(args, entryDate)
	}
	if hasAnyBodyKey(body, "hours") {
		hours, err := bodyFloat(body, "hours")
		if err != nil || hours <= 0 {
			return timeEntryItem{}, httperror.New(http.StatusBadRequest, "invalid_hours", "hours must be greater than 0")
		}
		if hours > 24 {
			return timeEntryItem{}, httperror.New(http.StatusBadRequest, "invalid_hours", "hours cannot exceed 24")
		}
		sets = append(sets, "hours = ?")
		args = append(args, hours)
	}
	if hasAnyBodyKey(body, "description") {
		var descriptionValue any = nil
		if description := firstBodyText(body, "description"); description != "" {
			descriptionValue = description
		}
		sets = append(sets, "description = ?")
		args = append(args, descriptionValue)
	}

	if len(sets) == 0 {
		id, _ := strconv.ParseInt(entryID, 10, 64)
		return a.getTimeEntry(ctx, id)
	}

	args = append(args, entryID, projectID, uid)
	if _, err := a.DB().ExecContext(ctx, `
		UPDATE time_entries
		SET `+strings.Join(sets, ", ")+`
		WHERE id = ?
		  AND project_id = ?
		  AND uid = ?
	`, args...); err != nil {
		return timeEntryItem{}, err
	}
	id, err := strconv.ParseInt(entryID, 10, 64)
	if err != nil {
		return timeEntryItem{}, httperror.New(http.StatusBadRequest, "invalid_time_entry_id", "time entry id is invalid")
	}
	return a.getTimeEntry(ctx, id)
}

func (a *Adapter) deleteProjectTimeEntry(ctx context.Context, projectID string, entryID string, query url.Values) (map[string]any, error) {
	projectID = strings.TrimSpace(projectID)
	entryID = strings.TrimSpace(entryID)
	if projectID == "" || entryID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_time_entry_id", "project id and time entry id are required")
	}

	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectTimesheetAccess(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	var ownerUID string
	err := a.DB().QueryRowContext(ctx, `
		SELECT uid
		FROM time_entries
		WHERE id = ?
		  AND project_id = ?
		LIMIT 1
	`, entryID, projectID).Scan(&ownerUID)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "time entry not found")
	}
	if err != nil {
		return nil, err
	}
	if ownerUID != uid {
		return nil, httperror.New(http.StatusForbidden, "forbidden_time_entry_delete", "only the owner can delete this time entry")
	}

	result, err := a.DB().ExecContext(ctx, `
		DELETE FROM time_entries
		WHERE id = ?
		  AND project_id = ?
		  AND uid = ?
	`, entryID, projectID, uid)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	return map[string]any{
		"deleted": affected > 0,
		"id":      entryID,
	}, nil
}

func (a *Adapter) listTimeEntries(ctx context.Context, where []string, args []any) (map[string]any, error) {
	whereSQL := strings.Join(where, " AND ")

	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM time_entries t
		JOIN aims_projects p ON p.id = t.project_id
		LEFT JOIN work_items w ON w.id = t.work_item_id
		WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			t.id,
			t.work_item_id,
			t.project_id,
			p.project_code,
			p.name AS project_name,
			p.short_name AS project_short_name,
			w.item_key,
			w.title AS item_title,
			t.uid,
			DATE_FORMAT(t.entry_date, '%Y-%m-%d') AS entry_date,
			CAST(t.hours AS CHAR) AS hours,
			t.description,
			DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM time_entries t
		JOIN aims_projects p ON p.id = t.project_id
		LEFT JOIN work_items w ON w.id = t.work_item_id
		WHERE `+whereSQL+`
		ORDER BY t.entry_date ASC, t.created_at ASC, t.id ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := scanTimeEntries(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     1,
		"pageSize": len(items),
	}, nil
}

func (a *Adapter) getTimeEntry(ctx context.Context, id int64) (timeEntryItem, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			t.id,
			t.work_item_id,
			t.project_id,
			p.project_code,
			p.name AS project_name,
			p.short_name AS project_short_name,
			w.item_key,
			w.title AS item_title,
			t.uid,
			DATE_FORMAT(t.entry_date, '%Y-%m-%d') AS entry_date,
			CAST(t.hours AS CHAR) AS hours,
			t.description,
			DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM time_entries t
		JOIN aims_projects p ON p.id = t.project_id
		LEFT JOIN work_items w ON w.id = t.work_item_id
		WHERE t.id = ?
		LIMIT 1
	`, id)
	if err != nil {
		return timeEntryItem{}, err
	}
	defer rows.Close()

	items, err := scanTimeEntries(rows)
	if err != nil {
		return timeEntryItem{}, err
	}
	if len(items) == 0 {
		return timeEntryItem{}, httperror.New(http.StatusNotFound, "record_not_found", "time entry not found")
	}
	return items[0], nil
}

func scanTimeEntries(rows *sql.Rows) ([]timeEntryItem, error) {
	items := make([]timeEntryItem, 0)
	for rows.Next() {
		var item timeEntryItem
		var workItemID sql.NullInt64
		var itemKey sql.NullString
		var itemTitle sql.NullString
		var hoursText string
		var description sql.NullString
		if err := rows.Scan(
			&item.ID,
			&workItemID,
			&item.ProjectID,
			&item.ProjectCode,
			&item.ProjectName,
			&item.ProjectShortName,
			&itemKey,
			&itemTitle,
			&item.UID,
			&item.EntryDate,
			&hoursText,
			&description,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		hours, err := strconv.ParseFloat(hoursText, 64)
		if err != nil {
			return nil, err
		}
		item.WorkItemID = nullableInt64(workItemID)
		if itemKey.Valid {
			item.ItemKey = itemKey.String
		}
		if itemTitle.Valid {
			item.ItemTitle = itemTitle.String
		}
		item.Hours = hours
		item.Description = nullableString(description)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func nullableInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func (a *Adapter) workItemProjectID(ctx context.Context, workItemID string) (string, error) {
	var projectID string
	err := a.DB().QueryRowContext(ctx, "SELECT project_id FROM work_items WHERE id = ?", workItemID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return "", httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	return projectID, err
}

func (a *Adapter) requireProjectTimesheetAccess(ctx context.Context, projectID string, uid string, query url.Values) error {
	if currentUserIsProjectAdmin(query) {
		return a.requireProjectExists(ctx, projectID)
	}

	var leaderUID sql.NullString
	var memberRole sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT p.leader_uid, m.role
		FROM aims_projects p
		LEFT JOIN aims_project_members m
		  ON m.project_id = p.id
		 AND m.uid = ?
		 AND COALESCE(m.status, 'active') = 'active'
		WHERE p.id = ?
	`, uid, projectID).Scan(&leaderUID, &memberRole)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	if err != nil {
		return err
	}
	if leaderUID.Valid && leaderUID.String == uid {
		return nil
	}
	if memberRole.Valid && (memberRole.String == "manager" || memberRole.String == "member") {
		return nil
	}
	return httperror.New(http.StatusForbidden, "forbidden_project_timesheet", "only project leaders or active project members can report project time")
}

func (a *Adapter) requireProjectTimesheetReadAccess(ctx context.Context, projectID string, uid string, query url.Values) error {
	if currentUserIsProjectAdmin(query) {
		return a.requireProjectExists(ctx, projectID)
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", uid)
	args := append([]any{projectID}, visibilityArgs...)

	var id int64
	err := a.DB().QueryRowContext(ctx, `
		SELECT p.id
		FROM aims_projects p
		WHERE p.id = ?
		  AND `+visibilityWhere+`
		LIMIT 1
	`, args...).Scan(&id)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusForbidden, "forbidden_project_timesheet_read", "only users with project access can view project time entries")
	}
	return err
}

func appendTimeEntryDateRange(where *[]string, args *[]any, query url.Values) {
	if start := firstQueryText(query, "startDate", "start_date"); start != "" {
		*where = append(*where, "t.entry_date >= ?")
		*args = append(*args, start)
	}
	if end := firstQueryText(query, "endDate", "end_date"); end != "" {
		*where = append(*where, "t.entry_date <= ?")
		*args = append(*args, end)
	}
}

func pathParam(path string, prefix string, suffix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	value := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}

func nestedPathParam(path string, prefix string, separator string) (string, string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.Split(rest, separator)
	if len(parts) != 2 {
		return "", "", false
	}
	first := strings.TrimSpace(parts[0])
	second := strings.TrimSpace(parts[1])
	if first == "" || second == "" || strings.Contains(first, "/") || strings.Contains(second, "/") {
		return "", "", false
	}
	return first, second, true
}

func firstQueryText(query url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func firstBodyText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func hasAnyBodyKey(body map[string]any, keys ...string) bool {
	for _, key := range keys {
		if _, ok := body[key]; ok {
			return true
		}
	}
	return false
}

func currentUserFrom(query url.Values, body map[string]any) string {
	uid := firstBodyText(body, "current_user", "operator_uid")
	if uid == "" {
		uid = strings.TrimSpace(query.Get("current_user"))
	}
	if uid == "" {
		uid = firstBodyText(body, "uid")
	}
	return uid
}

func bodyFloat(body map[string]any, key string) (float64, error) {
	value, ok := body[key]
	if !ok || value == nil {
		return 0, fmt.Errorf("%s is required", key)
	}
	switch typed := value.(type) {
	case float64:
		return typed, nil
	case float32:
		return float64(typed), nil
	case int:
		return float64(typed), nil
	case int64:
		return float64(typed), nil
	case jsonNumber:
		return strconv.ParseFloat(string(typed), 64)
	default:
		return strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	}
}

type jsonNumber string
