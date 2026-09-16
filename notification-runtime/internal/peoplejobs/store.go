package peoplejobs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

func Open(ctx context.Context, path string) (*Store, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	if _, err = db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS connector_people_sync_jobs (
	job_id TEXT PRIMARY KEY, provider TEXT NOT NULL, integration_code TEXT NOT NULL,
	object_scopes_json TEXT NOT NULL, watermark TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
	request_sha256 TEXT NOT NULL DEFAULT '', retry_of_job_id TEXT, original_actor_uid TEXT,
	cancelled_by_uid TEXT, cancel_idempotency_key TEXT, cancel_request_sha256 TEXT,
status TEXT NOT NULL, departments_count INTEGER NOT NULL DEFAULT 0, users_count INTEGER NOT NULL DEFAULT 0,
applied_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, batch_count INTEGER NOT NULL DEFAULT 0,
field_coverage_json TEXT NOT NULL DEFAULT '[]', partial_fields_missing_json TEXT NOT NULL DEFAULT '[]',
error_code TEXT, error_message TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL
)`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err = db.ExecContext(ctx, `ALTER TABLE connector_people_sync_jobs ADD COLUMN retry_of_job_id TEXT`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		_ = db.Close()
		return nil, err
	}
	if _, err = db.ExecContext(ctx, `ALTER TABLE connector_people_sync_jobs ADD COLUMN original_actor_uid TEXT`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		_ = db.Close()
		return nil, err
	}
	for _, statement := range []string{
		`ALTER TABLE connector_people_sync_jobs ADD COLUMN request_sha256 TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE connector_people_sync_jobs ADD COLUMN cancelled_by_uid TEXT`,
		`ALTER TABLE connector_people_sync_jobs ADD COLUMN cancel_idempotency_key TEXT`,
		`ALTER TABLE connector_people_sync_jobs ADD COLUMN cancel_request_sha256 TEXT`,
		`ALTER TABLE connector_people_sync_jobs ADD COLUMN field_coverage_json TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE connector_people_sync_jobs ADD COLUMN partial_fields_missing_json TEXT NOT NULL DEFAULT '[]'`,
	} {
		if _, err = db.ExecContext(ctx, statement); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			_ = db.Close()
			return nil, err
		}
	}
	recoveredAt := now()
	if _, err = db.ExecContext(ctx, `UPDATE connector_people_sync_jobs SET status='failed',error_code='runtime_restarted',
		error_message='Connector Runtime restarted before the job completed',finished_at=?,updated_at=? WHERE status IN ('pending','running')`, recoveredAt, recoveredAt); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS uk_connector_people_sync_active
		ON connector_people_sync_jobs(provider,integration_code) WHERE status IN ('pending','running')`); err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS uk_connector_people_sync_cancel_idempotency
		ON connector_people_sync_jobs(cancel_idempotency_key) WHERE cancel_idempotency_key IS NOT NULL`); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }
func now() string             { return time.Now().UTC().Format(time.RFC3339Nano) }

func (s *Store) Create(ctx context.Context, job Job, idempotencyKey, requestHash string) (Job, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Job{}, false, err
	}
	defer func() { _ = tx.Rollback() }()

	var existingID, existingHash string
	existingErr := tx.QueryRowContext(ctx, `SELECT job_id,COALESCE(request_sha256,'') FROM connector_people_sync_jobs WHERE idempotency_key=?`, idempotencyKey).Scan(&existingID, &existingHash)
	if existingErr == nil {
		if existingHash == "" || existingHash != requestHash {
			return Job{}, false, ErrIdempotencyConflict
		}
		if err = tx.Commit(); err != nil {
			return Job{}, false, err
		}
		existing, _, getErr := s.Get(ctx, existingID)
		return existing, false, getErr
	}
	if !errors.Is(existingErr, sql.ErrNoRows) {
		return Job{}, false, existingErr
	}

	var activeCount int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM connector_people_sync_jobs
		WHERE provider=? AND integration_code=? AND status IN ('pending','running')`, job.Provider, job.IntegrationCode).Scan(&activeCount); err != nil {
		return Job{}, false, err
	}
	if activeCount > 0 {
		return Job{}, false, ErrJobAlreadyRunning
	}

	latestRows, latestErr := tx.QueryContext(ctx, `SELECT job_id,watermark FROM connector_people_sync_jobs
		WHERE provider=? AND integration_code=? ORDER BY created_at DESC,job_id DESC`, job.Provider, job.IntegrationCode)
	if latestErr != nil {
		return Job{}, false, latestErr
	}
	var latestID string
	var latestTime time.Time
	for latestRows.Next() {
		var candidateID, candidateWatermark string
		if latestErr = latestRows.Scan(&candidateID, &candidateWatermark); latestErr != nil {
			_ = latestRows.Close()
			return Job{}, false, latestErr
		}
		parsed, parseErr := time.Parse(time.RFC3339Nano, candidateWatermark)
		if parseErr == nil {
			latestID, latestTime = candidateID, parsed
			break
		}
	}
	if latestErr = latestRows.Close(); latestErr != nil {
		return Job{}, false, latestErr
	}
	if latestID != "" && latestID != job.RetryOfJobID {
		candidateTime, candidateErr := time.Parse(time.RFC3339Nano, job.Watermark)
		if candidateErr != nil || !candidateTime.After(latestTime) {
			return Job{}, false, ErrStaleRevision
		}
	}

	scopes, _ := json.Marshal(job.ObjectScopes)
	stamp := now()
	_, err = tx.ExecContext(ctx, `INSERT INTO connector_people_sync_jobs
	(job_id,provider,integration_code,object_scopes_json,watermark,idempotency_key,request_sha256,retry_of_job_id,original_actor_uid,status,created_at,updated_at)
	VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`, job.JobID, job.Provider, job.IntegrationCode, string(scopes), job.Watermark, idempotencyKey, requestHash, nullable(job.RetryOfJobID), nullable(job.OriginalActorUID), stamp, stamp)
	if err == nil {
		if err = tx.Commit(); err != nil {
			return Job{}, false, err
		}
		return s.Get(ctx, job.JobID)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "unique") {
		return Job{}, false, err
	}
	return Job{}, false, ErrIdempotencyConflict
}

