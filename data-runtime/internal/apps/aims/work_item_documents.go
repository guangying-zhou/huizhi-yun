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
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
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
	ProjectID   sql.NullInt64
	ProjectCode sql.NullString
	Source      sql.NullString
	Title       string
	DocCategory sql.NullString
	OSSPath     sql.NullString
	CodocsUUID  sql.NullString
	ContentSize sql.NullInt64
}

type enterpriseWorkItemDocumentACLKey struct{}

// Only the authenticated Enterprise route installs this callback. Independent
// Aims retains its existing document behavior and never borrows a service ACL.
func WithEnterpriseWorkItemDocumentACL(ctx context.Context, check EnterpriseProjectDocumentACL) context.Context {
	return context.WithValue(ctx, enterpriseWorkItemDocumentACLKey{}, check)
}

type enterpriseScopedWriteTxKey struct{}

func (a *Adapter) enterpriseScopedWriteDB(ctx context.Context) timeEntrySQL {
	if tx, ok := ctx.Value(enterpriseScopedWriteTxKey{}).(*sql.Tx); ok {
		return tx
	}
	return a.timeEntryDB(ctx)
}

func enterpriseScopedWorkItemWrite[T any](a *Adapter, ctx context.Context, rawWorkItemID string, query url.Values, action string, write func(context.Context) (T, error), receipt ...legacyWorkItemReceiptConfig[T]) (T, error) {
	var zero T
	identity, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enabled {
		return write(ctx)
	}
	if identity.ActorUID == "" || identity.ActorUID != query.Get("current_user") || identity.CommandScope == nil {
		return zero, httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	// Read the owner once, then lock project before work item as required by the
	// owning-domain write order. The locked row is checked again before writing.
	target, err := a.workItemDocumentProject(ctx, rawWorkItemID)
	if err != nil {
		return zero, err
	}
	var tx *sql.Tx
	var repo *iop.ReceiptRepository
	if len(receipt) > 0 && identity.IdempotencyKey != "" {
		tx, repo, err = a.beginDeliverableWrite(ctx)
	} else {
		tx, err = a.DB().BeginTx(ctx, nil)
	}
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	if err := requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, strconv.FormatInt(target.ProjectID, 10), rawWorkItemID, action); err != nil {
		return zero, err
	}
	var lockedProjectID int64
	if err := tx.QueryRowContext(ctx, "SELECT project_id FROM work_items WHERE id=? FOR UPDATE", target.WorkItemID).Scan(&lockedProjectID); err != nil {
		return zero, err
	}
	if lockedProjectID != target.ProjectID {
		return zero, httperror.New(403, "work_item_project_changed", "Work item project changed")
	}
	if len(receipt) > 0 && repo != nil {
		if err := requireEnterpriseDeliverableProjectScopeTx(ctx, tx, identity.ActorUID, target.ProjectID, false); err != nil {
			return zero, err
		}
	}
	ctx = context.WithValue(ctx, enterpriseScopedWriteTxKey{}, tx)
	var out T
	if len(receipt) > 0 && repo != nil {
		out, err = executeLegacyWorkItemReceipt(ctx, tx, repo, receipt[0], write)
	} else {
		out, err = write(ctx)
	}
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(); err != nil {
		return zero, err
	}
	return out, nil
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
	return enterpriseScopedWorkItemWrite(a, ctx, rawWorkItemID, query, "work-item-document", func(ctx context.Context) (map[string]any, error) {
		return a.linkWorkItemDocumentBody(ctx, rawWorkItemID, query, body)
	}, legacyWorkItemReceiptConfig[map[string]any]{Action: "document-link", Capability: "aims:work-item-documents:edit", BizType: "work-item-document", Command: map[string]any{"workItemId": rawWorkItemID, "payload": body}, BizCode: func(value map[string]any) string {
		return fmt.Sprint(value["id"]) + ":" + fmt.Sprint(value["documentId"])
	}, Replay: func(_ context.Context, code string) (map[string]any, error) {
		parts := strings.SplitN(code, ":", 2)
		if len(parts) != 2 {
			return nil, httperror.New(503, "work_item_receipt_corrupt", "Work item receipt is invalid")
		}
		id, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || id <= 0 {
			return nil, httperror.New(503, "work_item_receipt_corrupt", "Work item receipt is invalid")
		}
		workItemID, err := strconv.ParseInt(rawWorkItemID, 10, 64)
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "workItemId": workItemID, "documentId": parts[1], "linkedBy": query.Get("current_user")}, nil
	}, Decorate: decorateLegacyWorkItemMap, BeforeReplay: func(ctx context.Context) error {
		return a.requireCurrentWorkItemDocumentACL(ctx, body, query.Get("current_user"))
	}})
}

