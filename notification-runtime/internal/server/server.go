package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/auth"
	"github.com/huizhi-yun/notification-runtime/internal/capabilities"
	"github.com/huizhi-yun/notification-runtime/internal/config"
	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
	"github.com/huizhi-yun/notification-runtime/internal/deliveryledger"
	"github.com/huizhi-yun/notification-runtime/internal/diagnostics"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
	"github.com/huizhi-yun/notification-runtime/internal/identityhandoff"
	"github.com/huizhi-yun/notification-runtime/internal/peoplejobs"
	"github.com/huizhi-yun/notification-runtime/internal/providers"
	"github.com/huizhi-yun/notification-runtime/internal/version"
)

type Server struct {
	cfg           config.Config
	profile       RuntimeProfile
	auth          *auth.Authenticator
	provider      notificationProvider
	ledger        deliveryledger.Store
	requests      chan struct{}
	peopleJobs    *peoplejobs.Manager
	wecomHandoffs *identityhandoff.Store
}

func (s *Server) SetPeopleJobs(manager *peoplejobs.Manager)     { s.peopleJobs = manager }
func (s *Server) SetWeComHandoffs(store *identityhandoff.Store) { s.wecomHandoffs = store }

type RuntimeProfile struct {
	Product  string
	Version  string
	Registry capabilities.Registry
}

func NotificationProfile() RuntimeProfile {
	return RuntimeProfile{Product: "hzy-notification-runtime", Version: version.Version, Registry: capabilities.Current()}
}

func ConnectorProfile() RuntimeProfile {
	return RuntimeProfile{Product: "hzy-connector-runtime", Version: version.Version, Registry: capabilities.Connector()}
}

type notificationProvider interface {
	Send(context.Context, providers.SendRequest) (providers.SendResult, error)
}

type responseEnvelope struct {
	Code    int    `json:"code"`
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

func New(cfg config.Config) *Server {
	return NewWithStore(cfg, nil)
}

func NewWithStore(cfg config.Config, ledger deliveryledger.Store) *Server {
	console := consoleclient.New(cfg.Console)
	return NewWithDependencies(cfg, ledger, providers.NewWeComProvider(console))
}

func NewWithDependencies(cfg config.Config, ledger deliveryledger.Store, wecom notificationProvider) *Server {
	return NewWithProfileAndDependencies(cfg, NotificationProfile(), ledger, wecom)
}

func NewWithProfileAndDependencies(cfg config.Config, profile RuntimeProfile, ledger deliveryledger.Store, provider notificationProvider) *Server {
	return &Server{
		cfg:      cfg,
		profile:  profile,
		auth:     auth.New(cfg),
		provider: provider,
		ledger:   ledger,
		requests: make(chan struct{}, 128),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /runtime/health", s.health)
	mux.HandleFunc("GET /runtime/capabilities", s.capabilities)
	mux.HandleFunc("POST /v1/notifications/send", s.send)
	mux.HandleFunc("GET /v1/deliveries", s.listDeliveries)
	mux.HandleFunc("POST /v1/deliveries/{deliveryID}/reconcile", s.reconcileDelivery)
	if s.hasCapability("identity.wecom.exchange") {
		mux.HandleFunc("POST /v1/identity/wecom/exchange", s.exchangeWeComIdentity)
	}
	if s.hasCapability("identity.wecom.browser-login") {
		mux.HandleFunc("POST /v1/identity/wecom/authorizations", s.createWeComAuthorization)
		mux.HandleFunc("GET /v1/identity/wecom/callback", s.weComBrowserCallback)
		mux.HandleFunc("POST /v1/identity/wecom/handoffs/redeem", s.redeemWeComHandoff)
	}
	if s.hasCapability("identity.dingtalk.exchange") {
		mux.HandleFunc("POST /v1/identity/dingtalk/exchange", s.exchangeDingTalkIdentity)
	}
	if s.hasCapability("people.dingtalk.sync") {
		mux.HandleFunc("POST /v1/people-sync-jobs", s.startPeopleSyncJob)
		mux.HandleFunc("GET /v1/people-sync-jobs/{jobID}", s.getPeopleSyncJob)
		mux.HandleFunc("POST /v1/people-sync-jobs/{jobID}/cancel", s.cancelPeopleSyncJob)
		mux.HandleFunc("POST /v1/people-sync-jobs/{jobID}/retry", s.retryPeopleSyncJob)
	}
	if s.hasCapability("directory.dingtalk.profile-sync") {
		mux.HandleFunc("POST /v1/directory-profile-sync-jobs", s.startDirectoryProfileSyncJob)
	}
	if s.hasCapability("runtime.diagnostics.read") {
		mux.HandleFunc("GET /v1/diagnostics", s.diagnostics)
	}
	return s.withMiddleware(mux)
}

func (s *Server) diagnostics(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("runtime.diagnostics.read")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "diagnostics_caller_not_allowed", "Only Console can read Connector Runtime diagnostics"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	snapshot, err := diagnostics.Collect(ctx, s.cfg.Delivery.SQLitePath)
	if err != nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "diagnostics_unavailable", "Connector Runtime diagnostics are unavailable"))
		return
	}
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: map[string]any{
		"runtimeProduct": s.profile.Product,
		"version":        s.profile.Version,
		"tenant":         s.cfg.Tenant,
		"deployment":     s.cfg.Deployment,
		"metrics":        snapshot,
	}})
}

