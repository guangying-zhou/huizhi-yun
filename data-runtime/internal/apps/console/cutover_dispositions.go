package console

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	cutoverDispositionIntegration   = "failed_integration_operations"
	cutoverDispositionNotification  = "failed_notification_deliveries"
	cutoverDispositionDirectorySync = "incomplete_directory_sync_jobs"
)

const serviceClientCutoverFingerprintSQL = `LOWER(SHA2(CONCAT_WS('|',
	'v1',CAST(sc.id AS CHAR),sc.client_code,sc.status,
	COALESCE(CAST(sc.current_credential_id AS CHAR),''),
	COALESCE(CAST(scc.id AS CHAR),''),
	COALESCE(scc.status,''),
	COALESCE(DATE_FORMAT(scc.expires_at,'%Y-%m-%dT%H:%i:%s.%fZ'),''),
	COALESCE(CAST(vs.id AS CHAR),''),
	COALESCE(vs.status,''),
	COALESCE(CAST(vs.current_version_id AS CHAR),''),
	COALESCE(CAST(vsv.id AS CHAR),''),
	COALESCE(vsv.status,''),
	DATE_FORMAT(sc.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ')
),256))`

const integrationOperationCutoverFingerprintSQL = `LOWER(SHA2(CONCAT_WS('|',
	'v1',io.operation_id,io.status,CAST(io.attempt_count AS CHAR),
	COALESCE(io.last_error_code,''),COALESCE(io.last_error_class,''),
	COALESCE(io.target_receipt_id,''),
	DATE_FORMAT(io.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ')
),256))`

const notificationDeliveryCutoverFingerprintSQL = `LOWER(SHA2(CONCAT_WS('|',
	'v1',CAST(pnd.id AS CHAR),pnd.notification_id,pnd.uid,pnd.channel,
	pnd.status,CAST(pnd.attempt_count AS CHAR),COALESCE(pnd.provider,''),
	COALESCE(pnd.last_error,''),
	DATE_FORMAT(pnd.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ')
),256))`

const directorySyncJobCutoverFingerprintSQL = `LOWER(SHA2(CONCAT_WS('|',
	'v1',dsj.job_code,dsj.provider_code,dsj.sync_type,dsj.object_scope,
	dsj.status,CAST(dsj.total_count AS CHAR),CAST(dsj.created_count AS CHAR),
	CAST(dsj.updated_count AS CHAR),CAST(dsj.deleted_count AS CHAR),
	CAST(dsj.skipped_count AS CHAR),CAST(dsj.error_count AS CHAR),
	COALESCE(dsj.error_message,''),
	DATE_FORMAT(dsj.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ')
),256))`

var (
	cutoverDispositionSubjectPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}$`)
	cutoverDispositionFingerprintPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	cutoverDispositionChangePattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,127}$`)
)

type cutoverDispositionInput struct {
	Category                  string
	SubjectKey                string
	ExpectedSourceFingerprint string
	ReasonCode                string
	ReasonText                string
}

type cutoverDispositionSource struct {
	SubjectKey        string
	SourceFingerprint string
	SourceUpdatedAt   time.Time
	SourceStatus      string
}

type cutoverDispositionCandidate struct {
	Category              string  `json:"category"`
	SubjectKey            string  `json:"subjectKey"`
	SourceFingerprint     string  `json:"sourceFingerprint"`
	SourceUpdatedAt       string  `json:"sourceUpdatedAt"`
	SourceStatus          string  `json:"sourceStatus"`
	DispositionStatus     string  `json:"dispositionStatus"`
	DispositionID         *string `json:"dispositionId"`
	DispositionReasonCode *string `json:"dispositionReasonCode"`
	ChangeReference       *string `json:"changeReference"`
	DispositionCreatedAt  *string `json:"dispositionCreatedAt"`
}

type cutoverDispositionListSpec struct {
	category string
	query    string
}

