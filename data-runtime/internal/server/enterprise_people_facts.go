package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"time"
)

var enterprisePeopleFactsPaths = map[string]string{
 "/v1/enterprise/people/directory-operations:list":"directory-operations-list",
 "/v1/enterprise/people/directory-operations:view":"directory-operations-view",
 "/v1/enterprise/people/directory-operations:replay":"directory-operations-replay",
	"/v1/enterprise/people/offboarding-cases:list":    "offboarding-list",
	"/v1/enterprise/people/offboarding-cases:view":    "offboarding-view",
	"/v1/enterprise/people/offboarding-cases:create":  "offboarding-create",
	"/v1/enterprise/people/offboarding-cases:arrange": "offboarding-arrange",
	"/v1/enterprise/people/offboarding-cases:confirm": "offboarding-confirm",
	"/v1/enterprise/people/offboarding-cases:cancel":  "offboarding-cancel",

	"/v1/enterprise/people/hr-source:hr-state":               "hr-state",
	"/v1/enterprise/people/hr-source:hr-mappings-prepare":    "hr-mappings-prepare",
	"/v1/enterprise/people/hr-source:hr-mappings-confirm":    "hr-mappings-confirm",
	"/v1/enterprise/people/hr-source:hr-changes-prepare":     "hr-changes-prepare",
	"/v1/enterprise/people/hr-source:hr-changes-confirm":     "hr-changes-confirm",
	"/v1/enterprise/people/hr-source:hr-jobs-start-prepare":  "hr-jobs-start-prepare",
	"/v1/enterprise/people/hr-source:hr-jobs-start-confirm":  "hr-jobs-start-confirm",
	"/v1/enterprise/people/hr-source:hr-jobs-cancel-prepare": "hr-jobs-cancel-prepare",
	"/v1/enterprise/people/hr-source:hr-jobs-cancel-confirm": "hr-jobs-cancel-confirm",
	"/v1/enterprise/people/hr-source:hr-jobs-retry-prepare":  "hr-jobs-retry-prepare",
	"/v1/enterprise/people/hr-source:hr-jobs-retry-confirm":  "hr-jobs-retry-confirm",

	"/v1/enterprise/people/assignments:request-workflow":             "assignments-request-workflow",
	"/v1/enterprise/people/onboarding-cases:begin-provisioning":      "onboarding-begin-provisioning",
	"/v1/enterprise/people/onboarding-cases:reserved":                "onboarding-reserved",
	"/v1/enterprise/people/onboarding-cases:provisioning":            "onboarding-provisioning",
	"/v1/enterprise/people/onboarding-cases:failure":                 "onboarding-failure",
	"/v1/enterprise/people/onboarding-cases:cancel":                  "onboarding-cancel",
	"/v1/enterprise/people/onboarding-cases:aggregate-status":        "onboarding-aggregate-status",
	"/v1/enterprise/people/onboarding-cases:activate":                "onboarding-activate",
	"/v1/enterprise/people/onboarding-cases:prepare-reserve":         "onboarding-prepare-reserve",
	"/v1/enterprise/people/onboarding-cases:prepare-release":         "onboarding-prepare-release",
	"/v1/enterprise/people/onboarding-cases:prepare-provision":       "onboarding-prepare-provision",
	"/v1/enterprise/people/onboarding-cases:prepare-status":          "onboarding-prepare-status",
	"/v1/enterprise/people/onboarding-cases:prepare-activation-link": "onboarding-prepare-activation-link",

	"/v1/enterprise/people/employees:create":            "employees-create",
	"/v1/enterprise/people/employees:update":            "employees-update",
	"/v1/enterprise/people/assignments:create":          "assignments-create",
	"/v1/enterprise/people/assignments:update":          "assignments-update",
	"/v1/enterprise/people/assignments:delete":          "assignments-delete",
	"/v1/enterprise/people/assignments:change":          "assignments-change",
	"/v1/enterprise/people/assignments:attach-workflow": "assignments-attach-workflow",
	"/v1/enterprise/people/onboarding-cases:list":       "onboarding-list",
	"/v1/enterprise/people/onboarding-cases:view":       "onboarding-view",
	"/v1/enterprise/people/onboarding-cases:create":     "onboarding-create",
	"/v1/enterprise/people/onboarding-cases:update":     "onboarding-update",
}

const enterprisePeopleCallbackPath = "/v1/enterprise/people/workflow:callback"

type peopleFactsInput struct {
	Authorization apfPermit                   `json:"authorization"`
	Facts         people.EnterpriseFactsInput `json:"peopleFacts"`
}

