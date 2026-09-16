package deliveryledger

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	_ "modernc.org/sqlite"
)

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS notification_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_delivery_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_code TEXT NOT NULL,
  deployment_code TEXT NOT NULL,
  source_app TEXT NOT NULL,
  source_client_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  provider_code TEXT NOT NULL,
  integration_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing', 'succeeded', 'failed', 'partial_unknown')),
  lease_owner TEXT,
  lease_expires_at DATETIME,
  fencing_token INTEGER NOT NULL DEFAULT 1 CHECK(fencing_token >= 1),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count >= 1),
  result_json TEXT,
  last_error_code TEXT,
  last_error_summary TEXT,
  succeeded_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE(tenant_code, deployment_code, source_app, idempotency_key),
  CHECK(
    (status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_status_lease
  ON notification_delivery_ledger(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS notification_delivery_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES notification_delivery_ledger(id),
  tenant_code TEXT NOT NULL,
  deployment_code TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_source_app TEXT NOT NULL,
  actor_client_id TEXT NOT NULL,
  actor_subject TEXT,
  reason TEXT NOT NULL CHECK(length(reason) >= 8),
  evidence_type TEXT NOT NULL CHECK(length(evidence_type) >= 1),
  evidence_reference TEXT NOT NULL CHECK(length(evidence_reference) >= 1),
  result_json TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  CHECK(from_status = 'partial_unknown' AND to_status IN ('succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_notification_reconciliation_delivery
  ON notification_delivery_reconciliations(delivery_id, id);
CREATE INDEX IF NOT EXISTS idx_notification_reconciliation_tenant_time
  ON notification_delivery_reconciliations(tenant_code, deployment_code, created_at);

CREATE TRIGGER IF NOT EXISTS trg_notification_reconciliations_no_update
BEFORE UPDATE ON notification_delivery_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'notification reconciliation audit is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_notification_reconciliations_no_delete
BEFORE DELETE ON notification_delivery_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'notification reconciliation audit is append-only');
END;
`

func Open(ctx context.Context, cfg config.DeliveryStoreConfig) (Store, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Type)) {
	case "", "sqlite":
		return OpenSQLite(ctx, cfg)
	case "mysql":
		return OpenMySQL(ctx, cfg)
	default:
		return nil, fmt.Errorf("unsupported notification delivery store %q", cfg.Type)
	}
}

func OpenSQLite(ctx context.Context, cfg config.DeliveryStoreConfig) (*SQLStore, error) {
	path := strings.TrimSpace(cfg.SQLitePath)
	if path == "" {
		return nil, ErrStoreUnavailable
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve sqlite delivery store path: %w", err)
	}
	directory := filepath.Dir(absolute)
	_, statErr := os.Stat(directory)
	directoryCreated := os.IsNotExist(statErr)
	if statErr != nil && !directoryCreated {
		return nil, fmt.Errorf("inspect sqlite delivery store directory: %w", statErr)
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create sqlite delivery store directory: %w", err)
	}
	if directoryCreated {
		if err := os.Chmod(directory, 0o700); err != nil {
			return nil, fmt.Errorf("secure sqlite delivery store directory: %w", err)
		}
	}

	dsn := (&url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}).String() +
		"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite is the single-instance default. One connection serializes claim
	// transactions inside the runtime and prevents write-lock upgrade races.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("sqlite delivery store ping: %w", err)
	}
	if _, err := db.ExecContext(ctx, sqliteSchema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize sqlite delivery store: %w", err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT OR IGNORE INTO notification_schema_migrations(version, applied_at) VALUES (1, ?), (2, ?)`,
		time.Now().UTC(), time.Now().UTC(),
	); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("record sqlite delivery store schema: %w", err)
	}
	if err := verifySQLiteSchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("secure sqlite delivery store file: %w", err)
	}
	return &SQLStore{db: db, now: func() time.Time { return time.Now().UTC() }, dialect: dialectSQLite}, nil
}

func verifySQLiteSchema(ctx context.Context, db *sql.DB) error {
	if err := verifySQLiteTableColumns(ctx, db, "notification_delivery_ledger", requiredColumns); err != nil {
		return err
	}
	return verifySQLiteTableColumns(ctx, db, "notification_delivery_reconciliations", requiredReconciliationColumns)
}

func verifySQLiteTableColumns(ctx context.Context, db *sql.DB, table string, required []string) error {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return fmt.Errorf("sqlite delivery store schema check for %s: %w", table, err)
	}
	defer rows.Close()
	found := make(map[string]struct{}, len(required))
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		found[name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, column := range required {
		if _, ok := found[column]; !ok {
			return fmt.Errorf("sqlite delivery store schema %s is missing required column %s", table, column)
		}
	}
	return nil
}
