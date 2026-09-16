package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const aimsPeopleContributionOperation = "aims.people-contributions.replace-scope.v1"

var contributionDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func (a *Adapter) freezePeopleContributionSnapshot(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	cycleCode := strings.TrimSpace(firstBodyText(body, "cycleCode", "cycle_code"))
	periodStart := strings.TrimSpace(firstBodyText(body, "periodStart", "period_start"))
	periodEnd := strings.TrimSpace(firstBodyText(body, "periodEnd", "period_end"))
	if cycleCode == "" || !contributionDatePattern.MatchString(periodStart) || !contributionDatePattern.MatchString(periodEnd) || periodEnd < periodStart {
		return nil, httperror.New(http.StatusBadRequest, "contribution_scope_invalid", "cycle and valid period are required")
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted operation context is required")
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var projectCode string
	if err := tx.QueryRowContext(ctx, `SELECT project_code FROM aims_projects WHERE id = ? AND lifecycle_status <> 'archived' FOR UPDATE`, projectID).Scan(&projectCode); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT t.id, t.uid, CAST(t.hours AS CHAR), COALESCE(w.item_key, '') FROM time_entries t LEFT JOIN work_items w ON w.id = t.work_item_id WHERE t.project_id = ? AND t.entry_date BETWEEN ? AND ? AND t.review_status = 'approved' ORDER BY t.id FOR UPDATE`, projectID, periodStart, periodEnd)
	if err != nil {
		return nil, err
	}
	groups := map[string]map[string]any{}
	for rows.Next() {
		var id int64
		var employee, hoursText, itemKey string
		if err := rows.Scan(&id, &employee, &hoursText, &itemKey); err != nil {
			rows.Close()
			return nil, err
		}
		hours, err := strconv.ParseFloat(hoursText, 64)
		if err != nil || employee == "" || hours < 0 {
			rows.Close()
			return nil, httperror.New(http.StatusConflict, "time_entry_snapshot_invalid", "time entry snapshot is invalid")
		}
		item := groups[employee]
		if item == nil {
			item = map[string]any{"employee_uid": employee, "project_code": projectCode, "role_code": "delivery", "work_hours": float64(0), "score_status": "unscored", "source_app": "aims", "source_biz_type": "time_entries", "source_biz_id": projectCode + ":" + employee, "source_refs": map[string]any{"time_entries": []int64{}, "work_items": []string{}, "review_status": "approved"}}
			groups[employee] = item
		}
		item["work_hours"] = item["work_hours"].(float64) + hours
		refs := item["source_refs"].(map[string]any)
		refs["time_entries"] = append(refs["time_entries"].([]int64), id)
		if itemKey != "" {
			refs["work_items"] = append(refs["work_items"].([]string), itemKey)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	employees := make([]string, 0, len(groups))
	for employee := range groups {
		employees = append(employees, employee)
	}
	sort.Strings(employees)
	items := make([]any, 0, len(employees))
	for _, employee := range employees {
		items = append(items, groups[employee])
	}
	content := map[string]any{"cycle_code": cycleCode, "project_code": projectCode, "period_start": periodStart, "period_end": periodEnd, "source_app": "aims", "source_biz_type": "time_entries", "sync_mode": "replace_scope", "snapshot_complete": true, "items": items}
	snapshotHash, err := integrationoperation.ValidateAndDigestCommand(content)
	if err != nil {
		return nil, err
	}
	scopeKey := contributionScopeDigest(projectCode, cycleCode)
	var currentRevision uint64
	var currentHash, currentOperationKey string
	err = tx.QueryRowContext(ctx, `SELECT revision_no,snapshot_hash,operation_key FROM aims_contribution_snapshot_versions WHERE scope_key=? FOR UPDATE`, scopeKey).Scan(&currentRevision, &currentHash, &currentOperationKey)
	if err == nil && currentHash == snapshotHash {
		expectedCommand := contributionCommand(content, currentRevision, snapshotHash)
		expectedHash, err := integrationoperation.ValidateAndDigestCommand(expectedCommand)
		if err != nil {
			return nil, err
		}
		status, err := validateStoredPeopleContributionOperation(ctx, tx, trusted, currentOperationKey, projectCode, expectedHash)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"operationKey": currentOperationKey, "status": status, "snapshotHash": snapshotHash, "sourceRevision": currentRevision, "itemCount": len(items), "projectCode": projectCode}, nil
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	revision := currentRevision + 1
	command := contributionCommand(content, revision, snapshotHash)
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	operationKey := fmt.Sprintf("aims:people-contributions:%s:r%d", scopeKey, revision)
	status, err := validateStoredPeopleContributionOperation(ctx, tx, trusted, operationKey, projectCode, hash)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"operationKey": operationKey, "status": status, "snapshotHash": snapshotHash, "sourceRevision": revision, "itemCount": len(items), "projectCode": projectCode}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	actor := strings.TrimSpace(firstBodyText(body, "current_user"))
	creator := contributionOperationCreator(actor, trusted.ServiceClientID)
	_, err = tx.ExecContext(ctx, `INSERT INTO integration_operation (operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by,next_attempt_at) VALUES (?,?,?,1,?,?,'aims','people',?,'people:write','project',?,?,'v1',?,?,'pending',?,?,?,?,?,UTC_TIMESTAMP(3))`, operationID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode, aimsPeopleContributionOperation, projectCode, operationKey, string(commandJSON), hash, nullableText(trusted.RequestID), nullableText(actor), nullableText(trusted.ServiceClientID), nullableText(creator), nullableText(creator))
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO aims_contribution_snapshot_versions (scope_key,cycle_code,project_code,source_app,source_biz_type,revision_no,snapshot_hash,operation_key) VALUES (?,?,?,'aims','time_entries',?,?,?) ON DUPLICATE KEY UPDATE revision_no=VALUES(revision_no),snapshot_hash=VALUES(snapshot_hash),operation_key=VALUES(operation_key),updated_at=CURRENT_TIMESTAMP`, scopeKey, cycleCode, projectCode, revision, snapshotHash, operationKey)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"operationKey": operationKey, "status": "pending", "snapshotHash": snapshotHash, "sourceRevision": revision, "itemCount": len(items), "projectCode": projectCode}, nil
}

