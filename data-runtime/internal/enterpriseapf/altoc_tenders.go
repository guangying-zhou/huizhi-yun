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
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var tenderOps = map[string][2]string{
	"tenders-page": {"opportunity", "view"}, "tenders-view": {"opportunity", "view"},
	"tenders-create": {"opportunity", "edit"}, "tenders-update": {"opportunity", "edit"},
	"tender-agencies-page": {"opportunity", "view"}, "tender-agencies-create": {"opportunity", "edit"},
	"tender-members-add": {"opportunity", "edit"}, "tender-members-remove": {"opportunity", "edit"},
	"tender-milestones-create": {"opportunity", "edit"}, "tender-milestones-update": {"opportunity", "edit"},
}

func IsTenderOperation(op string) bool { _, ok := tenderOps[op]; return ok }

var tenderTextFields = map[string]int{"name": 200, "owner_uid": 50, "owner_dept_code": 50, "presales_user_id": 50, "project_code": 100, "tenderer_name": 200, "contact_phone": 30, "contact_email": 100, "competitors": 10000, "key_requirements": 10000, "lost_to": 200, "lost_reason_detail": 10000, "improvement_suggestion": 10000, "remark": 500}
var tenderEnums = map[string][]string{
	"status":           {"info_gathering", "qualification", "bid_preparation", "bid_submitted", "bid_opening", "won", "lost", "review_done", "abandoned"},
	"tender_type":      {"open", "invited", "negotiation", "single_source", "inquiry"},
	"lost_reason_type": {"price", "technical", "qualification", "relationship", "other"},
}
var tenderDates = []string{"publish_date", "registration_deadline", "bid_submission_deadline", "bid_opening_date", "winning_notice_date"}
var tenderMoney = []string{"budget_amount", "bid_amount", "bid_bond_amount", "winning_amount", "lost_to_amount"}
var tenderRefs = []string{"opportunity_id", "customer_id", "agency_id", "contact_id"}

