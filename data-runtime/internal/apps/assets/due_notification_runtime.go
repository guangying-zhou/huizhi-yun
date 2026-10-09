package assets

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	assetsDueResource         = "resource_expiry"
	assetsDueIP               = "ip_expiry"
	assetsDueDeliveryExpiry   = "delivery_expiry"
	assetsDueDeliveryWarranty = "delivery_warranty"
	assetsDueDeliverySupport  = "delivery_support"
	assetsDueOffboarding      = "offboarding_unrecovered"
)

type assetsDueCursor struct {
	DueAt string `json:"dueAt"`
	ID    int64  `json:"id"`
}

type assetsDueFact struct {
	ID                  int64
	SourceType          string
	Code                string
	Name                string
	PublicID            *string
	DueAt               time.Time
	Recipients          []string
	HoldingsFingerprint string
}

type assetsDueCandidate struct {
	Stream               string   `json:"stream"`
	Phase                string   `json:"phase"`
	SourceType           string   `json:"sourceType"`
	SourceID             int64    `json:"sourceId"`
	SourceCode           string   `json:"sourceCode"`
	SourceName           string   `json:"sourceName"`
	PublicID             *string  `json:"publicId,omitempty"`
	DueAt                string   `json:"dueAt"`
	RecipientCandidates  []string `json:"recipientCandidates"`
	EventVersion         string   `json:"eventVersion"`
	PreviousEventVersion *string  `json:"previousEventVersion,omitempty"`
	PreviousRecipientUID *string  `json:"previousRecipientUid,omitempty"`
	IdempotencyKey       string   `json:"idempotencyKey"`
	ActionableKey        string   `json:"actionableKey"`
}

type assetsDueClosure struct {
	CheckpointEventVersion string `json:"checkpointEventVersion"`
	ExpectedVersion        string `json:"expectedVersion"`
	ActionableKey          string `json:"actionableKey"`
	SourceType             string `json:"sourceType"`
	SourceID               int64  `json:"sourceId"`
	RecipientUID           string `json:"recipientUid"`
	NextVersion            string `json:"nextVersion"`
	State                  string `json:"state"`
}

func (a *Adapter) handleDueNotificationRuntime(ctx context.Context, method, path string, body map[string]any) (any, string, bool, error) {
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	switch path {
	case "/v1/assets/service/notifications:scan-due":
		data, err := a.legacyAssetsDueStore().scanAssetsDueNotifications(ctx, body)
		return data, "assets.notifications.due.scan", true, err
	case "/v1/assets/service/notifications:acknowledge":
		data, err := a.legacyAssetsDueStore().acknowledgeAssetsDueNotification(ctx, body)
		return data, "assets.notifications.due.acknowledge", true, err
	case "/v1/assets/service/notifications:acknowledge-closure":
		data, err := a.legacyAssetsDueStore().acknowledgeAssetsDueClosure(ctx, body)
		return data, "assets.notifications.due.closure_acknowledge", true, err
	default:
		return nil, "", false, nil
	}
}