func (s *Server) startPeopleSyncJob(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("people.dingtalk.sync")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "people_sync_caller_not_allowed", "Only Console can start a People sync"))
		return
	}
	if s.peopleJobs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "people_sync_unavailable", "People sync job service is unavailable"))
		return
	}
	var input peoplejobs.StartRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid People sync request"))
		return
	}
	if err := validatePeopleJobCommand(actor, input.OriginalActorUID, input.IdempotencyKey, r.Header.Get("Idempotency-Key")); err != nil {
		writeError(w, err)
		return
	}
	if hasString(input.ObjectScopes, "directory_profiles") {
		writeError(w, httperror.New(http.StatusBadRequest, "directory_profile_scope_not_allowed", "Directory profile sync must use its dedicated endpoint"))
		return
	}
	job, created, err := s.peopleJobs.Start(r.Context(), input)
	if err != nil {
		if errors.Is(err, peoplejobs.ErrIdempotencyConflict) || errors.Is(err, peoplejobs.ErrJobAlreadyRunning) || errors.Is(err, peoplejobs.ErrStaleRevision) {
			writeError(w, httperror.New(http.StatusConflict, "people_sync_job_conflict", err.Error()))
			return
		}
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_people_sync_request", err.Error()))
		return
	}
	status := http.StatusAccepted
	if !created {
		status = http.StatusOK
	}
	writeJSON(w, status, responseEnvelope{Code: 0, Data: job})
}

func (s *Server) startDirectoryProfileSyncJob(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("directory.dingtalk.profile-sync")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "directory_profile_sync_caller_not_allowed", "Only Console can start a directory profile sync"))
		return
	}
	if s.peopleJobs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "directory_profile_sync_unavailable", "Directory profile sync job service is unavailable"))
		return
	}
	var input peoplejobs.StartRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid directory profile sync request"))
		return
	}
	input.Provider = "dingtalk"
	input.IntegrationCode = "dingtalk.default"
	input.ObjectScopes = []string{"directory_profiles"}
	job, created, err := s.peopleJobs.Start(r.Context(), input)
	if err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_directory_profile_sync_request", err.Error()))
		return
	}
	status := http.StatusAccepted
	if !created {
		status = http.StatusOK
	}
	writeJSON(w, status, responseEnvelope{Code: 0, Data: job})
}

func (s *Server) getPeopleSyncJob(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("people.sync.jobs.read")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" && actor.SourceApp != "people" {
		writeError(w, httperror.New(http.StatusForbidden, "people_sync_caller_not_allowed", "Only Console or People can read a People sync job"))
		return
	}
	if s.peopleJobs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "people_sync_unavailable", "People sync job service is unavailable"))
		return
	}
	job, ok, err := s.peopleJobs.Get(r.Context(), r.PathValue("jobID"))
	if err != nil {
		writeError(w, err)
		return
	}
	if !ok {
		writeError(w, httperror.New(http.StatusNotFound, "people_sync_job_not_found", "People sync job was not found"))
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" && hasString(job.ObjectScopes, "directory_profiles") {
		writeError(w, httperror.New(http.StatusForbidden, "directory_profile_job_caller_not_allowed", "Only Console can read a directory profile sync job"))
		return
	}
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: job})
}

