package server

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type consoleOIDCSigningBootstrapPayload struct {
	JTI            string `json:"jti"`
	TenantCode     string `json:"tenantCode"`
	DeploymentCode string `json:"deploymentCode"`
	RuntimeCode    string `json:"runtimeCode"`
	Reason         string `json:"reason"`
	Issuer         string `json:"issuer"`
	JWKSURL        string `json:"jwksUrl"`
	IssuedAt       string `json:"issuedAt"`
	ExpiresAt      string `json:"expiresAt"`
}

func consoleJWTTrust(payload consoleOIDCSigningBootstrapPayload) (config.JWTConfig, error) {
	issuerText := strings.TrimRight(strings.TrimSpace(payload.Issuer), "/")
	jwksText := strings.TrimSpace(payload.JWKSURL)
	issuer, issuerErr := url.Parse(issuerText)
	jwks, jwksErr := url.Parse(jwksText)
	if issuerErr != nil || jwksErr != nil ||
		issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil ||
		jwks.Scheme != "https" || jwks.Host == "" || jwks.User != nil {
		return config.JWTConfig{}, httperror.New(http.StatusBadRequest, "console_oidc_bootstrap_jwt_trust_invalid", "Console OIDC bootstrap JWT trust URLs are invalid")
	}
	hostname := strings.ToLower(issuer.Hostname())
	ip := net.ParseIP(hostname)
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") ||
		(ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast())) {
		return config.JWTConfig{}, httperror.New(http.StatusBadRequest, "console_oidc_bootstrap_jwt_trust_private", "Console OIDC bootstrap JWT issuer must be public")
	}
	expectedJWKS := *issuer
	expectedJWKS.Path = "/.well-known/jwks.json"
	expectedJWKS.RawPath = ""
	expectedJWKS.RawQuery = ""
	expectedJWKS.Fragment = ""
	if jwks.String() != expectedJWKS.String() {
		return config.JWTConfig{}, httperror.New(http.StatusBadRequest, "console_oidc_bootstrap_jwks_mismatch", "Console OIDC bootstrap JWKS URL must match the tenant issuer")
	}
	return config.JWTConfig{
		Issuer:   issuerText,
		Audience: "data-runtime",
		JWKSURL:  jwksText,
	}, nil
}

func (s *Server) bootstrapConsoleOIDCSigningKey(ctx context.Context, body map[string]any) (map[string]any, error) {
	adapter, err := s.requireConsole()
	if err != nil {
		return nil, err
	}
	s.vaultBootstrapMu.Lock()
	defer s.vaultBootstrapMu.Unlock()

	schemaVersion := strings.TrimSpace(stringValue(body["schemaVersion"]))
	payloadEncoded := strings.TrimSpace(stringValue(body["payload"]))
	signatureEncoded := strings.TrimSpace(stringValue(body["signature"]))
	kid := strings.TrimSpace(stringValue(body["kid"]))
	alg := strings.TrimSpace(stringValue(body["alg"]))
	if schemaVersion != "console-oidc-signing-bootstrap.v1" || payloadEncoded == "" ||
		signatureEncoded == "" || kid == "" || alg != "Ed25519" {
		return nil, httperror.New(http.StatusBadRequest, "console_oidc_bootstrap_envelope_invalid", "Console OIDC signing bootstrap envelope is invalid")
	}
	if kid != strings.TrimSpace(s.cfg.Control.PlatformSigningKeyID) {
		return nil, httperror.New(http.StatusForbidden, "console_oidc_bootstrap_kid_mismatch", "Console OIDC bootstrap signing key does not match this Runtime")
	}
	publicKey, err := parseConsoleVaultBootstrapPublicKey(s.cfg.Control.PlatformSigningPublicKey)
	if err != nil {
		return nil, err
	}
	payloadBytes, decodeErr := base64.RawURLEncoding.DecodeString(payloadEncoded)
	signature, signatureErr := base64.RawURLEncoding.DecodeString(signatureEncoded)
	if decodeErr != nil || signatureErr != nil || !ed25519.Verify(publicKey, payloadBytes, signature) {
		return nil, httperror.New(http.StatusForbidden, "console_oidc_bootstrap_signature_invalid", "Console OIDC bootstrap signature is invalid")
	}

	var payload consoleOIDCSigningBootstrapPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "console_oidc_bootstrap_payload_invalid", "Console OIDC bootstrap payload is invalid")
	}
	now := time.Now().UTC()
	issuedAt, issuedErr := time.Parse(time.RFC3339, strings.TrimSpace(payload.IssuedAt))
	expiresAt, expiryErr := time.Parse(time.RFC3339, strings.TrimSpace(payload.ExpiresAt))
	if issuedErr != nil || expiryErr != nil || expiresAt.Before(now) {
		return nil, httperror.New(http.StatusGone, "console_oidc_bootstrap_expired", "Console OIDC bootstrap envelope has expired")
	}
	if issuedAt.After(now.Add(2*time.Minute)) || !expiresAt.After(issuedAt) ||
		expiresAt.Sub(issuedAt) > 15*time.Minute {
		return nil, httperror.New(http.StatusForbidden, "console_oidc_bootstrap_time_invalid", "Console OIDC bootstrap validity window is invalid")
	}
	if !consoleVaultBootstrapJTI.MatchString(payload.JTI) {
		return nil, httperror.New(http.StatusBadRequest, "console_oidc_bootstrap_jti_invalid", "Console OIDC bootstrap jti is invalid")
	}
	if strings.TrimSpace(payload.TenantCode) != strings.TrimSpace(s.cfg.Tenant) ||
		strings.TrimSpace(payload.DeploymentCode) != strings.TrimSpace(s.cfg.DeploymentForApp("console")) ||
		strings.TrimSpace(payload.RuntimeCode) != strings.TrimSpace(s.cfg.Control.RuntimeCode) {
		return nil, httperror.New(http.StatusForbidden, "console_oidc_bootstrap_binding_mismatch", "Console OIDC bootstrap binding does not match this Runtime")
	}
	if strings.TrimSpace(payload.Reason) != "tenant-runtime-custody-cutover" {
		return nil, httperror.New(http.StatusBadRequest, "console_oidc_bootstrap_reason_invalid", "Console OIDC bootstrap reason is invalid")
	}
	jwtTrust, err := consoleJWTTrust(payload)
	if err != nil {
		return nil, err
	}

	result, err := adapter.BootstrapOIDCSigningKeyToVault(ctx, "platform:tenant-owner")
	if err != nil {
		return nil, err
	}
	if err := config.PersistJWTTrustOverlay(s.cfg.Control.ConfigDir, jwtTrust); err != nil {
		return nil, httperror.New(http.StatusInternalServerError, "console_oidc_bootstrap_jwt_trust_persist_failed", "Console OIDC JWT trust could not be persisted")
	}
	if s.auth == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_oidc_bootstrap_auth_unavailable", "Runtime authenticator is unavailable")
	}
	s.auth.UpdateJWTTrust(jwtTrust)
	result["tenantCode"] = s.cfg.Tenant
	result["deploymentCode"] = s.cfg.DeploymentForApp("console")
	result["runtimeCode"] = s.cfg.Control.RuntimeCode
	result["issuer"] = jwtTrust.Issuer
	result["jwksUrl"] = jwtTrust.JWKSURL
	result["jwtTrust"] = "tenant_gateway"
	return result, nil
}
