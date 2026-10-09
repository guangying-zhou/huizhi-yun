package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const enterpriseProjectDocumentListPath = "/v1/enterprise/aims/project-documents:list"
const enterpriseProjectDocumentViewPath = "/v1/enterprise/aims/project-documents:view"

type enterpriseProjectDocumentReadPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type enterpriseProjectDocumentReadInput struct {
	Tenant                   string                              `json:"tenant"`
	Deployment               string                              `json:"deployment"`
	DocumentID               string                              `json:"documentId"`
	ProjectID                string                              `json:"projectId"`
	ProjectScopeQuery        map[string]string                   `json:"projectScopeQuery"`
	Query                    map[string]string                   `json:"query"`
	Authorization            enterpriseProjectDocumentReadPermit `json:"authorization"`
	ProjectReadAuthorization *enterpriseNestedProjectReadPermit  `json:"projectReadAuthorization"`
}

func (s *Server) routeEnterpriseProjectDocumentRead(r *http.Request, detail bool) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(http.StatusServiceUnavailable, "enterprise_project_documents_unavailable", "Unified project document reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"],
		LogicalSource:  "aims", LogicalTarget: "aims",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project_documents.list", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(http.StatusBadRequest, "enterprise_project_document_input_invalid", "Query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	input, err := decodeEnterpriseProjectDocumentReadInput(body)
	if err != nil {
		return result, err
	}
	if err = validateEnterpriseProjectDocumentReadPermit(input, verified, time.Now()); err != nil {
		return result, err
	}
	path, query, err := enterpriseProjectDocumentReadTarget(input, verified.ActorUID, detail)
	if err != nil {
		return result, err
	}
	ctx, err := s.nestedProjectReadContext(r, input.ProjectID, input.ProjectReadAuthorization, query)
	if err != nil {
		return result, err
	}
	out, operation, err := s.aims.HandleRuntime(ctx, http.MethodGet, path, query, map[string]any{})
	if operation != "" {
		result.Operation = "enterprise." + operation
	}
	result.Body = out
	return result, err
}

func decodeEnterpriseProjectDocumentReadInput(body map[string]any) (enterpriseProjectDocumentReadInput, error) {
	var input enterpriseProjectDocumentReadInput
	raw, err := json.Marshal(body)
	if err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_project_document_input_invalid", "Invalid project document read input")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, httperror.New(http.StatusBadRequest, "enterprise_project_document_input_invalid", "Invalid project document read input")
	}
	return input, nil
}

func validateEnterpriseProjectDocumentReadPermit(input enterpriseProjectDocumentReadInput, verified enterpriseRequestContext, now time.Time) error {
	permit := input.Authorization
	if input.Tenant != verified.Route.Binding.Tenant || input.Deployment != verified.Route.HostDeployment ||
		permit.Tenant != input.Tenant || permit.Deployment != input.Deployment || permit.ActorUID != verified.ActorUID ||
		permit.Resource != "projects" || permit.Action != "view" || permit.ExpiresAt <= now.UnixMilli() ||
		permit.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(http.StatusForbidden, "enterprise_project_document_permit_invalid", "Project document read authorization is invalid")
	}
	return validateNestedProjectReadPermit(input.Tenant, input.Deployment, input.ProjectID, input.ProjectReadAuthorization, verified, now)
}

func enterpriseProjectDocumentReadTarget(input enterpriseProjectDocumentReadInput, actorUID string, detail bool) (string, url.Values, error) {
	if !enterpriseTimeEntryID.MatchString(input.ProjectID) {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_document_input_invalid", "Project ID is invalid")
	}
	if _, err := strconv.ParseInt(input.ProjectID, 10, 64); err != nil {
		return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_document_input_invalid", "Project ID is invalid")
	}
	query := url.Values{}
	for key, value := range input.Query {
		if value == "" || len(value) > 1000 {
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_document_input_invalid", "Project document read query is invalid")
		}
		switch key {
		case "docCategory":
			query.Set(key, value)
		default:
			return "", nil, httperror.New(http.StatusBadRequest, "enterprise_project_document_input_invalid", "Project document read query is invalid")
		}
	}
	for key, value := range input.ProjectScopeQuery {
		if !enterpriseProjectScopeKey.MatchString(key) || value == "" || len(value) > 1000 {
			return "", nil, httperror.New(400, "enterprise_project_document_input_invalid", "Invalid project scope context")
		}
		query.Set(key, value)
	}
	query.Set("current_user", actorUID)
	query.Set("operator_uid", actorUID)
	path := "/v1/aims/projects/" + input.ProjectID + "/documents"
	if detail {
		if err := requireEnterpriseDelegatedID(input.DocumentID, true); err != nil || len(input.Query) != 0 {
			return "", nil, httperror.New(400, "enterprise_project_document_input_invalid", "Invalid document detail input")
		}
		path += "/" + input.DocumentID
	} else if input.DocumentID != "" {
		return "", nil, httperror.New(400, "enterprise_project_document_input_invalid", "Unexpected document ID")
	}
	return path, query, nil
}