func (s *Server) cancelPeopleSyncJob(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("people.sync.jobs.cancel")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "people_sync_caller_not_allowed", "Only Console can cancel a People sync job"))
		return
	}
	command, err := decodePeopleJobActionRequest(w, r)
	if err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_people_sync_action", "Invalid People sync action request"))
		return
	}
	if err = validatePeopleJobCommand(actor, command.OriginalActorUID, command.IdempotencyKey, r.Header.Get("Idempotency-Key")); err != nil {
		writeError(w, err)
		return
	}
	if s.peopleJobs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "people_sync_unavailable", "People sync job service is unavailable"))
		return
	}
	current, ok, err := s.peopleJobs.Get(r.Context(), r.PathValue("jobID"))
	if err != nil {
		writeError(w, err)
		return
	}
	if !ok {
		writeError(w, httperror.New(http.StatusNotFound, "people_sync_job_not_found", "People sync job was not found"))
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" && hasString(current.ObjectScopes, "directory_profiles") {
		writeError(w, httperror.New(http.StatusForbidden, "directory_profile_job_caller_not_allowed", "Only Console can cancel a directory profile sync job"))
		return
	}
	job, err := s.peopleJobs.CancelAs(r.Context(), r.PathValue("jobID"), command.OriginalActorUID, command.IdempotencyKey)
	if err != nil {
		switch {
		case errors.Is(err, peoplejobs.ErrJobNotFound):
			writeError(w, httperror.New(http.StatusNotFound, "people_sync_job_not_found", "People sync job was not found"))
		case errors.Is(err, peoplejobs.ErrJobNotCancellable):
			writeError(w, httperror.New(http.StatusConflict, "people_sync_job_not_cancellable", "People sync job is no longer pending or running"))
		case errors.Is(err, peoplejobs.ErrIdempotencyConflict):
			writeError(w, httperror.New(http.StatusConflict, "people_sync_job_idempotency_conflict", err.Error()))
		default:
			writeError(w, httperror.New(http.StatusServiceUnavailable, "people_sync_unavailable", "People sync job service is unavailable"))
		}
		return
	}
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: job})
}

func (s *Server) retryPeopleSyncJob(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("people.sync.jobs.retry")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "people_sync_caller_not_allowed", "Only Console can retry a People sync job"))
		return
	}
	command, err := decodePeopleJobActionRequest(w, r)
	if err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_people_sync_action", "Invalid People sync action request"))
		return
	}
	if err = validatePeopleJobCommand(actor, command.OriginalActorUID, command.IdempotencyKey, r.Header.Get("Idempotency-Key")); err != nil {
		writeError(w, err)
		return
	}
	if s.peopleJobs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "people_sync_unavailable", "People sync job service is unavailable"))
		return
	}
	current, ok, err := s.peopleJobs.Get(r.Context(), r.PathValue("jobID"))
	if err != nil {
		writeError(w, err)
		return
	}
	if !ok {
		writeError(w, httperror.New(http.StatusNotFound, "people_sync_job_not_found", "People sync job was not found"))
		return
	}
	if hasString(current.ObjectScopes, "directory_profiles") {
		writeError(w, httperror.New(http.StatusConflict, "directory_profile_job_retry_requires_dedicated_endpoint", "Directory profile sync jobs cannot be retried through the People endpoint"))
		return
	}
	job, created, err := s.peopleJobs.RetryAs(r.Context(), r.PathValue("jobID"), command.OriginalActorUID, command.IdempotencyKey)
	if err != nil {
		switch {
		case errors.Is(err, peoplejobs.ErrJobNotFound):
			writeError(w, httperror.New(http.StatusNotFound, "people_sync_job_not_found", "People sync job was not found"))
		case errors.Is(err, peoplejobs.ErrJobNotRetryable):
			writeError(w, httperror.New(http.StatusConflict, "people_sync_job_not_retryable", "Only a failed People sync job can be retried"))
		case errors.Is(err, peoplejobs.ErrIdempotencyConflict), errors.Is(err, peoplejobs.ErrJobAlreadyRunning), errors.Is(err, peoplejobs.ErrStaleRevision):
			writeError(w, httperror.New(http.StatusConflict, "people_sync_job_conflict", err.Error()))
		default:
			writeError(w, httperror.New(http.StatusServiceUnavailable, "people_sync_unavailable", "People sync job service is unavailable"))
		}
		return
	}
	status := http.StatusAccepted
	if !created {
		status = http.StatusOK
	}
	writeJSON(w, status, responseEnvelope{Code: 0, Data: job})
}

func decodePeopleJobActionRequest(w http.ResponseWriter, r *http.Request) (peoplejobs.ActionRequest, error) {
	var command peoplejobs.ActionRequest
	if r.Body == nil || r.ContentLength == 0 {
		return command, nil
	}
	if err := decodeStrictJSON(w, r, &command); err != nil {
		return peoplejobs.ActionRequest{}, err
	}
	return command, nil
}

