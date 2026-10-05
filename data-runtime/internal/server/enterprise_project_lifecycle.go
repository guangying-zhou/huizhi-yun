package server

import (
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"time"
)

func (s *Server) routeEnterpriseProjectLifecycle(r *http.Request, mode string) (routeResult, error) {
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "enterprise", LogicalTarget: "aims"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.project-lifecycle", Auth: &verified.Service}
	raw, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	spec := enterpriseDelegatedSpec{Domain: "aims", Resource: "projects", ErrorCode: "project_lifecycle"}
	input, err := decodeEnterpriseDelegatedInput(raw, spec)
	if err != nil {
		return result, err
	}
	action, _ := input.Payload["actionCode"].(string)
	permission := "edit"
	if action == "finish" {
		permission = "close"
	} else if mode != "modules" && action != "pause" && action != "resume" {
		return result, httperror.New(400, "project_lifecycle_action_invalid", "Invalid lifecycle action")
	}
	if !enterpriseDelegatedID.MatchString(input.ProjectID) || input.ObjectID != "" || input.SubID != "" || input.Code != "" || len(input.Query) > 0 {
		return result, httperror.New(400, "project_lifecycle_input_invalid", "Invalid lifecycle request")
	}
	allowed := map[string]bool{"actionCode": true, "expectedVersion": true, "comment": true}
	if mode == "bind" {
		allowed = map[string]bool{"actionCode": true, "requestNo": true, "instanceId": true, "instanceNo": true}
	}
	if mode == "modules" {
		allowed = map[string]bool{"expectedVersion": true, "expectedModuleConfig": true, "moduleConfig": true}
	}
	for key := range input.Payload {
		if !allowed[key] {
			return result, httperror.New(400, "project_lifecycle_input_invalid", "Unsupported request field")
		}
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 180 {
		return result, httperror.New(400, "project_lifecycle_key_required", "Idempotency-Key required")
	}
	p := input.Authorization
	if input.Tenant != route.Binding.Tenant || input.Deployment != route.HostDeployment || p.ActorUID != verified.ActorUID || p.Tenant != input.Tenant || p.Deployment != input.Deployment || p.Resource != "projects" || p.Action != permission || p.ExpiresAt <= time.Now().UnixMilli() || p.ExpiresAt > time.Now().Add(15*time.Second).UnixMilli() {
		return result, httperror.New(403, "project_lifecycle_permit_invalid", "Invalid project permit")
	}
	ctx, err := s.delegatedProjectWriteContext(r, input, verified, enterpriseDelegatedAction{ScopeResource: "projects", ScopeAction: permission}, url.Values{})
	if err != nil {
		return result, err
	}
	identity := aimsapp.EnterpriseProjectUpdateIdentity{Tenant: input.Tenant, SourceDeployment: input.Deployment, TargetDeployment: s.cfg.Deployment, ActorUID: verified.ActorUID, ServiceClientID: verified.Service.ClientID, IdempotencyKey: key, RequestID: requestID(r)}
	var out map[string]any
	if mode == "modules" {
		out, err = s.aims.UpdateEnterpriseProjectModules(ctx, identity, input.ProjectID, input.Payload)
	} else {
		out, err = s.aims.RequestEnterpriseProjectLifecycle(ctx, identity, input.ProjectID, input.Payload, mode == "bind")
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, err
}
