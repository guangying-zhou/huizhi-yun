package codocs

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

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
	"document_review_grants",
	"document_relations",
	"department_shares",
	"cabinet_folders",
	"cabinet_files",
	"document_reviews",
	"document_publish_requests",
	"review_actions",
	"document_seal_records",
	"document_send_records",
	"document_annotations",
	"annotation_replies",
	"project_issues",
	"issue_comments",
	"info_bookmarks",
	"info_items",
	"service_command_receipt",
	"company_asset_quick_publish_operations",
	"company_asset_access_records",
	"published_asset_links",
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
				Path:             "folders",
				Table:            "folders",
				SearchColumns:    []string{"name", "folder_type", "owner_uid", "dept_code", "project_code"},
				DefaultOrderBy:   "`sort_order` ASC, `id` ASC",
				WriteDenyColumns: []string{"is_open"},
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
				SearchColumns:    []string{"uuid", "filename", "original_name", "owner_uid", "dept_code", "project_code"},
				DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
				SoftDeleteColumn: "deleted_at",
			},
			{
				Path:             "project-cabinet",
				Table:            "cabinet_files",
				IDColumn:         "uuid",
				SearchColumns:    []string{"uuid", "filename", "original_name", "owner_uid", "project_code"},
				DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
				SoftDeleteColumn: "deleted_at",
			},
			{Path: "reviews", Table: "document_reviews", SearchColumns: []string{"document_uuid", "review_type", "sub_type", "initiator_uid", "target_category", "status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "reviews/publish-requests", Table: "document_publish_requests", SearchColumns: []string{"document_uuid", "review_type", "sub_type", "initiator_uid", "target_category", "workflow_status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "review-actions", Table: "review_actions", SearchColumns: []string{"review_id", "actor_uid", "action"}, DefaultOrderBy: "`created_at` DESC, `id` DESC"},
			{Path: "issues", Table: "project_issues", SearchColumns: []string{"project_code", "title", "description", "issue_type", "status", "priority", "assignee", "created_by", "document_uuid", "tags"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
		},
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{Adapter: adapter, db: adapter.DB()}, nil
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	suffix := strings.Trim(strings.TrimPrefix(path, "/v1/codocs"), "/")
	body = codocsRuntimeBodyFromRequest(query, body)

	if method == http.MethodPost && suffix == "published-asset-links" {
		result, err := a.createPublishedAssetLink(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.published_asset_links.create", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "published-asset-links/") && len(pathSegments(suffix)) == 2 {
		result, err := a.resolvePublishedAssetLink(ctx, query, strings.TrimPrefix(suffix, "published-asset-links/"))
		return map[string]any{"success": true, "data": result}, "codocs.published_asset_links.resolve", err
	}

	if method == http.MethodPost && suffix == "company-assets/quick-publish/prepare" {
		result, err := a.quickPublishPrepare(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.company_assets.quick_publish.prepare", err
	}
	if method == http.MethodPost && suffix == "company-assets/quick-publish/complete" {
		result, err := a.quickPublishComplete(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.company_assets.quick_publish.complete", err
	}
	if method == http.MethodPost && suffix == "company-assets/access-records" {
		result, err := a.recordCompanyAssetAccess(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.company_assets.access_records.record", err
	}
	if method == http.MethodGet && suffix == "company-assets/access-records" {
		result, err := a.listCompanyAssetAccessRecords(ctx, query, false)
		return map[string]any{"success": true, "data": result}, "codocs.company_assets.access_records.list", err
	}
	if method == http.MethodGet && suffix == "company-assets/access-records/export" {
		result, err := a.listCompanyAssetAccessRecords(ctx, query, true)
		return map[string]any{"success": true, "data": result}, "codocs.company_assets.access_records.export", err
	}

	if method == http.MethodPost && suffix == "document-access/check" {
		result, err := a.documentAccessCheck(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.document_access.check", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "document-access/policies/") && len(pathSegments(suffix)) == 3 {
		documentUUID := strings.TrimPrefix(suffix, "document-access/policies/")
		result, err := a.getDocumentAccessPolicy(ctx, documentUUID, query)
		return map[string]any{"success": true, "data": result}, "codocs.document_access.policies.get", err
	}
	if (method == http.MethodPut || method == http.MethodPatch) && strings.HasPrefix(suffix, "document-access/policies/") && len(pathSegments(suffix)) == 3 {
		documentUUID := strings.TrimPrefix(suffix, "document-access/policies/")
		result, err := a.updateDocumentAccessPolicy(ctx, documentUUID, query, body)
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
	if method == http.MethodPost && strings.HasPrefix(suffix, "service/company-weekly-summaries/") && strings.HasSuffix(suffix, ":publish") {
		periodKey := pathMiddle(suffix, "service/company-weekly-summaries/", ":publish")
		if periodKey == "" || strings.Contains(periodKey, "/") {
			return nil, "codocs.service.company_weekly_summary.publish", httperror.New(http.StatusBadRequest, "invalid_period_key", "company weekly summary period key is required")
		}
		result, err := a.publishCompanyWeeklySummary(ctx, periodKey, body)
		return map[string]any{"success": true, "data": result}, "codocs.service.company_weekly_summary.publish", err
	}

	if suffix == "service/product-documents/create/template" || suffix == "service/product-documents/create/prepare" || suffix == "service/product-documents/create/complete" {
		operation := "codocs.service.product_document.create"
		if method != http.MethodPost {
			return nil, operation, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		}
		result, err := a.productDocumentCreationRuntime(ctx, strings.TrimPrefix(suffix, "service/product-documents/create/"), query, body)
		return map[string]any{"success": err == nil, "data": result}, operation, err
	}
	if suffix == "service/product-documents/search" {
		const operation = "codocs.service.product_document.search"
		if method != http.MethodPost {
			return nil, operation, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		}
		result, err := a.productDocumentServiceSearch(ctx, query, body)
		return map[string]any{"success": err == nil, "data": result}, operation, err
	}
	if strings.HasPrefix(suffix, "service/assets-product-documents/") && strings.HasSuffix(suffix, "/metadata") {
		const operation = "codocs.service.assets_product_document.metadata"
		if method != http.MethodPost {
			return nil, operation, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		}
		documentUUID := pathMiddle(suffix, "service/assets-product-documents/", "/metadata")
		result, err := a.assetsProductDocumentMetadata(ctx, documentUUID, query, body)
		return map[string]any{"success": err == nil, "data": result}, operation, err
	}
	if strings.HasPrefix(suffix, "service/product-documents/") && strings.HasSuffix(suffix, "/metadata") {
		const operation = "codocs.service.product_document.metadata"
		if method != http.MethodPost {
			return nil, operation, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		}
		documentUUID := pathMiddle(suffix, "service/product-documents/", "/metadata")
		result, err := a.productDocumentServiceMetadata(ctx, documentUUID, query, body)
		return map[string]any{"success": err == nil, "data": result}, operation, err
	}
	if strings.HasPrefix(suffix, "service/product-documents/") && strings.HasSuffix(suffix, "/content") {
		const operation = "codocs.service.product_document.content"
		if method != http.MethodPost {
			return nil, operation, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		}
		documentUUID := pathMiddle(suffix, "service/product-documents/", "/content")
		result, err := a.productDocumentServiceContent(ctx, documentUUID, query, body)
		return map[string]any{"success": err == nil, "data": result}, operation, err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "service/project-documents/") && strings.HasSuffix(suffix, "/content") {
		uuid := pathMiddle(suffix, "service/project-documents/", "/content")
		if uuid == "" || strings.Contains(uuid, "/") {
			return nil, "codocs.service.project_document.content", httperror.New(http.StatusBadRequest, "invalid_document_uuid", "project document uuid is required")
		}
		result, err := a.projectDocumentServiceContent(ctx, uuid, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.service.project_document.content", err
	}
	if method == http.MethodPost && suffix == "service/department-documents/search" {
		result, err := a.departmentDocumentsServiceList(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.service.department_documents.list", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "service/project-documents/") && strings.Contains(suffix, "/versions/") {
		result, operation, matched, err := a.handleProjectDocumentQualityService(ctx, suffix, query, body)
		if matched {
			return map[string]any{"success": true, "data": result}, operation, err
		}
	}
	if method == http.MethodPost && suffix == "service/project-document-review-grants" {
		result, err := a.createProjectDocumentReviewGrant(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.service.project_document.review_grant.create", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "service/altoc-entity-documents/") && strings.HasSuffix(suffix, "/content") {
		uuid := pathMiddle(suffix, "service/altoc-entity-documents/", "/content")
		if uuid == "" || strings.Contains(uuid, "/") {
			return nil, "codocs.service.altoc_entity_document.content", httperror.New(http.StatusBadRequest, "invalid_document_uuid", "Altoc entity document uuid is required")
		}
		result, err := a.altocEntityDocumentContent(ctx, uuid, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.service.altoc_entity_document.content", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "service/altoc-entity-documents/") && strings.HasSuffix(suffix, "/attach") {
		uuid := pathMiddle(suffix, "service/altoc-entity-documents/", "/attach")
		if uuid == "" || strings.Contains(uuid, "/") {
			return nil, "codocs.service.altoc_entity_document.attach", httperror.New(http.StatusBadRequest, "invalid_document_uuid", "Altoc entity document uuid is required")
		}
		result, err := a.altocEntityDocumentAttachAuthorize(ctx, uuid, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.service.altoc_entity_document.attach", err
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
	if suffix == "documents/search" || suffix == "documents/batch-summary" {
		// A generic runtime token and caller-selected filters/UUIDs cannot prove
		// project or parent-document authorization. Keep both legacy service
		// reads unavailable until a source-bound scoped contract is introduced.
		return nil, "codocs.documents.service_contract_required", httperror.New(http.StatusServiceUnavailable, "scoped_document_service_contract_required", "Source-bound scoped document service contract is required")
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
			result, err := a.documentAnnotations(ctx, segments[1], query)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.list", err
		}
		if len(segments) == 3 && segments[2] == "annotations" && method == http.MethodPost {
			result, err := a.createDocumentAnnotation(ctx, segments[1], query, body)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.create", err
		}
		if len(segments) == 4 && segments[2] == "annotations" && method == http.MethodPatch {
			result, err := a.updateDocumentAnnotation(ctx, segments[1], segments[3], query, body)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.update", err
		}
		if len(segments) == 5 && segments[2] == "annotations" && segments[4] == "replies" && method == http.MethodPost {
			result, err := a.createAnnotationReply(ctx, segments[1], segments[3], query, body)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.replies.create", err
		}
		if len(segments) == 6 && segments[2] == "annotations" && segments[4] == "replies" && method == http.MethodDelete {
			result, err := a.deleteAnnotationReply(ctx, segments[1], segments[3], segments[5], query, body)
			return map[string]any{"success": true, "data": result}, "codocs.documents.annotations.replies.delete", err
		}
	}
	if suffix == "cabinet/folders" || strings.HasPrefix(suffix, "cabinet/folders/") {
		// Personal cabinet folder resources have no verified BFF consumer or
		// owner-scope contract and therefore cannot use compat CRUD.
		return nil, "codocs.cabinet_folders.contract_required", httperror.New(http.StatusServiceUnavailable, "cabinet_folder_scope_contract_required", "Scoped cabinet folder contract is required")
	}
	if suffix == "dept-cabinet/folders" {
		if method == http.MethodGet {
			result, err := a.departmentCabinetFoldersList(ctx, query)
			return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.folders.list", err
		}
		return nil, "codocs.cabinet_folders.contract_required", httperror.New(http.StatusServiceUnavailable, "cabinet_folder_scope_contract_required", "Scoped cabinet folder contract is required")
	}
	if strings.HasPrefix(suffix, "dept-cabinet/folders/") {
		// Department folder mutations require a dedicated manager-bound command;
		// do not infer that delegation from a browser body or service subject.
		return nil, "codocs.cabinet_folders.contract_required", httperror.New(http.StatusServiceUnavailable, "cabinet_folder_scope_contract_required", "Scoped cabinet folder contract is required")
	}
	if method == http.MethodGet && suffix == "cabinet" {
		result, err := a.cabinetList(ctx, query, false)
		return map[string]any{"success": true, "data": result}, "codocs.cabinet.list", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "cabinet/") && len(pathSegments(suffix)) == 2 {
		uuid := strings.TrimPrefix(suffix, "cabinet/")
		result, err := a.cabinetFile(ctx, uuid, query, false)
		return map[string]any{"success": true, "data": result}, "codocs.cabinet.get", err
	}
	if method == http.MethodPost && suffix == "cabinet" {
		result, err := a.createCabinetFile(ctx, query, body, false)
		return map[string]any{"success": true, "data": result}, "codocs.cabinet.create", err
	}
	if method == http.MethodPatch && strings.HasPrefix(suffix, "cabinet/") && len(pathSegments(suffix)) == 2 {
		result, err := a.updateCabinetFile(ctx, strings.TrimPrefix(suffix, "cabinet/"), query, body, false)
		return map[string]any{"success": true, "data": result}, "codocs.cabinet.update", err
	}
	if method == http.MethodDelete && strings.HasPrefix(suffix, "cabinet/") && len(pathSegments(suffix)) == 2 {
		result, err := a.deleteCabinetFile(ctx, strings.TrimPrefix(suffix, "cabinet/"), query, false)
		return map[string]any{"success": true, "data": result}, "codocs.cabinet.delete", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "cabinet/") && strings.HasSuffix(suffix, "/converted-document") && len(pathSegments(suffix)) == 3 {
		uuid := pathMiddle(suffix, "cabinet/", "/converted-document")
		result, err := a.markCabinetFileConverted(ctx, uuid, query, body, false)
		return map[string]any{"success": true, "data": result}, "codocs.cabinet.converted_document.update", err
	}
	if method == http.MethodGet && suffix == "dept-cabinet" {
		result, err := a.cabinetList(ctx, query, true)
		return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.list", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "dept-cabinet/") && len(pathSegments(suffix)) == 2 {
		uuid := strings.TrimPrefix(suffix, "dept-cabinet/")
		result, err := a.cabinetFile(ctx, uuid, query, true)
		return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.get", err
	}
	if method == http.MethodPost && suffix == "dept-cabinet" {
		result, err := a.createCabinetFile(ctx, query, body, true)
		return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.create", err
	}
	if method == http.MethodPatch && strings.HasPrefix(suffix, "dept-cabinet/") && len(pathSegments(suffix)) == 2 {
		result, err := a.updateCabinetFile(ctx, strings.TrimPrefix(suffix, "dept-cabinet/"), query, body, true)
		return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.update", err
	}
	if method == http.MethodDelete && strings.HasPrefix(suffix, "dept-cabinet/") && len(pathSegments(suffix)) == 2 {
		result, err := a.deleteCabinetFile(ctx, strings.TrimPrefix(suffix, "dept-cabinet/"), query, true)
		return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.delete", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "dept-cabinet/") && strings.HasSuffix(suffix, "/converted-document") && len(pathSegments(suffix)) == 3 {
		uuid := pathMiddle(suffix, "dept-cabinet/", "/converted-document")
		result, err := a.markCabinetFileConverted(ctx, uuid, query, body, true)
		return map[string]any{"success": true, "data": result}, "codocs.dept_cabinet.converted_document.update", err
	}
	if method == http.MethodGet && suffix == "dept-shares" {
		result, err := a.departmentSharesList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.dept_shares.list", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "dept-shares/") && len(pathSegments(suffix)) == 2 {
		result, err := a.departmentShareDetail(ctx, strings.TrimPrefix(suffix, "dept-shares/"), query)
		return map[string]any{"success": true, "data": result}, "codocs.dept_shares.get", err
	}
	if method == http.MethodPatch && strings.HasPrefix(suffix, "dept-shares/") && len(pathSegments(suffix)) == 2 {
		result, err := a.updateDepartmentShare(ctx, strings.TrimPrefix(suffix, "dept-shares/"), query, body)
		return map[string]any{"success": true, "data": result}, "codocs.dept_shares.update", err
	}
	if method == http.MethodGet && suffix == "project-cabinet" {
		result, err := a.projectCabinetList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.project_cabinet.list", err
	}
	if method == http.MethodPost && suffix == "project-cabinet" {
		result, err := a.createProjectCabinetFile(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.project_cabinet.create", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "project-cabinet/") && len(pathSegments(suffix)) == 2 {
		uuid := strings.TrimPrefix(suffix, "project-cabinet/")
		result, err := a.projectCabinetFile(ctx, uuid, query)
		return map[string]any{"success": true, "data": result}, "codocs.project_cabinet.get", err
	}
	if method == http.MethodDelete && strings.HasPrefix(suffix, "project-cabinet/") && len(pathSegments(suffix)) == 2 {
		result, err := a.deleteProjectCabinetFile(ctx, strings.TrimPrefix(suffix, "project-cabinet/"), query, body)
		return map[string]any{"success": true, "data": result}, "codocs.project_cabinet.delete", err
	}
	if (method == http.MethodPatch || method == http.MethodPut) && strings.HasPrefix(suffix, "project-cabinet/") && len(pathSegments(suffix)) == 2 {
		return nil, "codocs.project_cabinet.contract_required", httperror.New(http.StatusServiceUnavailable, "project_cabinet_mutation_contract_required", "Project cabinet mutation contract is required")
	}
	if method == http.MethodGet && suffix == "issues" {
		result, err := a.issuesList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.issues.list", err
	}
	if method == http.MethodPost && suffix == "issues" {
		result, err := a.createIssue(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.issues.create", err
	}
	if method == http.MethodGet && suffix == "issues/pending-count" {
		result, err := a.issuePendingCount(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.issues.pending_count", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "issues/") && strings.HasSuffix(suffix, "/comments") {
		issueID := pathMiddle(suffix, "issues/", "/comments")
		result, err := a.createIssueComment(ctx, issueID, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.issues.comments.create", err
	}
	if strings.HasPrefix(suffix, "issues/") && len(pathSegments(suffix)) == 2 {
		issueID := strings.TrimPrefix(suffix, "issues/")
		switch method {
		case http.MethodGet:
			result, err := a.issueDetail(ctx, issueID, query)
			return map[string]any{"success": true, "data": result}, "codocs.issues.get", err
		case http.MethodPatch:
			result, err := a.updateIssue(ctx, issueID, query, body)
			return map[string]any{"success": true, "data": result}, "codocs.issues.update", err
		case http.MethodDelete:
			result, err := a.deleteIssue(ctx, issueID, query)
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
	if (method == http.MethodPatch || method == http.MethodPut) && strings.HasPrefix(suffix, "folders/") && strings.HasSuffix(suffix, "/open") {
		segments := pathSegments(suffix)
		if len(segments) == 3 && segments[0] == "folders" && segments[2] == "open" {
			result, err := a.updateFolderOpen(ctx, segments[1], query, body)
			return map[string]any{"success": true, "data": result}, "codocs.folders.open.update", err
		}
	}
	if method == http.MethodGet && suffix == "open-department-documents" {
		result, err := a.openDepartmentDocuments(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.open_department_documents.list", err
	}
	if method == http.MethodGet && suffix == "folders" {
		result, err := a.foldersList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.folders.list", err
	}
	if method == http.MethodPost && suffix == "folders" {
		result, err := a.createFolder(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.folders.create", err
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
		result, err := a.documentShares(ctx, uuid, query)
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
		result, err := a.markDocumentRead(ctx, uuid, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.read", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "documents/") && strings.HasSuffix(suffix, "/versions") {
		uuid := pathMiddle(suffix, "documents/", "/versions")
		result, err := a.documentVersions(ctx, uuid, query)
		return map[string]any{"success": true, "data": result}, "codocs.documents.versions.list", err
	}
	if method == http.MethodDelete && strings.HasPrefix(suffix, "documents/") && strings.Contains(suffix, "/versions/") {
		uuid, versionID := documentNestedID(suffix, "versions")
		result, err := a.deleteDocumentVersion(ctx, uuid, versionID, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.documents.versions.delete", err
	}
	if method == http.MethodGet && suffix == "reviews/my" {
		result, err := a.myReviews(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.my", err
	}
	if suffix == "reviews/templates" || strings.HasPrefix(suffix, "reviews/templates/") {
		return nil, "codocs.reviews.templates.removed", httperror.New(http.StatusGone, "review_templates_moved_to_workflow", "Publish approval templates are managed by Workflow")
	}
	if method == http.MethodPost && suffix == "reviews/publish-requests" {
		result, err := a.createPublishRequest(ctx, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.create", err
	}
	if method == http.MethodGet && suffix == "reviews/publish-requests" {
		result, err := a.publishRequestsList(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.list", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "reviews/publish-requests/") && len(pathSegments(suffix)) == 3 {
		id := strings.TrimPrefix(suffix, "reviews/publish-requests/")
		result, err := a.publishRequestDetail(ctx, id, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.get", err
	}
	if method == http.MethodPatch && strings.HasPrefix(suffix, "reviews/publish-requests/") && len(pathSegments(suffix)) == 3 {
		id := strings.TrimPrefix(suffix, "reviews/publish-requests/")
		result, err := a.updateDraftPublishRequest(ctx, id, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.update_draft", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/workflow-command") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/workflow-command")
		result, err := a.preparePublishRequestWorkflowCommand(ctx, id, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.workflow_command.prepare", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/workflow-checkpoint") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/workflow-checkpoint")
		result, err := a.checkpointPublishRequestWorkflow(ctx, id, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.workflow_checkpoint", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/workflow-callback") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/workflow-callback")
		result, err := a.applyPublishRequestWorkflowCallback(ctx, id, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.workflow_callback", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/archive-plan") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/archive-plan")
		result, err := a.preparePublishArchive(ctx, id, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.archive_plan", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/archive") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/archive")
		result, err := a.commitPublishArchive(ctx, id, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.archive", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/seal") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/seal")
		result, err := a.confirmPublishSeal(ctx, id, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.seal", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/send") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/send")
		result, err := a.confirmPublishSend(ctx, id, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.send", err
	}
	if method == http.MethodPost && strings.HasPrefix(suffix, "reviews/publish-requests/") && strings.HasSuffix(suffix, "/receive") {
		id := pathMiddle(suffix, "reviews/publish-requests/", "/receive")
		result, err := a.confirmPublishReceive(ctx, id, query, body)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.publish_requests.receive", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "reviews/by-document/") && len(pathSegments(suffix)) == 3 {
		uuid := strings.TrimPrefix(suffix, "reviews/by-document/")
		result, err := a.reviewByDocument(ctx, uuid, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.by_document", err
	}
	if method == http.MethodGet && suffix == "reviews/by-oss-path" {
		result, err := a.reviewByOssPath(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.by_oss_path", err
	}
	if method == http.MethodGet && strings.HasPrefix(suffix, "reviews/") && len(pathSegments(suffix)) == 2 {
		id := strings.TrimPrefix(suffix, "reviews/")
		result, err := a.reviewDetail(ctx, id, query)
		return map[string]any{"success": true, "data": result}, "codocs.reviews.get", err
	}
	if method == http.MethodGet && suffix == "collab-docs" {
		result, err := a.collabDocs(ctx, query)
		return map[string]any{"success": true, "data": result}, "codocs.collab_docs.list", err
	}
	if isScopedNestedResourceGenericPath(suffix) {
		// Shares, versions, annotations and issue comments must be reached through
		// their document/annotation/issue-bound handlers above. The generic table
		// adapter has no way to reconstruct those parent ACL predicates, so every
		// direct generic CRUD shape fails closed until a dedicated scoped contract
		// is intentionally introduced.
		return nil, "codocs.scoped_resources.contract_required", httperror.New(http.StatusServiceUnavailable, "scoped_resource_contract_required", "Scoped parent-resource contract is required")
	}
	if suffix == "folders" || strings.HasPrefix(suffix, "folders/") {
		// Only the explicitly scoped list, create, and department-open routes
		// above may touch folders. Generic resource fallback has no
		// owner/department/project predicate and must never mutate or disclose a
		// folder by guessed ID.
		return nil, "codocs.folders.contract_required", httperror.New(http.StatusServiceUnavailable, "folder_scope_contract_required", "Scoped folder detail and mutation contracts are required")
	}
	if suffix == "reviews" || strings.HasPrefix(suffix, "reviews/publish-requests") || strings.HasPrefix(suffix, "review-actions") {
		// Review reads above have document-bound ACL projections. Generic resource
		// fallback cannot validate document ACL, initiator/workflow ownership, or
		// legal review transitions, so it must not expose these paths.
		return nil, "codocs.reviews.contract_required", httperror.New(http.StatusServiceUnavailable, "review_scope_contract_required", "Scoped review and publish-request contracts are required")
	}

	return a.Adapter.HandleRuntime(ctx, method, path, query, body)
}

func isScopedNestedResourceGenericPath(suffix string) bool {
	for _, resource := range []string{
		"document-shares",
		"document-versions",
		"annotations",
		"annotation-replies",
		"issue-comments",
	} {
		if suffix == resource || strings.HasPrefix(suffix, resource+"/") {
			return true
		}
	}
	return false
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

func (a *Adapter) grantDocumentPreviewAccess(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	// A raw body cannot establish that AIMS checked the named user against the
	// named project/document. Do not create an ACL-bearing relation until this
	// route consumes a Foundation-verified service command binding source app,
	// actor, document UUID, project code, tenant/deployment and expiry.
	return nil, httperror.New(http.StatusServiceUnavailable, "preview_access_service_command_required", "A signed AIMS service command is required for preview access")
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
	case uint64:
		if v > uint64(^uint64(0)>>1) {
			return 0
		}
		return int64(v)
	case uint:
		if uint64(v) > uint64(^uint64(0)>>1) {
			return 0
		}
		return int64(v)
	case uint32:
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
	return firstNonEmpty(
		query.Get("current_user"),
		query.Get("currentUser"),
		query.Get("operator_uid"),
		query.Get("operatorUid"),
		query.Get("actorUid"),
		query.Get("actor_uid"),
	)
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

func (a *Adapter) columnExists(ctx context.Context, table string, column string) (bool, error) {
	var found string
	err := a.db.QueryRowContext(ctx, `
      SELECT COLUMN_NAME
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`, table, column).Scan(&found)
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
	return upsertDocumentRelationTx(ctx, a.db, input)
}

type documentRelationExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func upsertDocumentRelationTx(ctx context.Context, executor documentRelationExecutor, input documentRelationInput) error {
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return err
	}
	_, err = executor.ExecContext(ctx, `
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
