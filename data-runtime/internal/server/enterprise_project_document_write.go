package server

import (
	"bytes"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var enterpriseProjectDocumentWritePaths = map[string]string{
	"/v1/enterprise/aims/project-documents:owner":   "owner",
	"/v1/enterprise/aims/project-documents:create":  "create",
	"/v1/enterprise/aims/project-documents:summary": "summary",
	"/v1/enterprise/aims/project-documents:delete":  "delete",
}

type enterpriseProjectDocumentWriteInput struct {
	enterpriseDelegatedInput
	ProjectAdmin bool `json:"projectAdmin"`
}

func (s *Server) routeEnterpriseProjectDocumentWrite(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_documents_unavailable", "Project documents unavailable")
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims"}, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-documents." + action, Auth: &verified.Service}
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
	var in enterpriseProjectDocumentWriteInput
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if dec.Decode(&in) != nil || len(in.Query) != 0 || in.Code != "" || in.SubID != "" || in.WeeklyReportSubmitAuthorization != nil {
		return result, httperror.New(400, "project_document_input_invalid", "Invalid document input")
	}
	spec := enterpriseDelegatedSpec{Domain: "aims", Resource: "projects", ErrorCode: "project_document"}
	act := enterpriseDelegatedAction{ScopeResource: "projects", ScopeAction: "edit", PermitAction: "edit"}
	if err = validateEnterpriseDelegatedPermit(in.enterpriseDelegatedInput, verified, spec, act, time.Now()); err != nil {
		return result, err
	}
	if action == "owner" {
		if in.ProjectID != "" || (in.ObjectID != "" && len(in.Payload) != 0) {
			return result, httperror.New(400, "project_document_input_invalid", "Invalid owner lookup")
		}
	} else if err = requireEnterpriseDelegatedID(in.ProjectID, true); err != nil {
		return result, err
	}
	if action == "create" || action == "owner" {
		if err = validateEnterpriseProjectDocumentCreationPayload(in.Payload, action == "create"); err != nil {
			return result, err
		}
	}
	if action == "create" && in.ObjectID != "" {
		return result, httperror.New(400, "project_document_input_invalid", "Unexpected document ID")
	}
	if action == "summary" || action == "delete" || in.ObjectID != "" {
		if err = requireEnterpriseDelegatedID(in.ObjectID, true); err != nil {
			return result, err
		}
	}
	if action == "delete" && len(in.Payload) != 0 {
		return result, httperror.New(400, "project_document_input_invalid", "Delete payload is not supported")
	}
	ctx, err := s.delegatedProjectWriteContext(r, in.enterpriseDelegatedInput, verified, act, nil)
	if err != nil {
		return result, err
	}
	out, err := s.aims.ExecuteEnterpriseProjectDocument(ctx, in.ProjectID, in.ObjectID, action, in.Payload, in.ProjectAdmin)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}

var enterpriseDocumentUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func validateEnterpriseProjectDocumentCreationPayload(payload map[string]any, create bool) error {
	allowed := map[string]bool{}
	for _, key := range []string{"uuid", "title", "portfolio_id", "portfolioId", "project_id", "projectId", "project_code", "projectCode", "milestone_id", "milestoneId", "work_item_id", "workItemId", "parent_id", "parentId", "doc_category", "docCategory", "is_folder", "isFolder", "oss_path", "ossPath", "codocs_uuid", "codocsUuid", "document_source", "documentSource", "repo_project_code", "repoProjectCode", "repo_file_path", "repoFilePath", "repo_commit_id", "repoCommitId", "content_size", "contentSize"} {
		allowed[key] = true
	}
	for key := range payload {
		if !allowed[key] {
			return httperror.New(400, "project_document_input_invalid", "Unsupported document field")
		}
	}
	if create {
		uuid, ok := payload["uuid"].(string)
		title, titleOK := payload["title"].(string)
		if !ok || !enterpriseDocumentUUID.MatchString(uuid) || !titleOK || strings.TrimSpace(title) == "" {
			return httperror.New(400, "project_document_input_invalid", "Document UUID and title are required")
		}
	}
	return nil
}
