package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type Requirement struct {
	StrictServiceClaims bool
	AppCode             string
	Scope               string
	SourceAppCode       string
}

type Context struct {
	ClientID     string
	CredentialID int64
	Tenant       string
	Deployment   string
	AppCode      string
	Subject      string
	Scopes       []string
	Mode         string
}

type Authenticator struct {
	cfg                   config.Config
	jwksMutex             sync.Mutex
	jwks                  map[string]any
	jwksAt                time.Time
	jwksUnknownKidRefresh time.Time
}

const jwksUnknownKidRefreshCooldown = 30 * time.Second

type jwksDocument struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
}

type claims struct {
	TenantCode     string `json:"tenant"`
	TenantCodeAlt  string `json:"tenant_code"`
	TenantCodeJSON string `json:"tenantCode"`
	Deployment     string `json:"deployment"`
	DeploymentAlt  string `json:"deployment_code"`
	DeploymentJSON string `json:"deploymentCode"`
	AppCode        string `json:"appCode"`
	AppCodeAlt     string `json:"app_code"`
	SourceApp      string `json:"source_app"`
	TargetApp      string `json:"target_app"`
	ClientID       string `json:"client_id"`
	TokenUse       string `json:"token_use"`
	Scope          any    `json:"scope"`
	RuntimeCode    string `json:"runtimeCode"`
	Hzy            struct {
		CredentialID int64  `json:"credentialId"`
		AppCode      string `json:"appCode"`
	} `json:"hzy"`
	jwt.RegisteredClaims
}

func New(cfg config.Config) *Authenticator {
	return &Authenticator{cfg: cfg}
}

func (a *Authenticator) UpdateJWTTrust(trust config.JWTConfig) {
	a.jwksMutex.Lock()
	defer a.jwksMutex.Unlock()
	a.cfg.Auth.JWT = trust
	a.jwks = nil
	a.jwksAt = time.Time{}
	a.jwksUnknownKidRefresh = time.Time{}
}

func (a *Authenticator) Authenticate(r *http.Request, required Requirement) (Context, error) {
	if context, handled, err := a.authenticatePlatformBootstrap(r, required); handled {
		return context, err
	}

	switch a.cfg.Auth.Mode {
	case config.AuthDisabled:
		return Context{
			Tenant:     a.cfg.Tenant,
			Deployment: a.cfg.Deployment,
			AppCode:    required.AppCode,
			Subject:    "dev-disabled-auth",
			Scopes:     []string{required.Scope},
			Mode:       string(config.AuthDisabled),
		}, nil
	case config.AuthStaticToken:
		return a.authenticateStatic(r, required)
	case config.AuthJWT:
		return a.authenticateJWT(r, required)
	default:
		return Context{}, httperror.New(http.StatusUnauthorized, "unsupported_auth_mode", "Unsupported auth mode")
	}
}

