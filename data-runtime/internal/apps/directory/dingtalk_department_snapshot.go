package directory

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	defaultDingTalkMaxMissingDepartmentCount = 3
	defaultDingTalkMaxMissingDepartmentRatio = 0.10
)

type dingTalkDepartmentSnapshotDifference struct {
	externalID         string
	deptCode           string
	deptName           string
	parentCode         string
	level              int
	activePrimaryUsers int
	activeChildren     int
}

type dingTalkDepartmentSnapshotCandidate struct {
	deptCode string
	level    int
}

func (a *Adapter) FinalizeDingTalkDepartmentSnapshot(
	ctx context.Context,
	body map[string]any,
	connectorID string,
) (map[string]any, error) {
	final, _ := body["final"].(bool)
	if !final || !dingTalkBodyHasScope(body, "organization") {
		return map[string]any{"handled": false}, nil
	}
	complete, _ := body["organizationSnapshotComplete"].(bool)
	jobID := trimDingTalkText(body["jobId"], 128)
	revision := trimDingTalkText(body["watermark"], 128)
	snapshotHash := strings.ToLower(trimDingTalkText(body["organizationSnapshotHash"], 64))
	rootExternalID := trimDingTalkText(body["organizationRootDepartmentId"], 255)
	reportedCount := consoleInt(body["organizationDepartmentCount"], 0)
	if !complete || jobID == "" || revision == "" || rootExternalID == "" || reportedCount < 1 || !validSHA256(snapshotHash) {
		return nil, httperror.New(http.StatusConflict, "dingtalk_organization_snapshot_incomplete", "DingTalk organization final marker is incomplete or invalid")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var existingID int64
	var existingHash, existingStatus, existingRisk string
	var existingMissing int
	existingErr := tx.QueryRowContext(ctx, `SELECT id,snapshot_hash,status,risk_level,missing_department_count
		FROM directory_department_snapshot_runs
		WHERE provider_code='dingtalk' AND snapshot_revision=? LIMIT 1 FOR UPDATE`, revision).
		Scan(&existingID, &existingHash, &existingStatus, &existingRisk, &existingMissing)
	if existingErr == nil {
		if existingHash != snapshotHash {
			return nil, httperror.New(http.StatusConflict, "dingtalk_organization_snapshot_conflict", "DingTalk organization snapshot revision was replayed with different content")
		}
		return map[string]any{
			"handled": true, "replayed": true, "runId": existingID,
			"status": existingStatus, "riskLevel": existingRisk, "missingDepartmentCount": existingMissing,
		}, nil
	}
	if !errors.Is(existingErr, sql.ErrNoRows) {
		return nil, existingErr
	}

	seenEntries := make([]string, 0, reportedCount)
	seenRows, err := tx.QueryContext(ctx, `SELECT external_department_id,source_payload_hash
		FROM directory_department_identities
		WHERE provider_code='dingtalk' AND status='active' AND last_snapshot_revision=?
		ORDER BY external_department_id`, revision)
	if err != nil {
		return nil, err
	}
	for seenRows.Next() {
		var externalID, payloadHash string
		if err = seenRows.Scan(&externalID, &payloadHash); err != nil {
			_ = seenRows.Close()
			return nil, err
		}
		if !validSHA256(payloadHash) {
			_ = seenRows.Close()
			return nil, httperror.New(http.StatusConflict, "dingtalk_organization_snapshot_evidence_invalid", "DingTalk organization snapshot contains an invalid department digest")
		}
		seenEntries = append(seenEntries, strings.TrimSpace(externalID)+"\n"+strings.ToLower(payloadHash))
	}
	if err = seenRows.Close(); err != nil {
		return nil, err
	}
	seenCount := len(seenEntries)
	computedHash := sha256Hex([]byte(strings.Join(seenEntries, "\n")))
	if seenCount != reportedCount || computedHash != snapshotHash {
		return nil, httperror.New(http.StatusConflict, "dingtalk_organization_snapshot_evidence_mismatch", "DingTalk organization snapshot count or digest does not match the applied departments")
	}

	var rootCount int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)
		FROM directory_department_identities identities
		INNER JOIN directory_departments departments ON departments.dept_code=identities.dept_code
		WHERE identities.provider_code='dingtalk' AND identities.external_department_id=?
			AND identities.status='active' AND identities.last_snapshot_revision=?
			AND departments.status='active'
			AND COALESCE(departments.parent_dept_code,'')=''`, rootExternalID, revision).Scan(&rootCount); err != nil {
		return nil, err
	}
	if rootCount != 1 {
		return nil, httperror.New(http.StatusConflict, "dingtalk_organization_root_invalid", "DingTalk organization snapshot root is missing or is not a canonical root department")
	}

	maxMissingCount := defaultDingTalkMaxMissingDepartmentCount
	maxMissingRatio := defaultDingTalkMaxMissingDepartmentRatio
	policyErr := tx.QueryRowContext(ctx, `SELECT max_missing_department_count,max_missing_department_ratio
		FROM directory_hr_source_policies WHERE provider_code='dingtalk' AND status='active' LIMIT 1 FOR UPDATE`).
		Scan(&maxMissingCount, &maxMissingRatio)
	if policyErr != nil && !errors.Is(policyErr, sql.ErrNoRows) {
		return nil, policyErr
	}

	differences := make([]dingTalkDepartmentSnapshotDifference, 0)
	missingRows, err := tx.QueryContext(ctx, `SELECT identities.external_department_id,departments.dept_code,departments.dept_name,
		COALESCE(departments.parent_dept_code,''),departments.level_no,
		(SELECT COUNT(*) FROM directory_users users
		 WHERE users.status='active' AND (
			users.primary_dept_code=departments.dept_code OR EXISTS (
				SELECT 1 FROM directory_user_departments memberships
				WHERE memberships.uid=users.uid AND memberships.dept_code=departments.dept_code
					AND memberships.is_primary=1 AND memberships.status='active'
			)
		 )),
		(SELECT COUNT(*) FROM directory_departments children
		 WHERE children.parent_dept_code=departments.dept_code AND children.status='active')
		FROM directory_department_identities identities
		INNER JOIN directory_departments departments ON departments.dept_code=identities.dept_code
		WHERE identities.provider_code='dingtalk' AND identities.status='active'
			AND departments.org_type='department' AND departments.status='active'
			AND COALESCE(identities.last_snapshot_revision,'')<>?
		ORDER BY departments.level_no DESC,departments.sort_order,departments.dept_code`, revision)
	if err != nil {
		return nil, err
	}
	for missingRows.Next() {
		var item dingTalkDepartmentSnapshotDifference
		if err = missingRows.Scan(&item.externalID, &item.deptCode, &item.deptName, &item.parentCode, &item.level, &item.activePrimaryUsers, &item.activeChildren); err != nil {
			_ = missingRows.Close()
			return nil, err
		}
		differences = append(differences, item)
	}
	if err = missingRows.Close(); err != nil {
		return nil, err
	}

	missingCount := len(differences)
	activeIdentityCount := seenCount + missingCount
	missingRatio := 0.0
	if activeIdentityCount > 0 {
		missingRatio = float64(missingCount) / float64(activeIdentityCount)
	}
	rootMissing := false
	for _, item := range differences {
		if item.parentCode == "" {
			rootMissing = true
			break
		}
	}
	riskLevel := "none"
	status := "no_changes"
	if missingCount > 0 {
		riskLevel = "normal"
		status = "awaiting_confirmation"
		if missingCount > maxMissingCount || missingRatio > maxMissingRatio || rootMissing {
			riskLevel = "high"
		}
	}

	result, err := tx.ExecContext(ctx, `INSERT INTO directory_department_snapshot_runs
		(provider_code,job_id,snapshot_revision,snapshot_hash,root_external_department_id,
		 reported_department_count,seen_department_count,active_identity_count,missing_department_count,
		 missing_department_ratio,policy_max_missing_count,policy_max_missing_ratio,risk_level,root_missing,
		 status,connector_id,created_at,updated_at)
		VALUES ('dingtalk',?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULLIF(?,''),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		jobID, revision, snapshotHash, rootExternalID,
		reportedCount, seenCount, activeIdentityCount, missingCount,
		missingRatio, maxMissingCount, maxMissingRatio, riskLevel, rootMissing, status, trimDingTalkText(connectorID, 128))
	if err != nil {
		return nil, err
	}
	runID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE directory_department_snapshot_differences differences
		INNER JOIN directory_department_snapshot_runs runs ON runs.id=differences.snapshot_run_id
		SET differences.status='superseded',differences.updated_at=UTC_TIMESTAMP()
		WHERE runs.provider_code='dingtalk' AND runs.id<>? AND differences.status='pending'`, runID); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE directory_department_snapshot_runs
		SET status='superseded',updated_at=UTC_TIMESTAMP()
		WHERE provider_code='dingtalk' AND id<>? AND status IN ('awaiting_confirmation','partially_applied')`, runID); err != nil {
		return nil, err
	}
	for _, item := range differences {
		if _, err = tx.ExecContext(ctx, `INSERT INTO directory_department_snapshot_differences
			(snapshot_run_id,external_department_id,dept_code,dept_name_snapshot,parent_dept_code_snapshot,
			 level_no_snapshot,active_primary_user_count_snapshot,active_child_department_count_snapshot,
			 status,created_at,updated_at)
			VALUES (?,?,?, ?,NULLIF(?,''),?,?,?,'pending',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
			runID, item.externalID, item.deptCode, item.deptName, item.parentCode,
			item.level, item.activePrimaryUsers, item.activeChildren); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"handled": true, "replayed": false, "runId": runID, "status": status,
		"riskLevel": riskLevel, "missingDepartmentCount": missingCount,
	}, nil
}

func (a *Adapter) ConsoleDingTalkDepartmentSnapshotChanges(ctx context.Context) (map[string]any, error) {
	var runID int64
	var jobID, revision, snapshotHash, rootExternalID, riskLevel, status string
	var reportedCount, seenCount, activeCount, missingCount, policyCount int
	var missingRatio, policyRatio float64
	var rootMissing bool
	err := a.db.QueryRowContext(ctx, `SELECT id,job_id,snapshot_revision,snapshot_hash,root_external_department_id,
		reported_department_count,seen_department_count,active_identity_count,missing_department_count,
		missing_department_ratio,policy_max_missing_count,policy_max_missing_ratio,risk_level,root_missing,status
		FROM directory_department_snapshot_runs
		WHERE provider_code='dingtalk' ORDER BY id DESC LIMIT 1`).Scan(
		&runID, &jobID, &revision, &snapshotHash, &rootExternalID,
		&reportedCount, &seenCount, &activeCount, &missingCount,
		&missingRatio, &policyCount, &policyRatio, &riskLevel, &rootMissing, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{"run": nil, "items": []any{}}, nil
	}
	if err != nil {
		return nil, err
	}

	items := make([]map[string]any, 0, missingCount)
	rows, err := a.db.QueryContext(ctx, `SELECT differences.external_department_id,differences.dept_code,
		differences.dept_name_snapshot,COALESCE(differences.parent_dept_code_snapshot,''),
		differences.level_no_snapshot,differences.status,
		(SELECT COUNT(*) FROM directory_users users
		 WHERE users.status='active' AND (
			users.primary_dept_code=differences.dept_code OR EXISTS (
				SELECT 1 FROM directory_user_departments memberships
				WHERE memberships.uid=users.uid AND memberships.dept_code=differences.dept_code
					AND memberships.is_primary=1 AND memberships.status='active'
			)
		 )),
		(SELECT COUNT(*) FROM directory_departments children
		 WHERE children.parent_dept_code=differences.dept_code AND children.status='active'
			AND NOT EXISTS (
				SELECT 1 FROM directory_department_snapshot_differences child_difference
				WHERE child_difference.snapshot_run_id=differences.snapshot_run_id
					AND child_difference.dept_code=children.dept_code AND child_difference.status='pending'
			))
		FROM directory_department_snapshot_differences differences
		WHERE differences.snapshot_run_id=?
		ORDER BY differences.level_no_snapshot DESC,differences.dept_code`, runID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var externalID, deptCode, deptName, parentCode, differenceStatus string
		var level, activePrimaryUsers, blockingChildren int
		if err = rows.Scan(&externalID, &deptCode, &deptName, &parentCode, &level, &differenceStatus, &activePrimaryUsers, &blockingChildren); err != nil {
			_ = rows.Close()
			return nil, err
		}
		blockedReasons := []string{}
		if activePrimaryUsers > 0 {
			blockedReasons = append(blockedReasons, "active_primary_users")
		}
		if blockingChildren > 0 {
			blockedReasons = append(blockedReasons, "active_child_departments")
		}
		items = append(items, map[string]any{
			"externalDepartmentId": externalID, "deptCode": deptCode, "departmentName": deptName,
			"parentDeptCode": parentCode, "level": level, "status": differenceStatus,
			"activePrimaryUserCount": activePrimaryUsers, "blockingActiveChildCount": blockingChildren,
			"blockedReasons": blockedReasons,
			"canApply":       status != "superseded" && differenceStatus == "pending" && len(blockedReasons) == 0,
		})
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	return map[string]any{
		"run": map[string]any{
			"runId": runID, "jobId": jobID, "snapshotRevision": revision, "snapshotHash": snapshotHash,
			"rootExternalDepartmentId": rootExternalID, "reportedDepartmentCount": reportedCount,
			"seenDepartmentCount": seenCount, "activeIdentityCount": activeCount,
			"missingDepartmentCount": missingCount, "missingDepartmentRatio": missingRatio,
			"policyMaxMissingCount": policyCount, "policyMaxMissingRatio": policyRatio,
			"riskLevel": riskLevel, "rootMissing": rootMissing, "status": status,
		},
		"items": items,
	}, nil
}

func (a *Adapter) ConsoleApplyDingTalkDepartmentSnapshotChanges(
	ctx context.Context,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	if envelope := object(body["serviceCommand"]); len(envelope) > 0 {
		body = object(envelope["command"])
	}
	runID, ok := consolePositiveInt64(body["snapshotRunId"])
	snapshotHash := strings.ToLower(text(body["snapshotHash"]))
	rawCodes, codesOK := body["departmentCodes"].([]any)
	if !ok || !validSHA256(snapshotHash) || !codesOK || len(rawCodes) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "dingtalk_department_snapshot_decision_invalid", "DingTalk department snapshot decision is invalid")
	}
	if len(rawCodes) > 500 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "dingtalk_department_snapshot_decision_too_large", "At most 500 missing departments may be confirmed at once")
	}
	selected := map[string]bool{}
	codes := make([]string, 0, len(rawCodes))
	for _, raw := range rawCodes {
		code := text(raw)
		if code == "" || len(code) > 64 || selected[code] {
			return nil, httperror.New(http.StatusBadRequest, "dingtalk_department_snapshot_department_invalid", "DingTalk department snapshot decision contains an invalid or duplicate department")
		}
		selected[code] = true
		codes = append(codes, code)
	}
	sort.Strings(codes)
	payload := map[string]any{"snapshotRunId": runID, "snapshotHash": snapshotHash, "departmentCodes": codes}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.dingtalk-department-snapshot.apply", meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()

	var revision, currentHash, runStatus string
	if err = session.tx.QueryRowContext(ctx, `SELECT snapshot_revision,snapshot_hash,status
		FROM directory_department_snapshot_runs WHERE id=? AND provider_code='dingtalk' LIMIT 1 FOR UPDATE`, runID).
		Scan(&revision, &currentHash, &runStatus); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "dingtalk_department_snapshot_not_found", "DingTalk department snapshot was not found")
	} else if err != nil {
		return nil, err
	}
	if currentHash != snapshotHash || (runStatus != "awaiting_confirmation" && runStatus != "partially_applied") {
		return nil, httperror.New(http.StatusConflict, "dingtalk_department_snapshot_stale", "DingTalk department snapshot is stale or is no longer awaiting confirmation")
	}

	candidates := make([]dingTalkDepartmentSnapshotCandidate, 0, len(codes))
	for _, code := range codes {
		var candidate dingTalkDepartmentSnapshotCandidate
		var differenceStatus, departmentStatus, orgType, identityStatus, lastRevision string
		err = session.tx.QueryRowContext(ctx, `SELECT differences.dept_code,differences.level_no_snapshot,differences.status,
			departments.status,departments.org_type,identities.status,COALESCE(identities.last_snapshot_revision,'')
			FROM directory_department_snapshot_differences differences
			INNER JOIN directory_departments departments ON departments.dept_code=differences.dept_code
			INNER JOIN directory_department_identities identities
				ON identities.provider_code='dingtalk' AND identities.dept_code=differences.dept_code
			WHERE differences.snapshot_run_id=? AND differences.dept_code=? LIMIT 1 FOR UPDATE`, runID, code).
			Scan(&candidate.deptCode, &candidate.level, &differenceStatus, &departmentStatus, &orgType, &identityStatus, &lastRevision)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusNotFound, "dingtalk_department_snapshot_difference_not_found", "A selected DingTalk department difference was not found")
		}
		if err != nil {
			return nil, err
		}
		if differenceStatus != "pending" || departmentStatus != "active" || orgType != "department" || identityStatus != "active" || lastRevision == revision {
			return nil, httperror.New(http.StatusConflict, "dingtalk_department_snapshot_difference_stale", "A selected DingTalk department difference is no longer applicable")
		}
		candidates = append(candidates, candidate)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].level != candidates[j].level {
			return candidates[i].level > candidates[j].level
		}
		return candidates[i].deptCode < candidates[j].deptCode
	})

	for _, candidate := range candidates {
		var activePrimaryUsers int
		if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users users
			WHERE users.status='active' AND (
				users.primary_dept_code=? OR EXISTS (
					SELECT 1 FROM directory_user_departments memberships
					WHERE memberships.uid=users.uid AND memberships.dept_code=?
						AND memberships.is_primary=1 AND memberships.status='active'
				)
			)`, candidate.deptCode, candidate.deptCode).Scan(&activePrimaryUsers); err != nil {
			return nil, err
		}
		if activePrimaryUsers > 0 {
			return nil, httperror.New(http.StatusConflict, "dingtalk_department_has_active_primary_users", "A missing DingTalk department still has active primary users and cannot be deactivated")
		}
		childRows, childErr := session.tx.QueryContext(ctx, `SELECT dept_code FROM directory_departments
			WHERE parent_dept_code=? AND status='active' FOR UPDATE`, candidate.deptCode)
		if childErr != nil {
			return nil, childErr
		}
		for childRows.Next() {
			var childCode string
			if err = childRows.Scan(&childCode); err != nil {
				_ = childRows.Close()
				return nil, err
			}
			if !selected[childCode] {
				_ = childRows.Close()
				return nil, httperror.New(http.StatusConflict, "dingtalk_department_has_active_children", "A missing DingTalk department still has active child departments and cannot be deactivated")
			}
		}
		if err = childRows.Close(); err != nil {
			return nil, err
		}
	}

	for _, candidate := range candidates {
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_user_departments
			SET is_primary=0,status='inactive',left_at=COALESCE(left_at,UTC_TIMESTAMP()),updated_at=UTC_TIMESTAMP()
			WHERE dept_code=? AND status='active'`, candidate.deptCode); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_department_identities
			SET status='inactive',updated_by_uid=?,updated_at=UTC_TIMESTAMP()
			WHERE provider_code='dingtalk' AND dept_code=? AND status='active'`, session.actorID, candidate.deptCode); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_departments
			SET status='inactive',manager_uid=NULL,updated_at=UTC_TIMESTAMP()
			WHERE dept_code=? AND org_type='department' AND status='active'`, candidate.deptCode); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_subject_exports
			SET status='inactive',updated_at=UTC_TIMESTAMP()
			WHERE source_object_type='directory_departments' AND source_object_code=?`, candidate.deptCode); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_department_snapshot_differences
			SET status='applied',applied_by_uid=?,applied_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
			WHERE snapshot_run_id=? AND dept_code=? AND status='pending'`, session.actorID, runID, candidate.deptCode); err != nil {
			return nil, err
		}
	}
	if err = rebuildUserSubjectExportsWith(ctx, session.tx); err != nil {
		return nil, err
	}
	var remaining int
	if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_department_snapshot_differences
		WHERE snapshot_run_id=? AND status='pending'`, runID).Scan(&remaining); err != nil {
		return nil, err
	}
	nextStatus := "applied"
	if remaining > 0 {
		nextStatus = "partially_applied"
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE directory_department_snapshot_runs
		SET status=?,confirmed_by_uid=?,confirmed_at=COALESCE(confirmed_at,UTC_TIMESTAMP()),
			applied_at=IF(?='applied',UTC_TIMESTAMP(),applied_at),updated_at=UTC_TIMESTAMP()
		WHERE id=?`, nextStatus, session.actorID, nextStatus, runID); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{
		"runId": runID, "applied": len(candidates), "remaining": remaining, "status": nextStatus,
	}}
	err = finishConsoleMutation(ctx, session, "directory.dingtalk-department-snapshot.apply",
		"directory_department_snapshot", fmt.Sprint(runID), map[string]any{"count": len(candidates), "status": nextStatus}, result)
	return result, err
}

func dingTalkBodyHasScope(body map[string]any, wanted string) bool {
	switch raw := body["objectScopes"].(type) {
	case []any:
		for _, scope := range raw {
			if strings.EqualFold(text(scope), wanted) {
				return true
			}
		}
	case []string:
		for _, scope := range raw {
			if strings.EqualFold(strings.TrimSpace(scope), wanted) {
				return true
			}
		}
	}
	return false
}

func validSHA256(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
