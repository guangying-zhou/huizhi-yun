package console

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type authClientMaterialization struct {
	ClientID    string
	ClientName  string
	AppCode     string
	AuthMode    string
	HomeURL     *string
	CallbackURL *string
	LogoutURL   *string
	Icon        *string
	Description *string
	SourceHash  string
	Status      string
}

func (a *Adapter) MaterializeAuthClients(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	mode := strings.TrimSpace(stringField(body["mode"]))
	if mode != "upsert" && mode != "append" && mode != "local" {
		return nil, httperror.New(http.StatusBadRequest, "auth_client_materialize_mode_invalid", "mode must be upsert, append, or local")
	}
	source := strings.TrimSpace(stringField(body["source"]))
	if source != "bundle" && source != "bundle_test" && source != "local" {
		return nil, httperror.New(http.StatusBadRequest, "auth_client_materialize_source_invalid", "source is invalid")
	}
	if mode == "local" && source != "local" {
		return nil, httperror.New(http.StatusBadRequest, "auth_client_materialize_source_invalid", "local mode requires local source")
	}
	applications, err := parseAuthClientMaterializations(body["applications"])
	if err != nil {
		return nil, err
	}
	payload := map[string]any{"mode": mode, "source": source, "applications": body["applications"]}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.clients.materialize", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()

	response := map[string]any{}
	if mode == "local" {
		response, err = materializeLocalAuthClients(ctx, session.tx, applications)
	} else {
		response, err = materializeBundleAuthClients(ctx, session.tx, mode, source, applications)
	}
	if err != nil {
		return nil, err
	}
	if err := a.finishMutation(
		ctx, session, "console", "auth.clients.materialize", "auth_client_set",
		source, map[string]any{
			"mode": mode, "source": source, "applications": len(applications),
		}, response,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) AuthRuntimeHealthSummary(ctx context.Context) (map[string]any, error) {
	var currentKid, lastAuthError sql.NullString
	var lastAuthErrorAt sql.NullTime
	var activeClients, activeSessions uint64
	if err := a.db.QueryRowContext(ctx, `
		SELECT
			(SELECT kid FROM auth_signing_keys
			 WHERE status='current'
				AND (not_before IS NULL OR not_before<=UTC_TIMESTAMP())
				AND (not_after IS NULL OR not_after>UTC_TIMESTAMP())
			 ORDER BY id DESC LIMIT 1),
			(SELECT COUNT(*) FROM auth_clients WHERE status='active'),
			(SELECT COUNT(*) FROM local_sessions
			 WHERE status='active' AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP()),
			(SELECT failure_reason FROM auth_token_events
			 WHERE result='failed' ORDER BY created_at DESC,id DESC LIMIT 1),
			(SELECT created_at FROM auth_token_events
			 WHERE result='failed' ORDER BY created_at DESC,id DESC LIMIT 1)
	`).Scan(&currentKid, &activeClients, &activeSessions, &lastAuthError, &lastAuthErrorAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"signingKid": currentKid.String, "activeClients": activeClients,
		"activeSessions": activeSessions, "lastAuthError": nullStringPointer(lastAuthError),
		"lastAuthErrorAt": nullableTimeRFC3339(lastAuthErrorAt),
	}, nil
}

func materializeLocalAuthClients(
	ctx context.Context,
	tx *sql.Tx,
	applications []authClientMaterialization,
) (map[string]any, error) {
	clients, redirectURIs, skippedDeleted := 0, 0, 0
	for _, app := range applications {
		var clientID uint64
		var status string
		err := tx.QueryRowContext(ctx, `
			SELECT id,status FROM auth_clients WHERE client_id=? LIMIT 1
		`, app.ClientID).Scan(&clientID, &status)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if err == nil && status == "deleted" {
			skippedDeleted++
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO auth_clients (
				client_id,client_name,app_code,client_type,auth_mode,home_url,logout_url,
				icon,description,source,source_hash,status,created_at,updated_at
			) VALUES (?,?,?,'public',?,?,?,?,?,'local',?, ?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE
				status=CASE WHEN status='deleted' THEN status ELSE 'active' END,
				updated_at=UTC_TIMESTAMP()
		`, app.ClientID, app.ClientName, app.AppCode, app.AuthMode, app.HomeURL,
			app.LogoutURL, app.Icon, app.Description, app.SourceHash, app.Status); err != nil {
			return nil, err
		}
		clients++
		if err := tx.QueryRowContext(ctx, `
			SELECT id,status FROM auth_clients WHERE client_id=? LIMIT 1
		`, app.ClientID).Scan(&clientID, &status); err != nil {
			return nil, err
		}
		if status == "deleted" {
			continue
		}
		for _, uri := range authClientURIs(app) {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO auth_client_redirect_uris (
					client_id,uri_type,redirect_uri,source,status,created_at,updated_at
				) VALUES (?,?,?,'local','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
				ON DUPLICATE KEY UPDATE source='local',status='active',updated_at=UTC_TIMESTAMP()
			`, clientID, uri.kind, uri.value); err != nil {
				return nil, err
			}
			redirectURIs++
		}
	}
	return map[string]any{
		"clients": clients, "redirectUris": redirectURIs,
		"skippedDeletedClients": skippedDeleted,
	}, nil
}

func materializeBundleAuthClients(
	ctx context.Context,
	tx *sql.Tx,
	mode string,
	source string,
	applications []authClientMaterialization,
) (map[string]any, error) {
	seenCodes := make([]string, 0, len(applications))
	for _, app := range applications {
		seenCodes = append(seenCodes, app.AppCode)
	}
	inactive, err := deactivateMissingBundleClients(ctx, tx, mode, seenCodes)
	if err != nil {
		return nil, err
	}
	upserted, activeURIs, skipped := 0, 0, 0
	for _, app := range applications {
		var clientID uint64
		err := tx.QueryRowContext(ctx, `SELECT id FROM auth_clients WHERE client_id=? LIMIT 1`, app.ClientID).Scan(&clientID)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if err == sql.ErrNoRows && mode == "append" {
			skipped++
			continue
		}
		if mode == "upsert" {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO auth_clients (
					client_id,client_name,app_code,client_type,auth_mode,home_url,logout_url,
					icon,description,source,source_hash,status,created_at,updated_at
				) VALUES (?,?,?,'public',?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
				ON DUPLICATE KEY UPDATE
					client_name=VALUES(client_name),app_code=VALUES(app_code),
					auth_mode=VALUES(auth_mode),home_url=VALUES(home_url),
					logout_url=VALUES(logout_url),icon=VALUES(icon),
					description=VALUES(description),source=VALUES(source),
					source_hash=VALUES(source_hash),status=VALUES(status),
					updated_at=UTC_TIMESTAMP()
			`, app.ClientID, app.ClientName, app.AppCode, app.AuthMode, app.HomeURL,
				app.LogoutURL, app.Icon, app.Description, source, app.SourceHash, app.Status); err != nil {
				return nil, err
			}
			upserted++
			if err := tx.QueryRowContext(ctx, `SELECT id FROM auth_clients WHERE client_id=? LIMIT 1`, app.ClientID).Scan(&clientID); err != nil {
				return nil, err
			}
		}
		for _, uri := range authClientURIs(app) {
			if mode == "upsert" {
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO auth_client_redirect_uris (
						client_id,uri_type,redirect_uri,source,status,created_at,updated_at
					) VALUES (?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
					ON DUPLICATE KEY UPDATE source=VALUES(source),status=VALUES(status),updated_at=UTC_TIMESTAMP()
				`, clientID, uri.kind, uri.value, source, app.Status); err != nil {
					return nil, err
				}
			} else if _, err := tx.ExecContext(ctx, `
				INSERT INTO auth_client_redirect_uris (
					client_id,uri_type,redirect_uri,source,status,created_at,updated_at
				) VALUES (?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
				ON DUPLICATE KEY UPDATE updated_at=updated_at
			`, clientID, uri.kind, uri.value, source, app.Status); err != nil {
				return nil, err
			}
			if app.Status == "active" {
				activeURIs++
			}
		}
	}
	return map[string]any{
		"mode": mode, "seenAppCodes": seenCodes, "upsertedClients": upserted,
		"activeRedirectUris": activeURIs, "inactiveBundleClients": inactive,
		"skippedMissingClients": skipped,
	}, nil
}

