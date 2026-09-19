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

var enterprisePlanningActions = map[string]string{
	"/v1/enterprise/aims/versions:create":           "create",
	"/v1/enterprise/aims/versions:plan-edit":        "plan-edit",
	"/v1/enterprise/aims/versions:plan-item-create": "plan-item-create",
	"/v1/enterprise/aims/versions:plan-item-edit":   "plan-item-edit",
	"/v1/enterprise/aims/versions:plan-item-delete": "plan-item-delete",
	"/v1/enterprise/aims/versions:plan-confirm":     "plan-confirm",
}

type enterprisePlanningInput struct {
	ProductCode           string                            `json:"productCode"`
	Tenant                string                            `json:"tenant"`
	Deployment            string                            `json:"deployment"`
	Input                 json.RawMessage                   `json:"input"`
	Authorization         productcenter.AuthorizationPermit `json:"authorization"`
	RequestAuthorization  productcenter.AuthorizationPermit `json:"request_authorization"`
	DecisionAuthorization productcenter.AuthorizationPermit `json:"request_decision_authorization"`
	PlanningAuthorization productcenter.AuthorizationPermit `json:"planning_authorization"`
}

func decodeEnterprisePlanningInput(raw json.RawMessage, target any) error {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return httperror.New(400, "enterprise_planning_input_invalid", "Planning input is required")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return httperror.New(400, "enterprise_planning_input_invalid", "Invalid planning input")
	}
	return nil
}

func (s *Server) routeEnterprisePlanningCommand(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterprisePlanning == nil {
		return routeResult{}, httperror.New(503, "enterprise_planning_unavailable", "Enterprise planning is not enabled")
	}
	capabilityAction := "edit"
	if action == "create" {
		capabilityAction = "create"
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: capabilityAction, Capability: "aims:product-versions:" + capabilityAction}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.versions." + action, Auth: &verified.Service}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterprisePlanningInput
	if err := decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	validate := func(p productcenter.AuthorizationPermit, resource, permission string) error {
		return validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, p, resource, permission, verified, time.Now())
	}
	if err := validate(input.Authorization, "product_versions", "edit"); err != nil {
		return result, err
	}
	identity := productcenter.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_versions:" + action, IdempotencyKey: r.Header.Get("Idempotency-Key")}
	var output productcenter.CommandResult
	switch action {
	case "create":
		var value productcenter.ProductVersionDraft
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterprisePlanning.CreateProductCenterVersion(r.Context(), identity, input.Authorization, value)
		}
	case "plan-edit":
		var value productcenter.LightweightVersionPlanEdit
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterprisePlanning.EditLightweightVersionPlan(r.Context(), identity, input.Authorization, value)
		}
	case "plan-item-create":
		var value productcenter.LightweightVersionPlanItemCreate
		if err = decodeEnterprisePlanningInput(input.Input, &value); err != nil {
			return result, err
		}
		if err = validate(input.RequestAuthorization, "product_requests", "view"); err != nil {
			return result, err
		}
		if err = validate(input.PlanningAuthorization, "product_priorities", "edit"); err != nil {
			return result, err
		}
		if value.AdoptRequest {
			if err = validate(input.DecisionAuthorization, "product_requests", "decide"); err != nil {
				return result, err
			}
		}
		output, err = s.enterprisePlanning.CreateLightweightVersionPlanItem(r.Context(), identity, input.Authorization, input.RequestAuthorization, input.DecisionAuthorization, input.PlanningAuthorization, value)
	case "plan-item-edit":
		var value productcenter.LightweightVersionPlanItemEdit
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterprisePlanning.EditLightweightVersionPlanItem(r.Context(), identity, input.Authorization, value)
		}
	case "plan-item-delete":
		var value productcenter.LightweightVersionPlanItemDelete
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterprisePlanning.DeleteLightweightVersionPlanItem(r.Context(), identity, input.Authorization, value)
		}
	case "plan-confirm":
		var value productcenter.LightweightVersionPlanConfirm
		if err = decodeEnterprisePlanningInput(input.Input, &value); err != nil {
			return result, err
		}
		if err = validate(input.PlanningAuthorization, "product_priorities", "prioritize"); err != nil {
			return result, err
		}
		output, err = s.enterprisePlanning.ConfirmLightweightVersionPlan(r.Context(), identity, input.Authorization, input.PlanningAuthorization, value)
	default:
		return result, httperror.New(404, "enterprise_planning_operation_unknown", "Unknown planning operation")
	}
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": output}
	return result, nil
}
