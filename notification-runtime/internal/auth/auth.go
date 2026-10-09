package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

type Requirement struct {
	Scope string
}

type Context struct {
	Tenant     string
	Deployment string
	SourceApp  string
	ClientID   string
	Subject    string
	Scopes     []string
	Mode       string
}

type Authenticator struct {
	cfg       config.Config
	http      *http.Client
	jwksMutex sync.Mutex
	jwks      map[string]any
	jwksAt    time.Time
}

type hzyClaims struct {
	AppCode    string `json:"appCode"`
	ClientCode string `json:"clientCode"`
}

type claims struct {
	TenantCode     string    `json:"tenant"`
	TenantCodeAlt  string    `json:"tenant_code"`
	TenantCodeJSON string    `json:"tenantCode"`
	Deployment     string    `json:"deployment"`
	DeploymentAlt  string    `json:"deployment_code"`
	DeploymentJSON string    `json:"deploymentCode"`
	AppCode        string    `json:"appCode"`
	AppCodeAlt     string    `json:"app_code"`
	ClientID       string    `json:"client_id"`
	ClientCode     string    `json:"clientCode"`
	TokenUse       string    `json:"token_use"`
	Scope          any       `json:"scope"`
	HZY            hzyClaims `json:"hzy"`
	jwt.RegisteredClaims
}

type jwksDocument struct {
	Keys []jwkKey `json:"keys"`
}

type introspectionResponse struct {
	Active bool `json:"active"`
}

type jwkKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
}

func New(cfg config.Config) *Authenticator {
	timeout := cfg.Console.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Authenticator{cfg: cfg, http: newJWKSHTTPClient(timeout)}
}

func newJWKSHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// JWKS is a small, cacheable control-plane document. Keep its connection
	// isolated on HTTP/1.1 because some tenant custom-domain HTTP/2 paths can
	// fail while the same origin remains reachable for ordinary Console calls.
	transport.ForceAttemptHTTP2 = false
	transport.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
	if transport.TLSClientConfig == nil {
		transport.TLSClientConfig = &tls.Config{}
	} else {
		transport.TLSClientConfig = transport.TLSClientConfig.Clone()
	}
	transport.TLSClientConfig.NextProtos = []string{"http/1.1"}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}

