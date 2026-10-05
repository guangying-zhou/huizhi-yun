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
	if f.ActorUID == "" || f.ProjectCode == "" || refType != "codocs_document" || !isValidDocumentUUID(uuid) {
		return nil, httperror.New(400, "project_document_acl_input_invalid", "Invalid internal document access context")
	}
	// Missing/deleted references are omitted, even if a policy survives the doc.
	if _, err := a.documentByUUID(ctx, uuid, false); err != nil {
		var h httperror.Error
		if errors.Is(err, sql.ErrNoRows) || (errors.As(err, &h) && h.Status == 404) {
			return map[string]any{"allowed": false}, nil
		}
		return nil, err
	}
	return a.documentAccessCheckWithFacts(ctx, map[string]any{"documentUuid": uuid, "documentRefType": refType, "sourceApp": "aims", "sourceProjectCode": f.ProjectCode, "action": "view"}, f.ActorUID, f.DeptCodes, f.ProjectCodes, f.Roles)
}
