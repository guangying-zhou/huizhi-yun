package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	peopleDirectoryEmploymentOperation   = "people.directory.employment-sync.v1"
	peopleDirectoryOffboardingOperation  = "people.directory.offboarding-disable.v1"
	peopleDirectoryEmploymentCapability  = "console:directory-employment:sync"
	peopleDirectoryOffboardingCapability = "console:directory-offboarding:disable"
)

type peopleLifecycleFact struct {
	EmployeeUID       string
	LoginName         string
	DisplayName       string
	DeptCode          string
	PositionCode      string
	PositionName      string
	EmploymentStatus  string
	LeaveDate         string
	AssignmentCode    string
	ChangeType        string
	EffectiveFrom     string
	EmployeeNumber    string
	IdentityProvider  string
	IdentitySubject   string
	Email             string
	EmailSourceState  string
	Mobile            string
	MobileSourceState string
}

func (a *Adapter) handleDirectoryLifecycleMutation(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	trimmed := strings.TrimRight(path, "/")
	if method == http.MethodPost && trimmed == "/v1/people/service/directory-lifecycle:prepare-due" {
		result, err := a.prepareDueDirectoryLifecycle(ctx, body)
		return ok(result), "people.directory_lifecycle.prepare_due", true, err
	}
	isEmployeeCreate := method == http.MethodPost && trimmed == "/v1/people/employees"
	isAssignmentCreate := method == http.MethodPost && trimmed == "/v1/people/assignments"
	isEmployeeUpdate := (method == http.MethodPut || method == http.MethodPatch) && strings.HasPrefix(trimmed, "/v1/people/employees/") && singleSegment(strings.TrimPrefix(trimmed, "/v1/people/employees/"))
	isAssignmentUpdate := (method == http.MethodPut || method == http.MethodPatch) && strings.HasPrefix(trimmed, "/v1/people/assignments/") && singleSegment(strings.TrimPrefix(trimmed, "/v1/people/assignments/"))
	if !isEmployeeCreate && !isAssignmentCreate && !isEmployeeUpdate && !isAssignmentUpdate {
		return nil, "", false, nil
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
	if err != nil {
		return nil, "people.directory_lifecycle.freeze", true, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People lifecycle context is required")
	}
	actor := strings.TrimSpace(query.Get("current_user"))
	creator := actor
	if creator == "" {
		creator = trusted.ServiceClientID
	}
	if isEmployeeUpdate || isAssignmentUpdate {
		result, operation, err := a.Adapter.HandleRuntimeUpdateWithTxHook(ctx, method, path, query, body, func(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
			employeeUID := identifier
			if isAssignmentUpdate {
				if err := tx.QueryRowContext(ctx, `SELECT employee_uid FROM people_assignments WHERE assignment_code=? FOR UPDATE`, identifier).Scan(&employeeUID); err != nil {
					return nil, err
				}
			}
			return a.freezeDirectoryLifecycleOperationTx(ctx, tx, employeeUID, trusted, actor, creator)
		})
		return result, operation, true, err
	}
	result, operation, err := a.Adapter.HandleRuntimeCreateWithTxHook(ctx, method, path, query, body, func(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
		employeeUID := identifier
		if isAssignmentCreate {
			if err := tx.QueryRowContext(ctx, `SELECT employee_uid FROM people_assignments WHERE assignment_code=? FOR UPDATE`, identifier).Scan(&employeeUID); err != nil {
				return nil, err
			}
		}
		return a.freezeDirectoryLifecycleOperationTx(ctx, tx, employeeUID, trusted, actor, creator)
	})
	return result, operation, true, err
}

func (a *Adapter) freezeDirectoryLifecycleOperationTx(ctx context.Context, tx *sql.Tx, employeeUID string, trusted integrationoperation.TrustedContext, actor, creator string) (map[string]any, error) {
	return a.freezeDirectoryLifecycleOperationAtTx(ctx, tx, employeeUID, trusted, actor, creator, time.Now().UTC())
}

func (a *Adapter) freezeDirectoryLifecycleOperationAtTx(ctx context.Context, tx *sql.Tx, employeeUID string, trusted integrationoperation.TrustedContext, actor, creator string, asOf time.Time) (map[string]any, error) {
	fact, err := loadPeopleLifecycleFactAtTx(ctx, tx, employeeUID, asOf)
	if err != nil {
		return nil, err
	}
	content, operationCode, capability := peopleLifecycleContent(fact)
	snapshotHash, err := integrationoperation.ValidateAndDigestCommand(content)
	if err != nil {
		return nil, err
	}
	var currentRevision uint64
	var currentHash, currentOperationKey string
	err = tx.QueryRowContext(ctx, `SELECT revision_no,snapshot_hash,operation_key FROM people_directory_lifecycle_versions WHERE employee_uid=? FOR UPDATE`, employeeUID).Scan(&currentRevision, &currentHash, &currentOperationKey)
	if err == nil && currentHash == snapshotHash {
		return map[string]any{"directoryLifecycle": map[string]any{"linked": true, "operationKey": currentOperationKey, "sourceRevision": currentRevision, "idempotent": true}}, nil
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	revision := currentRevision + 1
	command := make(map[string]any, len(content)+2)
	for key, value := range content {
		command[key] = value
	}
	command["sourceRevision"] = revision
	command["snapshotHash"] = snapshotHash
	if actor != "" {
		command["originalActorUid"] = actor
	}
	commandHash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	uidHash := sha256.Sum256([]byte(employeeUID))
	operationKey := fmt.Sprintf("people:directory-lifecycle:%s:r%d", hex.EncodeToString(uidHash[:16]), revision)
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO integration_operation (
operation_id,operation_key,correlation_key,sequence_no,depends_on_operation_key,tenant_code,deployment_code,source_app,target_app,
operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,
command_json,command_sha256,next_attempt_at,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by,
created_at,updated_at
) VALUES (?,?,?,?,NULLIF(?,''),?,?,'people','console',?,?,'employee',?,?,'v1',?,?,UTC_TIMESTAMP(3),'pending',?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		operationID, operationKey, "people:directory-lifecycle:"+hex.EncodeToString(uidHash[:16]), revision, currentOperationKey, trusted.TenantCode, trusted.DeploymentCode,
		operationCode, capability, employeeUID, operationKey, string(commandJSON), commandHash,
		nullablePeopleText(trusted.RequestID), nullablePeopleText(actor), nullablePeopleText(trusted.ServiceClientID), nullablePeopleText(creator), nullablePeopleText(creator))
	if err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO people_directory_lifecycle_versions (employee_uid,revision_no,snapshot_hash,operation_key,lifecycle_type,effective_date) VALUES (?,?,?,?,?,NULLIF(?,'')) ON DUPLICATE KEY UPDATE revision_no=VALUES(revision_no),snapshot_hash=VALUES(snapshot_hash),operation_key=VALUES(operation_key),lifecycle_type=VALUES(lifecycle_type),effective_date=VALUES(effective_date),updated_at=CURRENT_TIMESTAMP(3)`, employeeUID, revision, snapshotHash, operationKey, content["lifecycleType"], fact.EffectiveFrom)
	if err != nil {
		return nil, err
	}
	return map[string]any{"directoryLifecycle": map[string]any{"linked": true, "operationKey": operationKey, "operationStatus": "pending", "sourceRevision": revision}}, nil
}

func loadPeopleLifecycleFactTx(ctx context.Context, tx *sql.Tx, employeeUID string) (peopleLifecycleFact, error) {
	return loadPeopleLifecycleFactAtTx(ctx, tx, employeeUID, time.Now().UTC())
}

func loadPeopleLifecycleFactAtTx(ctx context.Context, tx *sql.Tx, employeeUID string, asOf time.Time) (peopleLifecycleFact, error) {
	var fact peopleLifecycleFact
	var loginName, deptCode, positionCode, positionName, leaveDate sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT employee_uid,employee_no,COALESCE(login_name,''),display_name,
		COALESCE(dept_code,''),COALESCE(position_code,''),COALESCE(position_name,''),
		employment_status,COALESCE(DATE_FORMAT(leave_date,'%Y-%m-%d'),''),
		COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.directory_user.provider_subject')),''),
		COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.directory_user.email')),''),
		CASE
			WHEN COALESCE(JSON_CONTAINS_PATH(metadata,'one','$.directory_user.email'),0)=0 THEN 'absent'
			WHEN NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.directory_user.email'))),'') IS NULL THEN 'empty'
			ELSE 'provided'
		END,
		COALESCE(TRIM(mobile),''),
		CASE
			WHEN NULLIF(TRIM(mobile),'') IS NOT NULL THEN 'provided'
			WHEN JSON_CONTAINS_PATH(metadata,'one','$.directory_user.mobile')=1
				AND NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.directory_user.mobile'))),'') IS NULL THEN 'empty'
			ELSE 'absent'
		END
		FROM people_employees WHERE employee_uid=? AND archived_at IS NULL FOR UPDATE`, employeeUID).
		Scan(&fact.EmployeeUID, &fact.EmployeeNumber, &loginName, &fact.DisplayName,
			&deptCode, &positionCode, &positionName, &fact.EmploymentStatus, &leaveDate,
			&fact.IdentitySubject, &fact.Email, &fact.EmailSourceState, &fact.Mobile, &fact.MobileSourceState)
	if err != nil {
		return fact, err
	}
	fact.LoginName, fact.DeptCode, fact.PositionCode, fact.PositionName, fact.LeaveDate = loginName.String, deptCode.String, positionCode.String, positionName.String, leaveDate.String
	if fact.IdentitySubject != "" {
		fact.IdentityProvider = "dingtalk"
	}
	var assignmentCode, assignmentDept, assignmentPositionCode, assignmentPositionName, changeType, effectiveFrom sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT assignment_code,COALESCE(dept_code,''),COALESCE(position_code,''),COALESCE(position_name,''),change_type,DATE_FORMAT(effective_from,'%Y-%m-%d') FROM people_assignments WHERE employee_uid=? AND approval_status IN ('none','approved') AND effective_from<=? ORDER BY effective_from DESC,id DESC LIMIT 1 FOR UPDATE`, employeeUID, asOf.UTC().Format("2006-01-02")).Scan(&assignmentCode, &assignmentDept, &assignmentPositionCode, &assignmentPositionName, &changeType, &effectiveFrom)
	if err != nil && err != sql.ErrNoRows {
		return fact, err
	}
	if err == nil {
		fact.AssignmentCode, fact.ChangeType, fact.EffectiveFrom = assignmentCode.String, changeType.String, effectiveFrom.String
		if assignmentDept.String != "" {
			fact.DeptCode = assignmentDept.String
		}
		if assignmentPositionCode.String != "" {
			fact.PositionCode = assignmentPositionCode.String
		}
		if assignmentPositionName.String != "" {
			fact.PositionName = assignmentPositionName.String
		}
	}
	return fact, nil
}

func peopleLifecycleContent(fact peopleLifecycleFact) (map[string]any, string, string) {
	offboarding := fact.EmploymentStatus == "left" || fact.EmploymentStatus == "inactive" || fact.ChangeType == "leave"
	if offboarding {
		effectiveDate := fact.LeaveDate
		if fact.ChangeType == "leave" && fact.EffectiveFrom != "" {
			effectiveDate = fact.EffectiveFrom
		}
		return map[string]any{"lifecycleType": "offboarding", "employeeUid": fact.EmployeeUID, "effectiveDate": effectiveDate, "sourceAssignmentCode": fact.AssignmentCode}, peopleDirectoryOffboardingOperation, peopleDirectoryOffboardingCapability
	}
	return map[string]any{
		"lifecycleType": "employment", "employeeUid": fact.EmployeeUID,
		"employeeNumber": fact.EmployeeNumber, "loginName": fact.LoginName,
		"displayName": fact.DisplayName, "email": fact.Email, "emailSourceState": fact.EmailSourceState,
		"mobile": fact.Mobile, "mobileSourceState": fact.MobileSourceState,
		"identityProvider": fact.IdentityProvider, "identitySubject": fact.IdentitySubject,
		"deptCode": fact.DeptCode, "positionCode": fact.PositionCode,
		"positionName": fact.PositionName, "employmentStatus": fact.EmploymentStatus,
		"effectiveDate": fact.EffectiveFrom, "sourceAssignmentCode": fact.AssignmentCode,
	}, peopleDirectoryEmploymentOperation, peopleDirectoryEmploymentCapability
}