func (s assetsDueStore) scanAssetsDueNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	stream := strings.TrimSpace(bodyString(body, "stream"))
	if !validAssetsDueStream(stream) {
		return nil, httperror.New(http.StatusBadRequest, "assets_due_stream_invalid", "stream is not supported")
	}
	asOf, err := time.Parse(time.RFC3339, strings.TrimSpace(bodyString(body, "asOf", "as_of")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "assets_due_as_of_invalid", "asOf must be an explicit RFC3339 timestamp")
	}
	asOf = asOf.UTC()
	cursor, err := decodeAssetsDueCursor(bodyString(body, "cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "assets_due_cursor_invalid", "cursor is invalid")
	}
	limit := bodyInt(body, "limit")
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if err := s.reconcileAssetsDueCheckpoints(ctx, stream, asOf); err != nil {
		return nil, err
	}
	facts, err := s.queryAssetsDueFacts(ctx, stream, asOf, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(facts) > limit
	if hasMore {
		facts = facts[:limit]
	}
	items := make([]assetsDueCandidate, 0, len(facts))
	for _, fact := range facts {
		candidate, pending, err := s.openAssetsDueCheckpoint(ctx, stream, asOf, fact)
		if err != nil {
			return nil, err
		}
		if pending {
			items = append(items, *candidate)
		}
	}
	closures, err := s.pendingAssetsDueClosures(ctx, stream, limit)
	if err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore && len(facts) != 0 {
		nextCursor, err = encodeAssetsDueCursor(facts[len(facts)-1].DueAt, facts[len(facts)-1].ID)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"stream": stream, "asOf": asOf.Format(time.RFC3339), "items": items, "nextCursor": nextCursor, "closures": closures}, nil
}

func queryAssetsDueFactsWith(ctx context.Context, q assetsDueQuerier, stream string, asOf time.Time, cursor *assetsDueCursor, limit int) ([]assetsDueFact, error) {
	windowEnd := assetsDueWindowEnd(stream, asOf)
	args := []any{windowEnd}
	query := `
		SELECT ai.id, ai.public_id, ai.asset_code, ai.asset_name, ard.expires_at,
		       ai.owner_uid, ai.custodian_uid, ai.user_uid
		FROM asset_items ai
		JOIN asset_resource_details ard ON ard.asset_id = ai.id
		WHERE ai.asset_category = 'resource' AND ai.status = 'active' AND ai.archived_at IS NULL
		  AND ard.expires_at IS NOT NULL AND ard.expires_at <= ?`
	if stream == assetsDueOffboarding {
		query = `SELECT c.id,c.case_code,CONCAT(COALESCE(c.departed_employee_name,c.departed_employee_uid),' 未归还资产'),c.recovery_due_at,c.recovery_responsible_uid
			FROM asset_offboarding_recovery_cases c WHERE c.status='active' AND c.recovery_due_at<=?
			AND c.recovery_responsible_uid IS NOT NULL AND c.recovery_responsible_uid=TRIM(c.recovery_responsible_uid)
			AND c.recovery_responsible_uid<>'' AND LOWER(c.recovery_responsible_uid)<>'@all'
			AND c.recovery_responsible_uid NOT REGEXP '[[:cntrl:]]' AND c.recovery_responsible_uid<>c.departed_employee_uid
			AND EXISTS (SELECT 1 FROM asset_items ai WHERE ai.archived_at IS NULL AND ai.status NOT IN ('in_stock','scrapped','inactive','disposed','retired') AND ` + offboardingOutstandingPredicate("c", "ai") + `)`
	} else if stream == assetsDueIP {
		query = `
			SELECT ip.id, ip.ip_code, ip.ip_name, ip.expires_at, ip.owner_uid
			FROM ip_assets ip
			WHERE ip.status = 'active' AND ip.expires_at IS NOT NULL AND ip.expires_at <= ?`
	} else if assetsDeliveryDueStream(stream) {
		dueColumn := assetsDeliveryDueColumn(stream)
		query = `
			SELECT cda.id, cda.delivery_asset_code, cda.product_name, cda.` + dueColumn + `, cda.responsible_uid
			FROM customer_delivery_assets cda
			WHERE cda.deleted_at IS NULL
			  AND cda.status IN ('delivered','online','accepted','suspended')
			  AND cda.` + dueColumn + ` IS NOT NULL AND cda.` + dueColumn + ` <= ?`
	}
	if cursor != nil {
		cursorTime, _ := time.Parse(time.RFC3339, cursor.DueAt)
		cursorDate := assetsDueCursorValue(stream, cursorTime)
		idColumn := "ai.id"
		dueColumn := "ard.expires_at"
		if stream == assetsDueOffboarding {
			idColumn, dueColumn = "c.id", "c.recovery_due_at"
		} else if stream == assetsDueIP {
			idColumn, dueColumn = "ip.id", "ip.expires_at"
		} else if assetsDeliveryDueStream(stream) {
			idColumn, dueColumn = "cda.id", "cda."+assetsDeliveryDueColumn(stream)
		}
		query += " AND (" + dueColumn + " > ? OR (" + dueColumn + " = ? AND " + idColumn + " > ?))"
		args = append(args, cursorDate, cursorDate, cursor.ID)
	}
	idColumn, dueColumn := "ai.id", "ard.expires_at"
	if stream == assetsDueOffboarding {
		idColumn, dueColumn = "c.id", "c.recovery_due_at"
	} else if stream == assetsDueIP {
		idColumn, dueColumn = "ip.id", "ip.expires_at"
	} else if assetsDeliveryDueStream(stream) {
		idColumn, dueColumn = "cda.id", "cda."+assetsDeliveryDueColumn(stream)
	}
	args = append(args, limit)
	rows, err := q.QueryContext(ctx, query+" ORDER BY "+dueColumn+" ASC, "+idColumn+" ASC LIMIT ?", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	facts := make([]assetsDueFact, 0, limit)
	for rows.Next() {
		var fact assetsDueFact
		var expiry time.Time
		var candidates []sql.NullString
		if stream == assetsDueResource {
			candidates = make([]sql.NullString, 3)
			var publicID sql.NullString
			err = rows.Scan(&fact.ID, &publicID, &fact.Code, &fact.Name, &expiry, &candidates[0], &candidates[1], &candidates[2])
			fact.PublicID = nullTextPointer(publicID)
			fact.SourceType = "asset_item"
		} else if stream == assetsDueOffboarding {
			candidates = make([]sql.NullString, 1)
			err = rows.Scan(&fact.ID, &fact.Code, &fact.Name, &expiry, &candidates[0])
			fact.SourceType = "offboarding_recovery_case"
		} else if stream == assetsDueIP {
			candidates = make([]sql.NullString, 1)
			err = rows.Scan(&fact.ID, &fact.Code, &fact.Name, &expiry, &candidates[0])
			fact.SourceType = "ip_asset"
		} else {
			candidates = make([]sql.NullString, 1)
			err = rows.Scan(&fact.ID, &fact.Code, &fact.Name, &expiry, &candidates[0])
			fact.SourceType = "customer_delivery_asset"
		}
		if err != nil {
			return nil, err
		}
		if assetsDeliveryDueStream(stream) {
			fact.DueAt = expiry.UTC()
		} else {
			fact.DueAt = time.Date(expiry.Year(), expiry.Month(), expiry.Day(), 23, 59, 59, 0, time.UTC)
		}
		for _, candidate := range candidates {
			if candidate.Valid {
				fact.Recipients = append(fact.Recipients, candidate.String)
			}
		}
		facts = append(facts, fact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if stream == assetsDueIP && len(facts) != 0 {
		if err := appendIPProductOwnersWith(ctx, q, facts); err != nil {
			return nil, err
		}
	}
	if stream == assetsDueOffboarding && len(facts) != 0 {
		facts, err = withOffboardingHoldingsFingerprintsWith(ctx, q, facts)
		if err != nil {
			return nil, err
		}
	}
	for index := range facts {
		facts[index].Recipients = normalizedUIDs(facts[index].Recipients)
	}
	return facts, nil
}

func withOffboardingHoldingsFingerprintsWith(ctx context.Context, q assetsDueQuerier, facts []assetsDueFact) ([]assetsDueFact, error) {
	kept := make([]assetsDueFact, 0, len(facts))
	for _, fact := range facts {
		rows, err := q.QueryContext(ctx, `SELECT ai.id,ai.asset_code,ai.status,ai.user_uid FROM asset_items ai JOIN asset_offboarding_recovery_cases c ON c.id=? WHERE ai.archived_at IS NULL AND ai.status NOT IN ('in_stock','scrapped','inactive','disposed','retired') AND ai.user_uid=c.departed_employee_uid ORDER BY ai.id`, fact.ID)
		if err != nil {
			return nil, err
		}
		hash := sha256.New()
		count := 0
		for rows.Next() {
			var id int64
			var code, status, uid string
			if err := rows.Scan(&id, &code, &status, &uid); err != nil {
				rows.Close()
				return nil, err
			}
			_, _ = fmt.Fprintf(hash, "%d|%s|%s|%s\n", id, code, status, uid)
			count++
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		if count == 0 {
			continue
		}
		fact.HoldingsFingerprint = hex.EncodeToString(hash.Sum(nil))
		kept = append(kept, fact)
	}
	return kept, nil
}

func appendIPProductOwnersWith(ctx context.Context, q assetsDueQuerier, facts []assetsDueFact) error {
	placeholders := make([]string, len(facts))
	args := make([]any, len(facts))
	byID := make(map[int64]*assetsDueFact, len(facts))
	for index := range facts {
		placeholders[index], args[index], byID[facts[index].ID] = "?", facts[index].ID, &facts[index]
	}
	rows, err := q.QueryContext(ctx, `
		SELECT iap.ip_asset_id, p.business_owner_uid, p.technical_owner_uid
		FROM ip_asset_products iap
		JOIN product_assets p ON p.id = iap.product_asset_id
		WHERE iap.ip_asset_id IN (`+strings.Join(placeholders, ",")+`)
		ORDER BY iap.ip_asset_id ASC, p.id ASC`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var business, technical sql.NullString
		if err := rows.Scan(&id, &business, &technical); err != nil {
			return err
		}
		fact := byID[id]
		if fact == nil {
			continue
		}
		if technical.Valid {
			fact.Recipients = append(fact.Recipients, technical.String)
		}
		if business.Valid {
			fact.Recipients = append(fact.Recipients, business.String)
		}
	}
	return rows.Err()
}

func reconcileAssetsDueCheckpointsWith(ctx context.Context, q assetsDueQuerier, stream string, asOf time.Time) error {
	windowEnd := assetsDueWindowEnd(stream, asOf)
	if stream == assetsDueOffboarding {
		if _, err := q.ExecContext(ctx, `UPDATE assets_notification_checkpoint cp JOIN asset_offboarding_recovery_cases c ON c.id=cp.source_id
			SET cp.state='closed',cp.close_reason='condition_resolved',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
			WHERE cp.event_stream=? AND cp.source_type='offboarding_recovery_case' AND cp.state='open'
			AND NOT EXISTS (SELECT 1 FROM asset_items ai WHERE ai.archived_at IS NULL AND ai.status NOT IN ('in_stock','scrapped','inactive','disposed','retired') AND `+offboardingOutstandingPredicate("c", "ai")+`)`, stream); err != nil {
			return err
		}
		_, err := q.ExecContext(ctx, `UPDATE assets_notification_checkpoint cp LEFT JOIN asset_offboarding_recovery_cases c ON c.id=cp.source_id
			SET cp.state='closed',cp.close_reason='condition_cancelled',cp.closed_at=UTC_TIMESTAMP(),cp.updated_at=UTC_TIMESTAMP()
			WHERE cp.event_stream=? AND cp.source_type='offboarding_recovery_case' AND cp.state='open'
			AND (c.id IS NULL OR c.status<>'active' OR c.recovery_due_at IS NULL OR c.recovery_due_at<>DATE(cp.due_at)
			OR c.recovery_responsible_uid IS NULL OR c.recovery_responsible_uid<>TRIM(c.recovery_responsible_uid)
			OR c.recovery_responsible_uid='' OR LOWER(c.recovery_responsible_uid)='@all'
			OR c.recovery_responsible_uid REGEXP '[[:cntrl:]]' OR c.recovery_responsible_uid=c.departed_employee_uid
			OR NOT JSON_CONTAINS(cp.recipient_candidates_json,JSON_QUOTE(c.recovery_responsible_uid)))`, stream)
		return err
	}
	if stream == assetsDueResource {
		if _, err := q.ExecContext(ctx, `
			UPDATE assets_notification_checkpoint c
			JOIN asset_items ai ON ai.id = c.source_id
			SET c.state='closed', c.close_reason='condition_resolved', c.closed_at=UTC_TIMESTAMP(), c.updated_at=UTC_TIMESTAMP()
			WHERE c.event_stream=? AND c.source_type='asset_item' AND c.state='open'
			  AND (ai.asset_category <> 'resource' OR ai.status <> 'active' OR ai.archived_at IS NOT NULL)`, stream); err != nil {
			return err
		}
		_, err := q.ExecContext(ctx, `
			UPDATE assets_notification_checkpoint c
			LEFT JOIN asset_items ai ON ai.id = c.source_id
			LEFT JOIN asset_resource_details ard ON ard.asset_id = ai.id
			SET c.state='closed', c.close_reason='condition_cancelled', c.closed_at=UTC_TIMESTAMP(), c.updated_at=UTC_TIMESTAMP()
			WHERE c.event_stream=? AND c.source_type='asset_item' AND c.state='open'
			  AND (ai.id IS NULL OR ard.expires_at IS NULL OR ard.expires_at > ?)`, stream, windowEnd)
		return err
	}
	if stream == assetsDueIP {
		if _, err := q.ExecContext(ctx, `
		UPDATE assets_notification_checkpoint c
		JOIN ip_assets ip ON ip.id = c.source_id
		SET c.state='closed', c.close_reason='condition_resolved', c.closed_at=UTC_TIMESTAMP(), c.updated_at=UTC_TIMESTAMP()
		WHERE c.event_stream=? AND c.source_type='ip_asset' AND c.state='open' AND ip.status <> 'active'`, stream); err != nil {
			return err
		}
		_, err := q.ExecContext(ctx, `
			UPDATE assets_notification_checkpoint c
			LEFT JOIN ip_assets ip ON ip.id = c.source_id
			SET c.state='closed', c.close_reason='condition_cancelled', c.closed_at=UTC_TIMESTAMP(), c.updated_at=UTC_TIMESTAMP()
			WHERE c.event_stream=? AND c.source_type='ip_asset' AND c.state='open'
			  AND (ip.id IS NULL OR ip.expires_at IS NULL OR ip.expires_at > ?)`, stream, windowEnd)
		return err
	}
	dueColumn := assetsDeliveryDueColumn(stream)
	if _, err := q.ExecContext(ctx, `
		UPDATE assets_notification_checkpoint c
		JOIN customer_delivery_assets cda ON cda.id=c.source_id
		SET c.state='closed', c.close_reason='condition_resolved', c.closed_at=UTC_TIMESTAMP(), c.updated_at=UTC_TIMESTAMP()
		WHERE c.event_stream=? AND c.source_type='customer_delivery_asset' AND c.state='open'
		  AND (cda.deleted_at IS NOT NULL OR cda.status NOT IN ('delivered','online','accepted','suspended'))`, stream); err != nil {
		return err
	}
	_, err := q.ExecContext(ctx, `
		UPDATE assets_notification_checkpoint c
		LEFT JOIN customer_delivery_assets cda ON cda.id=c.source_id
		SET c.state='closed', c.close_reason='condition_cancelled', c.closed_at=UTC_TIMESTAMP(), c.updated_at=UTC_TIMESTAMP()
		WHERE c.event_stream=? AND c.source_type='customer_delivery_asset' AND c.state='open'
		  AND (cda.id IS NULL OR cda.`+dueColumn+` IS NULL OR cda.`+dueColumn+` > ? OR cda.responsible_uid IS NULL OR TRIM(cda.responsible_uid)='')`, stream, windowEnd)
	return err
}

func validAssetsDueStream(stream string) bool {
	return stream == assetsDueResource || stream == assetsDueIP || stream == assetsDueOffboarding || assetsDeliveryDueStream(stream)
}

func assetsDeliveryDueStream(stream string) bool {
	return stream == assetsDueDeliveryExpiry || stream == assetsDueDeliveryWarranty || stream == assetsDueDeliverySupport
}

func assetsDeliveryDueColumn(stream string) string {
	switch stream {
	case assetsDueDeliveryExpiry:
		return "expired_at"
	case assetsDueDeliveryWarranty:
		return "warranty_end_at"
	case assetsDueDeliverySupport:
		return "support_expiry_at"
	default:
		return ""
	}
}

func assetsDueWindowEnd(stream string, asOf time.Time) string {
	if assetsDeliveryDueStream(stream) {
		return asOf.UTC().AddDate(0, 0, 30).Format("2006-01-02 15:04:05")
	}
	return asOf.UTC().AddDate(0, 0, 30).Format("2006-01-02")
}

func assetsDueCursorValue(stream string, value time.Time) string {
	if assetsDeliveryDueStream(stream) {
		return value.UTC().Format("2006-01-02 15:04:05")
	}
	return value.UTC().Format("2006-01-02")
}

func (s assetsDueStore) openAssetsDueCheckpoint(ctx context.Context, stream string, asOf time.Time, fact assetsDueFact) (*assetsDueCandidate, bool, error) {
	if len(fact.Recipients) == 0 {
		err := s.statement(ctx, func(q assetsDueQuerier) error {
			_, err := q.ExecContext(ctx, `
			UPDATE assets_notification_checkpoint
			SET state='closed', close_reason='condition_cancelled', closed_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP()
			WHERE event_stream=? AND source_type=? AND source_id=? AND state='open'`, stream, fact.SourceType, fact.ID)
			return err
		})
		if err != nil {
			return nil, false, err
		}
		return nil, false, nil
	}
	phase := assetsDuePhase(asOf, fact.DueAt)
	if phase == "" {
		return nil, false, nil
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	sourceVersion := assetsDueSourceVersion(stream, fact)
	generation := int64(1)
	var latestGeneration int64
	var latestState, latestSourceVersion, latestEventVersion, latestPhase, latestCloseReason string
	var latestRecipient sql.NullString
	latestErr := tx.QueryRowContext(ctx, `
		SELECT condition_generation, state, source_version, event_version, phase, COALESCE(close_reason, ''), notified_recipient_uid
		FROM assets_notification_checkpoint
		WHERE event_stream=? AND source_type=? AND source_id=?
		ORDER BY condition_generation DESC, id DESC LIMIT 1 FOR UPDATE`, stream, fact.SourceType, fact.ID).Scan(
		&latestGeneration, &latestState, &latestSourceVersion, &latestEventVersion, &latestPhase, &latestCloseReason, &latestRecipient)
	if latestErr != nil && latestErr != sql.ErrNoRows {
		return nil, false, latestErr
	}
	var previousEvent, previousRecipient *string
	if latestErr == nil {
		if latestSourceVersion == sourceVersion && (latestState == "open" || latestCloseReason == "superseded") {
			if assetsDuePhaseRank(latestPhase) > assetsDuePhaseRank(phase) {
				return nil, false, nil
			}
			generation = latestGeneration
			previousEvent = textPointer(latestEventVersion)
			previousRecipient = nullTextPointer(latestRecipient)
		} else {
			generation = latestGeneration + 1
			if latestState == "open" {
				if _, err := tx.ExecContext(ctx, `UPDATE assets_notification_checkpoint SET state='closed', close_reason='condition_cancelled', closed_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP() WHERE event_stream=? AND source_type=? AND source_id=? AND state='open'`, stream, fact.SourceType, fact.ID); err != nil {
					return nil, false, err
				}
			}
		}
	}
	candidate := buildAssetsDueCandidate(stream, phase, fact, generation)
	if previousEvent != nil && *previousEvent == candidate.EventVersion {
		previousEvent, previousRecipient = nil, nil
	}
	candidate.PreviousEventVersion, candidate.PreviousRecipientUID = previousEvent, previousRecipient
	if latestErr == nil && generation == latestGeneration && latestState == "open" && latestEventVersion != candidate.EventVersion {
		if _, err := tx.ExecContext(ctx, `UPDATE assets_notification_checkpoint SET state='closed', close_reason='superseded', closed_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP() WHERE event_version=? AND state='open'`, latestEventVersion); err != nil {
			return nil, false, err
		}
	}
	recipientsJSON, _ := json.Marshal(fact.Recipients)
	_, err = tx.ExecContext(ctx, `
		INSERT IGNORE INTO assets_notification_checkpoint (
		 event_stream, source_type, source_id, condition_generation, phase, source_version, event_version,
		 previous_event_version, previous_recipient_uid, idempotency_key, actionable_key, due_at,
		 source_code, source_name, recipient_candidates_json, state
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
		stream, fact.SourceType, fact.ID, generation, phase, sourceVersion, candidate.EventVersion,
		nullableText(previousEvent), nullableText(previousRecipient), candidate.IdempotencyKey, candidate.ActionableKey,
		fact.DueAt, fact.Code, fact.Name, string(recipientsJSON))
	if err != nil {
		return nil, false, err
	}
	var state string
	var notificationID, storedPreviousEvent, storedPreviousRecipient sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT state, notification_id, previous_event_version, previous_recipient_uid FROM assets_notification_checkpoint WHERE event_version=? LIMIT 1 FOR UPDATE`, candidate.EventVersion).Scan(&state, &notificationID, &storedPreviousEvent, &storedPreviousRecipient); err != nil {
		return nil, false, err
	}
	candidate.PreviousEventVersion = nullTextPointer(storedPreviousEvent)
	candidate.PreviousRecipientUID = nullTextPointer(storedPreviousRecipient)
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &candidate, state == "open" && !notificationID.Valid, nil
}

func pendingAssetsDueClosuresWith(ctx context.Context, q assetsDueQuerier, stream string, limit int) ([]assetsDueClosure, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT c.event_version, delivered.event_version, c.actionable_key, c.source_type, c.source_id,
		       delivered.notified_recipient_uid, c.close_reason
		FROM assets_notification_checkpoint c
		JOIN assets_notification_checkpoint delivered ON delivered.id=(
		 SELECT prior.id FROM assets_notification_checkpoint prior
		 WHERE prior.event_stream=c.event_stream AND prior.source_type=c.source_type AND prior.source_id=c.source_id
		   AND prior.condition_generation=c.condition_generation AND prior.id<=c.id
		   AND prior.notification_id IS NOT NULL AND prior.notified_recipient_uid IS NOT NULL
		 ORDER BY prior.id DESC LIMIT 1)
		WHERE c.event_stream=? AND c.state='closed' AND c.close_reason IN ('condition_resolved','condition_cancelled')
		  AND c.lifecycle_closed_at IS NULL
		ORDER BY c.closed_at ASC, c.id ASC LIMIT ?`, stream, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]assetsDueClosure, 0)
	for rows.Next() {
		var item assetsDueClosure
		var reason string
		if err := rows.Scan(&item.CheckpointEventVersion, &item.ExpectedVersion, &item.ActionableKey, &item.SourceType, &item.SourceID, &item.RecipientUID, &reason); err != nil {
			return nil, err
		}
		item.State = "cancelled"
		if reason == "condition_resolved" {
			item.State = "resolved"
		}
		item.NextVersion = item.State + ":" + item.CheckpointEventVersion
		items = append(items, item)
	}
	return items, rows.Err()
}

func acknowledgeAssetsDueNotificationWith(ctx context.Context, q assetsDueQuerier, body map[string]any) (map[string]any, error) {
	eventVersion := strings.TrimSpace(bodyString(body, "eventVersion", "event_version"))
	notificationID := strings.TrimSpace(bodyString(body, "notificationId", "notification_id"))
	recipientUID := strings.TrimSpace(bodyString(body, "recipientUid", "recipient_uid"))
	if eventVersion == "" || notificationID == "" || recipientUID == "" || strings.EqualFold(recipientUID, "@all") {
		return nil, httperror.New(http.StatusBadRequest, "assets_due_ack_invalid", "eventVersion, notificationId and an explicit recipientUid are required")
	}
	result, err := q.ExecContext(ctx, `
		UPDATE assets_notification_checkpoint
		SET notification_id=?, notified_recipient_uid=?, acknowledged_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP()
		WHERE event_version=? AND JSON_CONTAINS(recipient_candidates_json, JSON_QUOTE(?))
		  AND (notification_id IS NULL OR (notification_id=? AND notified_recipient_uid=?))`, notificationID, recipientUID, eventVersion, recipientUID, notificationID, recipientUID)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		var state string
		var storedNotification, storedRecipient sql.NullString
		err := q.QueryRowContext(ctx, `SELECT state, notification_id, notified_recipient_uid FROM assets_notification_checkpoint WHERE event_version=? LIMIT 1`, eventVersion).Scan(&state, &storedNotification, &storedRecipient)
		if err == nil && (state == "open" || state == "closed") && storedNotification.String == notificationID && storedRecipient.String == recipientUID {
			return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "assets_due_ack_conflict", "notification checkpoint is stale or recipient evidence conflicts")
	}
	return map[string]any{"eventVersion": eventVersion, "notificationId": notificationID, "recipientUid": recipientUID, "acknowledged": true}, nil
}

func acknowledgeAssetsDueClosureWith(ctx context.Context, q assetsDueQuerier, body map[string]any) (map[string]any, error) {
	eventVersion := strings.TrimSpace(bodyString(body, "eventVersion", "event_version"))
	nextVersion := strings.TrimSpace(bodyString(body, "nextVersion", "next_version"))
	if eventVersion == "" || nextVersion == "" {
		return nil, httperror.New(http.StatusBadRequest, "assets_due_closure_ack_invalid", "eventVersion and nextVersion are required")
	}
	result, err := q.ExecContext(ctx, `UPDATE assets_notification_checkpoint SET lifecycle_closed_at=UTC_TIMESTAMP(), lifecycle_next_version=?, updated_at=UTC_TIMESTAMP() WHERE event_version=? AND state='closed' AND close_reason IN ('condition_resolved','condition_cancelled') AND (lifecycle_next_version IS NULL OR lifecycle_next_version=?)`, nextVersion, eventVersion, nextVersion)
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		var stored sql.NullString
		var closed sql.NullTime
		err := q.QueryRowContext(ctx, `SELECT lifecycle_next_version, lifecycle_closed_at FROM assets_notification_checkpoint WHERE event_version=? LIMIT 1`, eventVersion).Scan(&stored, &closed)
		if err == nil && closed.Valid && stored.String == nextVersion {
			return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true, "idempotent": true}, nil
		}
		return nil, httperror.New(http.StatusConflict, "assets_due_closure_ack_conflict", "closure checkpoint is stale or conflicts with existing evidence")
	}
	return map[string]any{"eventVersion": eventVersion, "nextVersion": nextVersion, "acknowledged": true}, nil
}

func buildAssetsDueCandidate(stream, phase string, fact assetsDueFact, generation int64) assetsDueCandidate {
	hash := assetsDueHash(strings.Join([]string{"v1", stream, fact.SourceType, strconv.FormatInt(fact.ID, 10), strconv.FormatInt(generation, 10), fact.Code, fact.Name, pointerText(fact.PublicID), fact.DueAt.Format(time.RFC3339), phase, strings.Join(fact.Recipients, ","), fact.HoldingsFingerprint}, "|"))[:24]
	return assetsDueCandidate{
		Stream: stream, Phase: phase, SourceType: fact.SourceType, SourceID: fact.ID, SourceCode: fact.Code,
		SourceName: fact.Name, PublicID: fact.PublicID, DueAt: fact.DueAt.Format(time.RFC3339), RecipientCandidates: fact.Recipients,
		EventVersion:   "v1:" + hash,
		IdempotencyKey: fmt.Sprintf("assets-due:%s:%s:%d:g%d:%s:%s", stream, fact.SourceType, fact.ID, generation, phase, hash),
		ActionableKey:  fmt.Sprintf("assets:%s:%d:%s:g%d", fact.SourceType, fact.ID, stream, generation),
	}
}

func assetsDueSourceVersion(stream string, fact assetsDueFact) string {
	return assetsDueHash(strings.Join([]string{stream, fact.SourceType, strconv.FormatInt(fact.ID, 10), fact.Code, fact.Name, pointerText(fact.PublicID), fact.DueAt.Format(time.RFC3339), strings.Join(fact.Recipients, ","), fact.HoldingsFingerprint}, "|"))
}

func assetsDuePhase(asOf, dueAt time.Time) string {
	asOf, dueAt = asOf.UTC(), dueAt.UTC()
	if asOf.After(dueAt) {
		return "expired"
	}
	asOfDate := time.Date(asOf.Year(), asOf.Month(), asOf.Day(), 0, 0, 0, 0, time.UTC)
	dueDate := time.Date(dueAt.Year(), dueAt.Month(), dueAt.Day(), 0, 0, 0, 0, time.UTC)
	days := int(dueDate.Sub(asOfDate) / (24 * time.Hour))
	switch {
	case days <= 1:
		return "D1"
	case days <= 7:
		return "D7"
	case days <= 30:
		return "D30"
	default:
		return ""
	}
}

func assetsDuePhaseRank(phase string) int {
	return map[string]int{"D30": 1, "D7": 2, "D1": 3, "expired": 4}[phase]
}

func encodeAssetsDueCursor(dueAt time.Time, id int64) (string, error) {
	payload, err := json.Marshal(assetsDueCursor{DueAt: dueAt.UTC().Format(time.RFC3339), ID: id})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeAssetsDueCursor(raw string) (*assetsDueCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	var cursor assetsDueCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.ID <= 0 {
		return nil, fmt.Errorf("invalid cursor")
	}
	if _, err := time.Parse(time.RFC3339, cursor.DueAt); err != nil {
		return nil, err
	}
	return &cursor, nil
}

func normalizedUIDs(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !strings.EqualFold(value, "@all") {
			if _, exists := seen[value]; !exists {
				seen[value] = struct{}{}
				result = append(result, value)
			}
		}
	}
	return result
}

func bodyString(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return fmt.Sprint(value)
		}
	}
	return ""
}

func bodyInt(body map[string]any, key string) int {
	value, _ := strconv.Atoi(strings.TrimSpace(bodyString(body, key)))
	return value
}

func assetsDueHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func textPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func nullTextPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return textPointer(value.String)
}

func nullableText(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func pointerText(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

// assetsDueQuerier is satisfied by both *sql.DB and *sql.Tx.
type assetsDueQuerier interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// assetsDueStore decides where due-notification statements run. The legacy
// store keeps its original autocommit statements; the unified scheduler store
// runs every step inside a generation-fenced transaction.
type assetsDueStore struct {
	statement func(context.Context, func(assetsDueQuerier) error) error
	begin     func(context.Context) (*sql.Tx, error)
}

func (a *Adapter) legacyAssetsDueStore() assetsDueStore {
	return assetsDueStore{
		statement: func(ctx context.Context, run func(assetsDueQuerier) error) error { return run(a.DB()) },
		begin:     func(ctx context.Context) (*sql.Tx, error) { return a.DB().BeginTx(ctx, nil) },
	}
}

func schedulerAssetsDueStore(begin func(context.Context) (*sql.Tx, error)) assetsDueStore {
	return assetsDueStore{
		statement: func(ctx context.Context, run func(assetsDueQuerier) error) error {
			tx, err := begin(ctx)
			if err != nil {
				return err
			}
			defer tx.Rollback()
			if err = run(tx); err != nil {
				return err
			}
			return tx.Commit()
		},
		begin: begin,
	}
}

func (s assetsDueStore) queryAssetsDueFacts(ctx context.Context, stream string, asOf time.Time, cursor *assetsDueCursor, limit int) ([]assetsDueFact, error) {
	var facts []assetsDueFact
	err := s.statement(ctx, func(q assetsDueQuerier) error {
		var err error
		facts, err = queryAssetsDueFactsWith(ctx, q, stream, asOf, cursor, limit)
		return err
	})
	return facts, err
}

func (s assetsDueStore) reconcileAssetsDueCheckpoints(ctx context.Context, stream string, asOf time.Time) error {
	return s.statement(ctx, func(q assetsDueQuerier) error { return reconcileAssetsDueCheckpointsWith(ctx, q, stream, asOf) })
}

func (s assetsDueStore) pendingAssetsDueClosures(ctx context.Context, stream string, limit int) ([]assetsDueClosure, error) {
	var closures []assetsDueClosure
	err := s.statement(ctx, func(q assetsDueQuerier) error {
		var err error
		closures, err = pendingAssetsDueClosuresWith(ctx, q, stream, limit)
		return err
	})
	return closures, err
}

func (s assetsDueStore) acknowledgeAssetsDueNotification(ctx context.Context, body map[string]any) (map[string]any, error) {
	var out map[string]any
	err := s.statement(ctx, func(q assetsDueQuerier) error {
		var err error
		out, err = acknowledgeAssetsDueNotificationWith(ctx, q, body)
		return err
	})
	return out, err
}

func (s assetsDueStore) acknowledgeAssetsDueClosure(ctx context.Context, body map[string]any) (map[string]any, error) {
	var out map[string]any
	err := s.statement(ctx, func(q assetsDueQuerier) error {
		var err error
		out, err = acknowledgeAssetsDueClosureWith(ctx, q, body)
		return err
	})
	return out, err
}

// Legacy adapter entry points kept for the original path and its tests.
func (a *Adapter) scanAssetsDueNotifications(ctx context.Context, body map[string]any) (map[string]any, error) {
	return a.legacyAssetsDueStore().scanAssetsDueNotifications(ctx, body)
}

func (a *Adapter) queryAssetsDueFacts(ctx context.Context, stream string, asOf time.Time, cursor *assetsDueCursor, limit int) ([]assetsDueFact, error) {
	return a.legacyAssetsDueStore().queryAssetsDueFacts(ctx, stream, asOf, cursor, limit)
}

func (a *Adapter) reconcileAssetsDueCheckpoints(ctx context.Context, stream string, asOf time.Time) error {
	return a.legacyAssetsDueStore().reconcileAssetsDueCheckpoints(ctx, stream, asOf)
}

func (a *Adapter) openAssetsDueCheckpoint(ctx context.Context, stream string, asOf time.Time, fact assetsDueFact) (*assetsDueCandidate, bool, error) {
	return a.legacyAssetsDueStore().openAssetsDueCheckpoint(ctx, stream, asOf, fact)
}

func (a *Adapter) pendingAssetsDueClosures(ctx context.Context, stream string, limit int) ([]assetsDueClosure, error) {
	return a.legacyAssetsDueStore().pendingAssetsDueClosures(ctx, stream, limit)
}

func (a *Adapter) acknowledgeAssetsDueNotification(ctx context.Context, body map[string]any) (map[string]any, error) {
	return a.legacyAssetsDueStore().acknowledgeAssetsDueNotification(ctx, body)
}

func (a *Adapter) acknowledgeAssetsDueClosure(ctx context.Context, body map[string]any) (map[string]any, error) {
	return a.legacyAssetsDueStore().acknowledgeAssetsDueClosure(ctx, body)
}

func (a *Adapter) withOffboardingHoldingsFingerprints(ctx context.Context, facts []assetsDueFact) ([]assetsDueFact, error) {
	return withOffboardingHoldingsFingerprintsWith(ctx, a.DB(), facts)
}

func (a *Adapter) appendIPProductOwners(ctx context.Context, facts []assetsDueFact) error {
	return appendIPProductOwnersWith(ctx, a.DB(), facts)
}
