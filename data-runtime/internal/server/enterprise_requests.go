package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseRequestCreateInput struct {
	ProductCode   string                            `json:"productCode"`
	Tenant        string                            `json:"tenant"`
	Deployment    string                            `json:"deployment"`
	Authorization productcenter.AuthorizationPermit `json:"authorization"`
	Input         productcenter.RequestDraft        `json:"input"`
}

func validateEnterpriseRequestCreate(input enterpriseRequestCreateInput, verified enterpriseRequestContext, now time.Time) error {
	return validateEnterpriseRequestPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "create", verified, now)
}

func validateEnterpriseRequestPermit(code, tenant, deployment string, p productcenter.AuthorizationPermit, action string, verified enterpriseRequestContext, now time.Time) error {
	return validateEnterpriseProductPermit(code, tenant, deployment, p, "product_requests", action, verified, now)
}

func validateEnterpriseProductPermit(code, tenant, deployment string, p productcenter.AuthorizationPermit, resource, action string, verified enterpriseRequestContext, now time.Time) error {
	if tenant != verified.Route.Binding.Tenant || deployment != verified.Route.HostDeployment || code == "" || p.Facts.ProductCode != code || p.Facts.ActorUID != verified.ActorUID || p.Resource != resource || p.Action != action || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "enterprise_product_authorization_invalid", "Fresh bound product authorization is required")
	}
	return nil
}

func (s *Server) routeEnterpriseProductRequestCreate(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseRequests == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_writer_unavailable", "Enterprise product writer is not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:product-requests:create",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.product-requests.create", Auth: &verified.Service}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var input enterpriseRequestCreateInput
	if err := decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_product_input_invalid", "Invalid product request input")
	}
	if err := validateEnterpriseRequestCreate(input, verified, time.Now()); err != nil {
		return result, err
	}
	key := r.Header.Get("Idempotency-Key")
	command := productcenter.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_requests:create", IdempotencyKey: key}
	output, err := s.enterpriseRequests.Create(r.Context(), command, input.Authorization, input.Input)
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": output}
	return result, nil
}

// Only the registered Host service can load authorization facts. There is no
// matching browser route: the Host consumes this result in Console evaluation.
func (s *Server) routeEnterpriseProductAuthorization(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseRequests == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_writer_unavailable", "Enterprise product writer is not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:products:authorization-object",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.products.authorization-object", Auth: &verified.Service}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	code, ok := body["productCode"].(string)
	if !ok || len(body) != 1 {
		return result, httperror.New(400, "enterprise_product_input_invalid", "Invalid authorization object input")
	}
	facts, err := s.enterpriseRequests.AuthorizationFacts(r.Context(), code, verified.ActorUID)
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": facts}
	return result, nil
}

type enterpriseRequestReadInput struct {
	ProductCode   string                            `json:"productCode"`
	Tenant        string                            `json:"tenant"`
	Deployment    string                            `json:"deployment"`
	Authorization productcenter.AuthorizationPermit `json:"authorization"`
	Query         productcenter.RequestPageQuery    `json:"query"`
	BizID         string                            `json:"bizId"`
}

func (s *Server) routeEnterpriseProductRequestRead(r *http.Request, detail bool) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseRequests == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_reader_unavailable", "Enterprise product reader is not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:product-requests:read"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	operation := "enterprise.aims.product-requests.list"
	if detail {
		operation = "enterprise.aims.product-requests.view"
	}
	result := routeResult{Operation: operation, Auth: &verified.Service}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var input enterpriseRequestReadInput
	if err := decoder.Decode(&input); err != nil {
		return result, httperror.New(400, "enterprise_product_input_invalid", "Invalid product request query")
	}
	if err := validateEnterpriseRequestPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "view", verified, time.Now()); err != nil {
		return result, err
	}
	var output any
	if detail {
		output, err = s.enterpriseRequests.Read(r.Context(), input.ProductCode, verified.ActorUID, input.BizID, input.Authorization)
	} else {
		output, err = s.enterpriseRequests.List(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, input.Query)
	}
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": output}
	return result, nil
}
