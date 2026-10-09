package server

import (
	"bytes"
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
	"time"
)

const enterpriseAdminRoutineBatchPath = "/v1/enterprise/aims/admin-projects:routine-batch"

func (s *Server) routeEnterpriseAdminRoutineBatch(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_admin_projects_unavailable", "Admin project writer unavailable")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.admin-projects.routine-batch", Auth: &verified.Service}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if r.URL.RawQuery != "" || key == "" || len(key) > 191 {
		return result, httperror.New(400, "admin_routine_batch_input_invalid", "Invalid query or key")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	var input struct {
		Tenant        string                       `json:"tenant"`
		Deployment    string                       `json:"deployment"`
		Year          any                          `json:"year"`
		Departments   any                          `json:"departments"`
		Authorization enterpriseAdminProjectPermit `json:"authorization"`
	}
	raw, _ := json.Marshal(body)
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		return result, httperror.New(400, "admin_routine_batch_input_invalid", "Invalid batch request")
	}
	if err = validateEnterpriseAdminProjectPermit(input.Tenant, input.Deployment, input.Authorization, verified, time.Now()); err != nil {
		return result, err
	}
	out, err := s.aims.CreateEnterpriseRoutineBatch(r.Context(), aimsapp.EnterpriseProjectCreateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, RequestID: requestID(r), IdempotencyKey: key}, input.Year, input.Departments)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}
