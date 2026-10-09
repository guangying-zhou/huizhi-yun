package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	peopleAssetsOffboardingOperationCode = "people.offboarding.assets-recovery-sync.v1"
	peopleAssetsOffboardingCapability    = "assets:offboarding-recovery:sync"
	peopleAssetsOffboardingLease         = time.Minute
)

type peopleAssetsOffboardingFact struct {
	EmployeeID     int64
	EmployeeUID    string
	DisplayName    string
	Status         string
	AssignmentCode string
	EffectiveDate  time.Time
}

type peopleAssetsOffboardingCursor struct {
	EffectiveDate string `json:"effectiveDate"`
	EmployeeID    int64  `json:"employeeId"`
}

func (a *Adapter) handleAssetsOffboardingProjectionRuntime(ctx context.Context, method, path string, body map[string]any) (any, string, bool, error) {
	if method != http.MethodPost {
		return nil, "", false, nil
	}
	switch {
	case path == "/v1/people/service/assets-offboarding-projections:prepare":
		result, err := a.prepareAssetsOffboardingProjections(ctx, body)
		return result, "people.assets_offboarding.prepare", true, err
	case path == "/v1/people/integration-operations:claim-next":
		result, err := a.claimPeopleIntegrationOperation(ctx, "", body)
		return result, "people.assets_offboarding.claim_next", true, err
	case strings.HasPrefix(path, "/v1/people/integration-operations/") && strings.HasSuffix(path, ":claim"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/integration-operations/"), ":claim")
		result, err := a.claimPeopleIntegrationOperation(ctx, key, body)
		return result, "people.integration_operations.claim", true, err
	case strings.HasPrefix(path, "/v1/people/integration-operations/") && strings.HasSuffix(path, ":succeed"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/integration-operations/"), ":succeed")
		result, err := a.succeedPeopleIntegrationOperation(ctx, key, body)
		return result, "people.assets_offboarding.succeed", true, err
	case strings.HasPrefix(path, "/v1/people/integration-operations/") && strings.HasSuffix(path, ":fail"):
		key := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/integration-operations/"), ":fail")
		result, err := a.failPeopleIntegrationOperation(ctx, key, body)
		return result, "people.assets_offboarding.fail", true, err
	default:
		return nil, "", false, nil
	}
}

func (a *Adapter) prepareAssetsOffboardingProjections(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
	if err != nil || trusted.TenantCode == "" || trusted.DeploymentCode == "" {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People integration operation context is required")
	}
	asOf, err := time.Parse(time.RFC3339, strings.TrimSpace(cleanBodyString(body, "asOf")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "people_assets_offboarding_as_of_invalid", "asOf must be an explicit RFC3339 timestamp")
	}
	asOf = asOf.UTC()
	limit := int(float64FromAny(body["limit"]))
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	cursor, err := decodePeopleAssetsOffboardingCursor(cleanBodyString(body, "cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "people_assets_offboarding_cursor_invalid", "cursor is invalid")
	}
	facts, err := a.queryEffectiveOffboardingFacts(ctx, asOf, cursor, limit+1)
	if err != nil {
		return nil, err
	}
	hasMore := len(facts) > limit
	if hasMore {
		facts = facts[:limit]
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	created := 0
	for _, fact := range facts {
		command, sourceEventKey := peopleAssetsOffboardingCommand(fact)
		commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
		if err != nil {
			return nil, err
		}
		operationKey := peopleAssetsOffboardingOperationKey(sourceEventKey)
		operationID, err := integrationoperation.NewOperationID()
		if err != nil {
			return nil, err
		}
		commandJSON, err := json.Marshal(command)
		if err != nil {
			return nil, err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT IGNORE INTO integration_operation (
			  operation_id,operation_key,correlation_key,sequence_no,
			  tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,
			  source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,
			  next_attempt_at,status,original_request_id,service_client_id,created_by,updated_by,created_at,updated_at
			) VALUES (?,?,?,1,?,?,'people','assets',?,?,'employee',?,?, 'v1',?,?,UTC_TIMESTAMP(3),'pending',?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
			operationID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode,
			peopleAssetsOffboardingOperationCode, peopleAssetsOffboardingCapability, fact.EmployeeUID,
			operationKey, string(commandJSON), commandSHA, nullablePeopleText(trusted.RequestID),
			nullablePeopleText(trusted.ServiceClientID), nullablePeopleText(trusted.ServiceClientID), nullablePeopleText(trusted.ServiceClientID))
		if err != nil {
			return nil, err
		}
		rows, _ := result.RowsAffected()
		created += int(rows)
		var storedSHA string
		if err := tx.QueryRowContext(ctx, `SELECT command_sha256 FROM integration_operation WHERE tenant_code=? AND deployment_code=? AND source_app='people' AND operation_key=? LIMIT 1`, trusted.TenantCode, trusted.DeploymentCode, operationKey).Scan(&storedSHA); err != nil {
			return nil, err
		}
		if storedSHA != commandSHA {
			return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "existing People lifecycle operation has different evidence")
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore && len(facts) > 0 {
		nextCursor, err = encodePeopleAssetsOffboardingCursor(facts[len(facts)-1])
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"asOf": asOf.Format(time.RFC3339), "eligible": len(facts), "created": created, "nextCursor": nextCursor}, nil
}

func (a *Adapter) queryEffectiveOffboardingFacts(ctx context.Context, asOf time.Time, cursor *peopleAssetsOffboardingCursor, limit int) ([]peopleAssetsOffboardingFact, error) {
	query := `
		SELECT fact.employee_id,fact.employee_uid,fact.display_name,fact.employment_status,
		       CASE WHEN fact.latest_change_type='leave' THEN fact.latest_assignment_code ELSE '' END,
		       CASE WHEN fact.employment_status IN ('left','inactive')
		            THEN fact.employee_effective_date ELSE fact.latest_effective_date END AS effective_date
		FROM (
		  SELECT e.id AS employee_id,e.employee_uid,e.display_name,e.employment_status,
		         COALESCE(e.leave_date,DATE(e.updated_at)) AS employee_effective_date,
		         COALESCE((SELECT a.change_type FROM people_assignments a
		                   WHERE a.employee_uid=e.employee_uid AND a.approval_status IN ('none','approved') AND a.effective_from<=?
		                   ORDER BY a.effective_from DESC,a.id DESC LIMIT 1),'') AS latest_change_type,
		         COALESCE((SELECT a.assignment_code FROM people_assignments a
		                   WHERE a.employee_uid=e.employee_uid AND a.approval_status IN ('none','approved') AND a.effective_from<=?
		                   ORDER BY a.effective_from DESC,a.id DESC LIMIT 1),'') AS latest_assignment_code,
		         (SELECT a.effective_from FROM people_assignments a
		          WHERE a.employee_uid=e.employee_uid AND a.approval_status IN ('none','approved') AND a.effective_from<=?
		          ORDER BY a.effective_from DESC,a.id DESC LIMIT 1) AS latest_effective_date
		  FROM people_employees e
		) fact
		WHERE (fact.employment_status IN ('left','inactive') OR fact.latest_change_type='leave')`
	args := []any{asOf, asOf, asOf}
	if cursor != nil {
		cursorDate, _ := time.Parse("2006-01-02", cursor.EffectiveDate)
		query += ` AND ((CASE WHEN fact.employment_status IN ('left','inactive') THEN fact.employee_effective_date ELSE fact.latest_effective_date END)>?
		 OR ((CASE WHEN fact.employment_status IN ('left','inactive') THEN fact.employee_effective_date ELSE fact.latest_effective_date END)=? AND fact.employee_id>?))`
		args = append(args, cursorDate, cursorDate, cursor.EmployeeID)
	}
	args = append(args, limit)
	rows, err := a.DB().QueryContext(ctx, query+` ORDER BY effective_date ASC,fact.employee_id ASC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	facts := make([]peopleAssetsOffboardingFact, 0, limit)
	for rows.Next() {
		var fact peopleAssetsOffboardingFact
		if err := rows.Scan(&fact.EmployeeID, &fact.EmployeeUID, &fact.DisplayName, &fact.Status, &fact.AssignmentCode, &fact.EffectiveDate); err != nil {
			return nil, err
		}
		fact.EmployeeUID = strings.TrimSpace(fact.EmployeeUID)
		fact.AssignmentCode = strings.TrimSpace(fact.AssignmentCode)
		fact.EffectiveDate = fact.EffectiveDate.UTC()
		if fact.EmployeeUID != "" {
			facts = append(facts, fact)
		}
	}
	return facts, rows.Err()
}

func encodePeopleAssetsOffboardingCursor(fact peopleAssetsOffboardingFact) (string, error) {
	payload, err := json.Marshal(peopleAssetsOffboardingCursor{EffectiveDate: fact.EffectiveDate.UTC().Format("2006-01-02"), EmployeeID: fact.EmployeeID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodePeopleAssetsOffboardingCursor(value string) (*peopleAssetsOffboardingCursor, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	var cursor peopleAssetsOffboardingCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, err
	}
	if cursor.EmployeeID <= 0 {
		return nil, fmt.Errorf("employeeId must be positive")
	}
	if _, err := time.Parse("2006-01-02", cursor.EffectiveDate); err != nil {
		return nil, err
	}
	return &cursor, nil
}

func peopleAssetsOffboardingCommand(fact peopleAssetsOffboardingFact) (map[string]any, string) {
	date := fact.EffectiveDate.UTC().Format("2006-01-02")
	sourceEventKey := "people:employee:" + fact.EmployeeUID + ":status:" + strings.ToLower(fact.Status) + ":effective:" + date
	if fact.AssignmentCode != "" {
		sourceEventKey = "people:leave:" + fact.AssignmentCode + ":effective:" + date
	}
	return map[string]any{
		"sourceEventKey":      sourceEventKey,
		"departedEmployeeUid": fact.EmployeeUID,
		"offboardedAt":        date + "T00:00:00Z",
	}, sourceEventKey
}

func peopleAssetsOffboardingOperationKey(sourceEventKey string) string {
	digest := sha256.Sum256([]byte(sourceEventKey))
	return "people:assets-offboarding:" + hex.EncodeToString(digest[:16])
}

func (a *Adapter) claimPeopleIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	trusted, worker, err := trustedPeopleIntegrationWorker(body)
	if err != nil {
		return nil, err
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	var claimed *integrationoperation.ClaimedOperation
	if strings.TrimSpace(operationKey) == "" {
		family := strings.TrimSpace(cleanBodyString(body, "operationFamily"))
		if family != "" {
			operationKey, err = a.nextPeopleOperationKeyForFamily(ctx, trusted, family)
			if err != nil || operationKey == "" {
				return nil, err
			}
			claimed, err = repository.ClaimByOperationKey(ctx, trusted.TenantCode, trusted.DeploymentCode, "people", operationKey, worker, time.Now().UTC(), peopleAssetsOffboardingLease)
		} else {
			claimed, err = repository.ClaimNext(ctx, trusted.TenantCode, trusted.DeploymentCode, "people", worker, time.Now().UTC(), peopleAssetsOffboardingLease)
		}
	} else {
		claimed, err = repository.ClaimByOperationKey(ctx, trusted.TenantCode, trusted.DeploymentCode, "people", strings.TrimSpace(operationKey), worker, time.Now().UTC(), peopleAssetsOffboardingLease)
	}
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "People operation lease is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	if claimed == nil {
		return nil, nil
	}
	if !validPeopleIntegrationOperation(claimed.Identity.TargetApp, claimed.Identity.OperationCode, claimed.RequiredCapability) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_identity_mismatch", "claimed People operation identity is invalid")
	}
	var command map[string]any
	if err := json.Unmarshal(claimed.Command, &command); err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": claimed.OperationID, "operationKey": claimed.OperationKey,
		"tenantCode": claimed.Identity.TenantCode, "deploymentCode": claimed.Identity.DeploymentCode,
		"sourceApp": "people", "targetApp": claimed.Identity.TargetApp, "operationCode": claimed.Identity.OperationCode,
		"requiredCapability": claimed.RequiredCapability, "idempotencyKey": claimed.Identity.IdempotencyKey,
		"commandSchemaVersion": claimed.CommandSchemaVersion, "commandSha256": claimed.Identity.CommandSHA256,
		"command": command, "fencingToken": claimed.FencingToken,
	}, nil
}

func (a *Adapter) nextPeopleOperationKeyForFamily(ctx context.Context, trusted integrationoperation.TrustedContext, family string) (string, error) {
	codes := []string{}
	switch family {
	case "assets-offboarding":
		codes = []string{peopleAssetsOffboardingOperationCode}
	case "directory-lifecycle":
		codes = []string{peopleDirectoryEmploymentOperation, peopleDirectoryOffboardingOperation}
	default:
		return "", httperror.New(http.StatusBadRequest, "integration_operation_family_invalid", "operation family is not allowlisted")
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(codes)), ",")
	args := []any{trusted.TenantCode, trusted.DeploymentCode}
	for _, code := range codes {
		args = append(args, code)
	}
	var key string
	// 依赖条件必须与 ClaimByOperationKey 的可领取判定保持一致。
	//
	// 2026-08-24 生产事故：本选择器只按 created_at 挑最旧一条且**不校验依赖**，
	// 而 claim 要求依赖 status='succeeded'。当最旧的那条依赖已进 dead_letter
	// （永远不可能变 succeeded）时，每轮都选中它、每轮都被 claim 拒绝，
	// 循环不会尝试下一条 —— 整个 family 队列被一条永久阻塞的操作**队头卡死**。
	// 实际后果：5 条完全健康的离职停用操作被卡了一个月，无重试、无告警。
	//
	// 选择器与 claim 若使用不同的可领取条件，必然出现"选中了永远领不走的那条"。
	err := a.DB().QueryRowContext(ctx, `SELECT o.operation_key FROM integration_operation o WHERE o.tenant_code=? AND o.deployment_code=? AND o.source_app='people' AND o.operation_code IN (`+placeholders+`) AND ((o.status IN ('pending','retry_wait','partial_unknown') AND o.next_attempt_at<=UTC_TIMESTAMP(3)) OR (o.status='processing' AND o.locked_until IS NOT NULL AND o.locked_until<=UTC_TIMESTAMP(3))) AND (o.depends_on_operation_key IS NULL OR EXISTS (SELECT 1 FROM integration_operation dependency WHERE dependency.tenant_code=o.tenant_code AND dependency.deployment_code=o.deployment_code AND dependency.source_app=o.source_app AND dependency.operation_key=o.depends_on_operation_key AND dependency.status='succeeded')) ORDER BY o.created_at,o.operation_id LIMIT 1`, args...).Scan(&key)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return key, err
}

func (a *Adapter) succeedPeopleIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	trusted, worker, operationID, fencingToken, err := peopleIntegrationCompletionIdentity(body)
	if err != nil {
		return nil, err
	}
	targetApp, operationCode, requiredCapability, command, err := a.validateLeasedPeopleIntegrationOperation(ctx, trusted, worker, operationID, operationKey, fencingToken)
	if err != nil {
		return nil, err
	}
	targetType, targetCode := peopleIntegrationExpectedTarget(operationCode, command, body)
	if targetCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "integration_operation_result_invalid", "targetBizCode is required")
	}
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	targetReceiptID := strings.TrimSpace(cleanBodyString(body, "targetReceiptId"))
	responseSummarySHA := strings.TrimSpace(cleanBodyString(body, "responseSummarySha256"))
	if err := integrationoperation.ValidateReceiptEvidence(
		integrationoperation.ReceiptEvidence{
			OperationID: operationID, OperationCode: operationCode,
			IdempotencyKey: operationKey, CommandSchemaVersion: "v1", CommandSHA256: commandSHA,
			TargetBizType: targetType, TargetBizCode: targetCode,
		},
		integrationoperation.ReceiptEvidence{
			ReceiptID:            targetReceiptID,
			OperationID:          strings.TrimSpace(cleanBodyString(body, "receiptOperationId")),
			OperationCode:        strings.TrimSpace(cleanBodyString(body, "receiptOperationCode")),
			IdempotencyKey:       strings.TrimSpace(cleanBodyString(body, "receiptIdempotencyKey")),
			CommandSchemaVersion: strings.TrimSpace(cleanBodyString(body, "receiptCommandSchemaVersion")),
			CommandSHA256:        strings.TrimSpace(cleanBodyString(body, "receiptCommandSha256")),
			TargetBizType:        strings.TrimSpace(cleanBodyString(body, "targetBizType")), TargetBizCode: targetCode,
			ResponseSummarySHA256: responseSummarySHA,
		},
	); err != nil {
		return nil, httperror.New(http.StatusConflict, "service_command_receipt_mismatch", "target receipt does not match the leased People operation")
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.RecordSuccess(ctx, integrationoperation.RecordSuccessInput{
		Lease: integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencingToken},
		Now:   time.Now().UTC(), HTTPStatus: http.StatusOK, TargetReceiptID: targetReceiptID,
		TargetBizType: targetType, TargetBizCode: targetCode, ResponseSummarySHA256: responseSummarySHA,
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "People operation lease is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": operationKey, "targetApp": targetApp, "requiredCapability": requiredCapability, "status": string(result.Status), "version": result.Version}, nil
}

func (a *Adapter) failPeopleIntegrationOperation(ctx context.Context, operationKey string, body map[string]any) (map[string]any, error) {
	trusted, worker, operationID, fencingToken, err := peopleIntegrationCompletionIdentity(body)
	if err != nil {
		return nil, err
	}
	if _, _, _, _, err := a.validateLeasedPeopleIntegrationOperation(ctx, trusted, worker, operationID, operationKey, fencingToken); err != nil {
		return nil, err
	}
	failure := integrationoperation.FailureInput{HTTPStatus: int(float64FromAny(body["httpStatus"]))}
	if body["timedOut"] == true {
		failure.Err = context.DeadlineExceeded
	} else if body["networkError"] == true {
		failure.Err = errors.New("network error")
	}
	switch strings.TrimSpace(cleanBodyString(body, "conflictDisposition")) {
	case "processing":
		failure.ConflictDisposition = integrationoperation.ConflictInProgress
	case "idempotent_success":
		failure.ConflictDisposition = integrationoperation.ConflictIdempotentExisting
	case "payload_mismatch", "binding_conflict", "permanent":
		failure.ConflictDisposition = integrationoperation.ConflictPermanent
	}
	repository, err := integrationoperation.NewRepository(a.DB())
	if err != nil {
		return nil, err
	}
	result, err := repository.RecordFailure(ctx, integrationoperation.RecordFailureInput{
		Lease: integrationoperation.CompletionLease{OperationID: operationID, Worker: worker, FencingToken: fencingToken},
		Now:   time.Now().UTC(), Failure: failure, ErrorCode: strings.TrimSpace(cleanBodyString(body, "errorCode")),
		ErrorSummary: strings.TrimSpace(cleanBodyString(body, "errorSummary")), DeliveryUncertain: body["deliveryUncertain"] == true,
	})
	if errors.Is(err, integrationoperation.ErrOperationNotFound) || errors.Is(err, integrationoperation.ErrPersistenceRace) {
		return nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "People operation lease is stale or conflicts with existing evidence")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": operationKey, "status": string(result.Status), "version": result.Version}, nil
}

func peopleIntegrationCompletionIdentity(body map[string]any) (integrationoperation.TrustedContext, string, string, uint64, error) {
	if err := requirePeopleIntegrationOperationScope(body); err != nil {
		return integrationoperation.TrustedContext{}, "", "", 0, err
	}
	trusted, worker, err := trustedPeopleIntegrationWorker(body)
	if err != nil {
		return integrationoperation.TrustedContext{}, "", "", 0, err
	}
	operationID := strings.TrimSpace(cleanBodyString(body, "operationId"))
	fencingToken, err := strconv.ParseUint(strings.TrimSpace(fmt.Sprint(body["fencingToken"])), 10, 64)
	if !integrationoperation.IsValidOperationID(operationID) || err != nil || fencingToken == 0 {
		return integrationoperation.TrustedContext{}, "", "", 0, httperror.New(http.StatusBadRequest, "integration_operation_lease_invalid", "operationId and fencingToken are required")
	}
	return trusted, worker, operationID, fencingToken, nil
}

func (a *Adapter) validateLeasedPeopleIntegrationOperation(ctx context.Context, trusted integrationoperation.TrustedContext, worker, operationID, operationKey string, fencingToken uint64) (string, string, string, map[string]any, error) {
	var targetApp, operationCode, requiredCapability string
	var commandJSON []byte
	err := a.DB().QueryRowContext(ctx, `SELECT target_app,operation_code,required_capability,command_json FROM integration_operation WHERE operation_id=? AND operation_key=? AND tenant_code=? AND deployment_code=? AND source_app='people' AND status='processing' AND locked_by=? AND fencing_token=? LIMIT 1`, operationID, operationKey, trusted.TenantCode, trusted.DeploymentCode, worker, fencingToken).Scan(&targetApp, &operationCode, &requiredCapability, &commandJSON)
	if err != nil || !validPeopleIntegrationOperation(targetApp, operationCode, requiredCapability) {
		return "", "", "", nil, httperror.New(http.StatusConflict, "integration_operation_lease_stale", "People operation lease is stale")
	}
	var command map[string]any
	if err := json.Unmarshal(commandJSON, &command); err != nil {
		return "", "", "", nil, httperror.New(http.StatusConflict, "integration_operation_command_invalid", "stored People operation command is invalid")
	}
	return targetApp, operationCode, requiredCapability, command, nil
}

func validPeopleIntegrationOperation(targetApp, operationCode, capability string) bool {
	switch operationCode {
	case peopleAssetsOffboardingOperationCode:
		return targetApp == "assets" && capability == peopleAssetsOffboardingCapability
	case peopleDirectoryEmploymentOperation:
		return targetApp == "console" && capability == peopleDirectoryEmploymentCapability
	case peopleDirectoryOffboardingOperation:
		return targetApp == "console" && capability == peopleDirectoryOffboardingCapability
	default:
		return false
	}
}

func peopleIntegrationExpectedTarget(operationCode string, command, body map[string]any) (string, string) {
	if operationCode == peopleAssetsOffboardingOperationCode {
		return "offboarding_recovery_case", strings.TrimSpace(cleanBodyString(body, "targetBizCode"))
	}
	return "directory_user", strings.TrimSpace(cleanBodyString(command, "employeeUid"))
}

func trustedPeopleIntegrationWorker(body map[string]any) (integrationoperation.TrustedContext, string, error) {
	trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
	if err != nil || trusted.ServiceClientID == "" || trusted.RequestID == "" {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People integration operation worker context is required")
	}
	worker := "people:" + trusted.ServiceClientID + ":" + trusted.RequestID
	if len(worker) > 240 {
		return integrationoperation.TrustedContext{}, "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "People integration worker identity is too long")
	}
	return trusted, worker, nil
}

func requirePeopleIntegrationOperationScope(body map[string]any) error {
	for _, scope := range peopleScopeStrings(body["current_user_scopes"]) {
		if scope == "*" || scope == "people.*" || scope == "people:integration_operation:execute" {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "insufficient_scope", "people:integration_operation:execute scope is required")
}

func peopleScopeStrings(value any) []string {
	var values []string
	switch typed := value.(type) {
	case string:
		values = strings.FieldsFunc(typed, func(r rune) bool { return r == ',' || r == ' ' })
	case []string:
		values = typed
	case []any:
		for _, item := range typed {
			values = append(values, fmt.Sprint(item))
		}
	}
	return values
}

func nullablePeopleText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
