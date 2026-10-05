package deliveryledger

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/notification-runtime/internal/config"
)

const selectBase = `SELECT id, request_hash, status, lease_owner,
       lease_expires_at, fencing_token, result_json
 FROM notification_delivery_ledger
 WHERE tenant_code = ? AND deployment_code = ?
   AND source_app = ? AND idempotency_key = ?`

const selectForUpdate = selectBase + ` FOR UPDATE`

type sqlDialect string

const (
	dialectMySQL  sqlDialect = "mysql"
	dialectSQLite sqlDialect = "sqlite"
)

type SQLStore struct {
	db      *sql.DB
	now     func() time.Time
	dialect sqlDialect
}

type MySQLStore = SQLStore
type SQLiteStore = SQLStore

var requestHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var evidenceTypePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
var evidenceReferencePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$`)
var providerMessageIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$`)

var requiredColumns = []string{
	"id", "tenant_code", "deployment_code", "source_app", "source_client_id", "idempotency_key",
	"request_hash", "provider_code", "integration_code", "status", "lease_owner", "lease_expires_at",
	"fencing_token", "attempt_count", "result_json", "last_error_code", "last_error_summary",
	"succeeded_at", "created_at", "updated_at",
}

var requiredReconciliationColumns = []string{
	"id", "delivery_id", "tenant_code", "deployment_code", "from_status", "to_status",
	"actor_source_app", "actor_client_id", "actor_subject", "reason", "evidence_type",
	"evidence_reference", "result_json", "created_at",
}

func OpenMySQL(ctx context.Context, cfg config.DeliveryStoreConfig) (*MySQLStore, error) {
	if strings.TrimSpace(cfg.Host) == "" || strings.TrimSpace(cfg.User) == "" || strings.TrimSpace(cfg.Database) == "" {
		return nil, ErrStoreUnavailable
	}
	dsn := (&mysqlDriver.Config{
		User: cfg.User, Passwd: cfg.Password, Net: "tcp",
		Addr: net.JoinHostPort(cfg.Host, fmt.Sprint(cfg.Port)), DBName: cfg.Database,
		ParseTime: true, Loc: time.UTC, Timeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second,
	}).FormatDSN()
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	limit := cfg.ConnectionLimit
	if limit <= 0 {
		limit = 5
	}
	db.SetMaxOpenConns(limit)
	db.SetMaxIdleConns(limit)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("delivery store ping: %w", err)
	}
	if err := verifySchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return NewMySQLStore(db), nil
}

func verifySchema(ctx context.Context, db *sql.DB) error {
	if err := verifyTableColumns(ctx, db, "notification_delivery_ledger", requiredColumns); err != nil {
		return err
	}
	return verifyTableColumns(ctx, db, "notification_delivery_reconciliations", requiredReconciliationColumns)
}

func verifyTableColumns(ctx context.Context, db *sql.DB, table string, columns []string) error {
	placeholders := strings.TrimRight(strings.Repeat("?,", len(columns)), ",")
	query := `SELECT COUNT(DISTINCT column_name) FROM information_schema.columns
	WHERE table_schema=DATABASE() AND table_name=?
   AND column_name IN (` + placeholders + `)`
	args := make([]any, 0, len(columns)+1)
	args = append(args, table)
	for _, column := range columns {
		args = append(args, column)
	}
	var columnCount int
	if err := db.QueryRowContext(ctx, query, args...).Scan(&columnCount); err != nil {
		return fmt.Errorf("delivery store schema check for %s: %w", table, err)
	}
	if columnCount != len(columns) {
		return fmt.Errorf("delivery store schema %s is incomplete: found %d of %d required columns", table, columnCount, len(columns))
	}
	return nil
}

func NewMySQLStore(db *sql.DB) *SQLStore {
	return &SQLStore{db: db, now: func() time.Time { return time.Now().UTC() }, dialect: dialectMySQL}
}

func (s *SQLStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *SQLStore) Ready(ctx context.Context) error {
	if s == nil || s.db == nil {
		return ErrStoreUnavailable
	}
	return s.db.PingContext(ctx)
}

