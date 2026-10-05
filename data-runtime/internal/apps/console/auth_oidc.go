package console

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var oidcPKCEChallengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

var oidcSupportedScopes = map[string]bool{
	"openid": true, "profile": true, "email": true, "offline_access": true,
}

func (a *Adapter) ResolveOIDCClient(ctx context.Context, body map[string]any) (map[string]any, error) {
	clientID, err := requiredAuthString(body["clientId"], "client_id", 128)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_client", "invalid_client: client_id is required")
	}
	client, err := loadActiveOIDCClient(ctx, a.db, clientID)
	if err != nil {
		return nil, err
	}
	if client == nil || (client["authMode"] != "oidc" && client["authMode"] != "mixed") {
		return nil, httperror.New(http.StatusBadRequest, "invalid_client", "invalid_client: client is unavailable")
	}
	if redirectURI := strings.TrimSpace(stringField(body["redirectUri"])); redirectURI != "" {
		uriType := firstValue(stringField(body["uriType"]), "redirect")
		if uriType != "redirect" && uriType != "post_logout" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_redirect_uri", "invalid_redirect_uri")
		}
		var found uint64
		err := a.db.QueryRowContext(ctx, `
			SELECT id FROM auth_client_redirect_uris
			WHERE client_id=? AND uri_type=? AND redirect_uri=? AND status='active'
			LIMIT 1
		`, client["id"], uriType, redirectURI).Scan(&found)
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusBadRequest, "invalid_redirect_uri", "invalid_redirect_uri")
		}
		if err != nil {
			return nil, err
		}
		client["validatedRedirectUri"] = redirectURI
	}
	return client, nil
}

