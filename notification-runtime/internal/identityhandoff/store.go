package identityhandoff

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound        = errors.New("wecom authorization not found")
	ErrInvalidState    = errors.New("wecom authorization state mismatch")
	ErrExpired         = errors.New("wecom authorization expired")
	ErrAlreadyUsed     = errors.New("wecom authorization already used")
	ErrBindingMismatch = errors.New("wecom authorization binding mismatch")
)

const handoffTTL = 5 * time.Minute

type Store struct {
	db  *sql.DB
	now func() time.Time
}

type Authorization struct {
	ID         string
	Tenant     string
	Deployment string
	ExpiresAt  time.Time
}

func Open(ctx context.Context, path string) (*Store, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("identity handoff SQLite path is required")
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS connector_wecom_login_handoffs (
authorization_id TEXT PRIMARY KEY,
state_sha256 TEXT NOT NULL CHECK(length(state_sha256)=64),
tenant_code TEXT NOT NULL,
deployment_code TEXT NOT NULL,
status TEXT NOT NULL CHECK(status IN ('issued','processing','exchanged','consumed','expired','failed')),
ticket_sha256 TEXT UNIQUE,
subject_id TEXT,
expires_at TEXT NOT NULL,
created_at TEXT NOT NULL,
processing_at TEXT,
exchanged_at TEXT,
consumed_at TEXT,
updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_wecom_handoff_ticket ON connector_wecom_login_handoffs(ticket_sha256);
CREATE INDEX IF NOT EXISTS idx_connector_wecom_handoff_expiry ON connector_wecom_login_handoffs(status, expires_at);`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize identity handoff store: %w", err)
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	_, _ = db.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs SET status='failed',updated_at=? WHERE status='processing'`, stamp)
	return &Store{db: db, now: func() time.Time { return time.Now().UTC() }}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Issue(ctx context.Context, tenant, deployment, state string) (Authorization, error) {
	tenant = strings.TrimSpace(tenant)
	deployment = strings.TrimSpace(deployment)
	state = strings.TrimSpace(state)
	if tenant == "" || deployment == "" || len(state) < 32 || len(state) > 256 {
		return Authorization{}, ErrInvalidState
	}
	now := s.now().UTC()
	expiresAt := now.Add(handoffTTL)
	authorizationID, err := randomToken("hzy_wa_")
	if err != nil {
		return Authorization{}, err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO connector_wecom_login_handoffs
(authorization_id,state_sha256,tenant_code,deployment_code,status,expires_at,created_at,updated_at)
VALUES (?,?,?,?,'issued',?,?,?)`, authorizationID, digest(state), tenant, deployment,
		expiresAt.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	if err != nil {
		return Authorization{}, err
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs
SET status='expired',updated_at=?
WHERE expires_at<=? AND status IN ('issued','exchanged')`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	_, _ = s.db.ExecContext(ctx, `DELETE FROM connector_wecom_login_handoffs WHERE expires_at<? AND status IN ('consumed','expired','failed')`, now.Add(-24*time.Hour).Format(time.RFC3339Nano))
	return Authorization{ID: authorizationID, Tenant: tenant, Deployment: deployment, ExpiresAt: expiresAt}, nil
}

func (s *Store) BeginCallback(ctx context.Context, authorizationID, state string) (Authorization, error) {
	authorizationID = strings.TrimSpace(authorizationID)
	state = strings.TrimSpace(state)
	if authorizationID == "" || state == "" {
		return Authorization{}, ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Authorization{}, err
	}
	defer tx.Rollback()
	var result Authorization
	var stateHash, status, expires string
	err = tx.QueryRowContext(ctx, `SELECT tenant_code,deployment_code,state_sha256,status,expires_at
FROM connector_wecom_login_handoffs WHERE authorization_id=?`, authorizationID).
		Scan(&result.Tenant, &result.Deployment, &stateHash, &status, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return Authorization{}, ErrNotFound
	}
	if err != nil {
		return Authorization{}, err
	}
	if !secureEqual(stateHash, digest(state)) {
		return Authorization{}, ErrInvalidState
	}
	result.ExpiresAt, err = time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		return Authorization{}, err
	}
	if !s.now().UTC().Before(result.ExpiresAt) {
		_, _ = tx.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs SET status='expired',updated_at=? WHERE authorization_id=? AND status='issued'`, s.now().UTC().Format(time.RFC3339Nano), authorizationID)
		_ = tx.Commit()
		return Authorization{}, ErrExpired
	}
	if status != "issued" {
		return Authorization{}, ErrAlreadyUsed
	}
	stamp := s.now().UTC().Format(time.RFC3339Nano)
	updated, err := tx.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs SET status='processing',processing_at=?,updated_at=? WHERE authorization_id=? AND status='issued'`, stamp, stamp, authorizationID)
	if err != nil {
		return Authorization{}, err
	}
	if count, _ := updated.RowsAffected(); count != 1 {
		return Authorization{}, ErrAlreadyUsed
	}
	if err := tx.Commit(); err != nil {
		return Authorization{}, err
	}
	result.ID = authorizationID
	return result, nil
}

func (s *Store) Complete(ctx context.Context, authorizationID, subjectID string) (string, error) {
	subjectID = strings.TrimSpace(subjectID)
	if subjectID == "" || len(subjectID) > 255 || strings.ContainsAny(subjectID, "\r\n\x00") {
		return "", errors.New("invalid WeCom subject")
	}
	ticket, err := randomToken("hzy_wh_")
	if err != nil {
		return "", err
	}
	stamp := s.now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs
SET status='exchanged',ticket_sha256=?,subject_id=?,exchanged_at=?,updated_at=?
WHERE authorization_id=? AND status='processing'`, digest(ticket), subjectID, stamp, stamp, authorizationID)
	if err != nil {
		return "", err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return "", ErrAlreadyUsed
	}
	return ticket, nil
}

func (s *Store) Fail(ctx context.Context, authorizationID string) {
	stamp := s.now().UTC().Format(time.RFC3339Nano)
	_, _ = s.db.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs SET status='failed',updated_at=? WHERE authorization_id=? AND status='processing'`, stamp, authorizationID)
}

