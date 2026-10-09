package aims

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/documentcatalog"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"time"
)

// Context installed exclusively by the fixed Enterprise document command.
// The independent Aims adapter retains its original owner semantics.
type enterpriseDocumentTxKey struct{}
type enterpriseDocumentReadKey struct{}
type documentExecutor interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func (a *Adapter) documentDB(ctx context.Context) documentExecutor {
	if tx, ok := ctx.Value(enterpriseDocumentTxKey{}).(*sql.Tx); ok {
		return tx
	}
	return a.DB()
}
func requireEnterpriseDocumentProjectOwner(owner directDocumentOwnerContext) error {
	if owner.ProjectID == nil || *owner.ProjectID <= 0 {
		return httperror.New(409, "project_document_portfolio_owner_unsupported", "Portfolio-only project documents are not supported by the Host")
	}
	return nil
}

// Preflight returns only the authoritative owning project. No Codocs request or
// mutation may occur until this succeeds; writes resolve and recheck it again.
func (a *Adapter) checkEnterpriseDocumentParent(ctx context.Context, parentID int64) error {
	parent, err := a.directDocumentParentOwnerContext(ctx, parentID)
	if err != nil {
		return err
	}
	if parent.PortfolioID != nil && parent.ProjectID == nil && parent.MilestoneID == nil && parent.WorkItemID == nil {
		return requireEnterpriseDocumentProjectOwner(parent)
	}
	parent, err = a.resolveDirectDocumentProjectContext(ctx, parent)
	if err != nil {
		return err
	}
	return requireEnterpriseDocumentProjectOwner(parent)
}

func (a *Adapter) ResolveEnterpriseProjectDocumentOwner(ctx context.Context, body map[string]any, documentID string) (string, error) {
	var owner directDocumentOwnerContext
	var err error
	if documentID != "" {
		id, e := parseID(documentID, "document_id")
		if e != nil {
			return "", e
		}
		row, e := aimsQueryOneMap(ctx, a.documentDB(ctx), "SELECT portfolio_id,project_id,milestone_id,work_item_id,project_code,parent_id FROM project_documents WHERE id=?", id)
		if e != nil {
			return "", e
		}
		if row == nil {
			return "", httperror.New(404, "project_document_not_found", "Project document not found")
		}
		// Persisted milestone/work-item rows also store their derived project_id.
		// The most specific authoritative owner is the command input; never
		// treat this redundant storage as two caller-supplied owners.
		normalized := map[string]any{}
		for _, key := range []string{"work_item_id", "milestone_id", "project_id", "portfolio_id"} {
			if int64BodyValue(row, key) > 0 {
				normalized[key] = row[key]
				break
			}
		}
		if int64BodyValue(row, "parent_id") > 0 {
			normalized["parent_id"] = row["parent_id"]
		}
		if parentID := int64BodyValue(normalized, "parent_id"); parentID > 0 {
			if e := a.checkEnterpriseDocumentParent(ctx, parentID); e != nil {
				return "", e
			}
		}
		owner, _, err = a.resolveDirectDocumentOwnerContext(ctx, normalized)
	} else {
		if parentID, has, e := optionalBodyID(body, "parent_id", "parentId"); e != nil {
			return "", e
		} else if has && parentID > 0 {
			if e = a.checkEnterpriseDocumentParent(ctx, parentID); e != nil {
				return "", e
			}
		}
		owner, _, err = a.resolveDirectDocumentOwnerContext(ctx, body)
	}
	if err != nil {
		return "", err
	}
	if owner.ProjectID == nil && (owner.MilestoneID != nil || owner.WorkItemID != nil) {
		owner, err = a.resolveDirectDocumentProjectContext(ctx, owner)
		if err != nil {
			return "", err
		}
	}
	if err = requireEnterpriseDocumentProjectOwner(owner); err != nil {
		return "", err
	}
	return fmt.Sprint(*owner.ProjectID), nil
}

