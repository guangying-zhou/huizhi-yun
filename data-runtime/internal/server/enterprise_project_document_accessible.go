package server

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type enterpriseProjectDocumentPermit struct {
	enterpriseProjectProductPermit
	ProjectAdmin bool `json:"projectAdmin"`
}

type enterpriseProjectDocumentAccessibleInput struct {
	Tenant        string                          `json:"tenant"`
	Deployment    string                          `json:"deployment"`
	ProjectID     string                          `json:"projectId"`
	Authorization enterpriseProjectDocumentPermit `json:"authorization"`
}

func (s *Server) routeEnterpriseProjectDocumentAccessible(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil || s.codocs == nil || s.directory == nil {
		return routeResult{}, httperror.New(503, "enterprise_project_documents_unavailable", "Project document domains are unavailable")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-documents.accessible", Auth: &verified.Service}
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
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var in enterpriseProjectDocumentAccessibleInput
	if dec.Decode(&in) != nil || !enterpriseProjectProductID.MatchString(in.ProjectID) {
		return result, httperror.New(400, "project_document_input_invalid", "Invalid project document input")
	}
	if err = validateEnterpriseProjectProductPermit(enterpriseProjectProductInput{Tenant: in.Tenant, Deployment: in.Deployment, ProjectID: in.ProjectID}, in.Authorization.enterpriseProjectProductPermit, "view", verified, time.Now()); err != nil {
		return result, err
	}
	if err = verifyEnterpriseProjectDocumentPermitSignature(r, in.Authorization); err != nil {
		return result, err
	}
	// Directory facts are read by Runtime for the signed actor, never supplied by Host.
	directoryFacts, err := s.directory.EnterpriseDocumentAccessDepartments(r.Context(), verified.ActorUID)
	if err != nil {
		return result, projectDocumentDependencyError(err)
	}
	out, err := s.aims.ListEnterpriseAccessibleProjectDocuments(r.Context(), in.ProjectID, verified.ActorUID, directoryFacts.ManagementDeptCodes, in.Authorization.ProjectAdmin, func(ctx context.Context, uuid, ref string, f aimsapp.EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		return s.codocs.CheckEnterpriseProjectDocument(ctx, uuid, ref, codocsapp.EnterpriseProjectDocumentFacts{ActorUID: f.ActorUID, ProjectCode: f.ProjectCode, ProjectCodes: f.ProjectCodes, Roles: f.Roles, DeptCodes: directoryFacts.DeptCodes})
	})
	if err != nil {
		return result, projectDocumentDependencyError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}

func projectDocumentDependencyError(err error) error {
	var h httperror.Error
	if errors.As(err, &h) && (h.Status == 400 || h.Status == 401 || h.Status == 403 || h.Status == 404 || h.Status == 503) {
		return err
	}
	return httperror.New(503, "project_document_dependency_unavailable", "Project document dependency is unavailable")
}

// The actor signature does not cover body facts. This distinct token-bound
// signature covers every permit field, including the scoped admin decision.
func enterpriseProjectDocumentPermitCanonical(r *http.Request, p enterpriseProjectDocumentPermit) string {
	return strings.Join([]string{"hzy-enterprise-project-document-permit.v1", r.Method, r.URL.RequestURI(), p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.ProjectID, strconv.FormatBool(p.Allowed), strconv.FormatInt(p.ExpiresAt, 10), strconv.FormatBool(p.ProjectAdmin)}, "\n")
}
func verifyEnterpriseProjectDocumentPermitSignature(r *http.Request, p enterpriseProjectDocumentPermit) error {
	token := runtimeBearerToken(r)
	signature := r.Header.Get("X-HZY-Enterprise-Document-Permit-Signature")
	if token == "" || signature == "" {
		return httperror.New(403, "project_document_permit_signature_invalid", "Project document permit signature is required")
	}
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(enterpriseProjectDocumentPermitCanonical(r, p)))
	if !hmac.Equal([]byte(signature), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return httperror.New(403, "project_document_permit_signature_invalid", "Project document permit signature is invalid")
	}
	return nil
}