func (a *Adapter) CutoverDispositionCandidates(ctx context.Context) (map[string]any, error) {
	candidates := make([]cutoverDispositionCandidate, 0)
	for _, spec := range cutoverDispositionListSpecs() {
		rows, err := a.db.QueryContext(ctx, spec.query)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var (
				subjectKey, fingerprint, sourceStatus string
				sourceUpdatedAt                       time.Time
				dispositionID, dispositionFingerprint sql.NullString
				reasonCode, changeReference           sql.NullString
				dispositionCreatedAt                  sql.NullTime
			)
			if err := rows.Scan(
				&subjectKey, &fingerprint, &sourceUpdatedAt, &sourceStatus,
				&dispositionID, &dispositionFingerprint, &reasonCode,
				&changeReference, &dispositionCreatedAt,
			); err != nil {
				_ = rows.Close()
				return nil, err
			}
			status := "none"
			if dispositionID.Valid {
				status = "stale"
				if dispositionFingerprint.String == fingerprint {
					status = "effective"
				}
			}
			candidate := cutoverDispositionCandidate{
				Category:          spec.category,
				SubjectKey:        subjectKey,
				SourceFingerprint: fingerprint,
				SourceUpdatedAt:   sourceUpdatedAt.UTC().Format(time.RFC3339Nano),
				SourceStatus:      sourceStatus,
				DispositionStatus: status,
			}
			candidate.DispositionID = nullableString(dispositionID)
			candidate.DispositionReasonCode = nullableString(reasonCode)
			candidate.ChangeReference = nullableString(changeReference)
			if dispositionCreatedAt.Valid {
				value := dispositionCreatedAt.Time.UTC().Format(time.RFC3339Nano)
				candidate.DispositionCreatedAt = &value
			}
			candidates = append(candidates, candidate)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		_ = rows.Close()
	}
	return map[string]any{
		"candidates": candidates,
		"count":      len(candidates),
	}, nil
}

