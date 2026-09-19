package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseProductAdoptionInput struct {
	Query struct {
		ProductCode string `json:"productCode"`
		Page        int    `json:"page"`
		PageSize    int    `json:"pageSize"`
	} `json:"query"`
	// Adoption spans two Assets object families, so the Host supplies one bound
	// permit per family. Neither may be widened here.
	DeliveryAuthorization    enterpriseDirectoryAuthorization `json:"deliveryAuthorization"`
	EnvironmentAuthorization enterpriseDirectoryAuthorization `json:"environmentAuthorization"`
}

func enterpriseAdoptionScope(p enterpriseDirectoryAuthorization, resource string, verified enterpriseRequestContext, now time.Time) (url.Values, error) {
	deny := func() (url.Values, error) {
		return nil, httperror.New(http.StatusForbidden, "enterprise_product_adoption_authorization_invalid", "Fresh bound product adoption authorization is required")
	}
	if p.ActorUID != verified.ActorUID || p.Tenant != verified.Route.Binding.Tenant || p.Deployment != verified.Route.HostDeployment ||
		p.Resource != resource || p.Action != "view" || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return deny()
	}
	q := url.Values{"current_user": {verified.ActorUID}, "current_user_assets_permission_action": {"view"}}
	for key, value := range p.Scope {
		if key != "current_user_assets_object_access" && key != "current_user_assets_scope_units" {
			return deny()
		}
		q.Set(key, value)
	}
	access := q.Get("current_user_assets_object_access")
	if access == "none" {
		return deny()
	}
	if access == "all" && q.Get("current_user_assets_scope_units") != "" {
		return deny()
	}
	return q, nil
}

// Product adoption reads delivery assets and environments from the unified
// authority. The old path asked Assets through a signed cross-app command; here
// both families live in the same database, so one snapshot answers the query
// while each family keeps its own object scope.
func (s *Server) routeEnterpriseProductAdoption(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.cfg.Enterprise.Domains["assets"].Read != enterprise.PathUnified || s.assets == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_adoption_unavailable", "Unified product adoption reads are not enabled")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Action: "read", Capability: "assets:product-adoption:read",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.product-adoption.read", Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(http.StatusBadRequest, "enterprise_product_adoption_input_invalid", "Query parameters are not accepted")
	}
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
	var input enterpriseProductAdoptionInput
	if err = decoder.Decode(&input); err != nil {
		return result, httperror.New(http.StatusBadRequest, "enterprise_product_adoption_input_invalid", "Invalid product adoption input")
	}
	now := time.Now()
	delivery, err := enterpriseAdoptionScope(input.DeliveryAuthorization, "deliveries", verified, now)
	if err != nil {
		return result, err
	}
	environment, err := enterpriseAdoptionScope(input.EnvironmentAuthorization, "environments", verified, now)
	if err != nil {
		return result, err
	}
	page, err := s.assets.EnterpriseProductAdoptionRead(r.Context(), input.Query.ProductCode, delivery, environment, input.Query.Page, input.Query.PageSize)
	if err != nil {
		return result, err
	}
	result.Body = map[string]any{"code": 0, "data": page}
	return result, nil
}