func (s *SQLStore) List(ctx context.Context, input ListInput) (ListResult, error) {
	if s == nil || s.db == nil {
		return ListResult{}, ErrStoreUnavailable
	}
	if strings.TrimSpace(input.Tenant) == "" || strings.TrimSpace(input.Deployment) == "" || input.Limit < 1 || input.Limit > 100 || input.BeforeID < 0 || (input.State != "" && !validState(input.State)) {
		return ListResult{}, ErrInvalidQuery
	}
	query := `SELECT id, source_app, provider_code, integration_code, status, attempt_count,
       last_error_code, created_at, updated_at, succeeded_at
 FROM notification_delivery_ledger
 WHERE tenant_code=? AND deployment_code=?`
	args := []any{input.Tenant, input.Deployment}
	if input.State != "" {
		query += " AND status=?"
		args = append(args, input.State)
	}
	if input.BeforeID > 0 {
		query += " AND id<?"
		args = append(args, input.BeforeID)
	}
	query += " ORDER BY id DESC LIMIT ?"
	args = append(args, input.Limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()
	items := make([]Delivery, 0, input.Limit)
	nextID := int64(0)
	for rows.Next() {
		var item Delivery
		var lastError sql.NullString
		var succeeded sql.NullTime
		if err := rows.Scan(&item.ID, &item.SourceApp, &item.Provider, &item.Integration, &item.State, &item.AttemptCount, &lastError, &item.CreatedAt, &item.UpdatedAt, &succeeded); err != nil {
			return ListResult{}, err
		}
		if len(items) == input.Limit {
			nextID = items[len(items)-1].ID
			break
		}
		item.LastErrorCode = lastError.String
		if succeeded.Valid {
			value := succeeded.Time.UTC()
			item.SucceededAt = &value
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, err
	}
	return ListResult{Deliveries: items, NextID: nextID}, nil
}

func (s *SQLStore) Reconcile(ctx context.Context, input ReconcileInput) (ReconcileResult, error) {
	if s == nil || s.db == nil {
		return ReconcileResult{}, ErrStoreUnavailable
	}
	input.Reason = strings.TrimSpace(input.Reason)
	input.EvidenceType = strings.TrimSpace(input.EvidenceType)
	input.EvidenceReference = strings.TrimSpace(input.EvidenceReference)
	if strings.TrimSpace(input.Tenant) == "" || strings.TrimSpace(input.Deployment) == "" || input.DeliveryID <= 0 || input.ExpectedState != StatePartialUnknown ||
		(input.Result != StateSucceeded && input.Result != StateFailed) || strings.TrimSpace(input.ActorSourceApp) == "" || strings.TrimSpace(input.ActorClientID) == "" ||
		!safeReconciliationReason(input.Reason) || !evidenceTypePattern.MatchString(input.EvidenceType) || !evidenceReferencePattern.MatchString(input.EvidenceReference) ||
		(input.ProviderMessageID != "" && !providerMessageIDPattern.MatchString(input.ProviderMessageID)) {
		return ReconcileResult{}, ErrInvalidEvidence
	}

	tx, err := s.beginTx(ctx)
	if err != nil {
		return ReconcileResult{}, err
	}
	defer tx.Rollback()
	var item Delivery
	var fencing int64
	var lastError sql.NullString
	var succeeded sql.NullTime
	reconcileSelect := `SELECT id, source_app, provider_code, integration_code, status,
       attempt_count, last_error_code, created_at, updated_at, succeeded_at, fencing_token
 FROM notification_delivery_ledger
	WHERE tenant_code=? AND deployment_code=? AND id=?`
	if s.dialect == dialectMySQL {
		reconcileSelect += " FOR UPDATE"
	}
	err = tx.QueryRowContext(ctx, reconcileSelect, input.Tenant, input.Deployment, input.DeliveryID).
		Scan(&item.ID, &item.SourceApp, &item.Provider, &item.Integration, &item.State, &item.AttemptCount, &lastError, &item.CreatedAt, &item.UpdatedAt, &succeeded, &fencing)
	if errors.Is(err, sql.ErrNoRows) {
		return ReconcileResult{}, ErrDeliveryNotFound
	}
	if err != nil {
		return ReconcileResult{}, err
	}
	if item.State != input.ExpectedState {
		return ReconcileResult{}, ErrInvalidState
	}

	now := s.now()
	var resultJSON any
	if input.Result == StateSucceeded {
		providerResult := map[string]any{"errcode": 0, "reconciled": true}
		if input.ProviderMessageID != "" {
			providerResult["msgid"] = input.ProviderMessageID
		}
		body, err := json.Marshal(map[string]any{"provider": item.Provider, "integrationCode": item.Integration, "providerResult": providerResult})
		if err != nil {
			return ReconcileResult{}, err
		}
		resultJSON = string(body)
	}
	update, err := tx.ExecContext(ctx, `UPDATE notification_delivery_ledger
 SET status=?, result_json=?, last_error_code=?, last_error_summary=?,
	     succeeded_at=CASE WHEN ?='succeeded' THEN ? ELSE NULL END, updated_at=?
 WHERE id=? AND tenant_code=? AND deployment_code=? AND status='partial_unknown' AND fencing_token=?`,
		input.Result, resultJSON,
		nullable(map[State]string{StateFailed: "reconciled_failed"}[input.Result]), nullable(map[State]string{StateFailed: "Manual evidence confirmed delivery failed"}[input.Result]),
		input.Result, now, now, item.ID, input.Tenant, input.Deployment, fencing)
	if err != nil {
		return ReconcileResult{}, err
	}
	if err := requireOneRow(update); err != nil {
		return ReconcileResult{}, ErrInvalidState
	}

	publicResult := map[string]any{"result": input.Result}
	if input.ProviderMessageID != "" {
		publicResult["providerMessageId"] = input.ProviderMessageID
	}
	publicJSON, err := json.Marshal(publicResult)
	if err != nil {
		return ReconcileResult{}, err
	}
	audit, err := tx.ExecContext(ctx, `INSERT INTO notification_delivery_reconciliations (
  delivery_id, tenant_code, deployment_code, from_status, to_status,
  actor_source_app, actor_client_id, actor_subject, reason,
  evidence_type, evidence_reference, result_json, created_at
) VALUES (?, ?, ?, 'partial_unknown', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, input.Tenant, input.Deployment, input.Result, limit(input.ActorSourceApp, 64), limit(input.ActorClientID, 128), nullable(limit(input.ActorSubject, 191)),
		input.Reason, input.EvidenceType, input.EvidenceReference, string(publicJSON), now)
	if err != nil {
		return ReconcileResult{}, err
	}
	auditID, err := audit.LastInsertId()
	if err != nil {
		return ReconcileResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ReconcileResult{}, err
	}
	item.State = input.Result
	item.LastErrorCode = map[State]string{StateFailed: "reconciled_failed"}[input.Result]
	item.UpdatedAt = now
	if input.Result == StateSucceeded {
		item.SucceededAt = &now
	} else {
		item.SucceededAt = nil
	}
	return ReconcileResult{Delivery: item, AuditID: auditID}, nil
}

func validState(state State) bool {
	switch state {
	case StateProcessing, StateSucceeded, StateFailed, StatePartialUnknown:
		return true
	default:
		return false
	}
}

func safeReconciliationReason(value string) bool {
	if len(value) < 8 || len(value) > 512 || strings.ContainsAny(value, "\r\n\t{}[]") {
		return false
	}
	lower := strings.ToLower(value)
	for _, forbidden := range []string{"http://", "https://", "bearer ", "access_token", "corpsecret", "touser"} {
		if strings.Contains(lower, forbidden) {
			return false
		}
	}
	return true
}

func (s *SQLStore) Claim(ctx context.Context, input ClaimInput) (Claim, error) {
	if s == nil || s.db == nil {
		return Claim{}, ErrStoreUnavailable
	}
	if strings.TrimSpace(input.Identity.Tenant) == "" || strings.TrimSpace(input.Identity.Deployment) == "" ||
		strings.TrimSpace(input.Identity.SourceApp) == "" || strings.TrimSpace(input.Identity.IdempotencyKey) == "" ||
		strings.TrimSpace(input.Provider) == "" || strings.TrimSpace(input.Integration) == "" ||
		strings.TrimSpace(input.LeaseOwner) == "" || input.LeaseDuration <= 0 || !requestHashPattern.MatchString(input.RequestHash) {
		return Claim{}, ErrInvalidClaim
	}
	tx, err := s.beginTx(ctx)
	if err != nil {
		return Claim{}, err
	}
	defer tx.Rollback()

	row, found, err := selectDelivery(ctx, tx, input.Identity, s.dialect)
	if err != nil {
		return Claim{}, err
	}
	if !found {
		now := s.now()
		result, err := tx.ExecContext(ctx, `INSERT INTO notification_delivery_ledger (
  tenant_code, deployment_code, source_app, source_client_id, idempotency_key,
  request_hash, provider_code, integration_code, status,
  lease_owner, lease_expires_at, fencing_token, attempt_count,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, 1, 1, ?, ?)`,
			input.Identity.Tenant, input.Identity.Deployment, input.Identity.SourceApp, input.Identity.SourceClientID, input.Identity.IdempotencyKey,
			input.RequestHash, input.Provider, input.Integration, input.LeaseOwner, now.Add(input.LeaseDuration), now, now)
		if err != nil {
			if isDuplicateKeyError(err, s.dialect) {
				row, found, err = selectDelivery(ctx, tx, input.Identity, s.dialect)
				if err != nil {
					return Claim{}, err
				}
				if !found {
					return Claim{}, errors.New("delivery row disappeared after duplicate insert")
				}
			} else {
				return Claim{}, err
			}
		} else {
			id, err := result.LastInsertId()
			if err != nil {
				return Claim{}, err
			}
			if err := tx.Commit(); err != nil {
				return Claim{}, err
			}
			return Claim{DeliveryID: id, Decision: DecisionExecute, State: StateProcessing, Fencing: 1}, nil
		}
	}

	if row.RequestHash != input.RequestHash {
		return Claim{}, ErrPayloadMismatch
	}
	switch row.State {
	case StateSucceeded:
		if err := tx.Commit(); err != nil {
			return Claim{}, err
		}
		return Claim{DeliveryID: row.ID, Decision: DecisionReplaySucceeded, State: row.State, Fencing: row.Fencing, ResultJSON: row.ResultJSON}, nil
	case StatePartialUnknown:
		if err := tx.Commit(); err != nil {
			return Claim{}, err
		}
		return Claim{DeliveryID: row.ID, Decision: DecisionPartialUnknown, State: row.State, Fencing: row.Fencing}, nil
	case StateProcessing:
		now := s.now()
		if !row.LeaseExpiresAt.Valid || !row.LeaseExpiresAt.Time.After(now) {
			if _, err := tx.ExecContext(ctx, `UPDATE notification_delivery_ledger
   SET status='partial_unknown', lease_owner=NULL, lease_expires_at=NULL,
       last_error_code='lease_expired', last_error_summary='Delivery outcome is unknown after lease expiry', updated_at=?
 WHERE id=? AND status='processing' AND fencing_token=?`, now, row.ID, row.Fencing); err != nil {
				return Claim{}, err
			}
			if err := tx.Commit(); err != nil {
				return Claim{}, err
			}
			return Claim{DeliveryID: row.ID, Decision: DecisionPartialUnknown, State: StatePartialUnknown, Fencing: row.Fencing}, nil
		}
		if err := tx.Commit(); err != nil {
			return Claim{}, err
		}
		return Claim{DeliveryID: row.ID, Decision: DecisionInProgress, State: row.State, Fencing: row.Fencing}, nil
	case StateFailed:
		now := s.now()
		newFencing := row.Fencing + 1
		result, err := tx.ExecContext(ctx, `UPDATE notification_delivery_ledger
   SET status='processing', lease_owner=?, lease_expires_at=?, fencing_token=?,
       attempt_count=attempt_count+1, last_error_code=NULL, last_error_summary=NULL, updated_at=?
 WHERE id=? AND status='failed' AND fencing_token=?`, input.LeaseOwner, now.Add(input.LeaseDuration), newFencing, now, row.ID, row.Fencing)
		if err != nil {
			return Claim{}, err
		}
		if err := requireOneRow(result); err != nil {
			return Claim{}, err
		}
		if err := tx.Commit(); err != nil {
			return Claim{}, err
		}
		return Claim{DeliveryID: row.ID, Decision: DecisionExecute, State: StateProcessing, Fencing: newFencing}, nil
	default:
		return Claim{}, fmt.Errorf("unsupported delivery ledger state %q", row.State)
	}
}

func (s *SQLStore) Succeed(ctx context.Context, input Completion) error {
	result := json.RawMessage(input.ResultJSON)
	if len(result) == 0 {
		result = json.RawMessage(`null`)
	}
	return s.complete(ctx, input, StateSucceeded, string(result))
}

func (s *SQLStore) Fail(ctx context.Context, input Completion) error {
	return s.complete(ctx, input, StateFailed, "")
}

func (s *SQLStore) MarkUnknown(ctx context.Context, input Completion) error {
	return s.complete(ctx, input, StatePartialUnknown, "")
}

func (s *SQLStore) complete(ctx context.Context, input Completion, state State, resultJSON string) error {
	if s == nil || s.db == nil {
		return ErrStoreUnavailable
	}
	if len(resultJSON) > 16*1024 {
		return errors.New("delivery result exceeds 16 KiB")
	}
	now := s.now()
	result, err := s.db.ExecContext(ctx, `UPDATE notification_delivery_ledger
   SET status=?, result_json=?, last_error_code=?, last_error_summary=?,
       lease_owner=NULL, lease_expires_at=NULL, succeeded_at=CASE WHEN ?='succeeded' THEN ? ELSE succeeded_at END, updated_at=?
 WHERE id=? AND status='processing' AND lease_owner=? AND fencing_token=?`,
		state, nullable(resultJSON), nullable(limit(input.ErrorCode, 96)), nullable(limit(input.ErrorSummary, 512)), state, now, now,
		input.DeliveryID, input.LeaseOwner, input.Fencing)
	if err != nil {
		return err
	}
	return requireOneRow(result)
}

type deliveryRow struct {
	ID             int64
	RequestHash    string
	State          State
	LeaseOwner     sql.NullString
	LeaseExpiresAt sql.NullTime
	Fencing        int64
	ResultJSON     []byte
}

func selectDelivery(ctx context.Context, tx *sql.Tx, identity Identity, dialect sqlDialect) (deliveryRow, bool, error) {
	var row deliveryRow
	var resultJSON []byte
	query := selectBase
	if dialect == dialectMySQL {
		query = selectForUpdate
	}
	err := tx.QueryRowContext(ctx, query, identity.Tenant, identity.Deployment, identity.SourceApp, identity.IdempotencyKey).
		Scan(&row.ID, &row.RequestHash, &row.State, &row.LeaseOwner, &row.LeaseExpiresAt, &row.Fencing, &resultJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return deliveryRow{}, false, nil
	}
	if err != nil {
		return deliveryRow{}, false, err
	}
	row.ResultJSON = append([]byte(nil), resultJSON...)
	return row, true, nil
}

func (s *SQLStore) beginTx(ctx context.Context) (*sql.Tx, error) {
	isolation := sql.LevelReadCommitted
	if s.dialect == dialectSQLite {
		isolation = sql.LevelSerializable
	}
	return s.db.BeginTx(ctx, &sql.TxOptions{Isolation: isolation})
}

func isDuplicateKeyError(err error, dialect sqlDialect) bool {
	if dialect == dialectMySQL {
		var mysqlErr *mysqlDriver.MySQLError
		return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
	}
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint failed")
}

func requireOneRow(result sql.Result) error {
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrStaleClaim
	}
	return nil
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func limit(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len(value) > maximum {
		return value[:maximum]
	}
	return value
}
