package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
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
	AppCode string
	Scope   string
}

type Context struct {
	Tenant     string
	Deployment string
	AppCode    string
	Subject    string
	Scopes     []string
	Mode       string
}

type Authenticator struct {
	cfg       config.Config
	jwksMutex sync.Mutex
	jwks      map[string]any
	jwksAt    time.Time
}

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
	ClientID       string `json:"client_id"`
	Scope          any    `json:"scope"`
	Hzy            struct {
		AppCode string `json:"appCode"`
	} `json:"hzy"`
	jwt.RegisteredClaims
}

func New(cfg config.Config) *Authenticator {
	return &Authenticator{cfg: cfg}
}

func (a *Authenticator) Authenticate(r *http.Request, required Requirement) (Context, error) {
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

	options := []jwt.ParserOption{jwt.WithAudience(a.cfg.Auth.JWT.Audience)}
	if a.cfg.Auth.JWT.Issuer != "" {
		options = append(options, jwt.WithIssuer(a.cfg.Auth.JWT.Issuer))
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

	tenant := firstNonEmpty(claims.TenantCode, claims.TenantCodeAlt, claims.TenantCodeJSON)
	deployment := firstNonEmpty(claims.Deployment, claims.DeploymentAlt, claims.DeploymentJSON)
	appCode := firstNonEmpty(claims.AppCode, claims.AppCodeAlt, claims.Hzy.AppCode, claims.ClientID)
	subject := firstNonEmpty(claims.Subject, claims.ClientID, "unknown")
	scopes := scopeList(claims.Scope)

	if tenant != "" && tenant != a.cfg.Tenant {
		log.Printf("[auth] reject reason=tenant_mismatch method=%s path=%s token.tenant=%q cfg.tenant=%q sub=%q", r.Method, r.URL.Path, tenant, a.cfg.Tenant, subject)
		return Context{}, httperror.New(http.StatusForbidden, "tenant_mismatch", "Token tenant is not enrolled on this Agent")
	}
	if deployment != "" && deployment != a.cfg.Deployment {
		log.Printf("[auth] reject reason=deployment_mismatch method=%s path=%s token.deployment=%q cfg.deployment=%q sub=%q", r.Method, r.URL.Path, deployment, a.cfg.Deployment, subject)
		return Context{}, httperror.New(http.StatusForbidden, "deployment_mismatch", "Token deployment is not enrolled on this Agent")
	}
	if appCode != "" && appCode != required.AppCode {
		log.Printf("[auth] reject reason=app_mismatch method=%s path=%s token.appCode=%q required.appCode=%q sub=%q", r.Method, r.URL.Path, appCode, required.AppCode, subject)
		return Context{}, httperror.New(http.StatusForbidden, "app_mismatch", "Token appCode cannot access this adapter")
	}
	if !hasScope(scopes, required.Scope) {
		log.Printf("[auth] reject reason=insufficient_scope method=%s path=%s token.scopes=%v required.scope=%q sub=%q", r.Method, r.URL.Path, scopes, required.Scope, subject)
		return Context{}, httperror.New(http.StatusForbidden, "insufficient_scope", "Missing scope "+required.Scope)
	}

	return Context{
		Tenant:     firstNonEmpty(tenant, a.cfg.Tenant),
		Deployment: firstNonEmpty(deployment, a.cfg.Deployment),
		AppCode:    firstNonEmpty(appCode, required.AppCode),
		Subject:    subject,
		Scopes:     scopes,
		Mode:       string(config.AuthJWT),
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
		if scope == required || scope == "*" || scope == prefix+".*" {
			return true
		}
		parts := strings.Split(scope, ":")
		if action != "" && len(parts) >= 3 && parts[len(parts)-2] == prefix && (parts[len(parts)-1] == action || parts[len(parts)-1] == "*") {
			return true
		}
	}
	return false
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

func toString(value any) string {
	return strings.TrimSpace(fmt.Sprint(value))
}
