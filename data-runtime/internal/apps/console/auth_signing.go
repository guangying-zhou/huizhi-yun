package console

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const oidcSigningSecretPrefix = "auth.oidc.signing."

type oidcSigningJWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	D   string `json:"d,omitempty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

type oidcSigningKey struct {
	ID            uint64
	Kid           string
	Alg           string
	Use           string
	PublicJWKJSON string
	PrivateKeyRef string
	PrivateKey    ed25519.PrivateKey
}

func (a *Adapter) OIDCPublishedJWKS(ctx context.Context) (map[string]any, error) {
	if _, err := a.ensureOIDCSigningKey(ctx, "system"); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT kid,alg,use_type,public_jwk_json
		FROM auth_signing_keys
		WHERE status IN ('current','next','retired')
			AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP())
			AND (not_after IS NULL OR not_after>UTC_TIMESTAMP())
		ORDER BY FIELD(status,'current','next','retired'),id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make([]map[string]any, 0)
	for rows.Next() {
		var kid, alg, useType, raw string
		if err := rows.Scan(&kid, &alg, &useType, &raw); err != nil {
			return nil, err
		}
		var jwk map[string]any
		if err := json.Unmarshal([]byte(raw), &jwk); err != nil {
			return nil, httperror.New(http.StatusInternalServerError, "oidc_signing_public_jwk_invalid", "Stored OIDC public JWK is invalid")
		}
		jwk["kid"], jwk["alg"], jwk["use"] = kid, alg, useType
		delete(jwk, "d")
		keys = append(keys, jwk)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"keys": keys}, nil
}

func (a *Adapter) SignOIDCToken(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	claims, ok := body["claims"].(map[string]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "oidc_signing_claims_invalid", "claims must be an object")
	}
	ttlSeconds, ok := integerField(body["ttlSeconds"])
	if !ok || ttlSeconds < 30 || ttlSeconds > 3600 {
		return nil, httperror.New(http.StatusBadRequest, "oidc_signing_ttl_invalid", "ttlSeconds must be between 30 and 3600")
	}
	normalizedClaims, err := a.normalizeOIDCSigningClaims(claims)
	if err != nil {
		return nil, err
	}
	if err := a.authorizeOIDCSigningClaims(ctx, normalizedClaims); err != nil {
		return nil, err
	}
	key, err := a.ensureOIDCSigningKey(ctx, meta.ActorID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Truncate(time.Second)
	normalizedClaims["iat"] = now.Unix()
	normalizedClaims["exp"] = now.Add(time.Duration(ttlSeconds) * time.Second).Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims(normalizedClaims))
	token.Header["kid"] = key.Kid
	token.Header["typ"] = "JWT"
	signed, err := token.SignedString(key.PrivateKey)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"token": signed, "kid": key.Kid, "alg": key.Alg,
		"expiresAt": now.Add(time.Duration(ttlSeconds) * time.Second).Format(time.RFC3339),
	}, nil
}

// authorizeOIDCSigningClaims turns a well-formed signing request into an
// authorized one. Shape validation cannot establish who a token may speak for,
// so every issuance is justified by a fact this Runtime owns: a live session for
// a user token, or an active credential and grant for a service token. Holding
// the signing capability lets a workload ask for a token; it must not let that
// workload assert a subject, session or scope the Runtime cannot confirm.
func (a *Adapter) authorizeOIDCSigningClaims(ctx context.Context, claims map[string]any) error {
	hzy, ok := claims["hzy"].(map[string]any)
	if !ok {
		return httperror.New(http.StatusBadRequest, "oidc_signing_hzy_claim_invalid", "hzy claim must be an object")
	}
	if stringField(claims["token_use"]) == "service" {
		return a.authorizeServiceSigningClaims(ctx, claims, hzy)
	}
	return a.authorizeUserSigningClaims(ctx, claims, hzy)
}

// The credential and grant state that guards service-token consumption must also
// guard issuance, so a revoked credential or an ungranted scope cannot be minted
// in the first place.
func (a *Adapter) authorizeServiceSigningClaims(ctx context.Context, claims, hzy map[string]any) error {
	credentialID, _ := integerField(hzy["credentialId"])
	state, err := a.VerifyOIDCServiceTokenState(ctx, map[string]any{
		"clientId":     stringField(claims["client_id"]),
		"credentialId": credentialID,
		"scope":        stringField(claims["scope"]),
	})
	if err != nil {
		return err
	}
	if state["active"] != true {
		return httperror.New(http.StatusForbidden, "oidc_signing_service_state_inactive",
			"service credential or requested scope is not active")
	}
	if subject := stringField(claims["sub"]); subject != "client:"+strings.TrimSpace(stringField(hzy["clientCode"])) {
		return httperror.New(http.StatusForbidden, "oidc_signing_service_subject_mismatch",
			"service token subject does not match the authorized client")
	}
	return nil
}

// A user token speaks for whoever the session says it speaks for. Resolving the
// session here keeps a revoked, expired or simply invented sid from becoming a
// signed identity, and keeps sub, hzy.uid and the session from disagreeing:
// consumers read the subject from either field.
func (a *Adapter) authorizeUserSigningClaims(ctx context.Context, claims, hzy map[string]any) error {
	var uid string
	err := a.db.QueryRowContext(ctx, `
		SELECT ls.uid
		FROM local_sessions ls
		INNER JOIN directory_users u ON u.uid=ls.uid AND u.status='active'
		WHERE ls.session_id=? AND ls.status='active' AND ls.revoked_at IS NULL
			AND ls.expires_at>UTC_TIMESTAMP()
		LIMIT 1
	`, strings.TrimSpace(stringField(claims["sid"]))).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusForbidden, "oidc_signing_session_not_active",
			"user token session is missing, revoked or expired")
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(stringField(hzy["uid"])) != uid || stringField(claims["sub"]) != "user:"+uid {
		return httperror.New(http.StatusForbidden, "oidc_signing_session_subject_mismatch",
			"user token subject does not match the authenticated session")
	}
	return nil
}

func (a *Adapter) VerifyOIDCServiceTokenState(ctx context.Context, body map[string]any) (map[string]any, error) {
	clientID, err := requiredAuthString(body["clientId"], "client_id", 128)
	if err != nil {
		return nil, err
	}
	credentialID, ok := integerField(body["credentialId"])
	if !ok || credentialID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "oidc_service_credential_id_invalid", "credentialId must be a positive integer")
	}
	scopes := strings.Fields(stringField(body["scope"]))
	if len(scopes) == 0 {
		return map[string]any{"active": false, "reason": "scope_missing"}, nil
	}
	var (
		serviceClientID, currentCredentialID  uint64
		serviceClientStatus, credentialStatus string
		expiresAt                             sql.NullTime
	)
	err = a.db.QueryRowContext(ctx, `
		SELECT sc.id,sc.status,sc.current_credential_id,scc.status,scc.expires_at
		FROM service_client_credentials scc
		INNER JOIN service_clients sc ON sc.id=scc.service_client_id
		WHERE scc.id=? AND scc.client_id=?
		LIMIT 1
	`, credentialID, clientID).Scan(
		&serviceClientID, &serviceClientStatus, &currentCredentialID, &credentialStatus, &expiresAt,
	)
	if err == sql.ErrNoRows {
		return map[string]any{"active": false, "reason": "credential_missing"}, nil
	}
	if err != nil {
		return nil, err
	}
	if serviceClientStatus != "active" || credentialStatus != "active" ||
		currentCredentialID != uint64(credentialID) ||
		(expiresAt.Valid && !expiresAt.Time.After(time.Now().UTC())) {
		return map[string]any{"active": false, "reason": "credential_inactive"}, nil
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT resource_code,action
		FROM service_client_grants
		WHERE service_client_id=? AND status='active'
	`, serviceClientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	allowed := map[string]bool{}
	for rows.Next() {
		var resource, action string
		if err := rows.Scan(&resource, &action); err != nil {
			return nil, err
		}
		allowed[joinConsoleServiceScope(resource, action)] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, scope := range scopes {
		if !allowed[scope] {
			return map[string]any{"active": false, "reason": "grant_inactive"}, nil
		}
	}
	return map[string]any{"active": true}, nil
}

