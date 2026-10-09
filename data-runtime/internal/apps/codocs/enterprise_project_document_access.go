package codocs

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Runtime-only typed facts. No Service API route exposes this adapter method;
// callers must select candidates and derive these facts in the owning domain.
type EnterpriseProjectDocumentFacts struct {
	ActorUID     string
	ProjectCode  string
	ProjectCodes []string
	DeptCodes    []string
	Roles        []string
}

func (a *Adapter) CheckEnterpriseProjectDocument(ctx context.Context, uuid, refType string, f EnterpriseProjectDocumentFacts) (map[string]any, error) {
	return a.CheckEnterpriseProjectDocumentAction(ctx, uuid, refType, "view", f)
}

// Only owning Runtime orchestration may provide domain-derived actor facts.
func (a *Adapter) CheckEnterpriseProjectDocumentAction(ctx context.Context, uuid, refType, action string, f EnterpriseProjectDocumentFacts) (map[string]any, error) {
	if (action != "view" && action != "download" && action != "edit") || f.ActorUID == "" || f.ProjectCode == "" || (refType != "codocs_document" && refType != "cabinet_file") || !isValidDocumentUUID(uuid) {
		return nil, httperror.New(400, "project_document_acl_input_invalid", "Invalid internal document access context")
	}
	// Missing/deleted references are omitted, even if a policy survives the doc.
	var err error
	if refType == "codocs_document" {
		_, err = a.documentByUUID(ctx, uuid, false)
	} else {
		var id int64
		err = a.db.QueryRowContext(ctx, "SELECT id FROM cabinet_files WHERE uuid = ? AND status = 1 AND deleted_at IS NULL", uuid).Scan(&id)
	}
	if err != nil {
		var h httperror.Error
		if errors.Is(err, sql.ErrNoRows) || (errors.As(err, &h) && h.Status == 404) {
			return resultToMap(documentAccessCheckResult{Permission: "none", Readonly: true, Reason: "document_not_found"}), nil
		}
		return nil, err
	}
	return a.documentAccessCheckWithFacts(ctx, map[string]any{"documentUuid": uuid, "documentRefType": refType, "sourceApp": "aims", "sourceProjectCode": f.ProjectCode, "action": action}, f.ActorUID, f.DeptCodes, f.ProjectCodes, f.Roles)
}

// Repository references use the cabinet policy namespace, but are not cabinet
// entities. The Aims owning adapter must first verify document/project ownership,
// active project membership and the exact repository binding.
func (a *Adapter) CheckEnterpriseRepositoryProjectDocument(ctx context.Context, uuid, action string, f EnterpriseProjectDocumentFacts) (map[string]any, error) {
	if (action != "view" && action != "download" && action != "edit") || f.ActorUID == "" || f.ProjectCode == "" || !isValidDocumentUUID(uuid) {
		return nil, httperror.New(400, "project_document_acl_input_invalid", "Invalid internal document access context")
	}
	return a.documentAccessCheckWithFacts(ctx, map[string]any{"documentUuid": uuid, "documentRefType": "cabinet_file", "sourceApp": "aims", "sourceProjectCode": f.ProjectCode, "action": action}, f.ActorUID, f.DeptCodes, f.ProjectCodes, f.Roles)
}
