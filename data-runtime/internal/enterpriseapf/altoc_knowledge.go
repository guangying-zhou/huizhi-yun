package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
)

var knowledgeOps = map[string][2]string{
	"customer-assets-summary": {"customer", "view"}, "customer-documents-page": {"customer", "view"},
	"service-ticket-knowledge-link": {"service_ticket", "edit"}, "service-ticket-knowledge-resume": {"service_ticket", "edit"}, "service-ticket-knowledge-view": {"service_ticket", "view"},
}

func IsKnowledgeOperation(op string) bool { _, ok := knowledgeOps[op]; return ok }

type KnowledgePorts struct {
	Document SalesDocumentRead
	// scope JSON has already been HMAC bound by the authenticated Host route.
	Assets func(context.Context, string, string, string, string, string, string) (map[string]any, error)
}

func validateKnowledge(op string, i SalesInput) error {
	if !IsKnowledgeOperation(op) || !validCustomerID(i.ID) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	switch op {
	case "customer-assets-summary":
		fields["assetsAuthorization"] = true
		fields["page"] = true
		fields["pageSize"] = true
	case "customer-documents-page":
		fields["page"] = true
		fields["pageSize"] = true
	case "service-ticket-knowledge-link":
		fields["documentUuid"] = true
		fields["expectedVersion"] = true
		fields["codocsDeployment"] = true
		fields["assetsDeployment"] = true
		fields["assetsAuthorization"] = true
	case "service-ticket-knowledge-resume":
		fields["checkpoint"] = true
		fields["assetsAuthorization"] = true
	case "service-ticket-knowledge-view":
		fields["assetsAuthorization"] = true
	}
	for k := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
	}
	if strings.HasPrefix(op, "customer-") {
		for _, k := range []string{"page", "pageSize"} {
			n, ok := i.Payload[k].(float64)
			if !ok || n < 1 || n != float64(int64(n)) || n > 1000000 || k == "pageSize" && n > 100 {
				return salesInvalid()
			}
		}
	}
	if op == "service-ticket-knowledge-link" {
		u, e := uuid.Parse(salesText(i.Payload, "documentUuid"))
		if e != nil || u == uuid.Nil || u.String() != salesText(i.Payload, "documentUuid") {
			return salesInvalid()
		}
		n, ok := i.Payload["expectedVersion"].(float64)
		if !ok || n < 1 || n != float64(int64(n)) {
			return salesInvalid()
		}
		for _, k := range []string{"codocsDeployment", "assetsDeployment"} {
			if !stringValue(i.Payload[k], 128, false) {
				return salesInvalid()
			}
		}
	}
	for _, k := range []string{"assetsAuthorization", "checkpoint"} {
		if v, ok := i.Payload[k]; ok && !stringValue(v, 20000, false) {
			return salesInvalid()
		}
	}
	return nil
}
func (s *Service) Knowledge(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope, ports KnowledgePorts) (any, error) {
	if e := validateKnowledge(op, i); e != nil {
		return nil, e
	}
	if who.Client != "enterprise.runtime" || who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, httperror.New(403, "knowledge_identity_invalid", "用户委托无效")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	resource, action := knowledgeOps[op][0], knowledgeOps[op][1]
	write := action == "edit"
	if write && who.Key == "" {
		return nil, salesInvalid()
	}
	if resource == "service_ticket" && !domaininstall.IsAltocTicketsDomain(s.binding.Domains["altoc"]) {
		return nil, httperror.New(503, "knowledge_not_installed", "服务工单尚未安装")
	}
	mode := enterprise.Read
	if write {
		mode = enterprise.Write
	}
	req, e := s.request("altoc", mode)
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if write {
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	table := func(n string) string { v, _ := r.Table("altoc_" + n); return v }
	// Lock sales gate then customer, contract, ticket in the same order as ticket writes.
	if write {
		if _, e = salesRow(ctx, tx, table("opportunity_stage"), "1=1 ORDER BY id"); e != nil {
			return nil, e
		}
	}
	var row map[string]any
	if resource == "customer" {
		row, e = knowledgeReadParent(ctx, tx, table("customer"), i.ID)
	} else {
		var cid, contractID string
		e = tx.QueryRowContext(ctx, "SELECT customer_id,COALESCE(contract_id,0) FROM "+table("service_ticket")+" WHERE id=? AND deleted_at IS NULL", i.ID).Scan(&cid, &contractID)
		if e != nil {
			return nil, e
		}
		if write {
			if _, e = salesRow(ctx, tx, table("customer"), "id=? AND deleted_at IS NULL", cid); e != nil {
				return nil, e
			}
			if _, e = salesRow(ctx, tx, table("contract"), "id=? AND deleted_at IS NULL", contractID); e != nil {
				return nil, e
			}
			row, e = salesRow(ctx, tx, table("service_ticket"), "id=? AND customer_id=? AND contract_id=? AND deleted_at IS NULL", i.ID, cid, contractID)
		} else {
			row, e = knowledgeReadParent(ctx, tx, table("service_ticket"), i.ID)
		}
	}
	if e != nil {
		return nil, e
	}
	facts := map[string]any{}
	for k, v := range row {
		facts[k] = v
	}
	if resource == "service_ticket" {
		facts["owner_uid"] = row["owner_user_id"]
		var dept string
		e = tx.QueryRowContext(ctx, "SELECT COALESCE(owner_dept_code,'') FROM "+table("customer")+" WHERE id=? AND deleted_at IS NULL", row["customer_id"]).Scan(&dept)
		if e != nil {
			return nil, e
		}
		facts["owner_dept_code"] = dept
	}
	if e = salesScope(scope, who.Actor, facts); e != nil {
		return nil, e
	}
	if op != "customer-assets-summary" && ports.Document == nil || op != "customer-documents-page" && ports.Assets == nil {
		return nil, httperror.New(503, "knowledge_dependency_unavailable", "摘要依赖暂不可用")
	}
	customer := salesText(row, "code")
	if resource == "service_ticket" {
		e = tx.QueryRowContext(ctx, "SELECT code FROM "+table("customer")+" WHERE id=? AND deleted_at IS NULL", row["customer_id"]).Scan(&customer)
		if e != nil {
			return nil, e
		}
	}
	assets := func(asset, env string) (map[string]any, error) {
		return ports.Assets(ctx, customer, asset, env, who.Actor, salesText(i.Payload, "assetsAuthorization"), action)
	}
	doc := func(u string) (map[string]any, error) {
		d, e := ports.Document(ctx, u, who.Actor)
		if e != nil {
			return nil, salesDocumentFailure(e)
		}
		if salesText(d, "uuid") != u {
			return nil, httperror.New(404, "knowledge_document_not_found", "文档不存在")
		}
		return d, nil
	}
	if op == "customer-assets-summary" {
		v, e := assets("", "")
		if e != nil {
			return knowledgeDenied(e)
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return knowledgePage(v, int(i.Payload["page"].(float64)), int(i.Payload["pageSize"].(float64))), nil
	}
	if op == "customer-documents-page" {
		links, e := queryRows(ctx, tx, "SELECT document_uuid FROM "+table("document_link")+" WHERE entity_type='customer' AND entity_id=? AND deleted_at IS NULL ORDER BY id", i.ID)
		if e != nil {
			return nil, e
		}
		items := []map[string]any{}
		for _, link := range links {
			d, e := doc(salesText(link, "document_uuid"))
			if httperrorStatus(e) == 403 || httperrorStatus(e) == 404 {
				continue
			}
			if e != nil {
				return nil, e
			}
			items = append(items, d)
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		if len(links) > 0 && len(items) == 0 {
			return map[string]any{"access": "denied"}, nil
		}
		return knowledgePage(map[string]any{"items": items}, int(i.Payload["page"].(float64)), int(i.Payload["pageSize"].(float64))), nil
	}
	document := salesText(row, "ops_knowledge_pending_uuid")
	if document == "" {
		document = salesText(row, "codocs_document_uuid")
	}
	if op == "service-ticket-knowledge-link" {
		document = salesText(i.Payload, "documentUuid")
	}
	if document == "" {
		if op == "service-ticket-knowledge-view" {
			return map[string]any{"access": "allowed", "status": "idle"}, nil
		}
		return nil, httperror.New(409, "knowledge_not_pending", "没有可恢复的知识关联")
	}
	d, e := doc(document)
	if e != nil {
		if !write {
			return knowledgeDenied(e)
		}
		return nil, e
	}
	if _, e = assets(salesText(row, "delivery_asset_code"), salesText(row, "environment_code")); e != nil {
		if !write {
			return knowledgeDenied(e)
		}
		return nil, e
	}
	if op == "service-ticket-knowledge-view" {
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"access": "allowed", "status": row["ops_knowledge_status"], "document": d}, nil
	}
	operations, _ := r.Table("integration_operation")
	if op == "service-ticket-knowledge-link" {
		// Current ACLs and scope above precede receipt lookup, including replay.
		oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("apf16e|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+who.Key), 4).String()
		command := map[string]any{"ticketId": i.ID, "documentUuid": document, "expectedVersion": i.Payload["expectedVersion"], "actorUid": who.Actor, "assetsDeployment": i.Payload["assetsDeployment"], "codocsDeployment": i.Payload["codocsDeployment"]}
		digest, e := integrationoperation.ValidateAndDigestCommand(command)
		if e != nil {
			return nil, e
		}
		raw, _ := json.Marshal(command)
		rt, _ := r.Table("service_command_receipt")
		repo, _ := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(rt))
		in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.apf16e.knowledge-reserve.v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
		_, e = repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
			fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			if fmt.Sprint(row["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
				return fail(httperror.New(409, "knowledge_version_conflict", "工单版本已变化"))
			}
			if salesText(row, "ops_knowledge_status") != "idle" {
				return fail(httperror.New(409, "knowledge_binding_conflict", "工单已有知识关联"))
			}
			ctxCmd := map[string]any{"actorUid": who.Actor, "action": "link", "ticketCode": row["code"], "documentUuid": document, "customerCode": customer, "deliveryCode": row["delivery_code"], "deliveryAssetCode": row["delivery_asset_code"], "environmentCode": row["environment_code"], "projectCode": row["project_code"]}
			var contract string
			if e = tx.QueryRowContext(ctx, "SELECT code FROM "+table("contract")+" WHERE id=? AND deleted_at IS NULL", row["contract_id"]).Scan(&contract); e != nil {
				return fail(e)
			}
			ctxCmd["contractCode"] = contract
			for _, k := range []string{"deliveryCode", "deliveryAssetCode", "environmentCode", "projectCode"} {
				if salesText(ctxCmd, k) == "" {
					return fail(httperror.New(409, "knowledge_context_incomplete", "工单缺少正式交付上下文"))
				}
			}
			correlation := "apf16e:" + oid
			for index, target := range []string{"codocs", "assets"} {
				cap := target + ":knowledge-link:create"
				if target == "assets" {
					cap = "assets:asset-link:create"
				}
				cmd := map[string]any{}
				for k, v := range ctxCmd {
					cmd[k] = v
				}
				cmd["targetDeployment"] = i.Payload[target+"Deployment"]
				hash, e := integrationoperation.ValidateAndDigestCommand(cmd)
				if e != nil {
					return fail(e)
				}
				raw, _ := json.Marshal(cmd)
				key := correlation + ":" + target
				id := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte(key), 4).String()
				_, e = tx.ExecContext(ctx, "INSERT INTO "+operations+"(operation_id,operation_key,correlation_key,sequence_no,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_actor_uid,service_client_id,created_by,updated_by) VALUES(?,?,?,?,?,?,'enterprise',?,?,?,'service_ticket',?,?,'v1',?,?,'pending',UTC_TIMESTAMP(3),?,?,?,?)", id, key, correlation, index+1, who.Tenant, who.Deployment, target, "enterprise."+target+".knowledge-link.v1", cap, row["code"], key, string(raw), hash, who.Actor, who.Client, who.Actor, who.Actor)
				if e != nil {
					return fail(e)
				}
			}
			if e = salesUpdate(ctx, tx, table("service_ticket"), i.ID, map[string]any{"ops_knowledge_pending_uuid": document, "ops_knowledge_status": "pending", "ops_knowledge_idempotency_key": correlation}, who.Actor); e != nil {
				return fail(e)
			}
			if e = knowledgeAudit(ctx, tx, r, row, who, "knowledge-reserve", map[string]any{"documentUuid": document, "correlation": correlation}); e != nil {
				return fail(e)
			}
			return integrationoperation.ReceiptBusinessResult{TargetBizType: "service_ticket", TargetBizCode: salesText(row, "code"), HTTPStatus: 200, Value: map[string]any{"id": i.ID}}, nil
		})
		if e != nil {
			return nil, e
		}
		row, e = salesRow(ctx, tx, table("service_ticket"), "id=?", i.ID)
		if e != nil {
			return nil, e
		}
	}
	frozen, e := queryRows(ctx, tx, "SELECT * FROM "+operations+" WHERE BINARY correlation_key=BINARY ? AND tenant_code=? AND deployment_code=? AND source_app='enterprise' AND operation_code IN ('enterprise.codocs.knowledge-link.v1','enterprise.assets.knowledge-link.v1') ORDER BY target_app FOR UPDATE", row["ops_knowledge_idempotency_key"], who.Tenant, who.Deployment)
	if e != nil {
		return nil, e
	}
	if len(frozen) != 2 {
		return nil, httperror.New(409, "knowledge_operations_missing", "冻结命令不完整")
	}
	// Recovery never changes the frozen actor or intention.
	for _, f := range frozen {
		if salesText(f, "original_actor_uid") != who.Actor {
			return nil, httperror.New(403, "knowledge_actor_mismatch", "只能由原发起人恢复")
		}
	}
	if checkpoint := salesText(i.Payload, "checkpoint"); checkpoint != "" {
		var receipts []integrationoperation.ReceiptEvidence
		if e = json.Unmarshal([]byte(checkpoint), &receipts); e != nil || len(receipts) != 2 {
			return nil, salesInvalid()
		}
		for index, f := range frozen {
			var cmd map[string]any
			if e = json.Unmarshal([]byte(salesText(f, "command_json")), &cmd); e != nil {
				return nil, e
			}
			in := knowledgeReceiptInput(f, who, cmd)
			kind := "document"
			if salesText(f, "target_app") == "assets" {
				kind = "delivery_document"
			}
			if e = integrationoperation.ValidateReceiptEvidence(integrationoperation.ReceiptEvidence{OperationID: in.OperationID, OperationCode: in.OperationCode, IdempotencyKey: in.IdempotencyKey, CommandSchemaVersion: in.CommandSchemaVersion, CommandSHA256: in.CommandSHA256, TargetBizType: kind, TargetBizCode: document}, receipts[index]); e != nil {
				return nil, httperror.New(409, "knowledge_receipt_invalid", "目标回执无效")
			}
		}
		for index, f := range frozen {
			_, e = tx.ExecContext(ctx, "UPDATE "+operations+" SET status='succeeded',target_receipt_id=?,response_summary_sha256=?,succeeded_at=UTC_TIMESTAMP(3),version_no=version_no+1 WHERE operation_id=? AND status<>'succeeded'", receipts[index].ReceiptID, receipts[index].ResponseSummarySHA256, f["operation_id"])
			if e != nil {
				return nil, e
			}
		}
		if salesText(row, "ops_knowledge_status") != "linked" {
			if e = salesUpdate(ctx, tx, table("service_ticket"), i.ID, map[string]any{"ops_knowledge_pending_uuid": nil, "ops_knowledge_status": "linked", "codocs_document_uuid": document}, who.Actor); e != nil {
				return nil, e
			}
			if e = knowledgeAudit(ctx, tx, r, row, who, "knowledge-confirm", map[string]any{"documentUuid": document, "receipts": receipts}); e != nil {
				return nil, e
			}
			row["ops_knowledge_status"] = "linked"
		}
	}
	result := []map[string]any{}
	for _, f := range frozen {
		var cmd map[string]any
		if e = json.Unmarshal([]byte(salesText(f, "command_json")), &cmd); e != nil {
			return nil, e
		}
		result = append(result, map[string]any{"operationId": f["operation_id"], "targetApp": f["target_app"], "operationCode": f["operation_code"], "requiredCapability": f["required_capability"], "idempotencyKey": f["idempotency_key"], "commandSchemaVersion": "v1", "commandSha256": f["command_sha256"], "command": cmd})
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"id": i.ID, "frozen": result, "status": row["ops_knowledge_status"]}, nil
}
func knowledgeReceiptInput(f map[string]any, who Identity, cmd map[string]any) integrationoperation.ReceiptCommandInput {
	raw, _ := json.Marshal(cmd)
	return integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: salesText(cmd, "targetDeployment"), TargetApp: salesText(f, "target_app"), OperationID: salesText(f, "operation_id"), OperationCode: salesText(f, "operation_code"), RequiredCapability: salesText(f, "required_capability"), IdempotencyKey: salesText(f, "idempotency_key"), CommandSchemaVersion: "v1", CommandSHA256: salesText(f, "command_sha256"), Command: raw, OriginalActorUID: who.Actor}
}
func knowledgeDenied(e error) (any, error) {
	if httperrorStatus(e) == 403 || httperrorStatus(e) == 404 {
		return map[string]any{"access": "denied"}, nil
	}
	return nil, e
}
func knowledgePage(v map[string]any, page, size int) map[string]any {
	items, _ := v["items"].([]map[string]any)
	if items == nil {
		items = []map[string]any{}
	}
	total := len(items)
	start := (page - 1) * size
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	return map[string]any{"access": "allowed", "items": items[start:end], "total": total, "page": page, "pageSize": size}
}

func knowledgeAudit(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, row map[string]any, who Identity, action string, value any) error {
	table, e := r.Table("altoc_audit_log")
	if e != nil {
		return e
	}
	raw, e := json.Marshal(value)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO "+table+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('service_ticket',?,?,?,?,?,'user',?)", row["id"], row["code"], action, string(raw), who.Actor, who.RequestID)
	return e
}

func knowledgeReadParent(ctx context.Context, tx *sql.Tx, table, id string) (map[string]any, error) {
	rows, e := queryRows(ctx, tx, "SELECT * FROM "+table+" WHERE id=? AND deleted_at IS NULL", id)
	if e != nil {
		return nil, e
	}
	if len(rows) != 1 {
		return nil, httperror.New(404, "knowledge_source_not_found", "业务对象不存在")
	}
	return rows[0], nil
}
