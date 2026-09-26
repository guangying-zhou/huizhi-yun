package server

import (
	"encoding/json"
	"errors"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"strings"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	ec "github.com/huizhi-yun/data-runtime/internal/enterprisecontracts"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseContractActivationInput struct {
	ContractCode      string                      `json:"contractCode"`
	Authorization     ec.CompiledActivationPermit `json:"authorization"`
	AimsAuthorization ec.CompiledActivationPermit `json:"aims_authorization"`
}

func (s *Server) routeEnterpriseContractActivation(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || !s.cfg.Enterprise.EnableContractActivation || s.enterpriseContractActivation == nil {
		return routeResult{}, httperror.New(503, "enterprise_contract_activation_disabled", "Contract activation is not enabled")
	}
	route := enterpriseRouteContext{Binding: e.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "altoc", LogicalTarget: "altoc", Capability: "altoc:contract:activate-delivery"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.altoc.contracts.activate-delivery", Auth: &verified.Service}
	if len(r.URL.Query()) != 0 {
		return result, httperror.New(400, "invalid_contract_activation_query", "Query parameters are not accepted")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseContractActivationInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 || strings.TrimSpace(input.ContractCode) == "" || len(input.ContractCode) > 30 {
		return result, httperror.New(400, "invalid_contract_activation_input", "Contract and stable idempotency key required")
	}
	authorizer, err := ec.NewCompiledActivationAuthorizer(route.HostDeployment, input.Authorization, input.AimsAuthorization)
	if err != nil {
		return result, httperror.New(403, "contract_activation_permission_denied", "Bound permissions required")
	}
	data, err := s.enterpriseContractActivation.Activate(r.Context(), ec.ActivationIdentity{Key: route.Binding, ActorUID: verified.ActorUID, RequestID: requestID(r), IdempotencyKey: key}, input.ContractCode, authorizer)
	if err != nil {
		return result, enterpriseContractActivationError(err)
	}
	result.Body = map[string]any{"code": 0, "data": data, "message": "ok"}
	return result, nil
}

func enterpriseContractActivationError(err error) error {
	var public httperror.Error
	if errors.As(err, &public) {
		return public
	}
	if errors.Is(err, ec.ErrActivationAuthorization) {
		return httperror.New(403, "contract_activation_permission_denied", "Current Altoc and Aims permissions required")
	}
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) || errors.Is(err, io.ErrImmutableIdentity) {
		return httperror.New(409, "contract_activation_conflict", "Frozen contract command conflicts with existing identity")
	}
	return httperror.New(503, "enterprise_contract_activation_unavailable", "Contract activation unavailable")
}