func (a *Authenticator) authenticatePlatformBootstrap(r *http.Request, required Requirement) (Context, bool, error) {
	if required.AppCode != "console" ||
		required.SourceAppCode != "console" ||
		required.Scope != "console:service-token:issue" {
		return Context{}, false, nil
	}
	tokenString := bearerToken(r)
	if tokenString == "" {
		return Context{}, false, nil
	}

	unverified := &claims{}
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, unverified)
	if err != nil {
		return Context{}, false, nil
	}
	kid, _ := token.Header["kid"].(string)
	if strings.TrimSpace(kid) == "" ||
		strings.TrimSpace(kid) != strings.TrimSpace(a.cfg.Control.PlatformSigningKeyID) {
		return Context{}, false, nil
	}

	publicKey, err := platformBootstrapPublicKey(a.cfg.Control.PlatformSigningPublicKey)
	if err != nil {
		return Context{}, true, err
	}
	issuer := strings.TrimRight(strings.TrimSpace(a.cfg.Control.PlatformURL), "/")
	options := []jwt.ParserOption{
		jwt.WithAudience("data-runtime-bootstrap"),
		jwt.WithValidMethods([]string{"EdDSA"}),
	}
	if issuer != "" {
		options = append(options, jwt.WithIssuer(issuer))
	}
	verified, err := jwt.ParseWithClaims(tokenString, &claims{}, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != "EdDSA" {
			return nil, errors.New("unexpected bootstrap signing algorithm")
		}
		return publicKey, nil
	}, options...)
	if err != nil || !verified.Valid {
		return Context{}, true, httperror.New(http.StatusUnauthorized, "platform_bootstrap_token_invalid", "Platform Runtime bootstrap token is invalid")
	}
	verifiedClaims, ok := verified.Claims.(*claims)
	if !ok {
		return Context{}, true, httperror.New(http.StatusUnauthorized, "platform_bootstrap_claims_invalid", "Platform Runtime bootstrap claims are invalid")
	}
	tenant, tenantConsistent := consistentClaimValue(
		verifiedClaims.TenantCode,
		verifiedClaims.TenantCodeAlt,
		verifiedClaims.TenantCodeJSON,
	)
	deployment, deploymentConsistent := consistentClaimValue(
		verifiedClaims.Deployment,
		verifiedClaims.DeploymentAlt,
		verifiedClaims.DeploymentJSON,
	)
	appCode, appConsistent := consistentClaimValue(
		verifiedClaims.AppCode,
		verifiedClaims.AppCodeAlt,
		verifiedClaims.SourceApp,
		verifiedClaims.Hzy.AppCode,
	)
	issuedAt := verifiedClaims.IssuedAt
	expiresAt := verifiedClaims.ExpiresAt
	if !tenantConsistent || !deploymentConsistent || !appConsistent ||
		tenant != strings.TrimSpace(a.cfg.Tenant) ||
		deployment != strings.TrimSpace(a.cfg.DeploymentForApp("console")) ||
		appCode != "console" ||
		strings.TrimSpace(verifiedClaims.RuntimeCode) != strings.TrimSpace(a.cfg.Control.RuntimeCode) ||
		strings.TrimSpace(verifiedClaims.TokenUse) != "platform_runtime_bootstrap" ||
		strings.TrimSpace(verifiedClaims.Subject) != "platform:tenant-gateway" ||
		strings.TrimSpace(verifiedClaims.ID) == "" ||
		issuedAt == nil || expiresAt == nil ||
		expiresAt.Time.Sub(issuedAt.Time) <= 0 ||
		expiresAt.Time.Sub(issuedAt.Time) > 2*time.Minute ||
		issuedAt.Time.After(time.Now().UTC().Add(10*time.Second)) ||
		!hasScope(scopeList(verifiedClaims.Scope), required.Scope) {
		return Context{}, true, httperror.New(http.StatusForbidden, "platform_bootstrap_binding_invalid", "Platform Runtime bootstrap binding is invalid")
	}
	return Context{
		Tenant:     tenant,
		Deployment: deployment,
		AppCode:    appCode,
		Subject:    verifiedClaims.Subject,
		Scopes:     scopeList(verifiedClaims.Scope),
		Mode:       "platform_bootstrap",
	}, true, nil
}

func platformBootstrapPublicKey(value string) (ed25519.PublicKey, error) {
	block, _ := pem.Decode([]byte(strings.ReplaceAll(strings.TrimSpace(value), `\n`, "\n")))
	if block == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "platform_bootstrap_key_invalid", "Platform Runtime bootstrap key is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsed.(ed25519.PublicKey)
	if err != nil || !ok {
		return nil, httperror.New(http.StatusServiceUnavailable, "platform_bootstrap_key_invalid", "Platform Runtime bootstrap key is invalid")
	}
	return publicKey, nil
}

func (a *Authenticator) authenticateStatic(r *http.Request, required Requirement) (Context, error) {
	token := bearerToken(r)
	if token == "" {
		return Context{}, httperror.New(http.StatusUnauthorized, "missing_bearer_token", "Missing Bearer token")
	}
	if a.cfg.Auth.StaticToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(a.cfg.Auth.StaticToken)) != 1 {
		return Context{}, httperror.New(http.StatusUnauthorized, "invalid_static_token", "Invalid Data Runtime token")
	}
	return Context{
		Tenant:     a.cfg.Tenant,
		Deployment: a.cfg.Deployment,
		AppCode:    required.AppCode,
		Subject:    "static-token-client",
		Scopes:     []string{required.Scope},
		Mode:       string(config.AuthStaticToken),
	}, nil
}

