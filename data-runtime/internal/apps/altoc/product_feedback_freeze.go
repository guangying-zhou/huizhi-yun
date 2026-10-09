package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) freezeServiceTicketProductFeedback(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "service_ticket", "edit"); err != nil {
		return nil, err
	}
	actor := strings.TrimSpace(firstBodyText(body, "current_user"))
	expected := firstBodyText(body, "expectedSourceSha256")
	if actor == "" || altocActor(body) != actor || len(altocActorScopes(body)) == 0 || len(expected) != 64 {
		return nil, httperror.New(http.StatusBadRequest, "product_feedback_input_invalid", "actor and expected source digest are required")
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil {
		return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Altoc context is required")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ticket, err := altocQueryOneMap(ctx, tx, `SELECT st.* FROM service_ticket st INNER JOIN customer cu ON cu.id=st.customer_id AND cu.deleted_at IS NULL WHERE st.code=? AND st.deleted_at IS NULL LIMIT 1 FOR UPDATE`, ticketCode)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}
	if err := altocRequireRecordWrite(body, "service_ticket", ticket, "owner_user_id", ""); err != nil {
		return nil, err
	}
	var submission, requestID, product, operationID, status string
	err = tx.QueryRowContext(ctx, `SELECT f.submission_id,f.request_biz_id,f.product_code,f.operation_id,o.status FROM service_ticket_product_feedback f INNER JOIN integration_operation o ON o.operation_id=f.operation_id AND o.tenant_code=? AND o.deployment_code=? AND o.source_app='altoc' AND o.target_app='aims' AND o.operation_code=? WHERE f.ticket_id=? FOR UPDATE`, trusted.TenantCode, trusted.DeploymentCode, altocProductFeedbackOperation, ticket["id"]).Scan(&submission, &requestID, &product, &operationID, &status)
	created := false
	if err == sql.ErrNoRows {
		snapshot, digest, snapshotErr := altocProductFeedbackSnapshot(ticket)
		if snapshotErr != nil {
			return nil, snapshotErr
		}
		if digest != expected {
			return nil, httperror.New(http.StatusConflict, "product_feedback_source_changed", "ticket changed; reload before submitting")
		}
		for _, dest := range []*string{&submission, &requestID, &operationID} {
			*dest, err = integrationoperation.NewOperationID()
			if err != nil {
				return nil, err
			}
		}
		product = snapshot["productCode"].(string)
		command := map[string]any{"actorUid": actor, "productCode": product, "ticketCode": snapshot["ticketCode"], "requestBizId": requestID, "title": snapshot["title"], "description": snapshot["description"], "action": "create"}
		hash, err := integrationoperation.ValidateAndDigestCommand(command)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(command)
		if err != nil {
			return nil, err
		}
		key := "altoc:product-feedback:create:" + submission
		_, err = tx.ExecContext(ctx, `INSERT INTO integration_operation (operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by,next_attempt_at) VALUES (?,?,?,1,?,?,'altoc','aims',?,?,'service_ticket',?,?,?,?,?,'pending',?,?,?,?,?,UTC_TIMESTAMP(3))`, operationID, key, key, trusted.TenantCode, trusted.DeploymentCode, altocProductFeedbackOperation, altocProductFeedbackCapability, ticketCode, key, altocProductFeedbackSchema, string(encoded), hash, nullableText(trusted.RequestID), actor, nullableText(trusted.ServiceClientID), actor, actor)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO service_ticket_product_feedback (ticket_id,submission_id,request_biz_id,product_code,operation_id,source_sha256,original_actor_uid) VALUES (?,?,?,?,?,?,?)`, ticket["id"], submission, requestID, product, operationID, digest, actor)
		if err != nil {
			return nil, err
		}
		if err := insertAltocAuditTx(ctx, tx, "service_ticket", ticket["id"], "product_feedback_submit", nil, map[string]any{"submission_id": submission, "product_code": product}, actor); err != nil {
			return nil, err
		}
		status = "pending"
		created = true
	} else if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"submissionId": submission, "requestBizId": requestID, "productCode": product, "operationId": operationID, "operationKey": "altoc:product-feedback:create:" + submission, "status": status, "created": created}, nil
}
