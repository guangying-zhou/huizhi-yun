package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	altocInvoiceRequestOperationCode = "altoc.receivable.finance-invoice-request.v1"
	altocInvoiceRequestCapability    = "finance:invoice-request:create"
)

func enqueueReceivableInvoiceRequestOperationTx(ctx context.Context, tx *sql.Tx, plan, invoiceRequest map[string]any, operationKey, actor string, body map[string]any) (map[string]any, error) {
	trusted, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Altoc operation context is required")
	}
	operationKey = strings.TrimSpace(operationKey)
	planCode := strings.TrimSpace(firstNonEmptyText(firstBodyText(plan, "code")))
	command := map[string]any{
		"receivablePlanCode": planCode, "actorUid": strings.TrimSpace(actor),
		"idempotencyKey": operationKey, "invoiceRequest": invoiceRequest,
	}
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	var existingID, existingCode, existingCapability, existingHash, status string
	err = tx.QueryRowContext(ctx, `SELECT operation_id,operation_code,required_capability,command_sha256,status FROM integration_operation WHERE tenant_code=? AND deployment_code=? AND source_app='altoc' AND operation_key=? FOR UPDATE`, trusted.TenantCode, trusted.DeploymentCode, operationKey).Scan(&existingID, &existingCode, &existingCapability, &existingHash, &status)
	if err == nil {
		if existingCode != altocInvoiceRequestOperationCode || existingCapability != altocInvoiceRequestCapability || existingHash != commandSHA {
			return nil, httperror.New(http.StatusConflict, "integration_operation_payload_mismatch", "invoice operation identity was reused with different trusted evidence")
		}
		return map[string]any{"operationId": existingID, "operationKey": operationKey, "status": status, "created": false}, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	createdBy := strings.TrimSpace(actor)
	if createdBy == "" {
		createdBy = trusted.ServiceClientID
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO integration_operation (
	  operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,
	  operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,
	  command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by, next_attempt_at) VALUES (?,?,?,1,?,?,'altoc','finance',?,?,'receivable_plan',?,?,'v1',?,?,'pending',?,?,?,?,?, UTC_TIMESTAMP(3))`,
		operationID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode,
		altocInvoiceRequestOperationCode, altocInvoiceRequestCapability, planCode, operationKey, string(commandJSON), commandSHA,
		nullableText(trusted.RequestID), nullableText(actor), nullableText(trusted.ServiceClientID), nullableText(createdBy), nullableText(createdBy))
	if err != nil {
		return nil, err
	}
	return map[string]any{"operationId": operationID, "operationKey": operationKey, "status": "pending", "created": true}, nil
}

// nextReceivableInvoiceRequestKeyTx 推导回款计划开票申请的幂等键。
//
// 走查 ISSUE-B-006：原实现用每计划固定的 `...:invoice-request:v1`，而申请金额
// 默认取会随到账变化的 unreceived_amount，且前端不传 Idempotency-Key。于是
// 第二次申请开票必然失败——金额变了就撞 command_sha256 校验返回 409
// integration_operation_payload_mismatch，金额没变则返回已有 succeeded 记录，
// 前端提示「已创建」但实际什么都没发生。这与产品意图直接冲突：runtime 与前端
// 都明确允许 partially_received 状态再次申请开票，即支持分次开票。
//
// 序号只在 operation 进入终态后递进：
//   - 在途（pending/processing/retry_wait/partial_unknown）沿用同一序号，
//     所以重复点击仍是幂等重放，不会产生第二张开票申请；
//   - 已终结（succeeded/failed_permanent/dead_letter/cancelled）后递进，
//     所以分次开票和「永久失败后改正重试」都能发出新的申请。
func nextReceivableInvoiceRequestKeyTx(ctx context.Context, tx *sql.Tx, body map[string]any, receivablePlanCode string) (string, error) {
	trusted, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil {
		return "", httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Altoc operation context is required")
	}
	var settled int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM integration_operation
		WHERE tenant_code = ? AND deployment_code = ? AND source_app = 'altoc'
		  AND operation_code = ? AND source_biz_type = 'receivable_plan' AND source_biz_code = ?
		  AND status IN ('succeeded','failed_permanent','dead_letter','cancelled')
	`, trusted.TenantCode, trusted.DeploymentCode, altocInvoiceRequestOperationCode, receivablePlanCode).Scan(&settled); err != nil {
		return "", err
	}

	// 首次申请优先复用历史固定键，避免已有 `:v1` 记录被当成新申请重复投递。
	if settled == 0 {
		legacyKey := fmt.Sprintf("altoc:receivable:%s:invoice-request:v1", receivablePlanCode)
		var exists int
		err := tx.QueryRowContext(ctx, `
			SELECT 1 FROM integration_operation
			WHERE tenant_code = ? AND deployment_code = ? AND source_app = 'altoc' AND operation_key = ?
			LIMIT 1
		`, trusted.TenantCode, trusted.DeploymentCode, legacyKey).Scan(&exists)
		if err == nil {
			return legacyKey, nil
		}
		if err != sql.ErrNoRows {
			return "", err
		}
	}

	return fmt.Sprintf("altoc:receivable:%s:invoice-request:%d", receivablePlanCode, settled+1), nil
}
