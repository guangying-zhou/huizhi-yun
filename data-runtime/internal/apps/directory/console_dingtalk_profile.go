package directory

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	consoleDingTalkProfileOperation  = "connector-runtime.console.dingtalk-directory-profile-sync.v1"
	consoleDingTalkProfileCapability = "console:directory-profiles:sync"
)

var consoleDingTalkJobPattern = regexp.MustCompile(`^crj_[A-Za-z0-9_-]{20,64}$`)
var consoleDirectoryEmailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

type consoleDingTalkProfileUser struct {
	ProviderSubject string
	Email           string
	Name            string
}

type consoleDingTalkProfileBatch struct {
	JobID       string
	BatchNumber int64
	Final       bool
	Users       []consoleDingTalkProfileUser
}

type consoleDingTalkProfileResult struct {
	JobCode  string `json:"jobCode"`
	Updated  int64  `json:"updated"`
	Skipped  int64  `json:"skipped"`
	Final    bool   `json:"final"`
	Replayed bool   `json:"replayed"`
}

func (a *Adapter) ConsoleRegisterDingTalkProfileJob(
	ctx context.Context,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	if len(body) != 1 {
		return nil, httperror.New(http.StatusBadRequest, "dingtalk_job_request_invalid", "Only jobCode is accepted")
	}
	jobCode := text(body["jobCode"])
	if !consoleDingTalkJobPattern.MatchString(jobCode) {
		return nil, httperror.New(http.StatusBadRequest, "dingtalk_job_invalid", "DingTalk Directory jobCode is invalid")
	}
	payload := map[string]any{"jobCode": jobCode}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.sync.dingtalk.register", meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_sync_jobs
		(job_code,provider_code,sync_type,object_scope,status,requested_by,started_at,created_at,updated_at)
		VALUES (?,'dingtalk','manual','users','pending',?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE requested_by=COALESCE(requested_by,VALUES(requested_by)),
			updated_at=UTC_TIMESTAMP()`, jobCode, meta.ActorID); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{
		"jobCode": jobCode, "providerCode": "dingtalk", "syncType": "manual",
		"objectScope": "users", "status": "pending",
	}}
	err = finishConsoleMutation(ctx, session, "directory.sync.dingtalk.register",
		"directory_sync_job", jobCode, map[string]any{"jobCode": jobCode}, result)
	return result, err
}

func (a *Adapter) ConsoleApplyDingTalkProfileCommand(
	ctx context.Context,
	kind string,
	body map[string]any,
) (map[string]any, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body,
		"console",
		consoleDingTalkProfileOperation,
		consoleDingTalkProfileCapability,
	)
	if err != nil {
		return nil, consoleLifecycleReceiptError(err)
	}
	serviceContext, err := integrationoperation.TrustedServiceCommandContextFromMap(body)
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "service_command_context_invalid", "trusted Connector Runtime command context is invalid")
	}
	if receiptInput.TrustedContext.SourceApp != "connector-runtime" ||
		serviceContext.SourceApp != "connector-runtime" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be Connector Runtime")
	}
	if serviceContext.TargetApp != "console" || serviceContext.TargetDeploymentCode == "" {
		return nil, httperror.New(http.StatusForbidden, "service_command_target_forbidden", "service command target must be the enrolled Console deployment")
	}
	if a.tenant != "" && receiptInput.TrustedContext.TenantCode != a.tenant {
		return nil, httperror.New(http.StatusForbidden, "service_command_tenant_mismatch", "DingTalk profile command tenant does not match this Runtime")
	}
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	var parsedBatch consoleDingTalkProfileBatch
	var failureMessage string
	switch kind {
	case "batch":
		parsedBatch, err = parseConsoleDingTalkProfileBatch(command)
		if err == nil {
			expected := fmt.Sprintf("connector-runtime:dingtalk-directory-profile:%s:%d:v1", parsedBatch.JobID, parsedBatch.BatchNumber)
			if receiptInput.IdempotencyKey != expected {
				err = httperror.New(http.StatusConflict, "idempotency_key_mismatch", "DingTalk Directory batch idempotency key does not match")
			}
		}
	case "failure":
		parsedBatch.JobID, failureMessage, err = parseConsoleDingTalkProfileFailure(command)
		if err == nil {
			expected := fmt.Sprintf("connector-runtime:dingtalk-directory-profile:%s:failure:v1", parsedBatch.JobID)
			if receiptInput.IdempotencyKey != expected {
				err = httperror.New(http.StatusConflict, "idempotency_key_mismatch", "DingTalk Directory failure idempotency key does not match")
			}
		}
	default:
		err = httperror.New(http.StatusNotFound, "not_found", "DingTalk Directory profile command route does not exist")
	}
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result := consoleDingTalkProfileResult{JobCode: parsedBatch.JobID, Final: true}
		if kind == "batch" {
			result, err = applyConsoleDingTalkProfileBatchTx(
				ctx, tx, parsedBatch, receiptInput.TrustedContext.ServiceClientID,
			)
		} else {
			err = applyConsoleDingTalkProfileFailureTx(
				ctx, tx, parsedBatch.JobID, receiptInput.TrustedContext.ServiceClientID, failureMessage,
			)
		}
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		summary, digestErr := integrationoperation.ValidateAndDigestCommand(result)
		if digestErr != nil {
			return integrationoperation.ReceiptBusinessResult{}, digestErr
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "directory_sync_job_batch",
			TargetBizCode: encodeConsoleDingTalkProfileResult(result),
			HTTPStatus:    http.StatusOK, ResponseSummarySHA256: summary, Value: result,
		}, nil
	})
	if err != nil {
		return nil, consoleLifecycleReceiptError(err)
	}
	result, ok := executed.Value.(consoleDingTalkProfileResult)
	if !ok {
		result, err = decodeConsoleDingTalkProfileResult(executed.TargetBizCode)
		if err != nil {
			return nil, err
		}
		result.Replayed = true
	}
	// This command is deliberately name-only. Platform's subject projection
	// contains identity codes, status and memberships, but no display or real
	// name, so rebuilding it here cannot change Platform authorization data.
	// Keeping the receipt synchronous and bounded also avoids reporting a
	// completed name update as failed while an unrelated projection is slow.
	return map[string]any{
		"receiptId":     executed.ReceiptID,
		"receiptStatus": "succeeded",
		"idempotent":    executed.Existing,
		"result":        result,
	}, nil
}

func parseConsoleDingTalkProfileBatch(command map[string]any) (consoleDingTalkProfileBatch, error) {
	if err := assertConsoleDingTalkProfileProvider(command); err != nil {
		return consoleDingTalkProfileBatch{}, err
	}
	jobID := text(command["jobId"])
	if !consoleDingTalkJobPattern.MatchString(jobID) {
		return consoleDingTalkProfileBatch{}, httperror.New(http.StatusBadRequest, "dingtalk_job_invalid", "DingTalk Directory jobId is invalid")
	}
	batchNumber, ok := consoleDingTalkPositiveInt(command["batchNumber"])
	if !ok || batchNumber > 1_000_000 {
		return consoleDingTalkProfileBatch{}, httperror.New(http.StatusBadRequest, "dingtalk_batch_invalid", "DingTalk Directory batchNumber is invalid")
	}
	rawUsers, ok := command["users"].([]any)
	if !ok && command["users"] != nil {
		return consoleDingTalkProfileBatch{}, httperror.New(http.StatusBadRequest, "dingtalk_users_invalid", "DingTalk Directory users must be an array")
	}
	if len(rawUsers) > 100 {
		return consoleDingTalkProfileBatch{}, httperror.New(http.StatusRequestEntityTooLarge, "dingtalk_batch_too_large", "DingTalk Directory batch accepts at most 100 users")
	}
	users := make([]consoleDingTalkProfileUser, 0, len(rawUsers))
	for _, raw := range rawUsers {
		value, _ := raw.(map[string]any)
		email := strings.ToLower(safeText(text(value["email"]), 255))
		if !consoleDirectoryEmailPattern.MatchString(email) {
			email = ""
		}
		users = append(users, consoleDingTalkProfileUser{
			ProviderSubject: safeText(text(value["providerSubject"]), 255),
			Email:           email,
			Name:            safeText(text(value["name"]), 255),
		})
	}
	final, _ := command["final"].(bool)
	return consoleDingTalkProfileBatch{
		JobID: jobID, BatchNumber: batchNumber, Final: final, Users: users,
	}, nil
}

func parseConsoleDingTalkProfileFailure(command map[string]any) (string, string, error) {
	if err := assertConsoleDingTalkProfileProvider(command); err != nil {
		return "", "", err
	}
	jobID := text(command["jobId"])
	if !consoleDingTalkJobPattern.MatchString(jobID) {
		return "", "", httperror.New(http.StatusBadRequest, "dingtalk_job_invalid", "DingTalk Directory jobId is invalid")
	}
	message := safeText(text(command["errorMessage"]), 1000)
	if message == "" {
		message = "Connector Runtime DingTalk Directory sync failed"
	}
	return jobID, message, nil
}

func assertConsoleDingTalkProfileProvider(command map[string]any) error {
	if strings.ToLower(text(command["provider"])) != "dingtalk" ||
		text(command["integrationCode"]) != "dingtalk.default" {
		return httperror.New(http.StatusConflict, "dingtalk_provider_mismatch", "DingTalk Directory provider or integrationCode does not match")
	}
	return nil
}

func applyConsoleDingTalkProfileBatchTx(
	ctx context.Context,
	tx *sql.Tx,
	batch consoleDingTalkProfileBatch,
	serviceClientID string,
) (consoleDingTalkProfileResult, error) {
	if _, err := tx.ExecContext(ctx, `INSERT IGNORE INTO directory_sync_jobs
		(job_code,provider_code,sync_type,object_scope,status,requested_by,started_at,created_at,updated_at)
		VALUES (?,'dingtalk','manual','users','running',?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		batch.JobID, nullableConsoleText(serviceClientID)); err != nil {
		return consoleDingTalkProfileResult{}, err
	}
	emailCounts := map[string]int{}
	for _, user := range batch.Users {
		if user.Email != "" {
			emailCounts[user.Email]++
		}
	}
	uniqueEmails := make([]string, 0)
	for email, count := range emailCounts {
		if count == 1 {
			uniqueEmails = append(uniqueEmails, email)
		}
	}
	type matchedUser struct {
		uid, displayName, realName string
	}
	matches := map[string][]matchedUser{}
	if len(uniqueEmails) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(uniqueEmails)), ",")
		args := make([]any, len(uniqueEmails))
		for index := range uniqueEmails {
			args[index] = uniqueEmails[index]
		}
		rows, err := tx.QueryContext(ctx, `SELECT uid,LOWER(TRIM(email)),COALESCE(display_name,''),COALESCE(real_name,'')
			FROM directory_users WHERE LOWER(TRIM(email)) IN (`+placeholders+`) FOR UPDATE`, args...)
		if err != nil {
			return consoleDingTalkProfileResult{}, err
		}
		for rows.Next() {
			var uid, email, displayName, realName string
			if err := rows.Scan(&uid, &email, &displayName, &realName); err != nil {
				rows.Close()
				return consoleDingTalkProfileResult{}, err
			}
			matches[email] = append(matches[email], matchedUser{uid, displayName, realName})
		}
		if err := rows.Close(); err != nil {
			return consoleDingTalkProfileResult{}, err
		}
		if err := rows.Err(); err != nil {
			return consoleDingTalkProfileResult{}, err
		}
	}
	var updated, skipped int64
	for _, user := range batch.Users {
		objectCode := user.ProviderSubject
		if objectCode == "" {
			objectCode = "__missing_subject__"
		}
		status, changeType, message := "skipped", "skip", ""
		var beforeHash, afterHash any
		if user.Email == "" || user.Name == "" {
			if user.Email == "" {
				message = "DingTalk user has no valid email"
			} else {
				message = "DingTalk user has no valid name"
			}
			skipped++
		} else if emailCounts[user.Email] != 1 {
			message = "DingTalk batch contains duplicate email"
			skipped++
		} else if len(matches[user.Email]) != 1 {
			if len(matches[user.Email]) == 0 {
				message = "Console Directory user was not found by email"
			} else {
				message = "Console Directory email is not unique"
			}
			skipped++
		} else {
			target := matches[user.Email][0]
			objectCode = target.uid
			if target.displayName == user.Name && target.realName == user.Name {
				message = "Directory name is already current"
				skipped++
			} else {
				beforeHash, _ = integrationoperation.ValidateAndDigestCommand(map[string]any{
					"displayName": target.displayName, "realName": target.realName,
				})
				afterHash, _ = integrationoperation.ValidateAndDigestCommand(map[string]any{
					"displayName": user.Name, "realName": user.Name,
				})
				if _, err := tx.ExecContext(ctx, `UPDATE directory_users
					SET display_name=?,real_name=?,updated_at=UTC_TIMESTAMP() WHERE uid=?`,
					user.Name, user.Name, target.uid); err != nil {
					return consoleDingTalkProfileResult{}, err
				}
				status, changeType, message = "success", "update", "Updated names by unique email match"
				updated++
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO directory_sync_events
			(job_code,object_type,object_code,change_type,source_provider,external_ref,status,message,before_hash,after_hash,created_at)
			VALUES (?,'user',?,?,'dingtalk',?,?,?,?,?,UTC_TIMESTAMP())`,
			batch.JobID, objectCode, changeType, nullableConsoleText(user.ProviderSubject),
			status, message, beforeHash, afterHash); err != nil {
			return consoleDingTalkProfileResult{}, err
		}
	}
	jobStatus := "running"
	if batch.Final {
		jobStatus = "success"
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_sync_jobs
		SET status=?,finished_at=CASE WHEN ? THEN UTC_TIMESTAMP() ELSE finished_at END,
			total_count=total_count+?,updated_count=updated_count+?,skipped_count=skipped_count+?,
			error_count=0,error_message=NULL,updated_at=UTC_TIMESTAMP()
		WHERE job_code=?`, jobStatus, batch.Final, len(batch.Users), updated, skipped, batch.JobID); err != nil {
		return consoleDingTalkProfileResult{}, err
	}
	return consoleDingTalkProfileResult{
		JobCode: batch.JobID, Updated: updated, Skipped: skipped, Final: batch.Final,
	}, nil
}

func applyConsoleDingTalkProfileFailureTx(
	ctx context.Context,
	tx *sql.Tx,
	jobID string,
	serviceClientID string,
	message string,
) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO directory_sync_jobs
		(job_code,provider_code,sync_type,object_scope,status,requested_by,started_at,finished_at,
		 error_count,error_message,created_at,updated_at)
		VALUES (?,'dingtalk','manual','users','failed',?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),1,?,
		 UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE status='failed',finished_at=UTC_TIMESTAMP(),error_count=1,
		 error_message=VALUES(error_message),updated_at=UTC_TIMESTAMP()`,
		jobID, nullableConsoleText(serviceClientID), message)
	return err
}

func encodeConsoleDingTalkProfileResult(result consoleDingTalkProfileResult) string {
	return fmt.Sprintf("%s:%d:%d:%t", result.JobCode, result.Updated, result.Skipped, result.Final)
}

func decodeConsoleDingTalkProfileResult(value string) (consoleDingTalkProfileResult, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 4 || !consoleDingTalkJobPattern.MatchString(parts[0]) {
		return consoleDingTalkProfileResult{}, httperror.New(http.StatusConflict, "receipt_result_invalid", "DingTalk Directory receipt result is invalid")
	}
	updated, updatedErr := strconv.ParseInt(parts[1], 10, 64)
	skipped, skippedErr := strconv.ParseInt(parts[2], 10, 64)
	final, finalErr := strconv.ParseBool(parts[3])
	if updatedErr != nil || skippedErr != nil || finalErr != nil || updated < 0 || skipped < 0 {
		return consoleDingTalkProfileResult{}, httperror.New(http.StatusConflict, "receipt_result_invalid", "DingTalk Directory receipt result is invalid")
	}
	return consoleDingTalkProfileResult{
		JobCode: parts[0], Updated: updated, Skipped: skipped, Final: final,
	}, nil
}

func consoleDingTalkPositiveInt(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		integer := int64(typed)
		return integer, typed == float64(integer) && integer > 0
	case int64:
		return typed, typed > 0
	case int:
		return int64(typed), typed > 0
	default:
		return 0, false
	}
}