func (s *Store) Redeem(ctx context.Context, tenant, deployment, ticket string) (string, error) {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" {
		return "", ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var storedTenant, storedDeployment, status, subject, expires string
	err = tx.QueryRowContext(ctx, `SELECT tenant_code,deployment_code,status,subject_id,expires_at
FROM connector_wecom_login_handoffs WHERE ticket_sha256=?`, digest(ticket)).
		Scan(&storedTenant, &storedDeployment, &status, &subject, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if storedTenant != strings.TrimSpace(tenant) || storedDeployment != strings.TrimSpace(deployment) {
		return "", ErrBindingMismatch
	}
	if status != "exchanged" {
		return "", ErrAlreadyUsed
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		return "", err
	}
	if !s.now().UTC().Before(expiresAt) {
		_, _ = tx.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs SET status='expired',updated_at=? WHERE ticket_sha256=? AND status='exchanged'`, s.now().UTC().Format(time.RFC3339Nano), digest(ticket))
		_ = tx.Commit()
		return "", ErrExpired
	}
	stamp := s.now().UTC().Format(time.RFC3339Nano)
	result, err := tx.ExecContext(ctx, `UPDATE connector_wecom_login_handoffs SET status='consumed',consumed_at=?,updated_at=? WHERE ticket_sha256=? AND status='exchanged'`, stamp, stamp, digest(ticket))
	if err != nil {
		return "", err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return "", ErrAlreadyUsed
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return subject, nil
}

func randomToken(prefix string) (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(value), nil
}

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func secureEqual(left, right string) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}
