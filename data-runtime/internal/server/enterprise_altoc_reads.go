package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseAltocReadSpec struct{ Resource, Action string }

var enterpriseAltocReadPaths = map[string]enterpriseAltocReadSpec{
	"/v1/enterprise/altoc/customers:list":        {"customer", "list"},
	"/v1/enterprise/altoc/customers:view":        {"customer", "view"},
	"/v1/enterprise/altoc/contracts:list":        {"contract", "list"},
	"/v1/enterprise/altoc/contracts:view":        {"contract", "view"},
	"/v1/enterprise/altoc/receivable-plans:list": {"receivable", "list"},
	"/v1/enterprise/altoc/receivable-plans:view": {"receivable", "view"},
}

type enterpriseAltocReadPermit struct {
	ActorUID       string               `json:"actorUid"`
	Tenant         string               `json:"tenant"`
	Deployment     string               `json:"deployment"`
	Resource       string               `json:"resource"`
	Action         string               `json:"action"`
	Operation      string               `json:"operation"`
	ObjectID       string               `json:"objectId"`
	ExpiresAt      int64                `json:"expiresAt"`
	Allowed        bool                 `json:"allowed"`
	Scope          altoc.BasicReadScope `json:"scope"`
	Query          altoc.BasicReadQuery `json:"query"`
	BundleVersion  string               `json:"bundleVersion"`
	BundleHash     string               `json:"bundleHash"`
	PolicyRevision *int64               `json:"policyRevision"`
}
type enterpriseAltocReadInput struct {
	ID            string                    `json:"id"`
	Query         altoc.BasicReadQuery      `json:"query"`
	Authorization enterpriseAltocReadPermit `json:"authorization"`
}

func validateEnterpriseAltocReadPermit(input enterpriseAltocReadInput, spec enterpriseAltocReadSpec, verified enterpriseRequestContext, now time.Time) error {
	p := input.Authorization
	if p.ActorUID != verified.ActorUID || p.Tenant != verified.Route.Binding.Tenant || p.Deployment != verified.Route.HostDeployment || p.Resource != spec.Resource || p.Action != "view" || p.Operation != spec.Action || p.ObjectID != input.ID || p.Query != input.Query || !p.Allowed || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_altoc_permit_invalid", "Altoc read authorization is invalid")
	}
	if err := p.Scope.Validate(); err != nil {
		return err
	}
	if spec.Action == "list" && input.ID != "" || spec.Action == "view" && input.ID == "" {
		return httperror.New(400, "enterprise_altoc_input_invalid", "Invalid Altoc read object")
	}
	if spec.Action == "view" && (input.Query.Search != "" || input.Query.Status != "" || input.Query.CustomerID != "" || input.Query.ContractID != "") {
		return httperror.New(400, "enterprise_altoc_input_invalid", "Altoc detail does not accept filters")
	}
	return input.Query.Validate(spec.Resource)
}
func (s *Server) routeEnterpriseAltocRead(r *http.Request, spec enterpriseAltocReadSpec) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["altoc"].Read != enterprise.PathUnified {
		return routeResult{}, httperror.New(503, "enterprise_altoc_unavailable", "Altoc reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "altoc", LogicalTarget: "altoc"}
	verified, err := authenticateEnterpriseAltocRead(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.altoc." + spec.Resource + "." + spec.Action, Auth: &verified.Service}
	if s.enterpriseAltocReads == nil {
		return result, httperror.New(503, "enterprise_altoc_unavailable", "Altoc reads are not ready")
	}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_altoc_input_invalid", "URL query is not accepted")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseAltocReadInput
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_altoc_input_invalid", "Invalid Altoc read input")
	}
	if err = validateEnterpriseAltocReadPermit(input, spec, verified, time.Now()); err != nil {
		return result, err
	}
	if err = verifyEnterpriseAltocReadPermitSignature(r, input.Authorization); err != nil {
		return result, err
	}
	data, err := s.enterpriseAltocReads.Read(r.Context(), spec.Resource, input.ID, verified.ActorUID, input.Authorization.Scope, input.Query)
	if err != nil {
		var known httperror.Error
		if errors.As(err, &known) {
			return result, err
		}
		return result, httperror.New(503, "enterprise_altoc_read_failed", "Altoc read service is unavailable")
	}
	result.Body = map[string]any{"code": 0, "message": "ok", "data": data}
	return result, nil
}

// Keep invalid transport identities forbidden at this capability boundary.
func authenticateEnterpriseAltocRead(r *http.Request, authenticator *auth.Authenticator, route enterpriseRouteContext, verify enterpriseCredentialVerifier) (enterpriseRequestContext, error) {
	verified, err := authenticateEnterpriseRequest(r, authenticator, route, verify)
	var failure httperror.Error
	if errors.As(err, &failure) && failure.Status == 401 {
		return enterpriseRequestContext{}, httperror.New(403, "enterprise_altoc_service_forbidden", "Altoc service identity is not authorized")
	}
	return verified, err
}

// The actor delegation does not cover JSON. Reuse the project document
// token-bound permit signature mechanism with this domain's ordered fields.
func enterpriseAltocReadPermitCanonical(r *http.Request, p enterpriseAltocReadPermit) string {
	departments := p.Scope.DepartmentCodes
	if departments == nil {
		departments = []string{}
	}
	fields := []any{"hzy-enterprise-altoc-read-permit.v1", r.Method, r.URL.RequestURI(), p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.Operation, p.ObjectID, p.Allowed, p.ExpiresAt, p.BundleVersion, p.BundleHash, p.PolicyRevision, p.Scope.Access, departments, p.Query.Page, p.Query.PageSize, p.Query.Search, p.Query.Status, p.Query.CustomerID, p.Query.ContractID}
	return enterpriseAltocPermitFieldsCanonical(fields)
}
func enterpriseAltocPermitFieldsCanonical(fields []any) string {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(fields)
	return strings.TrimSuffix(out.String(), "\n")
}
func verifyEnterpriseAltocReadPermitSignature(r *http.Request, p enterpriseAltocReadPermit) error {
	return verifyEnterpriseAltocPermitCanonicalSignature(r, enterpriseAltocReadPermitCanonical(r, p))
}
func verifyEnterpriseAltocPermitCanonicalSignature(r *http.Request, canonical string) error {
	token, signature := runtimeBearerToken(r), r.Header.Get("X-HZY-Enterprise-Altoc-Permit-Signature")
	if token != "" && signature != "" {
		mac := hmac.New(sha256.New, []byte(token))
		mac.Write([]byte(canonical))
		if hmac.Equal([]byte(signature), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
			return nil
		}
	}
	return httperror.New(403, "enterprise_altoc_permit_signature_invalid", "Altoc read permit signature is invalid")
}