func validatePeopleJobCommand(actor auth.Context, originalActorUID string, idempotencyKey string, headerIdempotencyKey string) error {
	originalActorUID = strings.TrimSpace(originalActorUID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	headerIdempotencyKey = strings.TrimSpace(headerIdempotencyKey)
	if actor.Mode != string(config.AuthJWT) {
		return nil
	}
	if originalActorUID == "" || len(originalActorUID) > 128 || strings.ContainsAny(originalActorUID, "\r\n\x00") {
		return httperror.New(http.StatusBadRequest, "people_sync_original_actor_required", "A valid original People administrator actor is required")
	}
	if len(idempotencyKey) < 16 || len(idempotencyKey) > 128 || strings.ContainsAny(idempotencyKey, "\r\n\x00") || headerIdempotencyKey != idempotencyKey {
		return httperror.New(http.StatusConflict, "people_sync_idempotency_binding_invalid", "People sync idempotency key must match the request header")
	}
	return nil
}

func hasString(values []string, wanted string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), wanted) {
			return true
		}
	}
	return false
}

type weComIdentityProvider interface {
	ExchangeIdentity(context.Context, providers.IdentityExchangeRequest) (providers.IdentityExchangeResult, error)
}

type weComAuthorizationRequest struct {
	IntegrationCode string `json:"integrationCode"`
	State           string `json:"state"`
}

type weComHandoffRequest struct {
	IntegrationCode string `json:"integrationCode"`
	HandoffTicket   string `json:"handoffTicket"`
}

func (s *Server) createWeComAuthorization(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("identity.wecom.exchange")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "identity_caller_not_allowed", "Only Console can create an enterprise login authorization"))
		return
	}
	if s.wecomHandoffs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "wecom_handoff_unavailable", "WeCom browser login handoff is unavailable"))
		return
	}
	var input weComAuthorizationRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid WeCom authorization body"))
		return
	}
	if input.IntegrationCode != "wecom.default" || !strings.HasPrefix(input.State, "hzy_es_") {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_wecom_authorization", "WeCom authorization request is invalid"))
		return
	}
	authorization, err := s.wecomHandoffs.Issue(r.Context(), actor.Tenant, actor.Deployment, input.State)
	if err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_wecom_authorization", "WeCom authorization request is invalid"))
		return
	}
	writeJSON(w, http.StatusCreated, responseEnvelope{Code: 0, Data: map[string]any{
		"authorizationId": authorization.ID,
		"expiresAt":       authorization.ExpiresAt.Format(time.RFC3339Nano),
	}})
}

func (s *Server) weComBrowserCallback(w http.ResponseWriter, r *http.Request) {
	if s.wecomHandoffs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "wecom_handoff_unavailable", "WeCom browser login handoff is unavailable"))
		return
	}
	authorizationID := strings.TrimSpace(r.URL.Query().Get("authorizationId"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" || len(code) > 512 {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_authorization_code", "WeCom authorization code is invalid"))
		return
	}
	if _, err := s.wecomHandoffs.BeginCallback(r.Context(), authorizationID, state); err != nil {
		writeError(w, handoffHTTPError(err))
		return
	}
	provider, ok := s.provider.(weComIdentityProvider)
	if !ok {
		s.wecomHandoffs.Fail(r.Context(), authorizationID)
		s.redirectWeComCallback(w, r, state, "", "identity_provider_unavailable")
		return
	}
	ctx := r.Context()
	if s.cfg.HTTP.RequestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.HTTP.RequestTimeout)
		defer cancel()
	}
	result, err := provider.ExchangeIdentity(ctx, providers.IdentityExchangeRequest{
		IntegrationCode: "wecom.default", AuthorizationCode: code,
	})
	if err != nil || result.Provider != "wecom" || result.IntegrationCode != "wecom.default" || result.Subject.Kind != "member" || strings.TrimSpace(result.Subject.ID) == "" {
		s.wecomHandoffs.Fail(r.Context(), authorizationID)
		s.redirectWeComCallback(w, r, state, "", "identity_exchange_failed")
		return
	}
	ticket, err := s.wecomHandoffs.Complete(r.Context(), authorizationID, result.Subject.ID)
	if err != nil {
		s.wecomHandoffs.Fail(r.Context(), authorizationID)
		s.redirectWeComCallback(w, r, state, "", "identity_handoff_failed")
		return
	}
	s.redirectWeComCallback(w, r, state, ticket, "")
}

