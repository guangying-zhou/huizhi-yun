package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectDocumentProject struct {
	ID          int64
	ProjectCode string
	DeptCode    sql.NullString
	LeaderUID   sql.NullString
	CreatedBy   string
}

type projectDocumentBinding struct {
	Source          string
	Title           string
	ContentSize     int64
	CodocsUUID      sql.NullString
	RepoProjectCode sql.NullString
	RepoFilePath    sql.NullString
	RepoCommitID    sql.NullString
}

func (a *Adapter) handleProjectDocumentRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (map[string]any, string, bool, error) {
	projectIDText, ok := pathParam(path, "/v1/aims/projects/", "/documents")
	if ok {
		switch method {
		case http.MethodGet:
			data, err := a.listProjectDocuments(ctx, projectIDText, query)
			return data, "aims.projects.documents.list", true, err
		case http.MethodPost:
			data, err := a.createProjectDocumentBinding(ctx, projectIDText, query, body)
			return data, "aims.projects.documents.create", true, err
		case http.MethodPut, http.MethodPatch:
			data, err := a.replaceProjectDocumentBinding(ctx, projectIDText, query, body)
			return data, "aims.projects.documents.replace", true, err
		}
	}

	projectIDText, ok = pathParam(path, "/v1/aims/projects/", "/codocs-project-documents-context")
	if ok && method == http.MethodGet {
		data, err := a.projectCodocsDocumentsContext(ctx, projectIDText, query)
		return data, "aims.projects.codocs_documents.context", true, err
	}

	if !ok {
		return nil, "", false, nil
	}
	return nil, "", true, httperror.New(http.StatusNotImplemented, "runtime_action_not_supported", "This tenant-runtime adapter does not support the requested action yet")
}