func deactivateMissingBundleClients(
	ctx context.Context,
	tx *sql.Tx,
	mode string,
	seenCodes []string,
) (int64, error) {
	if mode != "upsert" {
		return 0, nil
	}
	query := `UPDATE auth_clients
		SET status='inactive',updated_at=UTC_TIMESTAMP()
		WHERE source='bundle' AND status='active'`
	args := make([]any, 0, len(seenCodes))
	if len(seenCodes) > 0 {
		query += " AND app_code NOT IN (" + strings.TrimSuffix(strings.Repeat("?,", len(seenCodes)), ",") + ")"
		for _, code := range seenCodes {
			args = append(args, code)
		}
	}
	result, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

type authClientURI struct {
	kind  string
	value string
}

func authClientURIs(app authClientMaterialization) []authClientURI {
	result := make([]authClientURI, 0, 2)
	if app.CallbackURL != nil {
		result = append(result, authClientURI{kind: "redirect", value: *app.CallbackURL})
	}
	if app.LogoutURL != nil {
		result = append(result, authClientURI{kind: "post_logout", value: *app.LogoutURL})
	}
	return result
}

func parseAuthClientMaterializations(value any) ([]authClientMaterialization, error) {
	raw, ok := value.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "auth_client_applications_invalid", "applications must be an array")
	}
	if len(raw) > 100 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "auth_client_applications_too_large", "applications accepts at most 100 items")
	}
	result := make([]authClientMaterialization, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		record, ok := item.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "auth_client_application_invalid", "application item must be an object")
		}
		appCode, err := requiredAuditCode(record["appCode"], "appCode")
		if err != nil || seen[appCode] {
			return nil, httperror.New(http.StatusBadRequest, "auth_client_app_code_invalid", "application appCode is invalid or duplicated")
		}
		seen[appCode] = true
		clientID, err := requiredAuthString(firstValue(stringField(record["clientId"]), appCode), "client_id", 128)
		if err != nil {
			return nil, err
		}
		clientName, err := requiredAuthString(firstValue(stringField(record["clientName"]), appCode), "client_name", 191)
		if err != nil {
			return nil, err
		}
		authMode := firstValue(stringField(record["authMode"]), "oidc")
		if authMode != "oidc" && authMode != "legacy" && authMode != "mixed" {
			return nil, httperror.New(http.StatusBadRequest, "auth_client_mode_invalid", "application authMode is invalid")
		}
		status := firstValue(stringField(record["status"]), "active")
		if status != "active" && status != "inactive" {
			return nil, httperror.New(http.StatusBadRequest, "auth_client_status_invalid", "application status is invalid")
		}
		sourceHash, err := requiredAuthString(record["sourceHash"], "source_hash", 80)
		if err != nil || !strings.HasPrefix(sourceHash, "sha256_") {
			return nil, httperror.New(http.StatusBadRequest, "auth_client_source_hash_invalid", "application sourceHash is invalid")
		}
		homeURL, err := optionalAuthClientURL(record["homeUrl"])
		if err != nil {
			return nil, err
		}
		callbackURL, err := optionalAuthClientURL(record["callbackUrl"])
		if err != nil {
			return nil, err
		}
		logoutURL, err := optionalAuthClientURL(record["logoutUrl"])
		if err != nil {
			return nil, err
		}
		result = append(result, authClientMaterialization{
			ClientID: clientID, ClientName: clientName, AppCode: appCode,
			AuthMode: authMode, HomeURL: homeURL, CallbackURL: callbackURL,
			LogoutURL: logoutURL, Icon: nullableLimitedString(record["icon"], 191),
			Description: nullableLimitedString(record["description"], 1000),
			SourceHash:  sourceHash, Status: status,
		})
	}
	return result, nil
}

func optionalAuthClientURL(value any) (*string, error) {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil, nil
	}
	if len(text) > 2048 {
		return nil, httperror.New(http.StatusBadRequest, "auth_client_url_invalid", "application URL is too long")
	}
	parsed, err := url.Parse(text)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
		return nil, httperror.New(http.StatusBadRequest, "auth_client_url_invalid", "application URL must be an absolute HTTP URL")
	}
	return &text, nil
}
