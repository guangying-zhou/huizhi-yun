package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"time"
)

var serviceAgreementOps = map[string][2]string{
	"service-agreements-page": {"contract", "view"}, "service-agreements-view": {"contract", "view"}, "service-agreements-create": {"contract", "edit"}, "service-agreements-update": {"contract", "edit"},
	"service-coverages-page": {"contract", "view"}, "service-coverages-create": {"contract", "edit"}, "service-coverages-resolve": {"contract", "edit"}, "service-coverages-suspend": {"contract", "edit"}, "service-coverages-end": {"contract", "edit"},
	"service-projects-page": {"contract", "view"}, "service-projects-bind": {"contract", "edit"}, "service-projects-set-default": {"contract", "edit"}, "service-projects-suspend": {"contract", "edit"}, "service-projects-end": {"contract", "edit"},
}

func IsServiceAgreementOperation(op string) bool { _, ok := serviceAgreementOps[op]; return ok }

var agreementText = map[string]int{"name": 200, "service_level": 50, "service_window": 100, "billing_mode": 50, "renewal_policy": 100, "owner_user_id": 50}
var agreementDates = []string{"service_start_date", "service_end_date", "renewal_remind_at"}

func serviceError(status int, code string) error {
	return httperror.New(status, code, "服务协议操作未完成，请核对资料和当前权限")
}
func validateServiceAgreement(op string, i SalesInput) error {
	if !IsServiceAgreementOperation(op) {
		return salesInvalid()
	}
	fields := map[string]bool{}
	add := func(keys ...string) {
		for _, k := range keys {
			fields[k] = true
		}
	}
	page := strings.HasSuffix(op, "-page")
	create := op == "service-agreements-create"
	if op == "service-agreements-page" || create {
		if i.ID != "" {
			return salesInvalid()
		}
	} else if !validCustomerID(i.ID) {
		return salesInvalid()
	}
	if page {
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
	} else if op == "service-agreements-view" {
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
		case "service-agreements-create", "service-agreements-update":
			for k, max := range agreementText {
				add(k)
				if v, ok := i.Payload[k]; ok && !stringValue(v, max, k != "name") {
					return salesInvalid()
				}
			}
			for _, k := range agreementDates {
				add(k)
				if v, ok := i.Payload[k]; ok && v != nil && v != "" {
					s, ok := v.(string)
					if _, e := time.Parse("2006-01-02", s); !ok || e != nil {
						return salesInvalid()
					}
				}
			}
			add("response_minutes", "resolution_minutes", "included_quota", "quota_unit", "status")
			for _, k := range []string{"response_minutes", "resolution_minutes"} {
				if v, ok := i.Payload[k]; ok && v != nil {
					n, ok := v.(float64)
					if !ok || n < 1 || n > 10000000 || n != float64(int64(n)) {
						return salesInvalid()
					}
				}
			}
			if v, ok := i.Payload["included_quota"]; ok && v != nil && (!validMoney(v) || len(strings.Split(fmt.Sprint(v), ".")[0]) > 8) {
				return salesInvalid()
			}
			if v, ok := i.Payload["quota_unit"]; ok && v != nil && v != "" && !containsSalesSupport([]string{"ticket", "hour", "day"}, fmt.Sprint(v)) {
				return salesInvalid()
			}
			if v, ok := i.Payload["status"]; ok && !containsSalesSupport([]string{"planned", "active", "suspended", "expired", "terminated", "cancelled"}, fmt.Sprint(v)) {
				return salesInvalid()
			}
			if create {
				add("contract_id", "contract_line_id")
				if !validCustomerID(salesText(i.Payload, "contract_id")) || !stringValue(i.Payload["name"], 200, false) {
					return salesInvalid()
				}
				if v, ok := i.Payload["contract_line_id"]; ok && v != nil && !validCustomerID(fmt.Sprint(v)) {
					return salesInvalid()
				}
			}
		case "service-coverages-create", "service-coverages-resolve":
			add("target_type", "source_plan_code", "delivery_asset_code", "environment_code", "coverage_scope", "effective_from", "effective_to", "included", "exclusion_note")
			if op == "service-coverages-resolve" {
				add("childId")
				if !validCustomerID(salesText(i.Payload, "childId")) {
					return salesInvalid()
				}
			}
			target := salesText(i.Payload, "target_type")
			if !containsSalesSupport([]string{"pending_plan", "delivery_asset", "environment", "delivery_asset_environment"}, target) || op == "service-coverages-resolve" && target == "pending_plan" {
				return salesInvalid()
			}
			for k, max := range map[string]int{"source_plan_code": 100, "delivery_asset_code": 100, "environment_code": 100, "coverage_scope": 50, "exclusion_note": 500} {
				if v, ok := i.Payload[k]; ok && v != nil && !stringValue(v, max, true) {
					return salesInvalid()
				}
			}
			if target == "pending_plan" {
				if !stringValue(i.Payload["source_plan_code"], 100, false) || salesText(i.Payload, "delivery_asset_code") != "" || salesText(i.Payload, "environment_code") != "" {
					return salesInvalid()
				}
			} else {
				needAsset := target != "environment"
				needEnv := target != "delivery_asset"
				if needAsset != (salesText(i.Payload, "delivery_asset_code") != "") || needEnv != (salesText(i.Payload, "environment_code") != "") {
					return salesInvalid()
				}
			}
			for _, k := range []string{"effective_from", "effective_to"} {
				if v, ok := i.Payload[k]; ok && v != nil && v != "" {
					s, ok := v.(string)
					if _, e := time.Parse("2006-01-02", s); !ok || e != nil {
						return salesInvalid()
					}
				}
			}
			if v, ok := i.Payload["included"]; ok {
				if _, ok := v.(bool); !ok {
					return salesInvalid()
				}
			}
		case "service-coverages-suspend", "service-coverages-end", "service-projects-set-default", "service-projects-suspend", "service-projects-end":
			add("childId")
			if !validCustomerID(salesText(i.Payload, "childId")) {
				return salesInvalid()
			}
		case "service-projects-bind":
			add("project_code", "project_role")
			if !stringValue(i.Payload["project_code"], 64, false) || !containsSalesSupport([]string{"maintenance", "operation", "inspection", "upgrade", "special"}, salesText(i.Payload, "project_role")) {
				return salesInvalid()
			}
		}
	}

	for _, pair := range [][2]string{{"service_start_date", "service_end_date"}, {"effective_from", "effective_to"}} {
		a, b := salesText(i.Payload, pair[0]), salesText(i.Payload, pair[1])
		if a != "" && b != "" && a > b {
			return salesInvalid()
		}
	}
	for k, v := range i.Payload {
		if !fields[k] {
			return salesInvalid()
		}
		if v != nil {
			switch v.(type) {
			case string, float64, bool:
			default:
				return salesInvalid()
			}
		}
	}
	if !page && op != "service-agreements-view" && !create && len(i.Payload) < 2 {
		return salesInvalid()
	}
	return nil
}
func (s *Service) ServiceAgreements(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = serviceError(409, "altoc_service_write_conflict")
		}
	}()
	if e := validateServiceAgreement(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, serviceError(403, "altoc_service_identity_invalid")
	}
	if !domaininstall.IsAltocServicesDomain(s.binding.Domains["altoc"]) {
		return nil, serviceError(503, "altoc_services_not_installed")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	write := serviceAgreementOps[op][1] == "edit"
	mode := enterprise.Read
	if write {
		mode = enterprise.Write
		if who.Key == "" {
			return nil, salesInvalid()
		}
	}
	req, e := s.request("altoc", mode)
	if e != nil {
		return nil, e
	}
	reqs := []enterprise.ResolveRequest{req}
	targetDomain := ""
	if strings.HasPrefix(op, "service-projects-") && write {
		targetDomain = "aims"
	}
	if (op == "service-coverages-create" || op == "service-coverages-resolve") && salesText(i.Payload, "target_type") != "pending_plan" {
		targetDomain = "assets"
	}
	if targetDomain != "" {
		q, e := s.request(targetDomain, enterprise.Write)
		if e != nil {
			return nil, e
		}
		reqs = append(reqs, q)
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if write {
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, reqs...)
	} else {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, reqs...)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	table := func(n string) string { v, _ := r.Table("altoc_" + n); return v }
	if !write {
		data, e := readServiceAgreement(ctx, tx, table, op, i, who.Actor, scope)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return data, nil
	}
	// Discover IDs without locking, then acquire customer → contract → line → agreement → child locks.
	contractID := salesText(i.Payload, "contract_id")
	line := salesText(i.Payload, "contract_line_id")
	if i.ID != "" {
		if e = tx.QueryRowContext(ctx, "SELECT contract_id,COALESCE(contract_line_id,'') FROM "+table("service_agreement")+" WHERE id=? AND deleted_at IS NULL", i.ID).Scan(&contractID, &line); e == sql.ErrNoRows {
			return nil, serviceError(404, "service_agreement_not_found")
		}
		if e != nil {
			return nil, e
		}
	}
	var customerID string
	if e = tx.QueryRowContext(ctx, "SELECT customer_id FROM "+table("contract")+" WHERE id=? AND deleted_at IS NULL", contractID).Scan(&customerID); e == sql.ErrNoRows {
		return nil, serviceError(404, "service_contract_not_found")
	}
	if e != nil {
		return nil, e
	}
	customer, e := salesRow(ctx, tx, table("customer"), "id=? AND deleted_at IS NULL", customerID)
	if e != nil {
		return nil, e
	}
	if e = salesScope(scope, who.Actor, customer); e != nil {
		return nil, e
	}
	contract, e := salesRow(ctx, tx, table("contract"), "id=? AND customer_id=? AND deleted_at IS NULL", contractID, customerID)
	if e != nil {
		return nil, e
	}
	if e = salesScope(scope, who.Actor, contract); e != nil {
		return nil, e
	}
	if fmt.Sprint(contract["status"]) == "cancelled" || fmt.Sprint(contract["status"]) == "voided" {
		return nil, serviceError(409, "service_contract_inactive")
	}
	if line != "" {
		if _, e = salesRow(ctx, tx, table("contract_line"), "id=? AND contract_id=? AND deleted_at IS NULL", line, contractID); e != nil {
			return nil, e
		}
	}
	var parent, child map[string]any
	if i.ID != "" {
		parent, e = salesRow(ctx, tx, table("service_agreement"), "id=? AND contract_id=? AND deleted_at IS NULL", i.ID, contractID)
		if e != nil {
			return nil, e
		}
	}

	childID := salesText(i.Payload, "childId")
	childTable := "service_agreement_coverage"
	if strings.HasPrefix(op, "service-projects-") {
		childTable = "service_agreement_project_rel"
	}
	if childID != "" {
		child, e = salesRow(ctx, tx, table(childTable), "id=? AND service_agreement_id=? AND deleted_at IS NULL", childID, i.ID)
		if e != nil {
			return nil, e
		}
	}
	// Agreement lock serializes defaults; lock siblings before crossing to Aims.
	if strings.HasPrefix(op, "service-projects-") {
		if _, e = queryRows(ctx, tx, "SELECT id FROM "+table(childTable)+" WHERE service_agreement_id=? AND deleted_at IS NULL ORDER BY id FOR UPDATE", i.ID); e != nil {
			return nil, e
		}
		code := salesText(i.Payload, "project_code")
		if child != nil {
			code = fmt.Sprint(child["project_code"])
		}
		if e = aims.CheckServiceProjectTx(ctx, tx, rs[1], who.Actor, code, fmt.Sprint(contract["code"])); e != nil {
			return nil, e
		}
	}
	if op == "service-coverages-create" || op == "service-coverages-resolve" {
		plan := salesText(i.Payload, "source_plan_code")
		if op == "service-coverages-resolve" {
			original := fmt.Sprint(child["source_plan_code"])
			if plan != "" && plan != original {
				return nil, serviceError(409, "service_coverage_source_changed")
			}
			plan = original
		}
		if plan != "" && plan != "<nil>" {
			if _, e = salesRow(ctx, tx, table("contract_delivery_asset_plan"), "BINARY code=BINARY ? AND contract_id=? AND deleted_at IS NULL", plan, contractID); e != nil {
				return nil, e
			}
		}
		if targetDomain == "assets" {
			if e = assets.CheckServiceCoverageTx(ctx, tx, rs[1], fmt.Sprint(customer["code"]), salesText(i.Payload, "delivery_asset_code"), salesText(i.Payload, "environment_code")); e != nil {
				return nil, e
			}
		}
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("apf16b|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
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
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.apf16b." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if parent != nil && fmt.Sprint(parent["row_version"]) != fmt.Sprint(i.Payload["expectedVersion"]) {
			return fail(serviceError(409, "service_agreement_version_conflict"))
		}
		fields := map[string]any{}
		for k, v := range i.Payload {
			if k != "expectedVersion" && k != "childId" {
				if v == "" {
					v = nil
				}
				fields[k] = v
			}
		}
		id := i.ID
		switch op {
		case "service-agreements-create":
			fields["code"] = salesCode("SA-", oid)
			fields["customer_code"] = customer["code"]
			fields["created_by"] = who.Actor
			fields["updated_by"] = who.Actor
			id, e = salesInsert(ctx, tx, table("service_agreement"), fields)
		case "service-agreements-update":
			final := map[string]any{}
			for k, v := range parent {
				final[k] = v
			}
			for k, v := range fields {
				final[k] = v
			}
			if a, b := fmt.Sprint(final["service_start_date"]), fmt.Sprint(final["service_end_date"]); final["service_start_date"] != nil && final["service_end_date"] != nil && a > b {
				return fail(salesInvalid())
			}
			e = salesUpdate(ctx, tx, table("service_agreement"), id, fields, who.Actor)
		case "service-coverages-create":
			fields["coverage_code"] = salesCode("SC-", oid)
			fields["service_agreement_id"] = i.ID
			fields["source_type"] = "manual"
			fields["coverage_status"] = "planned"
			fields["resolution_status"] = "resolved"
			if fields["target_type"] == "pending_plan" {
				fields["resolution_status"] = "pending"
			}
			fields["created_by"] = who.Actor
			fields["updated_by"] = who.Actor
			id, e = salesInsert(ctx, tx, table(childTable), fields)
		case "service-coverages-resolve":
			if fmt.Sprint(child["target_type"]) != "pending_plan" || fmt.Sprint(child["resolution_status"]) != "pending" {
				return fail(serviceError(409, "service_coverage_not_pending"))
			}
			id = childID
			fields["resolution_status"] = "resolved"
			fields["coverage_status"] = "active"
			e = salesUpdate(ctx, tx, table(childTable), id, fields, who.Actor)
		case "service-coverages-suspend", "service-coverages-end":
			id = childID
			status := "suspended"
			if op == "service-coverages-end" {
				status = "ended"
			}
			if fmt.Sprint(child["coverage_status"]) == "ended" || fmt.Sprint(child["coverage_status"]) == "cancelled" {
				return fail(serviceError(409, "service_coverage_terminal"))
			}
			e = salesUpdate(ctx, tx, table(childTable), id, map[string]any{"coverage_status": status}, who.Actor)
		case "service-projects-bind":
			fields["service_agreement_id"] = i.ID
			fields["source_type"] = "manual"
			fields["created_by"] = who.Actor
			fields["updated_by"] = who.Actor
			id, e = salesInsert(ctx, tx, table(childTable), fields)
		case "service-projects-set-default":
			id = childID
			if fmt.Sprint(child["status"]) != "active" {
				return fail(serviceError(409, "service_project_not_active"))
			}
			_, e = tx.ExecContext(ctx, "UPDATE "+table(childTable)+" SET is_default=0,row_version=row_version+1,updated_by=? WHERE service_agreement_id=? AND deleted_at IS NULL AND is_default=1", who.Actor, i.ID)
			if e == nil {
				e = salesUpdate(ctx, tx, table(childTable), id, map[string]any{"is_default": true}, who.Actor)
			}
		case "service-projects-suspend", "service-projects-end":
			id = childID
			status := "suspended"
			if op == "service-projects-end" {
				status = "ended"
			}
			if fmt.Sprint(child["status"]) == "ended" {
				return fail(serviceError(409, "service_project_terminal"))
			}
			e = salesUpdate(ctx, tx, table(childTable), id, map[string]any{"status": status, "is_default": false}, who.Actor)
		}
		if e != nil {
			return fail(e)
		}
		if !strings.HasPrefix(op, "service-agreements-") {
			if e = salesUpdate(ctx, tx, table("service_agreement"), i.ID, map[string]any{}, who.Actor); e != nil {
				return fail(e)
			}
		}
		audit, _ := r.Table("altoc_audit_log")
		snapshot, _ := json.Marshal(map[string]any{"operation": op, "id": id, "agreementId": i.ID})
		auditID := i.ID
		if auditID == "" {
			auditID = id
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,action,operator_uid,request_id,new_value) VALUES (?,?,?,?,?,?)", "service_agreement", auditID, op, who.Actor, who.RequestID, string(snapshot)); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "service_agreement", TargetBizCode: id, HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, serviceError(409, "service_agreement_idempotency_conflict")
	}
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"id": result.TargetBizCode}, nil
}
func readServiceAgreement(ctx context.Context, tx *sql.Tx, table func(string) string, op string, i SalesInput, actor string, scope altoc.BasicReadScope) (any, error) {
	w, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return nil, e
	}
	cw := strings.ReplaceAll(strings.ReplaceAll(w, "owner_uid", "c.owner_uid"), "owner_dept_code", "c.owner_dept_code")
	uw := strings.ReplaceAll(strings.ReplaceAll(w, "owner_uid", "u.owner_uid"), "owner_dept_code", "u.owner_dept_code")
	args = append(args, args...)
	from := table("service_agreement") + " a JOIN " + table("contract") + " c ON c.id=a.contract_id JOIN " + table("customer") + " u ON u.id=c.customer_id"
	where := "a.deleted_at IS NULL AND c.deleted_at IS NULL AND u.deleted_at IS NULL AND (" + cw + ") AND (" + uw + ")"
	if i.ID != "" {
		where += " AND a.id=?"
		args = append(args, i.ID)
	}
	if op == "service-agreements-view" || op == "service-coverages-page" || op == "service-projects-page" {
		rows, e := queryRows(ctx, tx, "SELECT a.* FROM "+from+" WHERE "+where, args...)
		if e != nil {
			return nil, e
		}
		if len(rows) == 0 {
			return nil, serviceError(403, "service_agreement_scope_denied")
		}
		if op == "service-agreements-view" {
			return rows[0], nil
		}
		child := "service_agreement_coverage"
		if op == "service-projects-page" {
			child = "service_agreement_project_rel"
		}
		from = table(child) + " a"
		where = "a.service_agreement_id=? AND a.deleted_at IS NULL"
		args = []any{i.ID}
	}
	search := salesText(i.Payload, "search")
	if search != "" {
		col := "a.name"
		if op == "service-coverages-page" {
			col = "a.coverage_code"
		}
		if op == "service-projects-page" {
			col = "a.project_code"
		}
		where += " AND " + col + " LIKE ?"
		args = append(args, "%"+search+"%")
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	page, size := int(i.Payload["page"].(float64)), int(i.Payload["pageSize"].(float64))
	rows, e := queryRows(ctx, tx, "SELECT a.* FROM "+from+" WHERE "+where+" ORDER BY a.id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	return map[string]any{"items": rows, "total": total}, e
}