func (a *Adapter) WriteEnterpriseProjectDocument(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID, documentID, action string, payload map[string]any, projectAdmin bool) (map[string]any, error) {
	if identity.CommandScope == nil || identity.ActorUID == "" {
		return nil, httperror.New(403, "enterprise_project_command_scope_invalid", "Project authorization is required")
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ctx = context.WithValue(ctx, enterpriseDocumentTxKey{}, tx)
	actual, err := a.ResolveEnterpriseProjectDocumentOwner(ctx, payload, documentID)
	if err != nil {
		return nil, err
	}
	if actual != projectID {
		return nil, httperror.New(403, "project_document_owner_mismatch", "Project document owner changed")
	}
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, projectID, "", "project-document"); err != nil {
		return nil, err
	}
	var leader, creator, role, projectCode string
	err = tx.QueryRowContext(ctx, "SELECT COALESCE(leader_uid,''),COALESCE(created_by,''),project_code FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&leader, &creator, &projectCode)
	if err != nil {
		return nil, err
	}
	err = tx.QueryRowContext(ctx, "SELECT role FROM aims_project_members WHERE project_id=? AND BINARY uid=BINARY ? AND status='active' FOR UPDATE", projectID, identity.ActorUID).Scan(&role)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	manager := projectAdmin || leader == identity.ActorUID || creator == identity.ActorUID || role == "manager"
	member := manager || role != ""
	q := url.Values{"current_user": {identity.ActorUID}, "operator_uid": {identity.ActorUID}}
	if projectAdmin {
		q.Set("current_user_is_project_admin", "1")
	}
	var out map[string]any
	switch action {
	case "create":
		if !member {
			return nil, httperror.New(403, "project_document_write_denied", "Project membership is required")
		}
		payload = enterpriseProjectDocumentCreationPayload(payload)
		out, err = a.createDirectDocument(ctx, q, payload)
	case "summary":
		if !manager {
			return nil, httperror.New(403, "project_document_manager_required", "Project management is required")
		}
		for key, value := range payload {
			if key != "accessLifecycleStage" && key != "accessConfidentialityLevel" && key != "accessSummary" {
				return nil, httperror.New(400, "project_document_input_invalid", "Unsupported document summary field")
			}
			if _, ok := value.(string); !ok {
				return nil, httperror.New(400, "project_document_input_invalid", "Invalid document summary field")
			}
		}
		if len(payload) != 3 {
			return nil, httperror.New(400, "project_document_input_invalid", "Document summary fields are required")
		}
		stage := payload["accessLifecycleStage"].(string)
		level := payload["accessConfidentialityLevel"].(string)
		if (stage != "draft" && stage != "formal" && stage != "archived") || (level != "L0" && level != "L1" && level != "L2" && level != "L3") {
			return nil, httperror.New(400, "project_document_input_invalid", "Invalid document summary field")
		}
		_, err = tx.ExecContext(ctx, "UPDATE project_documents SET access_lifecycle_stage=?,access_confidentiality_level=?,access_summary=?,updated_by=? WHERE id=?", payload["accessLifecycleStage"], payload["accessConfidentialityLevel"], payload["accessSummary"], identity.ActorUID, documentID)
		out = map[string]any{"id": documentID}
	case "delete":
		var creator string
		var folder int
		err = tx.QueryRowContext(ctx, "SELECT created_by,is_folder FROM project_documents WHERE id=? FOR UPDATE", documentID).Scan(&creator, &folder)
		if err != nil {
			return nil, err
		}
		if !manager && (folder != 0 || creator != identity.ActorUID) {
			return nil, httperror.New(403, "project_document_delete_denied", "Only the project manager or uploader can delete the document")
		}
		if err = a.deleteProjectDocumentReferenceTree(ctx, tx, documentID, projectID); err != nil {
			return nil, err
		}
		out = map[string]any{"id": documentID}

	default:
		return nil, httperror.New(400, "project_document_action_invalid", "Invalid project document action")
	}
	if err != nil {
		return nil, err
	}
	if identity.CommandScope.ExpiresAt <= time.Now().UnixMilli() {
		return nil, httperror.New(403, "enterprise_project_command_scope_expired", "Project authorization expired")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	// Reconcile this project's repository documents, so that a deleted folder
	// subtree is reflected as well.
	a.syncDocumentCatalog(catalogKindRepoDocument, documentcatalog.Filter{OwnerType: "project", OwnerCode: projectCode})
	return out, nil
}

func (a *Adapter) CheckEnterpriseProjectDocumentOwner(ctx context.Context, identity EnterpriseProjectUpdateIdentity, payload map[string]any, documentID string) (string, error) {
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	ctx = context.WithValue(ctx, enterpriseDocumentTxKey{}, tx)
	project, err := a.ResolveEnterpriseProjectDocumentOwner(ctx, payload, documentID)
	if err != nil {
		return "", err
	}
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, project, "", "project-document"); err != nil {
		return "", err
	}
	return project, nil
}

// Only a validated owning-server context can supply the command identity.
func (a *Adapter) ExecuteEnterpriseProjectDocument(ctx context.Context, projectID, documentID, action string, payload map[string]any, projectAdmin bool) (map[string]any, error) {
	identity, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || identity.CommandScope == nil {
		return nil, httperror.New(403, "enterprise_project_command_scope_invalid", "Project authorization is required")
	}
	if action == "owner" {
		id, err := a.CheckEnterpriseProjectDocumentOwner(ctx, identity, payload, documentID)
		return map[string]any{"projectId": id}, err
	}
	return a.WriteEnterpriseProjectDocument(ctx, identity, projectID, documentID, action, payload, projectAdmin)
}

func enterpriseProjectDocumentCreationPayload(payload map[string]any) map[string]any {
	// Host create-index uses uuid (also for folders), not codocsUuid.
	// Match the canonical NOT NULL DEFAULT 'codocs' source without
	// changing independent Aims normalization or mutating caller input.
	if firstBodyText(payload, "uuid") != "" && firstBodyText(payload, "document_source", "documentSource", "source") == "" && normalizeDocumentSource(payload) == "" {
		copyPayload := make(map[string]any, len(payload)+1)
		for key, value := range payload {
			copyPayload[key] = value
		}
		copyPayload["documentSource"] = "codocs"
		payload = copyPayload
	}
	return payload
}

// Empty directory descendants can be removed, but documents must be moved first.
// This never deletes any Codocs rows or attachment objects.
func (a *Adapter) deleteProjectDocumentReferenceTree(ctx context.Context, tx *sql.Tx, documentID, projectID string) error {
	// Verify every descendant before deleting any row; never delegate an
	// unchecked owning-project boundary to a database cascade.
	ids := []string{documentID}
	for cursor := 0; cursor < len(ids); cursor++ {
		if len(ids) > 1000 {
			return httperror.New(503, "project_document_tree_limit", "Document tree exceeds the verification limit")
		}
		rows, e := tx.QueryContext(ctx, "SELECT id,is_folder FROM project_documents WHERE parent_id=? ORDER BY id FOR UPDATE", ids[cursor])
		if e != nil {
			return e
		}
		for rows.Next() {
			var id string
			var childFolder int
			if e = rows.Scan(&id, &childFolder); e != nil {
				rows.Close()
				return e
			}
			if childFolder == 0 {
				rows.Close()
				return httperror.New(409, "project_document_folder_not_empty", "Move or remove document references before deleting this folder")
			}
			for _, seen := range ids {
				if seen == id {
					rows.Close()
					return httperror.New(409, "project_document_tree_invalid", "Document tree contains a cycle")
				}
			}
			ids = append(ids, id)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
	}
	for _, id := range ids {
		actual, e := a.ResolveEnterpriseProjectDocumentOwner(ctx, nil, id)
		if e != nil {
			return e
		}
		if actual != projectID {
			return httperror.New(403, "project_document_owner_mismatch", "A descendant belongs to another project")
		}
	}
	for i := len(ids) - 1; i >= 0; i-- {
		if _, err := tx.ExecContext(ctx, "DELETE FROM project_documents WHERE id=?", ids[i]); err != nil {
			return err
		}
	}
	return nil
}