func validateTender(op string, i SalesInput) error {
	if !IsTenderOperation(op) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	add := func(keys ...string) {
		for _, k := range keys {
			fields[k] = true
		}
	}
	isPage := strings.HasSuffix(op, "-page")
	create := op == "tenders-create" || op == "tender-agencies-create"
	if create || isPage {
		if i.ID != "" {
			return salesInvalid()
		}
	} else if !validCustomerID(i.ID) {
		return salesInvalid()
	}
	if isPage {
		add("page", "pageSize", "search")
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
		if v, ok := i.Payload["search"]; ok && !stringValue(v, 200, true) {
			return salesInvalid()
		}
	} else if op == "tenders-view" {
		if len(i.Payload) != 0 {
			return salesInvalid()
		}
	} else {
		if !create {
			add("expectedVersion")
			n, ok := i.Payload["expectedVersion"].(float64)
			if !ok || n < 1 || n > 4294967295 || n != float64(int64(n)) {
				return salesInvalid()
			}
		}
		switch op {
		case "tenders-create", "tenders-update":
			for k, max := range tenderTextFields {
				add(k)
				if v, ok := i.Payload[k]; ok && !stringValue(v, max, k != "name" && k != "owner_uid") {
					return salesInvalid()
				}
			}
			for k, values := range tenderEnums {
				add(k)
				if v, ok := i.Payload[k]; ok && v != nil && v != "" && !containsSalesSupport(values, fmt.Sprint(v)) {
					return salesInvalid()
				}
			}
			for _, k := range tenderDates {
				add(k)
				if v, ok := i.Payload[k]; ok && v != nil && v != "" {
					s, ok := v.(string)
					_, e := time.Parse("2006-01-02", s)
					if !ok || e != nil {
						return salesInvalid()
					}
				}
			}
			for _, k := range tenderMoney {
				add(k)
				if v, ok := i.Payload[k]; ok && v != nil {
					if !validMoney(v) {
						return salesInvalid()
					}
				}
			}
			for _, k := range tenderRefs {
				add(k)
				if v, ok := i.Payload[k]; ok && v != nil && v != "" && !validCustomerID(fmt.Sprint(v)) {
					return salesInvalid()
				}
			}
			if create && (!stringValue(i.Payload["name"], 200, false) || !stringValue(i.Payload["owner_uid"], 50, false)) {
				return salesInvalid()
			}
			if !create && len(i.Payload) < 2 {
				return salesInvalid()
			}
		case "tender-agencies-create":
			add("name", "agency_type", "address", "contact_name", "contact_phone", "contact_email")
			for k, max := range map[string]int{"name": 200, "address": 500, "contact_name": 50, "contact_phone": 30, "contact_email": 100} {
				if v, ok := i.Payload[k]; ok && !stringValue(v, max, k != "name") {
					return salesInvalid()
				}
			}
			if !stringValue(i.Payload["name"], 200, false) || !containsSalesSupport([]string{"government", "group", "third_party"}, salesText(i.Payload, "agency_type")) {
				return salesInvalid()
			}
		case "tender-members-add":
			add("user_id", "role")
			if !stringValue(i.Payload["user_id"], 50, false) || !containsSalesSupport([]string{"pm", "business", "presales", "technical", "finance", "member"}, salesText(i.Payload, "role")) {
				return salesInvalid()
			}
		case "tender-members-remove":
			add("childId")
			if !validCustomerID(salesText(i.Payload, "childId")) {
				return salesInvalid()
			}
		case "tender-milestones-create", "tender-milestones-update":
			add("name", "due_date", "status", "assignee_user_id", "sort_no", "remark")
			if strings.HasSuffix(op, "-update") {
				add("childId")
				if !validCustomerID(salesText(i.Payload, "childId")) {
					return salesInvalid()
				}
			}
			for k, max := range map[string]int{"name": 200, "assignee_user_id": 50, "remark": 500} {
				if v, ok := i.Payload[k]; ok && !stringValue(v, max, k != "name") {
					return salesInvalid()
				}
			}
			if strings.HasSuffix(op, "-create") && !stringValue(i.Payload["name"], 200, false) {
				return salesInvalid()
			}
			if v, ok := i.Payload["due_date"]; ok && v != nil && v != "" {
				s, ok := v.(string)
				_, e := time.Parse("2006-01-02", s)
				if !ok || e != nil {
					return salesInvalid()
				}
			}
			if v, ok := i.Payload["status"]; ok && !containsSalesSupport([]string{"todo", "in_progress", "done", "overdue"}, fmt.Sprint(v)) {
				return salesInvalid()
			}
			if v, ok := i.Payload["sort_no"]; ok {
				n, ok := v.(float64)
				if !ok || n < 0 || n > 1000000 || n != float64(int64(n)) {
					return salesInvalid()
				}
			}
		}
	}
	for k := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
	}
	return nil
}
func validMoney(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	if len(s) > 19 {
		return false
	}
	parts := strings.Split(s, ".")
	if len(parts) > 2 || len(parts[0]) < 1 || len(parts[0]) > 16 {
		return false
	}
	for _, p := range parts {
		if p == "" {
			return false
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return false
			}
		}
	}
	return len(parts) == 1 || len(parts[1]) <= 2
}

