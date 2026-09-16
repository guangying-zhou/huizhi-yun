package directory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type sqlRunner interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (a *Adapter) ApplySync(ctx context.Context, identity ConnectorIdentity, body map[string]any) (map[string]any, error) {
	rawUsers, ok := body["users"].([]any)
	if !ok && body["users"] != nil {
		return nil, httperror.New(http.StatusBadRequest, "directory_sync_users_invalid", "Directory sync users must be an array")
	}
	if len(rawUsers) > 20_000 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "directory_sync_users_too_large", "Directory sync accepts at most 20000 users")
	}
	fullSync := boolDefault(body["fullSync"], true)
	jobCode := fmt.Sprintf("ldap-connector-%s-%s", time.Now().UTC().Format("20060102150405"), uuid.NewString()[:8])
	if _, err := a.db.ExecContext(ctx, `INSERT INTO directory_sync_jobs
		(job_code,provider_code,sync_type,object_scope,status,requested_by,started_at,created_at,updated_at)
		VALUES (?,'ldap',?,'all','running',?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		jobCode, func() string {
			if fullSync {
				return "full"
			}
			return "incremental"
		}(), identity.ConnectorID); err != nil {
		return nil, err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		a.recordSyncFailure(ctx, jobCode, err.Error())
		return nil, err
	}
	defer tx.Rollback()
	abort := func(syncErr error) (map[string]any, error) {
		_ = tx.Rollback()
		a.recordSyncFailure(ctx, jobCode, syncErr.Error())
		return nil, syncErr
	}
	created, updated, deleted := 0, 0, int64(0)
	externalRefs := make([]string, 0, len(rawUsers))
	for _, raw := range rawUsers {
		user := object(raw)
		uid := text(user["uid"])
		if uid == "" || text(user["dn"]) == "" {
			return abort(httperror.New(http.StatusUnprocessableEntity, "directory_sync_failed", "LDAP connector result is missing uid or dn"))
		}
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_users WHERE uid=?", uid).Scan(&count); err != nil {
			return abort(err)
		}
		externalRef, err := a.applyUserWith(ctx, tx, user, nil)
		if err != nil {
			return abort(err)
		}
		externalRefs = append(externalRefs, externalRef)
		if count > 0 {
			updated++
		} else {
			created++
		}
	}
	if fullSync {
		if _, err := tx.ExecContext(ctx, "CREATE TEMPORARY TABLE IF NOT EXISTS tmp_hzy_ldap_external_refs (external_ref VARCHAR(255) PRIMARY KEY) ENGINE=MEMORY"); err != nil {
			return abort(err)
		}
		if _, err := tx.ExecContext(ctx, "TRUNCATE TABLE tmp_hzy_ldap_external_refs"); err != nil {
			return abort(err)
		}
		for _, externalRef := range externalRefs {
			if _, err := tx.ExecContext(ctx, "INSERT IGNORE INTO tmp_hzy_ldap_external_refs (external_ref) VALUES (?)", externalRef); err != nil {
				return abort(err)
			}
		}
		result, err := tx.ExecContext(ctx, `UPDATE directory_users u
			LEFT JOIN tmp_hzy_ldap_external_refs current ON current.external_ref=u.external_ref
			SET u.status='deleted',u.synced_at=UTC_TIMESTAMP(),u.updated_at=UTC_TIMESTAMP()
			WHERE u.source_provider='ldap' AND u.status<>'deleted' AND current.external_ref IS NULL`)
		if err != nil {
			return abort(err)
		}
		deleted, _ = result.RowsAffected()
	}
	if err := rebuildUserSubjectExportsWith(ctx, tx); err != nil {
		return abort(err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_sync_jobs SET status='success',finished_at=UTC_TIMESTAMP(),
		total_count=?,created_count=?,updated_count=?,deleted_count=?,error_count=0,updated_at=UTC_TIMESTAMP()
		WHERE job_code=?`, len(rawUsers), created, updated, deleted, jobCode); err != nil {
		return abort(err)
	}
	if err := tx.Commit(); err != nil {
		a.recordSyncFailure(ctx, jobCode, err.Error())
		return nil, err
	}
	projection, err := a.pushSubjectProjection(ctx, identity, jobCode)
	if err != nil {
		message := safeText("Platform subject projection failed: "+err.Error(), 1000)
		_, _ = a.db.ExecContext(ctx, `UPDATE directory_sync_jobs SET status='partial_success',error_count=1,
			error_message=?,updated_at=UTC_TIMESTAMP() WHERE job_code=?`, message, jobCode)
		return nil, httperror.New(http.StatusBadGateway, "directory_platform_projection_failed", message)
	}
	return map[string]any{
		"jobCode": jobCode, "totalCount": len(rawUsers), "createdCount": created,
		"updatedCount": updated, "deletedCount": deleted, "platformProjection": projection,
	}, nil
}