func (a *Adapter) ApplyCutoverDispositions(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	changeReference := strings.TrimSpace(stringField(body["changeReference"]))
	if !cutoverDispositionChangePattern.MatchString(changeReference) {
		return nil, httperror.New(
			http.StatusBadRequest,
			"cutover_disposition_change_reference_invalid",
			"changeReference must be 3-128 safe ASCII characters",
		)
	}
	inputs, err := parseCutoverDispositionInputs(body["dispositions"])
	if err != nil {
		return nil, err
	}
	actorType := strings.TrimSpace(meta.ActorType)
	if actorType == "" {
		actorType = "service"
	}
	session, replay, err := a.beginMutationAs(
		ctx,
		"console.cutover_disposition.apply",
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

	results := make([]map[string]any, 0, len(inputs))
	for _, input := range inputs {
		source, err := loadCutoverDispositionSource(ctx, session.tx, input.Category, input.SubjectKey)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(
				http.StatusConflict,
				"cutover_disposition_source_not_blocking",
				"Disposition source is absent or no longer violates the cutover gate",
			)
		}
		if err != nil {
			return nil, err
		}
		if subtle.ConstantTimeCompare(
			[]byte(source.SourceFingerprint),
			[]byte(input.ExpectedSourceFingerprint),
		) != 1 {
			return nil, httperror.New(
				http.StatusConflict,
				"cutover_disposition_source_changed",
				"Disposition source changed after review; refresh candidates and review again",
			)
		}
		if err := validateCutoverDispositionReason(input.Category, source.SourceStatus, input.ReasonCode); err != nil {
			return nil, err
		}
		dispositionID, err := newMutationReceiptID()
		if err != nil {
			return nil, err
		}
		if _, err := session.tx.ExecContext(ctx, `
			UPDATE console_cutover_dispositions
			SET status='superseded',superseded_by_id=?,superseded_at=UTC_TIMESTAMP(3),
				updated_at=UTC_TIMESTAMP(3)
			WHERE category=? AND subject_key=? AND status='active'
		`, dispositionID, input.Category, input.SubjectKey); err != nil {
			return nil, err
		}
		if _, err := session.tx.ExecContext(ctx, `
			INSERT INTO console_cutover_dispositions (
				disposition_id,category,subject_key,source_fingerprint,source_updated_at,
				reason_code,reason_text,change_reference,status,actor_type,actor_id,
				source_app,request_id,created_at,updated_at
			) VALUES (?,?,?,?,?, ?,?,?,'active',?,?, ?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
		`, dispositionID, input.Category, input.SubjectKey, source.SourceFingerprint,
			source.SourceUpdatedAt, input.ReasonCode, input.ReasonText, changeReference,
			actorType, nullableText(meta.ActorID), firstValue(strings.TrimSpace(meta.SourceApp), "console"),
			nullableText(meta.RequestID)); err != nil {
			return nil, err
		}
		results = append(results, map[string]any{
			"dispositionId":     dispositionID,
			"category":          input.Category,
			"subjectKey":        input.SubjectKey,
			"sourceFingerprint": source.SourceFingerprint,
			"sourceUpdatedAt":   source.SourceUpdatedAt.UTC().Format(time.RFC3339Nano),
			"reasonCode":        input.ReasonCode,
			"status":            "active",
		})
	}
	response := map[string]any{
		"changeReference": changeReference,
		"dispositions":    results,
		"count":           len(results),
	}
	if err := a.finishMutation(
		ctx,
		session,
		"cutover",
		"disposition_apply",
		"cutover_change",
		changeReference,
		map[string]any{
			"changeReference": changeReference,
			"count":           len(results),
			"dispositions":    results,
		},
		response,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func parseCutoverDispositionInputs(raw any) ([]cutoverDispositionInput, error) {
	items, ok := raw.([]any)
	if !ok || len(items) == 0 || len(items) > 500 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"cutover_dispositions_invalid",
			"dispositions must contain between 1 and 500 reviewed items",
		)
	}
	result := make([]cutoverDispositionInput, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "cutover_disposition_invalid", "Each disposition must be an object")
		}
		input := cutoverDispositionInput{
			Category:                  strings.TrimSpace(stringField(item["category"])),
			SubjectKey:                strings.TrimSpace(stringField(item["subjectKey"])),
			ExpectedSourceFingerprint: strings.ToLower(strings.TrimSpace(stringField(item["expectedSourceFingerprint"]))),
			ReasonCode:                strings.TrimSpace(stringField(item["reasonCode"])),
			ReasonText:                strings.TrimSpace(stringField(item["reason"])),
		}
		if !cutoverDispositionCategoryAllowed(input.Category) {
			return nil, httperror.New(http.StatusBadRequest, "cutover_disposition_category_invalid", "Disposition category is not allowed")
		}
		if !cutoverDispositionSubjectPattern.MatchString(input.SubjectKey) {
			return nil, httperror.New(http.StatusBadRequest, "cutover_disposition_subject_invalid", "Disposition subjectKey is invalid")
		}
		if !cutoverDispositionFingerprintPattern.MatchString(input.ExpectedSourceFingerprint) {
			return nil, httperror.New(http.StatusBadRequest, "cutover_disposition_fingerprint_invalid", "Expected source fingerprint is invalid")
		}
		if utf8.RuneCountInString(input.ReasonText) < 10 || utf8.RuneCountInString(input.ReasonText) > 500 {
			return nil, httperror.New(http.StatusBadRequest, "cutover_disposition_reason_invalid", "Disposition reason must be 10-500 characters")
		}
		key := input.Category + "\x00" + input.SubjectKey
		if seen[key] {
			return nil, httperror.New(http.StatusBadRequest, "cutover_disposition_duplicate", "A disposition subject may appear only once per request")
		}
		seen[key] = true
		result = append(result, input)
	}
	return result, nil
}

func cutoverDispositionCategoryAllowed(category string) bool {
	switch category {
	case cutoverDispositionIntegration,
		cutoverDispositionNotification,
		cutoverDispositionDirectorySync:
		return true
	default:
		return false
	}
}

