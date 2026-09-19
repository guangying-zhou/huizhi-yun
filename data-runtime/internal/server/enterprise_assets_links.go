package server

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	assets "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseProductDocumentProof struct {
	ProductID    int64  `json:"productId"`
	ProductCode  string `json:"productCode"`
	DocumentUUID string `json:"documentUuid"`
	ActorUID     string `json:"actorUid"`
	ExpiresAt    int64  `json:"expiresAt"`
}
type enterpriseAssetsLinkInput struct {
	ID                    int64                            `json:"id"`
	Input                 map[string]any                   `json:"input"`
	Authorization         enterpriseDirectoryAuthorization `json:"authorization"`
	TargetAuthorization   enterpriseDirectoryAuthorization `json:"targetAuthorization"`
	DocumentAuthorization *enterpriseProductDocumentProof  `json:"documentAuthorization"`
}

// Target permits have the same signature-bound transport and 15-second limit
// as product permits, but retain their independent resource and scope.
func enterpriseAssetsTargetScope(p enterpriseDirectoryAuthorization, verified enterpriseRequestContext, kind string) (url.Values, error) {
	resource := "technology_bases"
	if kind == "asset" {
		resource = "asset_items"
	}
	if p.Resource != resource {
		return nil, httperror.New(403, "assets_target_authorization_invalid", "Independent target authorization required")
	}
	p.Resource = "products"
	q, err := validateEnterpriseDirectoryAuthorization(enterpriseDirectoryInput{Authorization: p}, verified, time.Now())
	if err != nil {
		return nil, err
	}
	if _, _, err = assets.ProductTargetReadPredicate(kind, q, map[string]string{"base": "tb", "asset": "ai"}[kind]); err != nil {
		return nil, err
	}
	return q, nil
}

func (s *Server) routeEnterpriseAssetsLink(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseAssetsProducts == nil {
		return routeResult{}, httperror.New(503, "enterprise_assets_unavailable", "Assets product management is not enabled")
	}
	write := strings.HasPrefix(action, "link-")
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "assets", LogicalTarget: "assets", Action: "read", Capability: "assets:product:read"}
	if write {
		route.Action = "edit"
		route.Capability = "assets:product:edit"
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.assets.products." + action, Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(400, "invalid_assets_query", "Query parameters are not accepted")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseAssetsLinkInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	var q url.Values
	if write {
		q, err = enterpriseAssetsProductEditScope(input.Authorization, verified)
	} else {
		q, err = validateEnterpriseDirectoryAuthorization(enterpriseDirectoryInput{Authorization: input.Authorization}, verified, time.Now())
	}
	if err != nil {
		return result, err
	}
	kind := "base"
	if strings.Contains(action, "asset") {
		kind = "asset"
	}
	if action != "link-document" {
		if input.DocumentAuthorization != nil {
			return result, httperror.New(400, "invalid_document_proof", "Unexpected document authorization")
		}
		target, err := enterpriseAssetsTargetScope(input.TargetAuthorization, verified, kind)
		if err != nil {
			return result, err
		}
		if !write {
			if input.ID != 0 || len(input.Input) != 0 {
				return result, httperror.New(400, "invalid_candidate_input", "Unexpected candidate parameters")
			}
			data, err := s.enterpriseAssetsProducts.LinkCandidates(r.Context(), kind, target)
			if err != nil {
				return result, enterpriseAssetsError(err)
			}
			result.Body = map[string]any{"code": 0, "data": data}
			return result, nil
		}
		q.Set("current_user_product_target_access", target.Get("current_user_assets_object_access"))
		q.Set("current_user_product_target_units", target.Get("current_user_assets_scope_units"))
	} else {
		p := input.DocumentAuthorization
		now := time.Now().UnixMilli()
		if p == nil || p.ProductID != input.ID || p.ActorUID != verified.ActorUID || p.ProductCode == "" || p.ExpiresAt <= now || p.ExpiresAt > now+15000 || p.DocumentUUID != input.Input["document_id"] {
			return result, httperror.New(403, "product_document_authorization_required", "Fresh bound Codocs authorization required")
		}
		if input.TargetAuthorization.Resource != "" {
			return result, httperror.New(400, "invalid_target_authorization", "Unexpected target authorization")
		}
		q.Set("current_user_product_document_id", strconv.FormatInt(p.ProductID, 10))
		q.Set("current_user_product_document_code", p.ProductCode)
		q.Set("current_user_product_document_uuid", p.DocumentUUID)
		q.Set("current_user_product_document_actor", p.ActorUID)
		q.Set("current_user_product_document_expires", strconv.FormatInt(p.ExpiresAt, 10))
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if input.ID <= 0 || key == "" || len(key) > 240 {
		return result, httperror.New(400, "invalid_product_link_command", "Product and idempotency key required")
	}
	identity := assets.ProductMasterCommandIdentity{Tenant: verified.Route.Binding.Tenant, CommandDeployment: s.cfg.DeploymentBindings["assets"], ActorUID: verified.ActorUID, ClientID: verified.Service.ClientID, RequestID: requestID(r), Key: key}
	id, err := s.enterpriseAssetsProducts.Link(r.Context(), identity, action, input.ID, input.Input, q)
	if err != nil {
		return result, enterpriseAssetsError(err)
	}
	result.Body = map[string]any{"code": 0, "data": map[string]any{"id": id}}
	return result, nil
}
