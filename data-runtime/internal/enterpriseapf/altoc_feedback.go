package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"

	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var feedbackOps = map[string][2]string{"product-feedback-view": {"service_ticket", "edit"}, "product-feedback-submit": {"service_ticket", "edit"}, "product-feedback-resume": {"service_ticket", "edit"}}

func IsFeedbackOperation(op string) bool { _, ok := feedbackOps[op]; return ok }
func validateFeedback(op string, i SalesInput) error {
	if !IsFeedbackOperation(op) || !validCustomerID(i.ID) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	if op != "product-feedback-view" {
		fields["productAuthorization"] = true
	}
	if op == "product-feedback-submit" {
		fields["expectedSourceSha256"] = true
	}
	for k := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
	}
	if op == "product-feedback-submit" && !regexpSHA256.MatchString(salesText(i.Payload, "expectedSourceSha256")) {
		return salesInvalid()
	}
	return nil
}

// The product permit is HMAC-bound by the existing U lane, never a browser fact.
func feedbackPermit(i SalesInput) (pc.AuthorizationPermit, error) {
	var p pc.AuthorizationPermit
	b, ok := i.Payload["productAuthorization"].(string)
	var e error
	if !ok {
		e = salesInvalid()
	} else {
		e = json.Unmarshal([]byte(b), &p)
	}
	if e != nil || p.Resource != "product_requests" || p.Action != "create" {
		return p, httperror.New(403, "feedback_product_permit_invalid", "产品需求权限无效")
	}
	return p, nil
}

