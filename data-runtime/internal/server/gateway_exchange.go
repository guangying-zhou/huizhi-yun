package server

import (
	"errors"
	"net/http"
	"time"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/gatewaykeys"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (s *Server) gatewayExchange(r *http.Request) (routeResult, error) {
	authCtx, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "console", Scope: consoleapp.GatewayExchangeScope, SourceAppCode: "console", StrictServiceClaims: true, RequireDeploymentBinding: true})
	if err != nil {
		return routeResult{}, err
	}
	if authCtx.ClientID != "console.runtime" || authCtx.Subject != "client:console.runtime" || authCtx.Mode != "jwt" {
		return routeResult{}, httperror.New(403, "console_exchange_identity_invalid", "Console Runtime identity required")
	}
	adapter, err := s.requireConsole()
	if err != nil {
		return routeResult{}, err
	}
	if err = adapter.VerifyGatewayExchangeCaller(r.Context(), authCtx.CredentialID); err != nil {
		return routeResult{}, err
	}
	if !s.cfg.Apps.Console.GatewayExchangeEnabled {
		return routeResult{}, httperror.New(503, "gateway_exchange_disabled", "Gateway exchange is disabled")
	}
	_, rawBody, err := readJSONBodyWithRawLimit(r, 65536)
	if err != nil {
		return routeResult{}, err
	}
	body, err := gatewaykeys.DecodeExchangeBody(rawBody)
	if err != nil {
		return routeResult{}, httperror.New(400, "gateway_exchange_body_invalid", "Invalid Gateway exchange request")
	}
	if s.gatewayKeys == nil {
		return routeResult{}, httperror.New(503, "gateway_keyset_unavailable", "Gateway verification keys are not ready")
	}
	var result map[string]any
	raw, ok := body["assertion"].(string)
	if !ok || raw == "" {
		return routeResult{}, httperror.New(400, "gateway_assertion_missing", "Gateway assertion required")
	}
	err = s.gatewayKeys.WithAssertion(raw, time.Now(), func(claims gatewaykeys.Assertion) error {
		if deployment, bound := s.cfg.DeploymentBindings[claims.AppCode]; !bound || deployment != claims.Deployment {
			return httperror.New(403, "gateway_exchange_source_binding_invalid", "Source app deployment is not registered")
		}
		result, err = adapter.ExchangeGatewayServiceToken(r.Context(), body, claims, authCtx.Tenant, authCtx.Deployment, consoleapp.AuditMutationMeta{RequestID: requestID(r), ActorType: "service", ActorID: authCtx.Subject, SourceApp: authCtx.AppCode})
		return err
	})
	switch {
	case errors.Is(err, gatewaykeys.ErrUnavailable):
		err = httperror.New(503, "gateway_keyset_unavailable", "Gateway verification keys are not ready")
	case errors.Is(err, gatewaykeys.ErrInvalid), errors.Is(err, gatewaykeys.ErrRollback), errors.Is(err, gatewaykeys.ErrStorage):
		err = httperror.New(503, "gateway_keyset_invalid", "Gateway verification keys failed validation")
	case errors.Is(err, gatewaykeys.ErrKey):
		err = httperror.New(403, "gateway_assertion_key_invalid", "Gateway assertion key is inactive")
	case errors.Is(err, gatewaykeys.ErrAssertion):
		err = httperror.New(401, "gateway_assertion_invalid", "Gateway assertion failed verification")
	}
	if err == nil {
		result = map[string]any{"code": 0, "data": result}
	}
	return routeResult{Operation: "console.auth.service_token.gateway_exchange", Auth: &authCtx, Body: result}, err
}