func (a *Adapter) normalizeOIDCSigningClaims(input map[string]any) (map[string]any, error) {
	allowed := map[string]bool{
		"iss": true, "sub": true, "aud": true, "azp": true, "client_id": true,
		"scope": true, "source_app": true, "target_app": true, "tenant": true,
		"deployment": true, "sid": true, "policy_ver": true, "caps": true,
		"token_use": true, "hzy": true, "nonce": true,
	}
	for key := range input {
		if !allowed[key] {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_claim_not_allowed", "OIDC signing claim is not allowed: "+key)
		}
	}
	issuer, err := requiredAuthString(input["iss"], "issuer", 1000)
	if err != nil {
		return nil, err
	}
	parsedIssuer, err := url.Parse(issuer)
	if err != nil || parsedIssuer.Scheme == "" || parsedIssuer.Host == "" ||
		(parsedIssuer.Scheme != "https" && parsedIssuer.Scheme != "http") {
		return nil, httperror.New(http.StatusBadRequest, "oidc_signing_issuer_invalid", "iss must be an absolute HTTP(S) URL")
	}
	subject, err := requiredAuthString(input["sub"], "subject", 191)
	if err != nil {
		return nil, err
	}
	audience, err := requiredAuthString(input["aud"], "audience", 191)
	if err != nil {
		return nil, err
	}
	tokenUse := stringField(input["token_use"])
	if tokenUse != "access" && tokenUse != "id" && tokenUse != "service" {
		return nil, httperror.New(http.StatusBadRequest, "oidc_signing_token_use_invalid", "token_use must be access, id, or service")
	}
	hzy, ok := input["hzy"].(map[string]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "oidc_signing_hzy_claim_invalid", "hzy claim must be an object")
	}
	userHZYClaims := map[string]bool{
		"uid": true, "subjectType": true, "subjectCode": true, "directorySnapshot": true,
	}
	serviceHZYClaims := map[string]bool{
		"subjectType": true, "subjectCode": true, "clientCode": true,
		"clientName": true, "clientType": true, "appCode": true, "credentialId": true,
	}
	allowedHZYClaims := userHZYClaims
	if tokenUse == "service" {
		allowedHZYClaims = serviceHZYClaims
	}
	for key := range hzy {
		if !allowedHZYClaims[key] {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_hzy_claim_not_allowed", "OIDC hzy claim is not allowed: "+key)
		}
	}
	if strings.TrimSpace(stringField(input["deployment"])) == "" {
		return nil, httperror.New(http.StatusBadRequest, "oidc_signing_deployment_invalid", "deployment is required")
	}
	if tokenUse == "service" {
		if strings.TrimSpace(stringField(input["scope"])) == "" ||
			strings.TrimSpace(stringField(input["client_id"])) == "" {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_service_claims_invalid", "service token client_id and scope are required")
		}
		credentialID, ok := integerField(hzy["credentialId"])
		if !ok || credentialID <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_service_credential_invalid", "service token credentialId is invalid")
		}
		if strings.TrimSpace(stringField(hzy["subjectType"])) != "service" ||
			strings.TrimSpace(stringField(hzy["subjectCode"])) == "" ||
			strings.TrimSpace(stringField(hzy["clientCode"])) == "" {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_service_identity_invalid", "service token identity claims are invalid")
		}
	} else {
		if _, err := requiredAuthSessionHash(input["sid"]); err != nil {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_session_invalid", "user token sid is invalid")
		}
		if strings.TrimSpace(stringField(hzy["uid"])) == "" {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_user_invalid", "user token hzy.uid is required")
		}
		if strings.TrimSpace(stringField(hzy["subjectType"])) != "user" ||
			strings.TrimSpace(stringField(hzy["subjectCode"])) != strings.TrimSpace(stringField(hzy["uid"])) {
			return nil, httperror.New(http.StatusBadRequest, "oidc_signing_user_identity_invalid", "user token identity claims are invalid")
		}
	}
	normalized := make(map[string]any, len(input)+2)
	for key, value := range input {
		normalized[key] = value
	}
	normalized["iss"], normalized["sub"], normalized["aud"] = issuer, subject, audience
	normalized["tenant"] = a.tenant
	normalized["token_use"] = tokenUse
	return normalized, nil
}