func validateCutoverDispositionReason(category, sourceStatus, reasonCode string) error {
	allowed := false
	switch category {
	case cutoverDispositionIntegration, cutoverDispositionNotification:
		allowed = reasonCode == "historical-terminal"
	case cutoverDispositionDirectorySync:
		if sourceStatus == "pending" || sourceStatus == "running" {
			allowed = reasonCode == "legacy-abandoned"
		} else {
			allowed = reasonCode == "historical-terminal" || reasonCode == "superseded"
		}
	}
	if !allowed {
		return httperror.New(
			http.StatusBadRequest,
			"cutover_disposition_reason_code_invalid",
			"reasonCode is not allowed for the current blocker state",
		)
	}
	return nil
}

func loadCutoverDispositionSource(
	ctx context.Context,
	tx *sql.Tx,
	category string,
	subjectKey string,
) (cutoverDispositionSource, error) {
	var query string
	var argument any = subjectKey
	switch category {
	case cutoverDispositionIntegration:
		query = `SELECT io.operation_id,` + integrationOperationCutoverFingerprintSQL + `,
				io.updated_at,io.status
			FROM integration_operation io
			WHERE io.operation_id=? AND io.status IN ('failed','failed_permanent','dead_letter')
			FOR UPDATE`
	case cutoverDispositionNotification:
		query = `SELECT CAST(pnd.id AS CHAR),` + notificationDeliveryCutoverFingerprintSQL + `,
				pnd.updated_at,pnd.status
			FROM portal_notification_deliveries pnd
			WHERE pnd.id=? AND pnd.status='failed'
			FOR UPDATE`
	case cutoverDispositionDirectorySync:
		query = `SELECT dsj.job_code,` + directorySyncJobCutoverFingerprintSQL + `,
				dsj.updated_at,dsj.status
			FROM directory_sync_jobs dsj
			WHERE dsj.job_code=? AND dsj.status IN ('pending','running','partial_success','failed')
			FOR UPDATE`
	default:
		return cutoverDispositionSource{}, httperror.New(
			http.StatusBadRequest,
			"cutover_disposition_category_invalid",
			"Disposition category is not allowed",
		)
	}
	var source cutoverDispositionSource
	err := tx.QueryRowContext(ctx, query, argument).Scan(
		&source.SubjectKey,
		&source.SourceFingerprint,
		&source.SourceUpdatedAt,
		&source.SourceStatus,
	)
	return source, err
}

func cutoverDispositionListSpecs() []cutoverDispositionListSpec {
	dispositionColumns := `d.disposition_id,d.source_fingerprint,d.reason_code,
		d.change_reference,d.created_at`
	return []cutoverDispositionListSpec{
		{
			category: cutoverDispositionIntegration,
			query: `SELECT io.operation_id,` + integrationOperationCutoverFingerprintSQL + `,
					io.updated_at,io.status,` + dispositionColumns + `
				FROM integration_operation io
				LEFT JOIN console_cutover_dispositions d
				  ON d.category='` + cutoverDispositionIntegration + `'
				 AND d.subject_key=io.operation_id AND d.status='active'
				WHERE io.status IN ('failed','failed_permanent','dead_letter')
				ORDER BY io.created_at,io.operation_id`,
		},
		{
			category: cutoverDispositionNotification,
			query: `SELECT CAST(pnd.id AS CHAR),` + notificationDeliveryCutoverFingerprintSQL + `,
					pnd.updated_at,pnd.status,` + dispositionColumns + `
				FROM portal_notification_deliveries pnd
				LEFT JOIN console_cutover_dispositions d
				  ON d.category='` + cutoverDispositionNotification + `'
				 AND d.subject_key=CAST(pnd.id AS CHAR) AND d.status='active'
				WHERE pnd.status='failed'
				ORDER BY pnd.created_at,pnd.id`,
		},
		{
			category: cutoverDispositionDirectorySync,
			query: `SELECT dsj.job_code,` + directorySyncJobCutoverFingerprintSQL + `,
					dsj.updated_at,dsj.status,` + dispositionColumns + `
				FROM directory_sync_jobs dsj
				LEFT JOIN console_cutover_dispositions d
				  ON d.category='` + cutoverDispositionDirectorySync + `'
				 AND d.subject_key=dsj.job_code AND d.status='active'
				WHERE dsj.status IN ('pending','running','partial_success','failed')
				ORDER BY dsj.created_at,dsj.job_code`,
		},
	}
}
