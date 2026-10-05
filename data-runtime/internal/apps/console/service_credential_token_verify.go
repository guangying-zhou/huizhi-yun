package console

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"strings"
)

// VerifyInitialServiceToken checks a real issued token without signing, resolving
// secret material, updating last_used_at, or exposing token/claims in output.
type InitialServiceTokenExpectation struct{ Issuer, Audience, Tenant, Deployment, ClientCode, AppCode, Scope string }

func (a *Adapter) VerifyInitialServiceToken(ctx context.Context, raw string, w InitialServiceTokenExpectation) error {
	if w.Issuer == "" || w.Audience == "" || w.Tenant == "" || w.Deployment == "" || w.ClientCode == "" || w.AppCode == "" || len(strings.Fields(w.Scope)) != 1 {
		return errors.New("exact token expectation required")
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	parsed, err := jwt.Parse(raw, func(token *jwt.Token) (any, error) {
		kid, ok := token.Header["kid"].(string)
		if !ok || kid == "" {
			return nil, errors.New("kid required")
		}
		var document string
		if err := tx.QueryRowContext(ctx, `SELECT public_jwk_json FROM auth_signing_keys WHERE kid=? AND alg='EdDSA' AND use_type='sig' AND status IN ('current','next','retired') AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP()) AND (not_after IS NULL OR not_after>UTC_TIMESTAMP())`, kid).Scan(&document); err != nil {
			return nil, err
		}
		var key oidcSigningJWK
		if err := json.Unmarshal([]byte(document), &key); err != nil {
			return nil, err
		}
		if key.Kty != "OKP" || key.Crv != "Ed25519" || key.Kid != kid {
			return nil, errors.New("key mismatch")
		}
		pub, err := base64.RawURLEncoding.DecodeString(key.X)
		if err != nil || len(pub) != ed25519.PublicKeySize {
			return nil, errors.New("invalid public key")
		}
		return ed25519.PublicKey(pub), nil
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithIssuer(w.Issuer), jwt.WithAudience(w.Audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !parsed.Valid {
		return errors.New("token signature or lifetime invalid")
	}
	c := parsed.Claims.(jwt.MapClaims)
	for k, v := range map[string]string{"aud": w.Audience, "sub": "client:" + w.ClientCode, "azp": w.ClientCode, "tenant": w.Tenant, "deployment": w.Deployment, "client_id": w.ClientCode, "source_app": w.AppCode, "target_app": w.Audience, "token_use": "service", "scope": w.Scope} {
		if c[k] != v {
			return errors.New("token binding mismatch")
		}
	}
	h, ok := c["hzy"].(map[string]any)
	if !ok || h["appCode"] != w.AppCode || h["subjectType"] != "service" {
		return errors.New("service identity mismatch")
	}
	cid, ok := h["credentialId"].(float64)
	if !ok || cid <= 0 || float64(uint64(cid)) != cid {
		return errors.New("credential id invalid")
	}
	var n int
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_clients s JOIN service_client_credentials c ON c.id=s.current_credential_id AND c.service_client_id=s.id JOIN vault_secrets k ON k.id=c.secret_id JOIN vault_secret_versions v ON v.id=k.current_version_id AND v.secret_id=k.id WHERE s.client_code=? AND s.app_code=? AND s.status='active' AND c.id=? AND c.client_id=? AND c.status='active' AND (c.expires_at IS NULL OR c.expires_at>UTC_TIMESTAMP()) AND k.status='active' AND v.status='active'`, w.ClientCode, w.AppCode, uint64(cid), w.ClientCode).Scan(&n)
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("credential inactive")
	}
	i := strings.LastIndex(w.Scope, ":")
	if i < 1 {
		return errors.New("invalid scope")
	}
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_client_grants g JOIN service_clients s ON s.id=g.service_client_id WHERE s.client_code=? AND g.resource_code=? AND g.action=? AND g.status='active' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=? AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=? AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=? AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=?`, w.ClientCode, w.Scope[:i], w.Scope[i+1:], w.Tenant, w.Deployment, w.Audience, w.Scope).Scan(&n)
	if err != nil {
		return err
	}
	if n != 1 {
		return errors.New("exact grant inactive")
	}
	return tx.Commit()
}
