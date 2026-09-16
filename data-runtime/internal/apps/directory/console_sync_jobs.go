package directory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type consoleSyncJobRow struct {
	JobCode, ProviderCode, SyncType, ObjectScope, Status string
	CursorBefore, CursorAfter                            sql.NullString
	StartedAt, FinishedAt                                sql.NullTime
	RequestedBy, ErrorMessage                            sql.NullString
	TotalCount, CreatedCount, UpdatedCount               int64
	DeletedCount, SkippedCount, ErrorCount               int64
	CreatedAt, UpdatedAt                                 time.Time
}

func (a *Adapter) ConsoleDirectorySyncJobs(ctx context.Context, query url.Values) ([]map[string]any, error) {
	limit, err := boundedConsoleSyncLimit(query.Get("limit"), 20, 100)
	if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT job_code,provider_code,sync_type,object_scope,
		cursor_before,cursor_after,status,started_at,finished_at,requested_by,
		total_count,created_count,updated_count,deleted_count,skipped_count,error_count,
		error_message,created_at,updated_at
		FROM directory_sync_jobs ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		row, err := scanConsoleSyncJob(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, mapConsoleSyncJob(row))
	}
	return result, rows.Err()
}

func (a *Adapter) ConsoleDirectorySyncJob(ctx context.Context, jobCode string) (map[string]any, error) {
	jobCode = strings.TrimSpace(jobCode)
	if !consoleSafeIdentifier(jobCode, 191) {
		return nil, httperror.New(http.StatusBadRequest, "directory_sync_job_invalid", "Directory sync job code is invalid")
	}
	row, err := scanConsoleSyncJob(a.db.QueryRowContext(ctx, `SELECT job_code,provider_code,sync_type,object_scope,
		cursor_before,cursor_after,status,started_at,finished_at,requested_by,
		total_count,created_count,updated_count,deleted_count,skipped_count,error_count,
		error_message,created_at,updated_at
		FROM directory_sync_jobs WHERE job_code=? LIMIT 1`, jobCode))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_sync_job_not_found", "Directory sync job was not found")
	}
	if err != nil {
		return nil, err
	}
	return mapConsoleSyncJob(row), nil
}

