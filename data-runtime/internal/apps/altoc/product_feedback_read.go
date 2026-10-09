package altoc

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Submission preview requires the same current edit/object scope as submission.
func (a *Adapter) readServiceTicketProductFeedback(ctx context.Context, ticketCode string, query url.Values) (map[string]any, error) {
	body := altocRuntimeBodyFromQuery(query)
	if len(altocActorScopes(body)) == 0 || altocActor(body) != query.Get("current_user") {
		return nil, httperror.New(http.StatusForbidden, "product_feedback_actor_invalid", "current scoped actor is required")
	}
	if err := altocRequireActionScope(body, "service_ticket", "edit"); err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(altocIntegrationOperationQueryBody(query), "altoc")
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ticket, err := altocQueryOneMap(ctx, tx, `SELECT st.* FROM service_ticket st INNER JOIN customer cu ON cu.id=st.customer_id AND cu.deleted_at IS NULL WHERE st.code=? AND st.deleted_at IS NULL LIMIT 1`, ticketCode)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}
	if err := altocRequireRecordWrite(body, "service_ticket", ticket, "owner_user_id", ""); err != nil {
		return nil, err
	}
	var submission, requestID, product, status string
	err = tx.QueryRowContext(ctx, `SELECT f.submission_id,f.request_biz_id,f.product_code,o.status FROM service_ticket_product_feedback f INNER JOIN integration_operation o ON o.operation_id=f.operation_id AND o.tenant_code=? AND o.deployment_code=? AND o.source_app='altoc' AND o.target_app='aims' AND o.operation_code=? WHERE f.ticket_id=?`, trusted.TenantCode, trusted.DeploymentCode, altocProductFeedbackOperation, ticket["id"]).Scan(&submission, &requestID, &product, &status)
	var result map[string]any
	if err == sql.ErrNoRows {
		snapshot, digest, err := altocProductFeedbackSnapshot(ticket)
		if err != nil {
			return nil, err
		}
		result = map[string]any{"submitted": false, "expectedSourceSha256": digest, "productCode": snapshot["productCode"], "title": snapshot["title"], "description": snapshot["description"]}
	} else if err != nil {
		return nil, err
	} else {
		result = map[string]any{"submitted": true, "submissionId": submission, "requestBizId": requestID, "productCode": product, "status": status}
		var decision, canonical string
		var revision uint64
		projectionErr := tx.QueryRowContext(ctx, `SELECT decision_status,canonical_request_biz_id,source_revision FROM product_feedback_status_projection WHERE ticket_id=?`, ticket["id"]).Scan(&decision, &canonical, &revision)
		if projectionErr != nil && projectionErr != sql.ErrNoRows {
			return nil, projectionErr
		}
		if projectionErr == nil {
			result["decisionStatus"] = decision
			result["canonicalRequestBizId"] = canonical
			result["sourceRevision"] = revision
		}

		var snapshot []byte
		var progressRevision uint64
		progressErr := tx.QueryRowContext(ctx, `SELECT source_revision,snapshot_json FROM product_feedback_progress_projection WHERE ticket_id=?`, ticket["id"]).Scan(&progressRevision, &snapshot)
		if progressErr != nil && progressErr != sql.ErrNoRows {
			return nil, progressErr
		}
		if progressErr == nil {
			progress, err := parseProductFeedbackProgress(snapshot)
			if err != nil {
				return nil, err
			}
			if progress.TicketCode != ticketCode || progress.ProductCode != product || progress.RequestBizID != requestID || progress.SourceRevision != progressRevision {
				return nil, httperror.New(502, "feedback_progress_projection_invalid", "Feedback progress binding is inconsistent")
			}
			if progressRevision >= revision {
				result["decisionStatus"] = progress.DecisionStatus
				result["canonicalRequestBizId"] = progress.CanonicalRequestBizID
				result["sourceRevision"] = progressRevision
				result["canonicalDecisionStatus"] = progress.CanonicalDecisionStatus
				result["versions"] = progress.Versions
				result["progressSourceRevision"] = progressRevision
				result["progressPending"] = false
			} else {
				result["progressPending"] = true
			}
		} else {
			result["progressPending"] = true
		}

	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