func (s *Store) Get(ctx context.Context, id string) (Job, bool, error) {
	var job Job
	var scopes, fieldCoverage, partialFieldsMissing string
	var retryOf, cancelledBy, started, finished, errorCode, errorMessage sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT job_id,retry_of_job_id,COALESCE(original_actor_uid,''),provider,integration_code,object_scopes_json,watermark,status,
	departments_count,users_count,applied_count,skipped_count,batch_count,
	COALESCE(field_coverage_json,'[]'),COALESCE(partial_fields_missing_json,'[]'),
	error_code,error_message,created_at,started_at,finished_at,cancelled_by_uid
	FROM connector_people_sync_jobs WHERE job_id=?`, id).Scan(&job.JobID, &retryOf, &job.OriginalActorUID, &job.Provider, &job.IntegrationCode, &scopes, &job.Watermark, &job.Status,
		&job.Counts.Departments, &job.Counts.Users, &job.Counts.Applied, &job.Counts.Skipped, &job.Counts.Batches,
		&fieldCoverage, &partialFieldsMissing,
		&errorCode, &errorMessage, &job.CreatedAt, &started, &finished, &cancelledBy)
	if errors.Is(err, sql.ErrNoRows) {
		return Job{}, false, nil
	}
	if err != nil {
		return Job{}, false, err
	}
	_ = json.Unmarshal([]byte(scopes), &job.ObjectScopes)
	_ = json.Unmarshal([]byte(fieldCoverage), &job.Counts.FieldCoverage)
	_ = json.Unmarshal([]byte(partialFieldsMissing), &job.Counts.PartialFieldsMissing)
	job.RetryOfJobID = retryOf.String
	job.CancelledByUID = cancelledBy.String
	job.ErrorCode = errorCode.String
	job.ErrorMessage = errorMessage.String
	job.StartedAt = started.String
	job.FinishedAt = finished.String
	return job, true, nil
}

func (s *Store) Cancel(ctx context.Context, id string) (Job, bool, error) {
	return s.CancelAs(ctx, id, "", "people-sync-cancel:"+id, hashJSON(struct {
		Action string `json:"action"`
		JobID  string `json:"jobId"`
	}{Action: "cancel", JobID: id}))
}

func (s *Store) CancelAs(ctx context.Context, id, originalActorUID, idempotencyKey, requestHash string) (Job, bool, error) {
	stamp := now()
	result, err := s.db.ExecContext(ctx, `UPDATE connector_people_sync_jobs
SET status='cancelled',error_code=NULL,error_message=NULL,finished_at=?,updated_at=?,cancelled_by_uid=NULLIF(?,''),
	cancel_idempotency_key=?,cancel_request_sha256=?
WHERE job_id=? AND status IN ('pending','running')`, stamp, stamp, originalActorUID, idempotencyKey, requestHash, id)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return Job{}, false, ErrIdempotencyConflict
		}
		return Job{}, false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Job{}, false, err
	}
	job, ok, err := s.Get(ctx, id)
	if err != nil || !ok {
		return Job{}, false, err
	}
	if affected == 1 {
		return job, true, nil
	}
	if job.Status == "cancelled" {
		var keyJobID, storedActor, storedHash string
		keyErr := s.db.QueryRowContext(ctx, `SELECT job_id,COALESCE(cancelled_by_uid,''),COALESCE(cancel_request_sha256,'')
			FROM connector_people_sync_jobs WHERE cancel_idempotency_key=?`, idempotencyKey).
			Scan(&keyJobID, &storedActor, &storedHash)
		if keyErr != nil && !errors.Is(keyErr, sql.ErrNoRows) {
			return Job{}, false, keyErr
		}
		if errors.Is(keyErr, sql.ErrNoRows) || keyJobID != id || storedActor != originalActorUID || storedHash != requestHash {
			return Job{}, false, ErrIdempotencyConflict
		}
	}
	return job, false, nil
}

func (s *Store) Start(ctx context.Context, id string) error {
	stamp := now()
	result, err := s.db.ExecContext(ctx, `UPDATE connector_people_sync_jobs SET status='running',started_at=?,updated_at=? WHERE job_id=? AND status='pending'`, stamp, stamp, id)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return fmt.Errorf("job is not pending")
	}
	return nil
}

func (s *Store) Complete(ctx context.Context, id string, counts Counts) error {
	stamp := now()
	// 整批缺失的受管字段必须留在作业结果里。provider 缺权限时接口仍报成功，
	// 若这里也报完全成功，HR 只能看到“同步 N 人”，无法得知字段根本没有下发。
	code, message := partialFieldsWarning(counts.PartialFieldsMissing)
	if counts.FieldCoverage == nil {
		counts.FieldCoverage = []FieldCoverage{}
	}
	if counts.PartialFieldsMissing == nil {
		counts.PartialFieldsMissing = []string{}
	}
	fieldCoverage, err := json.Marshal(counts.FieldCoverage)
	if err != nil {
		return err
	}
	partialMissing, err := json.Marshal(counts.PartialFieldsMissing)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE connector_people_sync_jobs SET status='success',departments_count=?,users_count=?,applied_count=?,skipped_count=?,batch_count=?,field_coverage_json=?,partial_fields_missing_json=?,error_code=?,error_message=?,finished_at=?,updated_at=? WHERE job_id=? AND status='running'`, counts.Departments, counts.Users, counts.Applied, counts.Skipped, counts.Batches, string(fieldCoverage), string(partialMissing), code, message, stamp, stamp, id)
	return err
}

// partialFieldsWarning 返回稳定错误码与可操作提示；没有缺失字段时返回 NULL，
// 避免把上一轮的告警残留在本次成功结果上。
func partialFieldsWarning(missing []string) (any, any) {
	if len(missing) == 0 {
		return nil, nil
	}
	message := "DingTalk did not return " + strings.Join(missing, ", ") +
		" for any active employee; grant the DingTalk application permission to read these employee fields, then rerun the sync"
	if len(message) > 500 {
		message = message[:500]
	}
	return "partial_fields_missing", message
}
func (s *Store) Fail(ctx context.Context, id, code, message string) error {
	if len(message) > 500 {
		message = message[:500]
	}
	stamp := now()
	_, err := s.db.ExecContext(ctx, `UPDATE connector_people_sync_jobs SET status='failed',error_code=?,error_message=?,finished_at=?,updated_at=? WHERE job_id=? AND status IN ('pending','running')`, code, message, stamp, stamp, id)
	return err
}

func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