func (a *Adapter) listProjectDocuments(ctx context.Context, projectIDText string, query url.Values) (map[string]any, error) {
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectReadAccess(ctx, projectIDText, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	where := []string{"project_id = ?", "work_item_id IS NULL", "is_folder = 0"}
	args := []any{projectID}
	if category := strings.TrimSpace(firstNonEmptyProjectDocumentParam(query, "doc_category", "docCategory")); category != "" {
		where = append(where, "doc_category = ?")
		args = append(args, category)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, uuid, title, doc_category, codocs_uuid,
		       document_source, repo_project_code, repo_file_path, repo_commit_id,
		       created_by, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM project_documents
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY created_at ASC, id ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}

	documents := make([]map[string]any, 0, len(items))
	var proposal map[string]any
	for _, item := range items {
		document := mapProjectDocumentResponse(item)
		documents = append(documents, document)
		if projectDocumentText(item["doc_category"]) == "project_proposal" && proposal == nil {
			proposal = document
		}
	}

	return map[string]any{
		"items":     items,
		"total":     len(items),
		"page":      1,
		"pageSize":  len(items),
		"documents": documents,
		"proposal":  proposal,
	}, nil
}

func (a *Adapter) createProjectDocumentBinding(ctx context.Context, projectIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	currentUser := currentUserFrom(query, body)
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	project, err := a.projectDocumentProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if project.CreatedBy != currentUser && project.LeaderUID.String != currentUser {
		if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(projectIDText)+"/documents", query, body, projectIDText); err != nil {
			if isHTTPStatus(err, http.StatusForbidden) {
				return nil, httperror.New(http.StatusForbidden, "project_document_forbidden", "无权为该项目绑定文档")
			}
			return nil, err
		}
	}

	binding, err := resolveProjectDocumentBinding(body)
	if err != nil {
		return nil, err
	}

	if err := a.ensureProjectDocumentNotDuplicated(ctx, projectID, binding); err != nil {
		return nil, err
	}

	docUUID, err := aimsRandomUUID()
	if err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, project_id, project_code, parent_id, title, doc_category, is_folder,
		   codocs_uuid, document_source, repo_project_code, repo_file_path, repo_commit_id,
		   content_size, created_by, updated_by)
		VALUES (?, ?, ?, NULL, ?, 'project_proposal', 0, ?, ?, ?, ?, ?, ?, ?, ?)
	`, docUUID, projectID, project.ProjectCode, binding.Title, nullableSQLString(binding.CodocsUUID), binding.Source, nullableSQLString(binding.RepoProjectCode), nullableSQLString(binding.RepoFilePath), nullableSQLString(binding.RepoCommitID), binding.ContentSize, currentUser, currentUser)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()

	return map[string]any{
		"id":              id,
		"projectId":       projectID,
		"source":          binding.Source,
		"title":           binding.Title,
		"codocsUuid":      nullableSQLString(binding.CodocsUUID),
		"repoProjectCode": nullableSQLString(binding.RepoProjectCode),
		"repoFilePath":    nullableSQLString(binding.RepoFilePath),
		"repoCommitId":    nullableSQLString(binding.RepoCommitID),
	}, nil
}

func (a *Adapter) replaceProjectDocumentBinding(ctx context.Context, projectIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	currentUser := currentUserFrom(query, body)
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	project, err := a.projectDocumentProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if project.CreatedBy != currentUser && project.LeaderUID.String != currentUser {
		if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(projectIDText)+"/documents", query, body, projectIDText); err != nil {
			if isHTTPStatus(err, http.StatusForbidden) {
				return nil, httperror.New(http.StatusForbidden, "project_document_forbidden", "无权变更立项书")
			}
			return nil, err
		}
	}

	binding, err := resolveProjectDocumentBinding(body)
	if err != nil {
		return nil, err
	}
	docUUID, err := aimsRandomUUID()
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM project_documents
		WHERE project_id = ? AND work_item_id IS NULL AND doc_category = 'project_proposal'
	`, projectID); err != nil {
		return nil, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, project_id, project_code, parent_id, title, doc_category, is_folder,
		   codocs_uuid, document_source, repo_project_code, repo_file_path, repo_commit_id,
		   content_size, created_by, updated_by)
		VALUES (?, ?, ?, NULL, ?, 'project_proposal', 0, ?, ?, ?, ?, ?, ?, ?, ?)
	`, docUUID, projectID, project.ProjectCode, binding.Title, nullableSQLString(binding.CodocsUUID), binding.Source, nullableSQLString(binding.RepoProjectCode), nullableSQLString(binding.RepoFilePath), nullableSQLString(binding.RepoCommitID), binding.ContentSize, currentUser, currentUser)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()

	return map[string]any{
		"id":              id,
		"projectId":       projectID,
		"source":          binding.Source,
		"title":           binding.Title,
		"codocsUuid":      nullableSQLString(binding.CodocsUUID),
		"repoProjectCode": nullableSQLString(binding.RepoProjectCode),
		"repoFilePath":    nullableSQLString(binding.RepoFilePath),
		"repoCommitId":    nullableSQLString(binding.RepoCommitID),
	}, nil
}

func (a *Adapter) projectCodocsDocumentsContext(ctx context.Context, projectIDText string, query url.Values) (map[string]any, error) {
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectReadAccess(ctx, projectIDText, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	var gitGroup sql.NullString
	err = a.DB().QueryRowContext(ctx, `
		SELECT pf.git_group
		FROM aims_projects p
		LEFT JOIN project_portfolios pf ON pf.id = p.portfolio_id
		WHERE p.id = ?
	`, projectID).Scan(&gitGroup)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return nil, err
	}

	return map[string]any{"gitGroup": nullableSQLString(gitGroup)}, nil
}

func (a *Adapter) projectDocumentProject(ctx context.Context, projectID int64) (projectDocumentProject, error) {
	var project projectDocumentProject
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, project_code, dept_code, leader_uid, created_by
		FROM aims_projects
		WHERE id = ?
	`, projectID).Scan(&project.ID, &project.ProjectCode, &project.DeptCode, &project.LeaderUID, &project.CreatedBy)
	if err == sql.ErrNoRows {
		return projectDocumentProject{}, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return projectDocumentProject{}, err
	}
	return project, nil
}

