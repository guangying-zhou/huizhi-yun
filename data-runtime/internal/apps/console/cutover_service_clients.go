package console

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// RetireLegacyCutoverServiceClient resolves an active credential-integrity
// blocker without waiving it. The legacy row is retained but made inactive
// only when an active, credential-backed replacement for the same app already
// owns every active grant of the legacy client.
func (a *Adapter) RetireLegacyCutoverServiceClient(
	ctx context.Context,
	serviceClientKey string,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	serviceClientID, err := strconv.ParseUint(strings.TrimSpace(serviceClientKey), 10, 64)
	if err != nil || serviceClientID == 0 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"cutover_service_client_id_invalid",
			"service client id must be a positive integer",
		)
	}
	changeReference := strings.TrimSpace(stringField(body["changeReference"]))
	if !cutoverDispositionChangePattern.MatchString(changeReference) {
		return nil, httperror.New(
			http.StatusBadRequest,
			"cutover_disposition_change_reference_invalid",
			"changeReference must be 3-128 safe ASCII characters",
		)
	}
	expectedFingerprint := strings.ToLower(strings.TrimSpace(stringField(body["expectedSourceFingerprint"])))
	if !cutoverDispositionFingerprintPattern.MatchString(expectedFingerprint) {
		return nil, httperror.New(
			http.StatusBadRequest,
			"cutover_disposition_fingerprint_invalid",
			"Expected source fingerprint is invalid",
		)
	}
	if strings.TrimSpace(stringField(body["reasonCode"])) != "legacy-retired" {
		return nil, httperror.New(
			http.StatusBadRequest,
			"cutover_service_client_reason_code_invalid",
			"reasonCode must be legacy-retired",
		)
	}
	reason := strings.TrimSpace(stringField(body["reason"]))
	if utf8.RuneCountInString(reason) < 10 || utf8.RuneCountInString(reason) > 500 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"cutover_disposition_reason_invalid",
			"Retirement reason must be 10-500 characters",
		)
	}
	body["serviceClientId"] = serviceClientID
	actorType := strings.TrimSpace(meta.ActorType)
	if actorType == "" {
		actorType = "service"
	}
	session, replay, err := a.beginMutationAs(
		ctx,
		"console.cutover_service_client.retire",
		meta.IdempotencyKey,
		meta.RequestID,
		actorType,
		meta.ActorID,
		body,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()

	var (
		source            cutoverDispositionSource
		clientCode        string
		appCode           sql.NullString
		replacementID     uint64
		replacementCode   string
		missingGrantCount uint64
	)
	err = session.tx.QueryRowContext(ctx, `
		SELECT CAST(sc.id AS CHAR),`+serviceClientCutoverFingerprintSQL+`,
			sc.updated_at,sc.status,sc.client_code,sc.app_code
		FROM service_clients sc
		LEFT JOIN service_client_credentials scc
		  ON scc.id=sc.current_credential_id AND scc.service_client_id=sc.id
		LEFT JOIN vault_secrets vs ON vs.id=scc.secret_id
		LEFT JOIN vault_secret_versions vsv
		  ON vsv.id=vs.current_version_id AND vsv.secret_id=vs.id
		WHERE sc.id=? AND sc.status='active' AND sc.current_credential_id IS NULL
		FOR UPDATE
	`, serviceClientID).Scan(
		&source.SubjectKey,
		&source.SourceFingerprint,
		&source.SourceUpdatedAt,
		&source.SourceStatus,
		&clientCode,
		&appCode,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(
			http.StatusConflict,
			"cutover_service_client_not_legacy",
			"Service client is absent, already inactive, or has a current credential",
		)
	}
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(source.SourceFingerprint), []byte(expectedFingerprint)) != 1 {
		return nil, httperror.New(
			http.StatusConflict,
			"cutover_disposition_source_changed",
			"Service client changed after review; refresh and review again",
		)
	}
	if !appCode.Valid || strings.TrimSpace(appCode.String) == "" {
		return nil, httperror.New(
			http.StatusConflict,
			"cutover_service_client_replacement_missing",
			"Legacy service client has no application binding for replacement verification",
		)
	}
	err = session.tx.QueryRowContext(ctx, `
		SELECT replacement.id,replacement.client_code
		FROM service_clients replacement
		INNER JOIN service_client_credentials replacement_credential
		  ON replacement_credential.id=replacement.current_credential_id
		 AND replacement_credential.service_client_id=replacement.id
		 AND replacement_credential.status='active'
		 AND (replacement_credential.expires_at IS NULL
		   OR replacement_credential.expires_at>UTC_TIMESTAMP())
		INNER JOIN vault_secrets replacement_secret
		  ON replacement_secret.id=replacement_credential.secret_id
		 AND replacement_secret.status='active'
		INNER JOIN vault_secret_versions replacement_version
		  ON replacement_version.id=replacement_secret.current_version_id
		 AND replacement_version.secret_id=replacement_secret.id
		 AND replacement_version.status='active'
		WHERE replacement.id<>? AND replacement.app_code=?
		  AND replacement.status='active'
		ORDER BY CASE WHEN replacement.client_code=CONCAT(? ,'.runtime') THEN 0 ELSE 1 END,
			replacement.id
		LIMIT 1
		FOR UPDATE
	`, serviceClientID, appCode.String, appCode.String).Scan(&replacementID, &replacementCode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(
			http.StatusConflict,
			"cutover_service_client_replacement_missing",
			"No active credential-backed replacement exists for the legacy service client",
		)
	}
	if err != nil {
		return nil, err
	}
	if err := session.tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM service_client_grants legacy_grant
		LEFT JOIN service_client_grants replacement_grant
		  ON replacement_grant.service_client_id=?
		 AND replacement_grant.resource_code=legacy_grant.resource_code
		 AND replacement_grant.action=legacy_grant.action
		 AND replacement_grant.status='active'
		WHERE legacy_grant.service_client_id=?
		  AND legacy_grant.status='active'
		  AND replacement_grant.id IS NULL
	`, replacementID, serviceClientID).Scan(&missingGrantCount); err != nil {
		return nil, err
	}
	if missingGrantCount > 0 {
		return nil, httperror.New(
			http.StatusConflict,
			"cutover_service_client_replacement_grants_incomplete",
			"Replacement service client does not own every active legacy grant",
		)
	}
	update, err := session.tx.ExecContext(ctx, `
		UPDATE service_clients
		SET status='inactive',updated_at=UTC_TIMESTAMP()
		WHERE id=? AND status='active' AND current_credential_id IS NULL
	`, serviceClientID)
	if err != nil {
		return nil, err
	}
	affected, err := update.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(
			http.StatusConflict,
			"cutover_service_client_source_changed",
			"Legacy service client changed while retirement was in progress",
		)
	}
	response := map[string]any{
		"serviceClientId":       serviceClientID,
		"clientCode":            clientCode,
		"status":                "inactive",
		"replacementClientId":   replacementID,
		"replacementClientCode": replacementCode,
		"changeReference":       changeReference,
	}
	if err := a.finishMutation(
		ctx,
		session,
		"service_client",
		"retire_legacy_cutover_client",
		"service_client",
		strconv.FormatUint(serviceClientID, 10),
		map[string]any{
			"changeReference":       changeReference,
			"reasonCode":            "legacy-retired",
			"sourceFingerprint":     source.SourceFingerprint,
			"replacementClientId":   replacementID,
			"replacementClientCode": replacementCode,
		},
		response,
	); err != nil {
		return nil, err
	}
	return response, nil
}