func (a *Authenticator) Authenticate(r *http.Request, required Requirement) (Context, error) {
	switch a.cfg.Auth.Mode {
	case config.AuthDisabled:
		return Context{
			Tenant:     a.cfg.Tenant,
			Deployment: a.cfg.Deployment,
			SourceApp:  "local-dev",
			ClientID:   "dev-disabled-auth",
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

func (a *Authenticator) authenticateStatic(r *http.Request, required Requirement) (Context, error) {
	token := bearerToken(r)
	if token == "" {
		return Context{}, httperror.New(http.StatusUnauthorized, "missing_bearer_token", "Missing Bearer token")
	}
	if a.cfg.Auth.StaticToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(a.cfg.Auth.StaticToken)) != 1 {
		return Context{}, httperror.New(http.StatusUnauthorized, "invalid_static_token", "Invalid Notification Runtime token")
	}
	return Context{
		Tenant:     a.cfg.Tenant,
		Deployment: a.cfg.Deployment,
		SourceApp:  "static-token-client",
		ClientID:   "static-token-client",
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

	options := []jwt.ParserOption{jwt.WithAudience(a.cfg.Auth.JWT.Audience)}
	if a.cfg.Auth.JWT.Issuer != "" {
		options = append(options, jwt.WithIssuer(a.cfg.Auth.JWT.Issuer))
	}
	keys, err := a.keys(r.Context())
	if err != nil {
		return Context{}, httperror.New(http.StatusServiceUnavailable, "jwt_verification_unavailable", "JWT verification keys are unavailable")
	}

	token, err := jwt.ParseWithClaims(tokenString, &claims{}, func(token *jwt.Token) (any, error) {
		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("missing kid")
		}
		key := keys[kid]
		if key == nil {
			return nil, errors.New("unknown kid")
		}
		return key, nil
	}, options...)
	if err != nil || !token.Valid {
		return Context{}, httperror.New(http.StatusUnauthorized, "invalid_jwt", "JWT signature, issuer, audience, or expiry was rejected")
	}

	claims, ok := token.Claims.(*claims)
	if !ok {
		return Context{}, httperror.New(http.StatusUnauthorized, "invalid_jwt_claims", "Invalid JWT claims")
	}
	actor, err := validateJWTClaims(a.cfg, claims, required)
	if err != nil {
		return Context{}, err
	}
	if err := a.requireActiveServiceToken(r.Context(), tokenString); err != nil {
		return Context{}, err
	}
	return actor, nil
}

func validateJWTClaims(cfg config.Config, tokenClaims *claims, required Requirement) (Context, error) {
	if err := requireServiceTokenUse(tokenClaims.TokenUse); err != nil {
		return Context{}, err
	}

	tenant, tenantConsistent := consistentClaimValue(tokenClaims.TenantCode, tokenClaims.TenantCodeAlt, tokenClaims.TenantCodeJSON)
	if !tenantConsistent {
		return Context{}, httperror.New(http.StatusForbidden, "tenant_claim_conflict", "Service token tenant claim aliases conflict")
	}
	if tenant == "" {
		return Context{}, httperror.New(http.StatusForbidden, "missing_tenant_claim", "Service token tenant claim is required")
	}
	deployment, deploymentConsistent := consistentClaimValue(tokenClaims.Deployment, tokenClaims.DeploymentAlt, tokenClaims.DeploymentJSON)
	if !deploymentConsistent {
		return Context{}, httperror.New(http.StatusForbidden, "deployment_claim_conflict", "Service token deployment claim aliases conflict")
	}
	if deployment == "" {
		return Context{}, httperror.New(http.StatusForbidden, "missing_deployment_claim", "Service token deployment claim is required")
	}
	sourceApp, sourceAppConsistent := consistentClaimValue(tokenClaims.AppCode, tokenClaims.AppCodeAlt, tokenClaims.HZY.AppCode)
	if !sourceAppConsistent {
		return Context{}, httperror.New(http.StatusForbidden, "source_app_claim_conflict", "Service token appCode claim aliases conflict")
	}
	sourceApp = strings.ToLower(sourceApp)
	if sourceApp == "" {
		return Context{}, httperror.New(http.StatusForbidden, "missing_source_app_claim", "Service token hzy.appCode claim is required")
	}
	clientID := strings.TrimSpace(tokenClaims.ClientID)
	if clientID == "" {
		return Context{}, httperror.New(http.StatusForbidden, "missing_client_id_claim", "Service token client_id claim is required")
	}

	if cfg.Tenant != "" && tenant != cfg.Tenant {
		return Context{}, httperror.New(http.StatusForbidden, "tenant_mismatch", "Token tenant is not enrolled on this runtime")
	}
	if cfg.Deployment != "" && deployment != cfg.Deployment && !cfg.Auth.AllowTenantServiceDeployments {
		return Context{}, httperror.New(http.StatusForbidden, "deployment_mismatch", "Token deployment is not enrolled on this runtime")
	}
	scopes := scopeList(tokenClaims.Scope)
	if !hasScope(scopes, required.Scope) {
		return Context{}, httperror.New(http.StatusForbidden, "insufficient_scope", "Missing scope "+required.Scope)
	}

	return Context{
		Tenant:     tenant,
		Deployment: deployment,
		SourceApp:  sourceApp,
		ClientID:   clientID,
		Subject:    firstNonEmpty(tokenClaims.Subject, tokenClaims.HZY.ClientCode, tokenClaims.ClientCode, clientID),
		Scopes:     scopes,
		Mode:       string(config.AuthJWT),
	}, nil
}

func (a *Authenticator) requireActiveServiceToken(ctx context.Context, token string) error {
	baseURL := strings.TrimRight(strings.TrimSpace(a.cfg.Console.BaseURL), "/")
	if baseURL == "" || a.http == nil {
		return httperror.New(http.StatusServiceUnavailable, "service_token_introspection_unavailable", "Service token introspection is unavailable")
	}
	form := url.Values{}
	form.Set("token", token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/oauth/introspect", strings.NewReader(form.Encode()))
	if err != nil {
		return httperror.New(http.StatusServiceUnavailable, "service_token_introspection_unavailable", "Service token introspection is unavailable")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if a.cfg.Tenant != "" {
		req.Header.Set("X-Hzy-Tenant", a.cfg.Tenant)
	}
	if a.cfg.Deployment != "" {
		req.Header.Set("X-Hzy-Deployment", a.cfg.Deployment)
	}

	resp, err := a.http.Do(req)
	if err != nil {
		return httperror.New(http.StatusServiceUnavailable, "service_token_introspection_unavailable", "Service token introspection is unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return httperror.New(http.StatusUnauthorized, "inactive_service_token", "Service token credential or grant is inactive")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return httperror.New(http.StatusServiceUnavailable, "service_token_introspection_unavailable", "Service token introspection is unavailable")
	}
	var result introspectionResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return httperror.New(http.StatusServiceUnavailable, "service_token_introspection_unavailable", "Service token introspection is unavailable")
	}
	if !result.Active {
		return httperror.New(http.StatusUnauthorized, "inactive_service_token", "Service token credential or grant is inactive")
	}
	return nil
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
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}

func requireServiceTokenUse(tokenUse string) error {
	if tokenUse != "service" {
		return httperror.New(http.StatusForbidden, "invalid_token_use", "Notification Runtime requires a service token")
	}
	return nil
}

func (a *Authenticator) keys(ctx context.Context) (map[string]any, error) {
	a.jwksMutex.Lock()
	defer a.jwksMutex.Unlock()

	if a.jwks != nil && time.Since(a.jwksAt) < 5*time.Minute {
		return a.jwks, nil
	}

	var body []byte
	if a.cfg.Auth.JWT.JWKSJSON != "" {
		body = []byte(a.cfg.Auth.JWT.JWKSJSON)
	} else if a.cfg.Auth.JWT.JWKSURL != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.Auth.JWT.JWKSURL, nil)
		if err != nil {
			return nil, err
		}
		client := a.http
		if client == nil {
			client = &http.Client{Timeout: 10 * time.Second}
		}
		resp, err := client.Do(req)
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
		if err != nil || key.Kid == "" {
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
		normalized := strings.TrimSpace(value)
		if normalized != "" {
			return normalized
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
