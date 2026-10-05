package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const codocsTrustedIssueProjectQueryKey = "codocs_trusted_issue_project_code"

func (a *Adapter) issuesList(ctx context.Context, query url.Values) (map[string]any, error) {
	if _, _, err := requireTrustedIssueScope(query); err != nil {
		return nil, err
	}
	projectCode := strings.TrimSpace(query.Get(codocsTrustedIssueProjectQueryKey))
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize
	where := []string{"i.project_code = ?"}
	args := []any{projectCode}
	for key, column := range map[string]string{
		"status":     "status",
		"issue_type": "issue_type",
		"priority":   "priority",
		"assignee":   "assignee",
		"created_by": "created_by",
	} {
		value := strings.TrimSpace(query.Get(key))
		if value == "" {
			continue
		}
		where = append(where, "i."+column+" = ?")
		args = append(args, value)
	}
	if search := firstNonEmpty(query.Get("search"), query.Get("keyword"), query.Get("q")); search != "" {
		where = append(where, "(i.title LIKE ? OR i.description LIKE ?)")
		keyword := "%" + search + "%"
		args = append(args, keyword, keyword)
	}
	whereSQL := strings.Join(where, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM project_issues i WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT i.*,
        (SELECT COUNT(*) FROM issue_comments c WHERE c.issue_id = i.id) AS comment_count
      FROM project_issues i
      WHERE `+whereSQL+`
      ORDER BY
        CASE i.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        i.updated_at DESC
      LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (a *Adapter) createIssue(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, projectCode, err := requireTrustedIssueScope(query)
	if err != nil {
		return nil, err
	}
	requestedProjectCode := stringValue(body["project_code"])
	title := stringValue(body["title"])
	createdBy := actorUID
	if requestedProjectCode == "" || title == "" || createdBy == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "project_code, title and created_by are required")
	}
	if requestedProjectCode != projectCode {
		return nil, httperror.New(http.StatusForbidden, "issue_project_scope_mismatch", "project_code does not match trusted issue scope")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := validateIssueDocumentAssociation(ctx, tx, projectCode, stringValue(body["document_uuid"])); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
      INSERT INTO project_issues
        (project_code, title, description, issue_type, priority, assignee, created_by, document_uuid, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		projectCode,
		title,
		nullableString(stringValue(body["description"])),
		firstNonEmpty(stringValue(body["issue_type"]), "bug"),
		firstNonEmpty(stringValue(body["priority"]), "medium"),
		nullableString(firstNonEmpty(stringValue(body["assignee"]), "zhouguangying")),
		createdBy,
		nullableString(stringValue(body["document_uuid"])),
		nullableString(stringValue(body["tags"])),
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id}, nil
}

func (a *Adapter) issueDetail(ctx context.Context, issueID string, query url.Values) (map[string]any, error) {
	_, projectCode, err := requireTrustedIssueScope(query)
	if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, "SELECT * FROM project_issues WHERE id = ? AND project_code = ? LIMIT 1", issueID, projectCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	comments, err := queryPaged(ctx, a.db, "SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC, id ASC", issueID)
	if err != nil {
		return nil, err
	}
	items[0]["comments"] = comments["items"]
	return items[0], nil
}

func (a *Adapter) updateIssue(ctx context.Context, issueID string, query url.Values, body map[string]any) (map[string]any, error) {
	_, projectCode, err := requireTrustedIssueScope(query)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{
		"title":         true,
		"description":   true,
		"issue_type":    true,
		"status":        true,
		"priority":      true,
		"assignee":      true,
		"document_uuid": true,
		"tags":          true,
		"resolution":    true,
	}
	fields := map[string]any{}
	for key, value := range body {
		if !allowed[key] {
			continue
		}
		fields[key] = normalizeBodyNullable(value)
	}
	status := stringValue(body["status"])
	if status == "resolved" {
		fields["resolved_at"] = sqlLiteral("NOW()")
	}
	if status == "closed" || status == "rejected" {
		fields["closed_at"] = sqlLiteral("NOW()")
	}
	if status == "open" || status == "in_progress" {
		fields["resolved_at"] = nil
		fields["closed_at"] = nil
	}
	if len(fields) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "empty_request", "No writable fields provided")
	}
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	set := make([]string, 0, len(names))
	args := make([]any, 0, len(names)+1)
	for _, name := range names {
		if literal, ok := fields[name].(sqlLiteral); ok {
			set = append(set, "`"+name+"` = "+string(literal))
			continue
		}
		set = append(set, "`"+name+"` = ?")
		args = append(args, fields[name])
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, hasDocumentUUID := fields["document_uuid"]; hasDocumentUUID {
		if err := validateIssueDocumentAssociation(ctx, tx, projectCode, stringValue(fields["document_uuid"])); err != nil {
			return nil, err
		}
	}
	args = append(args, issueID, projectCode)
	result, err := tx.ExecContext(ctx, "UPDATE project_issues SET "+strings.Join(set, ", ")+" WHERE id = ? AND project_code = ?", args...)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"updated": true}, nil
}