func peopleFactsCanonical(r *http.Request, i peopleFactsInput) string {
	raw := apfPermitCanonical(r, apfInput{Authorization: i.Authorization})
	var fields []any
	json.Unmarshal([]byte(raw), &fields)
	fields = append(fields, people.FactsIntent(i.Facts))
	return enterpriseAltocPermitFieldsCanonical(fields)
}
func validatePeopleFactsPermit(r *http.Request, i peopleFactsInput, op string, v enterpriseRequestContext, now time.Time) error {
	p := i.Authorization
	resource, action, ok := people.FactsPermission(op)
	if !ok || p.ActorUID != v.ActorUID || p.Tenant != v.Route.Binding.Tenant || p.Deployment != v.Route.HostDeployment || p.Resource != resource || p.Action != action || p.Operation != op || p.ObjectID != i.Facts.ID+"|"+i.Facts.EmployeeUID || !p.Allowed || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "people_facts_permit_invalid", "Fresh People facts permit required")
	}
	if e := p.Scope.Validate(); e != nil {
		return e
	}
	token := runtimeBearerToken(r)
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(peopleFactsCanonical(r, i)))
	if token == "" || !hmac.Equal([]byte(r.Header.Get("X-HZY-Enterprise-APF-Permit-Signature")), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return httperror.New(403, "people_facts_signature_invalid", "Invalid People facts signature")
	}
	return people.ValidateFactsInput(op, i.Facts)
}
func (s *Server) routeEnterprisePeopleFacts(r *http.Request, op string) (routeResult, error) {
	result := routeResult{Operation: "enterprise.people.facts." + op}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "people", LogicalTarget: "people"}
	v, e := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	result.Auth = &v.Service
	if e != nil {
		return result, e
	}
	if !s.cfg.Enterprise.Enabled || s.enterpriseRegistry == nil {
		return result, httperror.New(503, "people_facts_unavailable", "People facts unavailable")
	}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "people_facts_input_invalid", "Query unsupported")
	}
	body, e := readJSONBody(r)
	if e != nil {
		return result, e
	}
	raw, _ := json.Marshal(body)
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var i peopleFactsInput
	if e = d.Decode(&i); e != nil {
		return result, httperror.New(400, "people_facts_input_invalid", "Invalid facts input")
	}
	if e = validatePeopleFactsPermit(r, i, op, v, time.Now()); e != nil {
		return result, e
	}
	_, action, _ := people.FactsPermission(op)
	key := r.Header.Get("Idempotency-Key")
	if (action == "edit" || action == "replay" || people.IsOffboardingOperation(op) && action != "view") && !validAPFKey(key) {
		return result, httperror.New(400, "people_key_required", "Key required")
	}
	b, e := s.cfg.EnterpriseBinding()
	if e != nil {
		return result, apfError(e)
	}
	svc := enterpriseapf.PeopleFactsService{Registry: s.enterpriseRegistry, Binding: b, ApprovalReader: s.workflow}
	out, e := svc.Execute(r.Context(), op, i.Facts, enterpriseapf.Identity{Actor: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Client: v.Service.ClientID, RequestID: requestID(r), Key: key}, i.Authorization.Scope)
	result.Body = map[string]any{"code": 0, "data": out}
	return result, apfError(e)
}
func (s *Server) routeEnterprisePeopleCallback(r *http.Request) (routeResult, error) {
	result := routeResult{Operation: "enterprise.people.workflow.callback"}
	identity, e := s.authenticateEnterpriseSystem(r, "people", "")
	result.Auth = &identity
	if e != nil {
		return result, e
	}
	if !s.cfg.Enterprise.Enabled || s.enterpriseRegistry == nil {
		return result, httperror.New(503, "people_facts_unavailable", "People facts unavailable")
	}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "people_callback_invalid", "Query unsupported")
	}
	body, e := readJSONBody(r)
	if e != nil {
		return result, e
	}
	raw, _ := json.Marshal(body)
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var i enterpriseapf.PeopleFactsCallback
	if e = d.Decode(&i); e != nil {
		return result, httperror.New(400, "people_callback_invalid", "Invalid callback")
	}
	b, e := s.cfg.EnterpriseBinding()
	if e != nil {
		return result, apfError(e)
	}
	svc := enterpriseapf.PeopleFactsService{Registry: s.enterpriseRegistry, Binding: b, ApprovalReader: s.workflow}
	out, e := svc.Callback(r.Context(), i, enterpriseapf.Identity{Tenant: identity.Tenant, Deployment: s.cfg.DeploymentBindings["enterprise"], Client: identity.ClientID, RequestID: requestID(r)})
	result.Body = map[string]any{"code": 0, "data": out}
	return result, apfError(e)
}