func (a *Adapter) ensureOIDCSigningKey(ctx context.Context, actorID string) (oidcSigningKey, error) {
	key, err := a.loadCurrentOIDCSigningKey(ctx, actorID)
	if err == nil {
		return key, nil
	}
	if err != sql.ErrNoRows {
		return oidcSigningKey{}, err
	}
	if _, err := a.vaultKey(); err != nil {
		return oidcSigningKey{}, err
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return oidcSigningKey{}, err
	}
	randomKidSuffix := make([]byte, 9)
	if _, err := rand.Read(randomKidSuffix); err != nil {
		return oidcSigningKey{}, err
	}
	kid := fmt.Sprintf(
		"csk_%s_%s",
		time.Now().UTC().Format("20060102150405"),
		base64.RawURLEncoding.EncodeToString(randomKidSuffix),
	)
	publicJWK := oidcSigningJWK{
		Kty: "OKP", Crv: "Ed25519", X: base64.RawURLEncoding.EncodeToString(publicKey),
		Kid: kid, Alg: "EdDSA", Use: "sig",
	}
	privateJWK := publicJWK
	privateJWK.D = base64.RawURLEncoding.EncodeToString(privateKey.Seed())
	publicJSON, _ := json.Marshal(publicJWK)
	privateJSON, _ := json.Marshal(privateJWK)
	material, err := a.encryptVaultPlaintext(string(privateJSON))
	if err != nil {
		return oidcSigningKey{}, err
	}
	secretCode := oidcSigningSecretPrefix + kid
	secretRef := "hzybase://vault/" + secretCode
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return oidcSigningKey{}, err
	}
	defer tx.Rollback()
	var singleton uint64
	if err := tx.QueryRowContext(ctx, `SELECT singleton_key FROM org_profiles WHERE singleton_key=1 FOR UPDATE`).Scan(&singleton); err != nil {
		return oidcSigningKey{}, err
	}
	var existingID uint64
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM auth_signing_keys
		WHERE status='current'
			AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP())
			AND (not_after IS NULL OR not_after>UTC_TIMESTAMP())
		ORDER BY id DESC LIMIT 1
	`).Scan(&existingID); err == nil {
		if err := tx.Commit(); err != nil {
			return oidcSigningKey{}, err
		}
		return a.loadCurrentOIDCSigningKey(ctx, actorID)
	} else if err != sql.ErrNoRows {
		return oidcSigningKey{}, err
	}
	secretInsert, err := tx.ExecContext(ctx, `
		INSERT INTO vault_secrets (
			secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,
			storage_backend,reveal_policy,masked_preview,status,created_by,created_at,updated_at
		) VALUES (?,?,?,'private_key','service','system','oidc-signing',
			'db_encrypted','never',?,'active',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
	`, secretCode, secretRef, "OIDC Signing Key "+kid, material.MaskedPreview, nullableText(actorID))
	if err != nil {
		return oidcSigningKey{}, err
	}
	secretID, err := secretInsert.LastInsertId()
	if err != nil {
		return oidcSigningKey{}, err
	}
	versionInsert, err := tx.ExecContext(ctx, `
		INSERT INTO vault_secret_versions (
			secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,
			status,activated_at,created_by,created_at
		) VALUES (?,1,?,?,?,?, 'active',UTC_TIMESTAMP(),?,UTC_TIMESTAMP())
	`, secretID, material.CiphertextBlob, material.ContentHash, material.EncryptionScheme,
		material.KeyFingerprint, nullableText(actorID))
	if err != nil {
		return oidcSigningKey{}, err
	}
	versionID, err := versionInsert.LastInsertId()
	if err != nil {
		return oidcSigningKey{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE vault_secrets SET current_version_id=?,last_rotated_at=UTC_TIMESTAMP()
		WHERE id=?
	`, versionID, secretID); err != nil {
		return oidcSigningKey{}, err
	}
	keyInsert, err := tx.ExecContext(ctx, `
		INSERT INTO auth_signing_keys (
			kid,alg,use_type,public_jwk_json,private_key_ref,not_before,status,created_at,updated_at
		) VALUES (?,'EdDSA','sig',CAST(? AS JSON),?,UTC_TIMESTAMP(),'current',UTC_TIMESTAMP(),UTC_TIMESTAMP())
	`, kid, string(publicJSON), secretRef)
	if err != nil {
		return oidcSigningKey{}, err
	}
	keyID, err := keyInsert.LastInsertId()
	if err != nil {
		return oidcSigningKey{}, err
	}
	if err := insertVaultAccessLog(ctx, tx, secretID, versionID, "rotate", VaultAccessMeta{
		ActorType: "system", ActorID: actorID, AppCode: "console", Reason: "oidc_signing_key_generate",
	}, "success"); err != nil {
		return oidcSigningKey{}, err
	}
	if err := tx.Commit(); err != nil {
		return oidcSigningKey{}, err
	}
	return oidcSigningKey{
		ID: uint64(keyID), Kid: kid, Alg: "EdDSA", Use: "sig",
		PublicJWKJSON: string(publicJSON), PrivateKeyRef: secretRef, PrivateKey: privateKey,
	}, nil
}

