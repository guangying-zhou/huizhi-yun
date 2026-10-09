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

type announcementPermit struct {
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
}
type announcementRequest struct {
	Payload       string             `json:"payload"`
	Authorization announcementPermit `json:"authorization"`
}

func announcementOperation(path string) (string, bool) {
	var op string
	for _, prefix := range []string{"/v1/console/announcements:", "/v1/enterprise/console/announcements:"} {
		if strings.HasPrefix(path, prefix) {
			op = strings.TrimPrefix(path, prefix)
		}
	}
	switch op {
	case "surfaces", "departments", "list", "detail", "read", "admin-list", "save", "withdraw", "delivery-claim", "delivery-ack", "deliver":
		return op, true
	}
	return "", false
}
func announcementCanonical(r *http.Request, in announcementRequest) string {
	p := in.Authorization
	return enterpriseAltocPermitFieldsCanonical([]any{"hzy-console-announcement-permit.v1", r.Method, r.URL.RequestURI(), r.Header.Get("Idempotency-Key"), p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.Operation, p.ExpiresAt, p.BundleVersion, p.BundleHash, p.PolicyRevision, in.Payload})
}
func validateAnnouncementPermit(r *http.Request, in announcementRequest, op, uid, tenant, deployment string, now time.Time) error {
	p := in.Authorization
	action := "view"
	if op == "departments" || op == "admin-list" || op == "save" || op == "withdraw" || op == "delivery-claim" || op == "delivery-ack" || op == "deliver" {
		action = "admin"
	}
	if p.ActorUID != uid || uid == "" || p.Tenant != tenant || p.Deployment != deployment || p.Resource != "announcements" || p.Action != action || p.Operation != op || p.BundleVersion == "" || p.BundleHash == "" || p.PolicyRevision == nil || *p.PolicyRevision < 0 || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return httperror.New(403, "announcement_permit_invalid", "Fresh announcement permission required")
	}
	token := runtimeBearerToken(r)
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(announcementCanonical(r, in)))
	if token == "" || !hmac.Equal([]byte(r.Header.Get("X-HZY-Announcement-Permit-Signature")), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return httperror.New(403, "announcement_permit_signature_invalid", "Invalid announcement permit")
	}
	return nil
}
func (s *Server) routeAnnouncements(r *http.Request, op string) (routeResult, error) {
	result := routeResult{Operation: "console.announcements." + op}
	if !strings.HasPrefix(r.URL.Path, "/v1/enterprise/") {
		return result, httperror.New(410, "announcement_host_required", "Use the Enterprise announcement entry")
	}
	if r.Method != http.MethodPost || r.URL.RawQuery != "" {
		return result, httperror.New(400, "announcement_request_invalid", "Fixed POST required")
	}
	var uid, tenant, deployment string
	if strings.HasPrefix(r.URL.Path, "/v1/enterprise/") {
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
			return result, httperror.New(503, "announcements_unavailable", "Enterprise unavailable")
		}
	} else {
		action := "view"
		if op == "departments" || op == "admin-list" || op == "save" || op == "withdraw" || op == "delivery-claim" || op == "delivery-ack" || op == "deliver" {
			action = "admin"
		}
		v, e := s.authenticateConsoleAnnouncements(r, "console:announcements:"+action)
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
	var in announcementRequest
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if e := decoder.Decode(&in); e != nil {
		return result, announcementInputError()
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return result, announcementInputError()
	}
	if e := validateAnnouncementPermit(r, in, op, uid, tenant, deployment, time.Now()); e != nil {
		return result, e
	}
	c, e := consoleapp.DecodeAnnouncementCommand(in.Payload)
	if e != nil {
		return result, e
	}
	adapter, e := s.requireConsole()
	if e != nil {
		return result, e
	}
	result.Body, e = adapter.Announcements(r.Context(), op, c, consoleapp.MutationMeta{ActorID: uid, IdempotencyKey: r.Header.Get("Idempotency-Key"), RequestID: requestID(r)})
	return result, announcementAdapterError(e)
}
func announcementInputError() error {
	return httperror.New(400, "announcement_input_invalid", "Invalid announcement input")
}

func (s *Server) routeAnnouncementDelivery(r *http.Request, ack bool) (routeResult, error) {
	result := routeResult{Operation: "console.announcements.delivery"}
	v, e := s.authenticateConsoleAnnouncements(r, "console:scheduler:execute")
	if e != nil {
		return result, e
	}
	result.Auth = &v
	if _, _, _, delegated := runtimeSignedActorContext(r); delegated {
		return result, httperror.New(403, "announcement_scheduler_actor_invalid", "Scheduler cannot carry a human actor")
	}
	if r.URL.RawQuery != "" {
		return result, announcementInputError()
	}
	adapter, e := s.requireConsole()
	if e != nil {
		return result, e
	}
	if ack {
		var in struct {
			Delivery consoleapp.AnnouncementDelivery `json:"delivery"`
			Success  bool                            `json:"success"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if e = decoder.Decode(&in); e != nil {
			return result, announcementInputError()
		}
		var trailing any
		if decoder.Decode(&trailing) != io.EOF {
			return result, announcementInputError()
		}
		result.Body, e = adapter.AckAnnouncementDelivery(r.Context(), in.Delivery, in.Success)
	} else {
		if e = validateDirectorySelfInput(r); e != nil {
			return result, e
		}
		result.Body, e = adapter.ClaimAnnouncementDelivery(r.Context())
	}
	return result, announcementAdapterError(e)
}

func announcementAdapterError(err error) error {
	if err == nil {
		return nil
	}
	var known httperror.Error
	if errors.As(err, &known) {
		return err
	}
	return httperror.New(503, "announcements_unavailable", "Announcement storage is unavailable")
}

func (s *Server) authenticateConsoleAnnouncements(r *http.Request, scope string) (auth.Context, error) {
	return authenticateConsoleAnnouncementRequest(r, s.auth, scope, s.verifyEnterpriseCredential)
}
func authenticateConsoleAnnouncementRequest(r *http.Request, authenticator *auth.Authenticator, scope string, verify enterpriseCredentialVerifier) (auth.Context, error) {
	v, e := authenticator.Authenticate(r, auth.Requirement{AppCode: "console", SourceAppCode: "console", Scope: scope, StrictServiceClaims: true, RequireDeploymentBinding: true})
	if e != nil {
		return v, e
	}
	if v.Mode != string(config.AuthJWT) || v.ClientID != "console.runtime" || v.Subject != "client:console.runtime" || v.CredentialID <= 0 {
		return v, httperror.New(403, "announcement_source_invalid", "Exact Console runtime identity required")
	}
	active, e := verify(r.Context(), v, scope)
	if e != nil {
		return v, announcementAdapterError(e)
	}
	if !active {
		return v, httperror.New(403, "announcement_credential_inactive", "Announcement credential or grant is inactive")
	}
	return v, nil
}
