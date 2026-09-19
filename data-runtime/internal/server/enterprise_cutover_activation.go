package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

func (s *Server) routeEnterpriseCutoverActivation(r *http.Request) (routeResult, error) {
	result := routeResult{Operation: "runtime.enterprise.cutover-activation"}
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	expectedHash, actualHash := sha256.Sum256([]byte(s.cfg.Control.Token)), sha256.Sum256([]byte(provided))
	if s.cfg.Control.Token == "" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || subtle.ConstantTimeCompare(expectedHash[:], actualHash[:]) != 1 {
		return result, httperror.New(401, "runtime_control_required", "Runtime control credential required")
	}
	if !s.cfg.Enterprise.Enabled || s.enterpriseRegistry == nil {
		return result, httperror.New(503, "activation_unavailable", "Unified runtime is not enabled")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	key, ok := body["cutoverKey"].(string)
	if !ok || key == "" || len(body) != 1 || r.URL.RawQuery != "" {
		return result, httperror.New(400, "activation_input_invalid", "Exact cutover key required")
	}
	binding, err := s.cfg.EnterpriseBinding()
	if err != nil {
		return result, err
	}
	domain, ok := binding.Domains["aims"]
	if !ok {
		return result, httperror.New(503, "activation_unavailable", "Aims binding unavailable")
	}
	resolved, err := s.enterpriseRegistry.Resolve(enterprise.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: enterprise.Read})
	if err != nil {
		return result, err
	}
	receipt, err := unified.ObserveCommittedActivation(r.Context(), resolved.DB, binding, key)
	if err != nil {
		return result, httperror.New(409, "activation_not_committed", "Committed activation verification failed")
	}
	result.Body = map[string]any{"type": "enterprise-cutover-observation.v1", "tenantCode": s.cfg.Tenant, "environment": binding.Key.Environment, "runtimeCode": s.cfg.Control.RuntimeCode, "runtimeDeployment": s.cfg.Deployment, "generation": strconv.FormatUint(receipt.Generation, 10), "cutoverKey": receipt.OperationKey, "reviewHash": receipt.ReviewHash, "evidenceHash": receipt.EvidenceHash}
	return result, nil
}