func (a *Adapter) deleteIssue(ctx context.Context, issueID string, query url.Values) (map[string]any, error) {
	_, projectCode, err := requireTrustedIssueScope(query)
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, "DELETE FROM project_issues WHERE id = ? AND project_code = ?", issueID, projectCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	return map[string]any{"deleted": true}, nil
}

func (a *Adapter) issuePendingCount(ctx context.Context, query url.Values) (map[string]any, error) {
	_, projectCode, err := requireTrustedIssueScope(query)
	if err != nil {
		return nil, err
	}
	var pending int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM project_issues WHERE project_code = ? AND status IN ('open', 'in_progress')", projectCode).Scan(&pending); err != nil {
		return nil, err
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM project_issues WHERE project_code = ?", projectCode).Scan(&total); err != nil {
		return nil, err
	}
	return map[string]any{"pending": pending, "total": total}, nil
}

func (a *Adapter) createIssueComment(ctx context.Context, issueID string, query url.Values, body map[string]any) (map[string]any, error) {
	author, projectCode, err := requireTrustedIssueScope(query)
	if err != nil {
		return nil, err
	}
	content := stringValue(body["content"])
	if content == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "content is required")
	}
	result, err := a.db.ExecContext(ctx, `
      INSERT INTO issue_comments (issue_id, author, content)
      SELECT id, ?, ? FROM project_issues WHERE id = ? AND project_code = ?`, author, content, issueID, projectCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	id, _ := result.LastInsertId()
	return map[string]any{"id": id}, nil
}

func requireTrustedIssueScope(query url.Values) (string, string, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return "", "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return "", "", httperror.New(http.StatusForbidden, "trusted_actor_required", "Trusted runtime actor delegation is required")
	}
	if strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != "" {
		return "", "", httperror.New(http.StatusForbidden, "issue_user_actor_required", "Issue routes require a user actor delegation")
	}
	projectCode := strings.TrimSpace(query.Get(codocsTrustedIssueProjectQueryKey))
	if projectCode == "" {
		return "", "", httperror.New(http.StatusForbidden, "issue_project_scope_required", "Trusted issue project scope is required")
	}
	return actorUID, projectCode, nil
}

type issueDocumentQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func validateIssueDocumentAssociation(ctx context.Context, queryer issueDocumentQueryer, projectCode, documentUUID string) error {
	documentUUID = strings.TrimSpace(documentUUID)
	if documentUUID == "" {
		return nil
	}
	var matched string
	err := queryer.QueryRowContext(ctx, `
      SELECT uuid FROM documents
      WHERE uuid = ? AND project_code = ? AND status = 1
        AND doc_type IN ('project', 'git-project')
      FOR SHARE`, documentUUID, projectCode).Scan(&matched)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusBadRequest, "issue_document_scope_invalid", "document_uuid is not an active document in the trusted project")
	}
	return err
}