func (s *Server) redeemWeComHandoff(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("identity.wecom.exchange")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "identity_caller_not_allowed", "Only Console can redeem an enterprise login handoff"))
		return
	}
	if s.wecomHandoffs == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "wecom_handoff_unavailable", "WeCom browser login handoff is unavailable"))
		return
	}
	var input weComHandoffRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid WeCom handoff body"))
		return
	}
	if input.IntegrationCode != "wecom.default" {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_wecom_handoff", "WeCom handoff request is invalid"))
		return
	}
	subject, err := s.wecomHandoffs.Redeem(r.Context(), actor.Tenant, actor.Deployment, input.HandoffTicket)
	if err != nil {
		writeError(w, handoffHTTPError(err))
		return
	}
	result := providers.IdentityExchangeResult{Provider: "wecom", IntegrationCode: "wecom.default"}
	result.Subject.ID = subject
	result.Subject.Kind = "member"
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: result})
}

func (s *Server) redirectWeComCallback(w http.ResponseWriter, r *http.Request, state, ticket, failure string) {
	base, err := url.Parse(strings.TrimSpace(s.cfg.Console.BaseURL))
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "console_callback_unavailable", "Console callback URL is unavailable"))
		return
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/auth/wecom-callback"
	query := base.Query()
	query.Set("state", state)
	if ticket != "" {
		query.Set("handoffTicket", ticket)
	}
	if failure != "" {
		query.Set("error", failure)
	}
	base.RawQuery = query.Encode()
	base.Fragment = ""
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, base.String(), http.StatusFound)
}

func handoffHTTPError(err error) error {
	switch {
	case errors.Is(err, identityhandoff.ErrBindingMismatch):
		return httperror.New(http.StatusForbidden, "wecom_handoff_binding_mismatch", "WeCom login handoff binding does not match")
	case errors.Is(err, identityhandoff.ErrExpired):
		return httperror.New(http.StatusBadRequest, "wecom_handoff_expired", "WeCom login handoff expired")
	case errors.Is(err, identityhandoff.ErrAlreadyUsed):
		return httperror.New(http.StatusConflict, "wecom_handoff_used", "WeCom login handoff was already used")
	default:
		return httperror.New(http.StatusBadRequest, "invalid_wecom_handoff", "WeCom login handoff is invalid")
	}
}

func (s *Server) exchangeWeComIdentity(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("identity.wecom.exchange")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "identity_caller_not_allowed", "Only Console can exchange an enterprise login identity"))
		return
	}
	var input providers.IdentityExchangeRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid identity exchange body"))
		return
	}
	provider, ok := s.provider.(weComIdentityProvider)
	if !ok {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "identity_provider_unavailable", "WeCom identity provider is unavailable"))
		return
	}
	ctx := r.Context()
	if s.cfg.HTTP.RequestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.HTTP.RequestTimeout)
		defer cancel()
	}
	result, err := provider.ExchangeIdentity(ctx, input)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: result})
}

type dingTalkIdentityProvider interface {
	ExchangeDingTalkIdentity(context.Context, providers.DingTalkIdentityExchangeRequest) (providers.IdentityExchangeResult, error)
}

func (s *Server) exchangeDingTalkIdentity(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("identity.dingtalk.exchange")})
	if err != nil {
		writeError(w, err)
		return
	}
	if actor.Mode == string(config.AuthJWT) && actor.SourceApp != "console" {
		writeError(w, httperror.New(http.StatusForbidden, "identity_caller_not_allowed", "Only Console can exchange an enterprise login identity"))
		return
	}
	var input providers.DingTalkIdentityExchangeRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid identity exchange body"))
		return
	}
	provider, ok := s.provider.(dingTalkIdentityProvider)
	if !ok {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "identity_provider_unavailable", "DingTalk identity provider is unavailable"))
		return
	}
	ctx := r.Context()
	if s.cfg.HTTP.RequestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.HTTP.RequestTimeout)
		defer cancel()
	}
	result, err := provider.ExchangeDingTalkIdentity(ctx, input)
	if err != nil {
		code, _ := safeError(err)
		log.Printf("[connector-runtime] dingtalk identity exchange failed code=%s", code)
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: result})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	storeStatus := "ready"
	status := http.StatusOK
	if s.ledger == nil {
		storeStatus = "unavailable"
		status = http.StatusServiceUnavailable
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		if err := s.ledger.Ready(ctx); err != nil {
			storeStatus = "unavailable"
			status = http.StatusServiceUnavailable
		}
		cancel()
	}
	providerCodes := make([]string, 0, len(s.profile.Registry.Providers))
	for _, provider := range s.profile.Registry.Providers {
		providerCodes = append(providerCodes, provider.Code)
	}
	writeJSON(w, status, responseEnvelope{
		Code: 0,
		Data: map[string]any{
			"status":            "ok",
			"version":           s.profile.Version,
			"runtimeProduct":    s.profile.Product,
			"tenant":            s.cfg.Tenant,
			"deployment":        s.cfg.Deployment,
			"authMode":          s.cfg.Auth.Mode,
			"providers":         providerCodes,
			"deliveryStore":     storeStatus,
			"deliveryStoreType": s.cfg.Delivery.Type,
		},
	})
}

