package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var salesSupportOps = map[string][2]string{
	"lead-activities-list": {"lead", "view"}, "opportunity-activities-list": {"opportunity", "view"},
	"opportunity-contact-roles-list": {"opportunity", "view"}, "opportunity-contact-roles-create": {"opportunity", "edit"}, "opportunity-contact-roles-update": {"opportunity", "edit"}, "opportunity-contact-roles-delete": {"opportunity", "edit"},
	"opportunity-stages-list": {"opportunity", "view"}, "opportunity-stage-history-list": {"opportunity", "view"},
	"lead-documents-list": {"lead", "view"}, "lead-documents-create": {"lead", "edit"}, "lead-documents-delete": {"lead", "edit"},
	"opportunity-documents-list": {"opportunity", "view"}, "opportunity-documents-create": {"opportunity", "edit"}, "opportunity-documents-delete": {"opportunity", "edit"},
}

func SalesSupportPermission(op string, i SalesInput) (string, string, bool) {
	p, ok := salesSupportOps[op]
	if op == "opportunity-stages-list" && i.Payload["purpose"] == "lead-convert" {
		return "lead", "convert", ok
	}
	return p[0], p[1], ok
}
func IsSalesSupport(op string) bool { _, ok := salesSupportOps[op]; return ok }
func validateSalesSupport(op string, i SalesInput) error {
	_, action, ok := SalesSupportPermission(op, i)
	if !ok {
		return salesInvalid()
	}
	config := op == "opportunity-stages-list"
	if config {
		if i.ID != "" {
			return salesInvalid()
		}
	} else if !validCustomerID(i.ID) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	if action == "view" || config {
		fields["page"] = true
		fields["pageSize"] = true
		for _, k := range []string{"page", "pageSize"} {
			n, ok := i.Payload[k].(float64)
			max := float64(1000000)
			if k == "pageSize" {
				max = 100
			}
			if !ok || n < 1 || n > max || n != float64(int64(n)) {
				return salesInvalid()
			}
		}
	} else {
		fields["expectedVersion"] = true
		n, ok := i.Payload["expectedVersion"].(float64)
		if !ok || n < 1 || n > 4294967295 || n != float64(int64(n)) {
			return salesInvalid()
		}
	}
	if config {
		fields["purpose"] = true
		if i.Payload["purpose"] != "opportunity-view" && i.Payload["purpose"] != "lead-convert" {
			return salesInvalid()
		}
	}
	if strings.HasSuffix(op, "-update") || strings.HasSuffix(op, "-delete") {
		fields["childId"] = true
		if !validCustomerID(salesText(i.Payload, "childId")) {
			return salesInvalid()
		}
	}
	if strings.Contains(op, "contact-roles") && (strings.HasSuffix(op, "-create") || strings.HasSuffix(op, "-update")) {
		for _, k := range []string{"contactId", "role", "influence_level", "attitude", "is_primary", "remark"} {
			fields[k] = true
		}
		if !validCustomerID(salesText(i.Payload, "contactId")) {
			return salesInvalid()
		}
		allowed := map[string][]string{"role": {"decision_maker", "economic_buyer", "sponsor", "procurement", "technical_influencer", "end_user", "competitor_supporter"}, "influence_level": {"high", "medium", "low"}, "attitude": {"supportive", "neutral", "resistant", "unknown"}}
		for k, values := range allowed {
			if !containsSalesSupport(values, salesText(i.Payload, k)) {
				return salesInvalid()
			}
		}
		if _, ok := i.Payload["is_primary"].(bool); !ok {
			return salesInvalid()
		}
		if v, ok := i.Payload["remark"]; ok && !stringValue(v, 500, true) {
			return salesInvalid()
		}
	}
	if strings.Contains(op, "documents-create") {
		fields["document_uuid"] = true
		fields["link_type"] = true
		u, err := uuid.Parse(salesText(i.Payload, "document_uuid"))
		if err != nil || u == uuid.Nil || u.String() != salesText(i.Payload, "document_uuid") {
			return salesInvalid()
		}
		if !containsSalesSupport([]string{"proposal", "contract_text", "meeting_memo", "tender_doc", "evidence", "general"}, salesText(i.Payload, "link_type")) {
			return salesInvalid()
		}
	}
	for k := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
	}
	return nil
}
func containsSalesSupport(values []string, s string) bool {
	for _, v := range values {
		if v == s {
			return true
		}
	}
	return false
}