func (a *Adapter) recordSyncFailure(ctx context.Context, jobCode, message string) {
	message = safeText(message, 1000)
	_, _ = a.db.ExecContext(ctx, `UPDATE directory_sync_jobs SET status='failed',finished_at=UTC_TIMESTAMP(),
		error_count=1,error_message=?,updated_at=UTC_TIMESTAMP() WHERE job_code=?`, message, jobCode)
}

func (a *Adapter) applyUser(ctx context.Context, user, requested map[string]any) (string, error) {
	return a.applyUserWith(ctx, a.db, user, requested)
}

func (a *Adapter) applyUserWith(ctx context.Context, runner sqlRunner, user, requested map[string]any) (string, error) {
	uid := text(user["uid"])
	dn := text(user["dn"])
	if uid == "" || dn == "" {
		return "", httperror.New(http.StatusUnprocessableEntity, "directory_user_invalid", "LDAP connector result is missing uid or dn")
	}
	externalID := text(user["externalId"])
	if externalID == "" {
		externalID = uid
	}
	externalRef := "ldap:user:" + externalID
	status := "active"
	if text(user["status"]) == "inactive" {
		status = "inactive"
	}
	var existingPosition, existingDepartment, existingUserType sql.NullString
	var existingDisplayName, existingRealName, existingSourceProvider sql.NullString
	err := runner.QueryRowContext(ctx, `SELECT position_title,primary_dept_code,user_type,display_name,real_name,source_provider
		FROM directory_users WHERE uid=? LIMIT 1`, uid).
		Scan(&existingPosition, &existingDepartment, &existingUserType,
			&existingDisplayName, &existingRealName, &existingSourceProvider)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	positionTitle := firstText(requested["positionTitle"], existingPosition.String)
	primaryDepartment := firstText(requested["primaryDeptCode"], existingDepartment.String)
	userType := firstText(requested["userType"], existingUserType.String, "employee")
	ldapOwnsHRFields := errors.Is(err, sql.ErrNoRows) || strings.EqualFold(strings.TrimSpace(existingSourceProvider.String), "ldap") || strings.TrimSpace(existingSourceProvider.String) == ""
	displayName := firstText(user["cn"], user["sn"], uid)
	realName := firstText(user["sn"], user["cn"])
	if err == nil && !ldapOwnsHRFields {
		displayName = firstText(existingDisplayName.String, displayName)
		realName = firstText(existingRealName.String, existingDisplayName.String, realName)
	}
	mail := text(user["mail"])
	mobile := text(user["telephoneNumber"])
	sourcePayload, _ := json.Marshal(map[string]any{"dn": dn, "externalId": externalID, "uid": uid, "cn": user["cn"], "sn": user["sn"]})
	if _, err := runner.ExecContext(ctx, `INSERT INTO directory_users
		(uid,username,display_name,real_name,avatar_url,email,mobile,mobile_tail4,position_title,primary_dept_code,
		user_type,source_provider,external_ref,source_payload_hash,synced_at,status,created_at,updated_at)
		VALUES (?,?,?,?,NULL,?,?,?,?,?,?,'ldap',?,?,UTC_TIMESTAMP(),?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE username=VALUES(username),
		display_name=CASE
			WHEN directory_users.source_provider='ldap'
			THEN VALUES(display_name) ELSE directory_users.display_name END,
		real_name=CASE
			WHEN directory_users.source_provider='ldap'
			THEN VALUES(real_name) ELSE directory_users.real_name END,
		email=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(email) ELSE directory_users.email END,
		mobile=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(mobile) ELSE directory_users.mobile END,
		mobile_tail4=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(mobile_tail4) ELSE directory_users.mobile_tail4 END,
		position_title=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(position_title) ELSE directory_users.position_title END,
		primary_dept_code=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(primary_dept_code) ELSE directory_users.primary_dept_code END,
		user_type=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(user_type) ELSE directory_users.user_type END,
		external_ref=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(external_ref) ELSE directory_users.external_ref END,
		source_payload_hash=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(source_payload_hash) ELSE directory_users.source_payload_hash END,
		status=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN VALUES(status) ELSE directory_users.status END,
		source_provider=CASE
			WHEN directory_users.source_provider IS NULL OR directory_users.source_provider='' OR directory_users.source_provider='ldap'
			THEN 'ldap' ELSE directory_users.source_provider END,
		synced_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()`,
		uid, uid, nullable(displayName), nullable(realName), nullable(mail), nullable(mobile), nullable(tail4(mobile)), nullable(positionTitle),
		nullable(primaryDepartment), userType, externalRef, sha256Hex(sourcePayload), status); err != nil {
		return "", err
	}
	profile, _ := json.Marshal(map[string]any{"cn": user["cn"], "sn": user["sn"], "externalId": externalID})
	if _, err := runner.ExecContext(ctx, `INSERT INTO directory_identities
		(uid,provider_code,provider_subject,provider_username,provider_dn,email,mobile_tail4,profile_json,last_synced_at,status,created_at,updated_at)
		VALUES (?,'ldap',?,?,?,?,?,?,UTC_TIMESTAMP(),?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE uid=VALUES(uid),provider_username=VALUES(provider_username),provider_dn=VALUES(provider_dn),
		email=VALUES(email),mobile_tail4=VALUES(mobile_tail4),profile_json=VALUES(profile_json),last_synced_at=UTC_TIMESTAMP(),
		status=VALUES(status),updated_at=UTC_TIMESTAMP()`,
		uid, externalID, uid, dn, nullable(mail), nullable(tail4(mobile)), string(profile), status); err != nil {
		return "", err
	}
	if ldapOwnsHRFields && primaryDepartment != "" {
		if _, err := runner.ExecContext(ctx, `UPDATE directory_user_departments SET is_primary=0,updated_at=UTC_TIMESTAMP()
			WHERE uid=? AND relation_type='member' AND dept_code<>?`, uid, primaryDepartment); err != nil {
			return "", err
		}
		if _, err := runner.ExecContext(ctx, `INSERT INTO directory_user_departments
			(uid,dept_code,relation_type,is_primary,source_provider,external_ref,status,joined_at,created_at,updated_at)
			VALUES (?,?,'member',1,'ldap',?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE is_primary=1,source_provider='ldap',status='active',left_at=NULL,updated_at=UTC_TIMESTAMP()`,
			uid, primaryDepartment, uid+":"+primaryDepartment+":member"); err != nil {
			return "", err
		}
	}
	return externalRef, nil
}