func (a *Adapter) requireCurrentWorkItemDocumentACL(ctx context.Context, body map[string]any, actor string) error {
	documentID := strings.TrimSpace(firstBodyText(body, "documentId", "document_id", "codocsUuid", "codocs_uuid", "uuid"))
	if documentID == "" {
		return httperror.New(400, "missing_document_id", "documentId is required")
	}
	source, err := a.workItemSourceDocument(ctx, documentID, true)
	if err != nil {
		return err
	}
	if source == nil || !source.CodocsUUID.Valid || strings.TrimSpace(source.CodocsUUID.String) == "" || strings.EqualFold(source.Source.String, "repo") || !source.ProjectID.Valid || !source.ProjectCode.Valid {
		return httperror.New(404, "document_source_not_found", "Document source not found")
	}
	check, ok := ctx.Value(enterpriseWorkItemDocumentACLKey{}).(EnterpriseProjectDocumentACL)
	if !ok || check == nil {
		return httperror.New(503, "document_acl_unavailable", "Document access check unavailable")
	}
	facts, err := a.workItemDocumentAccessFacts(ctx, source, actor)
	if err != nil {
		return err
	}
	acl, err := check(ctx, strings.TrimSpace(source.CodocsUUID.String), "codocs_document", facts)
	if err != nil {
		return err
	}
	if acl["allowed"] != true {
		return httperror.New(403, "document_view_required", "Document view access required")
	}
	return nil
}

func (a *Adapter) linkWorkItemDocumentBody(ctx context.Context, rawWorkItemID string, query url.Values, body map[string]any) (map[string]any, error) {
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
	err = a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, `
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

	_, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	source, err := a.workItemSourceDocument(ctx, documentID, enterprise)
	if err != nil {
		return nil, err
	}
	if enterprise {
		if source == nil || !source.CodocsUUID.Valid || strings.TrimSpace(source.CodocsUUID.String) == "" || strings.EqualFold(source.Source.String, "repo") || !source.ProjectID.Valid || !source.ProjectCode.Valid {
			return nil, httperror.New(404, "document_source_not_found", "Document source not found")
		}
		check, ok := ctx.Value(enterpriseWorkItemDocumentACLKey{}).(EnterpriseProjectDocumentACL)
		if !ok || check == nil {
			return nil, httperror.New(503, "document_acl_unavailable", "Document access check unavailable")
		}
		facts, err := a.workItemDocumentAccessFacts(ctx, source, uid)
		if err != nil {
			return nil, err
		}
		acl, err := check(ctx, strings.TrimSpace(source.CodocsUUID.String), "codocs_document", facts)
		if err != nil {
			return nil, err
		}
		if acl["allowed"] != true {
			return nil, httperror.New(403, "document_view_required", "Document view access required")
		}
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

	ownerProjectID := any(target.ProjectID)
	if enterprise {
		// A work-item-owned row cannot also be project-owned. Keep the legacy
		// standalone lane untouched; the Enterprise lane uses the schema owner.
		ownerProjectID = nil
	}
	result, err := a.enterpriseScopedWriteDB(ctx).ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, project_id, project_code, work_item_id, parent_id,
		   title, doc_category, is_folder, oss_path, codocs_uuid, content_size, created_by, updated_by)
		VALUES (?, ?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?)
	`, docUUID, ownerProjectID, target.ProjectCode, target.WorkItemID, title, nullableSQLString(docCategory), nullableSQLString(ossPath), linkedDocumentID, contentSize, uid, uid)
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
	return enterpriseScopedWorkItemWrite(a, ctx, rawWorkItemID, query, "work-item-document", func(ctx context.Context) (map[string]any, error) {
		return a.unlinkWorkItemDocumentBody(ctx, rawWorkItemID, rawDocumentID, query)
	}, legacyWorkItemReceiptConfig[map[string]any]{Action: "document-unlink", Capability: "aims:work-item-documents:edit", BizType: "work-item-document", Command: map[string]any{"workItemId": rawWorkItemID, "documentId": rawDocumentID}, BizCode: func(map[string]any) string { return rawDocumentID }, Replay: func(context.Context, string) (map[string]any, error) {
		return map[string]any{"deleted": true, "message": "已取消关联"}, nil
	}, Decorate: decorateLegacyWorkItemMap, BeforeReplay: func(ctx context.Context) error {
		target, err := a.workItemDocumentProject(ctx, rawWorkItemID)
		if err != nil {
			return err
		}
		return a.requireProjectManagerOrScopedAdmin(ctx, target.ProjectID, query.Get("current_user"), query)
	}})
}

