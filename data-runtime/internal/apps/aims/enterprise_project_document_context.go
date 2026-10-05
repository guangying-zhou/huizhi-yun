package aims

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

// Runtime owns these relationship facts. Host may only supply a signed scoped
// admin decision for this exact project, never membership or document ownership.
func (a *Adapter) EnterpriseProjectDocumentContext(ctx context.Context, projectID, documentID, repo, actor string, projectAdmin bool, departments []string) (map[string]any, error) {
	q := url.Values{"current_user": {actor}, "operator_uid": {actor}}
	if projectAdmin {
		q.Set("current_user_is_project_admin", "1")
	}
	if err := a.requireProjectReadAccess(ctx, projectID, q); err != nil {
		return nil, err
	}
	pid, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	p, err := a.projectDocumentProject(ctx, pid)
	if err != nil {
		return nil, err
	}
	project, _, err := a.HandleRuntime(ctx, http.MethodGet, "/v1/aims/projects/"+projectID, q, nil)
	if err != nil {
		return nil, err
	}
	var role string
	err = a.DB().QueryRowContext(ctx, "SELECT role FROM aims_project_members WHERE project_id=? AND BINARY uid=BINARY ? AND status='active'", pid, actor).Scan(&role)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	manager := projectAdmin || p.LeaderUID.String == actor || p.CreatedBy == actor || role == "manager"
	member := manager || role != ""
	roles := []string{"employee"}
	if manager {
		roles = []string{"project_manager"}
	} else if member {
		roles = []string{"project_member"}
	}
	where, args := projectVisibilityWhere(url.Values{"current_user": {actor}}, "p", actor)
	if scope, values, e := enterpriseProjectReadScopeWhere(ctx, actor); e != nil {
		return nil, e
	} else if scope != "" {
		where = "(" + where + ") AND (" + scope + ")"
		args = append(args, values...)
	}
	rows, err := a.DB().QueryContext(ctx, "SELECT p.project_code FROM aims_projects p WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	codes := []string{}
	for rows.Next() {
		var code string
		if err = rows.Scan(&code); err != nil {
			rows.Close()
			return nil, err
		}
		codes = append(codes, code)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if member {
		found := false
		for _, c := range codes {
			found = found || c == p.ProjectCode
		}
		if !found {
			codes = append(codes, p.ProjectCode)
		}
	}
	projectMap, _ := project.(map[string]any)
	out := map[string]any{"project": projectMap["data"], "projectCode": p.ProjectCode, "deptCode": p.DeptCode.String, "isMember": member, "isManager": manager, "isScopedProjectAdmin": projectAdmin, "actorProjectCodes": codes, "actorDeptCodes": departments, "actorRoles": roles}
	if documentID != "" {
		actual, e := a.ResolveEnterpriseProjectDocumentOwner(ctx, nil, documentID)
		if e != nil {
			return nil, e
		}
		if actual != projectID {
			return nil, httperror.New(404, "project_document_not_found", "Project document not found")
		}
		document, _, e := a.HandleRuntime(ctx, http.MethodGet, "/v1/aims/documents/"+documentID, q, nil)
		if e != nil {
			return nil, e
		}
		envelope, _ := document.(map[string]any)
		doc, _ := envelope["data"].(map[string]any)
		if doc == nil {
			return nil, httperror.New(503, "project_document_context_unavailable", "Document context unavailable")
		}
		out["document"] = doc
		out["documentId"] = documentID
		source := firstBodyText(doc, "documentSource", "document_source")
		ref := "codocs_document"
		uuid := firstBodyText(doc, "codocsUuid", "codocs_uuid", "uuid")
		if source != "" && source != "codocs" {
			ref = "cabinet_file"
			uuid = firstBodyText(doc, "uuid")
		}
		if uuid == "" {
			return nil, httperror.New(400, "project_document_uuid_missing", "Document UUID is missing")
		}
		out["documentRefType"] = ref
		out["documentUuid"] = uuid
	}
	if repo != "" {
		if !member {
			return nil, httperror.New(403, "project_repository_denied", "Project membership is required")
		}
		var count int
		if err = a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_repos WHERE project_id=? AND BINARY repo_project_code=BINARY ?", pid, repo).Scan(&count); err != nil {
			return nil, err
		}
		if count != 1 {
			return nil, httperror.New(403, "project_repository_mismatch", "Repository is not linked to the project")
		}
	}
	source, e := a.projectCodocsDocumentsContext(ctx, projectID, q)
	if e != nil {
		return nil, e
	}
	out["gitGroup"] = source["gitGroup"]
	out["projectId"] = fmt.Sprint(pid)
	return out, nil
}