func (a *Authenticator) authenticateJWT(r *http.Request, required Requirement) (Context, error) {
	tokenString := bearerToken(r)
	if tokenString == "" {
		return Context{}, httperror.New(http.StatusUnauthorized, "missing_bearer_token", "Missing Bearer token")
	}

	a.jwksMutex.Lock()
	jwtTrust := a.cfg.Auth.JWT
	a.jwksMutex.Unlock()
	options := []jwt.ParserOption{jwt.WithAudience(jwtTrust.Audience)}
	if jwtTrust.Issuer != "" {
		options = append(options, jwt.WithIssuer(jwtTrust.Issuer))
	}

	token, err := jwt.ParseWithClaims(tokenString, &claims{}, func(token *jwt.Token) (any, error) {
		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("missing kid")
		}
		keys, err := a.keys(r.Context())
		if err != nil {
			return nil, err
		}
		key := keys[kid]
		if key == nil {
			keys, err = a.refreshKeysForUnknownKid(r.Context())
			if err != nil {
				return nil, err
			}
			key = keys[kid]
		}
		if key == nil {
			return nil, errors.New("unknown kid")
		}
		return key, nil
	}, options...)
	if err != nil || !token.Valid {
		if err == nil {
			err = errors.New("invalid jwt")
		}
		return Context{}, httperror.New(http.StatusUnauthorized, "invalid_jwt", err.Error())
	}

	claims, ok := token.Claims.(*claims)
	if !ok {
		return Context{}, httperror.New(http.StatusUnauthorized, "invalid_jwt_claims", "Invalid JWT claims")
	}
	if required.StrictServiceClaims && (jwtTrust.Issuer == "" || claims.Issuer == "" || claims.SourceApp == "" || claims.TargetApp != jwtTrust.Audience || claims.ClientID == "" || claims.Hzy.CredentialID <= 0 || claims.ExpiresAt == nil || claims.IssuedAt == nil) {
		return Context{}, httperror.New(http.StatusForbidden, "service_claims_required", "Complete bound service identity required")
	}

	tenant, tenantConsistent := consistentClaimValue(claims.TenantCode, claims.TenantCodeAlt, claims.TenantCodeJSON)
	deployment, deploymentConsistent := consistentClaimValue(claims.Deployment, claims.DeploymentAlt, claims.DeploymentJSON)
	appCode, appConsistent := consistentClaimValue(claims.AppCode, claims.AppCodeAlt, claims.SourceApp, claims.Hzy.AppCode)
	subject := firstNonEmpty(claims.Subject, claims.ClientID, "unknown")
	scopes := scopeList(claims.Scope)

	if strings.TrimSpace(claims.TokenUse) != "service" {
		return Context{}, httperror.New(http.StatusForbidden, "service_token_required", "Data Runtime requires a service token")
	}
	if !tenantConsistent {
		return Context{}, httperror.New(http.StatusForbidden, "tenant_claim_conflict", "Token tenant claim aliases conflict")
	}
	if !deploymentConsistent {
		return Context{}, httperror.New(http.StatusForbidden, "deployment_claim_conflict", "Token deployment claim aliases conflict")
	}
	if !appConsistent {
		return Context{}, httperror.New(http.StatusForbidden, "app_claim_conflict", "Token appCode claim aliases conflict")
	}
	if tenant == "" {
		return Context{}, httperror.New(http.StatusForbidden, "tenant_claim_required", "Token tenant claim is required")
	}
	if deployment == "" {
		return Context{}, httperror.New(http.StatusForbidden, "deployment_claim_required", "Token deployment claim is required")
	}
	if appCode == "" {
		return Context{}, httperror.New(http.StatusForbidden, "app_claim_required", "Token appCode claim is required")
	}
	if tenant != "" && tenant != a.cfg.Tenant {
		log.Printf("[auth] reject reason=tenant_mismatch method=%s path=%s token.tenant=%q cfg.tenant=%q sub=%q", r.Method, r.URL.Path, tenant, a.cfg.Tenant, subject)
		return Context{}, httperror.New(http.StatusForbidden, "tenant_mismatch", "Token tenant is not enrolled on this Agent")
	}
	expectedDeployment := a.cfg.DeploymentForApp(appCode)
	if deployment != "" && deployment != expectedDeployment {
		log.Printf("[auth] reject reason=deployment_mismatch method=%s path=%s token.deployment=%q cfg.deployment=%q source.appCode=%q sub=%q", r.Method, r.URL.Path, deployment, expectedDeployment, appCode, subject)
		return Context{}, httperror.New(http.StatusForbidden, "deployment_mismatch", "Token deployment is not enrolled on this Agent")
	}
	if !hasScope(scopes, required.Scope) {
		log.Printf("[auth] reject reason=insufficient_scope method=%s path=%s token.scopes=%v required.scope=%q sub=%q", r.Method, r.URL.Path, scopes, required.Scope, subject)
		return Context{}, httperror.New(http.StatusForbidden, "insufficient_scope", "Missing scope "+required.Scope)
	}
	if required.SourceAppCode != "" && appCode != required.SourceAppCode {
		log.Printf("[auth] reject reason=source_app_mismatch method=%s path=%s token.appCode=%q required.sourceAppCode=%q sub=%q", r.Method, r.URL.Path, appCode, required.SourceAppCode, subject)
		return Context{}, httperror.New(http.StatusForbidden, "source_app_mismatch", "Token source application is not allowed for this endpoint")
	}

	return Context{
		Tenant:       tenant,
		Deployment:   deployment,
		AppCode:      appCode,
		Subject:      subject,
		Scopes:       scopes,
		Mode:         string(config.AuthJWT),
		ClientID:     claims.ClientID,
		CredentialID: claims.Hzy.CredentialID,
	}, nil
}

func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 8 || !strings.EqualFold(header[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[7:])
}

