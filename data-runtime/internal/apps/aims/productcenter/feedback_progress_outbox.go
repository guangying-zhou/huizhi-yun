package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Caller holds the workspace lock and owns the business transaction and revision.
// Freeze a distinct immutable progress operation; never rewrite status.v1 commands.
// Every original feedback binding keeps its own target request identity.
func enqueueFeedbackProgressTx(ctx context.Context, tx *sql.Tx, trusted integrationoperation.TrustedContext, actor, product string, requestID int64, revision uint64) error {
	rows, err := tx.QueryContext(ctx, `WITH RECURSIVE request_family AS (SELECT id FROM product_requests WHERE product_code=? AND id=? UNION DISTINCT SELECT r.id FROM product_requests r INNER JOIN request_family f ON r.merged_into_id=f.id WHERE r.product_code=?) SELECT b.source_biz_id,r.biz_id FROM product_feedback_bindings b INNER JOIN request_family f ON f.id=b.request_id INNER JOIN product_requests r ON r.id=b.request_id AND r.product_code=b.product_code WHERE b.product_code=? AND b.source_app='altoc' AND b.source_type='service_ticket'`, product, requestID, product, product)
	if err != nil {
		return err
	}
	type source struct{ ticket, id string }
	sources := []source{}
	for rows.Next() {
		var item source
		if err := rows.Scan(&item.ticket, &item.id); err != nil {
			rows.Close()
			return err
		}
		sources = append(sources, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(sources) == 0 {
		return nil
	}
	operationTable, tableErr := trusted.OperationTable()
	if tableErr != nil {
		return invalid("feedback_outbox_context_invalid", "反馈发件箱表映射无效")
	}
	if trusted.SourceApp != "aims" || trusted.TenantCode == "" || trusted.DeploymentCode == "" || actor == "" || revision == 0 || revision > 9007199254740991 {
		return invalid("feedback_outbox_context_invalid", "反馈状态需要可信来源与产品修订")
	}
	progress, err := readFeedbackProgressTx(ctx, tx, product, requestID)
	if err != nil {
		return err
	}
	if len(progress.Versions) > 1000 {
		return invalid("feedback_progress_limit", "反馈进度关联版本超过上限")
	}
	canonicalID, status := progress.CanonicalRequestBizID, progress.CanonicalDecisionStatus
	for _, item := range sources {
		itemStatus := status
		if item.id != canonicalID {
			itemStatus = "merged"
		}
		if (itemStatus == "merged") != (item.id != canonicalID) {
			return invalid("feedback_outbox_canonical_invalid", "合并引用与反馈决定不一致")
		}
		command := map[string]any{"ticketCode": item.ticket, "productCode": product, "requestBizId": item.id, "canonicalRequestBizId": canonicalID, "decisionStatus": itemStatus, "sourceRevision": revision, "canonicalDecisionStatus": status, "versions": progress.Versions}
		// Normalize typed nested structs into JSON objects before canonical hashing.
		// Receivers reconstruct the wire payload as maps, whose keys are sorted.
		wire, err := json.Marshal(command)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(wire, &command); err != nil {
			return err
		}
		hash, err := integrationoperation.ValidateAndDigestCommand(command)
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(command)
		if err != nil {
			return err
		}
		key := fmt.Sprintf("aims:product-feedback:progress:%s:%d", item.id, revision)
		_, err = tx.ExecContext(ctx, `INSERT INTO `+operationTable+`(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_actor_uid) VALUES(?,?,?,?,?,'aims','altoc','aims.altoc.product-feedback.update-progress.v1','altoc:product-feedback:update-progress','product_request',?,?,'product-feedback-progress.v1',?,?,'pending',UTC_TIMESTAMP(3),?)`, uuid.NewString(), key, key, trusted.TenantCode, trusted.DeploymentCode, item.id, key, string(encoded), hash, actor)
		if err != nil {
			return err
		}
	}
	return nil
}
