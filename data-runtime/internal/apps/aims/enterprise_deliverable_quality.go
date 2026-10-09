package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseQualityTxKey struct{}
type qualityTransaction interface {
	documentExecutor
	Commit() error
	Rollback() error
}
type borrowedQualityTx struct{ *sql.Tx }

func (borrowedQualityTx) Commit() error   { return nil }
func (borrowedQualityTx) Rollback() error { return nil }
func (a *Adapter) qualityDB(ctx context.Context) documentExecutor {
	if tx, ok := ctx.Value(enterpriseQualityTxKey{}).(*sql.Tx); ok {
		return tx
	}
	return a.DB()
}
func (a *Adapter) beginQualityTransaction(ctx context.Context, isolation sql.IsolationLevel) (qualityTransaction, error) {
	if tx, ok := ctx.Value(enterpriseQualityTxKey{}).(*sql.Tx); ok {
		return borrowedQualityTx{tx}, nil
	}
	return a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: isolation})
}
func (a *Adapter) requireQualitySubmissionMember(ctx context.Context, pid int64, actor string, q url.Values) error {
	if tx, ok := ctx.Value(enterpriseQualityTxKey{}).(*sql.Tx); ok {
		return requireEnterpriseDeliverableProjectScopeTx(ctx, tx, actor, pid, false)
	}
	return a.requireProjectMemberOrScopedAdmin(ctx, pid, actor, q)
}

// Facts are derived from the Host's freshly resolved Console governance holder,
// signed together with the action-specific scoped permit, never browser query.
type EnterpriseQualityFacts struct {
	QAUID            string `json:"qaUid"`
	QARevision       int64  `json:"qaRevision"`
	DirectorUID      string `json:"directorUid"`
	DirectorRevision int64  `json:"directorRevision"`
}

var EnterpriseQualityFields = map[string][]string{
	"submission-create":   {"documentSource", "documentUuid", "documentVersionId", "documentVersionNum", "contentSha256", "repoProjectCode", "repoFilePath", "repoCommitId"},
	"submission-resume":   {},
	"submission-activate": {"reviewGrantId"}, "completeness": {"action", "comment"}, "waiver": {"reason"},
}