// BootstrapOIDCSigningKeyToVault performs the one-time custody cutover from a
// legacy env/file-backed current signing key to a new key generated and stored
// entirely inside the customer Tenant Runtime Vault. The retired public key
// remains published for one hour so already-issued access tokens can complete
// their normal verification lifetime.
func (a *Adapter) BootstrapOIDCSigningKeyToVault(
	ctx context.Context,
	actorID string,
) (map[string]any, error) {
	current, err := a.loadCurrentOIDCSigningKey(ctx, actorID)
	if err == nil {
		if strings.HasPrefix(current.PrivateKeyRef, "hzybase://vault/") {
			return map[string]any{
				"status":      "already_present",
				"currentKid":  current.Kid,
				"previousKid": nil,
			}, nil
		}
	}
	if errors.Is(err, sql.ErrNoRows) {
		generated, generateErr := a.ensureOIDCSigningKey(ctx, actorID)
		if generateErr != nil {
			return nil, generateErr
		}
		return map[string]any{
			"status":      "generated",
			"currentKid":  generated.Kid,
			"previousKid": nil,
		}, nil
	}
	legacyExternalRef := strings.HasPrefix(current.PrivateKeyRef, "env:") ||
		strings.HasPrefix(current.PrivateKeyRef, "file://")
	var runtimeError httperror.Error
	recoverableUnavailable := errors.As(err, &runtimeError) &&
		(runtimeError.Code == "oidc_signing_private_key_unavailable" ||
			runtimeError.Code == "oidc_signing_private_key_ref_unsupported")
	if err != nil && !legacyExternalRef && !recoverableUnavailable {
		return nil, err
	}
	if !legacyExternalRef && !recoverableUnavailable {
		return nil, httperror.New(
			http.StatusConflict,
			"oidc_signing_key_custody_conflict",
			"Current OIDC signing key cannot be moved into Tenant Runtime Vault",
		)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	randomKidSuffix := make([]byte, 9)
	if _, err := rand.Read(randomKidSuffix); err != nil {
		return nil, err
	}
	kid := fmt.Sprintf(
		"csk_%s_%s",
		time.Now().UTC().Format("20060102150405"),
		base64.RawURLEncoding.EncodeToString(randomKidSuffix),
	)
	publicJWK := oidcSigningJWK{
		Kty: "OKP", Crv: "Ed25519", X: base64.RawURLEncoding.EncodeToString(publicKey),
		Kid: kid, Alg: "EdDSA", Use: "sig",
	}
	privateJWK := publicJWK
	privateJWK.D = base64.RawURLEncoding.EncodeToString(privateKey.Seed())
	publicJSON, _ := json.Marshal(publicJWK)
	privateJSON, _ := json.Marshal(privateJWK)
	material, err := a.encryptVaultPlaintext(string(privateJSON))
	if err != nil {
		return nil, err
	}
	secretCode := oidcSigningSecretPrefix + kid
	secretRef := "hzybase://vault/" + secretCode

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var singleton uint64
	if err := tx.QueryRowContext(
		ctx,
		`SELECT singleton_key FROM org_profiles WHERE singleton_key=1 FOR UPDATE`,
	).Scan(&singleton); err != nil {
		return nil, err
	}
	var previousID uint64
	var previousKid, previousRef string
	if err := tx.QueryRowContext(ctx, `
		SELECT id,kid,private_key_ref
		FROM auth_signing_keys
		WHERE status='current'
			AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP())
			AND (not_after IS NULL OR not_after>UTC_TIMESTAMP())
		ORDER BY id DESC LIMIT 1
		FOR UPDATE
	`).Scan(&previousID, &previousKid, &previousRef); err != nil {
		return nil, err
	}
	if strings.HasPrefix(previousRef, "hzybase://vault/") {
		return nil, httperror.New(
			http.StatusConflict,
			"oidc_signing_key_custody_changed",
			"OIDC signing key custody changed while bootstrap was in progress",
		)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE auth_signing_keys
		SET status='retired',
			not_after=COALESCE(not_after,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR)),
			updated_at=UTC_TIMESTAMP()
		WHERE id=? AND status='current'
	`, previousID); err != nil {
		return nil, err
	}
	secretInsert, err := tx.ExecContext(ctx, `
		INSERT INTO vault_secrets (
			secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,
			storage_backend,reveal_policy,masked_preview,status,created_by,created_at,updated_at
		) VALUES (?,?,?,'private_key','service','system','oidc-signing',
			'db_encrypted','never',?,'active',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
	`, secretCode, secretRef, "OIDC Signing Key "+kid, material.MaskedPreview, nullableText(actorID))
	if err != nil {
		return nil, err
	}
	secretID, err := secretInsert.LastInsertId()
	if err != nil {
		return nil, err
	}
	versionInsert, err := tx.ExecContext(ctx, `
		INSERT INTO vault_secret_versions (
			secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,
			status,activated_at,created_by,created_at
		) VALUES (?,1,?,?,?,?, 'active',UTC_TIMESTAMP(),?,UTC_TIMESTAMP())
	`, secretID, material.CiphertextBlob, material.ContentHash, material.EncryptionScheme,
		material.KeyFingerprint, nullableText(actorID))
	if err != nil {
		return nil, err
	}
	versionID, err := versionInsert.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE vault_secrets SET current_version_id=?,last_rotated_at=UTC_TIMESTAMP()
		WHERE id=?
	`, versionID, secretID); err != nil {
		return nil, err
	}
	keyInsert, err := tx.ExecContext(ctx, `
		INSERT INTO auth_signing_keys (
			kid,alg,use_type,public_jwk_json,private_key_ref,not_before,status,created_at,updated_at
		) VALUES (?,'EdDSA','sig',CAST(? AS JSON),?,UTC_TIMESTAMP(),'current',UTC_TIMESTAMP(),UTC_TIMESTAMP())
	`, kid, string(publicJSON), secretRef)
	if err != nil {
		return nil, err
	}
	keyID, err := keyInsert.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := insertVaultAccessLog(ctx, tx, secretID, versionID, "rotate", VaultAccessMeta{
		ActorType: "system", ActorID: actorID, AppCode: "console", Reason: "oidc_signing_key_custody_cutover",
	}, "success"); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"status":      "rotated",
		"currentKid":  kid,
		"previousKid": previousKid,
		"keyId":       keyID,
	}, nil
}