func (a *Adapter) unlinkWorkItemDocumentBody(ctx context.Context, rawWorkItemID string, rawDocumentID string, query url.Values) (map[string]any, error) {
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

	folderClause := ""
	if _, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); enterprise {
		folderClause = " AND is_folder = 0"
	}
	result, err := a.enterpriseScopedWriteDB(ctx).ExecContext(ctx, `
		DELETE FROM project_documents
		WHERE work_item_id = ?`+folderClause+`
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
	err = a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, `
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

func (a *Adapter) workItemSourceDocument(ctx context.Context, documentID string, enterprise bool) (*workItemSourceDocument, error) {
	var source workItemSourceDocument
	ownerClause := ""
	if enterprise {
		ownerClause = " AND d.work_item_id IS NULL"
	}
	query := `
		SELECT d.uuid, d.project_id, COALESCE(p.project_code,d.project_code), d.document_source,
		       d.title, d.doc_category, d.oss_path, d.codocs_uuid, d.content_size
		FROM project_documents d
		LEFT JOIN aims_projects p ON p.id=d.project_id
		WHERE d.is_folder = 0` + ownerClause + `
		  AND (d.uuid = ? OR d.codocs_uuid = ?)
		ORDER BY CASE WHEN d.uuid = ? THEN 0 ELSE 1 END, d.id ASC
		LIMIT 1
	`
	if enterprise {
		query += " FOR UPDATE"
	}
	err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, query, documentID, documentID, documentID).Scan(
		&source.UUID,
		&source.ProjectID,
		&source.ProjectCode,
		&source.Source,
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

func (a *Adapter) workItemDocumentAccessFacts(ctx context.Context, source *workItemSourceDocument, actor string) (EnterpriseProjectDocumentAccessFacts, error) {
	facts := EnterpriseProjectDocumentAccessFacts{ActorUID: actor, ProjectCode: source.ProjectCode.String, Roles: []string{"employee"}}
	var leader, creator sql.NullString
	err := a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, "SELECT leader_uid,created_by FROM aims_projects WHERE id=?", source.ProjectID.Int64).Scan(&leader, &creator)
	if err != nil {
		return facts, err
	}
	var role sql.NullString
	err = a.enterpriseScopedWriteDB(ctx).QueryRowContext(ctx, "SELECT role FROM aims_project_members WHERE project_id=? AND uid=? AND status='active' LIMIT 1", source.ProjectID.Int64, actor).Scan(&role)
	if err != nil && err != sql.ErrNoRows {
		return facts, err
	}
	if leader.String == actor || creator.String == actor || role.String == "manager" {
		facts.Roles = []string{"project_manager"}
		facts.ProjectCodes = []string{source.ProjectCode.String}
	} else if role.Valid {
		facts.Roles = []string{"project_member"}
		facts.ProjectCodes = []string{source.ProjectCode.String}
	}
	return facts, nil
}