func resolveProjectDocumentBinding(body map[string]any) (projectDocumentBinding, error) {
	source := strings.ToLower(firstBodyText(body, "source", "document_source"))
	if source != "repo" {
		source = "codocs"
	}

	title := firstBodyText(body, "title")
	contentSize := int64BodyValue(body, "contentSize", "content_size")

	if source == "codocs" {
		codocsUUID := firstBodyText(body, "codocsUuid", "codocs_uuid", "documentId", "document_id")
		if codocsUUID == "" {
			return projectDocumentBinding{}, httperror.New(http.StatusBadRequest, "missing_codocs_uuid", "codocs 源需要 codocsUuid")
		}
		if title == "" {
			title = codocsUUID
		}
		return projectDocumentBinding{
			Source:      "codocs",
			Title:       title,
			ContentSize: contentSize,
			CodocsUUID:  validSQLString(codocsUUID),
		}, nil
	}

	repoProjectCode := firstBodyText(body, "repoProjectCode", "repo_project_code")
	repoFilePath := firstBodyText(body, "repoFilePath", "repo_file_path")
	if repoProjectCode == "" || repoFilePath == "" {
		return projectDocumentBinding{}, httperror.New(http.StatusBadRequest, "missing_repo_document", "repo 源需要 repoProjectCode 和 repoFilePath")
	}
	if title == "" {
		title = repoFilePath
		if index := strings.LastIndex(title, "/"); index >= 0 && index+1 < len(title) {
			title = title[index+1:]
		}
	}
	return projectDocumentBinding{
		Source:          "repo",
		Title:           title,
		ContentSize:     contentSize,
		RepoProjectCode: validSQLString(repoProjectCode),
		RepoFilePath:    validSQLString(repoFilePath),
		RepoCommitID:    validSQLString(firstBodyText(body, "repoCommitId", "repo_commit_id")),
	}, nil
}

func (a *Adapter) ensureProjectDocumentNotDuplicated(ctx context.Context, projectID int64, binding projectDocumentBinding) error {
	var id int64
	var err error
	if binding.Source == "codocs" {
		err = a.DB().QueryRowContext(ctx, `
			SELECT id FROM project_documents
			WHERE project_id = ?
			  AND work_item_id IS NULL
			  AND is_folder = 0
			  AND document_source = 'codocs'
			  AND (codocs_uuid = ? OR uuid = ?)
			LIMIT 1
		`, projectID, binding.CodocsUUID.String, binding.CodocsUUID.String).Scan(&id)
	} else {
		err = a.DB().QueryRowContext(ctx, `
			SELECT id FROM project_documents
			WHERE project_id = ?
			  AND work_item_id IS NULL
			  AND is_folder = 0
			  AND document_source = 'repo'
			  AND repo_project_code = ?
			  AND repo_file_path = ?
			LIMIT 1
		`, projectID, binding.RepoProjectCode.String, binding.RepoFilePath.String).Scan(&id)
	}
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	return httperror.New(http.StatusConflict, "project_document_duplicated", "该文档已关联到项目")
}

func int64BodyValue(body map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		var result int64
		if _, err := fmt.Sscan(fmt.Sprint(value), &result); err == nil && result > 0 {
			return result
		}
	}
	return 0
}

func mapProjectDocumentResponse(item map[string]any) map[string]any {
	source := projectDocumentText(item["document_source"])
	if source == "" {
		source = "codocs"
	}
	return map[string]any{
		"id":              item["id"],
		"uuid":            item["uuid"],
		"title":           item["title"],
		"docCategory":     item["doc_category"],
		"codocsUuid":      item["codocs_uuid"],
		"documentSource":  source,
		"repoProjectCode": item["repo_project_code"],
		"repoFilePath":    item["repo_file_path"],
		"repoCommitId":    item["repo_commit_id"],
		"createdBy":       item["created_by"],
		"createdAt":       item["created_at"],
	}
}

func projectDocumentText(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func firstNonEmptyProjectDocumentParam(query url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func validSQLString(value string) sql.NullString {
	value = strings.TrimSpace(value)
	return sql.NullString{String: value, Valid: value != ""}
}

func nullableSQLString(value sql.NullString) any {
	if value.Valid {
		return value.String
	}
	return nil
}
