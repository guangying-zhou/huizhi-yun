package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"io"
	"net/http"
	"strings"
	"time"
)

type feedbackPermit struct {
	ActorUID       string `json:"actorUid"`
	Tenant         string `json:"tenant"`
	Deployment     string `json:"deployment"`
	Resource       string `json:"resource"`
	Action         string `json:"action"`
	Operation      string `json:"operation"`
	ExpiresAt      int64  `json:"expiresAt"`
	BundleVersion  string `json:"bundleVersion"`
	BundleHash     string `json:"bundleHash"`
	PolicyRevision *int64 `json:"policyRevision"`
	Global         bool   `json:"global"`
}
type feedbackRequest struct {
	Payload       string         `json:"payload"`
	Authorization feedbackPermit `json:"authorization"`
}

func feedbackOperation(path string) (string, bool) {
	var op string
	for _, prefix := range []string{"/v1/console/feedback:", "/v1/enterprise/console/feedback:"} {
		if strings.HasPrefix(path, prefix) {
			op = strings.TrimPrefix(path, prefix)
		}
	}
	switch op {
	case "attachment-put", "attachment-read", "options", "draft", "submit", "list", "detail", "admin-list", "cleanup-media", "retry", "cancel", "settings-get", "settings-save":
		return op, true
	}
	return "", false
}
func feedbackCanonical(r *http.Request, in feedbackRequest) string {
	p := in.Authorization
	return enterpriseAltocPermitFieldsCanonical([]any{"hzy-console-feedback-permit.v1", r.Method, r.URL.RequestURI(), r.Header.Get("Idempotency-Key"), p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.Operation, p.ExpiresAt, p.BundleVersion, p.BundleHash, p.PolicyRevision, p.Global, in.Payload})
}
func validateFeedbackPermit(r *http.Request, in feedbackRequest, op, uid, tenant, deployment string, now time.Time) error {
	p := in.Authorization
	resource, action := feedbackPermission(op)
	if p.ActorUID != uid || uid == "" || p.Tenant != tenant || p.Deployment != deployment || p.Resource != resource || p.Action != action || p.Operation != op || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "feedback_permit_invalid", "Fresh feedback permission required")
	}
	token := runtimeBearerToken(r)
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(feedbackCanonical(r, in)))
	if token == "" || !hmac.Equal([]byte(r.Header.Get("X-HZY-Feedback-Permit-Signature")), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return httperror.New(403, "feedback_permit_signature_invalid", "Invalid feedback permit")
	}
	return nil
}
func (s *Server) routeFeedback(r *http.Request, op string) (routeResult, error) {
	result := routeResult{Operation: "console.feedback." + op}
	if r.Method != http.MethodPost || r.URL.RawQuery != "" {
		return result, httperror.New(400, "feedback_request_invalid", "Fixed POST required")
	}
	var uid, tenant, deployment string
	if strings.HasPrefix(r.URL.Path, "/v1/enterprise/") {
		if op != "attachment-put" && op != "attachment-read" && op != "options" && op != "draft" && op != "submit" && op != "list" && op != "detail" {
			return result, feedbackInputError()
		}
		route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "console", LogicalTarget: "console"}
		v, e := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
		if e != nil {
			return result, e
		}
		result.Auth = &v.Service
		uid = v.ActorUID
		tenant = route.Binding.Tenant
		deployment = route.HostDeployment
		if !s.cfg.Enterprise.Enabled {
			return result, httperror.New(503, "feedback_unavailable", "Enterprise unavailable")
		}
	} else {
		resource, action := feedbackPermission(op)
		v, e := s.authenticateConsoleFeedback(r, "console:"+resource+":"+action)
		if e != nil {
			return result, e
		}
		result.Auth = &v
		uid, e = trustedConsoleMutationActor(r, v)
		if e != nil {
			return result, e
		}
		tenant = s.cfg.Tenant
		deployment = v.Deployment
	}
	var in feedbackRequest
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 9<<20))
	decoder.DisallowUnknownFields()
	if e := decoder.Decode(&in); e != nil {
		return result, feedbackInputError()
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return result, feedbackInputError()
	}
	if e := validateFeedbackPermit(r, in, op, uid, tenant, deployment, time.Now()); e != nil {
		return result, e
	}
	c, e := consoleapp.DecodeFeedbackCommand(in.Payload)
	if e != nil {
		return result, e
	}
	adapter, e := s.requireConsole()
	if e != nil {
		return result, e
	}
	result.Body, e = adapter.Feedback(r.Context(), op, c, consoleapp.MutationMeta{ActorID: uid, IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r)}, in.Authorization.Global)
	return result, feedbackAdapterError(e)
}
func feedbackInputError() error {
	return httperror.New(400, "feedback_input_invalid", "Invalid feedback input")
}