// DocumentRead is a narrow owning-domain ACL reader, supplied only by the
// authenticated Runtime route. It never consumes a caller's claimed ACL.
type SalesDocumentRead func(context.Context, string, string) (map[string]any, error)

func (s *Service) SalesSupport(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope, read SalesDocumentRead) (out any, err error) {
	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = httperror.New(409, "altoc_sales_write_conflict", "资料已变化，请刷新后重试")
		}
	}()
	if e := validateSalesSupport(op, i); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, httperror.New(403, "altoc_sales_identity_invalid", "Verified actor required")
	}
	if !domaininstall.IsAltocSalesDomain(s.binding.Domains["altoc"]) {
		return nil, httperror.New(503, "altoc_sales_not_installed", "销售主链尚未安装")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	resource, action, _ := SalesSupportPermission(op, i)
	write := action == "edit"
	if write && who.Key == "" {
		return nil, salesInvalid()
	}
	operation := enterprise.Read
	if write {
		operation = enterprise.Write
	}
	req, e := s.request("altoc", operation)
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	if write {
		tx, resolved, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		tx, resolved, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := resolved[0]
	table := func(n string) string { t, _ := r.Table("altoc_" + n); return t }
	// Same first lock as the main sales commands; parent and contact locks cannot
	// invert against conversion/transition. Reads remain one COUNT/page snapshot.
	if write {
		if _, e = salesRow(ctx, tx, table("opportunity_stage"), "1=1 ORDER BY id"); e != nil {
			if httperrorStatus(e) == 404 {
				return nil, httperror.New(503, "altoc_sales_stage_unavailable", "销售管道尚未配置")
			}
			return nil, e
		}
	}
	var parent map[string]any
	if op != "opportunity-stages-list" {
		if write {
			parent, e = salesRow(ctx, tx, table(resource), "id=? AND deleted_at IS NULL", i.ID)
		} else {
			parent, e = salesSupportReadParent(ctx, tx, table(resource), i.ID)
		}
		if e != nil {
			return nil, e
		}
		if e = salesScope(scope, who.Actor, parent); e != nil {
			return nil, e
		}
	}
	if !write {
		out, e := salesSupportList(ctx, tx, table, op, i, parent)
		if e != nil {
			return nil, e
		}
		if strings.HasSuffix(op, "documents-list") {
			data := out.(map[string]any)
			for _, link := range data["items"].([]map[string]any) {
				documentUUID := salesText(link, "document_uuid")
				link["readable"] = false
				link["document_title"] = "无权查看文档"
				link["document_uuid"] = nil
				if documentUUID == "" {
					continue
				}
				if read == nil {
					return nil, httperror.New(503, "altoc_document_acl_unavailable", "文档权限暂不可用")
				}
				doc, aclErr := read(ctx, documentUUID, who.Actor)
				aclErr = salesDocumentFailure(aclErr)
				if httperrorStatus(aclErr) == 403 || httperrorStatus(aclErr) == 404 {
					continue
				}
				if aclErr != nil {
					return nil, aclErr
				}
				if salesText(doc, "uuid") != documentUUID {
					continue
				}
				link["readable"] = true
				link["document_uuid"] = documentUUID
				link["document_title"] = doc["title"]
			}
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	var child, contact, doc map[string]any
	childTable := "document_link"
	if strings.Contains(op, "contact-roles") {
		childTable = "opportunity_contact_role"
	}
	childID := salesText(i.Payload, "childId")
	if childID != "" {
		where := "id=? AND entity_type=? AND entity_id=?"
		args := []any{childID, resource, i.ID}
		if childTable == "opportunity_contact_role" {
			where = "id=? AND opportunity_id=?"
			args = []any{childID, i.ID}
		}
		child, e = salesRow(ctx, tx, table(childTable), where, args...)
		if e != nil {
			return nil, e
		}
	}
	if childTable == "opportunity_contact_role" && !strings.HasSuffix(op, "-delete") {
		contact, e = salesRow(ctx, tx, table("contact"), "id=? AND customer_id=? AND deleted_at IS NULL", i.Payload["contactId"], parent["customer_id"])
		if e != nil {
			return nil, e
		}
	}
	if strings.HasSuffix(op, "documents-create") {
		if read == nil {
			return nil, httperror.New(503, "altoc_document_acl_unavailable", "文档权限暂不可用")
		}
		doc, e = read(ctx, salesText(i.Payload, "document_uuid"), who.Actor)
		e = salesDocumentFailure(e)
		if e != nil {
			return nil, e
		}
		if salesText(doc, "uuid") != salesText(i.Payload, "document_uuid") {
			return nil, httperror.New(404, "altoc_document_not_found", "文档不存在")
		}
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("apf07b|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	command := map[string]any{"operation": op, "intent": SalesIntent(i), "actor": who.Actor}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(command)
	rt, _ := r.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(rt))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.apf07b." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if fmt.Sprint(parent["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
			return fail(httperror.New(409, "altoc_sales_version_conflict", "资料版本已变化"))
		}
		if child != nil && child["deleted_at"] != nil {
			return fail(httperror.New(404, "altoc_sales_child_not_found", "关联不存在"))
		}
		fields := map[string]any{}
		if childTable == "opportunity_contact_role" {
			fields = map[string]any{"role": i.Payload["role"], "influence_level": i.Payload["influence_level"], "attitude": i.Payload["attitude"], "is_primary": i.Payload["is_primary"], "remark": i.Payload["remark"]}
		}
		if childTable == "opportunity_contact_role" && fields["is_primary"] == true {
			if _, e = tx.ExecContext(ctx, "UPDATE "+table(childTable)+" SET is_primary=0,row_version=row_version+1,updated_by=? WHERE opportunity_id=? AND deleted_at IS NULL AND is_primary=1", who.Actor, i.ID); e != nil {
				return fail(e)
			}
		}
		if strings.HasSuffix(op, "-delete") {
			_, e = tx.ExecContext(ctx, "UPDATE "+table(childTable)+" SET deleted_at=CURRENT_TIMESTAMP(3) WHERE id=? AND deleted_at IS NULL", childID)
		} else if strings.HasSuffix(op, "-update") {
			fields["contact_id"] = contact["id"]
			e = salesUpdate(ctx, tx, table(childTable), childID, fields, who.Actor)
		} else {
			if childTable == "opportunity_contact_role" {
				fields["opportunity_id"] = i.ID
				fields["contact_id"] = contact["id"]
				fields["updated_by"] = who.Actor
			} else {
				fields = map[string]any{"entity_type": resource, "entity_id": i.ID, "document_uuid": i.Payload["document_uuid"], "document_title": doc["title"], "source_type": "codocs", "link_type": i.Payload["link_type"]}
			}
			fields["created_by"] = who.Actor
			if childTable == "document_link" {
				existing, lookup := salesRow(ctx, tx, table(childTable), "entity_type=? AND entity_id=? AND BINARY document_uuid=BINARY ?", resource, i.ID, i.Payload["document_uuid"])
				if lookup == nil {
					if existing["deleted_at"] == nil {
						return fail(httperror.New(409, "altoc_document_link_exists", "文档已关联"))
					}
					childID = fmt.Sprint(existing["id"])
					_, e = tx.ExecContext(ctx, "UPDATE "+table(childTable)+" SET deleted_at=NULL,document_title=?,link_type=?,created_by=? WHERE id=?", doc["title"], i.Payload["link_type"], who.Actor, childID)
				} else if httperrorStatus(lookup) == 404 {
					childID, e = salesInsert(ctx, tx, table(childTable), fields)
				} else {
					e = lookup
				}
			} else {
				childID, e = salesInsert(ctx, tx, table(childTable), fields)
			}
		}
		if e != nil {
			return fail(e)
		}
		if e = salesUpdate(ctx, tx, table(resource), i.ID, map[string]any{}, who.Actor); e != nil {
			return fail(e)
		}
		audit, _ := r.Table("altoc_audit_log")
		snapshot, _ := json.Marshal(map[string]any{"childId": childID, "operation": op})
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,action,operator_uid,request_id,new_value) VALUES (?,?,?,?,?,?)", resource, i.ID, "apf07b", who.Actor, who.RequestID, string(snapshot)); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: resource, TargetBizCode: childID + ":" + fmt.Sprint(salesInt(parent["row_version"])+1), HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "altoc_sales_idempotency_conflict", "同一操作键的内容已变化")
	}
	if e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":")
	if len(parts) != 2 {
		return nil, httperror.New(503, "altoc_receipt_invalid", "回执不可用")
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"childId": parts[0], "parentVersion": parts[1]}, nil
}
func salesSupportList(ctx context.Context, tx *sql.Tx, table func(string) string, op string, i SalesInput, parent map[string]any) (any, error) {
	t, where, args, cols := "", "", []any{}, ""
	switch {
	case op == "opportunity-stages-list":
		t = "opportunity_stage"
		where = "pipeline_code='default' AND is_enabled=1"
		cols = "id,code,name,stage_kind,sort_no,win_rate"
	case strings.Contains(op, "activities-list"):
		t = "sales_activity"
		field := "lead_id"
		if strings.HasPrefix(op, "opportunity") {
			field = "opportunity_id"
		}
		where = field + "=? AND deleted_at IS NULL"
		args = []any{i.ID}
		cols = "id,activity_type,subject,content,result_summary,activity_at,next_action,next_action_due_at,owner_uid"
	case strings.Contains(op, "contact-roles-list"):
		t = "opportunity_contact_role"
		where = "opportunity_id=? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM " + table("contact") + " c WHERE c.id=contact_id AND c.customer_id=? AND c.deleted_at IS NULL)"
		args = []any{i.ID, parent["customer_id"]}
		cols = "id,contact_id,(SELECT c.name FROM " + table("contact") + " c WHERE c.id=contact_id AND c.customer_id=? AND c.deleted_at IS NULL) AS contact_name,role,influence_level,attitude,is_primary,remark,row_version"
	case op == "opportunity-stage-history-list":
		t = "opportunity_stage_log"
		where = "opportunity_id=?"
		args = []any{i.ID}
		cols = "id,from_stage_id,(SELECT s.name FROM " + table("opportunity_stage") + " s WHERE s.id=from_stage_id) AS from_stage_name,to_stage_id,(SELECT s.name FROM " + table("opportunity_stage") + " s WHERE s.id=to_stage_id) AS to_stage_name,changed_by,changed_at,change_reason,version_no"
	default:
		t = "document_link"
		entity := "lead"
		if strings.HasPrefix(op, "opportunity") {
			entity = "opportunity"
		}
		where = "entity_type=? AND entity_id=? AND deleted_at IS NULL"
		args = []any{entity, i.ID}
		cols = "id,document_uuid,document_title,link_type,source_type,created_at"
	}
	selectArgs := []any{}
	if t == "opportunity_contact_role" {
		selectArgs = append(selectArgs, parent["customer_id"])
	}
	var total int64
	if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table(t)+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	page, size := int(i.Payload["page"].(float64)), int(i.Payload["pageSize"].(float64))
	queryArgs := append(append(selectArgs, args...), size, (page-1)*size)
	rows, e := tx.QueryContext(ctx, "SELECT "+cols+" FROM "+table(t)+" WHERE "+where+func() string {
		if t == "opportunity_stage" {
			return " ORDER BY sort_no,id LIMIT ? OFFSET ?"
		}
		return " ORDER BY id DESC LIMIT ? OFFSET ?"
	}(), queryArgs...)
	if e != nil {
		return nil, e
	}
	names, e := rows.Columns()
	if e != nil {
		rows.Close()
		return nil, e
	}
	items, e := readFinanceRows(rows, names)
	if e != nil {
		return nil, e
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": size}, nil
}

func salesSupportReadParent(ctx context.Context, tx *sql.Tx, table, id string) (map[string]any, error) {
	columns := "id,owner_uid,owner_dept_code"
	if strings.HasSuffix(table, "_opportunity") {
		columns += ",customer_id"
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+columns+" FROM "+table+" WHERE id=? AND deleted_at IS NULL", id)
	if e != nil {
		return nil, e
	}
	cols, e := rows.Columns()
	if e != nil {
		rows.Close()
		return nil, e
	}
	values, e := readFinanceRows(rows, cols)
	if e != nil {
		return nil, e
	}
	if len(values) != 1 {
		return nil, httperror.New(404, "altoc_sales_not_found", "业务对象不存在")
	}
	return values[0], nil
}

func salesDocumentFailure(err error) error {
	if err == nil {
		return nil
	}
	if status := httperrorStatus(err); status == 403 || status == 404 || status == 503 {
		return err
	}
	return httperror.New(503, "altoc_document_dependency_unavailable", "文档权限依赖暂不可用")
}