func (a *Adapter) CreateOIDCAuthorizationCode(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	codeHash, err := requiredOIDCOpaqueHash(body["codeHash"], "code_hash")
	if err != nil {
		return nil, err
	}
	clientID, err := requiredAuthString(body["clientId"], "client_id", 128)
	if err != nil {
		return nil, err
	}
	sessionHash, err := requiredAuthSessionHash(body["sessionIdHash"])
	if err != nil {
		return nil, err
	}
	redirectURI, err := requiredAuthString(body["redirectUri"], "redirect_uri", 1000)
	if err != nil {
		return nil, err
	}
	scope, err := normalizeOIDCScope(body["scope"])
	if err != nil {
		return nil, err
	}
	codeChallenge := strings.TrimSpace(stringField(body["codeChallenge"]))
	if !oidcPKCEChallengePattern.MatchString(codeChallenge) || stringField(body["codeChallengeMethod"]) != "S256" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_pkce", "invalid_request: S256 PKCE is required")
	}
	stateHash, err := optionalOIDCOpaqueHash(body["stateHash"], "state_hash")
	if err != nil {
		return nil, err
	}
	nonceHash, err := optionalOIDCOpaqueHash(body["nonceHash"], "nonce_hash")
	if err != nil {
		return nil, err
	}
	nonce := nullableLimitedString(body["nonce"], 255)
	ttlSeconds, ok := integerField(body["ttlSeconds"])
	if !ok || ttlSeconds < 30 || ttlSeconds > 600 {
		return nil, httperror.New(http.StatusBadRequest, "authorization_code_ttl_invalid", "authorization code ttlSeconds must be between 30 and 600")
	}
	expiresAt := time.Now().UTC().Add(time.Duration(ttlSeconds) * time.Second).Truncate(time.Second)
	payload := map[string]any{
		"codeHash": codeHash, "clientId": clientID, "sessionIdHash": sessionHash,
		"redirectUri": redirectURI, "scope": scope, "stateHash": stateHash,
		"nonceHash": nonceHash, "nonce": nonce, "codeChallenge": codeChallenge,
		"codeChallengeMethod": "S256", "ttlSeconds": ttlSeconds,
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.oidc.authorization_code.issue", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result, err := session.tx.ExecContext(ctx, `
		INSERT INTO auth_authorization_codes (
			code_hash,client_id,session_id,uid,redirect_uri,scope,state_hash,nonce_hash,
			nonce,code_challenge,code_challenge_method,issued_at,expires_at,status
		)
		SELECT ?,c.id,ls.id,ls.uid,?,?,?,?,?,?,'S256',UTC_TIMESTAMP(),?,'active'
		FROM auth_clients c
		INNER JOIN local_sessions ls ON ls.session_id=?
		WHERE c.client_id=? AND c.status='active' AND c.auth_mode IN ('oidc','mixed')
			AND ls.status='active' AND ls.revoked_at IS NULL AND ls.expires_at>UTC_TIMESTAMP()
			AND EXISTS (
				SELECT 1 FROM auth_client_redirect_uris uri
				WHERE uri.client_id=c.id AND uri.uri_type='redirect'
					AND uri.redirect_uri=? AND uri.status='active'
			)
	`, codeHash, redirectURI, scope, stateHash, nonceHash, nonce, codeChallenge,
		expiresAt, sessionHash, clientID, redirectURI,
	)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusBadRequest, "authorization_code_context_invalid", "OIDC client, redirect URI, or session is invalid")
	}
	if _, err := session.tx.ExecContext(ctx, `
		INSERT INTO auth_token_events (
			event_type,client_id,uid,session_hash,token_hash,result,created_at
		)
		SELECT 'authorization_code_issue',c.client_id,ls.uid,ls.session_id,?,'success',UTC_TIMESTAMP()
		FROM auth_clients c
		INNER JOIN local_sessions ls ON ls.session_id=?
		WHERE c.client_id=?
	`, codeHash, sessionHash, clientID); err != nil {
		return nil, err
	}
	response := map[string]any{
		"created": true, "expiresAt": expiresAt.Format(time.RFC3339),
	}
	if err := finishMutationReceipt(ctx, session, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) ConsumeOIDCAuthorizationCode(
	ctx context.Context,
	body map[string]any,
) (map[string]any, error) {
	codeHash, err := requiredOIDCOpaqueHash(body["codeHash"], "code_hash")
	if err != nil {
		return nil, err
	}
	clientID, err := requiredAuthString(body["clientId"], "client_id", 128)
	if err != nil {
		return nil, err
	}
	redirectURI, err := requiredAuthString(body["redirectUri"], "redirect_uri", 1000)
	if err != nil {
		return nil, err
	}
	verifierChallenge := strings.TrimSpace(stringField(body["verifierChallenge"]))
	if !oidcPKCEChallengePattern.MatchString(verifierChallenge) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: PKCE verification failed")
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var (
		codeID, clientPK, sessionPK uint64
		rowClientID, clientName     string
		appCode                     sql.NullString
		clientType, authMode        string
		homeURL, logoutURL          sql.NullString
		clientStatus                string
		uid, rowRedirectURI, scope  string
		nonce                       sql.NullString
		codeChallenge, codeMethod   string
		expiresAt                   time.Time
		sessionHash, sessionStatus  string
		sessionRevokedAt            sql.NullTime
		sessionExpiresAt            time.Time
		codeStatus                  string
		consumedAt                  sql.NullTime
	)
	err = tx.QueryRowContext(ctx, `
		SELECT ac.id,c.id,c.client_id,c.client_name,c.app_code,c.client_type,c.auth_mode,
			c.home_url,c.logout_url,c.status,ac.session_id,ac.uid,ac.redirect_uri,ac.scope,
			ac.nonce,ac.code_challenge,ac.code_challenge_method,ac.expires_at,ac.status,
			ac.consumed_at,ls.session_id,ls.status,ls.revoked_at,ls.expires_at
		FROM auth_authorization_codes ac
		INNER JOIN auth_clients c ON c.id=ac.client_id
		INNER JOIN local_sessions ls ON ls.id=ac.session_id
		WHERE ac.code_hash=?
		LIMIT 1
		FOR UPDATE
	`, codeHash).Scan(
		&codeID, &clientPK, &rowClientID, &clientName, &appCode, &clientType, &authMode,
		&homeURL, &logoutURL, &clientStatus, &sessionPK, &uid, &rowRedirectURI, &scope,
		&nonce, &codeChallenge, &codeMethod, &expiresAt, &codeStatus,
		&consumedAt, &sessionHash, &sessionStatus, &sessionRevokedAt, &sessionExpiresAt,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: authorization code is invalid or expired")
	}
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if codeStatus != "active" || consumedAt.Valid || !expiresAt.After(now) ||
		clientStatus != "active" || (authMode != "oidc" && authMode != "mixed") ||
		sessionStatus != "active" || sessionRevokedAt.Valid || !sessionExpiresAt.After(now) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: authorization code is invalid or expired")
	}
	if rowClientID != clientID || rowRedirectURI != redirectURI {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: client_id or redirect_uri mismatch")
	}
	if codeMethod != "S256" || codeChallenge != verifierChallenge {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: PKCE verification failed")
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE auth_authorization_codes
		SET status='consumed',consumed_at=UTC_TIMESTAMP()
		WHERE id=? AND status='active' AND consumed_at IS NULL
	`, codeID)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: authorization code was already consumed")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO auth_token_events (
			event_type,client_id,uid,session_hash,token_hash,result,created_at
		) VALUES ('authorization_code_consume',?,?,?,?, 'success',UTC_TIMESTAMP())
	`, rowClientID, uid, sessionHash, codeHash); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	session, err := a.ResolveAuthSession(ctx, map[string]any{
		"sessionIdHash": sessionHash, "touch": false,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"client": map[string]any{
			"id": clientPK, "clientId": rowClientID, "clientName": clientName,
			"appCode": authNullableStringValue(appCode), "clientType": clientType,
			"authMode": authMode, "homeUrl": authNullableStringValue(homeURL),
			"logoutUrl": authNullableStringValue(logoutURL), "status": clientStatus,
		},
		"session": session, "scope": scope, "nonce": authNullableStringValue(nonce),
		"sessionPk": sessionPK,
	}, nil
}

func (a *Adapter) IssueOIDCRefreshToken(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	tokenHash, err := requiredOIDCOpaqueHash(body["tokenHash"], "token_hash")
	if err != nil {
		return nil, err
	}
	tokenFamily, err := requiredAuthString(body["tokenFamily"], "token_family", 128)
	if err != nil {
		return nil, err
	}
	clientID, err := requiredAuthString(body["clientId"], "client_id", 128)
	if err != nil {
		return nil, err
	}
	sessionHash, err := requiredAuthSessionHash(body["sessionIdHash"])
	if err != nil {
		return nil, err
	}
	ttlSeconds, ok := integerField(body["ttlSeconds"])
	if !ok || ttlSeconds < 60 || ttlSeconds > 90*24*60*60 {
		return nil, httperror.New(http.StatusBadRequest, "refresh_token_ttl_invalid", "refresh token ttlSeconds is invalid")
	}
	expiresAt := time.Now().UTC().Add(time.Duration(ttlSeconds) * time.Second).Truncate(time.Second)
	payload := map[string]any{
		"tokenHash": tokenHash, "tokenFamily": tokenFamily, "clientId": clientID,
		"sessionIdHash": sessionHash, "ttlSeconds": ttlSeconds,
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.oidc.refresh_token.issue", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result, err := session.tx.ExecContext(ctx, `
		INSERT INTO auth_refresh_tokens (
			token_hash,token_family,client_id,session_id,uid,issued_at,expires_at,status
		)
		SELECT ?,?,c.id,ls.id,ls.uid,UTC_TIMESTAMP(),?,'active'
		FROM auth_clients c
		INNER JOIN local_sessions ls ON ls.session_id=?
		WHERE c.client_id=? AND c.status='active' AND c.auth_mode IN ('oidc','mixed')
			AND ls.status='active' AND ls.revoked_at IS NULL AND ls.expires_at>UTC_TIMESTAMP()
	`, tokenHash, tokenFamily, expiresAt, sessionHash, clientID)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusBadRequest, "refresh_token_context_invalid", "OIDC client or session is invalid")
	}
	if _, err := session.tx.ExecContext(ctx, `
		INSERT INTO auth_token_events (
			event_type,client_id,uid,session_hash,token_hash,result,created_at
		)
		SELECT 'refresh_token_issue',c.client_id,ls.uid,ls.session_id,?,'success',UTC_TIMESTAMP()
		FROM auth_clients c
		INNER JOIN local_sessions ls ON ls.session_id=?
		WHERE c.client_id=?
	`, tokenHash, sessionHash, clientID); err != nil {
		return nil, err
	}
	response := map[string]any{"created": true, "expiresAt": expiresAt.Format(time.RFC3339)}
	if err := finishMutationReceipt(ctx, session, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) ConsumeOIDCRefreshToken(
	ctx context.Context,
	body map[string]any,
) (map[string]any, error) {
	tokenHash, err := requiredOIDCOpaqueHash(body["tokenHash"], "token_hash")
	if err != nil {
		return nil, err
	}
	clientID, err := requiredAuthString(body["clientId"], "client_id", 128)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var (
		tokenID, clientPK, sessionPK uint64
		tokenFamily, rowClientID     string
		clientName                   string
		appCode                      sql.NullString
		clientType, authMode         string
		homeURL, logoutURL           sql.NullString
		clientStatus, uid            string
		expiresAt                    time.Time
		tokenStatus                  string
		sessionHash, sessionStatus   string
		sessionRevokedAt             sql.NullTime
		sessionExpiresAt             time.Time
	)
	err = tx.QueryRowContext(ctx, `
		SELECT rt.id,rt.token_family,c.id,c.client_id,c.client_name,c.app_code,
			c.client_type,c.auth_mode,c.home_url,c.logout_url,c.status,
			rt.session_id,rt.uid,rt.expires_at,rt.status,
			ls.session_id,ls.status,ls.revoked_at,ls.expires_at
		FROM auth_refresh_tokens rt
		INNER JOIN auth_clients c ON c.id=rt.client_id
		INNER JOIN local_sessions ls ON ls.id=rt.session_id
		WHERE rt.token_hash=?
		LIMIT 1
		FOR UPDATE
	`, tokenHash).Scan(
		&tokenID, &tokenFamily, &clientPK, &rowClientID, &clientName, &appCode,
		&clientType, &authMode, &homeURL, &logoutURL, &clientStatus,
		&sessionPK, &uid, &expiresAt, &tokenStatus,
		&sessionHash, &sessionStatus, &sessionRevokedAt, &sessionExpiresAt,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: refresh token is invalid")
	}
	if err != nil {
		return nil, err
	}
	if rowClientID != clientID {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: client_id mismatch")
	}
	if tokenStatus != "active" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE auth_refresh_tokens
			SET status='revoked',
				reuse_detected_at=CASE WHEN token_hash=? THEN UTC_TIMESTAMP() ELSE reuse_detected_at END,
				revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP())
			WHERE token_family=? AND status IN ('active','rotated')
		`, tokenHash, tokenFamily); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO auth_token_events (
				event_type,client_id,uid,session_hash,token_hash,result,failure_reason,created_at
			) VALUES ('reuse_detected',?,?,?,?, 'failed','refresh token reuse detected',UTC_TIMESTAMP())
		`, rowClientID, uid, sessionHash, tokenHash); err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: refresh token is not active")
	}
	now := time.Now().UTC()
	if !expiresAt.After(now) {
		if _, err := tx.ExecContext(ctx, `UPDATE auth_refresh_tokens SET status='expired' WHERE id=? AND status='active'`, tokenID); err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: refresh token expired")
	}
	if clientStatus != "active" || (authMode != "oidc" && authMode != "mixed") ||
		sessionStatus != "active" || sessionRevokedAt.Valid || !sessionExpiresAt.After(now) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: session revoked or expired")
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE auth_refresh_tokens SET status='rotated',rotated_at=UTC_TIMESTAMP()
		WHERE id=? AND status='active'
	`, tokenID)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_grant", "invalid_grant: refresh token was already used")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO auth_token_events (
			event_type,client_id,uid,session_hash,token_hash,result,created_at
		) VALUES ('refresh_token_consume',?,?,?,?, 'success',UTC_TIMESTAMP())
	`, rowClientID, uid, sessionHash, tokenHash); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	session, err := a.ResolveAuthSession(ctx, map[string]any{
		"sessionIdHash": sessionHash, "touch": false,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"client": map[string]any{
			"id": clientPK, "clientId": rowClientID, "clientName": clientName,
			"appCode": authNullableStringValue(appCode), "clientType": clientType,
			"authMode": authMode, "homeUrl": authNullableStringValue(homeURL),
			"logoutUrl": authNullableStringValue(logoutURL), "status": clientStatus,
		},
		"session": session, "tokenFamily": tokenFamily, "sessionPk": sessionPK,
	}, nil
}

func (a *Adapter) RevokeOIDCRefreshTokens(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	rawTokenHash := strings.TrimSpace(stringField(body["tokenHash"]))
	rawTokenFamily := strings.TrimSpace(stringField(body["tokenFamily"]))
	if (rawTokenHash == "") == (rawTokenFamily == "") {
		return nil, httperror.New(
			http.StatusBadRequest,
			"oidc_refresh_token_selector_invalid",
			"exactly one of tokenHash or tokenFamily is required",
		)
	}
	var (
		tokenHash   string
		tokenFamily string
		err         error
	)
	if rawTokenHash != "" {
		tokenHash, err = requiredOIDCOpaqueHash(rawTokenHash, "token_hash")
	} else {
		tokenFamily, err = requiredAuthString(rawTokenFamily, "token_family", 128)
	}
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"tokenHash": nullableText(tokenHash), "tokenFamily": nullableText(tokenFamily),
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.oidc.refresh_token.revoke", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()

	if tokenHash != "" {
		var storedFamily string
		err := session.tx.QueryRowContext(ctx, `
			SELECT token_family
			FROM auth_refresh_tokens
			WHERE token_hash=?
			LIMIT 1
			FOR UPDATE
		`, tokenHash).Scan(&storedFamily)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if err == nil {
			tokenFamily = storedFamily
		}
	}

	var result sql.Result
	if tokenFamily != "" {
		result, err = session.tx.ExecContext(ctx, `
			UPDATE auth_refresh_tokens
			SET status='revoked',revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP())
			WHERE token_family=? AND status IN ('active','rotated')
		`, tokenFamily)
	} else {
		result, err = session.tx.ExecContext(ctx, `
			UPDATE auth_refresh_tokens
			SET status='revoked',revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP())
			WHERE token_hash=? AND status='active'
		`, tokenHash)
	}
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	response := map[string]any{"revoked": affected > 0}
	targetKey := authSessionFingerprint(tokenHash)
	if tokenFamily != "" {
		targetKey = tokenFamily
	}
	if err := a.finishMutation(
		ctx, session, "console", "auth.oidc.refresh_token.revoke", "auth_refresh_token",
		targetKey, map[string]any{"revoked": affected > 0}, response,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) AppendOIDCTokenEvent(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	eventType, err := requiredAuditCode(body["eventType"], "eventType")
	if err != nil {
		return nil, err
	}
	result := firstValue(strings.TrimSpace(stringField(body["result"])), "success")
	if result != "success" && result != "failed" {
		return nil, httperror.New(http.StatusBadRequest, "oidc_token_event_result_invalid", "result must be success or failed")
	}
	clientID := nullableLimitedString(body["clientId"], 128)
	uid := nullableLimitedString(body["uid"], 64)
	sessionHash, err := optionalOIDCHashPointer(body["sessionHash"], "session_hash")
	if err != nil {
		return nil, err
	}
	tokenHash, err := optionalOIDCHashPointer(body["tokenHash"], "token_hash")
	if err != nil {
		return nil, err
	}
	failureReason := nullableLimitedString(body["failureReason"], 500)
	ipAddress := nullableLimitedString(body["ipAddress"], 64)
	userAgent := nullableLimitedString(body["userAgent"], 500)
	payload := map[string]any{
		"eventType": eventType, "clientId": clientID, "uid": uid,
		"sessionHash": sessionHash, "tokenHash": tokenHash, "result": result,
		"failureReason": failureReason, "ipAddress": ipAddress, "userAgent": userAgent,
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.oidc.token_event.append", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	if _, err := session.tx.ExecContext(ctx, `
		INSERT INTO auth_token_events (
			event_type,client_id,uid,session_hash,token_hash,result,failure_reason,
			ip_address,user_agent,created_at
		) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())
	`, eventType, clientID, uid, sessionHash, tokenHash, result, failureReason,
		ipAddress, userAgent); err != nil {
		return nil, err
	}
	response := map[string]any{"appended": true}
	if err := finishMutationReceipt(ctx, session, response); err != nil {
		return nil, err
	}
	return response, nil
}

type oidcClientScanner interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func loadActiveOIDCClient(
	ctx context.Context,
	scanner oidcClientScanner,
	clientID string,
) (map[string]any, error) {
	var id uint64
	var clientName, clientType, authMode, status string
	var appCode, homeURL, logoutURL sql.NullString
	err := scanner.QueryRowContext(ctx, `
		SELECT id,client_id,client_name,app_code,client_type,auth_mode,home_url,logout_url,status
		FROM auth_clients
		WHERE client_id=? AND status='active'
		LIMIT 1
	`, clientID).Scan(
		&id, &clientID, &clientName, &appCode, &clientType, &authMode, &homeURL, &logoutURL, &status,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "clientId": clientID, "clientName": clientName,
		"appCode": authNullableStringValue(appCode), "clientType": clientType,
		"authMode": authMode, "homeUrl": authNullableStringValue(homeURL),
		"logoutUrl": authNullableStringValue(logoutURL), "status": status,
	}, nil
}

func normalizeOIDCScope(value any) (string, error) {
	parts := strings.Fields(stringField(value))
	seen := map[string]bool{}
	for _, part := range parts {
		if !oidcSupportedScopes[part] {
			return "", httperror.New(http.StatusBadRequest, "invalid_scope", "invalid_scope: unsupported scope")
		}
		seen[part] = true
	}
	if !seen["openid"] {
		return "", httperror.New(http.StatusBadRequest, "invalid_scope", "invalid_scope: openid is required")
	}
	normalized := make([]string, 0, len(seen))
	for part := range seen {
		normalized = append(normalized, part)
	}
	sort.Strings(normalized)
	return strings.Join(normalized, " "), nil
}

func requiredOIDCOpaqueHash(value any, field string) (string, error) {
	hash := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if !authSessionHashPattern.MatchString(hash) {
		return "", httperror.New(http.StatusBadRequest, "oidc_"+field+"_invalid", field+" is invalid")
	}
	return hash, nil
}

func optionalOIDCOpaqueHash(value any, field string) (any, error) {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil, nil
	}
	return requiredOIDCOpaqueHash(text, field)
}

func optionalOIDCHashPointer(value any, field string) (*string, error) {
	normalized, err := optionalOIDCOpaqueHash(value, field)
	if err != nil || normalized == nil {
		return nil, err
	}
	hash := normalized.(string)
	return &hash, nil
}