func (s *Server) routeFeedbackDrain(r *http.Request) (routeResult, error) {
	result := routeResult{Operation: "console.feedback.drain"}
	v, e := s.authenticateConsoleFeedback(r, "console:feedback-delivery:execute")
	if e != nil {
		return result, e
	}
	result.Auth = &v
	if _, _, _, delegated := runtimeSignedActorContext(r); delegated {
		return result, httperror.New(403, "feedback_scheduler_actor_invalid", "Scheduler cannot carry an actor")
	}
	if r.Method != "POST" || r.URL.RawQuery != "" {
		return result, feedbackInputError()
	}
	if e = validateDirectorySelfInput(r); e != nil {
		return result, e
	}
	adapter, e := s.requireConsole()
	if e != nil {
		return result, e
	}
	result.Body, e = adapter.DrainFeedback(r.Context())
	return result, feedbackAdapterError(e)
}
func (s *Server) routeFeedbackNotification(r *http.Request, op string) (routeResult, error) {
	result := routeResult{Operation: "console.feedback.notification." + op}
	v, e := s.authenticateConsoleFeedback(r, "console:feedback-delivery:execute")
	if e != nil {
		return result, e
	}
	result.Auth = &v
	if _, _, _, delegated := runtimeSignedActorContext(r); delegated {
		return result, httperror.New(403, "feedback_scheduler_actor_invalid", "Scheduler cannot carry an actor")
	}
	if r.Method != "POST" || r.URL.RawQuery != "" {
		return result, feedbackInputError()
	}
	var c consoleapp.FeedbackNotificationCommand
	d := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 16384))
	d.DisallowUnknownFields()
	if d.Decode(&c) != nil {
		return result, feedbackInputError()
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return result, feedbackInputError()
	}
	a, e := s.requireConsole()
	if e != nil {
		return result, e
	}
	result.Body, e = a.FeedbackNotification(r.Context(), op, c)
	return result, feedbackAdapterError(e)
}

func feedbackPermission(op string) (string, string) {
	switch op {
	case "attachment-put", "options", "draft", "submit":
		return "feedback", "submit"
	case "retry":
		return "feedback", "retry"
	case "cancel", "cleanup-media":
		return "feedback", "admin"
	case "settings-get":
		return "feedback-settings", "view"
	case "settings-save":
		return "feedback-settings", "edit"
	default:
		return "feedback", "view"
	}
}

func feedbackAdapterError(err error) error {
	if err == nil {
		return nil
	}
	var known httperror.Error
	if errors.As(err, &known) {
		return err
	}
	return httperror.New(503, "feedback_unavailable", "Feedback storage is unavailable")
}

func (s *Server) authenticateConsoleFeedback(r *http.Request, scope string) (auth.Context, error) {
	return authenticateConsoleFeedbackRequest(r, s.auth, scope, s.verifyEnterpriseCredential)
}
func authenticateConsoleFeedbackRequest(r *http.Request, authenticator *auth.Authenticator, scope string, verify enterpriseCredentialVerifier) (auth.Context, error) {
	v, e := authenticator.Authenticate(r, auth.Requirement{AppCode: "console", SourceAppCode: "console", Scope: scope, StrictServiceClaims: true, RequireDeploymentBinding: true})
	if e != nil {
		return v, e
	}
	if v.Mode != string(config.AuthJWT) || v.ClientID != "console.runtime" || v.Subject != "client:console.runtime" || v.CredentialID <= 0 {
		return v, httperror.New(403, "feedback_source_invalid", "Exact Console runtime identity required")
	}
	active, e := verify(r.Context(), v, scope)
	if e != nil {
		return v, feedbackAdapterError(e)
	}
	if !active {
		return v, httperror.New(403, "feedback_credential_inactive", "Feedback credential or grant is inactive")
	}
	return v, nil
}
