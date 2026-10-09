package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseAltocSalesReadPaths = map[string]enterpriseAltocReadSpec{
	"/v1/enterprise/altoc/leads:list":         {"lead", "list"},
	"/v1/enterprise/altoc/leads:view":         {"lead", "view"},
	"/v1/enterprise/altoc/opportunities:list": {"opportunity", "list"},
	"/v1/enterprise/altoc/opportunities:view": {"opportunity", "view"},
	"/v1/enterprise/altoc/quotations:list":    {"quotation", "list"},
	"/v1/enterprise/altoc/quotations:view":    {"quotation", "view"},
}

type enterpriseAltocSalesReadPermit struct {
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
	Query          altoc.SalesReadQuery `json:"query"`
	BundleVersion  string               `json:"bundleVersion"`
	BundleHash     string               `json:"bundleHash"`
	PolicyRevision *int64               `json:"policyRevision"`
}
type enterpriseAltocSalesReadInput struct {
	ID            string                         `json:"id"`
	Query         altoc.SalesReadQuery           `json:"query"`
	Authorization enterpriseAltocSalesReadPermit `json:"authorization"`
}

func validateEnterpriseAltocSalesReadPermit(input enterpriseAltocSalesReadInput, spec enterpriseAltocReadSpec, verified enterpriseRequestContext, now time.Time) error {
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
	if spec.Action == "view" && (input.Query.Search != "" || input.Query.Status != "" || input.Query.CustomerID != "" || input.Query.OpportunityID != "") {
		return httperror.New(400, "enterprise_altoc_input_invalid", "Altoc detail does not accept filters")
	}
	if input.ID != "" {
		if err := (altoc.SalesReadQuery{Page: 1, PageSize: 1, OpportunityID: input.ID}).Validate("quotation"); err != nil {
			return err
		}
	}
	return input.Query.Validate(spec.Resource)
}
func (s *Server) routeEnterpriseAltocSalesRead(r *http.Request, spec enterpriseAltocReadSpec) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["altoc"].Read != enterprise.PathUnified {
		return routeResult{}, httperror.New(503, "enterprise_altoc_unavailable", "Altoc reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "altoc", LogicalTarget: "altoc"}
	verified, err := authenticateEnterpriseAltocRead(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.altoc." + spec.Resource + "." + spec.Action, Auth: &verified.Service}
	if s.enterpriseAltocSalesReads == nil && !(spec.Resource == "quotation" && s.enterpriseAPF != nil) {
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
	var input enterpriseAltocSalesReadInput
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_altoc_input_invalid", "Invalid Altoc read input")
	}
	if err = validateEnterpriseAltocSalesReadPermit(input, spec, verified, time.Now()); err != nil {
		return result, err
	}
	if err = verifyEnterpriseAltocSalesReadPermitSignature(r, input.Authorization); err != nil {
		return result, err
	}
	var data any
	if spec.Resource == "quotation" && s.enterpriseAPF != nil {
		data, err = s.enterpriseAPF.QuotationRead(r.Context(), input.ID, verified.ActorUID, input.Authorization.Scope, input.Query)
	} else {
		data, err = s.enterpriseAltocSalesReads.Read(r.Context(), spec.Resource, input.ID, verified.ActorUID, input.Authorization.Scope, input.Query)
	}
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

// The actor delegation does not cover JSON. Reuse the project document
// token-bound permit signature mechanism with this domain's ordered fields.
func enterpriseAltocSalesReadPermitCanonical(r *http.Request, p enterpriseAltocSalesReadPermit) string {
	departments := p.Scope.DepartmentCodes
	if departments == nil {
		departments = []string{}
	}
	fields := []any{"hzy-enterprise-altoc-read-permit.v1", r.Method, r.URL.RequestURI(), p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.Operation, p.ObjectID, p.Allowed, p.ExpiresAt, p.BundleVersion, p.BundleHash, p.PolicyRevision, p.Scope.Access, departments, p.Query.Page, p.Query.PageSize, p.Query.Search, p.Query.Status, p.Query.CustomerID, p.Query.OpportunityID}
	return enterpriseAltocPermitFieldsCanonical(fields)
}
func verifyEnterpriseAltocSalesReadPermitSignature(r *http.Request, p enterpriseAltocSalesReadPermit) error {
	return verifyEnterpriseAltocPermitCanonicalSignature(r, enterpriseAltocSalesReadPermitCanonical(r, p))
}