func contributionScopeDigest(projectCode, cycleCode string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(projectCode) + "\x00" + strings.TrimSpace(cycleCode) + "\x00aims\x00time_entries"))
	return fmt.Sprintf("%x", digest[:])
}

func contributionCommand(content map[string]any, revision uint64, snapshotHash string) map[string]any {
	command := make(map[string]any, len(content)+2)
	for key, value := range content {
		command[key] = value
	}
	command["source_revision"] = revision
	command["snapshot_hash"] = snapshotHash
	return command
}

func contributionOperationCreator(actor, serviceClientID string) string {
	if actor = strings.TrimSpace(actor); actor != "" {
		return actor
	}
	return strings.TrimSpace(serviceClientID)
}

func validateStoredPeopleContributionOperation(ctx context.Context, tx *sql.Tx, trusted integrationoperation.TrustedContext, operationKey, projectCode, commandHash string) (string, error) {
	var status, targetApp, operationCode, sourceBizType, sourceBizCode, storedHash string
	err := tx.QueryRowContext(ctx, `SELECT status,target_app,operation_code,source_biz_type,source_biz_code,command_sha256 FROM integration_operation WHERE tenant_code=? AND deployment_code=? AND source_app='aims' AND operation_key=? FOR UPDATE`, trusted.TenantCode, trusted.DeploymentCode, operationKey).Scan(&status, &targetApp, &operationCode, &sourceBizType, &sourceBizCode, &storedHash)
	if err != nil {
		return "", err
	}
	if targetApp != "people" || operationCode != aimsPeopleContributionOperation || sourceBizType != "project" || sourceBizCode != projectCode || storedHash != commandHash {
		return "", httperror.New(http.StatusConflict, "integration_operation_immutable_conflict", "existing contribution operation identity or payload differs")
	}
	return status, nil
}