func (a *Adapter) rebuildUserSubjectExports(ctx context.Context) error {
	return rebuildUserSubjectExportsWith(ctx, a.db)
}

func rebuildUserSubjectExportsWith(ctx context.Context, runner sqlRunner) error {
	_, err := runner.ExecContext(ctx, `INSERT INTO directory_subject_exports
		(subject_type,subject_code,external_ref,parent_subject_type,parent_subject_code,source_object_type,source_object_code,
		snapshot_hash,status,exported_at,created_at,updated_at)
		SELECT 'user',u.uid,SHA2(CONCAT('console:user:',u.uid),256),
		CASE WHEN pd.dept_code IS NULL THEN NULL ELSE 'department' END,pd.dept_code,'directory_users',u.uid,
		SHA2(CONCAT_WS('|','user',u.uid,COALESCE(pd.dept_code,''),u.status),256),
		CASE WHEN u.status='pending' THEN 'inactive' ELSE u.status END,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP()
		FROM directory_users u
		LEFT JOIN (
			SELECT ranked.uid,ranked.dept_code FROM (
				SELECT ud.uid,ud.dept_code,ROW_NUMBER() OVER (
					PARTITION BY ud.uid ORDER BY ud.is_primary DESC,d.sort_order ASC,d.id ASC,ud.id ASC
				) AS row_no
				FROM directory_user_departments ud INNER JOIN directory_departments d ON d.dept_code=ud.dept_code
				WHERE ud.status='active' AND ud.relation_type='member' AND d.status='active' AND d.org_type='department'
			) ranked WHERE ranked.row_no=1
		) pd ON pd.uid=u.uid
		ON DUPLICATE KEY UPDATE external_ref=VALUES(external_ref),parent_subject_type=VALUES(parent_subject_type),
		parent_subject_code=VALUES(parent_subject_code),snapshot_hash=VALUES(snapshot_hash),status=VALUES(status),
		exported_at=VALUES(exported_at),updated_at=VALUES(updated_at)`)
	return err
}

func object(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func text(value any) string {
	if value == nil {
		return ""
	}
	if result, ok := value.(string); ok {
		return strings.TrimSpace(result)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func firstText(values ...any) string {
	for _, value := range values {
		if result := text(value); result != "" {
			return result
		}
	}
	return ""
}

func number(value any) int64 {
	switch current := value.(type) {
	case float64:
		return int64(current)
	case int:
		return int64(current)
	case int64:
		return current
	case uint64:
		return int64(current)
	default:
		result, _ := strconv.ParseInt(text(value), 10, 64)
		return result
	}
}

func boolDefault(value any, fallback bool) bool {
	if value == nil {
		return fallback
	}
	if result, ok := value.(bool); ok {
		return result
	}
	result, err := strconv.ParseBool(text(value))
	if err != nil {
		return fallback
	}
	return result
}

func sha256Hex(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

var nonDigit = regexp.MustCompile(`[^0-9]`)

func tail4(value string) string {
	digits := nonDigit.ReplaceAllString(value, "")
	if len(digits) <= 4 {
		return digits
	}
	return digits[len(digits)-4:]
}
