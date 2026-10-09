package server

import (
	"bytes"
	"encoding/json"
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type enterpriseProjectDocumentContextInput struct {
	enterpriseProjectDocumentReadInput
	ProjectAdmin    bool                             `json:"projectAdmin"`
	RepoProjectCode string                           `json:"repoProjectCode"`
	DocumentUUID    string                           `json:"documentUuid"`
	AccessAction    string                           `json:"accessAction,omitempty"`
	RepositoryRead  *enterpriseProjectRepositoryRead `json:"repositoryRead,omitempty"`
}

var enterpriseRepositoryPathPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`)

// The decoded GitLab namespace/project path is matched byte-for-byte against the repository binding.
func validEnterpriseRepositoryPath(value string) bool {
	return len(value) <= 255 && !strings.Contains(value, "..") && enterpriseRepositoryPathPattern.MatchString(value)
}

func (s *Server) routeEnterpriseProjectDocumentContext(r *http.Request) (routeResult, error) {
	return s.projectDocumentContext(r, false)
}

func (s *Server) routeEnterpriseProjectDocumentAccessCheck(r *http.Request) (routeResult, error) {
	return s.projectDocumentContext(r, true)
}

func (s *Server) projectDocumentContext(r *http.Request, accessCheck bool, repositoryRead ...bool) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil || s.directory == nil {
		return routeResult{}, httperror.New(503, "project_document_context_unavailable", "Project document context unavailable")
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims"}, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-documents.context", Auth: &verified.Service}
	if accessCheck {
		result.Operation = "enterprise.aims.project-documents.access-check"
		if s.codocs == nil {
			return result, httperror.New(503, "project_document_dependency_unavailable", "Document access unavailable")
		}
	}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "project_document_input_invalid", "Query is not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var in enterpriseProjectDocumentContextInput
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if dec.Decode(&in) != nil || len(in.Query) != 0 {
		return result, httperror.New(400, "project_document_input_invalid", "Invalid context input")
	}
	repoRead := len(repositoryRead) == 1 && repositoryRead[0]
	if (!repoRead && in.RepositoryRead != nil) || (repoRead && !validProjectRepositoryReadInput(in)) || (!repoRead && !validProjectDocumentAccessInput(in, accessCheck)) {
		return result, httperror.New(400, "project_document_input_invalid", "Invalid document access input")
	}
	if err = validateEnterpriseProjectDocumentReadPermit(in.enterpriseProjectDocumentReadInput, verified, time.Now()); err != nil {
		return result, err
	}
	if err = requireEnterpriseDelegatedID(in.DocumentID, in.DocumentID != ""); err != nil {
		return result, err
	}
	if in.RepoProjectCode != "" && !validEnterpriseRepositoryPath(in.RepoProjectCode) {
		return result, httperror.New(400, "project_document_input_invalid", "Invalid repository code")
	}
	if in.DocumentUUID != "" && (!regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).MatchString(in.DocumentUUID) || in.DocumentUUID == "00000000-0000-0000-0000-000000000000" || in.DocumentID != "" || in.RepoProjectCode != "") {
		return result, httperror.New(400, "project_document_input_invalid", "Invalid document UUID")
	}
	_, q, err := enterpriseProjectDocumentReadTarget(in.enterpriseProjectDocumentReadInput, verified.ActorUID, in.DocumentID != "")
	if err != nil {
		return result, err
	}
	if in.ProjectAdmin {
		q.Set("current_user_is_project_admin", "1")
	}
	ctx, err := s.nestedProjectReadContext(r, in.ProjectID, in.ProjectReadAuthorization, q)
	if err != nil {
		return result, err
	}
	departments, err := s.directory.EnterpriseDocumentAccessDepartments(ctx, verified.ActorUID)
	if err != nil {
		return result, projectDocumentDependencyError(err)
	}
	out, err := s.aims.EnterpriseProjectDocumentContext(ctx, in.ProjectID, in.DocumentID, in.RepoProjectCode, verified.ActorUID, in.ProjectAdmin, departments.DeptCodes)
	if err == nil && in.DocumentUUID != "" {
		if out["isMember"] != true {
			return result, httperror.New(403, "project_document_member_required", "Project membership is required")
		}
		var title string
		title, err = s.aims.EnterpriseProjectDocumentUUIDTitle(ctx, in.ProjectID, in.DocumentUUID)
		if err == nil {
			out["title"] = title
			out["documentUuid"] = in.DocumentUUID
		}
	}
	if err == nil && accessCheck {
		text := func(key string) string { value, _ := out[key].(string); return value }
		list := func(key string) []string { value, _ := out[key].([]string); return value }
		facts := codocsapp.EnterpriseProjectDocumentFacts{ActorUID: verified.ActorUID, ProjectCode: text("projectCode"), ProjectCodes: list("actorProjectCodes"), DeptCodes: departments.DeptCodes, Roles: list("actorRoles")}
		if out["repositoryReference"] == true {
			out, err = s.codocs.CheckEnterpriseRepositoryProjectDocument(ctx, text("documentUuid"), in.AccessAction, facts)
		} else {
			out, err = s.codocs.CheckEnterpriseProjectDocumentAction(ctx, text("documentUuid"), text("documentRefType"), in.AccessAction, facts)
		}
		if err != nil {
			err = projectDocumentDependencyError(err)
		}
	}
	if err == nil && repoRead {
		result.Operation = "enterprise.aims.project-documents.repository-read"
		out, err = s.readProjectRepositoryDocument(ctx, in, out, verified.ActorUID, departments.DeptCodes)
		if err == nil {
			err = validateEnterpriseProjectDocumentReadPermit(in.enterpriseProjectDocumentReadInput, verified, time.Now())
		}
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}

func (s *Server) routeEnterpriseProjectDocumentDepartmentSource(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.directory == nil {
		return routeResult{}, httperror.New(503, "project_document_source_unavailable", "Department source unavailable")
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims"}, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-documents.department-source", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "project_document_input_invalid", "Query is not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var in struct {
		Tenant        string                    `json:"tenant"`
		Deployment    string                    `json:"deployment"`
		DeptCode      string                    `json:"deptCode"`
		Authorization enterpriseDelegatedPermit `json:"authorization"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if dec.Decode(&in) != nil || !regexp.MustCompile(`^[A-Za-z0-9._-]{1,120}$`).MatchString(in.DeptCode) {
		return result, httperror.New(400, "project_document_input_invalid", "Invalid department source")
	}
	if err = validateEnterpriseDelegatedPermit(enterpriseDelegatedInput{Tenant: in.Tenant, Deployment: in.Deployment, Authorization: in.Authorization}, verified, enterpriseDelegatedSpec{Domain: "aims", Resource: "projects", ErrorCode: "project_document"}, enterpriseDelegatedAction{PermitAction: "view"}, time.Now()); err != nil {
		return result, err
	}
	rows, err := s.directory.ConsoleAccessibleDepartments(r.Context(), verified.ActorUID)
	if err != nil {
		return result, projectDocumentDependencyError(err)
	}
	for _, row := range rows {
		if row["deptCode"] == in.DeptCode {
			result.Body = map[string]any{"code": 0, "data": map[string]any{"deptCode": in.DeptCode}}
			return result, nil
		}
	}
	return result, httperror.New(403, "project_document_department_denied", "Department access denied")
}

func validProjectDocumentAccessInput(in enterpriseProjectDocumentContextInput, accessCheck bool) bool {
	if !accessCheck {
		return in.AccessAction == ""
	}
	return in.DocumentID != "" && in.RepoProjectCode == "" && in.DocumentUUID == "" && (in.AccessAction == "view" || in.AccessAction == "download" || in.AccessAction == "edit")
}