func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	registry := s.profile.Registry
	scopes := make([]string, 0, len(registry.Capabilities))
	for _, capability := range registry.Capabilities {
		scopes = append(scopes, capability.RequiredScope)
	}
	channels := []string{"wecom"}
	if s.profile.Product == "hzy-connector-runtime" {
		channels = append(channels, "dingtalk")
	}
	writeJSON(w, http.StatusOK, responseEnvelope{
		Code: 0,
		Data: map[string]any{
			"schemaVersion":      registry.SchemaVersion,
			"runtimeProduct":     registry.RuntimeProduct,
			"migrationTarget":    registry.MigrationTarget,
			"arbitraryHttpProxy": registry.ArbitraryHTTPProxy,
			"providers":          registry.Providers,
			"capabilities":       registry.Capabilities,
			"channels":           channels,
			"messageTypes":       []string{"textcard"},
			"scopes":             scopes,
		},
	})
}

func (s *Server) listDeliveries(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("deliveries.read")})
	if err != nil {
		writeError(w, err)
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			writeError(w, httperror.New(http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 100"))
			return
		}
	}
	state := deliveryledger.State(strings.TrimSpace(r.URL.Query().Get("status")))
	if state != "" && state != deliveryledger.StateProcessing && state != deliveryledger.StateSucceeded && state != deliveryledger.StateFailed && state != deliveryledger.StatePartialUnknown {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_delivery_filter", "Delivery status filter is invalid"))
		return
	}
	beforeID, err := decodeDeliveryCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_cursor", "cursor is invalid"))
		return
	}
	if s.ledger == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_store_unavailable", "Notification delivery store is unavailable"))
		return
	}
	result, err := s.ledger.List(r.Context(), deliveryledger.ListInput{
		Tenant: actor.Tenant, Deployment: actor.Deployment, State: state, Limit: limit, BeforeID: beforeID,
	})
	if err != nil {
		if errors.Is(err, deliveryledger.ErrInvalidQuery) {
			writeError(w, httperror.New(http.StatusBadRequest, "invalid_delivery_filter", "Delivery status filter is invalid"))
		} else {
			writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_store_unavailable", "Notification delivery store is unavailable"))
		}
		return
	}
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: map[string]any{
		"items": result.Deliveries, "nextCursor": encodeDeliveryCursor(result.NextID),
	}})
}

type reconcileDeliveryRequest struct {
	ExpectedStatus    string `json:"expectedStatus"`
	Result            string `json:"result"`
	Reason            string `json:"reason"`
	ProviderMessageID string `json:"providerMessageId"`
	Evidence          struct {
		Type      string `json:"type"`
		Reference string `json:"reference"`
	} `json:"evidence"`
}