func (a *Adapter) ConsoleDirectorySyncEvents(
	ctx context.Context,
	jobCode string,
	query url.Values,
) ([]map[string]any, error) {
	if _, err := a.ConsoleDirectorySyncJob(ctx, jobCode); err != nil {
		return nil, err
	}
	limit, err := boundedConsoleSyncLimit(query.Get("limit"), 100, 100)
	if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT id,job_code,object_type,object_code,change_type,
		source_provider,external_ref,status,message,before_hash,after_hash,created_at
		FROM directory_sync_events WHERE job_code=?
		ORDER BY created_at DESC,id DESC LIMIT ?`, jobCode, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var currentJob, objectType, objectCode, changeType, provider, status string
		var externalRef, message, beforeHash, afterHash sql.NullString
		var createdAt time.Time
		if err := rows.Scan(&id, &currentJob, &objectType, &objectCode, &changeType,
			&provider, &externalRef, &status, &message, &beforeHash, &afterHash, &createdAt); err != nil {
			return nil, err
		}
		result = append(result, map[string]any{
			"id": id, "jobCode": currentJob, "objectType": objectType, "objectCode": objectCode,
			"changeType": changeType, "sourceProvider": provider,
			"externalRef": nullableConsoleStringValue(externalRef),
			"status":      status, "message": nullableConsoleStringValue(message),
			"beforeHash": nullableConsoleStringValue(beforeHash),
			"afterHash":  nullableConsoleStringValue(afterHash), "createdAt": createdAt,
		})
	}
	return result, rows.Err()
}

func (a *Adapter) ConsoleStartSubjectSync(
	ctx context.Context,
	body map[string]any,
	meta ConsoleMutationMeta,
	deploymentCode string,
) (result map[string]any, err error) {
	provider := text(body["providerCode"])
	if provider == "" {
		provider = "console"
	}
	scope := text(body["objectScope"])
	if scope == "" {
		scope = "subjects"
	}
	syncType := text(body["syncType"])
	if syncType == "" {
		syncType = "manual"
	}
	if (provider != "console" && provider != "manual") || (scope != "subjects" && scope != "all") {
		return nil, httperror.New(http.StatusNotImplemented, "directory_sync_provider_runtime_required", "Provider sync must run in its customer-side connector adapter")
	}
	if syncType != "manual" && syncType != "full" && syncType != "incremental" && syncType != "shadow_check" {
		return nil, httperror.New(http.StatusBadRequest, "directory_sync_type_invalid", "Directory sync type is invalid")
	}
	payload := map[string]any{"providerCode": provider, "objectScope": scope, "syncType": syncType}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.sync.subjects", meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	jobCode := fmt.Sprintf("%s-%s-%s-%s", provider, scope,
		time.Now().UTC().Format("20060102150405"), uuid.NewString()[:8])
	if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_sync_jobs
		(job_code,provider_code,sync_type,object_scope,status,requested_by,started_at,created_at,updated_at)
		VALUES (?,?,?,?,'running',?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		jobCode, provider, syncType, scope, meta.ActorID); err != nil {
		return nil, err
	}
	var beforeCount int64
	if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_subject_exports`).Scan(&beforeCount); err != nil {
		return nil, err
	}
	if err = rebuildConsoleSubjectExportsTx(ctx, session.tx); err != nil {
		return nil, err
	}
	var afterCount int64
	if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_subject_exports`).Scan(&afterCount); err != nil {
		return nil, err
	}
	changed := afterCount - beforeCount
	if changed < 0 {
		changed = 0
	}
	if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_sync_events
		(job_code,object_type,object_code,change_type,source_provider,external_ref,status,message,created_at)
		VALUES (?,'summary','__subject_exports__','update',?,?,'success',?,UTC_TIMESTAMP())`,
		jobCode, provider, "console:"+scope,
		fmt.Sprintf("Rebuilt subject exports. before=%d, after=%d", beforeCount, afterCount)); err != nil {
		return nil, err
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE directory_sync_jobs SET status='success',
		finished_at=UTC_TIMESTAMP(),total_count=?,created_count=?,updated_count=?,
		error_count=0,updated_at=UTC_TIMESTAMP() WHERE job_code=?`,
		afterCount, changed, afterCount, jobCode); err != nil {
		return nil, err
	}
	job := map[string]any{
		"jobCode": jobCode, "providerCode": provider, "syncType": syncType,
		"objectScope": scope, "status": "success", "requestedBy": meta.ActorID,
		"totalCount": afterCount, "createdCount": changed, "updatedCount": afterCount,
		"deletedCount": int64(0), "skippedCount": int64(0), "errorCount": int64(0),
	}
	result = map[string]any{"code": 0, "data": job}
	err = finishConsoleMutation(ctx, session, "directory.sync.subjects",
		"directory_sync_job", jobCode,
		map[string]any{"jobCode": jobCode, "beforeCount": beforeCount, "afterCount": afterCount},
		result)
	if err != nil {
		return nil, err
	}
	identity := ConnectorIdentity{TenantCode: a.tenant, DeploymentCode: deploymentCode}
	projection, projectionErr := a.pushSubjectProjection(ctx, identity, jobCode)
	if projectionErr != nil {
		message := safeText(projectionErr.Error(), 1000)
		_, _ = a.db.ExecContext(ctx, `INSERT INTO directory_sync_events
			(job_code,object_type,object_code,change_type,source_provider,external_ref,status,message,created_at)
			VALUES (?,'summary','__platform_subject_sync_failed__','error','platform',
			 'platform:subjects','failed',?,UTC_TIMESTAMP())`, jobCode, message)
		_, _ = a.db.ExecContext(ctx, `UPDATE directory_sync_jobs SET status='partial_success',
			error_count=error_count+1,error_message=?,updated_at=UTC_TIMESTAMP()
			WHERE job_code=?`, "Directory data updated, but Platform subject sync failed: "+message, jobCode)
		return nil, httperror.New(http.StatusBadGateway, "directory_platform_projection_failed", message)
	}
	job["platformSync"] = projection
	return result, nil
}

func rebuildConsoleSubjectExportsTx(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO directory_subject_exports
		(subject_type,subject_code,external_ref,parent_subject_type,parent_subject_code,
		 source_object_type,source_object_code,snapshot_hash,status,exported_at,created_at,updated_at)
		SELECT CASE WHEN d.org_type='committee' THEN 'committee' ELSE 'department' END,
		 d.dept_code,SHA2(CONCAT('console:',CASE WHEN d.org_type='committee' THEN 'committee' ELSE 'department' END,':',d.dept_code),256),
		 CASE WHEN d.parent_dept_code IS NULL THEN NULL WHEN parent.org_type='committee' THEN 'committee' ELSE 'department' END,
		 d.parent_dept_code,'directory_departments',d.dept_code,
		 SHA2(CONCAT_WS('|',CASE WHEN d.org_type='committee' THEN 'committee' ELSE 'department' END,d.dept_code,COALESCE(d.parent_dept_code,''),
			CASE WHEN alias.alias_dept_code IS NOT NULL THEN 'active' ELSE d.status END),256),
		 CASE WHEN alias.alias_dept_code IS NOT NULL THEN 'active' ELSE d.status END,
		 UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP()
		FROM directory_departments d
		LEFT JOIN directory_departments parent ON parent.dept_code=d.parent_dept_code
		LEFT JOIN directory_department_aliases alias ON alias.alias_dept_code=d.dept_code AND alias.status='active'
		ON DUPLICATE KEY UPDATE external_ref=VALUES(external_ref),
		 parent_subject_type=VALUES(parent_subject_type),parent_subject_code=VALUES(parent_subject_code),
		 snapshot_hash=VALUES(snapshot_hash),status=VALUES(status),
		 exported_at=VALUES(exported_at),updated_at=VALUES(updated_at)`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_subject_exports e
		INNER JOIN directory_departments d ON d.dept_code=e.subject_code
		SET e.status='inactive',e.snapshot_hash=SHA2(CONCAT_WS('|','department',d.dept_code,
		 COALESCE(d.parent_dept_code,''),'inactive'),256),e.exported_at=UTC_TIMESTAMP(),
		 e.updated_at=UTC_TIMESTAMP()
		WHERE e.subject_type='department' AND d.org_type='committee'`); err != nil {
		return err
	}
	if err := rebuildUserSubjectExportsWith(ctx, tx); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO directory_subject_exports
		(subject_type,subject_code,external_ref,parent_subject_type,parent_subject_code,
		 source_object_type,source_object_code,snapshot_hash,status,exported_at,created_at,updated_at)
		SELECT 'project',project_code,SHA2(CONCAT('console:project:',project_code),256),
		 CASE WHEN parent_project_code IS NOT NULL THEN 'project'
		      WHEN dept_code IS NOT NULL THEN 'department' ELSE NULL END,
		 COALESCE(parent_project_code,dept_code),'directory_projects',project_code,
		 SHA2(CONCAT_WS('|','project',project_code,COALESCE(parent_project_code,''),
		  COALESCE(dept_code,''),status),256),
		 CASE WHEN status='archived' THEN 'inactive' ELSE status END,
		 UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP()
		FROM directory_projects
		ON DUPLICATE KEY UPDATE external_ref=VALUES(external_ref),
		 parent_subject_type=VALUES(parent_subject_type),parent_subject_code=VALUES(parent_subject_code),
		 snapshot_hash=VALUES(snapshot_hash),status=VALUES(status),
		 exported_at=VALUES(exported_at),updated_at=VALUES(updated_at)`); err != nil {
		return err
	}
	for _, statement := range []string{
		`UPDATE directory_subject_exports e LEFT JOIN directory_users u ON u.uid=e.source_object_code
		 SET e.status='inactive',e.snapshot_hash=SHA2(CONCAT_WS('|',e.subject_type,e.subject_code,
		  COALESCE(e.parent_subject_type,''),COALESCE(e.parent_subject_code,''),'inactive'),256),
		  e.exported_at=UTC_TIMESTAMP(),e.updated_at=UTC_TIMESTAMP()
		 WHERE e.source_object_type='directory_users' AND e.subject_type='user'
		  AND u.uid IS NULL AND e.status='active'`,
		`UPDATE directory_subject_exports e LEFT JOIN directory_departments d ON d.dept_code=e.source_object_code
		 SET e.status='inactive',e.snapshot_hash=SHA2(CONCAT_WS('|',e.subject_type,e.subject_code,
		  COALESCE(e.parent_subject_type,''),COALESCE(e.parent_subject_code,''),'inactive'),256),
		  e.exported_at=UTC_TIMESTAMP(),e.updated_at=UTC_TIMESTAMP()
		 WHERE e.source_object_type='directory_departments'
		  AND e.subject_type IN ('department','committee') AND d.dept_code IS NULL AND e.status='active'`,
		`UPDATE directory_subject_exports e LEFT JOIN directory_projects p ON p.project_code=e.source_object_code
		 SET e.status='inactive',e.snapshot_hash=SHA2(CONCAT_WS('|',e.subject_type,e.subject_code,
		  COALESCE(e.parent_subject_type,''),COALESCE(e.parent_subject_code,''),'inactive'),256),
		  e.exported_at=UTC_TIMESTAMP(),e.updated_at=UTC_TIMESTAMP()
		 WHERE e.source_object_type='directory_projects' AND e.subject_type='project'
		  AND p.project_code IS NULL AND e.status='active'`,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

type consoleSyncJobScanner interface {
	Scan(...any) error
}

func scanConsoleSyncJob(scanner consoleSyncJobScanner) (consoleSyncJobRow, error) {
	var row consoleSyncJobRow
	err := scanner.Scan(&row.JobCode, &row.ProviderCode, &row.SyncType, &row.ObjectScope,
		&row.CursorBefore, &row.CursorAfter, &row.Status, &row.StartedAt, &row.FinishedAt,
		&row.RequestedBy, &row.TotalCount, &row.CreatedCount, &row.UpdatedCount,
		&row.DeletedCount, &row.SkippedCount, &row.ErrorCount, &row.ErrorMessage,
		&row.CreatedAt, &row.UpdatedAt)
	return row, err
}

func mapConsoleSyncJob(row consoleSyncJobRow) map[string]any {
	return map[string]any{
		"jobCode": row.JobCode, "providerCode": row.ProviderCode, "syncType": row.SyncType,
		"objectScope": row.ObjectScope, "cursorBefore": nullableConsoleStringValue(row.CursorBefore),
		"cursorAfter": nullableConsoleStringValue(row.CursorAfter), "status": row.Status,
		"startedAt": nullableConsoleTimeValue(row.StartedAt), "finishedAt": nullableConsoleTimeValue(row.FinishedAt),
		"requestedBy": nullableConsoleStringValue(row.RequestedBy),
		"totalCount":  row.TotalCount, "createdCount": row.CreatedCount,
		"updatedCount": row.UpdatedCount, "deletedCount": row.DeletedCount,
		"skippedCount": row.SkippedCount, "errorCount": row.ErrorCount,
		"errorMessage": nullableConsoleStringValue(row.ErrorMessage),
		"createdAt":    row.CreatedAt, "updatedAt": row.UpdatedAt,
	}
}

func boundedConsoleSyncLimit(raw string, fallback, maximum int) (int, error) {
	value := fallback
	if strings.TrimSpace(raw) != "" {
		if _, err := fmt.Sscan(raw, &value); err != nil {
			return 0, httperror.New(http.StatusBadRequest, "directory_sync_limit_invalid", "Directory sync limit is invalid")
		}
	}
	if value < 1 || value > maximum {
		return 0, httperror.New(http.StatusBadRequest, "directory_sync_limit_invalid", fmt.Sprintf("Directory sync limit must be between 1 and %d", maximum))
	}
	return value, nil
}

func consoleSafeIdentifier(value string, maximum int) bool {
	if value == "" || len(value) > maximum {
		return false
	}
	for _, char := range value {
		if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') &&
			!(char >= '0' && char <= '9') && !strings.ContainsRune("._:/-", char) {
			return false
		}
	}
	return true
}

func nullableConsoleStringValue(value sql.NullString) any {
	if value.Valid {
		return value.String
	}
	return nil
}

func nullableConsoleTimeValue(value sql.NullTime) any {
	if value.Valid {
		return value.Time
	}
	return nil
}
