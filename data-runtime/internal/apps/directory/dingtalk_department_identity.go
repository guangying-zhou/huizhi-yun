package directory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func upsertDingTalkCanonicalDepartment(
	ctx context.Context,
	tx *sql.Tx,
	externalID string,
	name string,
	parentCode string,
	parentID any,
	departmentPath string,
	departmentLevel int,
	parentExternalID string,
	sortOrder int,
	managerSubject string,
	snapshotRevision string,
) (string, error) {
	externalID = strings.TrimSpace(externalID)
	name = strings.TrimSpace(name)
	parentExternalID = strings.TrimSpace(parentExternalID)
	managerSubject = strings.TrimSpace(managerSubject)
	if externalID == "" || name == "" {
		return "", httperror.New(http.StatusBadRequest, "dingtalk_department_invalid", "DingTalk department identity and name are required")
	}

	code, departmentID, err := mappedDingTalkDepartmentTx(ctx, tx, externalID)
	identityExists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if errors.Is(err, sql.ErrNoRows) {
		code, departmentID, err = aliasedLegacyDingTalkDepartmentTx(ctx, tx, externalID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	pathMatched := false
	if errors.Is(err, sql.ErrNoRows) {
		code, departmentID, err = bootstrapDingTalkDepartmentTx(ctx, tx, name, parentCode)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		pathMatched = err == nil
	}
	created := false
	var managerUID any
	if managerSubject != "" {
		var resolvedManagerUID string
		managerErr := tx.QueryRowContext(ctx, `SELECT uid FROM directory_identities
			WHERE provider_code='dingtalk' AND provider_subject=? AND status='active'
			LIMIT 1`, managerSubject).Scan(&resolvedManagerUID)
		if managerErr == nil {
			managerUID = resolvedManagerUID
		} else if !errors.Is(managerErr, sql.ErrNoRows) {
			return "", managerErr
		}
	}
	if errors.Is(err, sql.ErrNoRows) {
		code = newCanonicalDepartmentCode()
		result, createErr := tx.ExecContext(ctx, `INSERT INTO directory_departments
			(dept_code,dept_name,parent_id,parent_dept_code,dept_path,level_no,sort_order,manager_uid,org_type,source_provider,
			 source_payload_hash,synced_at,status,created_at,updated_at)
			VALUES (?,?,?,NULLIF(?,''),?,?,?,?, 'department','hr',NULL,UTC_TIMESTAMP(),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
			code, name, parentID, parentCode, departmentPath, departmentLevel, sortOrder, managerUID)
		if createErr != nil {
			return "", createErr
		}
		departmentID, createErr = result.LastInsertId()
		if createErr != nil {
			return "", createErr
		}
		created = true
	}

	payloadHash := dingTalkDepartmentSnapshotLeafHash(externalID, name, parentExternalID, sortOrder, managerSubject)
	if !created {
		// DingTalk may omit leadership for its company root. Preserve the local
		// fallback until the source explicitly supplies a manager again.
		preserveLocalRootManager := externalID == "1" && parentExternalID == "" && parentCode == "" && managerSubject == ""
		if _, err = tx.ExecContext(ctx, `UPDATE directory_departments
			SET dept_name=?,parent_id=?,parent_dept_code=NULLIF(?,''),dept_path=?,level_no=?,sort_order=?,manager_uid=CASE WHEN ? THEN manager_uid ELSE ? END,source_payload_hash=?,
				synced_at=UTC_TIMESTAMP(),status='active',updated_at=UTC_TIMESTAMP()
			WHERE id=? AND org_type='department' AND status<>'deleted'`,
			name, parentID, parentCode, departmentPath, departmentLevel, sortOrder, preserveLocalRootManager, managerUID, payloadHash, departmentID); err != nil {
			return "", err
		}
	} else if _, err = tx.ExecContext(ctx, `UPDATE directory_departments SET source_payload_hash=? WHERE id=?`, payloadHash, departmentID); err != nil {
		return "", err
	}

	origin := "admin_bound"
	if created {
		origin = "source_created"
	} else if pathMatched {
		origin = "path_matched"
	}
	if identityExists {
		if _, err = tx.ExecContext(ctx, `UPDATE directory_department_identities
			SET source_payload_hash=?,manager_external_subject=NULLIF(?,''),last_seen_at=UTC_TIMESTAMP(),last_snapshot_revision=NULLIF(?,''),
				status='active',updated_at=UTC_TIMESTAMP()
			WHERE provider_code='dingtalk' AND external_department_id=? AND dept_code=?`,
			payloadHash, managerSubject, snapshotRevision, externalID, code); err != nil {
			return "", err
		}
	} else {
		var existingExternalID string
		mappingErr := tx.QueryRowContext(ctx, `SELECT external_department_id FROM directory_department_identities
			WHERE provider_code='dingtalk' AND dept_code=? AND status='active' LIMIT 1 FOR UPDATE`, code).Scan(&existingExternalID)
		if mappingErr == nil && existingExternalID != externalID {
			return "", httperror.New(http.StatusConflict, "dingtalk_canonical_department_already_mapped", "Canonical department already has another active DingTalk identity")
		}
		if mappingErr != nil && !errors.Is(mappingErr, sql.ErrNoRows) {
			return "", mappingErr
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO directory_department_identities
			(provider_code,external_department_id,dept_code,mapping_origin,source_payload_hash,manager_external_subject,
			 first_seen_at,last_seen_at,last_snapshot_revision,status,created_at,updated_at)
			VALUES ('dingtalk',?,?,?,?,NULLIF(?,''),UTC_TIMESTAMP(),UTC_TIMESTAMP(),NULLIF(?,''),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
			externalID, code, origin, payloadHash, managerSubject, snapshotRevision); err != nil {
			return "", err
		}
	}
	if err = upsertConsoleDepartmentSubject(ctx, tx, code); err != nil {
		return "", err
	}
	return code, nil
}

func dingTalkDepartmentSnapshotLeafHash(externalID, name, parentExternalID string, sortOrder int, managerSubject string) string {
	canonical := strings.Join([]string{
		strings.TrimSpace(externalID),
		strings.TrimSpace(name),
		strings.TrimSpace(parentExternalID),
		fmt.Sprint(sortOrder),
		strings.TrimSpace(managerSubject),
	}, "\n")
	return sha256Hex([]byte(canonical))
}

func mappedDingTalkDepartmentTx(ctx context.Context, tx *sql.Tx, externalID string) (string, int64, error) {
	var code string
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT d.dept_code,d.id
		FROM directory_department_identities i
		INNER JOIN directory_departments d ON d.dept_code=i.dept_code
		WHERE i.provider_code='dingtalk' AND i.external_department_id=?
			AND d.status<>'deleted' LIMIT 1 FOR UPDATE`, externalID).Scan(&code, &id)
	return code, id, err
}

func aliasedLegacyDingTalkDepartmentTx(ctx context.Context, tx *sql.Tx, externalID string) (string, int64, error) {
	var code string
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT target.dept_code,target.id
		FROM directory_departments legacy
		INNER JOIN directory_department_aliases alias ON alias.alias_dept_code=legacy.dept_code AND alias.status='active'
		INNER JOIN directory_departments target ON target.dept_code=alias.canonical_dept_code
		WHERE legacy.source_provider='dingtalk' AND legacy.external_ref=?
			AND legacy.status<>'deleted' AND target.status<>'deleted' LIMIT 1 FOR UPDATE`, dingTalkDepartmentRef(externalID)).Scan(&code, &id)
	return code, id, err
}

func bootstrapDingTalkDepartmentTx(ctx context.Context, tx *sql.Tx, name, parentCode string) (string, int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT department.dept_code,department.id,department.dept_name
		FROM directory_departments department
		WHERE department.org_type='department' AND department.status='active'
			AND COALESCE(department.parent_dept_code,'')=?
			AND NOT EXISTS (
				SELECT 1 FROM directory_department_identities identity
				WHERE identity.provider_code='dingtalk' AND identity.dept_code=department.dept_code
			)
		ORDER BY department.dept_code FOR UPDATE`, parentCode)
	if err != nil {
		return "", 0, err
	}
	defer rows.Close()
	type candidate struct {
		code string
		id   int64
	}
	unbound := 0
	matches := make([]candidate, 0, 2)
	for rows.Next() {
		var item candidate
		var candidateName string
		if err = rows.Scan(&item.code, &item.id, &candidateName); err != nil {
			return "", 0, err
		}
		unbound++
		if strings.TrimSpace(candidateName) == name {
			matches = append(matches, item)
		}
	}
	if err = rows.Err(); err != nil {
		return "", 0, err
	}
	if unbound == 1 && len(matches) == 1 {
		return matches[0].code, matches[0].id, nil
	}
	if unbound > 0 {
		return "", 0, httperror.New(http.StatusConflict, "dingtalk_department_mapping_required", "An unmapped formal department exists at this parent; align or resolve the department mapping before retrying")
	}
	return "", 0, sql.ErrNoRows
}

func newCanonicalDepartmentCode() string {
	return "DPT-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:24]
}