func (s *Service) Tenders(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = httperror.New(409, "altoc_tender_write_conflict", "资料已变化，请刷新后重试")
		}
	}()

	if e := validateTender(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, httperror.New(403, "altoc_tender_identity_invalid", "Verified actor required")
	}
	if !domaininstall.IsAltocTendersDomain(s.binding.Domains["altoc"]) {
		return nil, httperror.New(503, "altoc_tenders_not_installed", "投标功能尚未安装")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	write := tenderOps[op][1] == "edit"
	operation := enterprise.Read
	if write {
		operation = enterprise.Write
		if who.Key == "" {
			return nil, salesInvalid()
		}
	}
	req, e := s.request("altoc", operation)
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
	table := func(n string) string { t, _ := r.Table("altoc_" + n); return t }
	// All sales writers take the stage gate first; references precede tender children.
	if write {
		if _, e = salesRow(ctx, tx, table("opportunity_stage"), "1=1 ORDER BY id"); e != nil && httperrorStatus(e) != 404 {
			return nil, e
		}
	}
	var parent map[string]any
	if i.ID != "" {
		if write {
			parent, e = salesRow(ctx, tx, table("tender"), "id=? AND deleted_at IS NULL", i.ID)
		} else {
			var rows []map[string]any
			rows, e = queryRows(ctx, tx, "SELECT *,owner_user_id AS owner_uid FROM "+table("tender")+" WHERE id=? AND deleted_at IS NULL", i.ID)
			if e == nil {
				if len(rows) == 0 {
					e = httperror.New(404, "altoc_tender_not_found", "投标不存在")
				} else {
					parent = rows[0]
				}
			}
		}
		if e != nil {
			return nil, e
		}
		parent["owner_uid"] = parent["owner_user_id"]
		if e = salesScope(scope, who.Actor, parent); e != nil {
			return nil, e
		}
	}
	if !write {
		out, e := tenderRead(ctx, tx, table, op, i, who.Actor, scope, parent)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	// Validate current source and target facts before looking up an old receipt.
	if op == "tenders-create" || parent != nil {
		target := map[string]any{"owner_uid": i.Payload["owner_uid"], "owner_dept_code": i.Payload["owner_dept_code"]}
		if parent != nil {
			for _, k := range []string{"owner_uid", "owner_dept_code"} {
				if _, ok := i.Payload[k]; !ok {
					target[k] = parent[k]
				}
			}
		}
		if e = salesScope(scope, who.Actor, target); e != nil {
			return nil, e
		}
		refs := map[string]any{}
		for _, k := range tenderRefs {
			refs[k] = i.Payload[k]
			if parent != nil {
				if _, ok := i.Payload[k]; !ok {
					refs[k] = parent[k]
				}
			}
		}
		var customer, opp map[string]any
		if refs["customer_id"] != nil && refs["customer_id"] != "" {
			customer, e = salesRow(ctx, tx, table("customer"), "id=? AND deleted_at IS NULL", refs["customer_id"])
			if e != nil {
				return nil, e
			}
			if e = salesScope(scope, who.Actor, customer); e != nil {
				return nil, e
			}
		}
		if refs["opportunity_id"] != nil && refs["opportunity_id"] != "" {
			opp, e = salesRow(ctx, tx, table("opportunity"), "id=? AND deleted_at IS NULL", refs["opportunity_id"])
			if e != nil {
				return nil, e
			}
			if e = salesScope(scope, who.Actor, opp); e != nil {
				return nil, e
			}
			if customer != nil && fmt.Sprint(opp["customer_id"]) != fmt.Sprint(customer["id"]) {
				return nil, salesInvalid()
			}
		}
		if refs["contact_id"] != nil && refs["contact_id"] != "" {
			if customer == nil {
				return nil, salesInvalid()
			}
			if _, e = salesRow(ctx, tx, table("contact"), "id=? AND customer_id=? AND deleted_at IS NULL", refs["contact_id"], customer["id"]); e != nil {
				return nil, e
			}
		}
		if refs["agency_id"] != nil && refs["agency_id"] != "" {
			if _, e = salesRow(ctx, tx, table("tender_agency"), "id=?", refs["agency_id"]); e != nil {
				return nil, e
			}
		}
	}
	childID := salesText(i.Payload, "childId")
	if childID != "" && op != "tender-members-remove" {
		n := "tender_member"
		if strings.Contains(op, "milestones") {
			n = "tender_milestone"
		}
		if _, e = salesRow(ctx, tx, table(n), "id=? AND tender_id=?", childID, i.ID); e != nil {
			return nil, e
		}
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("apf16a|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
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
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.apf16a." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if parent != nil && fmt.Sprint(parent["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
			return fail(httperror.New(409, "altoc_tender_version_conflict", "资料版本已变化"))
		}
		fields := map[string]any{}
		for k, v := range i.Payload {
			if k != "expectedVersion" && k != "childId" {
				if v == "" && k != "name" && k != "owner_uid" {
					v = nil
				}
				fields[k] = v
			}
		}
		id := i.ID
		switch op {
		case "tenders-create", "tenders-update":
			if v, ok := fields["owner_uid"]; ok {
				fields["owner_user_id"] = v
				delete(fields, "owner_uid")
			}
			if op == "tenders-create" {
				fields["code"] = salesCode("TD-", oid)
				fields["created_by"] = who.Actor
				fields["updated_by"] = who.Actor
				id, e = salesInsert(ctx, tx, table("tender"), fields)
			} else {
				e = salesUpdate(ctx, tx, table("tender"), id, fields, who.Actor)
			}
		case "tender-agencies-create":
			fields["created_by"] = who.Actor
			fields["updated_by"] = who.Actor
			id, e = salesInsert(ctx, tx, table("tender_agency"), fields)
		case "tender-members-add":
			fields["tender_id"] = i.ID
			fields["created_by"] = who.Actor
			fields["updated_by"] = who.Actor
			id, e = salesInsert(ctx, tx, table("tender_member"), fields)
		case "tender-members-remove":
			if _, e = salesRow(ctx, tx, table("tender_member"), "id=? AND tender_id=?", childID, i.ID); e != nil {
				return fail(e)
			}
			_, e = tx.ExecContext(ctx, "DELETE FROM "+table("tender_member")+" WHERE id=? AND tender_id=?", childID, i.ID)
			id = childID
		case "tender-milestones-create", "tender-milestones-update":
			if fields["status"] == "done" {
				fields["completed_at"] = time.Now().UTC()
			} else if _, ok := fields["status"]; ok {
				fields["completed_at"] = nil
			}
			if strings.HasSuffix(op, "-create") {
				fields["tender_id"] = i.ID
				fields["created_by"] = who.Actor
				fields["updated_by"] = who.Actor
				id, e = salesInsert(ctx, tx, table("tender_milestone"), fields)
			} else {
				id = childID
				e = salesUpdate(ctx, tx, table("tender_milestone"), id, fields, who.Actor)
			}
		}
		if e != nil {
			return fail(e)
		}
		if strings.Contains(op, "members") || strings.Contains(op, "milestones") {
			if e = salesUpdate(ctx, tx, table("tender"), i.ID, map[string]any{}, who.Actor); e != nil {
				return fail(e)
			}
		}
		audit, _ := r.Table("altoc_audit_log")
		auditType, auditID := "tender", id
		if op == "tender-agencies-create" {
			auditType = "tender_agency"
		}
		if strings.Contains(op, "members") || strings.Contains(op, "milestones") {
			auditID = i.ID
		}
		snapshot, _ := json.Marshal(map[string]any{"operation": op, "id": id, "parentId": i.ID})
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,action,operator_uid,request_id,new_value) VALUES (?,?,?,?,?,?)", auditType, auditID, op, who.Actor, who.RequestID, string(snapshot)); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "tender", TargetBizCode: id, HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "altoc_tender_idempotency_conflict", "同一操作键的内容已变化")
	}
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"id": result.TargetBizCode}, nil
}
func tenderRead(ctx context.Context, tx *sql.Tx, table func(string) string, op string, i SalesInput, actor string, scope altoc.BasicReadScope, parent map[string]any) (any, error) {
	if op == "tenders-view" {
		for _, n := range []string{"customer", "opportunity"} {
			ref := parent[n+"_id"]
			if ref == nil {
				continue
			}
			rows, e := queryRows(ctx, tx, "SELECT owner_uid,owner_dept_code FROM "+table(n)+" WHERE id=? AND deleted_at IS NULL", ref)
			if e != nil {
				return nil, e
			}
			if len(rows) == 0 {
				return nil, httperror.New(404, "altoc_tender_reference_not_found", "关联对象不可用")
			}
			if e = salesScope(scope, actor, rows[0]); e != nil {
				return nil, e
			}
		}
		for _, n := range []string{"member", "milestone"} {
			rows, e := queryRows(ctx, tx, "SELECT * FROM "+table("tender_"+n)+" WHERE tender_id=? ORDER BY id", i.ID)
			if e != nil {
				return nil, e
			}
			parent[n+"s"] = rows
		}
		return parent, nil
	}
	n := "tender"
	where := "1=1"
	args := []any{}
	if op == "tender-agencies-page" {
		n = "tender_agency"
	} else {
		var e error
		where, args, e = scopeSQL("altoc", actor, scope)
		if e != nil {
			return nil, e
		}
		where = strings.ReplaceAll(strings.ReplaceAll(where, "owner_uid", "t.owner_user_id"), "owner_dept_code", "t.owner_dept_code") + " AND t.deleted_at IS NULL"
		for _, ref := range []string{"customer", "opportunity"} {
			rw, ra, e := scopeSQL("altoc", actor, scope)
			if e != nil {
				return nil, e
			}
			rw = strings.ReplaceAll(strings.ReplaceAll(rw, "owner_uid", "related.owner_uid"), "owner_dept_code", "related.owner_dept_code")
			where += " AND (t." + ref + "_id IS NULL OR EXISTS (SELECT 1 FROM " + table(ref) + " related WHERE related.id=t." + ref + "_id AND related.deleted_at IS NULL AND " + rw + "))"
			args = append(args, ra...)
		}
	}
	if search := salesText(i.Payload, "search"); search != "" {
		where += " AND t.name LIKE ?"
		args = append(args, "%"+search+"%")
	}
	var total int64
	if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table(n)+" t WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	page, size := int(i.Payload["page"].(float64)), int(i.Payload["pageSize"].(float64))
	items, e := queryRows(ctx, tx, "SELECT t.* FROM "+table(n)+" t WHERE "+where+" ORDER BY t.id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": size}, e
}