func (a *Adapter) loadCurrentOIDCSigningKey(ctx context.Context, actorID string) (oidcSigningKey, error) {
	var key oidcSigningKey
	err := a.db.QueryRowContext(ctx, `
		SELECT id,kid,alg,use_type,public_jwk_json,private_key_ref
		FROM auth_signing_keys
		WHERE status='current'
			AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP())
			AND (not_after IS NULL OR not_after>UTC_TIMESTAMP())
		ORDER BY id DESC LIMIT 1
	`).Scan(&key.ID, &key.Kid, &key.Alg, &key.Use, &key.PublicJWKJSON, &key.PrivateKeyRef)
	if err != nil {
		return key, err
	}
	var privateJSON string
	switch {
	case strings.HasPrefix(key.PrivateKeyRef, "hzybase://vault/"):
		secret, err := queryVaultSecret(ctx, a.db, key.PrivateKeyRef, nil, false)
		if err != nil {
			return key, err
		}
		privateJSON, err = a.resolveVaultMaterial(
			secret.StorageBackend, secret.CiphertextBlob, secret.BackendSecretRef.String, secret.ContentHash.String,
		)
		if err != nil {
			_ = insertVaultAccessLog(ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve",
				VaultAccessMeta{ActorType: "service", ActorID: actorID, AppCode: "console", Reason: "oidc_token_sign"}, "failed")
			return key, err
		}
		if err := insertVaultAccessLog(ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve",
			VaultAccessMeta{ActorType: "service", ActorID: actorID, AppCode: "console", Reason: "oidc_token_sign"}, "success"); err != nil {
			return key, err
		}
	case strings.HasPrefix(key.PrivateKeyRef, "env:"):
		privateJSON = strings.TrimSpace(os.Getenv(strings.TrimPrefix(key.PrivateKeyRef, "env:")))
	case strings.HasPrefix(key.PrivateKeyRef, "file://"):
		content, readErr := os.ReadFile(strings.TrimPrefix(key.PrivateKeyRef, "file://"))
		if readErr != nil {
			return key, readErr
		}
		privateJSON = strings.TrimSpace(string(content))
	default:
		return key, httperror.New(http.StatusServiceUnavailable, "oidc_signing_private_key_ref_unsupported", "OIDC signing private key reference is unsupported by Tenant Runtime")
	}
	if privateJSON == "" {
		return key, httperror.New(http.StatusServiceUnavailable, "oidc_signing_private_key_unavailable", "OIDC signing private key is unavailable in Tenant Runtime")
	}
	var privateJWK oidcSigningJWK
	if err := json.Unmarshal([]byte(privateJSON), &privateJWK); err != nil {
		return key, httperror.New(http.StatusServiceUnavailable, "oidc_signing_private_jwk_invalid", "OIDC signing private JWK is invalid")
	}
	seed, err := base64.RawURLEncoding.DecodeString(privateJWK.D)
	if err != nil || len(seed) != ed25519.SeedSize {
		return key, httperror.New(http.StatusServiceUnavailable, "oidc_signing_private_jwk_invalid", "OIDC signing private JWK seed is invalid")
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)
	var publicJWK oidcSigningJWK
	if err := json.Unmarshal([]byte(key.PublicJWKJSON), &publicJWK); err != nil ||
		publicJWK.X != base64.RawURLEncoding.EncodeToString(publicKey) {
		return key, httperror.New(http.StatusConflict, "oidc_signing_key_material_mismatch", "OIDC signing public and private key material do not match")
	}
	key.PrivateKey = privateKey
	return key, nil
}
