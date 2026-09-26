package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/policyenvelope"
)

var verifiedPolicyETag = regexp.MustCompile(`^[a-f0-9]{64}$`)

var verifiedPolicyRenewalStates = map[string]bool{policyenvelope.RenewalOK: true, policyenvelope.RenewalPlatformUnavailable: true, policyenvelope.RenewalRefused: true, policyenvelope.RenewalInvalid: true}

// verifiedPolicyRead is the Runtime receipt plus the syncer's last renewal
// outcome. Renewal is Runtime-timed metadata, never part of the signed receipt.
type verifiedPolicyRead struct {
	policyenvelope.Snapshot
	Renewal *policyenvelope.Renewal `json:"renewal"`
}

func (s *Server) routeVerifiedPolicy(r *http.Request) (routeResult, error) {
	reader := r.URL.Path == "/v1/enterprise/console-policy"
	renewal := r.URL.Path == "/v1/console/verified-policy/renewal"
	source := "console"
	if reader {
		if r.Method != http.MethodGet {
			return routeResult{}, httperror.New(405, "method_not_allowed", "Policy reader is read-only")
		}
		source = "enterprise"
	}
	if renewal && r.Method != http.MethodPut {
		return routeResult{}, httperror.New(405, "method_not_allowed", "Policy renewal state is write-only")
	}
	scope := "console:policy-bundle:read"
	if r.Method == http.MethodPut {
		scope = "console:policy-bundle:write"
	}
	identity, err := s.auth.Authenticate(r, auth.Requirement{AppCode: source, SourceAppCode: source, Scope: scope, StrictServiceClaims: true, RequireDeploymentBinding: true})
	if err != nil {
		return routeResult{}, err
	}
	if identity.Mode != string(config.AuthJWT) {
		return routeResult{}, httperror.New(403, "policy_service_jwt_required", "Service JWT required")
	}
	cfg := s.cfg.Apps.Console.PolicyEnvelope
	storageDeployment := identity.Deployment
	if reader {
		storageDeployment = s.cfg.DeploymentBindings["console"]
		if !cfg.EnterpriseReadEnabled || storageDeployment == "" {
			return routeResult{}, httperror.New(503, "policy_reader_not_configured", "Policy reader is not configured")
		}
	}
	if err := s.verifiedPolicyConfigured(); err != nil {
		return routeResult{}, err
	}
	if r.URL.RawQuery != "" {
		return routeResult{}, httperror.New(400, "policy_snapshot_invalid", "Invalid policy request")
	}
	adapter, err := s.requireConsole()
	if err != nil {
		return routeResult{}, err
	}
	state, err := adapter.VerifyOIDCServiceTokenState(r.Context(), map[string]any{"clientId": identity.ClientID, "credentialId": identity.CredentialID, "scope": scope})
	if err != nil {
		var known httperror.Error
		if errors.As(err, &known) && (known.Status == 401 || known.Status == 403) {
			return routeResult{}, err
		}
		return routeResult{}, httperror.New(503, "policy_snapshot_unavailable", "Policy storage unavailable")
	}
	if state["active"] != true {
		return routeResult{}, httperror.New(403, "policy_credential_inactive", "Policy credential or grant inactive")
	}
	store := s.verifiedPolicyStore(adapter.DB(), identity.Tenant, storageDeployment)
	if renewal {
		body, _, readErr := readJSONBodyWithRawLimit(r, 1024)
		if readErr != nil {
			return routeResult{}, readErr
		}
		state, stateOK := body["state"].(string)
		expected, etagOK := body["expectedEtag"].(string)
		if len(body) != 2 || !stateOK || !verifiedPolicyRenewalStates[state] || !etagOK || !verifiedPolicyETag.MatchString(expected) {
			return routeResult{}, httperror.New(400, "policy_renewal_invalid", "Invalid policy renewal request")
		}
		recorded, recordErr := store.RecordRenewal(r.Context(), state, expected)
		switch {
		case recordErr == nil:
			return routeResult{Operation: scope, Auth: &identity, Body: map[string]any{"code": 0, "data": map[string]any{"etag": expected, "renewal": recorded}}}, nil
		case errors.Is(recordErr, policyenvelope.ErrNotFound):
			return routeResult{}, httperror.New(404, "policy_snapshot_missing", "Policy snapshot has not been initialized")
		case errors.Is(recordErr, policyenvelope.ErrConflict):
			return routeResult{}, httperror.New(409, "policy_snapshot_conflict", "Policy snapshot changed")
		case errors.Is(recordErr, policyenvelope.ErrRenewalNotMigrated):
			return routeResult{}, httperror.New(503, "policy_renewal_not_migrated", "Policy renewal storage is not migrated")
		default:
			return routeResult{}, httperror.New(503, "policy_snapshot_unavailable", "Policy storage unavailable")
		}
	}
	var snapshot policyenvelope.Snapshot
	var renewalState *policyenvelope.Renewal
	if r.Method == http.MethodGet {
		snapshot, renewalState, err = store.ReadWithRenewal(r.Context())
	} else {
		body, _, readErr := readJSONBodyWithRawLimit(r, (8<<20)+2048)
		if readErr != nil {
			return routeResult{}, readErr
		}
		expected, ok := body["expectedEtag"].(string)
		if len(body) != 2 || !ok || (expected != "" && !verifiedPolicyETag.MatchString(expected)) {
			return routeResult{}, httperror.New(400, "policy_snapshot_invalid", "Invalid policy request")
		}
		raw, _ := json.Marshal(body["envelope"])
		context := store.Binding
		context.AllowInactive = true
		if _, verifyErr := policyenvelope.Verify(raw, store.KID, store.PublicKey, context); verifyErr != nil {
			return routeResult{}, httperror.New(400, "policy_envelope_invalid", "Invalid policy envelope")
		}
		var envelope policyenvelope.Envelope
		_ = json.Unmarshal(raw, &envelope)
		snapshot, err = store.Write(r.Context(), envelope, expected)
	}
	if err != nil {
		if !reader && errors.Is(err, policyenvelope.ErrNotFound) {
			return routeResult{}, httperror.New(404, "policy_snapshot_missing", "Policy snapshot has not been initialized")
		}
		if errors.Is(err, policyenvelope.ErrConflict) {
			return routeResult{}, httperror.New(409, "policy_snapshot_conflict", "Policy snapshot changed")
		}
		if errors.Is(err, policyenvelope.ErrInvalid) {
			return routeResult{}, httperror.New(400, "policy_envelope_invalid", "Invalid policy envelope")
		}
		return routeResult{}, httperror.New(503, "policy_snapshot_unavailable", "Policy storage unavailable")
	}
	if reader {
		// Projection is bound to the real caller, while durable ownership remains
		// Console. Both deployments must be in the same signed envelope.
		// Authenticity as of issuance, then today's lifecycle under the shared
		// outage-grace rule (EvaluateValidity) with the syncer's renewal state.
		context := store.Binding
		context.Deployment = identity.Deployment
		raw, _ := json.Marshal(snapshot.Envelope)
		body, err := policyenvelope.VerifyAuthenticity(raw, store.KID, store.PublicKey, context)
		validity := policyenvelope.EvaluateValidity(body, renewalState, time.Now().UnixMilli())
		if err != nil || (validity.Verdict != "valid" && validity.Verdict != "grace") {
			return routeResult{}, httperror.New(503, "policy_reader_unavailable", "Current policy is unavailable for this deployment")
		}
		snapshot.Deployment = identity.Deployment
	}
	if r.Method == http.MethodGet {
		return routeResult{Operation: scope, Auth: &identity, Body: map[string]any{"code": 0, "data": verifiedPolicyRead{Snapshot: snapshot, Renewal: renewalState}}}, nil
	}
	return routeResult{Operation: scope, Auth: &identity, Body: map[string]any{"code": 0, "data": snapshot}}, nil
}

