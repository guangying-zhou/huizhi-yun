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

type workItemDocumentLink struct {
	ID            int64  `json:"id"`
	WorkItemID    int64  `json:"workItemId"`
	DocumentID    string `json:"documentId"`
	LinkedBy      string `json:"linkedBy"`
	LinkedAt      string `json:"linkedAt"`
	DocumentTitle string `json:"documentTitle"`
}

type workItemDocumentProject struct {
	WorkItemID  int64
	ProjectID   int64
	ProjectCode string
}

type workItemSourceDocument struct {
	UUID        string
	Title       string
	DocCategory sql.NullString
	OSSPath     sql.NullString
	CodocsUUID  sql.NullString
	ContentSize sql.NullInt64
}

func (a *Adapter) workItemDocuments(ctx context.Context, rawWorkItemID string, query url.Values) ([]workItemDocumentLink, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	target, err := a.workItemDocumentProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, target.ProjectID, uid, query); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, work_item_id, COALESCE(codocs_uuid, uuid) AS document_id,
		       created_by, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at, title
		FROM project_documents
		WHERE work_item_id = ?
		  AND is_folder = 0
		ORDER BY created_at DESC, id DESC
	`, target.WorkItemID)
	if err != nil {
		return nil, fmt.Errorf("query work item documents: %w", err)
	}
	defer rows.Close()

	items := make([]workItemDocumentLink, 0)
	for rows.Next() {
		var item workItemDocumentLink
		if err := rows.Scan(&item.ID, &item.WorkItemID, &item.DocumentID, &item.LinkedBy, &item.LinkedAt, &item.DocumentTitle); err != nil {
			return nil, fmt.Errorf("scan work item document: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) linkWorkItemDocument(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid := currentUserFrom(query, body)
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	target, err := a.workItemDocumentProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, target.ProjectID, uid, query); err != nil {
		return nil, err
	}

	documentID := strings.TrimSpace(firstBodyText(body, "documentId", "document_id", "codocsUuid", "codocs_uuid", "uuid"))
	if documentID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_document_id", "documentId is required")
	}

	var duplicateID int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT id
		FROM project_documents
		WHERE work_item_id = ?
		  AND is_folder = 0
		  AND (uuid = ? OR codocs_uuid = ?)
		LIMIT 1
	`, target.WorkItemID, documentID, documentID).Scan(&duplicateID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if duplicateID > 0 {
		return nil, httperror.New(http.StatusConflict, "document_already_linked", "该文档已关联")
	}

	source, err := a.workItemSourceDocument(ctx, documentID)
	if err != nil {
		return nil, err
	}

	linkedDocumentID := documentID
	title := fmt.Sprintf("文档 %s", documentID)
	var docCategory sql.NullString
	var ossPath sql.NullString
	var contentSize int64
	if source != nil {
		if source.CodocsUUID.Valid && strings.TrimSpace(source.CodocsUUID.String) != "" {
			linkedDocumentID = strings.TrimSpace(source.CodocsUUID.String)
		} else {
			linkedDocumentID = source.UUID
		}
		title = source.Title
		docCategory = source.DocCategory
		ossPath = source.OSSPath
		if source.ContentSize.Valid {
			contentSize = source.ContentSize.Int64
		}
	}

	docUUID, err := aimsRandomUUID()
	if err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, project_id, project_code, work_item_id, parent_id,
		   title, doc_category, is_folder, oss_path, codocs_uuid, content_size, created_by, updated_by)
		VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?)
	`, docUUID, target.ProjectID, target.ProjectCode, target.WorkItemID, title, nullableSQLString(docCategory), nullableSQLString(ossPath), linkedDocumentID, contentSize, uid, uid)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()

	return map[string]any{
		"id":         id,
		"workItemId": target.WorkItemID,
		"documentId": linkedDocumentID,
		"linkedBy":   uid,
	}, nil
}

func (a *Adapter) unlinkWorkItemDocument(ctx context.Context, rawWorkItemID string, rawDocumentID string, query url.Values) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	documentID := strings.TrimSpace(rawDocumentID)
	if documentID == "" {
		documentID = strings.TrimSpace(firstNonEmptyProjectDocumentParam(query, "documentId", "document_id", "codocsUuid", "codocs_uuid", "uuid"))
	}
	if documentID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_document_id", "documentId is required")
	}

	target, err := a.workItemDocumentProject(ctx, rawWorkItemID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectManagerOrScopedAdmin(ctx, target.ProjectID, uid, query); err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		DELETE FROM project_documents
		WHERE work_item_id = ?
		  AND (uuid = ? OR codocs_uuid = ?)
	`, target.WorkItemID, documentID, documentID)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "document_link_not_found", "关联记录不存在")
	}

	return map[string]any{
		"deleted": true,
		"message": "已取消关联",
	}, nil
}

func (a *Adapter) workItemDocumentProject(ctx context.Context, rawWorkItemID string) (workItemDocumentProject, error) {
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return workItemDocumentProject{}, err
	}

	var target workItemDocumentProject
	err = a.DB().QueryRowContext(ctx, `
		SELECT wi.id, wi.project_id, p.project_code
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		WHERE wi.id = ?
		LIMIT 1
	`, workItemID).Scan(&target.WorkItemID, &target.ProjectID, &target.ProjectCode)
	if err == sql.ErrNoRows {
		return workItemDocumentProject{}, httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	return target, err
}

func (a *Adapter) workItemSourceDocument(ctx context.Context, documentID string) (*workItemSourceDocument, error) {
	var source workItemSourceDocument
	err := a.DB().QueryRowContext(ctx, `
		SELECT uuid, title, doc_category, oss_path, codocs_uuid, content_size
		FROM project_documents
		WHERE is_folder = 0
		  AND (uuid = ? OR codocs_uuid = ?)
		ORDER BY CASE WHEN uuid = ? THEN 0 ELSE 1 END, id ASC
		LIMIT 1
	`, documentID, documentID, documentID).Scan(
		&source.UUID,
		&source.Title,
		&source.DocCategory,
		&source.OSSPath,
		&source.CodocsUUID,
		&source.ContentSize,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &source, nil
}