func ValidateEnterpriseQualityPayload(action string, b map[string]any) error {
	fields, ok := EnterpriseQualityFields[action]
	if !ok {
		return httperror.New(400, "quality_action_invalid", "Invalid quality action")
	}
	for k := range b {
		found := false
		for _, v := range fields {
			found = found || v == k
		}
		if !found {
			return httperror.New(400, "quality_input_invalid", "Unsupported quality input")
		}
	}
	if action == "completeness" {
		v, ok := b["action"].(string)
		if !ok || (v != "pass" && v != "return") {
			return httperror.New(400, "quality_input_invalid", "Invalid completeness action")
		}
	}
	for _, k := range []string{"reason", "comment"} {
		if v, ok := b[k]; ok {
			str, ok := v.(string)
			if !ok || len(str) > 4000 || (k == "reason" && len(str) > 1000) {
				return httperror.New(400, "quality_input_invalid", "Invalid quality text")
			}
		}
	}
	return nil
}
func (a *Adapter) WriteEnterpriseDeliverableQuality(ctx context.Context, id EnterpriseProjectUpdateIdentity, project, object, action string, body map[string]any, facts EnterpriseQualityFacts) (map[string]any, error) {
	if err := ValidateEnterpriseQualityPayload(action, body); err != nil {
		return nil, err
	}
	if id.CommandScope == nil || id.CommandScope.ExpiresAt <= time.Now().UnixMilli() {
		return nil, httperror.New(403, "quality_permit_invalid", "Scoped quality authorization required")
	}
	pid, err := parseID(project, "project_id")
	if err != nil {
		return nil, err
	}
	oid, err := parseID(object, "quality_object_id")
	if err != nil {
		return nil, err
	}
	ctx = WithEnterpriseProjectCommandScope(ctx, id)
	tx, repo, err := a.beginDeliverableWrite(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Owning project and current relationship/range are checked before receipts.
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, id, project, "", "quality"); err != nil {
		return nil, err
	}
	did := oid
	if action == "completeness" || action == "submission-activate" {
		if err = tx.QueryRowContext(ctx, "SELECT deliverable_id FROM deliverable_submissions WHERE id=? FOR UPDATE", oid).Scan(&did); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, httperror.New(404, "submission_not_found", "Submission not found")
			}
			return nil, err
		}
	}
	var owner int64
	if err = tx.QueryRowContext(ctx, "SELECT project_id FROM deliverables WHERE id=? FOR UPDATE", did).Scan(&owner); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(404, "deliverable_not_found", "Deliverable not found")
		}
		return nil, err
	}
	if owner != pid {
		return nil, httperror.New(403, "quality_project_mismatch", "Quality object belongs to another project")
	}
	ctx = context.WithValue(ctx, enterpriseQualityTxKey{}, tx)
	q := url.Values{"current_user": {id.ActorUID}}
	switch action {
	case "submission-create", "submission-activate", "submission-resume":
		if err = requireEnterpriseDeliverableProjectScopeTx(ctx, tx, id.ActorUID, pid, false); err != nil {
			return nil, err
		}
		q.Set("current_user_document_version_resolved", "1")
		if action == "submission-create" {
			if facts.QAUID == "" || facts.QARevision <= 0 {
				return nil, httperror.New(403, "quality_qa_holder_required", "Verified QA holder required")
			}
			if facts.QAUID == id.ActorUID {
				q.Set("current_user_is_qa", "1")
				q.Set("current_user_qa_revision", fmt.Sprint(facts.QARevision))
			}
		}
		q.Set("current_user_document_review_grant_created", "1")
		q.Set("current_user_repository_review_snapshot_resolved", "1")
	case "completeness":
		rows, e := tx.QueryContext(ctx, "SELECT id FROM project_manager_delegations WHERE project_id=? ORDER BY id FOR UPDATE", pid)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var delegation int64
			if e = rows.Scan(&delegation); e != nil {
				rows.Close()
				return nil, e
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		if err = a.requireCurrentProjectManagerResponsibility(ctx, pid, id.ActorUID); err != nil {
			return nil, err
		}
	case "waiver":
		if facts.DirectorUID != id.ActorUID || facts.DirectorRevision <= 0 {
			return nil, httperror.New(403, "project_director_required", "Current project director required")
		}
		q.Set("current_user_can_waive_quality_reviews", "1")
		q.Set("current_user_is_project_director", "1")
		q.Set("current_user_project_director_revision", fmt.Sprint(facts.DirectorRevision))
	}
	if action == "submission-resume" {
		resolved, e := a.enterpriseWrites.registry.Resolve(a.enterpriseWrites.writer)
		if e != nil {
			return nil, e
		}
		table, e := resolved.Table("service_command_receipt")
		if e != nil {
			return nil, e
		}
		var code, actor, status string
		e = tx.QueryRowContext(ctx, "SELECT target_biz_code,COALESCE(original_actor_uid,''),status FROM "+table+" WHERE tenant_code=? AND source_deployment_code=? AND deployment_code=? AND source_app='enterprise' AND target_app='aims' AND operation_code='enterprise.aims.deliverables.quality-submission-create.v1' AND idempotency_key=?", id.Tenant, id.SourceDeployment, id.TargetDeployment, id.IdempotencyKey).Scan(&code, &actor, &status)
		var submission map[string]any
		if e != nil && e != sql.ErrNoRows {
			return nil, e
		}
		if e == nil {
			prefix := project + ":" + object + ":submission-create:"
			if status != "succeeded" || actor != id.ActorUID || !strings.HasPrefix(code, prefix) {
				return nil, httperror.New(409, "quality_receipt_invalid", "Submission intent is bound elsewhere")
			}
			n, e := strconv.ParseInt(strings.TrimPrefix(code, prefix), 10, 64)
			if e != nil || n <= 0 {
				return nil, httperror.New(409, "quality_receipt_invalid", "Submission receipt invalid")
			}
			submission, e = a.getDeliverableQualitySubmission(ctx, n)
			if e != nil {
				return nil, e
			}
			if int64ValueFromMap(submission, "deliverableId") != oid || stringValueFromMap(submission, "submittedBy") != id.ActorUID {
				return nil, httperror.New(409, "quality_receipt_invalid", "Submission receipt owner invalid")
			}
		}
		if id.CommandScope.ExpiresAt <= time.Now().UnixMilli() {
			return nil, httperror.New(403, "quality_permit_expired", "Quality authorization expired")
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"submission": submission}, nil
	}
	// Receipt stores immutable IDs, without introducing a parallel table. On replay
	// submission immutable snapshot fields are read to resume the grant stage.
	input, err := enterpriseDeliverableReceiptInput(ctx, "quality-"+action, "aims:enterprise-host:execute", "quality-command.v1", map[string]any{"projectId": project, "objectId": object, "action": action, "payload": body})
	if err != nil {
		return nil, err
	}
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(context.Context, *sql.Tx, json.RawMessage) (iop.ReceiptBusinessResult, error) {
		var value map[string]any
		var e error
		switch action {
		case "submission-create":
			value, e = a.createDeliverableQualitySubmission(ctx, object, q, body)
		case "submission-activate":
			value, e = a.activateDeliverableQualityReview(ctx, object, q, body)
		case "completeness":
			value, e = a.reviewDeliverableCompleteness(ctx, object, q, body)
		case "waiver":
			value, e = a.createDeliverableWaiver(ctx, object, q, body)
		}
		if e != nil {
			return iop.ReceiptBusinessResult{}, e
		}
		key := "id"
		if action == "completeness" {
			key = "reviewId"
		}
		if action == "waiver" {
			key = "waiverId"
		}
		return iop.ReceiptBusinessResult{TargetBizType: "deliverable-quality", TargetBizCode: fmt.Sprintf("%s:%s:%s:%d", project, object, action, int64ValueFromMap(value, key)), HTTPStatus: 200, Value: value}, nil
	})
	if err != nil {
		return nil, err
	}
	out := map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing}
	if first, ok := result.Value.(map[string]any); ok {
		for k, v := range first {
			out[k] = v
		}
	}
	if result.TargetBizType != "deliverable-quality" {
		return nil, httperror.New(409, "quality_receipt_invalid", "Receipt binding invalid")
	}
	if result.Existing {
		stored := result.TargetBizCode
		prefix := project + ":" + object + ":" + action + ":"
		if len(stored) <= len(prefix) || stored[:len(prefix)] != prefix {
			return nil, httperror.New(409, "quality_receipt_invalid", "Receipt binding invalid")
		}
		n, e := strconv.ParseInt(stored[len(prefix):], 10, 64)
		if e != nil || n <= 0 {
			return nil, httperror.New(409, "quality_receipt_invalid", "Receipt binding invalid")
		}
		if action == "submission-create" || action == "submission-activate" {
			snap, e := a.getDeliverableQualitySubmission(ctx, n)
			if e != nil {
				return nil, e
			}
			for k, v := range snap {
				out[k] = v
			}
		} else if action == "completeness" {
			out["reviewId"], out["submissionId"], out["action"], out["stage"] = n, oid, body["action"], "pm_completeness"
		} else {
			out["waiverId"], out["deliverableId"], out["reason"], out["approvedBy"] = n, oid, body["reason"], id.ActorUID
		}
	}
	if id.CommandScope.ExpiresAt <= time.Now().UnixMilli() {
		return nil, httperror.New(403, "quality_permit_expired", "Quality authorization expired")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
