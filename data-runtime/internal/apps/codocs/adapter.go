package codocs

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type Adapter struct {
	*compat.Adapter
	db *sql.DB
}

var requiredTables = []string{
	"folders",
	"documents",
	"document_shares",
	"document_versions",
	"document_relations",
	"department_shares",
	"cabinet_folders",
	"cabinet_files",
	"review_flow_templates",
	"document_reviews",
	"document_publish_requests",
	"review_actions",
	"document_annotations",
	"annotation_replies",
	"project_issues",
	"issue_comments",
	"info_bookmarks",
	"info_items",
}

func New(cfg config.CodocsConfig) (*Adapter, error) {
	adapter, err := compat.New(compat.Config{
		AppCode:        "codocs",
		DB:             cfg.DB,
		ResponseMode:   compat.ResponseSuccessData,
		RequiredTables: requiredTables,
		DashboardCounts: []compat.DashboardCount{
			{Key: "documents", Label: "文档", Table: "documents", Where: "deleted_at IS NULL AND status <> 0"},
			{Key: "shared", Label: "共享", Table: "document_shares"},
			{Key: "cabinet_files", Label: "文件柜", Table: "cabinet_files", Where: "deleted_at IS NULL AND status <> 0"},
			{Key: "reviews", Label: "评审", Table: "document_reviews"},
			{Key: "publish_requests", Label: "发布申请", Table: "document_publish_requests"},
		},
		Resources: []compat.ResourceSpec{
			{
				Path:             "documents",
				Table:            "documents",
				IDColumn:         "uuid",
				SearchColumns:    []string{"uuid", "title", "doc_type", "owner_uid", "dept_code", "project_code", "last_editor_uid", "publish_info"},
				DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
				SoftDeleteColumn: "deleted_at",
			},
			{
				Path:           "folders",
				Table:          "folders",
				SearchColumns:  []string{"name", "folder_type", "owner_uid", "dept_code", "project_code"},
				DefaultOrderBy: "`sort_order` ASC, `id` ASC",
			},
			{
				Path:             "cabinet",
				Table:            "cabinet_files",
				IDColumn:         "uuid",
				SearchColumns:    []string{"uuid", "filename", "original_name", "owner_uid", "dept_code"},
				DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
				SoftDeleteColumn: "deleted_at",
			},
			{
				Path:             "dept-cabinet",
				Table:            "cabinet_files",
				IDColumn:         "uuid",
				SearchColumns:    []string{"uuid", "filename", "original_name", "owner_uid", "dept_code"},
				DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
				SoftDeleteColumn: "deleted_at",
			},
			{Path: "cabinet/folders", Table: "cabinet_folders", SearchColumns: []string{"name", "owner_uid", "dept_code"}, DefaultOrderBy: "`sort_order` ASC, `id` ASC"},
			{Path: "dept-cabinet/folders", Table: "cabinet_folders", SearchColumns: []string{"name", "owner_uid", "dept_code"}, DefaultOrderBy: "`sort_order` ASC, `id` ASC"},
			{Path: "dept-shares", Table: "department_shares", SearchColumns: []string{"document_id", "from_dept_code", "dept_code", "shared_by", "status"}, DefaultOrderBy: "`created_at` DESC, `id` DESC"},
			{Path: "reviews", Table: "document_reviews", SearchColumns: []string{"document_uuid", "review_type", "sub_type", "initiator_uid", "target_category", "status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "reviews/templates", Table: "review_flow_templates", SearchColumns: []string{"name", "review_type", "sub_type", "target_category"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "reviews/publish-requests", Table: "document_publish_requests", SearchColumns: []string{"document_uuid", "review_type", "sub_type", "initiator_uid", "target_category", "workflow_status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "review-actions", Table: "review_actions", SearchColumns: []string{"review_id", "actor_uid", "action"}, DefaultOrderBy: "`created_at` DESC, `id` DESC"},
			{Path: "document-shares", Table: "document_shares", SearchColumns: []string{"owner_uid", "shared_to_uid", "permission"}, DefaultOrderBy: "`created_at` DESC, `id` DESC"},
			{Path: "document-versions", Table: "document_versions", SearchColumns: []string{"document_id", "editor_uid", "change_summary"}, DefaultOrderBy: "`version_num` DESC, `id` DESC"},
			{Path: "annotations", Table: "document_annotations", SearchColumns: []string{"document_uuid", "selected_text", "content", "status", "author_id", "author_name"}, DefaultOrderBy: "`created_at` ASC, `id` ASC"},
			{Path: "annotation-replies", Table: "annotation_replies", SearchColumns: []string{"annotation_id", "content", "author_id", "author_name"}, DefaultOrderBy: "`created_at` ASC, `id` ASC"},
			{Path: "issues", Table: "project_issues", SearchColumns: []string{"project_code", "title", "description", "issue_type", "status", "priority", "assignee", "created_by", "document_uuid", "tags"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "issue-comments", Table: "issue_comments", SearchColumns: []string{"issue_id", "author", "content"}, DefaultOrderBy: "`created_at` ASC, `id` ASC"},
		},
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{Adapter: adapter, db: adapter.DB()}, nil
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	suffix := strings.Trim(strings.TrimPrefix(path, "/v1/codocs"), "/")

	if method == http.MethodPost && suffix == "document-access/check" {
		result, err := a.documentAccessCheck(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.document_access.check", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "document-access/policies/") && len(pathSegments(suffix)) == 3 {
		documentUUID := strings.TrimPrefix(suffix, "document-access/policies/")
		result, err := a.getDocumentAccessPolicy(ctx, documentUUID, query)
		return map[string]any{"success": true, "data": result}, "codocs.document_access.policies.get", err
	}
	if (method == http.MethodPut || method == http.MethodPatch) && strings.HasPrefix(suffix, "document-access/policies/") && len(pathSegments(suffix)) == 3 {
		documentUUID := strings.TrimPrefix(suffix, "document-access/policies/")
		result, err := a.updateDocumentAccessPolicy(ctx, documentUUID, body)
		return map[string]any{"success": true, "data": result}, "codocs.document_access.policies.update", err
	}
	if method == http.MethodGet && suffix == "document-access/audit-logs" {
		result, err := a.listDocumentAccessAuditLogs(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.document_access.audit_logs.list", err
	}
	if method == http.MethodPost && suffix == "service/ops-knowledge/link" {
		result, err := a.linkOpsKnowledge(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.service.ops_knowledge.link", err
	}

	if method == http.MethodGet && suffix == "documents" {
		result, err := a.documentsList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.documents.list", err
	}
	if method == http.MethodGet && suffix == "documents/stats/my" {
		result, err := a.myDocumentStats(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.documents.stats.my", err
	}
	if method == http.MethodPost && suffix == "documents" {
		result, err := a.createDocument(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.create", err
	}
	if method == http.MethodGet && suffix == "documents/search" {
		result, err := a.documentsSearch(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.documents.search", err
	}
	if method == http.MethodPost && suffix == "documents/batch-summary" {
		result, err := a.documentsBatchSummary(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.batch_summary", err
	}
	if method == http.MethodGet && suffix == "documents/check-name" {
		result, err := a.documentNameExists(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.documents.check_name", err
	}
	if method == http.MethodGet && suffix == "documents/trash" {
		result, err := a.documentsTrash(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.documents.trash", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "documents/") && len(pathSegments(suffix)) == 2 {
		uuid := strings.TrimPrefix(suffix, "documents/")
		result, err := a.documentAccess(ctx, uuid, query)
		return map[string]any{"success": true, "data": result}, "codocs.documents.get", err
	}
	if (method == http.MethodPatch || method == http.MethodPut) && strings.HasPrefix(suffix, "documents/") && len(pathSegments(suffix)) == 2 {
		uuid := strings.TrimPrefix(suffix, "documents/")
		result, err := a.updateDocument(ctx, uuid, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.update", err
	}
	if method == http.MethodDelete && strings.HasPrefix(suffix, "documents/") && len(pathSegments(suffix)) == 2 {
		uuid := strings.TrimPrefix(suffix, "documents/")
		result, err := a.deleteDocument(ctx, uuid, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.delete", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/restore") {
		uuid := pathMiddle(suffix, "documents/", "/restore")
		result, err := a.restoreDocument(ctx, uuid, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.restore", err
	}
	if strings.HasPrefix(suffix, "documents/") && strings.Contains(suffix, "/annotations") {
		segments := pathSegments(suffix)
		if len(segments) == 3 && segments[2] == "annotations" && method == http.MethodGet {
			result, err := a.documentAnnotations(ctx, segments[1])
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.list", err
		}
		if len(segments) == 3 && segments[2] == "annotations" && method == http.MethodPost {
			result, err := a.createDocumentAnnotation(ctx, segments[1], body)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.create", err
		}
		if len(segments) == 4 && segments[2] == "annotations" && method == http.MethodPatch {
			result, err := a.updateDocumentAnnotation(ctx, segments[3], body)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.update", err
		}
		if len(segments) == 5 && segments[2] == "annotations" && segments[4] == "replies" && method == http.MethodPost {
			result, err := a.createAnnotationReply(ctx, segments[3], body)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.replies.create", err
		}
		if len(segments) == 6 && segments[2] == "annotations" && segments[4] == "replies" && method == http.MethodDelete {
			result, err := a.deleteAnnotationReply(ctx, segments[5])
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.replies.delete", err
		}
	}
	if method == http.MethodGet && suffix == "cabinet" {
		result, err := a.cabinetList(ctx, query, false)
		return map[string]any{"success": true, "data": result}, "codocs.cabinet.list", err
	}
	if method == http.MethodGet && suffix == "dept-cabinet" {
		result, err := a.cabinetList(ctx, query, true)
		return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.list", err
	}
	if method == http.MethodGet && suffix == "issues" {
		result, err := a.issuesList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.issues.list", err
	}
	if method == http.MethodPost && suffix == "issues" {
		result, err := a.createIssue(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.issues.create", err
	}
	if method == http.MethodGet && suffix == "issues/pending-count" {
		result, err := a.issuePendingCount(ctx)
		return map[string]any{"success": true, "data": result}, "codocs.issues.pending_count", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "issues/") && strings.HasSuffix(suffix, "/comments") {
		issueID := pathMiddle(suffix, "issues/", "/comments")
		result, err := a.createIssueComment(ctx, issueID, body)
		return map[string]any{"success": true, "data": result}, "codocs.issues.comments.create", err
	}
	if strings.HasPrefix(suffix, "issues/") && len(pathSegments(suffix)) == 2 {
		issueID := strings.TrimPrefix(suffix, "issues/")
		switch method {
		case http.MethodGet:
			result, err := a.issueDetail(ctx, issueID)
			return map[string]any{"success": true, "data": result}, "codocs.issues.get", err
		case http.MethodPatch:
			result, err := a.updateIssue(ctx, issueID, body)
			return map[string]any{"success": true, "data": result}, "codocs.issues.update", err
		case http.MethodDelete:
			result, err := a.deleteIssue(ctx, issueID)
			return map[string]any{"success": true, "data": result}, "codocs.issues.delete", err
		}
	}
	if method == http.MethodGet && suffix == "info/list" {
		result, err := a.infoList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.info.list", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "info/items/") && len(pathSegments(suffix)) == 3 {
		id := strings.TrimPrefix(suffix, "info/items/")
		result, err := a.infoDetail(ctx, id, query)
		return map[string]any{"success": true, "data": result}, "codocs.info.get", err
	}
	if method == http.MethodDelete && strings.HasPrefix(suffix, "info/items/") && len(pathSegments(suffix)) == 3 {
		id := strings.TrimPrefix(suffix, "info/items/")
		result, err := a.deleteInfoItem(ctx, id)
		return map[string]any{"success": true, "data": result}, "codocs.info.delete", err
	}
	if method == http.MethodGet && suffix == "info/bookmarks" {
		result, err := a.infoBookmarks(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.info.bookmarks.list", err
	}
	if (method == http.MethodPut || method == http.MethodPatch) && suffix == "info/bookmarks/actions" {
		result, err := a.updateInfoBookmarks(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.info.bookmarks.actions", err
	}
	if method == http.MethodPost && suffix == "info/bookmarks/import" {
		result, err := a.importInfoBookmarks(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.info.bookmarks.import", err
	}
	if method == http.MethodPost && suffix == "info/bookmarks/processing" {
		result, err := a.processingInfoBookmarks(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.info.bookmarks.processing", err
	}
	if method == http.MethodPost && suffix == "info/items" {
		result, err := a.createInfoItemFromBookmark(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.info.items.create", err
	}
	if method == http.MethodGet && suffix == "folders" {
		result, err := a.foldersList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.folders.list", err
	}
	if method == http.MethodGet && suffix == "collaboration/context" {
		result, err := a.collaborationContext(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.collaboration.context", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "collaboration/documents/") && strings.HasSuffix(suffix, "/context") {
		uuid := pathMiddle(suffix, "collaboration/documents/", "/context")
		result, err := a.collaborationContext(ctx, queryWithUUID(query, uuid))
		return map[string]any{"success": true, "data": result}, "codocs.collaboration.context", err
	}
	if method == http.MethodPost && suffix == "collaboration/versions" {
		result, err := a.createCollaborationVersion(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.collaboration.versions.create", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/versions") {
		uuid := pathMiddle(suffix, "documents/", "/versions")
		body["uuid"] = uuid
		result, err := a.createCollaborationVersion(ctx, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.versions.create", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/shares") {
		uuid := pathMiddle(suffix, "documents/", "/shares")
		result, err := a.documentShares(ctx, uuid)
		return map[string]any{"success": true, "data": result}, "codocs.documents.shares.list", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/shares") {
		uuid := pathMiddle(suffix, "documents/", "/shares")
		result, err := a.createDocumentShare(ctx, uuid, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.shares.create", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/relations/preview-access") {
		uuid := pathMiddle(suffix, "documents/", "/relations/preview-access")
		result, err := a.grantDocumentPreviewAccess(ctx, uuid, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.preview_access.grant", err
	}
	if (method == http.MethodPatch || method == http.MethodDelete) && strings.HasPrefix(suffix, "documents/") && strings.Contains(suffix, "/shares/") {
		uuid, shareID := documentNestedID(suffix, "shares")
		var result map[string]any
		var err error
		if method == http.MethodPatch {
			result, err = a.updateDocumentShare(ctx, uuid, shareID, body)
		} else {
			result, err = a.deleteDocumentShare(ctx, uuid, shareID, body)
		}
		return map[string]any{"success": true, "data": result}, "codocs.documents.shares.mutate", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/read") {
		uuid := pathMiddle(suffix, "documents/", "/read")
		result, err := a.markDocumentRead(ctx, uuid, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.read", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/versions") {
		uuid := pathMiddle(suffix, "documents/", "/versions")
		result, err := a.documentVersions(ctx, uuid)
		return map[string]any{"success": true, "data": result}, "codocs.documents.versions.list", err
	}
	if method == http.MethodDelete && strings.HasPrefix(suffix, "documents/") && strings.Contains(suffix, "/versions/") {
		uuid, versionID := documentNestedID(suffix, "versions")
		result, err := a.deleteDocumentVersion(ctx, uuid, versionID, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.versions.delete", err
	}
	if method == http.MethodGet && suffix == "reviews/my" {
		result, err := a.myReviews(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.my", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "reviews/by-document/") && len(pathSegments(suffix)) == 3 {
		uuid := strings.TrimPrefix(suffix, "reviews/by-document/")
		result, err := a.reviewByDocument(ctx, uuid)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.by_document", err
	}
	if method == http.MethodGet && suffix == "reviews/by-oss-path" {
		result, err := a.reviewByOssPath(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.by_oss_path", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "reviews/") && len(pathSegments(suffix)) == 2 {
		id := strings.TrimPrefix(suffix, "reviews/")
		result, err := a.reviewDetail(ctx, id)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.get", err
	}
	if method == http.MethodGet && suffix == "collab-docs" {
		result, err := a.collabDocs(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.collab_docs.list", err
	}

	return a.Adapter.HandleRuntime(ctx, method, path, query, body)
}

func (a *Adapter) collaborationContext(ctx context.Context, query url.Values) (map[string]any, error) {
	documentName := strings.TrimSpace(query.Get("documentName"))
	uuid := strings.TrimSpace(query.Get("uuid"))
	if uuid == "" && strings.HasPrefix(documentName, "doc:") {
		uuid = strings.TrimPrefix(documentName, "doc:")
	}
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document", "Document uuid is required")
	}

	row := a.db.QueryRowContext(ctx, `
		SELECT id, uuid, doc_type, oss_path, owner_uid, readonly_flag, status
		FROM documents
		WHERE uuid = ? AND status <> 0
		LIMIT 1`, uuid)

	var docID int64
	var docUUID, docType, ossPath, ownerUID string
	var readonlyFlag int
	var status int
	if err := row.Scan(&docID, &docUUID, &docType, &ossPath, &ownerUID, &readonlyFlag, &status); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
		}
		return nil, err
	}

	actorUID := strings.TrimSpace(query.Get("actorUid"))
	actorName := strings.TrimSpace(query.Get("actorName"))
	sharePermission := ""
	if actorUID != "" && actorUID != ownerUID {
		err := a.db.QueryRowContext(ctx, `
			SELECT permission
			FROM document_shares
			WHERE document_id = ? AND shared_to_uid = ?
			LIMIT 1`, docID, actorUID).Scan(&sharePermission)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
			}
			return nil, err
		}
	}

	readonly := readonlyFlag == 1 || (actorUID != "" && actorUID != ownerUID && sharePermission != "write")
	if actorName == "" {
		actorName = actorUID
	}

	result := map[string]any{
		"docId":           docID,
		"docUuid":         docUUID,
		"docType":         docType,
		"ossPath":         ossPath,
		"ownerUid":        ownerUID,
		"actorUid":        actorUID,
		"actorName":       actorName,
		"sharePermission": nil,
		"readonly":        readonly,
	}
	if sharePermission != "" {
		result["sharePermission"] = sharePermission
	}
	return result, nil
}

func (a *Adapter) createCollaborationVersion(ctx context.Context, body map[string]any) (map[string]any, error) {
	docID := int64Value(body["docId"])
	if docID == 0 {
		var err error
		docID, err = a.documentIDByUUID(ctx, stringValue(body["uuid"]))
		if err != nil {
			return nil, err
		}
	}
	if docID == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document", "docId or uuid is required")
	}
	editorUID := firstNonEmpty(stringValue(body["editorUid"]), stringValue(body["actorUid"]), "system")
	ossVersionID := stringValue(body["ossVersionId"])
	contentSize := int64Value(body["contentSize"])

	var maxVersion sql.NullInt64
	if err := a.db.QueryRowContext(ctx, "SELECT MAX(version_num) FROM document_versions WHERE document_id = ?", docID).Scan(&maxVersion); err != nil {
		return nil, err
	}
	nextVersion := maxVersion.Int64 + 1
	if !maxVersion.Valid {
		nextVersion = 1
	}

	result, err := a.db.ExecContext(ctx, `
		INSERT INTO document_versions
			(document_id, version_num, oss_version_id, editor_uid, content_size)
		VALUES (?, ?, ?, ?, ?)`, docID, nextVersion, ossVersionID, editorUID, contentSize)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{
		"id":         id,
		"documentId": docID,
		"versionNum": nextVersion,
	}, nil
}

func (a *Adapter) documentsList(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 5000)
	offset := (page - 1) * pageSize

	docType := strings.TrimSpace(query.Get("type"))
	owner := strings.TrimSpace(query.Get("owner"))
	folderID := strings.TrimSpace(query.Get("folder_id"))
	publishedMode := strings.TrimSpace(query.Get("published_mode"))

	where := []string{"d.status = 1"}
	args := []any{}
	selectArgs := []any{}
	selectColumns := `d.id, d.uuid, d.title, d.doc_type, d.oss_path, d.owner_uid,
        d.dept_code, d.project_code, d.folder_id, d.content_size,
        d.last_editor_uid, d.created_at, d.updated_at, d.star_flag,
        d.home_flag, d.readonly_flag, d.publish_info,
        f.name AS folder_name`

	if docType == "shared" {
		if owner != "" {
			where = append(where, "d.id IN (SELECT document_id FROM document_shares WHERE shared_to_uid = ?)")
			args = append(args, owner)
			selectColumns += `,
        (SELECT is_opened FROM document_shares ds WHERE ds.document_id = d.id AND ds.shared_to_uid = ?) AS is_opened,
        (SELECT permission FROM document_shares ds WHERE ds.document_id = d.id AND ds.shared_to_uid = ?) AS share_permission,
        (SELECT message FROM document_shares ds WHERE ds.document_id = d.id AND ds.shared_to_uid = ?) AS share_message`
			selectArgs = append(selectArgs, owner, owner, owner)
		}
	} else if docType == "shared_by_me" {
		if owner != "" {
			where = append(where, "d.owner_uid = ? AND d.id IN (SELECT document_id FROM document_shares)")
			args = append(args, owner)
			selectColumns += `, (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'share_id', s.id,
            'uid', s.shared_to_uid,
            'permission', s.permission,
            'is_opened', s.is_opened,
            'opened_at', s.opened_at
          )
        )
        FROM document_shares s
        WHERE s.document_id = d.id
      ) AS shared_info`
		}
	} else {
		if docType == "project" {
			where = append(where, `d.doc_type IN ("project", "git-project")`)
		} else if docType != "" {
			where = append(where, "d.doc_type = ?")
			args = append(args, docType)
		}
		if owner != "" {
			where = append(where, "d.owner_uid = ?")
			args = append(args, owner)
		}
	}

	addEqualsFilter := func(queryKey string, column string) {
		value := strings.TrimSpace(query.Get(queryKey))
		if value == "" {
			return
		}
		where = append(where, "d."+column+" = ?")
		args = append(args, value)
	}
	addEqualsFilter("last_editor", "last_editor_uid")
	addEqualsFilter("dept_code", "dept_code")
	addEqualsFilter("project_code", "project_code")
	addEqualsFilter("oss_path", "oss_path")

	if query.Get("starred") == "true" || query.Get("starred") == "1" {
		where = append(where, "d.star_flag = 1")
	}
	if query.Get("home") == "true" || query.Get("home") == "1" {
		where = append(where, "d.home_flag = 1")
	}
	if _, ok := query["folder_id"]; ok {
		if folderID == "" || folderID == "null" {
			where = append(where, "d.folder_id IS NULL")
		} else {
			where = append(where, "d.folder_id = ?")
			args = append(args, folderID)
		}
	}
	if publishedMode == "published" {
		where = append(where, "d.publish_info IS NOT NULL")
	} else if publishedMode == "unpublished" {
		where = append(where, "d.publish_info IS NULL")
	}
	if query.Get("exclude_worklogs") == "true" || query.Get("exclude_worklogs") == "1" {
		where = append(where, `d.oss_path NOT LIKE 'codocs/worklogs/%'`)
	}
	if query.Get("exclude_weekly_reports") == "true" || query.Get("exclude_weekly_reports") == "1" {
		where = append(where, `d.oss_path NOT LIKE '%/weekly-reports/%'`)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents d WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT `+selectColumns+`
      FROM documents d
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE `+whereSQL+`
      ORDER BY d.updated_at DESC
      LIMIT ? OFFSET ?`, append(append(selectArgs, args...), pageSize, offset)...)
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

func (a *Adapter) foldersList(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 5000)
	offset := (page - 1) * pageSize

	where := []string{"1=1"}
	args := []any{}
	addEquals := func(queryKey string, column string) {
		value := strings.TrimSpace(query.Get(queryKey))
		if value == "" {
			return
		}
		where = append(where, column+" = ?")
		args = append(args, value)
	}
	addEquals("folder_type", "folder_type")
	addEquals("owner_uid", "owner_uid")
	addEquals("dept_code", "dept_code")
	addEquals("project_code", "project_code")
	if _, ok := query["parent_id"]; ok {
		parentID := strings.TrimSpace(query.Get("parent_id"))
		if parentID == "" || parentID == "null" {
			where = append(where, "parent_id IS NULL")
		} else {
			where = append(where, "parent_id = ?")
			args = append(args, parentID)
		}
	}
	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM folders WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT id, name, folder_type, owner_uid, dept_code, project_code,
             parent_id, sort_order, created_at, updated_at
      FROM folders
      WHERE `+whereSQL+`
      ORDER BY sort_order ASC, created_at DESC
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

func (a *Adapter) documentsSearch(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("page_size"), query.Get("pageSize"), query.Get("limit")), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	where := []string{"d.status != 0"}
	args := []any{}
	if keyword := strings.TrimSpace(query.Get("keyword")); keyword != "" {
		where = append(where, "d.title LIKE ?")
		args = append(args, "%"+keyword+"%")
	}
	for key, column := range map[string]string{
		"doc_type":     "doc_type",
		"project_code": "project_code",
		"dept_code":    "dept_code",
		"owner_uid":    "owner_uid",
	} {
		value := strings.TrimSpace(query.Get(key))
		if value == "" {
			continue
		}
		where = append(where, "d."+column+" = ?")
		args = append(args, value)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents d WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT d.uuid, d.title, d.doc_type, d.owner_uid, d.dept_code,
             d.project_code, d.content_size, d.ai_abstract, d.updated_at
      FROM documents d
      WHERE `+whereSQL+`
      ORDER BY d.updated_at DESC
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

func (a *Adapter) documentsBatchSummary(ctx context.Context, body map[string]any) ([]map[string]any, error) {
	uuids := stringSlice(body["uuids"])
	if len(uuids) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uuids is required")
	}
	if len(uuids) > 50 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "At most 50 documents can be requested")
	}
	unique := uniqueStrings(uuids)
	placeholders := strings.TrimRight(strings.Repeat("?,", len(unique)), ",")
	args := make([]any, 0, len(unique))
	for _, uuid := range unique {
		args = append(args, uuid)
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT uuid, title, doc_type, owner_uid, status, content_size, ai_abstract, updated_at
      FROM documents
      WHERE uuid IN (`+placeholders+`) AND status != 0`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	byUUID := map[string]map[string]any{}
	for _, item := range items {
		byUUID[stringValue(item["uuid"])] = item
	}
	result := make([]map[string]any, 0, len(uuids))
	for _, uuid := range uuids {
		if item, ok := byUUID[uuid]; ok {
			result = append(result, item)
		} else {
			result = append(result, map[string]any{"uuid": uuid, "title": nil, "error": "not_found"})
		}
	}
	return result, nil
}

func (a *Adapter) myDocumentStats(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}

	var allDocumentCount sql.NullInt64
	var allTotalSize sql.NullInt64
	var myDocumentCount sql.NullInt64
	var myTotalSize sql.NullInt64
	if err := a.db.QueryRowContext(ctx, `
      SELECT
        COUNT(*) AS all_count,
        COALESCE(SUM(content_size), 0) AS all_size,
        COALESCE(SUM(CASE WHEN owner_uid = ? THEN 1 ELSE 0 END), 0) AS my_count,
        COALESCE(SUM(CASE WHEN owner_uid = ? THEN content_size ELSE 0 END), 0) AS my_size
      FROM documents
      WHERE status IN (1, 2)
        AND deleted_at IS NULL
        AND doc_type <> 'git-project'`,
		actorUID, actorUID).Scan(&allDocumentCount, &allTotalSize, &myDocumentCount, &myTotalSize); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT
        doc_type,
        COUNT(*) AS count,
        COALESCE(SUM(content_size), 0) AS size
      FROM documents
      WHERE status IN (1, 2)
        AND deleted_at IS NULL
        AND doc_type <> 'git-project'
        AND owner_uid = ?
      GROUP BY doc_type
      ORDER BY count DESC, doc_type ASC`,
		actorUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byType, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	normalizedByType := make([]map[string]any, 0, len(byType))
	for _, row := range byType {
		normalizedByType = append(normalizedByType, map[string]any{
			"docType": stringValue(row["doc_type"]),
			"count":   int64Value(row["count"]),
			"size":    int64Value(row["size"]),
		})
	}

	myCount := sqlNullInt64Value(myDocumentCount)
	mySize := sqlNullInt64Value(myTotalSize)
	allCount := sqlNullInt64Value(allDocumentCount)
	allSize := sqlNullInt64Value(allTotalSize)

	return map[string]any{
		"myDocumentCount":  myCount,
		"myTotalSize":      mySize,
		"allDocumentCount": allCount,
		"allTotalSize":     allSize,
		"countRatio":       ratioValue(myCount, allCount),
		"sizeRatio":        ratioValue(mySize, allSize),
		"byType":           normalizedByType,
	}, nil
}

func (a *Adapter) createDocument(ctx context.Context, body map[string]any) (map[string]any, error) {
	title := firstNonEmpty(stringValue(body["title"]), stringValue(body["name"]))
	ownerUID := firstNonEmpty(stringValue(body["ownerUid"]), stringValue(body["owner_uid"]), stringValue(body["current_user"]))
	if title == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Document title is required")
	}
	if ownerUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "ownerUid is required")
	}

	deptCode := firstNonEmpty(stringValue(body["deptCode"]), stringValue(body["dept_code"]))
	projectCode := firstNonEmpty(stringValue(body["projectCode"]), stringValue(body["project_code"]))
	docType := firstNonEmpty(stringValue(body["docType"]), stringValue(body["doc_type"]))
	if docType == "" {
		docType = inferDocumentTypeFromBusinessContext(body, projectCode)
	}
	folderID := int64Value(firstNonEmpty(stringValue(body["folderId"]), stringValue(body["folder_id"])))
	folderPath := firstNonEmpty(stringValue(body["folderPath"]), stringValue(body["folder_path"]))
	if folderPath == "" && folderID > 0 {
		resolvedFolderPath, err := a.folderPath(ctx, folderID)
		if err != nil {
			return nil, err
		}
		folderPath = resolvedFolderPath
	}
	ossPath := firstNonEmpty(stringValue(body["ossPath"]), stringValue(body["oss_path"]))
	if ossPath == "" {
		ossPath = documentPath(docType, ownerUID, projectCode, deptCode, title, folderPath)
	}

	var existingID int64
	err := a.db.QueryRowContext(ctx, "SELECT id FROM documents WHERE oss_path = ? AND status != 0 LIMIT 1", ossPath).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if existingID > 0 {
		return nil, httperror.New(http.StatusConflict, "document_exists", "Document already exists")
	}

	docUUID := firstNonEmpty(stringValue(body["uuid"]), stringValue(body["documentUuid"]), stringValue(body["document_uuid"]))
	if docUUID == "" {
		var uuidErr error
		docUUID, uuidErr = randomUUID()
		if uuidErr != nil {
			return nil, uuidErr
		}
	}
	contentSize := int64Value(firstNonEmpty(stringValue(body["contentSize"]), stringValue(body["content_size"])))
	if contentSize == 0 {
		content := stringValue(body["content"])
		if content != "" {
			contentSize = int64(len([]byte(content)))
		}
	}

	result, err := a.db.ExecContext(ctx, `
      INSERT INTO documents
        (uuid, title, doc_type, oss_path, owner_uid, dept_code, project_code, folder_id, content_size, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		docUUID,
		title,
		docType,
		ossPath,
		ownerUID,
		nullableString(deptCode),
		nullableString(projectCode),
		nullableInt64(folderID),
		contentSize,
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	_ = a.upsertDocumentRelation(ctx, documentRelationInput{
		DocumentID:   id,
		DocumentUUID: docUUID,
		RelatedUID:   ownerUID,
		RelationType: "created_by_me",
		SourceType:   "document",
		SourceID:     strconv.FormatInt(id, 10),
		CanRead:      true,
		CanEdit:      true,
		Metadata: map[string]any{
			"docType":     docType,
			"deptCode":    nullableString(deptCode),
			"projectCode": nullableString(projectCode),
			"folderId":    nullableInt64(folderID),
			"sourceApp":   firstNonEmpty(stringValue(body["sourceApp"]), stringValue(body["source_app"])),
			"sourceBiz":   firstNonEmpty(stringValue(body["sourceBizCode"]), stringValue(body["source_biz_code"]), stringValue(body["bizId"]), stringValue(body["biz_id"])),
		},
	})
	return map[string]any{
		"id":       id,
		"uuid":     docUUID,
		"title":    title,
		"doc_type": docType,
		"oss_path": ossPath,
	}, nil
}

func inferDocumentTypeFromBusinessContext(body map[string]any, projectCode string) string {
	sourceApp := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringValue(body["sourceApp"]), stringValue(body["source_app"]))))
	if firstNonEmpty(stringValue(body["productCode"]), stringValue(body["product_code"])) != "" {
		return "product"
	}
	switch sourceApp {
	case "aims":
		return "project"
	case "altoc":
		return "sale"
	case "assets":
		if firstNonEmpty(stringValue(body["deliveryCode"]), stringValue(body["delivery_code"]), stringValue(body["assetCode"]), stringValue(body["asset_code"])) != "" {
			if projectCode != "" {
				return "project"
			}
			return "knowledge"
		}
		return "knowledge"
	}
	if projectCode != "" {
		return "project"
	}
	if firstNonEmpty(stringValue(body["contractCode"]), stringValue(body["contract_code"]), stringValue(body["customerCode"]), stringValue(body["customer_code"])) != "" {
		return "sale"
	}
	return "private"
}

func (a *Adapter) documentNameExists(ctx context.Context, query url.Values) (map[string]any, error) {
	title := strings.TrimSpace(query.Get("title"))
	if title == "" {
		return map[string]any{"exists": false}, nil
	}

	where := []string{"status = 1", "title = ?"}
	args := []any{title}
	docType := strings.TrimSpace(query.Get("doc_type"))
	if docType == "project" {
		where = append(where, `doc_type IN ("project", "git-project")`)
	} else if docType != "" {
		where = append(where, "doc_type = ?")
		args = append(args, docType)
	}
	if ownerUID := strings.TrimSpace(query.Get("owner_uid")); ownerUID != "" {
		where = append(where, "owner_uid = ?")
		args = append(args, ownerUID)
	}
	if _, ok := query["folder_id"]; ok {
		folderID := strings.TrimSpace(query.Get("folder_id"))
		if folderID == "" || folderID == "null" {
			where = append(where, "folder_id IS NULL")
		} else {
			where = append(where, "folder_id = ?")
			args = append(args, folderID)
		}
	}
	if deptCode := strings.TrimSpace(query.Get("dept_code")); deptCode != "" {
		where = append(where, "dept_code = ?")
		args = append(args, deptCode)
	}
	if projectCode := strings.TrimSpace(query.Get("project_code")); projectCode != "" {
		where = append(where, "project_code = ?")
		args = append(args, projectCode)
	}
	if excludeUUID := strings.TrimSpace(query.Get("exclude_uuid")); excludeUUID != "" {
		where = append(where, "uuid != ?")
		args = append(args, excludeUUID)
	}

	var count int
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents WHERE "+strings.Join(where, " AND "), args...).Scan(&count); err != nil {
		return nil, err
	}
	return map[string]any{"exists": count > 0}, nil
}

func (a *Adapter) documentsTrash(ctx context.Context, query url.Values) (map[string]any, error) {
	where := []string{"d.status = 0", "d.deleted_at IS NOT NULL"}
	args := []any{}
	docType := strings.TrimSpace(query.Get("type"))
	if docType == "project" {
		where = append(where, `d.doc_type IN ("project", "git-project")`)
	} else if docType != "" {
		where = append(where, "d.doc_type = ?")
		args = append(args, docType)
	}
	if owner := strings.TrimSpace(query.Get("owner")); owner != "" {
		where = append(where, "d.owner_uid = ?")
		args = append(args, owner)
	}
	if deptCode := strings.TrimSpace(query.Get("dept_code")); deptCode != "" {
		where = append(where, "d.dept_code = ?")
		args = append(args, deptCode)
	}
	if projectCode := strings.TrimSpace(query.Get("project_code")); projectCode != "" {
		where = append(where, "d.project_code = ?")
		args = append(args, projectCode)
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT d.id, d.uuid, d.title, d.doc_type, d.oss_path, d.owner_uid,
        d.dept_code, d.project_code, d.folder_id, d.content_size,
        d.last_editor_uid, d.created_at, d.updated_at, d.deleted_at,
        f.name AS folder_name
      FROM documents d
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE `+strings.Join(where, " AND ")+`
      ORDER BY d.deleted_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": len(items), "page": 1, "pageSize": len(items)}, nil
}

func (a *Adapter) updateDocument(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	doc, err := a.requireDocumentWrite(ctx, uuid, body, false)
	if err != nil {
		return nil, err
	}
	updates := map[string]any{}
	setIfPresent := func(bodyKey string, column string, normalize func(any) any) {
		value, ok := body[bodyKey]
		if !ok {
			return
		}
		if normalize != nil {
			value = normalize(value)
		}
		updates[column] = value
	}
	setIfPresent("title", "title", nil)
	setIfPresent("folder_id", "folder_id", normalizeNullableNumber)
	setIfPresent("folderId", "folder_id", normalizeNullableNumber)
	setIfPresent("star_flag", "star_flag", normalizeBoolInt)
	setIfPresent("starFlag", "star_flag", normalizeBoolInt)
	setIfPresent("home_flag", "home_flag", normalizeBoolInt)
	setIfPresent("homeFlag", "home_flag", normalizeBoolInt)
	setIfPresent("readonly_flag", "readonly_flag", normalizeBoolInt)
	setIfPresent("readonlyFlag", "readonly_flag", normalizeBoolInt)
	setIfPresent("doc_type", "doc_type", nil)
	setIfPresent("docType", "doc_type", nil)
	setIfPresent("dept_code", "dept_code", normalizeNullableString)
	setIfPresent("deptCode", "dept_code", normalizeNullableString)
	setIfPresent("project_code", "project_code", normalizeNullableString)
	setIfPresent("projectCode", "project_code", normalizeNullableString)
	setIfPresent("oss_path", "oss_path", normalizeNullableString)
	setIfPresent("ossPath", "oss_path", normalizeNullableString)
	setIfPresent("content_size", "content_size", normalizeInt64)
	setIfPresent("contentSize", "content_size", normalizeInt64)
	setIfPresent("last_editor_uid", "last_editor_uid", normalizeNullableString)
	setIfPresent("lastEditorUid", "last_editor_uid", normalizeNullableString)
	setIfPresent("ai_abstract", "ai_abstract", normalizeNullableString)
	setIfPresent("aiAbstract", "ai_abstract", normalizeNullableString)

	if title, ok := updates["title"]; ok && strings.TrimSpace(fmt.Sprint(title)) != stringValue(doc["title"]) {
		folderValue := doc["folder_id"]
		if value, ok := updates["folder_id"]; ok {
			folderValue = value
		}
		if err := a.ensureDocumentTitleAvailable(ctx, uuid, doc, strings.TrimSpace(fmt.Sprint(title)), folderValue); err != nil {
			return nil, err
		}
	}

	if len(updates) == 0 {
		return map[string]any{"uuid": uuid, "updated": false}, nil
	}

	names := make([]string, 0, len(updates))
	for name := range updates {
		names = append(names, name)
	}
	sort.Strings(names)
	set := make([]string, 0, len(names)+1)
	args := make([]any, 0, len(names)+1)
	for _, name := range names {
		set = append(set, "`"+name+"` = ?")
		args = append(args, updates[name])
	}
	set = append(set, "updated_at = NOW()")
	args = append(args, uuid)
	if _, err := a.db.ExecContext(ctx, "UPDATE documents SET "+strings.Join(set, ", ")+" WHERE uuid = ?", args...); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "updated": true}, nil
}

func (a *Adapter) deleteDocument(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	if _, err := a.requireDocumentWrite(ctx, uuid, body, false); err != nil {
		return nil, err
	}
	recyclePath := firstNonEmpty(stringValue(body["recyclePath"]), stringValue(body["recycle_path"]), stringValue(body["oss_path"]))
	if _, err := a.db.ExecContext(ctx, `
      UPDATE documents
      SET status = 0, deleted_at = NOW(), oss_path = COALESCE(NULLIF(?, ''), oss_path), updated_at = NOW()
      WHERE uuid = ?`, recyclePath, uuid); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "deleted": true}, nil
}

func (a *Adapter) restoreDocument(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	doc, err := a.requireDocumentWrite(ctx, uuid, body, true)
	if err != nil {
		return nil, err
	}
	if int64Value(doc["status"]) != 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_state", "Document is not deleted")
	}
	title := firstNonEmpty(stringValue(body["title"]), stringValue(body["newTitle"]), stringValue(body["new_title"]), stringValue(doc["title"]))
	ossPath := firstNonEmpty(stringValue(body["ossPath"]), stringValue(body["oss_path"]), stringValue(doc["oss_path"]))
	if _, err := a.db.ExecContext(ctx, `
      UPDATE documents
      SET status = 1, deleted_at = NULL, title = ?, oss_path = ?, updated_at = NOW()
      WHERE uuid = ?`, title, ossPath, uuid); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "title": title, "restored": true}, nil
}

func (a *Adapter) requireDocumentWrite(ctx context.Context, uuid string, body map[string]any, includeDeleted bool) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, includeDeleted)
	if err != nil {
		return nil, err
	}
	if boolValue(body["serverAuthorized"]) || boolValue(body["server_authorized"]) {
		return doc, nil
	}
	actorUID := actorFromBody(body)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "unauthorized", "Actor uid is required")
	}
	if int64Value(doc["status"]) == 2 || int64Value(doc["readonly_flag"]) == 1 {
		return nil, httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}
	if actorUID == stringValue(doc["owner_uid"]) {
		return doc, nil
	}
	permission, err := a.sharePermission(ctx, int64Value(doc["id"]), actorUID)
	if err != nil {
		return nil, err
	}
	if permission == "write" {
		return doc, nil
	}
	return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
}

func (a *Adapter) ensureDocumentTitleAvailable(ctx context.Context, uuid string, doc map[string]any, title string, folderValue any) error {
	if title == "" {
		return httperror.New(http.StatusBadRequest, "invalid_request", "Document title is required")
	}
	docType := stringValue(doc["doc_type"])
	where := []string{"title = ?", "owner_uid = ?", "uuid != ?", "status != 0"}
	args := []any{title, stringValue(doc["owner_uid"]), uuid}
	if docType == "project" || docType == "git-project" {
		where = append(where, `doc_type IN ("project", "git-project")`)
	} else {
		where = append(where, "doc_type = ?")
		args = append(args, docType)
	}
	if folderValue == nil || stringValue(folderValue) == "" || stringValue(folderValue) == "0" {
		where = append(where, "folder_id IS NULL")
	} else {
		where = append(where, "folder_id = ?")
		args = append(args, folderValue)
	}
	var count int
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents WHERE "+strings.Join(where, " AND "), args...).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return httperror.New(http.StatusConflict, "document_exists", "Document title already exists in target folder")
	}
	return nil
}

func (a *Adapter) documentAnnotations(ctx context.Context, uuid string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
      SELECT *
      FROM document_annotations
      WHERE document_uuid = ? AND status != 'deleted'
      ORDER BY status, created_at ASC`, uuid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	annotations, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(annotations) == 0 {
		return []map[string]any{}, nil
	}

	ids := make([]any, 0, len(annotations))
	placeholders := make([]string, 0, len(annotations))
	for _, annotation := range annotations {
		ids = append(ids, int64Value(annotation["id"]))
		placeholders = append(placeholders, "?")
	}
	replyRows, err := a.db.QueryContext(ctx, `
      SELECT *
      FROM annotation_replies
      WHERE annotation_id IN (`+strings.Join(placeholders, ",")+`) AND deleted_at IS NULL
      ORDER BY created_at ASC`, ids...)
	if err != nil {
		return nil, err
	}
	defer replyRows.Close()
	replies, err := rowsToMaps(replyRows)
	if err != nil {
		return nil, err
	}
	replyMap := map[int64][]map[string]any{}
	for _, reply := range replies {
		annotationID := int64Value(reply["annotation_id"])
		replyMap[annotationID] = append(replyMap[annotationID], reply)
	}
	for _, annotation := range annotations {
		replies := replyMap[int64Value(annotation["id"])]
		if replies == nil {
			replies = []map[string]any{}
		}
		annotation["replies"] = replies
	}
	return annotations, nil
}

func (a *Adapter) createDocumentAnnotation(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	selectedText := stringValue(body["selected_text"])
	content := stringValue(body["content"])
	authorID := stringValue(body["author_id"])
	if uuid == "" || selectedText == "" || content == "" || authorID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "document uuid, selected_text, content and author_id are required")
	}
	mentionedUsers, err := jsonBodyValue(body["mentioned_users"], []any{})
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
      INSERT INTO document_annotations
        (document_uuid, selected_text, context_before, context_after, position_hint,
         content, mentioned_users, author_id, author_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uuid,
		selectedText,
		stringValue(body["context_before"]),
		stringValue(body["context_after"]),
		int64Value(body["position_hint"]),
		content,
		mentionedUsers,
		authorID,
		firstNonEmpty(stringValue(body["author_name"]), "Unknown"),
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{"id": id}, nil
}

func (a *Adapter) updateDocumentAnnotation(ctx context.Context, annotationID string, body map[string]any) (map[string]any, error) {
	status := stringValue(body["status"])
	if annotationID == "" || status == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "annotation id and status are required")
	}
	fields := map[string]any{"status": status, "updated_at": sqlLiteral("NOW()")}
	if status == "resolved" {
		fields["resolved_at"] = sqlLiteral("NOW()")
		fields["resolved_by"] = firstNonEmpty(stringValue(body["resolved_by"]), "Unknown")
	} else if status == "deleted" {
		fields["deleted_at"] = sqlLiteral("NOW()")
		fields["deleted_by"] = firstNonEmpty(stringValue(body["deleted_by"]), "Unknown")
	} else {
		fields["resolved_at"] = nil
		fields["deleted_at"] = nil
	}
	return a.updateByID(ctx, "document_annotations", annotationID, fields)
}

func (a *Adapter) createAnnotationReply(ctx context.Context, annotationID string, body map[string]any) (map[string]any, error) {
	content := stringValue(body["content"])
	authorID := stringValue(body["author_id"])
	if annotationID == "" || content == "" || authorID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "annotation id, content and author_id are required")
	}
	mentionedUsers, err := jsonBodyValue(body["mentioned_users"], []any{})
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
      INSERT INTO annotation_replies
        (annotation_id, content, mentioned_users, author_id, author_name)
      VALUES (?, ?, ?, ?, ?)`,
		annotationID,
		content,
		mentionedUsers,
		authorID,
		firstNonEmpty(stringValue(body["author_name"]), "Unknown"),
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{"id": id}, nil
}

func (a *Adapter) deleteAnnotationReply(ctx context.Context, replyID string) (map[string]any, error) {
	if replyID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "reply id is required")
	}
	return a.updateByID(ctx, "annotation_replies", replyID, map[string]any{"deleted_at": sqlLiteral("NOW()")})
}

func (a *Adapter) updateByID(ctx context.Context, table string, id string, fields map[string]any) (map[string]any, error) {
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
	args = append(args, id)
	result, err := a.db.ExecContext(ctx, "UPDATE `"+table+"` SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Record not found")
	}
	return map[string]any{"updated": true}, nil
}

func (a *Adapter) cabinetList(ctx context.Context, query url.Values, department bool) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 5000)
	offset := (page - 1) * pageSize

	where := []string{"deleted_at IS NULL", "status = 1"}
	args := []any{}
	if department {
		deptCode := strings.TrimSpace(query.Get("dept_code"))
		if deptCode == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_request", "dept_code is required")
		}
		where = append(where, "dept_code = ?")
		args = append(args, deptCode)
	} else if ownerUID := strings.TrimSpace(query.Get("owner_uid")); ownerUID != "" {
		where = append(where, "owner_uid = ?")
		args = append(args, ownerUID)
	}

	folderID := strings.TrimSpace(query.Get("folder_id"))
	if folderID == "" || strings.EqualFold(folderID, "null") {
		where = append(where, "folder_id IS NULL")
	} else {
		where = append(where, "folder_id = ?")
		args = append(args, folderID)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cabinet_files WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT id, uuid, filename, original_name, file_ext, file_size, oss_path,
        owner_uid, dept_code, folder_id, converted_doc_uuid, created_at, updated_at
      FROM cabinet_files
      WHERE `+whereSQL+`
      ORDER BY created_at DESC
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

func (a *Adapter) issuesList(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 20)
	offset := (page - 1) * pageSize
	where := []string{"1=1"}
	args := []any{}
	for key, column := range map[string]string{
		"project_code": "project_code",
		"status":       "status",
		"issue_type":   "issue_type",
		"priority":     "priority",
		"assignee":     "assignee",
		"created_by":   "created_by",
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

func (a *Adapter) createIssue(ctx context.Context, body map[string]any) (map[string]any, error) {
	projectCode := stringValue(body["project_code"])
	title := stringValue(body["title"])
	createdBy := stringValue(body["created_by"])
	if projectCode == "" || title == "" || createdBy == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "project_code, title and created_by are required")
	}
	result, err := a.db.ExecContext(ctx, `
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
	return map[string]any{"id": id}, nil
}

func (a *Adapter) issueDetail(ctx context.Context, issueID string) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, "SELECT * FROM project_issues WHERE id = ? LIMIT 1", issueID)
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

func (a *Adapter) updateIssue(ctx context.Context, issueID string, body map[string]any) (map[string]any, error) {
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
	args = append(args, issueID)
	result, err := a.db.ExecContext(ctx, "UPDATE project_issues SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	return map[string]any{"updated": true}, nil
}

func (a *Adapter) deleteIssue(ctx context.Context, issueID string) (map[string]any, error) {
	if _, err := a.db.ExecContext(ctx, "DELETE FROM project_issues WHERE id = ?", issueID); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true}, nil
}

func (a *Adapter) issuePendingCount(ctx context.Context) (map[string]any, error) {
	var pending int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM project_issues WHERE status IN ('open', 'in_progress')").Scan(&pending); err != nil {
		return nil, err
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM project_issues").Scan(&total); err != nil {
		return nil, err
	}
	return map[string]any{"pending": pending, "total": total}, nil
}

func (a *Adapter) createIssueComment(ctx context.Context, issueID string, body map[string]any) (map[string]any, error) {
	author := stringValue(body["author"])
	content := stringValue(body["content"])
	if author == "" || content == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "author and content are required")
	}
	result, err := a.db.ExecContext(ctx, "INSERT INTO issue_comments (issue_id, author, content) VALUES (?, ?, ?)", issueID, author, content)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{"id": id}, nil
}

func (a *Adapter) infoList(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("pageSize"), query.Get("page_size"), query.Get("limit")), 20)
	if pageSize > 50 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	where := []string{"1=1"}
	args := []any{}
	category := strings.TrimSpace(query.Get("category"))
	if category == "article" || category == "news" {
		where = append(where, "i.category = ?")
		args = append(args, category)
	}
	whereSQL := strings.Join(where, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM info_items i WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT i.id, i.bookmark_id, i.title, i.category, i.summary, i.author,
        i.oss_path, COALESCE(b.post_time, i.published_at) AS published_at,
        i.cover_image, i.view_count, i.viewers, b.source_url
      FROM info_items i
      LEFT JOIN info_bookmarks b ON i.bookmark_id = b.id
      WHERE `+whereSQL+`
      ORDER BY COALESCE(b.post_time, i.published_at) DESC
      LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		item["view_count"] = infoViewCount(item["viewers"], item["view_count"])
		delete(item, "viewers")
	}

	var lastUpdated any
	_ = a.db.QueryRowContext(ctx, `
      SELECT MAX(COALESCE(b.post_time, i.published_at))
      FROM info_items i
      LEFT JOIN info_bookmarks b ON i.bookmark_id = b.id
      WHERE `+whereSQL, args...).Scan(&lastUpdated)

	return map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page":       page,
			"pageSize":   pageSize,
			"total":      total,
			"totalPages": int64((total + int64(pageSize) - 1) / int64(pageSize)),
		},
		"last_updated": normalizeSQLValue(lastUpdated),
	}, nil
}

func (a *Adapter) infoDetail(ctx context.Context, id string, query url.Values) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
      SELECT i.*, b.source_url
      FROM info_items i
      LEFT JOIN info_bookmarks b ON i.bookmark_id = b.id
      WHERE i.id = ?
      LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "info_not_found", "Info item not found")
	}

	item := items[0]
	viewers := infoViewers(item["viewers"])
	actorUID := strings.TrimSpace(firstNonEmpty(query.Get("actorUid"), query.Get("current_user")))
	actorName := strings.TrimSpace(firstNonEmpty(query.Get("actorName"), query.Get("current_user_name"), actorUID))
	if actorUID != "" && actorName != "" && !infoViewerExists(viewers, actorUID) {
		viewers = append(viewers, map[string]string{"uid": actorUID, "realName": actorName})
		viewersJSON, err := json.Marshal(viewers)
		if err != nil {
			return nil, err
		}
		if _, err := a.db.ExecContext(ctx, "UPDATE info_items SET viewers = ?, view_count = ? WHERE id = ?", string(viewersJSON), len(viewers), id); err != nil {
			return nil, err
		}
	}

	item["viewers"] = viewers
	item["view_count"] = len(viewers)
	return item, nil
}

func (a *Adapter) deleteInfoItem(ctx context.Context, id string) (map[string]any, error) {
	var itemID int64
	var bookmarkID sql.NullString
	var ossPath sql.NullString
	if err := a.db.QueryRowContext(ctx, "SELECT id, bookmark_id, oss_path FROM info_items WHERE id = ? LIMIT 1", id).Scan(&itemID, &bookmarkID, &ossPath); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "info_not_found", "Info item not found")
		}
		return nil, err
	}

	if _, err := a.db.ExecContext(ctx, "DELETE FROM info_items WHERE id = ?", id); err != nil {
		return nil, err
	}
	if bookmarkID.Valid && bookmarkID.String != "" {
		if _, err := a.db.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'pending' WHERE id = ?", bookmarkID.String); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"id":                 itemID,
		"restoredBookmarkId": nullableStringFromSQL(bookmarkID),
		"oss_path":           nullableStringFromSQL(ossPath),
		"deleted":            true,
	}, nil
}

func (a *Adapter) infoBookmarks(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("pageSize"), query.Get("page_size"), query.Get("limit")), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	where := []string{"1=1"}
	args := []any{}
	statuses := validInfoBookmarkStatuses(strings.Split(firstNonEmpty(query.Get("status"), "all"), ","))
	if len(statuses) > 0 {
		where = append(where, "status IN ("+placeholders(len(statuses))+")")
		for _, status := range statuses {
			args = append(args, status)
		}
	}
	whereSQL := strings.Join(where, " AND ")

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM info_bookmarks WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, "SELECT * FROM info_bookmarks WHERE "+whereSQL+" ORDER BY post_time DESC LIMIT ? OFFSET ?", append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items": items,
		"pagination": map[string]any{
			"page":       page,
			"pageSize":   pageSize,
			"total":      total,
			"totalPages": int64((total + int64(pageSize) - 1) / int64(pageSize)),
		},
	}, nil
}

func (a *Adapter) updateInfoBookmarks(ctx context.Context, body map[string]any) (map[string]any, error) {
	action := stringValue(body["action"])
	ids := stringListValue(body["ids"])
	if len(ids) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Bookmark ids are required")
	}

	switch action {
	case "ignore":
		args := make([]any, 0, len(ids))
		for _, id := range ids {
			args = append(args, id)
		}
		if _, err := a.db.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'ignored' WHERE id IN ("+placeholders(len(ids))+")", args...); err != nil {
			return nil, err
		}
		return map[string]any{"message": "已忽略选中的书签", "updated": len(ids)}, nil
	case "process":
		category := stringValue(body["category"])
		if category != "news" && category != "article" && category != "auto" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_category", "category must be news, article or auto")
		}
		args := make([]any, 0, len(ids))
		for _, id := range ids {
			args = append(args, id)
		}
		if _, err := a.db.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'processing' WHERE id IN ("+placeholders(len(ids))+")", args...); err != nil {
			return nil, err
		}
		return map[string]any{"message": "处理任务已在后台启动", "updated": len(ids), "category": category}, nil
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_action", "Unknown bookmark action")
	}
}

func (a *Adapter) importInfoBookmarks(ctx context.Context, body map[string]any) (map[string]any, error) {
	bookmarks := mapListValue(body["bookmarks"])
	if len(bookmarks) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "bookmarks are required")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	inserted := 0
	updated := 0
	skipped := 0
	for _, bookmark := range bookmarks {
		id := stringValue(bookmark["id"])
		if id == "" {
			skipped++
			continue
		}

		author := firstNonEmpty(stringValue(bookmark["author_handle"]), "unknown")
		content := stringValue(bookmark["content_snippet"])
		fullContent := firstNonEmpty(stringValue(bookmark["full_content"]), content)
		sourceURL := stringValue(bookmark["source_url"])
		articleTitle := stringValue(bookmark["article_title"])
		coverImage := stringValue(bookmark["cover_image"])
		hasExternalLink := boolValue(bookmark["has_external_link"])

		var existingAuthor sql.NullString
		err := tx.QueryRowContext(ctx, "SELECT author_handle FROM info_bookmarks WHERE id = ? LIMIT 1", id).Scan(&existingAuthor)
		if err == sql.ErrNoRows {
			if _, err := tx.ExecContext(ctx, `
          INSERT INTO info_bookmarks
            (id, author_handle, content_snippet, full_content, source_url, has_external_link, article_title, cover_image, status, post_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
				id, author, content, fullContent, sourceURL, normalizeBoolInt(hasExternalLink), articleTitle, coverImage, infoBookmarkPostTime(id)); err != nil {
				return nil, err
			}
			inserted++
			continue
		}
		if err != nil {
			return nil, err
		}

		if strings.EqualFold(existingAuthor.String, "unknown") && !strings.EqualFold(author, "unknown") {
			result, err := tx.ExecContext(ctx, `
          UPDATE info_bookmarks
          SET author_handle = ?, content_snippet = ?, full_content = ?, source_url = ?, has_external_link = ?, article_title = ?, cover_image = ?
          WHERE id = ?`,
				author, content, fullContent, sourceURL, normalizeBoolInt(hasExternalLink), articleTitle, coverImage, id)
			if err != nil {
				return nil, err
			}
			if count, _ := result.RowsAffected(); count > 0 {
				updated++
			}
			continue
		}

		if articleTitle != "" {
			result, err := tx.ExecContext(ctx, `
          UPDATE info_bookmarks
          SET article_title = ?, cover_image = ?
          WHERE id = ? AND (article_title IS NULL OR article_title = '')`,
				articleTitle, coverImage, id)
			if err != nil {
				return nil, err
			}
			if count, _ := result.RowsAffected(); count > 0 {
				updated++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return map[string]any{
		"inserted": inserted,
		"updated":  updated,
		"skipped":  skipped,
	}, nil
}

func (a *Adapter) processingInfoBookmarks(ctx context.Context, body map[string]any) (map[string]any, error) {
	ids := stringListValue(body["ids"])
	if len(ids) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Bookmark ids are required")
	}

	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := a.db.QueryContext(ctx, "SELECT * FROM info_bookmarks WHERE id IN ("+placeholders(len(ids))+") AND status = 'processing'", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) createInfoItemFromBookmark(ctx context.Context, body map[string]any) (map[string]any, error) {
	bookmarkID := stringValue(firstNonNil(body["bookmark_id"], body["bookmarkId"]))
	title := stringValue(body["title"])
	category := stringValue(body["category"])
	ossPath := stringValue(firstNonNil(body["oss_path"], body["ossPath"]))
	if bookmarkID == "" || title == "" || ossPath == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "bookmark_id, title and oss_path are required")
	}
	if category != "news" && category != "article" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_category", "category must be news or article")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.ExecContext(ctx, "UPDATE info_bookmarks SET status = 'processed' WHERE id = ?", bookmarkID); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
      INSERT INTO info_items
        (bookmark_id, title, category, summary, author, oss_path, cover_image)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
		bookmarkID,
		title,
		category,
		stringValue(body["summary"]),
		stringValue(body["author"]),
		ossPath,
		stringValue(firstNonNil(body["cover_image"], body["coverImage"])))
	if err != nil {
		return nil, err
	}
	itemID, _ := result.LastInsertId()

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true

	return map[string]any{
		"id":          itemID,
		"bookmark_id": bookmarkID,
		"oss_path":    ossPath,
		"created":     true,
	}, nil
}

func (a *Adapter) documentIDByUUID(ctx context.Context, uuid string) (int64, error) {
	var id int64
	if err := a.db.QueryRowContext(ctx, "SELECT id FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1", uuid).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return 0, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
		}
		return 0, err
	}
	return id, nil
}

func (a *Adapter) documentShares(ctx context.Context, uuid string) (map[string]any, error) {
	docID, err := a.documentIDByUUID(ctx, uuid)
	if err != nil {
		return nil, err
	}
	return queryPaged(ctx, a.db, "SELECT * FROM document_shares WHERE document_id = ? ORDER BY created_at DESC, id DESC", docID)
}

func (a *Adapter) documentVersions(ctx context.Context, uuid string) (map[string]any, error) {
	docID, err := a.documentIDByUUID(ctx, uuid)
	if err != nil {
		return nil, err
	}
	return queryPaged(ctx, a.db, "SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_num DESC, id DESC", docID)
}

func (a *Adapter) documentAccess(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	includeDeleted := query.Get("include_deleted") == "1" || query.Get("includeDeleted") == "true"
	doc, err := a.documentByUUID(ctx, uuid, includeDeleted)
	if err != nil {
		return nil, err
	}
	actorUID := actorFromQuery(query)
	ownerUID := stringValue(doc["owner_uid"])
	sharePermission := ""
	if actorUID != "" && actorUID != ownerUID {
		permission, shareErr := a.sharePermission(ctx, int64Value(doc["id"]), actorUID)
		if shareErr != nil {
			return nil, shareErr
		}
		sharePermission = permission
		if sharePermission == "" {
			canRead, relationErr := a.relationCanRead(ctx, int64Value(doc["id"]), actorUID)
			if relationErr != nil {
				return nil, relationErr
			}
			if !canRead {
				return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
			}
		}
	}

	status := int64Value(doc["status"])
	readonlyFlag := int64Value(doc["readonly_flag"])
	canWrite := status != 2 && readonlyFlag != 1 && (actorUID == "" || actorUID == ownerUID || sharePermission == "write")
	if actorUID != "" && actorUID != ownerUID && sharePermission == "" {
		canWrite = false
	}
	doc["sharePermission"] = nil
	if sharePermission != "" {
		doc["sharePermission"] = sharePermission
	}
	doc["readonly"] = !canWrite
	return doc, nil
}

func (a *Adapter) documentByUUID(ctx context.Context, uuid string, includeDeleted bool) (map[string]any, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document", "Document uuid is required")
	}
	where := "uuid = ?"
	if !includeDeleted {
		where += " AND status <> 0"
	}
	rows, err := a.db.QueryContext(ctx, "SELECT * FROM documents WHERE "+where+" LIMIT 1", uuid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
	}
	return items[0], nil
}

func (a *Adapter) sharePermission(ctx context.Context, docID int64, actorUID string) (string, error) {
	var permission string
	err := a.db.QueryRowContext(ctx, `
      SELECT permission
      FROM document_shares
      WHERE document_id = ? AND shared_to_uid = ?
      LIMIT 1`, docID, actorUID).Scan(&permission)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return permission, nil
}

func (a *Adapter) relationCanRead(ctx context.Context, docID int64, actorUID string) (bool, error) {
	exists, err := a.tableExists(ctx, "document_relations")
	if err != nil || !exists {
		return false, err
	}
	var count int
	if err := a.db.QueryRowContext(ctx, `
      SELECT COUNT(*)
      FROM document_relations
      WHERE document_id = ? AND related_uid = ? AND status = 1 AND can_read = 1
        AND (source_type <> 'project_preview_access' OR updated_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR))`,
		docID,
		actorUID,
	).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (a *Adapter) createDocumentShare(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	docID := int64Value(doc["id"])
	ownerUID := stringValue(doc["owner_uid"])
	actorUID := actorFromBody(body)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "unauthorized", "Actor uid is required")
	}
	if actorUID != ownerUID {
		return nil, httperror.New(http.StatusForbidden, "permission_denied", "Only document owner can manage shares")
	}
	if int64Value(doc["readonly_flag"]) == 1 {
		return nil, httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}
	targetUID := firstNonEmpty(stringValue(body["sharedToUid"]), stringValue(body["shared_to_uid"]), stringValue(body["uid"]))
	if targetUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Target uid is required")
	}
	permission := normalizePermission(firstNonEmpty(stringValue(body["permission"]), "read"))
	message := firstNonEmpty(stringValue(body["message"]), stringValue(body["remark"]))

	var shareID int64
	err = a.db.QueryRowContext(ctx, `
      SELECT id
      FROM document_shares
      WHERE document_id = ? AND shared_to_uid = ?
      LIMIT 1`, docID, targetUID).Scan(&shareID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if shareID > 0 {
		_, err = a.db.ExecContext(ctx, `
        UPDATE document_shares
        SET permission = ?, message = ?, updated_at = NOW()
        WHERE id = ? AND document_id = ?`, permission, nullableString(message), shareID, docID)
	} else {
		result, execErr := a.db.ExecContext(ctx, `
        INSERT INTO document_shares
          (document_id, owner_uid, shared_to_uid, permission, message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
			docID,
			ownerUID,
			targetUID,
			permission,
			nullableString(message),
		)
		err = execErr
		if err == nil {
			shareID, _ = result.LastInsertId()
		}
	}
	if err != nil {
		return nil, err
	}
	_ = a.syncShareRelation(ctx, docID, uuid, ownerUID, targetUID, shareID, permission)
	return map[string]any{"notifiedOnly": false, "shareId": shareID}, nil
}

func (a *Adapter) grantDocumentPreviewAccess(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}

	targetUID := firstNonEmpty(
		stringValue(body["actorUid"]),
		stringValue(body["actor_uid"]),
		stringValue(body["targetUid"]),
		stringValue(body["target_uid"]),
		stringValue(body["uid"]),
	)
	if targetUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "actorUid is required")
	}

	sourceApp := firstNonEmpty(stringValue(body["sourceApp"]), stringValue(body["source_app"]), "aims")
	sourceProjectCode := firstNonEmpty(
		stringValue(body["sourceProjectCode"]),
		stringValue(body["source_project_code"]),
		stringValue(doc["project_code"]),
	)
	if sourceProjectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "sourceProjectCode is required")
	}

	docID := int64Value(doc["id"])
	relationType := firstNonEmpty(stringValue(body["relationType"]), stringValue(body["relation_type"]), "aims_project_member")
	sourceID := fmt.Sprintf("%s:%s", sourceApp, sourceProjectCode)
	if err := a.upsertDocumentRelation(ctx, documentRelationInput{
		DocumentID:   docID,
		DocumentUUID: uuid,
		RelatedUID:   targetUID,
		RelationType: relationType,
		SourceType:   "project_preview_access",
		SourceID:     sourceID,
		CanRead:      true,
		CanEdit:      false,
		CanComment:   false,
		Metadata: map[string]any{
			"sourceApp":         sourceApp,
			"sourceProjectCode": sourceProjectCode,
			"documentUuid":      uuid,
			"readonly":          true,
		},
	}); err != nil {
		return nil, err
	}

	return map[string]any{
		"uuid":              uuid,
		"actorUid":          targetUID,
		"sourceApp":         sourceApp,
		"sourceProjectCode": sourceProjectCode,
		"relationType":      relationType,
		"readonly":          true,
		"granted":           true,
	}, nil
}

func (a *Adapter) updateDocumentShare(ctx context.Context, uuid string, shareID string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	docID := int64Value(doc["id"])
	ownerUID := stringValue(doc["owner_uid"])
	if err := requireOwnerActor(ownerUID, actorFromBody(body), int64Value(doc["readonly_flag"])); err != nil {
		return nil, err
	}
	permission := normalizePermission(firstNonEmpty(stringValue(body["permission"]), "read"))
	result, err := a.db.ExecContext(ctx, `
      UPDATE document_shares
      SET permission = ?, updated_at = NOW()
      WHERE id = ? AND document_id = ?`, permission, shareID, docID)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "share_not_found", "Share not found")
	}
	var sharedToUID string
	if err := a.db.QueryRowContext(ctx, "SELECT shared_to_uid FROM document_shares WHERE id = ? AND document_id = ? LIMIT 1", shareID, docID).Scan(&sharedToUID); err == nil {
		_ = a.syncShareRelation(ctx, docID, uuid, ownerUID, sharedToUID, int64Value(shareID), permission)
	}
	return map[string]any{"updated": true}, nil
}

func (a *Adapter) deleteDocumentShare(ctx context.Context, uuid string, shareID string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	docID := int64Value(doc["id"])
	if err := requireOwnerActor(stringValue(doc["owner_uid"]), actorFromBody(body), int64Value(doc["readonly_flag"])); err != nil {
		return nil, err
	}
	if _, err := a.db.ExecContext(ctx, "DELETE FROM document_shares WHERE id = ? AND document_id = ?", shareID, docID); err != nil {
		return nil, err
	}
	_ = a.deactivateRelationsBySource(ctx, "document_share", shareID)
	return map[string]any{"deleted": true}, nil
}

func (a *Adapter) markDocumentRead(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	uid := firstNonEmpty(stringValue(body["uid"]), actorFromBody(body))
	if uid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "uid is required")
	}
	docID, err := a.documentIDByUUID(ctx, uuid)
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
      UPDATE document_shares
      SET is_opened = 1, opened_at = IF(opened_at IS NULL, NOW(), opened_at)
      WHERE document_id = ? AND shared_to_uid = ? AND is_opened = 0`,
		docID,
		uid,
	)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	return map[string]any{"read": true, "firstRead": affected > 0}, nil
}

func (a *Adapter) deleteDocumentVersion(ctx context.Context, uuid string, versionID string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	actorUID := actorFromBody(body)
	ownerUID := stringValue(doc["owner_uid"])
	if actorUID != "" && actorUID != ownerUID {
		permission, shareErr := a.sharePermission(ctx, int64Value(doc["id"]), actorUID)
		if shareErr != nil {
			return nil, shareErr
		}
		if permission != "write" {
			return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
		}
	}
	if _, err := a.db.ExecContext(ctx, "DELETE FROM document_versions WHERE id = ? AND document_id = ?", versionID, int64Value(doc["id"])); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true}, nil
}

func (a *Adapter) myReviews(ctx context.Context, query url.Values) ([]map[string]any, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}

	kind := firstNonEmpty(query.Get("type"), "initiated")
	limit := positiveInt(firstNonEmpty(query.Get("limit"), "500"), 500)
	if limit > 1000 {
		limit = 1000
	}

	var rows *sql.Rows
	var err error
	switch kind {
	case "pending":
		rows, err = a.db.QueryContext(ctx, `
			SELECT r.*, d.title AS document_title
			FROM document_reviews r
			LEFT JOIN documents d ON r.document_id = d.id
			WHERE r.status = 'in_progress'
			  AND JSON_CONTAINS(
			    JSON_EXTRACT(r.flow_snapshot, CONCAT('$[', r.current_node, '].reviewers')),
			    JSON_QUOTE(?)
			  )
			ORDER BY r.created_at DESC
			LIMIT ?`, actorUID, limit)
	case "completed":
		rows, err = a.db.QueryContext(ctx, `
			SELECT DISTINCT r.*, d.title AS document_title
			FROM document_reviews r
			LEFT JOIN documents d ON r.document_id = d.id
			LEFT JOIN review_actions a ON r.id = a.review_id
			WHERE r.status IN ('approved', 'rejected', 'archived')
			  AND (r.initiator_uid = ? OR a.actor_uid = ?)
			ORDER BY r.updated_at DESC
			LIMIT ?`, actorUID, actorUID, limit)
	default:
		rows, err = a.db.QueryContext(ctx, `
			SELECT r.*, d.title AS document_title
			FROM document_reviews r
			LEFT JOIN documents d ON r.document_id = d.id
			WHERE r.initiator_uid = ?
			ORDER BY r.created_at DESC
			LIMIT ?`, actorUID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		normalizeReviewJSON(item)
	}
	return items, nil
}

func (a *Adapter) reviewDetail(ctx context.Context, id string) (map[string]any, error) {
	if strings.TrimSpace(id) == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_review", "Review id is required")
	}

	publishRequest, err := a.firstRow(ctx, `
		SELECT pr.*, d.title AS document_title, d.doc_type, d.oss_path, d.dept_code
		FROM document_publish_requests pr
		LEFT JOIN documents d ON pr.document_id = d.id
		WHERE pr.id = ?
		LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	if publishRequest != nil {
		normalizePublishRequestReview(publishRequest)
		return a.enrichReviewRecord(ctx, publishRequest)
	}

	review, err := a.firstRow(ctx, `
		SELECT r.*, d.title AS document_title, d.doc_type, d.oss_path
		FROM document_reviews r
		LEFT JOIN documents d ON r.document_id = d.id
		WHERE r.id = ?
		LIMIT 1`, id)
	if err != nil {
		return nil, err
	}
	if review == nil {
		return nil, httperror.New(http.StatusNotFound, "review_not_found", "Review not found")
	}
	return a.enrichReviewRecord(ctx, review)
}

func (a *Adapter) reviewByDocument(ctx context.Context, uuid string) (map[string]any, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document", "Document uuid is required")
	}

	publishRequest, err := a.firstRow(ctx, `
		SELECT pr.*, CASE WHEN pr.archive_oss_path IS NULL THEN pr.workflow_status ELSE 'archived' END AS status,
		       JSON_ARRAY() AS flow_snapshot, d.title AS document_title
		FROM document_publish_requests pr
		LEFT JOIN documents d ON pr.document_id = d.id
		WHERE pr.document_uuid = ?
		ORDER BY pr.created_at DESC
		LIMIT 1`, uuid)
	if err != nil {
		return nil, err
	}
	if publishRequest != nil {
		normalizePublishRequestReview(publishRequest)
		return a.enrichReviewRecord(ctx, publishRequest)
	}

	review, err := a.firstRow(ctx, `
		SELECT r.*, d.title AS document_title
		FROM document_reviews r
		LEFT JOIN documents d ON r.document_id = d.id
		WHERE r.document_uuid = ?
		ORDER BY r.created_at DESC
		LIMIT 1`, uuid)
	if err != nil || review == nil {
		return review, err
	}
	return a.enrichReviewRecord(ctx, review)
}

func (a *Adapter) reviewByOssPath(ctx context.Context, query url.Values) (map[string]any, error) {
	ossPath := strings.TrimSpace(query.Get("path"))
	if ossPath == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_path", "OSS path is required")
	}

	archiveDoc, err := a.firstRow(ctx, "SELECT id, uuid, title FROM documents WHERE oss_path = ? AND status = 2 LIMIT 1", ossPath)
	if err != nil || archiveDoc == nil {
		return archiveDoc, err
	}

	if review, err := a.reviewByArchivePath(ctx, ossPath); err != nil || review != nil {
		return review, err
	}
	if review, err := a.reviewByArchiveUUID(ctx, stringValue(archiveDoc["uuid"])); err != nil || review != nil {
		return review, err
	}
	return a.reviewByArchiveTitle(ctx, stringValue(archiveDoc["title"]), stringValue(archiveDoc["id"]))
}

func (a *Adapter) reviewByArchivePath(ctx context.Context, ossPath string) (map[string]any, error) {
	publishRequest, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, 'archived' AS status, r.execution_status, r.published_document_uuid,
		       JSON_ARRAY() AS flow_snapshot, r.created_at, r.updated_at, d.title AS source_title
		FROM document_publish_requests r
		LEFT JOIN documents d ON d.uuid = r.document_uuid
		WHERE r.archive_oss_path = ?
		ORDER BY r.updated_at DESC
		LIMIT 1`, ossPath)
	if err != nil || publishRequest != nil {
		if publishRequest != nil {
			normalizePublishRequestReview(publishRequest)
			return a.enrichReviewRecord(ctx, publishRequest)
		}
		return nil, err
	}

	review, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, r.status, r.execution_status, r.published_document_uuid,
		       r.flow_snapshot, r.created_at, r.updated_at, d.title AS source_title
		FROM document_reviews r
		LEFT JOIN documents d ON d.uuid = r.document_uuid
		WHERE r.archive_oss_path = ? AND r.status = 'archived'
		ORDER BY r.updated_at DESC
		LIMIT 1`, ossPath)
	if err != nil || review == nil {
		return review, err
	}
	return a.enrichReviewRecord(ctx, review)
}

func (a *Adapter) reviewByArchiveUUID(ctx context.Context, archiveUUID string) (map[string]any, error) {
	if archiveUUID == "" {
		return nil, nil
	}
	sourceDoc, err := a.firstRow(ctx, `
		SELECT uuid, title
		FROM documents
		WHERE publish_info LIKE ? AND status != 0
		ORDER BY updated_at DESC
		LIMIT 1`, "%"+archiveUUID+"%")
	if err != nil || sourceDoc == nil {
		return nil, err
	}

	review, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, r.status, r.execution_status, r.published_document_uuid,
		       r.flow_snapshot, r.created_at, r.updated_at
		FROM document_reviews r
		WHERE r.document_uuid = ? AND r.status = 'archived'
		ORDER BY r.updated_at DESC
		LIMIT 1`, sourceDoc["uuid"])
	if err != nil || review == nil {
		return review, err
	}
	review["source_title"] = sourceDoc["title"]
	return a.enrichReviewRecord(ctx, review)
}

func (a *Adapter) reviewByArchiveTitle(ctx context.Context, title string, archiveDocID string) (map[string]any, error) {
	if title == "" {
		return nil, nil
	}
	review, err := a.firstRow(ctx, `
		SELECT r.id, r.document_uuid, r.review_type, r.sub_type, r.initiator_uid, r.extra,
		       r.target_category, r.status, r.execution_status, r.published_document_uuid,
		       r.flow_snapshot, r.created_at, r.updated_at, d.title AS source_title
		FROM document_reviews r
		LEFT JOIN documents d ON d.uuid = r.document_uuid
		WHERE d.title = ? AND r.status = 'archived' AND d.id != ?
		ORDER BY r.updated_at DESC
		LIMIT 1`, title, archiveDocID)
	if err != nil || review == nil {
		return review, err
	}
	return a.enrichReviewRecord(ctx, review)
}

func (a *Adapter) collabDocs(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}

	category := firstNonEmpty(query.Get("category"), "shared")
	scope := firstNonEmpty(query.Get("scope"), "all")
	keyword := strings.ToLower(strings.TrimSpace(query.Get("keyword")))
	deptCode := strings.TrimSpace(query.Get("dept_code"))
	ownerUID := strings.TrimSpace(query.Get("owner_uid"))

	where := "WHERE dr.related_uid = ? AND dr.status = 1 AND d.status != 0"
	args := []any{actorUID}
	if category == "shared" {
		where += " AND dr.relation_type LIKE ?"
		args = append(args, "shared_%")
	} else if category == "outside" {
		where += " AND dr.relation_type LIKE ?"
		args = append(args, "outside_%")
	} else if category == "original" {
		where += " AND dr.relation_type IN (?, ?)"
		args = append(args, "created_by_me", "transferred_by_me")
	}
	if keyword != "" {
		where += " AND LOWER(d.title) LIKE ?"
		args = append(args, "%"+keyword+"%")
	}
	if deptCode != "" {
		where += " AND d.dept_code = ?"
		args = append(args, deptCode)
	}
	if ownerUID != "" {
		where += " AND d.owner_uid = ?"
		args = append(args, ownerUID)
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT d.id AS document_id, d.uuid AS document_uuid, d.title, d.doc_type,
		       d.oss_path, d.owner_uid, d.dept_code, d.readonly_flag, d.status,
		       d.publish_info, d.updated_at, dr.relation_type, dr.source_type,
		       dr.source_id, dr.can_edit, dr.metadata AS relation_metadata,
		       r.id AS review_id, r.status AS review_status, r.review_type,
		       r.sub_type AS review_sub_type, r.execution_status AS review_execution_status,
		       r.current_node AS review_current_node, r.flow_snapshot
		FROM document_relations dr
		INNER JOIN documents d ON d.id = dr.document_id
		LEFT JOIN document_reviews r
		  ON dr.source_type = 'review' AND r.id = CAST(dr.source_id AS UNSIGNED)
		`+where+`
		ORDER BY d.updated_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rowsData, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}

	grouped := map[string]map[string]any{}
	order := []string{}
	for _, row := range rowsData {
		uuid := stringValue(row["document_uuid"])
		if uuid == "" {
			continue
		}
		relationType := stringValue(row["relation_type"])
		flowSnapshot := jsonArrayValue(row["flow_snapshot"])
		documentReadonly := int64Value(row["status"]) == 2 || int64Value(row["readonly_flag"]) == 1
		relationCanWrite := stringValue(row["owner_uid"]) == actorUID || int64Value(row["can_edit"]) == 1
		effectiveReadonly := documentReadonly || !relationCanWrite
		isTodo := stringValue(row["review_status"]) == "in_progress" && currentReviewNodeIncludes(flowSnapshot, row["review_current_node"], actorUID)

		item, ok := grouped[uuid]
		if !ok {
			item = map[string]any{
				"uuid":                  uuid,
				"title":                 row["title"],
				"docType":               row["doc_type"],
				"ownerUid":              row["owner_uid"],
				"deptCode":              nullableMapValue(row["dept_code"]),
				"readonly":              effectiveReadonly,
				"docStatus":             int64Value(row["status"]),
				"published":             int64Value(row["status"]) == 2 || stringValue(row["publish_info"]) != "",
				"ossPath":               row["oss_path"],
				"updatedAt":             row["updated_at"],
				"relationTypes":         []string{relationType},
				"relationLabels":        []string{relationLabel(relationType)},
				"reviewId":              nullableMapValue(row["review_id"]),
				"reviewStatus":          nullableMapValue(row["review_status"]),
				"reviewType":            nullableMapValue(row["review_type"]),
				"reviewSubType":         nullableMapValue(row["review_sub_type"]),
				"reviewExecutionStatus": nullableMapValue(row["review_execution_status"]),
				"isTodo":                isTodo,
				"locationLabel":         locationLabel(stringValue(row["oss_path"]), stringValue(row["doc_type"])),
			}
			grouped[uuid] = item
			order = append(order, uuid)
			continue
		}

		item["readonly"] = boolValue(item["readonly"]) && effectiveReadonly
		item["isTodo"] = boolValue(item["isTodo"]) || isTodo
		relationTypes := stringListValue(item["relationTypes"])
		if !stringInList(relationTypes, relationType) {
			relationTypes = append(relationTypes, relationType)
			item["relationTypes"] = relationTypes
			labels := stringListValue(item["relationLabels"])
			item["relationLabels"] = append(labels, relationLabel(relationType))
		}
	}

	items := make([]map[string]any, 0, len(order))
	for _, uuid := range order {
		item := grouped[uuid]
		if includeCollabDocScope(item, scope) {
			items = append(items, item)
		}
	}

	return map[string]any{"items": items, "total": len(items)}, nil
}

func (a *Adapter) firstRow(ctx context.Context, sqlText string, args ...any) (map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func (a *Adapter) enrichReviewRecord(ctx context.Context, row map[string]any) (map[string]any, error) {
	normalizeReviewJSON(row)
	id := stringValue(row["id"])
	if id == "" {
		row["actions"] = []map[string]any{}
		row["seal_records"] = []map[string]any{}
		row["send_records"] = []map[string]any{}
		return row, nil
	}

	if stringValue(row["workflow_instance_id"]) != "" {
		row["actions"] = []map[string]any{}
	} else {
		actions, err := a.reviewActions(ctx, id)
		if err != nil {
			return nil, err
		}
		row["actions"] = actions
	}

	sealRecords, err := a.reviewSealRecords(ctx, id)
	if err != nil {
		return nil, err
	}
	sendRecords, err := a.reviewSendRecords(ctx, id)
	if err != nil {
		return nil, err
	}
	row["seal_records"] = sealRecords
	row["send_records"] = sendRecords
	return row, nil
}

func (a *Adapter) reviewActions(ctx context.Context, reviewID string) ([]map[string]any, error) {
	exists, err := a.tableExists(ctx, "review_actions")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT *
		FROM review_actions
		WHERE review_id = ?
		ORDER BY created_at ASC, id ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func (a *Adapter) reviewSealRecords(ctx context.Context, reviewID string) ([]map[string]any, error) {
	exists, err := a.tableExists(ctx, "document_seal_records")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, review_id, document_uuid, seal_types, page_count, operator_uid,
		       remark, confirmed_at, created_at, updated_at
		FROM document_seal_records
		WHERE review_id = ?
		ORDER BY confirmed_at ASC, id ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		item["seal_types"] = stringListJSONValue(item["seal_types"])
	}
	return items, nil
}

func (a *Adapter) reviewSendRecords(ctx context.Context, reviewID string) ([]map[string]any, error) {
	exists, err := a.tableExists(ctx, "document_send_records")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, review_id, document_uuid, sender_uid, receiver_name, receiver_phone,
		       channel, sent_date, receive_date, target_account, remark, confirmed_at,
		       received_confirmed_at, created_at, updated_at
		FROM document_send_records
		WHERE review_id = ?
		ORDER BY confirmed_at ASC, id ASC`, reviewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func normalizePublishRequestReview(row map[string]any) {
	if stringValue(row["status"]) == "" {
		if stringValue(row["archive_oss_path"]) != "" {
			row["status"] = "archived"
		} else {
			row["status"] = stringValue(row["workflow_status"])
		}
	}
	row["current_node"] = int64Value(row["current_node"])
	if row["flow_snapshot"] == nil {
		row["flow_snapshot"] = []any{}
	}
}

func normalizeReviewJSON(row map[string]any) {
	row["flow_snapshot"] = jsonArrayValue(row["flow_snapshot"])
	row["extra"] = jsonObjectValue(row["extra"])
}

func jsonArrayValue(value any) []any {
	if value == nil {
		return []any{}
	}
	if items, ok := value.([]any); ok {
		return items
	}
	text := strings.TrimSpace(stringValue(value))
	if text == "" || text == "null" {
		return []any{}
	}
	var items []any
	if err := json.Unmarshal([]byte(text), &items); err != nil {
		return []any{}
	}
	return items
}

func jsonObjectValue(value any) any {
	if value == nil {
		return nil
	}
	if _, ok := value.(map[string]any); ok {
		return value
	}
	text := strings.TrimSpace(stringValue(value))
	if text == "" || text == "null" {
		return nil
	}
	var item map[string]any
	if err := json.Unmarshal([]byte(text), &item); err != nil {
		return nil
	}
	return item
}

func stringListJSONValue(value any) []string {
	if value == nil {
		return []string{}
	}
	if items, ok := value.([]string); ok {
		return items
	}
	var raw []any
	if err := json.Unmarshal([]byte(stringValue(value)), &raw); err != nil {
		return []string{}
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text := stringValue(item); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func nullableMapValue(value any) any {
	if stringValue(value) == "" || stringValue(value) == "0" {
		return nil
	}
	return value
}

func relationLabel(relationType string) string {
	labels := map[string]string{
		"shared_to_me":         "共享给我",
		"shared_by_me":         "我共享的",
		"created_by_me":        "我创建的",
		"transferred_by_me":    "我移交的",
		"outside_initiator":    "我发起的",
		"outside_reviewer":     "我参与审核",
		"outside_supervisor":   "我参与监督",
		"outside_seal_handler": "我参与盖章",
		"outside_sender":       "我负责发送",
	}
	if label, ok := labels[relationType]; ok {
		return label
	}
	return relationType
}

func locationLabel(ossPath string, docType string) string {
	if strings.Contains(ossPath, "/outsides/") {
		return "部门文档 / 对外发文"
	}
	if strings.Contains(ossPath, "/rules/") {
		return "部门文档 / 部门规章"
	}
	if strings.Contains(ossPath, "/records/") {
		return "部门文档 / 会议记录"
	}
	if strings.HasPrefix(ossPath, "codocs/company/") {
		return "组织资产"
	}
	if docType == "department" {
		return "部门文档"
	}
	if docType == "project" || docType == "git-project" {
		return "项目文档"
	}
	return "个人文档"
}

func currentReviewNodeIncludes(flowSnapshot []any, currentNode any, actorUID string) bool {
	index := int64Value(currentNode)
	if index < 0 || int(index) >= len(flowSnapshot) {
		return false
	}
	node, ok := flowSnapshot[index].(map[string]any)
	if !ok {
		return false
	}
	return stringInList(stringListValue(node["reviewers"]), actorUID)
}

func stringInList(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func includeCollabDocScope(item map[string]any, scope string) bool {
	if scope == "all" {
		return true
	}
	relationTypes := stringListValue(item["relationTypes"])
	reviewStatus := stringValue(item["reviewStatus"])
	if scope == "todo" {
		return boolValue(item["isTodo"])
	}
	if scope == "done" {
		return reviewStatus == "approved" || reviewStatus == "archived" || reviewStatus == "rejected"
	}
	initiated := stringInList(relationTypes, "shared_by_me") ||
		stringInList(relationTypes, "outside_initiator") ||
		stringInList(relationTypes, "created_by_me") ||
		stringInList(relationTypes, "transferred_by_me")
	if scope == "initiated" {
		return initiated
	}
	if scope == "participated" {
		return !initiated
	}
	return true
}

func queryPaged(ctx context.Context, db *sql.DB, sqlText string, args ...any) (map[string]any, error) {
	rows, err := db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    len(items),
		"page":     1,
		"pageSize": len(items),
	}, nil
}

func rowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		item := map[string]any{}
		for i, column := range columns {
			item[column] = normalizeSQLValue(values[i])
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func normalizeSQLValue(value any) any {
	if bytes, ok := value.([]byte); ok {
		return string(bytes)
	}
	return value
}

func nullableStringFromSQL(value sql.NullString) any {
	if !value.Valid || value.String == "" {
		return nil
	}
	return value.String
}

func sqlNullInt64Value(value sql.NullInt64) int64 {
	if !value.Valid {
		return 0
	}
	return value.Int64
}

func ratioValue(numerator int64, denominator int64) float64 {
	if denominator <= 0 {
		return 0
	}
	return float64(numerator) / float64(denominator)
}

func infoViewCount(viewers any, fallback any) int {
	parsed := infoViewers(viewers)
	if len(parsed) > 0 {
		return len(parsed)
	}
	return int(int64Value(fallback))
}

func infoViewers(raw any) []map[string]string {
	text := strings.TrimSpace(stringValue(raw))
	if text == "" || text == "null" {
		return []map[string]string{}
	}
	var entries []map[string]string
	if err := json.Unmarshal([]byte(text), &entries); err == nil && entries != nil {
		return entries
	}
	var loose []map[string]any
	if err := json.Unmarshal([]byte(text), &loose); err != nil {
		return []map[string]string{}
	}
	result := make([]map[string]string, 0, len(loose))
	for _, item := range loose {
		uid := stringValue(item["uid"])
		name := stringValue(item["realName"])
		if uid == "" {
			continue
		}
		result = append(result, map[string]string{"uid": uid, "realName": firstNonEmpty(name, uid)})
	}
	return result
}

func infoViewerExists(viewers []map[string]string, uid string) bool {
	for _, viewer := range viewers {
		if viewer["uid"] == uid {
			return true
		}
	}
	return false
}

func validInfoBookmarkStatuses(raw []string) []string {
	allowed := map[string]bool{"pending": true, "processed": true, "ignored": true, "processing": true}
	result := []string{}
	seen := map[string]bool{}
	for _, item := range raw {
		value := strings.TrimSpace(item)
		if value == "" || value == "all" || !allowed[value] || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func stringListValue(value any) []string {
	switch list := value.(type) {
	case []any:
		result := make([]string, 0, len(list))
		for _, item := range list {
			text := stringValue(item)
			if text != "" {
				result = append(result, text)
			}
		}
		return result
	case []string:
		result := make([]string, 0, len(list))
		for _, item := range list {
			if text := strings.TrimSpace(item); text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		text := stringValue(value)
		if text == "" {
			return nil
		}
		return []string{text}
	}
}

func mapListValue(value any) []map[string]any {
	switch list := value.(type) {
	case []map[string]any:
		return list
	case []any:
		result := make([]map[string]any, 0, len(list))
		for _, item := range list {
			if mapped, ok := item.(map[string]any); ok {
				result = append(result, mapped)
			}
		}
		return result
	default:
		return nil
	}
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func infoBookmarkPostTime(id string) any {
	tweetID, err := strconv.ParseInt(strings.TrimSpace(id), 10, 64)
	if err != nil || tweetID <= 0 {
		return nil
	}
	tsMs := (tweetID >> 22) + 1288834974657
	return time.UnixMilli(tsMs).UTC()
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func pathMiddle(value string, prefix string, suffix string) string {
	return strings.TrimSuffix(strings.TrimPrefix(value, prefix), suffix)
}

func queryWithUUID(query url.Values, uuid string) url.Values {
	values := url.Values{}
	for key, list := range query {
		values[key] = append([]string(nil), list...)
	}
	values.Set("uuid", uuid)
	return values
}

func documentNestedID(suffix string, collection string) (string, string) {
	parts := pathSegments(suffix)
	if len(parts) < 4 || parts[0] != "documents" || parts[2] != collection {
		return "", ""
	}
	return parts[1], parts[3]
}

func pathSegments(value string) []string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func int64Value(value any) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case string:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return parsed
	default:
		return 0
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func positiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}

func nullableInt64(value int64) any {
	if value == 0 {
		return nil
	}
	return value
}

func normalizePermission(value string) string {
	if strings.TrimSpace(value) == "write" {
		return "write"
	}
	return "read"
}

func normalizeNullableString(value any) any {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "null" {
		return nil
	}
	return text
}

func normalizeNullableNumber(value any) any {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "null" || text == "0" {
		return nil
	}
	return int64Value(value)
}

func normalizeBoolInt(value any) any {
	if boolValue(value) {
		return 1
	}
	return 0
}

func normalizeInt64(value any) any {
	return int64Value(value)
}

func boolValue(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	case string:
		normalized := strings.ToLower(strings.TrimSpace(v))
		return normalized == "true" || normalized == "1" || normalized == "yes"
	default:
		return false
	}
}

func actorFromQuery(query url.Values) string {
	return firstNonEmpty(query.Get("actorUid"), query.Get("actor_uid"), query.Get("current_user"), query.Get("operator_uid"))
}

func actorFromBody(body map[string]any) string {
	return firstNonEmpty(
		stringValue(body["actorUid"]),
		stringValue(body["actor_uid"]),
		stringValue(body["current_user"]),
		stringValue(body["operator_uid"]),
	)
}

func requireOwnerActor(ownerUID string, actorUID string, readonlyFlag int64) error {
	if actorUID == "" {
		return httperror.New(http.StatusUnauthorized, "unauthorized", "Actor uid is required")
	}
	if actorUID != ownerUID {
		return httperror.New(http.StatusForbidden, "permission_denied", "Only document owner can manage shares")
	}
	if readonlyFlag == 1 {
		return httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}
	return nil
}

func stringSlice(value any) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []any:
		result := make([]string, 0, len(v))
		for _, item := range v {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func randomUUID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:]), nil
}

func sanitizePathName(value string) string {
	replacer := strings.NewReplacer("\\", "_", "/", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	sanitized := replacer.Replace(strings.TrimSpace(value))
	sanitized = strings.Join(strings.Fields(sanitized), "_")
	if len(sanitized) > 100 {
		sanitized = sanitized[:100]
	}
	if sanitized == "" {
		return "untitled"
	}
	return sanitized
}

func documentPath(docType string, ownerUID string, projectCode string, deptCode string, title string, folderPath string) string {
	basePath := map[string]string{
		"private":    "users",
		"slide":      "users",
		"department": "departments",
		"project":    "projects",
		"sale":       "sale",
		"company":    "publish/company",
		"knowledge":  "publish/knowledge",
		"product":    "publish/products",
	}[docType]
	if basePath == "" {
		basePath = "docs"
	}
	filename := sanitizePathName(title) + ".md"
	folderPart := ""
	if strings.TrimSpace(folderPath) != "" {
		folderPart = "/" + strings.Trim(strings.TrimSpace(folderPath), "/")
	}
	switch docType {
	case "private":
		return "codocs/" + basePath + "/" + ownerUID + "/docs" + folderPart + "/" + filename
	case "slide":
		return "codocs/" + basePath + "/" + ownerUID + "/slides" + folderPart + "/" + filename
	case "department":
		return "codocs/" + basePath + "/" + deptCode + "/docs" + folderPart + "/" + filename
	case "project", "sale":
		return "codocs/" + basePath + "/" + projectCode + "/docs" + folderPart + "/" + filename
	default:
		return "codocs/" + basePath + folderPart + "/" + filename
	}
}

func (a *Adapter) folderPath(ctx context.Context, folderID int64) (string, error) {
	var name string
	var parentID sql.NullInt64
	err := a.db.QueryRowContext(ctx, "SELECT name, parent_id FROM folders WHERE id = ? LIMIT 1", folderID).Scan(&name, &parentID)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	current := sanitizePathName(name)
	if parentID.Valid && parentID.Int64 > 0 {
		parentPath, err := a.folderPath(ctx, parentID.Int64)
		if err != nil {
			return "", err
		}
		if parentPath != "" {
			return parentPath + "/" + current, nil
		}
	}
	return current, nil
}

func (a *Adapter) tableExists(ctx context.Context, table string) (bool, error) {
	var found string
	err := a.db.QueryRowContext(ctx, `
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      LIMIT 1`, table).Scan(&found)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return found != "", nil
}

type documentRelationInput struct {
	DocumentID   int64
	DocumentUUID string
	RelatedUID   string
	RelationType string
	SourceType   string
	SourceID     string
	CanRead      bool
	CanEdit      bool
	CanComment   bool
	Metadata     map[string]any
}

func (a *Adapter) upsertDocumentRelation(ctx context.Context, input documentRelationInput) error {
	exists, err := a.tableExists(ctx, "document_relations")
	if err != nil || !exists {
		return err
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return err
	}
	_, err = a.db.ExecContext(ctx, `
      INSERT INTO document_relations
        (document_id, document_uuid, related_uid, relation_type, source_type, source_id,
         can_read, can_edit, can_comment, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON DUPLICATE KEY UPDATE
        document_uuid = VALUES(document_uuid),
        can_read = VALUES(can_read),
        can_edit = VALUES(can_edit),
        can_comment = VALUES(can_comment),
        status = 1,
        metadata = VALUES(metadata),
        updated_at = NOW()`,
		input.DocumentID,
		input.DocumentUUID,
		input.RelatedUID,
		input.RelationType,
		input.SourceType,
		nullableString(input.SourceID),
		boolInt(input.CanRead),
		boolInt(input.CanEdit),
		boolInt(input.CanComment),
		string(metadata),
	)
	return err
}

func (a *Adapter) syncShareRelation(ctx context.Context, docID int64, uuid string, ownerUID string, sharedToUID string, shareID int64, permission string) error {
	return a.upsertDocumentRelation(ctx, documentRelationInput{
		DocumentID:   docID,
		DocumentUUID: uuid,
		RelatedUID:   sharedToUID,
		RelationType: "shared_with_me",
		SourceType:   "document_share",
		SourceID:     strconv.FormatInt(shareID, 10),
		CanRead:      true,
		CanEdit:      permission == "write",
		Metadata: map[string]any{
			"ownerUid":     ownerUID,
			"permission":   permission,
			"documentUuid": uuid,
		},
	})
}

func (a *Adapter) deactivateRelationsBySource(ctx context.Context, sourceType string, sourceID string) error {
	exists, err := a.tableExists(ctx, "document_relations")
	if err != nil || !exists {
		return err
	}
	_, err = a.db.ExecContext(ctx, "UPDATE document_relations SET status = 0, updated_at = NOW() WHERE source_type = ? AND source_id = ?", sourceType, sourceID)
	return err
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

type sqlLiteral string

func normalizeBodyNullable(value any) any {
	if value == nil {
		return nil
	}
	if text, ok := value.(string); ok {
		trimmed := strings.TrimSpace(text)
		if trimmed == "" || strings.EqualFold(trimmed, "null") {
			return nil
		}
		return trimmed
	}
	return value
}

func jsonBodyValue(value any, fallback any) (string, error) {
	if value == nil {
		value = fallback
	}
	if text, ok := value.(string); ok {
		if strings.TrimSpace(text) == "" {
			value = fallback
		} else {
			return text, nil
		}
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

type documentAccessPolicy struct {
	ID                int64
	DocumentRefType   string
	DocumentUUID      string
	SourceApp         string
	SourceProjectCode string
	LifecycleStage    string
	Confidentiality   string
	DefaultPermission string
	AllowInternal     bool
	AllowCrossProject bool
	Readonly          bool
	CreatedBy         string
	UpdatedBy         string
	CreatedAt         string
	UpdatedAt         string
}

type documentAccessGrant struct {
	ID          int64  `json:"id"`
	PolicyID    int64  `json:"policyId"`
	SubjectType string `json:"subjectType"`
	SubjectCode string `json:"subjectCode"`
	Permission  string `json:"permission"`
	ExpiresAt   any    `json:"expiresAt"`
	CreatedBy   string `json:"createdBy"`
	CreatedAt   string `json:"createdAt"`
}

type documentAccessCheckResult struct {
	Allowed              bool   `json:"allowed"`
	Permission           string `json:"permission"`
	Readonly             bool   `json:"readonly"`
	Reason               string `json:"reason"`
	LifecycleStage       string `json:"lifecycleStage"`
	ConfidentialityLevel string `json:"confidentialityLevel"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F-]{8,64}$`)

func isValidDocumentUUID(value string) bool {
	text := strings.TrimSpace(value)
	if text == "" {
		return false
	}
	return uuidPattern.MatchString(text)
}

func (a *Adapter) ensureDocumentAccessTables(ctx context.Context) error {
	policyExists, err := a.tableExists(ctx, "document_access_policies")
	if err != nil {
		return err
	}
	grantExists, err := a.tableExists(ctx, "document_access_grants")
	if err != nil {
		return err
	}
	auditExists, err := a.tableExists(ctx, "document_access_audit_logs")
	if err != nil {
		return err
	}
	if !policyExists || !grantExists || !auditExists {
		return httperror.New(http.StatusServiceUnavailable, "document_access_tables_missing", "Document access tables are not ready")
	}
	return nil
}

func firstTextValue(source map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := source[key]; ok {
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func parseStringSlice(value any) []string {
	if value == nil {
		return nil
	}
	if values, ok := value.([]string); ok {
		return values
	}
	if values, ok := value.([]any); ok {
		result := make([]string, 0, len(values))
		for _, item := range values {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" && text != "<nil>" {
				result = append(result, text)
			}
		}
		return result
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	parts := strings.Split(text, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func parseBoolValue(source map[string]any, key string, fallback bool) bool {
	value, ok := source[key]
	if !ok || value == nil {
		return fallback
	}
	text := strings.TrimSpace(strings.ToLower(fmt.Sprint(value)))
	if text == "" || text == "<nil>" {
		return fallback
	}
	return text == "1" || text == "true" || text == "yes"
}

func permissionRank(permission string) int {
	switch permission {
	case "edit":
		return 3
	case "download":
		return 2
	case "view":
		return 1
	default:
		return 0
	}
}

func policyReadonly(policy documentAccessPolicy) bool {
	return policy.Readonly || policy.LifecycleStage == "archived"
}

func (a *Adapter) ensurePolicyDefault(ctx context.Context, documentRefType string, documentUUID string, sourceApp string, sourceProjectCode string, actorUID string) (documentAccessPolicy, error) {
	var policy documentAccessPolicy
	err := a.db.QueryRowContext(ctx, `
		SELECT id, document_ref_type, document_uuid, source_app, source_project_code,
		       lifecycle_stage, confidentiality_level, default_permission,
		       allow_internal_access, allow_cross_project, readonly,
		       created_by, updated_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		       DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM document_access_policies
		WHERE document_ref_type = ? AND document_uuid = ?
		LIMIT 1
	`, documentRefType, documentUUID).Scan(
		&policy.ID,
		&policy.DocumentRefType,
		&policy.DocumentUUID,
		&policy.SourceApp,
		&policy.SourceProjectCode,
		&policy.LifecycleStage,
		&policy.Confidentiality,
		&policy.DefaultPermission,
		&policy.AllowInternal,
		&policy.AllowCrossProject,
		&policy.Readonly,
		&policy.CreatedBy,
		&policy.UpdatedBy,
		&policy.CreatedAt,
		&policy.UpdatedAt,
	)
	if err == nil {
		return policy, nil
	}
	if err != sql.ErrNoRows {
		return policy, err
	}

	creator := strings.TrimSpace(actorUID)
	if creator == "" {
		creator = "system"
	}

	result, err := a.db.ExecContext(ctx, `
		INSERT INTO document_access_policies
		(document_ref_type, document_uuid, source_app, source_project_code,
		 lifecycle_stage, confidentiality_level, default_permission,
		 allow_internal_access, allow_cross_project, readonly,
		 created_by, updated_by)
		VALUES (?, ?, ?, ?, 'draft', 'L2', 'none', 0, 0, 0, ?, ?)
	`, documentRefType, documentUUID, sourceApp, sourceProjectCode, creator, creator)
	if err != nil {
		return policy, err
	}
	insertID, _ := result.LastInsertId()
	policy = documentAccessPolicy{
		ID:                insertID,
		DocumentRefType:   documentRefType,
		DocumentUUID:      documentUUID,
		SourceApp:         sourceApp,
		SourceProjectCode: sourceProjectCode,
		LifecycleStage:    "draft",
		Confidentiality:   "L2",
		DefaultPermission: "none",
		AllowInternal:     false,
		AllowCrossProject: false,
		Readonly:          false,
		CreatedBy:         creator,
		UpdatedBy:         creator,
	}
	return policy, nil
}

func (a *Adapter) loadPolicyGrants(ctx context.Context, policyID int64) ([]documentAccessGrant, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, policy_id, subject_type, subject_code, permission,
		       expires_at, created_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM document_access_grants
		WHERE policy_id = ?
		ORDER BY id ASC
	`, policyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	grants := make([]documentAccessGrant, 0)
	for rows.Next() {
		var grant documentAccessGrant
		if err := rows.Scan(&grant.ID, &grant.PolicyID, &grant.SubjectType, &grant.SubjectCode, &grant.Permission, &grant.ExpiresAt, &grant.CreatedBy, &grant.CreatedAt); err != nil {
			return nil, err
		}
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return grants, nil
}

func (a *Adapter) recordDocumentAccessAudit(ctx context.Context, policy documentAccessPolicy, actorUID string, action string, result documentAccessCheckResult, actorProjectCodes []string, actorDeptCodes []string, actorRoles []string) {
	actorSnapshot := map[string]any{
		"projects": actorProjectCodes,
		"depts":    actorDeptCodes,
		"roles":    actorRoles,
	}
	jsonBytes, err := json.Marshal(actorSnapshot)
	if err != nil {
		jsonBytes = []byte("[]")
	}
	decision := "deny"
	if result.Allowed {
		decision = "allow"
	}
	_, _ = a.db.ExecContext(ctx, `
		INSERT INTO document_access_audit_logs
		(document_ref_type, document_uuid, actor_uid, action, decision, reason, source_project_code, actor_project_codes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, policy.DocumentRefType, policy.DocumentUUID, nullableString(actorUID), action, decision, result.Reason, nullableString(policy.SourceProjectCode), string(jsonBytes))
}

func (a *Adapter) documentAccessCheck(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}

	documentUUID := firstTextValue(body, "documentUuid", "document_uuid")
	if documentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid is required")
	}
	if !isValidDocumentUUID(documentUUID) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid format is invalid")
	}
	documentRefType := firstTextValue(body, "documentRefType", "document_ref_type")
	if documentRefType == "" {
		documentRefType = "codocs_document"
	}
	sourceApp := firstTextValue(body, "sourceApp", "source_app")
	if sourceApp == "" {
		sourceApp = "aims"
	}
	sourceProjectCode := firstTextValue(body, "sourceProjectCode", "source_project_code")
	actorUID := firstTextValue(body, "actorUid", "actor_uid", "current_user")
	action := firstTextValue(body, "action")
	if action == "" {
		action = "view"
	}

	policy, err := a.ensurePolicyDefault(ctx, documentRefType, documentUUID, sourceApp, sourceProjectCode, actorUID)
	if err != nil {
		return nil, err
	}
	grants, err := a.loadPolicyGrants(ctx, policy.ID)
	if err != nil {
		return nil, err
	}

	actorProjectCodes := parseStringSlice(body["actorProjectCodes"])
	actorDeptCodes := parseStringSlice(body["actorDeptCodes"])
	actorRoles := parseStringSlice(body["actorRoles"])

	result := documentAccessCheckResult{
		Allowed:              false,
		Permission:           "none",
		Readonly:             policyReadonly(policy),
		Reason:               "not_allowed",
		LifecycleStage:       policy.LifecycleStage,
		ConfidentialityLevel: policy.Confidentiality,
	}

	isSourceProjectMember := false
	if policy.SourceProjectCode != "" {
		for _, code := range actorProjectCodes {
			if strings.EqualFold(strings.TrimSpace(code), policy.SourceProjectCode) {
				isSourceProjectMember = true
				break
			}
		}
	}

	if action == "edit" && policyReadonly(policy) {
		result.Reason = "readonly"
		a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
		return map[string]any(resultToMap(result)), nil
	}

	if isSourceProjectMember {
		result.Allowed = true
		result.Permission = action
		result.Reason = "source_project_member"
		a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
		return map[string]any(resultToMap(result)), nil
	}

	if policy.LifecycleStage == "draft" {
		result.Reason = "draft_requires_project_member"
		a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
		return map[string]any(resultToMap(result)), nil
	}

	if (policy.Confidentiality == "L0" || policy.Confidentiality == "L1") && policy.AllowInternal {
		if action == "view" || (action == "download" && permissionRank(policy.DefaultPermission) >= permissionRank("download")) {
			result.Allowed = true
			result.Permission = action
			result.Reason = "internal_access"
			a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
			return map[string]any(resultToMap(result)), nil
		}
	}

	matchGrant := func(grant documentAccessGrant) bool {
		if permissionRank(grant.Permission) < permissionRank(action) {
			return false
		}
		subjectCode := strings.TrimSpace(grant.SubjectCode)
		switch grant.SubjectType {
		case "user":
			return actorUID != "" && subjectCode == actorUID
		case "project":
			if !policy.AllowCrossProject || policy.Confidentiality == "L3" {
				return false
			}
			for _, code := range actorProjectCodes {
				if strings.TrimSpace(code) == subjectCode {
					return true
				}
			}
		case "dept":
			if policy.Confidentiality == "L3" {
				return false
			}
			for _, code := range actorDeptCodes {
				if strings.TrimSpace(code) == subjectCode {
					return true
				}
			}
		case "role":
			for _, role := range actorRoles {
				if strings.TrimSpace(role) == subjectCode {
					return true
				}
			}
		}
		return false
	}

	for _, grant := range grants {
		if matchGrant(grant) {
			result.Allowed = true
			result.Permission = grant.Permission
			result.Reason = "granted_by_" + grant.SubjectType
			break
		}
	}

	if !result.Allowed {
		result.Reason = "no_matching_grant"
	}

	a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
	return map[string]any(resultToMap(result)), nil
}

func resultToMap(result documentAccessCheckResult) map[string]any {
	return map[string]any{
		"allowed":              result.Allowed,
		"permission":           result.Permission,
		"readonly":             result.Readonly,
		"reason":               result.Reason,
		"lifecycleStage":       result.LifecycleStage,
		"confidentialityLevel": result.ConfidentialityLevel,
	}
}

func (a *Adapter) getDocumentAccessPolicy(ctx context.Context, documentUUID string, query url.Values) (map[string]any, error) {
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}
	if !isValidDocumentUUID(documentUUID) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid format is invalid")
	}
	documentRefType := strings.TrimSpace(query.Get("documentRefType"))
	if documentRefType == "" {
		documentRefType = "codocs_document"
	}
	policy, err := a.ensurePolicyDefault(ctx, documentRefType, strings.TrimSpace(documentUUID), "aims", strings.TrimSpace(query.Get("sourceProjectCode")), strings.TrimSpace(query.Get("operator_uid")))
	if err != nil {
		return nil, err
	}
	grants, err := a.loadPolicyGrants(ctx, policy.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":                   policy.ID,
		"documentRefType":      policy.DocumentRefType,
		"documentUuid":         policy.DocumentUUID,
		"sourceApp":            policy.SourceApp,
		"sourceProjectCode":    policy.SourceProjectCode,
		"lifecycleStage":       policy.LifecycleStage,
		"confidentialityLevel": policy.Confidentiality,
		"defaultPermission":    policy.DefaultPermission,
		"allowInternalAccess":  policy.AllowInternal,
		"allowCrossProject":    policy.AllowCrossProject,
		"readonly":             policyReadonly(policy),
		"grants":               grants,
	}, nil
}

func (a *Adapter) updateDocumentAccessPolicy(ctx context.Context, documentUUID string, body map[string]any) (map[string]any, error) {
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}
	if !isValidDocumentUUID(documentUUID) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid format is invalid")
	}
	documentRefType := firstTextValue(body, "documentRefType", "document_ref_type")
	if documentRefType == "" {
		documentRefType = "codocs_document"
	}
	operatorUID := firstTextValue(body, "operatorUid", "operator_uid", "actorUid", "actor_uid", "current_user")
	policy, err := a.ensurePolicyDefault(ctx, documentRefType, strings.TrimSpace(documentUUID), firstTextValue(body, "sourceApp", "source_app"), firstTextValue(body, "sourceProjectCode", "source_project_code"), operatorUID)
	if err != nil {
		return nil, err
	}

	lifecycle := firstTextValue(body, "lifecycleStage", "lifecycle_stage")
	if lifecycle == "" {
		lifecycle = policy.LifecycleStage
	}
	confidentiality := firstTextValue(body, "confidentialityLevel", "confidentiality_level")
	if confidentiality == "" {
		confidentiality = policy.Confidentiality
	}
	defaultPermission := firstTextValue(body, "defaultPermission", "default_permission")
	if defaultPermission == "" {
		defaultPermission = policy.DefaultPermission
	}
	allowInternal := parseBoolValue(body, "allowInternalAccess", policy.AllowInternal)
	allowCrossProject := parseBoolValue(body, "allowCrossProject", policy.AllowCrossProject)
	readonly := parseBoolValue(body, "readonly", policy.Readonly) || lifecycle == "archived"

	if operatorUID == "" {
		operatorUID = "system"
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		UPDATE document_access_policies
		SET source_app = ?,
		    source_project_code = ?,
		    lifecycle_stage = ?,
		    confidentiality_level = ?,
		    default_permission = ?,
		    allow_internal_access = ?,
		    allow_cross_project = ?,
		    readonly = ?,
		    updated_by = ?,
		    updated_at = NOW()
		WHERE id = ?
	`, nullableString(firstTextValue(body, "sourceApp", "source_app")), nullableString(firstTextValue(body, "sourceProjectCode", "source_project_code")), lifecycle, confidentiality, defaultPermission, boolInt(allowInternal), boolInt(allowCrossProject), boolInt(readonly), operatorUID, policy.ID)
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, "DELETE FROM document_access_grants WHERE policy_id = ?", policy.ID); err != nil {
		return nil, err
	}

	if rawGrants, ok := body["grants"].([]any); ok {
		for _, rawGrant := range rawGrants {
			grantMap, ok := rawGrant.(map[string]any)
			if !ok {
				continue
			}
			subjectType := firstTextValue(grantMap, "subjectType", "subject_type")
			subjectCode := firstTextValue(grantMap, "subjectCode", "subject_code")
			permission := firstTextValue(grantMap, "permission")
			if subjectType == "" || subjectCode == "" || permission == "" {
				continue
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO document_access_grants
				(policy_id, subject_type, subject_code, permission, expires_at, created_by)
				VALUES (?, ?, ?, ?, ?, ?)
			`, policy.ID, subjectType, subjectCode, permission, normalizeBodyNullable(grantMap["expiresAt"]), operatorUID); err != nil {
				return nil, err
			}
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO document_access_audit_logs
		(document_ref_type, document_uuid, actor_uid, action, decision, reason, source_project_code, actor_project_codes)
		VALUES (?, ?, ?, 'policy_update', 'allow', 'policy_updated', ?, '[]')
	`, documentRefType, strings.TrimSpace(documentUUID), operatorUID, nullableString(firstTextValue(body, "sourceProjectCode", "source_project_code"))); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return a.getDocumentAccessPolicy(ctx, strings.TrimSpace(documentUUID), url.Values{"documentRefType": []string{documentRefType}})
}

func (a *Adapter) listDocumentAccessAuditLogs(ctx context.Context, query url.Values) (map[string]any, error) {
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}
	documentUUID := strings.TrimSpace(query.Get("documentUuid"))
	pageSize := parseIntDefault(query.Get("pageSize"), 50)
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	page := parseIntDefault(query.Get("page"), 1)
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * pageSize

	whereSQL := ""
	args := make([]any, 0)
	if documentUUID != "" {
		whereSQL = "WHERE document_uuid = ?"
		args = append(args, documentUUID)
	}

	countSQL := "SELECT COUNT(*) FROM document_access_audit_logs " + whereSQL
	var total int64
	if err := a.db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	listSQL := `
		SELECT id, document_ref_type, document_uuid, actor_uid, action, decision, reason,
		       source_project_code, actor_project_codes,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM document_access_audit_logs ` + whereSQL + `
		ORDER BY id DESC
		LIMIT ? OFFSET ?`
	args = append(args, pageSize, offset)

	rows, err := a.db.QueryContext(ctx, listSQL, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var documentRefType string
		var docUUID string
		var actorUID sql.NullString
		var action string
		var decision string
		var reason string
		var sourceProjectCode sql.NullString
		var actorProjectCodes sql.NullString
		var createdAt string
		if err := rows.Scan(&id, &documentRefType, &docUUID, &actorUID, &action, &decision, &reason, &sourceProjectCode, &actorProjectCodes, &createdAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id":                id,
			"documentRefType":   documentRefType,
			"documentUuid":      docUUID,
			"actorUid":          nullableStringValue(actorUID),
			"action":            action,
			"decision":          decision,
			"reason":            reason,
			"sourceProjectCode": nullableStringValue(sourceProjectCode),
			"actorProjectCodes": nullableStringValue(actorProjectCodes),
			"createdAt":         createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	}, nil
}

func parseIntDefault(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func nullableStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}
