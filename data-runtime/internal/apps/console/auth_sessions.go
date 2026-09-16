package console

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var authSessionHashPattern = regexp.MustCompile(`^sha256_[a-f0-9]{64}$`)

func (a *Adapter) IssueAuthSession(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	sessionHash, err := requiredAuthSessionHash(body["sessionIdHash"])
	if err != nil {
		return nil, err
	}
	uid, err := requiredAuthString(body["uid"], "uid", 64)
	if err != nil {
		return nil, err
	}
	authProvider, err := requiredAuditCode(firstValue(stringField(body["authProvider"]), "local"), "authProvider")
	if err != nil {
		return nil, err
	}
	ttlSeconds, ok := integerField(body["ttlSeconds"])
	if !ok || ttlSeconds < 60 || ttlSeconds > 30*24*60*60 {
		return nil, httperror.New(http.StatusBadRequest, "auth_session_ttl_invalid", "ttlSeconds must be between 60 and 2592000")
	}
	identityID, err := optionalPositiveInteger(body["identityId"], "identityId")
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().UTC().Add(time.Duration(ttlSeconds) * time.Second).Truncate(time.Second)
	payload := map[string]any{
		"sessionIdHash": sessionHash,
		"uid":           uid,
		"identityId":    identityID,
		"authProvider":  authProvider,
		"ipAddress":     nullableLimitedString(body["ipAddress"], 64),
		"userAgent":     nullableLimitedString(body["userAgent"], 500),
		"deviceSummary": nullableLimitedString(body["deviceSummary"], 255),
		"ttlSeconds":    ttlSeconds,
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.session.issue", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result, err := session.tx.ExecContext(ctx, `
		INSERT INTO local_sessions (
			session_id,uid,identity_id,auth_provider,ip_address,user_agent,device_summary,
			issued_at,expires_at,status,created_at,updated_at
		)
		SELECT ?,u.uid,?,?,?,?,?,UTC_TIMESTAMP(),?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
		FROM directory_users u
		WHERE u.uid=? AND u.status='active'
	`, sessionHash, identityID, authProvider,
		nullableLimitedString(body["ipAddress"], 64),
		nullableLimitedString(body["userAgent"], 500),
		nullableLimitedString(body["deviceSummary"], 255),
		expiresAt, uid,
	)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusForbidden, "auth_session_user_inactive", "Session user is missing or inactive")
	}
	response := map[string]any{
		"storedSessionId": sessionHash,
		"expiresAt":       expiresAt.Format(time.RFC3339),
		"ttlSeconds":      ttlSeconds,
	}
	if err := a.finishMutation(
		ctx, session, "console", "auth.session.issue", "auth_session",
		authSessionFingerprint(sessionHash), map[string]any{
			"uid": uid, "authProvider": authProvider,
		}, response,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) ResolveAuthSession(
	ctx context.Context,
	body map[string]any,
) (map[string]any, error) {
	sessionHash, err := requiredAuthSessionHash(body["sessionIdHash"])
	if err != nil {
		return nil, err
	}
	var (
		sessionPK                                 uint64
		storedSessionID, uid, authProvider        string
		identityID                                sql.NullInt64
		issuedAt, expiresAt                       time.Time
		lastSeenAt                                sql.NullTime
		userID                                    uint64
		username, displayName, realName, nickname sql.NullString
		email, mobile, mobileTail4, avatarURL     sql.NullString
		primaryDeptCode, primaryDeptName          sql.NullString
		positionTitle                             sql.NullString
		userType                                  string
		identityProviderCode, identitySubject     sql.NullString
	)
	err = a.db.QueryRowContext(ctx, `
		SELECT ls.id,ls.session_id,ls.uid,ls.identity_id,ls.auth_provider,
			ls.issued_at,ls.last_seen_at,ls.expires_at,
			u.id,u.username,u.display_name,u.real_name,u.nickname,u.email,u.mobile,
			u.mobile_tail4,u.avatar_url,pd.dept_code,pd.dept_name,u.position_title,
			u.user_type,di.provider_code,di.provider_subject
		FROM local_sessions ls
		INNER JOIN directory_users u ON u.uid=ls.uid AND u.status='active'
		LEFT JOIN directory_identities di ON di.id=ls.identity_id
		LEFT JOIN (
			SELECT ranked.uid,ranked.dept_code,ranked.dept_name
			FROM (
				SELECT ud.uid,ud.dept_code,d.dept_name,
					ROW_NUMBER() OVER (
						PARTITION BY ud.uid
						ORDER BY ud.is_primary DESC,d.sort_order ASC,d.id ASC,ud.id ASC
					) AS row_no
				FROM directory_user_departments ud
				INNER JOIN directory_departments d ON d.dept_code=ud.dept_code
				WHERE ud.status='active' AND ud.relation_type='member'
					AND d.status='active' AND d.org_type='department'
			) ranked
			WHERE ranked.row_no=1
		) pd ON pd.uid=u.uid
		WHERE ls.session_id=? AND ls.status='active' AND ls.revoked_at IS NULL
			AND ls.expires_at>UTC_TIMESTAMP()
		LIMIT 1
	`, sessionHash).Scan(
		&sessionPK, &storedSessionID, &uid, &identityID, &authProvider,
		&issuedAt, &lastSeenAt, &expiresAt,
		&userID, &username, &displayName, &realName, &nickname, &email, &mobile,
		&mobileTail4, &avatarURL, &primaryDeptCode, &primaryDeptName, &positionTitle,
		&userType, &identityProviderCode, &identitySubject,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusUnauthorized, "auth_session_invalid", "Console session is invalid or expired")
	}
	if err != nil {
		return nil, err
	}
	if touch, _ := body["touch"].(bool); touch {
		if _, err := a.db.ExecContext(ctx, `
			UPDATE local_sessions
			SET last_seen_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
			WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<UTC_TIMESTAMP()-INTERVAL 60 SECOND)
		`, sessionPK); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"sessionPk":       sessionPK,
		"storedSessionId": storedSessionID,
		"uid":             uid,
		"identityId":      nullableInt64(identityID),
		"authProvider":    authProvider,
		"issuedAt":        issuedAt.UTC().Format(time.RFC3339),
		"lastSeenAt":      nullableTimeRFC3339(lastSeenAt),
		"expiresAt":       expiresAt.UTC().Format(time.RFC3339),
		"user": map[string]any{
			"id": userID, "uid": uid,
			"username": authNullableStringValue(username), "displayName": authNullableStringValue(displayName),
			"realName": authNullableStringValue(realName), "nickname": authNullableStringValue(nickname),
			"email": authNullableStringValue(email), "mobile": authNullableStringValue(mobile),
			"mobileTail4": authNullableStringValue(mobileTail4), "avatarUrl": authNullableStringValue(avatarURL),
			"primaryDeptCode": authNullableStringValue(primaryDeptCode),
			"primaryDeptName": authNullableStringValue(primaryDeptName),
			"positionTitle":   authNullableStringValue(positionTitle), "userType": userType,
		},
		"identity": map[string]any{
			"providerCode":    authNullableStringValue(identityProviderCode),
			"providerSubject": authNullableStringValue(identitySubject),
		},
	}, nil
}

func (a *Adapter) RevokeAuthSession(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	sessionHash, err := requiredAuthSessionHash(body["sessionIdHash"])
	if err != nil {
		return nil, err
	}
	payload := map[string]any{"sessionIdHash": sessionHash}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.session.revoke", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	if _, err := session.tx.ExecContext(ctx, `
		UPDATE auth_refresh_tokens rt
		INNER JOIN local_sessions ls ON ls.id=rt.session_id
		SET rt.status='revoked',rt.revoked_at=COALESCE(rt.revoked_at,UTC_TIMESTAMP())
		WHERE ls.session_id=? AND rt.status IN ('active','rotated')
	`, sessionHash); err != nil {
		return nil, err
	}
	result, err := session.tx.ExecContext(ctx, `
		UPDATE local_sessions
		SET status='revoked',revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP()),
			updated_at=UTC_TIMESTAMP()
		WHERE session_id=? AND status='active'
	`, sessionHash)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	response := map[string]any{"revoked": affected > 0}
	if err := a.finishMutation(
		ctx, session, "console", "auth.session.revoke", "auth_session",
		authSessionFingerprint(sessionHash), map[string]any{"revoked": affected > 0}, response,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func requiredAuthSessionHash(value any) (string, error) {
	hash := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if !authSessionHashPattern.MatchString(hash) {
		return "", httperror.New(http.StatusBadRequest, "auth_session_hash_invalid", "sessionIdHash is invalid")
	}
	return hash, nil
}

func requiredAuthString(value any, field string, limit int) (string, error) {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" || len(text) > limit {
		return "", httperror.New(http.StatusBadRequest, "auth_"+field+"_invalid", field+" is invalid")
	}
	return text, nil
}

func optionalPositiveInteger(value any, field string) (any, error) {
	if value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" || strings.TrimSpace(fmt.Sprint(value)) == "<nil>" {
		return nil, nil
	}
	parsed, ok := integerField(value)
	if !ok || parsed <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "auth_"+field+"_invalid", field+" must be a positive integer")
	}
	return parsed, nil
}

func authSessionFingerprint(sessionHash string) string {
	if len(sessionHash) <= 12 {
		return sessionHash
	}
	return "sha256_…" + sessionHash[len(sessionHash)-8:]
}

func nullableInt64(value sql.NullInt64) any {
	if !value.Valid {
		return nil
	}
	return value.Int64
}

func authNullableStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func nullableTimeRFC3339(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time.UTC().Format(time.RFC3339)
}