// Feedback freezes one immutable source intent, then resumes it through the
// Aims owning caller-Tx core. There is no new machine owner or network call.
func (s *Service) Feedback(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	if e := validateFeedback(op, i); e != nil {
		return nil, e
	}
	if who.Client != "enterprise.runtime" || who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, httperror.New(403, "feedback_identity_invalid", "用户委托无效")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	if !domaininstall.IsAltocFeedbackDomain(s.binding.Domains["altoc"]) {
		return nil, httperror.New(503, "feedback_not_installed", "产品反馈尚未安装")
	}
	write := op != "product-feedback-view"
	mode := enterprise.Read
	if write {
		mode = enterprise.Write
		if who.Key == "" {
			return nil, salesInvalid()
		}
	}
	ar, e := s.request("altoc", mode)
	if e != nil {
		return nil, e
	}
	requests := []enterprise.ResolveRequest{ar}
	if write {
		a, e := s.request("aims", enterprise.Write)
		if e != nil {
			return nil, e
		}
		requests = append(requests, a)
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if write {
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, requests...)
	} else {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, requests...)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	tables := map[string]string{}
	for _, n := range []string{"altoc_customer", "altoc_contract", "altoc_service_ticket", "altoc_opportunity_stage", "altoc_service_ticket_product_feedback", "altoc_product_feedback_status_projection", "altoc_product_feedback_progress_projection", "integration_operation", "service_command_receipt", "altoc_audit_log"} {
		v, e := r.Table(n)
		if e != nil {
			return nil, e
		}
		tables[n] = v
	}
	// Altoc gate/customer/contract/ticket before Aims product root.
	if write {
		if _, e = salesRow(ctx, tx, tables["altoc_opportunity_stage"], "1=1 ORDER BY id"); e != nil {
			return nil, e
		}
	}
	var cid, contract string
	e = tx.QueryRowContext(ctx, "SELECT customer_id,COALESCE(contract_id,0) FROM "+tables["altoc_service_ticket"]+" WHERE id=? AND deleted_at IS NULL", i.ID).Scan(&cid, &contract)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, httperror.New(404, "feedback_ticket_missing", "工单不存在")
	}
	if e != nil {
		return nil, e
	}
	if write {
		if _, e = salesRow(ctx, tx, tables["altoc_customer"], "id=? AND deleted_at IS NULL", cid); e != nil {
			return nil, e
		}
		if contract != "0" {
			if _, e = salesRow(ctx, tx, tables["altoc_contract"], "id=? AND deleted_at IS NULL", contract); e != nil {
				return nil, e
			}
		}
	}
	var ticket map[string]any
	if write {
		ticket, e = salesRow(ctx, tx, tables["altoc_service_ticket"], "id=? AND customer_id=? AND COALESCE(contract_id,0)=? AND deleted_at IS NULL", i.ID, cid, contract)
	} else {
		ticket, e = knowledgeReadParent(ctx, tx, tables["altoc_service_ticket"], i.ID)
	}
	if e != nil {
		return nil, e
	}
	facts := map[string]any{"owner_uid": ticket["owner_user_id"]}
	var dept string
	e = tx.QueryRowContext(ctx, "SELECT COALESCE(owner_dept_code,'') FROM "+tables["altoc_customer"]+" WHERE id=? AND deleted_at IS NULL", cid).Scan(&dept)
	if e != nil {
		return nil, e
	}
	facts["owner_dept_code"] = dept
	if e = salesScope(scope, who.Actor, facts); e != nil {
		return nil, e
	}
	// Natural source binding is authoritative on every replay; no mutable source
	// field can replace an already frozen command.
	var submission, request, product, oid, hash, actor, status string
	var command []byte
	var frozenDigest string
	e = tx.QueryRowContext(ctx, "SELECT f.submission_id,f.request_biz_id,f.product_code,f.operation_id,f.source_sha256,f.original_actor_uid,o.status,o.command_json,o.command_sha256 FROM "+tables["altoc_service_ticket_product_feedback"]+" f JOIN "+tables["integration_operation"]+" o ON o.operation_id=f.operation_id AND o.tenant_code=? AND o.deployment_code=? AND o.source_app='enterprise' AND o.target_app='aims' AND o.operation_code='enterprise.altoc.product-feedback.create.v1' WHERE f.ticket_id=?", who.Tenant, who.Deployment, i.ID).Scan(&submission, &request, &product, &oid, &hash, &actor, &status, &command, &frozenDigest)
	exists := e == nil
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	if !exists && op == "product-feedback-resume" {
		return nil, httperror.New(409, "feedback_submission_missing", "尚未冻结反馈，请先提交")
	}
	if !exists {
		snapshot, digest, e := altoc.ProductFeedbackSnapshot(ticket)
		if e != nil {
			return nil, e
		}
		if !write {
			if e = tx.Commit(); e != nil {
				return nil, e
			}
			return map[string]any{"submitted": false, "productCode": snapshot["productCode"], "expectedSourceSha256": digest, "title": snapshot["title"], "description": snapshot["description"]}, nil
		}
		if digest != salesText(i.Payload, "expectedSourceSha256") {
			return nil, httperror.New(409, "product_feedback_source_changed", "工单已变化，请刷新后提交")
		}
		product = salesText(snapshot, "productCode")
		submission = uuid.NewSHA1(uuid.NameSpaceOID, []byte("apf16f|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+who.Key)).String()
		request = uuid.NewString()
		oid = uuid.NewString()
		hash = digest
		actor = who.Actor
		status = "pending"
		command, _ = json.Marshal(pc.FeedbackRequest{ActorUID: actor, ProductCode: product, TicketCode: salesText(ticket, "code"), RequestBizID: request, Title: salesText(snapshot, "title"), Description: salesText(snapshot, "description"), Action: "create"})
	}
	if write {
		if actor != who.Actor {
			return nil, httperror.New(403, "feedback_actor_mismatch", "仅原提交人可以恢复此反馈")
		}
		p, e := feedbackPermit(i)
		if e != nil {
			return nil, e
		}
		// Verify the registered Aims compatibility views before using its owning core.
		if e = enterprise.VerifyCompatibilityViews(ctx, r.DB, s.binding, "aims", pc.FeedbackViewNames()); e != nil {
			return nil, e
		}
		if e = pc.AuthorizeWorkspaceTransaction(ctx, tx, product, who.Actor, "product_requests", "create", p); e != nil {
			return nil, e
		}
		if !exists {
			var cmd map[string]any
			json.Unmarshal(command, &cmd)
			digest, e := integrationoperation.ValidateAndDigestCommand(cmd)
			if e != nil {
				return nil, e
			}
			key := "altoc:product-feedback:create:" + submission
			_, e = tx.ExecContext(ctx, "INSERT INTO "+tables["integration_operation"]+"(operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,original_actor_uid,service_client_id,created_by,updated_by) VALUES(?,?,?,1,?,?,'enterprise','aims','enterprise.altoc.product-feedback.create.v1','aims:enterprise-host:execute','service_ticket',?,?,'product-feedback-create.v1',?,?,'pending',?,?,'enterprise.runtime',?,?)", oid, key, key, who.Tenant, who.Deployment, salesText(ticket, "code"), key, string(command), digest, who.RequestID, who.Actor, who.Actor, who.Actor)
			if e != nil {
				return nil, e
			}
			_, e = tx.ExecContext(ctx, "INSERT INTO "+tables["altoc_service_ticket_product_feedback"]+"(ticket_id,submission_id,request_biz_id,product_code,operation_id,source_sha256,original_actor_uid) VALUES(?,?,?,?,?,?,?)", i.ID, submission, request, product, oid, hash, actor)
			if e != nil {
				return nil, e
			}
			if e = knowledgeAudit(ctx, tx, r, ticket, who, "product_feedback_submit", map[string]any{"submissionId": submission}); e != nil {
				return nil, e
			}
		}
		if op == "product-feedback-resume" {
			var input pc.FeedbackRequest
			if e = json.Unmarshal(command, &input); e != nil {
				return nil, e
			}
			if input.ActorUID != actor || input.ProductCode != product || input.RequestBizID != request || input.TicketCode != salesText(ticket, "code") {
				return nil, httperror.New(409, "feedback_binding_conflict", "冻结来源不一致")
			}
			repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(tables["service_command_receipt"]))
			if e != nil {
				return nil, e
			}
			var cmd map[string]any
			json.Unmarshal(command, &cmd)
			digest, e := integrationoperation.ValidateAndDigestCommand(cmd)
			if e != nil {
				return nil, e
			}
			if digest != frozenDigest {
				return nil, httperror.New(409, "feedback_binding_conflict", "冻结命令摘要不一致")
			}
			key := "altoc:product-feedback:create:" + submission
			receipt := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "aims", OperationID: oid, OperationCode: "enterprise.altoc.product-feedback.create.v1", RequiredCapability: "aims:enterprise-host:execute", IdempotencyKey: key, CommandSchemaVersion: "product-feedback-create.v1", CommandSHA256: digest, Command: command, OriginalActorUID: actor}
			_, e = repo.ExecuteInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
				v, e := pc.ReceiveFeedbackRequestTx(ctx, tx, input, p, oid)
				if e != nil {
					return integrationoperation.ReceiptBusinessResult{}, e
				}
				return integrationoperation.ReceiptBusinessResult{TargetBizType: "product_request", TargetBizCode: request, HTTPStatus: 200, Value: v}, nil
			})
			if e != nil {
				return nil, e
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+tables["integration_operation"]+" SET status='succeeded',updated_at=UTC_TIMESTAMP(3) WHERE operation_id=?", oid); e != nil {
				return nil, e
			}
			status = "succeeded"
		}
	}
	result := map[string]any{"submitted": true, "submissionId": submission, "requestBizId": request, "productCode": product, "status": status}
	if op == "product-feedback-view" {
		var decision, canonical string
		var rev uint64
		e = tx.QueryRowContext(ctx, "SELECT decision_status,canonical_request_biz_id,source_revision FROM "+tables["altoc_product_feedback_status_projection"]+" WHERE ticket_id=?", i.ID).Scan(&decision, &canonical, &rev)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return nil, e
		}
		if e == nil {
			result["decisionStatus"] = decision
			result["canonicalRequestBizId"] = canonical
			result["sourceRevision"] = rev
		}
		var raw []byte
		var prev uint64
		e = tx.QueryRowContext(ctx, "SELECT source_revision,snapshot_json FROM "+tables["altoc_product_feedback_progress_projection"]+" WHERE ticket_id=?", i.ID).Scan(&prev, &raw)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return nil, e
		}
		result["progressPending"] = true
		if e == nil {
			p, e := altoc.ParseProductFeedbackProgress(raw)
			if e != nil || p.TicketCode != salesText(ticket, "code") || p.ProductCode != product || p.RequestBizID != request || p.SourceRevision != prev {
				return nil, httperror.New(503, "feedback_progress_binding_invalid", "进度投影不一致")
			}
			if prev >= rev {
				result["decisionStatus"] = p.DecisionStatus
				result["canonicalRequestBizId"] = p.CanonicalRequestBizID
				result["sourceRevision"] = prev
				result["canonicalDecisionStatus"] = p.CanonicalDecisionStatus
				result["versions"] = p.Versions
				result["progressPending"] = false
			}
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return result, nil
}

var regexpSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// FeedbackProjection consumes only a command already verified by the Host's
// old Aims service ingress. Fresh Enterprise S identity is checked again here;
// no user permit or generic projection API is accepted.
func (s *Service) FeedbackProjection(ctx context.Context, kind string, input integrationoperation.ReceiptCommandInput, who Identity) (any, error) {
	op := "aims.altoc.product-feedback.update-" + kind + ".v1"
	capability := "altoc:product-feedback:update-" + kind
	schema := "product-feedback-" + kind + ".v1"
	if (kind != "status" && kind != "progress") || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment || input.TrustedContext.SourceApp != "aims" || input.TrustedContext.ServiceClientID != "aims.runtime" || input.TrustedContext.TenantCode != who.Tenant || input.SourceDeploymentCode == "" || input.TargetDeploymentCode == "" || input.TargetApp != "altoc" || input.OperationCode != op || input.RequiredCapability != capability || input.CommandSchemaVersion != schema {
		return nil, httperror.New(403, "feedback_projection_identity_invalid", "反馈投影身份无效")
	}
	if !domaininstall.IsAltocFeedbackDomain(s.binding.Domains["altoc"]) {
		return nil, httperror.New(503, "feedback_not_installed", "产品反馈尚未安装")
	}
	var status altoc.ProductFeedbackStatus
	var progress altoc.ProductFeedbackProgress
	var e error
	if kind == "status" {
		status, e = altoc.ParseProductFeedbackStatus(input.Command)
	} else {
		progress, e = altoc.ParseProductFeedbackProgress(input.Command)
		status = progress.ProductFeedbackStatus
	}
	if e != nil {
		return nil, e
	}
	req, e := s.request("altoc", enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, rs, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	t := altoc.UnifiedProductFeedbackTables()
	for _, n := range []string{t.Ticket, t.Submission, t.Status, t.Progress} {
		v, e := r.Table(n)
		if e != nil || v != "`"+n+"`" {
			return nil, enterprise.ErrBindingMismatch
		}
	}
	// Ticket before binding/projections, consistent with user submits.
	var id int64
	e = tx.QueryRowContext(ctx, "SELECT id FROM "+t.Ticket+" WHERE BINARY code=BINARY ? AND deleted_at IS NULL FOR UPDATE", status.TicketCode).Scan(&id)
	if e != nil {
		return nil, e
	}
	var product, request string
	e = tx.QueryRowContext(ctx, "SELECT product_code,request_biz_id FROM "+t.Submission+" WHERE ticket_id=? FOR UPDATE", id).Scan(&product, &request)
	if e != nil {
		return nil, e
	}
	if product != status.ProductCode || request != status.RequestBizID {
		return nil, httperror.New(409, "feedback_projection_binding_conflict", "反馈来源不匹配")
	}
	rt, e := r.Table("service_command_receipt")
	if e != nil {
		return nil, e
	}
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(rt))
	if e != nil {
		return nil, e
	}
	result, e := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		var applied bool
		var e error
		if kind == "status" {
			applied, e = altoc.ApplyProductFeedbackStatusTx(ctx, tx, status, t)
		} else {
			applied, e = altoc.ApplyProductFeedbackProgressTx(ctx, tx, progress, t)
		}
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "product_feedback", TargetBizCode: status.RequestBizID, HTTPStatus: 200, Value: map[string]any{"requestBizId": status.RequestBizID, "sourceRevision": status.SourceRevision, "applied": applied}}, nil
	})
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"receiptId": result.ReceiptID, "receiptStatus": "succeeded", "idempotent": result.Existing, "operationId": input.OperationID, "operationCode": input.OperationCode, "idempotencyKey": input.IdempotencyKey, "commandSchemaVersion": input.CommandSchemaVersion, "commandSha256": input.CommandSHA256, "targetBizType": result.TargetBizType, "targetBizCode": result.TargetBizCode, "responseSummarySha256": result.ResponseSummarySHA256, "result": map[string]any{"requestBizId": status.RequestBizID, "sourceRevision": status.SourceRevision, "applied": !result.Existing && feedbackApplied(result.Value)}}, nil
}

func feedbackApplied(value any) bool {
	if m, ok := value.(map[string]any); ok {
		v, _ := m["applied"].(bool)
		return v
	}
	return false
}