func (s *Server) reconcileDelivery(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("deliveries.reconcile")})
	if err != nil {
		writeError(w, err)
		return
	}
	deliveryID, err := strconv.ParseInt(r.PathValue("deliveryID"), 10, 64)
	if err != nil || deliveryID <= 0 {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_delivery_id", "deliveryId must be a positive integer"))
		return
	}
	var input reconcileDeliveryRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid reconciliation body"))
		return
	}
	if s.ledger == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_store_unavailable", "Notification delivery store is unavailable"))
		return
	}
	result, err := s.ledger.Reconcile(r.Context(), deliveryledger.ReconcileInput{
		Tenant: actor.Tenant, Deployment: actor.Deployment, DeliveryID: deliveryID,
		ExpectedState:  deliveryledger.State(strings.TrimSpace(input.ExpectedStatus)),
		Result:         deliveryledger.State(strings.TrimSpace(input.Result)),
		ActorSourceApp: actor.SourceApp, ActorClientID: first(actor.ClientID, actor.Subject), ActorSubject: actor.Subject,
		Reason: input.Reason, EvidenceType: input.Evidence.Type, EvidenceReference: input.Evidence.Reference,
		ProviderMessageID: strings.TrimSpace(input.ProviderMessageID),
	})
	if err != nil {
		switch {
		case errors.Is(err, deliveryledger.ErrInvalidEvidence):
			writeError(w, httperror.New(http.StatusBadRequest, "invalid_reconciliation_evidence", "Reconciliation requires expectedStatus=partial_unknown, a succeeded or failed result, reason, and evidence"))
		case errors.Is(err, deliveryledger.ErrDeliveryNotFound):
			writeError(w, httperror.New(http.StatusNotFound, "delivery_not_found", "Delivery was not found in this tenant and deployment"))
		case errors.Is(err, deliveryledger.ErrInvalidState):
			writeError(w, httperror.New(http.StatusConflict, "delivery_state_conflict", "Only the current partial_unknown state can be reconciled"))
		default:
			writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_store_unavailable", "Notification delivery store is unavailable"))
		}
		return
	}
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: map[string]any{
		"delivery":       result.Delivery,
		"reconciliation": map[string]any{"auditId": result.AuditID, "result": result.Delivery.State},
	}})
}

func encodeDeliveryCursor(id int64) string {
	if id <= 0 {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString([]byte("v1:" + strconv.FormatInt(id, 10)))
}

func decodeDeliveryCursor(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || !strings.HasPrefix(string(decoded), "v1:") {
		return 0, errors.New("invalid delivery cursor")
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(string(decoded), "v1:"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid delivery cursor")
	}
	return id, nil
}

func (s *Server) send(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: s.capabilityScope("notifications.send")})
	if err != nil {
		writeError(w, err)
		return
	}

	var input providers.SendRequest
	if err := decodeStrictJSON(w, r, &input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid JSON body"))
		return
	}
	input, err = providers.ValidateSendBoundary(input, actor.SourceApp)
	if err != nil {
		writeError(w, err)
		return
	}
	if s.ledger == nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_store_unavailable", "Notification delivery store is unavailable"))
		return
	}

	ctx := r.Context()
	if s.cfg.HTTP.RequestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.HTTP.RequestTimeout)
		defer cancel()
	}
	requestHash, err := canonicalRequestHash(input)
	if err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_notification_request", "Notification request cannot be normalized"))
		return
	}
	leaseOwner, err := newLeaseOwner()
	if err != nil {
		writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_claim_unavailable", "Notification delivery claim is unavailable"))
		return
	}
	leaseDuration := s.cfg.Delivery.LeaseDuration
	if leaseDuration <= 0 {
		leaseDuration = 2 * time.Minute
	}
	claim, err := s.ledger.Claim(ctx, deliveryledger.ClaimInput{
		Identity: deliveryledger.Identity{
			Tenant: actor.Tenant, Deployment: actor.Deployment,
			SourceApp: input.SourceAppCode, SourceClientID: first(actor.ClientID, actor.Subject), IdempotencyKey: input.IdempotencyKey,
		},
		RequestHash: requestHash, Provider: input.Channel, Integration: input.IntegrationCode,
		LeaseOwner: leaseOwner, LeaseDuration: leaseDuration,
	})
	if err != nil {
		if errors.Is(err, deliveryledger.ErrPayloadMismatch) {
			writeError(w, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "Idempotency key is already bound to a different notification request"))
		} else {
			writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_store_unavailable", "Notification delivery store is unavailable"))
		}
		return
	}
	switch claim.Decision {
	case deliveryledger.DecisionReplaySucceeded:
		var replay providers.SendResult
		if len(claim.ResultJSON) == 0 || json.Unmarshal(claim.ResultJSON, &replay) != nil {
			writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_replay_unavailable", "Stored delivery result is unavailable"))
			return
		}
		replay.Replayed = true
		writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: replay})
		return
	case deliveryledger.DecisionInProgress:
		writeError(w, httperror.New(http.StatusConflict, "delivery_in_progress", "Notification delivery is already processing"))
		return
	case deliveryledger.DecisionPartialUnknown:
		writeError(w, httperror.New(http.StatusConflict, "delivery_outcome_unknown", "Notification delivery outcome is unknown and requires reconciliation"))
		return
	case deliveryledger.DecisionExecute:
	default:
		writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_claim_invalid", "Notification delivery claim is invalid"))
		return
	}

	completion := deliveryledger.Completion{DeliveryID: claim.DeliveryID, LeaseOwner: leaseOwner, Fencing: claim.Fencing}
	result, err := s.provider.Send(ctx, input)
	if err != nil {
		completion.ErrorCode, completion.ErrorSummary = safeError(err)
		checkpointContext, cancelCheckpoint := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelCheckpoint()
		var checkpointErr error
		if providers.IsDeliveryOutcomeUnknown(err) {
			checkpointErr = s.ledger.MarkUnknown(checkpointContext, completion)
		} else {
			checkpointErr = s.ledger.Fail(checkpointContext, completion)
		}
		if checkpointErr != nil {
			writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_checkpoint_failed", "Notification delivery checkpoint failed"))
			return
		}
		writeError(w, err)
		return
	}
	result = publicReplayResult(result)
	resultJSON, err := json.Marshal(result)
	if err != nil {
		completion.ErrorCode = "result_encoding_failed"
		completion.ErrorSummary = "Provider delivery result could not be encoded"
		checkpointContext, cancelCheckpoint := context.WithTimeout(context.Background(), 5*time.Second)
		_ = s.ledger.MarkUnknown(checkpointContext, completion)
		cancelCheckpoint()
		writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_checkpoint_failed", "Notification delivery checkpoint failed"))
		return
	}
	completion.ResultJSON = resultJSON
	checkpointContext, cancelCheckpoint := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelCheckpoint()
	if err := s.ledger.Succeed(checkpointContext, completion); err != nil {
		completion.ResultJSON = nil
		completion.ErrorCode = "success_checkpoint_failed"
		completion.ErrorSummary = "Provider succeeded but the durable success checkpoint failed"
		_ = s.ledger.MarkUnknown(checkpointContext, completion)
		writeError(w, httperror.New(http.StatusServiceUnavailable, "delivery_checkpoint_failed", "Notification delivery checkpoint failed"))
		return
	}

	log.Printf("notification sent provider=%s integration=%s client=%s subject=%s", result.Provider, result.IntegrationCode, actor.ClientID, actor.Subject)
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: result})
}

func decodeStrictJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}

func (s *Server) capabilityScope(code string) string {
	for _, capability := range s.profile.Registry.Capabilities {
		if capability.Code == code {
			return capability.RequiredScope
		}
	}
	return "unregistered-capability"
}

func (s *Server) hasCapability(code string) bool {
	for _, capability := range s.profile.Registry.Capabilities {
		if capability.Code == code {
			return true
		}
	}
	return false
}

func publicReplayResult(result providers.SendResult) providers.SendResult {
	public := make(map[string]any)
	for _, key := range []string{"errcode", "msgid", "processQueryKey", "filteredCount"} {
		value, ok := result.ProviderResult[key]
		if !ok {
			continue
		}
		switch item := value.(type) {
		case string:
			public[key] = limitText(item, 191)
		case float64, int, int64, uint64, json.Number:
			public[key] = item
		}
	}
	return providers.SendResult{
		Provider:        limitText(result.Provider, 32),
		IntegrationCode: limitText(result.IntegrationCode, 128),
		ProviderResult:  public,
		Replayed:        result.Replayed,
	}
}

func canonicalRequestHash(input providers.SendRequest) (string, error) {
	canonical := struct {
		Channel         string `json:"channel"`
		IntegrationCode string `json:"integrationCode"`
		ToUser          string `json:"touser"`
		Title           string `json:"title"`
		Description     string `json:"description"`
		URL             string `json:"url"`
		ButtonText      string `json:"btntxt"`
	}{input.Channel, input.IntegrationCode, fmt.Sprint(input.ToUser), input.Title, input.Description, input.URL, input.ButtonText}
	body, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256(body)), nil
}

func newLeaseOwner() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", value), nil
}

func safeError(err error) (string, string) {
	var httpError *httperror.Error
	if errors.As(err, &httpError) {
		return limitText(httpError.Code, 96), "Notification provider request failed"
	}
	return "provider_error", "Notification provider request failed"
}

func limitText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len(value) > maximum {
		return value[:maximum]
	}
	return value
}

func first(values ...string) string {
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return "unknown"
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) {
	var httpError *httperror.Error
	if errors.As(err, &httpError) {
		writeJSON(w, httpError.Status, responseEnvelope{
			Code:    -1,
			Message: httpError.Message,
			Data: map[string]string{
				"error": httpError.Code,
			},
		})
		return
	}
	writeJSON(w, http.StatusInternalServerError, responseEnvelope{
		Code:    -1,
		Message: err.Error(),
		Data: map[string]string{
			"error": "internal_error",
		},
	})
}
