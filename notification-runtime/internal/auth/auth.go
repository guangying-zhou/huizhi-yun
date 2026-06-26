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
	"math/big"
	"net/http"
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
	ClientID   string
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

type claims struct {
	TenantCode     string `json:"tenant"`
	TenantCodeAlt  string `json:"tenant_code"`
	TenantCodeJSON string `json:"tenantCode"`
	Deployment     string `json:"deployment"`
	DeploymentAlt  string `json:"deployment_code"`
	DeploymentJSON string `json:"deploymentCode"`
	ClientID       string `json:"client_id"`
	ClientCode     string `json:"clientCode"`
	TokenUse       string `json:"token_use"`
	Scope          any    `json:"scope"`
	jwt.RegisteredClaims
}

type jwksDocument struct {
	Keys []jwkKey `json:"keys"`
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
	return &Authenticator{cfg: cfg}
}

func (a *Authenticator) Authenticate(r *http.Request, required Requirement) (Context, error) {
	switch a.cfg.Auth.Mode {
	case config.AuthDisabled:
		return Context{
			Tenant:     a.cfg.Tenant,
			Deployment: a.cfg.Deployment,
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
	if claims.TokenUse != "" && claims.TokenUse != "service" {
		return Context{}, httperror.New(http.StatusForbidden, "invalid_token_use", "Notification Runtime requires a service token")
	}

	tenant := firstNonEmpty(claims.TenantCode, claims.TenantCodeAlt, claims.TenantCodeJSON)
	deployment := firstNonEmpty(claims.Deployment, claims.DeploymentAlt, claims.DeploymentJSON)
	scopes := scopeList(claims.Scope)
	if a.cfg.Tenant != "" && tenant != "" && tenant != a.cfg.Tenant {
		return Context{}, httperror.New(http.StatusForbidden, "tenant_mismatch", "Token tenant is not enrolled on this runtime")
	}
	if a.cfg.Deployment != "" && deployment != "" && deployment != a.cfg.Deployment {
		return Context{}, httperror.New(http.StatusForbidden, "deployment_mismatch", "Token deployment is not enrolled on this runtime")
	}
	if !hasScope(scopes, required.Scope) {
		return Context{}, httperror.New(http.StatusForbidden, "insufficient_scope", "Missing scope "+required.Scope)
	}

	return Context{
		Tenant:     firstNonEmpty(tenant, a.cfg.Tenant),
		Deployment: firstNonEmpty(deployment, a.cfg.Deployment),
		ClientID:   firstNonEmpty(claims.ClientID, claims.ClientCode),
		Subject:    firstNonEmpty(claims.Subject, claims.ClientID, claims.ClientCode, "unknown"),
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
	resource, action, found := strings.Cut(required, ":")
	for _, scope := range scopes {
		if scope == required || scope == "*" {
			return true
		}
		if found && (scope == resource+":*" || scope == resource+":"+action) {
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