func scopeList(raw any) []string {
	switch value := raw.(type) {
	case string:
		return strings.Fields(value)
	case []any:
		result := make([]string, 0, len(value))
		for _, item := range value {
			if text := strings.TrimSpace(toString(item)); text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func hasScope(scopes []string, required string) bool {
	prefix, _, _ := strings.Cut(required, ".")
	action := ""
	if _, suffix, ok := strings.Cut(required, "."); ok {
		action = suffix
	}
	for _, scope := range scopes {
		semanticScope := runtimeSemanticScope(scope)
		if scope == required || semanticScope == required || scope == "*" || scope == prefix+".*" || semanticScope == prefix+".*" {
			return true
		}
		parts := strings.Split(scope, ":")
		if action != "" && len(parts) >= 3 && parts[len(parts)-2] == prefix && (parts[len(parts)-1] == action || parts[len(parts)-1] == "*") {
			return true
		}
	}
	return false
}

// Console grants are audience-qualified (for example
// data-runtime:people:offboarding_tasks:view). The Agent validates the JWT aud
// claim separately, then authorizes adapters against the semantic scope. Only
// the two supported runtime audience prefixes are removed; arbitrary prefixes
// never become a valid business scope.
func runtimeSemanticScope(scope string) string {
	normalized := strings.TrimSpace(scope)
	for _, prefix := range []string{"data-runtime:", "tenant-runtime:"} {
		if strings.HasPrefix(normalized, prefix) {
			return strings.TrimPrefix(normalized, prefix)
		}
	}
	return normalized
}

func (a *Authenticator) keys(ctx context.Context) (map[string]any, error) {
	a.jwksMutex.Lock()
	defer a.jwksMutex.Unlock()

	if a.jwks != nil && time.Since(a.jwksAt) < 5*time.Minute {
		return a.jwks, nil
	}
	return a.loadKeysLocked(ctx)
}

// refreshKeysForUnknownKid bypasses the normal five-minute cache once when a
// validly shaped token references a newly rotated signing key. The cooldown
// prevents arbitrary unknown kids from turning authentication into an
// unbounded JWKS fetch loop.
func (a *Authenticator) refreshKeysForUnknownKid(ctx context.Context) (map[string]any, error) {
	a.jwksMutex.Lock()
	defer a.jwksMutex.Unlock()

	if a.cfg.Auth.JWT.JWKSJSON != "" || a.cfg.Auth.JWT.JWKSURL == "" {
		return a.jwks, nil
	}
	if !a.jwksUnknownKidRefresh.IsZero() && time.Since(a.jwksUnknownKidRefresh) < jwksUnknownKidRefreshCooldown {
		return a.jwks, nil
	}
	a.jwksUnknownKidRefresh = time.Now()
	return a.loadKeysLocked(ctx)
}

func (a *Authenticator) loadKeysLocked(ctx context.Context) (map[string]any, error) {
	var body []byte
	if a.cfg.Auth.JWT.JWKSJSON != "" {
		body = []byte(a.cfg.Auth.JWT.JWKSJSON)
	} else if a.cfg.Auth.JWT.JWKSURL != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.Auth.JWT.JWKSURL, nil)
		if err != nil {
			return nil, err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			return nil, errors.New("jwks endpoint returned error")
		}
		body, err = io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return nil, err
		}
	} else {
		return nil, errors.New("JWKS is not configured")
	}

	var doc jwksDocument
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}

	keys := make(map[string]any, len(doc.Keys))
	for _, key := range doc.Keys {
		parsed, err := parseJWK(key)
		if err != nil {
			continue
		}
		keys[key.Kid] = parsed
	}
	a.jwks = keys
	a.jwksAt = time.Now()
	return keys, nil
}

func parseJWK(key jwkKey) (any, error) {
	switch key.Kty {
	case "RSA":
		nBytes, err := base64.RawURLEncoding.DecodeString(key.N)
		if err != nil {
			return nil, err
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(key.E)
		if err != nil {
			return nil, err
		}
		e := 0
		for _, b := range eBytes {
			e = e<<8 + int(b)
		}
		return &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}, nil
	case "OKP":
		if key.Crv != "Ed25519" {
			return nil, errors.New("unsupported OKP curve")
		}
		x, err := base64.RawURLEncoding.DecodeString(key.X)
		if err != nil {
			return nil, err
		}
		return ed25519.PublicKey(x), nil
	default:
		return nil, errors.New("unsupported jwk kty")
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func consistentClaimValue(values ...string) (string, bool) {
	resolved := ""
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		if resolved != "" && normalized != resolved {
			return "", false
		}
		resolved = normalized
	}
	return resolved, true
}

func toString(value any) string {
	return strings.TrimSpace(fmt.Sprint(value))
}