// verifiedPolicyConfigured checks the local trust configuration shared by the
// policy routes and the Console service assertion verifier.
func (s *Server) verifiedPolicyConfigured() error {
	cfg := s.cfg.Apps.Console.PolicyEnvelope
	issuer, parseErr := url.Parse(s.cfg.Control.PlatformURL)
	age, limit := s.verifiedPolicyMaxAge()
	if !cfg.Enabled || (cfg.Environment != "prod" && cfg.Environment != "test" && cfg.Environment != "dev") || age < 1000 || age > limit || parseErr != nil || issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil || issuer.Path != "" || issuer.RawQuery != "" || issuer.Fragment != "" || s.cfg.Control.PlatformSigningKeyID == "" || s.cfg.Control.PlatformSigningPublicKey == "" {
		return httperror.New(503, "policy_snapshot_not_configured", "Verified policy storage is not configured")
	}
	return nil
}

// Consumers accept the 60-minute signed lease; test keeps its own window.
func (s *Server) verifiedPolicyMaxAge() (int64, int64) {
	cfg := s.cfg.Apps.Console.PolicyEnvelope
	age := cfg.MaxAgeMS
	if age == 0 {
		age = policyenvelope.LongMaxAgeMS
	}
	limit := policyenvelope.LongMaxAgeMS
	if cfg.Environment == "test" {
		limit = policyenvelope.TestMaxAgeMS
	}
	return age, limit
}

func (s *Server) verifiedPolicyStore(db *sql.DB, tenant, deployment string) policyenvelope.Store {
	age, _ := s.verifiedPolicyMaxAge()
	return policyenvelope.Store{DB: db, KID: s.cfg.Control.PlatformSigningKeyID, PublicKey: s.cfg.Control.PlatformSigningPublicKey, Binding: policyenvelope.Context{Issuer: s.cfg.Control.PlatformURL, Tenant: tenant, Environment: s.cfg.Apps.Console.PolicyEnvelope.Environment, Deployment: deployment, MaxAgeMS: age, Now: time.Now().UnixMilli()}}
}
