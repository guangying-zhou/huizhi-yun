package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) ApplyConnectorPeopleBatch(ctx context.Context, body map[string]any, items []map[string]any, candidates []map[string]any, skipped int, trustedContext ...integrationoperation.TrustedContext) (map[string]any, error) {
	jobID := cleanBodyString(body, "jobId")
	provider := cleanBodyString(body, "provider")
	integrationCode := cleanBodyString(body, "integrationCode")
	batchNumber := intValue(body["batchNumber"])
	final, _ := body["final"].(bool)
	if jobID == "" || len(jobID) > 128 || provider != "dingtalk" || integrationCode != "dingtalk.default" || batchNumber < 1 {
		return nil, httperror.New(http.StatusBadRequest, "connector_people_batch_invalid", "Connector People batch identity is invalid")
	}
	encoded, _ := json.Marshal(body)
	digest := sha256.Sum256(encoded)
	batchHash := hex.EncodeToString(digest[:])
	var existingHash, status string
	var existingApplied, existingSkipped int
	err := a.DB().QueryRowContext(ctx, `SELECT batch_hash,status,applied_count,skipped_count FROM people_connector_sync_receipts WHERE job_id=? AND batch_number=?`, jobID, batchNumber).Scan(&existingHash, &status, &existingApplied, &existingSkipped)
	switch {
	case err == nil:
		if existingHash != batchHash {
			return nil, httperror.New(http.StatusConflict, "connector_people_batch_conflict", "People sync batch was replayed with different content")
		}
		if status == "success" {
			return map[string]any{"applied": existingApplied, "skipped": existingSkipped, "replayed": true, "final": final}, nil
		}
		if status == "processing" {
			return nil, httperror.New(http.StatusConflict, "connector_people_batch_in_progress", "People sync batch is already processing")
		}
		if _, err = a.DB().ExecContext(ctx, `UPDATE people_connector_sync_receipts SET status='processing',error_message=NULL,updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=? AND batch_number=?`, jobID, batchNumber); err != nil {
			return nil, err
		}
	case errors.Is(err, sql.ErrNoRows):
		if _, err = a.DB().ExecContext(ctx, `INSERT INTO people_connector_sync_receipts (job_id,batch_number,batch_hash,provider_code,integration_code,status,received_at) VALUES (?,?,?,?,?,'processing',CURRENT_TIMESTAMP(3))`, jobID, batchNumber, batchHash, provider, integrationCode); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	applied := 0
	if len(items) > 0 {
		raw := make([]any, 0, len(items))
		for _, item := range items {
			raw = append(raw, item)
		}
		syncBody := map[string]any{
			"source_app": "connector-runtime", "source_biz_type": "dingtalk_hr_employee",
			"create_assignments": true, "freeze_directory_lifecycle": len(trustedContext) == 1,
			"effective_from": strings.TrimSpace(cleanBodyString(body, "watermark"))[:minLen(cleanBodyString(body, "watermark"), 10)],
			"items":          raw,
		}
		if len(trustedContext) == 1 {
			trusted := trustedContext[0]
			syncBody[integrationoperation.TrustedTenantCodeKey] = trusted.TenantCode
			syncBody[integrationoperation.TrustedDeploymentCodeKey] = trusted.DeploymentCode
			syncBody[integrationoperation.TrustedSourceAppKey] = trusted.SourceApp
			syncBody[integrationoperation.TrustedServiceClientIDKey] = trusted.ServiceClientID
			syncBody[integrationoperation.TrustedRequestIDKey] = trusted.RequestID
		}
		result, syncErr := a.syncDirectoryUsers(ctx, syncBody)
		if syncErr != nil {
			_, _ = a.DB().ExecContext(ctx, `UPDATE people_connector_sync_receipts SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=? AND batch_number=?`, safeConnectorError(syncErr.Error()), jobID, batchNumber)
			return nil, syncErr
		}
		applied = intValue(result["synced"])
	}
	// 入职候选不是员工：它们只更新候选单，不计入 applied，也不参与任职、
	// 成本、绩效或权限范围计算。
	candidatesApplied, err := a.upsertOnboardingCandidates(ctx, candidates, cleanBodyString(body, "watermark"))
	if err != nil {
		_, _ = a.DB().ExecContext(ctx, `UPDATE people_connector_sync_receipts SET status='failed',error_message=?,updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=? AND batch_number=?`, safeConnectorError(err.Error()), jobID, batchNumber)
		return nil, err
	}
	_, err = a.DB().ExecContext(ctx, `UPDATE people_connector_sync_receipts SET status='success',applied_count=?,skipped_count=?,is_final=?,finished_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE job_id=? AND batch_number=?`, applied, skipped, final, jobID, batchNumber)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"applied": applied, "skipped": skipped, "replayed": false, "final": final,
		"onboardingCandidates": candidatesApplied,
	}, nil
}

func intValue(value any) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	default:
		return 0
	}
}
func minLen(value string, n int) int {
	if len(value) < n {
		return len(value)
	}
	return n
}
func safeConnectorError(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 500 {
		return value[:500]
	}
	return value
}
