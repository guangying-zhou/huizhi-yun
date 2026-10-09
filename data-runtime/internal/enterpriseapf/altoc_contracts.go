package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ContractInput struct {
	ID          string                       `json:"id"`
	CustomerID  string                       `json:"customerId"`
	QuotationID string                       `json:"quotationId"`
	Page        int                          `json:"page"`
	PageSize    int                          `json:"pageSize"`
	Payload     map[string]any               `json:"payload"`
	Rows        []map[string]any             `json:"rows"`
	Projects    []aims.ContractProjectPlan   `json:"projects"`
	AimsPermits []aims.ContractProjectPermit `json:"aimsPermits"`
	// Authority-only facts filled by Runtime Directory before any business locks.
	Descendants map[string][]string `json:"-"`
}

func ContractPermission(op string) (string, string, bool) {
	switch op {
	case "billing-schedules-list", "contract-projects-list":
		return "contract", "view", true
	case "contracts-create", "contracts-from-quotation", "contracts-update", "contract-lines-replace", "payment-terms-replace", "obligations-replace", "obligations-transition", "contracts-sign", "contracts-activate", "contract-projects-bind", "contracts-annotate", "contracts-set-owner":
		return "contract", "edit", true
	// Closing an imported contract is a sensitive action that neither edit nor
	// admin implies; the Host must present an explicit contract:close permit.
	case "contracts-complete", "contracts-terminate":
		return "contract", "close", true
	}
	return "", "", false
}

// Convert objects recursively to sorted key/value pairs. This same shape is
// signed by Foundation, preserving decimal strings, boolean/null and array order.
func orderedContractValue(v any) any {
	switch x := v.(type) {
	case map[string]any:
		keys := []string{}
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := []any{}
		for _, k := range keys {
			out = append(out, []any{k, orderedContractValue(x[k])})
		}
		return out
	case []any:
		out := []any{}
		for _, i := range x {
			out = append(out, orderedContractValue(i))
		}
		return out
	}
	return v
}
func contractValue(v any) any {
	b, _ := json.Marshal(v)
	var decoded any
	_ = json.Unmarshal(b, &decoded)
	return orderedContractValue(decoded)
}
func ContractIntent(i ContractInput) []any {
	rows, projects, permits := []any{}, []any{}, []any{}
	for _, v := range i.Rows {
		rows = append(rows, contractValue(v))
	}
	for _, v := range i.Projects {
		projects = append(projects, contractValue(v))
	}
	for _, v := range i.AimsPermits {
		permits = append(permits, contractValue(v))
	}
	p := i.Payload
	if p == nil {
		p = map[string]any{}
	}
	return []any{i.ID, i.CustomerID, i.QuotationID, i.Page, i.PageSize, contractValue(p), rows, projects, permits}
}
func contractError(status int, code string) error {
	return httperror.New(status, code, "Contract command rejected")
}
func ValidateContractInput(op string, i ContractInput) error {
	_, a, ok := ContractPermission(op)
	if !ok {
		return contractError(400, "altoc_contract_input_invalid")
	}
	create := op == "contracts-create" || op == "contracts-from-quotation"
	if create {
		if i.ID != "" || op == "contracts-create" && (!validCustomerID(i.CustomerID) || i.QuotationID != "") || op == "contracts-from-quotation" && (!validCustomerID(i.QuotationID) || i.CustomerID != "") {
			return contractError(400, "altoc_contract_input_invalid")
		}
	} else if !validCustomerID(i.ID) || i.CustomerID != "" || i.QuotationID != "" {
		return contractError(400, "altoc_contract_input_invalid")
	}
	if a == "view" {
		if len(i.Payload) > 0 || len(i.Rows) > 0 || len(i.Projects) > 0 || len(i.AimsPermits) > 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 {
			return contractError(400, "altoc_contract_input_invalid")
		}
		return nil
	}
	if i.Page != 0 || i.PageSize != 0 {
		return contractError(400, "altoc_contract_input_invalid")
	}
	if !create && !validExpectedVersion(i.Payload["expectedVersion"]) {
		return contractError(400, "altoc_contract_input_invalid")
	}
	allowed := map[string]bool{"expectedVersion": !create}
	switch op {
	case "contracts-create", "contracts-from-quotation", "contracts-update":
		for _, k := range []string{"name", "contract_no", "direction", "sign_date", "effective_date", "end_date", "content_summary", "remark", "currency_code"} {
			allowed[k] = true
		}
	case "obligations-transition":
		allowed["obligationCode"] = true
		allowed["action"] = true
		allowed["reason"] = true
	case "contracts-annotate":
		allowed["contact_id"] = true
		allowed["remark"] = true
		allowed["content_summary"] = true
	case "contracts-complete", "contracts-terminate":
		allowed["reason"] = true
	case "contracts-set-owner":
		allowed["owner_uid"] = true
		allowed["owner_dept_code"] = true
	}
	for k, v := range i.Payload {
		if !allowed[k] {
			return contractError(400, "altoc_contract_input_invalid")
		}
		switch k {
		case "expectedVersion":
		case "name":
			if !stringValue(v, 200, false) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "contract_no":
			if !stringValue(v, 50, true) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "content_summary":
			if !stringValue(v, 1000, true) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "remark", "reason":
			if !stringValue(v, 500, true) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "currency_code":
			s, ok := v.(string)
			if !create || !ok || !currencyCode.MatchString(s) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "direction":
			if !create || v != "sales" && v != "purchase" {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "sign_date", "effective_date", "end_date":
			if v != nil {
				v, ok := v.(string)
				if !ok || !dateValid(v) {
					return contractError(400, "altoc_contract_input_invalid")
				}
			}
		case "owner_uid":
			if !stringValue(v, 64, false) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "owner_dept_code":
			if !stringValue(v, 64, true) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "contact_id":
			if s, ok := v.(string); v != nil && (!ok || !validCustomerID(s)) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "obligationCode":
			if !stringValue(v, 64, false) {
				return contractError(400, "altoc_contract_input_invalid")
			}
		case "action":
			if v != "start" && v != "submit" && v != "accept" && v != "reject" {
				return contractError(400, "altoc_contract_input_invalid")
			}
		}
	}
	if create && (i.Payload["name"] == nil || op == "contracts-create" && i.Payload["currency_code"] == nil) {
		return contractError(400, "altoc_contract_input_invalid")
	}
	if (op == "contracts-update" || op == "contracts-annotate") && len(i.Payload) < 2 {
		return contractError(400, "altoc_contract_input_invalid")
	}
	if op == "contracts-set-owner" && (i.Payload["owner_uid"] == nil || i.Payload["owner_uid"] == "") {
		return contractError(400, "altoc_contract_input_invalid")
	}
	if op == "contracts-terminate" && (i.Payload["reason"] == nil || i.Payload["reason"] == "") {
		return contractError(400, "altoc_contract_input_invalid")
	}
	if op == "obligations-transition" && (i.Payload["obligationCode"] == nil || i.Payload["action"] == nil) {
		return contractError(400, "altoc_contract_input_invalid")
	}
	collection := op == "contract-lines-replace" || op == "payment-terms-replace" || op == "obligations-replace"
	if !collection && len(i.Rows) > 0 || len(i.Rows) > 500 {
		return contractError(400, "altoc_contract_input_invalid")
	}
	if collection {
		if err := validateContractRows(op, i.Rows); err != nil {
			return err
		}
	}
	binding := op == "contract-projects-bind" || op == "contracts-activate"
	if binding {
		if len(i.AimsPermits) < 1 || len(i.AimsPermits) > 100 {
			return contractError(403, "contract_project_permit_missing")
		}
		targets := map[string]bool{}
		for _, p := range i.Projects {
			targets[p.ProjectCode] = true
		}
		for _, p := range i.AimsPermits {
			if !targets[p.ProjectCode] || p.Resource != "projects" || (p.Action != "create" && p.Action != "edit") {
				return contractError(403, "contract_project_permit_invalid")
			}
		}
		if err := aims.ValidateContractProjectPlans(i.Projects); err != nil {
			return err
		}
	} else if len(i.Projects) > 0 || len(i.AimsPermits) > 0 {
		return contractError(400, "altoc_contract_input_invalid")
	}
	return nil
}
func validExpectedVersion(v any) bool {
	x, ok := v.(float64)
	return ok && x >= 1 && x <= 4294967295 && x == float64(uint32(x))
}

var contractCols = []string{"id", "code", "name", "contract_no", "customer_id", "quotation_id", "direction", "primary_type", "status", "legal_status", "fulfillment_status", "financial_status", "activation_status", "sign_date", "effective_date", "end_date", "amount_tax_inclusive", "amount_tax_exclusive", "currency_code", "owner_uid", "owner_dept_code", "content_summary", "remark", "row_version"}

func contractTables(r enterprise.Resolved) (map[string]string, error) {
	out := map[string]string{}
	for _, n := range []string{"altoc_customer", "altoc_contact", "altoc_quotation", "altoc_quotation_item", "altoc_contract", "altoc_contract_line", "altoc_contract_payment_term", "altoc_contract_obligation", "altoc_billing_schedule", "altoc_contract_project_link", "altoc_contract_project_line_rel", "altoc_contract_project_obligation_rel", "altoc_audit_log", "service_command_receipt"} {
		v, e := r.Table(n)
		if e != nil {
			return nil, e
		}
		out[n] = v
	}
	return out, nil
}
func contractSelectCols() string {
	cols := append([]string{}, contractCols...)
	for n, k := range cols {
		if k == "sign_date" || k == "effective_date" || k == "end_date" {
			cols[n] = "CAST(" + k + " AS CHAR) AS " + k
		}
	}
	return strings.Join(cols, ",")
}
func contractSnapshot(ctx context.Context, tx *sql.Tx, t map[string]string, id string) (map[string]any, error) {
	columns, e := w3ExistingColumns(ctx, tx, t["altoc_contract"], contractCols, contractW3Columns)
	if e != nil {
		return nil, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+w3Select(columns)+" FROM "+t["altoc_contract"]+" WHERE id=?", id)
	if e != nil {
		return nil, e
	}
	data, e := readFinanceRows(rows, columns)
	if e != nil {
		return nil, e
	}
	if len(data) != 1 {
		return nil, contractError(404, "altoc_contract_not_found")
	}
	out := data[0]
	for _, c := range contractCollections {
		rows, e := tx.QueryContext(ctx, "SELECT "+c.selects()+" FROM "+t[c.table]+" WHERE contract_id=? AND deleted_at IS NULL ORDER BY "+c.order+" LIMIT 501", id)
		if e != nil {
			return nil, e
		}
		v, e := readFinanceRows(rows, c.cols)
		if e != nil {
			return nil, e
		}
		if len(v) > 500 {
			return nil, contractError(503, "altoc_contract_collection_limit")
		}
		out[c.key] = v
	}
	return out, nil
}
func (s *Service) Contract(ctx context.Context, op string, i ContractInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	return s.contract(ctx, op, i, who, scope, customerHooks{})
}

// contract accepts the same package-internal transaction hooks as customer.
func (s *Service) contract(ctx context.Context, op string, i ContractInput, who Identity, scope altoc.BasicReadScope, hooks customerHooks) (out any, err error) {
	defer func() {
		var m *mysql.MySQLError
		if errors.As(err, &m) && (m.Number == 1062 || m.Number == 1213 || m.Number == 1205) {
			err = contractError(409, "altoc_contract_conflict")
		}
	}()
	if e := ValidateContractInput(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, contractError(403, "altoc_contract_identity_invalid")
	}
	_, action, _ := ContractPermission(op)
	write := action != "view"
	if write && who.Key == "" {
		return nil, contractError(400, "altoc_contract_key_invalid")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	req, e := s.request("altoc", enterprise.Read)
	if e != nil {
		return nil, e
	}
	requests := []enterprise.ResolveRequest{req}
	bind := op == "contract-projects-bind" || op == "contracts-activate"
	if write {
		requests[0].Operation = enterprise.Write
	}
	if bind {
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
	if hooks.before != nil {
		if e = hooks.before(ctx, tx); e != nil {
			return nil, e
		}
	}
	t, e := contractTables(rs[0])
	if e != nil {
		return nil, e
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("wp4c|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	code := "CT-" + strings.ReplaceAll(oid, "-", "")
	id := i.ID
	create := op == "contracts-create" || op == "contracts-from-quotation"
	customerID := i.CustomerID
	currency := ""
	var quoteLines []map[string]any
	if op == "contracts-from-quotation" {
		var quoteOwner, quoteDept, quoteStatus string
		// Nonlocking lookup only discovers the customer, then lock customer→quote.
		if e = tx.QueryRowContext(ctx, "SELECT customer_id FROM "+t["altoc_quotation"]+" WHERE id=? AND deleted_at IS NULL", i.QuotationID).Scan(&customerID); e == sql.ErrNoRows {
			return nil, contractError(404, "altoc_quotation_not_found")
		} else if e != nil {
			return nil, e
		}
		if _, e = lockContractCustomer(ctx, tx, t, customerID, who, scope); e != nil {
			return nil, e
		}
		if e = tx.QueryRowContext(ctx, "SELECT customer_id,owner_uid,COALESCE(owner_dept_code,''),status,currency_code FROM "+t["altoc_quotation"]+" WHERE id=? AND deleted_at IS NULL FOR UPDATE", i.QuotationID).Scan(&customerID, &quoteOwner, &quoteDept, &quoteStatus, &currency); e != nil {
			return nil, e
		}
		if !altocScopeAllows(scope, who.Actor, quoteOwner, quoteDept) {
			return nil, contractError(403, "altoc_contract_scope_denied")
		}
		if quoteStatus != "approved" && quoteStatus != "accepted" {
			return nil, contractError(409, "altoc_quotation_not_convertible")
		}
		rows, e := tx.QueryContext(ctx, "SELECT "+strings.Join(quotationItemCols, ",")+" FROM "+t["altoc_quotation_item"]+" WHERE quotation_id=? ORDER BY line_no FOR UPDATE", i.QuotationID)
		if e != nil {
			return nil, e
		}
		quoteLines, e = readFinanceRows(rows, quotationItemCols)
		if e != nil {
			return nil, e
		}
		if len(quoteLines) == 0 || len(quoteLines) > 500 {
			return nil, contractError(409, "altoc_quotation_items_invalid")
		}
	}
	var owner, dept, status, customerCode string
	var rowVersion int64
	if create {
		customer, e := lockContractCustomer(ctx, tx, t, customerID, who, scope)
		if e != nil {
			return nil, e
		}
		dept = customer["dept"]
		customerCode = customer["code"]
		owner = who.Actor
		if !altocScopeAllows(scope, who.Actor, owner, dept) {
			return nil, contractError(403, "altoc_contract_scope_denied")
		}
		var deleted sql.NullTime
		e = tx.QueryRowContext(ctx, "SELECT id,owner_uid,COALESCE(owner_dept_code,''),status,row_version,deleted_at FROM "+t["altoc_contract"]+" WHERE BINARY code=BINARY ? FOR UPDATE", code).Scan(&id, &owner, &dept, &status, &rowVersion, &deleted)
		if e != nil && e != sql.ErrNoRows {
			return nil, e
		}
		if e == nil && (deleted.Valid || !altocScopeAllows(scope, who.Actor, owner, dept)) {
			return nil, contractError(403, "altoc_contract_scope_denied")
		}
	} else {
		suffix := ""
		if write {
			suffix = " FOR UPDATE"
		}
		e = tx.QueryRowContext(ctx, "SELECT code,customer_id,owner_uid,COALESCE(owner_dept_code,''),status,row_version FROM "+t["altoc_contract"]+" WHERE id=? AND deleted_at IS NULL"+suffix, id).Scan(&code, &customerID, &owner, &dept, &status, &rowVersion)
		if e == sql.ErrNoRows {
			return nil, contractError(404, "altoc_contract_not_found")
		}
		if e != nil {
			return nil, e
		}
		if !altocScopeAllows(scope, who.Actor, owner, dept) {
			return nil, contractError(403, "altoc_contract_scope_denied")
		}
		if op == "contracts-set-owner" {
			// The new owner must stay inside the caller's scope too; otherwise a
			// reassignment could move the contract out of every check that follows.
			nextDept := dept
			if v, ok := i.Payload["owner_dept_code"]; ok {
				nextDept, _ = v.(string)
			}
			if !altocScopeAllows(scope, who.Actor, i.Payload["owner_uid"].(string), nextDept) {
				return nil, contractError(403, "altoc_contract_scope_denied")
			}
		}
	}
	if !write {
		c := contractCollections["billing_schedules"]
		if op == "contract-projects-list" {
			c = contractCollections["project_links"]
		}
		var total int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t[c.table]+" WHERE contract_id=? AND deleted_at IS NULL", id).Scan(&total); e != nil {
			return nil, e
		}
		rows, e := tx.QueryContext(ctx, "SELECT "+c.selects()+" FROM "+t[c.table]+" WHERE contract_id=? AND deleted_at IS NULL ORDER BY "+c.order+" LIMIT ? OFFSET ?", id, i.PageSize, (i.Page-1)*i.PageSize)
		if e != nil {
			return nil, e
		}
		data, e := readFinanceRows(rows, c.cols)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"data": data, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
	}
	if !create {
		basis, origin, e := contractW1State(ctx, tx, t["altoc_contract"], id)
		if e != nil {
			return nil, e
		}
		if e = contractW1Guard(op, basis, origin); e != nil {
			return nil, e
		}
	}
	mutable := op == "contracts-update" || op == "contract-lines-replace" || op == "payment-terms-replace" || op == "obligations-replace"
	if mutable && status != "draft" && status != "rejected" {
		return nil, contractError(409, "altoc_contract_frozen")
	}
	// Prelock all existing Altoc children in the documented order before Aims.
	if e = lockContractChildren(ctx, tx, t, id); e != nil {
		return nil, e
	}
	var checked []aims.LockedContractProject
	var projectIdentity aims.ContractProjectIdentity
	var scheduleNames map[string]string
	if bind {
		if status != "effective" {
			return nil, contractError(409, "altoc_contract_not_effective")
		}
		projectIdentity = aims.ContractProjectIdentity{ActorUID: who.Actor, Tenant: who.Tenant, Deployment: who.Deployment, ContractCode: code, Permits: i.AimsPermits, Descendants: i.Descendants}
		if e = tx.QueryRowContext(ctx, "SELECT code FROM "+t["altoc_customer"]+" WHERE id=?", customerID).Scan(&projectIdentity.CustomerCode); e != nil {
			return nil, e
		}
		if scheduleNames, e = validateContractProjectTargets(ctx, tx, t, id, i.Projects); e != nil {
			return nil, e
		}
		checked, e = aims.PrepareContractProjectsTx(ctx, tx, rs[1], projectIdentity, i.Projects)
		if e != nil {
			return nil, e
		}
	}
	businessInput := i
	businessInput.AimsPermits = nil
	command := map[string]any{"operation": op, "intent": ContractIntent(businessInput), "actor": who.Actor}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(command)
	repo, e := integrationoperation.NewReceiptRepository(rs[0].DB, integrationoperation.WithReceiptTable(t["service_command_receipt"]))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.wp4c." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if !create && float64(rowVersion) != i.Payload["expectedVersion"] {
			return fail(contractError(409, "altoc_contract_version_conflict"))
		}
		switch op {
		case "contracts-create", "contracts-from-quotation":
			fields := []string{"code", "customer_id", "owner_uid", "owner_dept_code", "created_by", "updated_by", "source_type"}
			vals := []any{code, customerID, owner, dept, who.Actor, who.Actor, "manual"}
			if op == "contracts-from-quotation" {
				fields = append(fields, "quotation_id")
				vals = append(vals, i.QuotationID)
				vals[6] = "quotation"
				fields = append(fields, "currency_code")
				vals = append(vals, currency)
			}
			for _, k := range []string{"name", "contract_no", "direction", "sign_date", "effective_date", "end_date", "content_summary", "remark", "currency_code"} {
				if v, ok := i.Payload[k]; ok {
					if op == "contracts-from-quotation" && k == "currency_code" && v != currency {
						return fail(contractError(400, "altoc_contract_currency_mismatch"))
					}
					if op == "contracts-from-quotation" && k == "currency_code" {
						continue
					}
					fields = append(fields, k)
					vals = append(vals, v)
				}
			}
			res, e := tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract"]+" ("+strings.Join(fields, ",")+") VALUES("+strings.TrimSuffix(strings.Repeat("?,", len(vals)), ",")+")", vals...)
			if e != nil {
				return fail(e)
			}
			n, e := res.LastInsertId()
			if e != nil {
				return fail(e)
			}
			id = strconv.FormatInt(n, 10)
			if len(quoteLines) > 0 {
				rows := []map[string]any{}
				for _, v := range quoteLines {
					rows = append(rows, map[string]any{"name": v["item_name"], "line_type": "other", "quantity": v["quantity"], "unit_price": v["unit_price"], "tax_rate": v["tax_rate"], "source_quotation_item_id": v["id"], "source_amount": v["amount_tax_inclusive"]})
				}
				if e = replaceContractLines(ctx, tx, t, id, code, who, rows, true); e != nil {
					return fail(e)
				}
			}
		case "contracts-update":
			sets, vals := []string{}, []any{}
			for _, k := range []string{"name", "contract_no", "sign_date", "effective_date", "end_date", "content_summary", "remark"} {
				if v, ok := i.Payload[k]; ok {
					sets = append(sets, k+"=?")
					vals = append(vals, v)
				}
			}
			sets = append(sets, "updated_by=?")
			vals = append(vals, who.Actor, id)
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET "+strings.Join(sets, ",")+" WHERE id=?", vals...); e != nil {
				return fail(e)
			}
		case "contract-lines-replace":
			if e = replaceContractLines(ctx, tx, t, id, code, who, i.Rows, false); e != nil {
				return fail(e)
			}
		case "payment-terms-replace":
			if e = replaceContractTerms(ctx, tx, t, id, code, who, i.Rows); e != nil {
				return fail(e)
			}
		case "obligations-replace":
			if e = replaceContractObligations(ctx, tx, t, id, code, who, i.Rows); e != nil {
				return fail(e)
			}
		case "obligations-transition":
			if status != "effective" {
				return fail(contractError(409, "altoc_contract_not_effective"))
			}
			if e = transitionContractObligation(ctx, tx, t, id, who, i.Payload); e != nil {
				return fail(e)
			}
		case "contracts-set-owner":
			// Only the owner changes: no state, amount, approval or outbound effect.
			sets, vals := []string{"owner_uid=?"}, []any{i.Payload["owner_uid"]}
			if v, ok := i.Payload["owner_dept_code"]; ok {
				sets = append(sets, "owner_dept_code=?")
				vals = append(vals, v)
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET "+strings.Join(sets, ",")+" WHERE id=?", append(vals, id)...); e != nil {
				return fail(e)
			}
			change, _ := json.Marshal(map[string]any{"from": owner, "to": i.Payload["owner_uid"]})
			if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_audit_log"]+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('contract',?,?,'set_owner',?,?,'user',?)", id, code, string(change), who.Actor, who.RequestID); e != nil {
				return fail(e)
			}
		case "contracts-annotate":
			sets, vals := []string{}, []any{}
			if v, ok := i.Payload["contact_id"]; ok {
				if v != nil {
					// The contact must belong to this contract's customer.
					var n int
					if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["altoc_contact"]+" WHERE id=? AND customer_id=? AND deleted_at IS NULL", v, customerID).Scan(&n); e != nil {
						return fail(e)
					}
					if n != 1 {
						return fail(contractError(409, "altoc_contract_contact_invalid"))
					}
				}
				sets = append(sets, "contact_id=?")
				vals = append(vals, v)
			}
			for _, k := range []string{"remark", "content_summary"} {
				if v, ok := i.Payload[k]; ok {
					sets = append(sets, k+"=?")
					vals = append(vals, v)
				}
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET "+strings.Join(sets, ",")+" WHERE id=?", append(vals, id)...); e != nil {
				return fail(e)
			}
		case "contracts-complete", "contracts-terminate":
			if status != "effective" {
				return fail(contractError(409, "altoc_contract_not_effective"))
			}
			// Same state tuples the import writes for a source contract that was
			// already completed or terminated (W1 §5.4). No workflow, outbox,
			// Finance summary or Aims effect: financial/activation stay as they are.
			set, action := "status='completed',legal_status='closed',fulfillment_status='fulfilled',completed_at=CURRENT_TIMESTAMP(3)", "complete"
			if op == "contracts-terminate" {
				set, action = "status='terminated',legal_status='terminated',fulfillment_status='cancelled',terminated_at=CURRENT_TIMESTAMP(3)", "terminate"
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET "+set+",last_status_changed_by=?,last_status_changed_at=CURRENT_TIMESTAMP(3) WHERE id=?", who.Actor, id); e != nil {
				return fail(e)
			}
			reason, _ := json.Marshal(map[string]any{"reason": i.Payload["reason"]})
			if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_audit_log"]+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('contract',?,?,?,?,?,'user',?)", id, code, action, string(reason), who.Actor, who.RequestID); e != nil {
				return fail(e)
			}
		case "contracts-sign":
			if status != "approved" && status != "effective" {
				return fail(contractError(409, "altoc_contract_not_approved"))
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET status='effective',legal_status='effective',fulfillment_status='in_progress',activation_status='ready',sign_date=COALESCE(sign_date,CURRENT_DATE),effective_date=COALESCE(effective_date,CURRENT_DATE),last_status_changed_by=?,last_status_changed_at=CURRENT_TIMESTAMP(3) WHERE id=?", who.Actor, id); e != nil {
				return fail(e)
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_billing_schedule"]+" SET status='billable',billable_at=CURRENT_TIMESTAMP(3),billable_source='stage',row_version=row_version+1 WHERE contract_id=? AND trigger_type='contract_signed' AND status='planned' AND deleted_at IS NULL", id); e != nil {
				return fail(e)
			}
		case "contract-projects-bind", "contracts-activate":
			projects, applyErr := aims.ApplyContractProjectsTx(ctx, tx, projectIdentity, checked, scheduleNames)
			if applyErr != nil {
				e = applyErr
				return fail(e)
			}
			if e = applyContractProjectLinks(ctx, tx, t, id, who, i.Projects, projects); e != nil {
				return fail(e)
			}
			if op == "contracts-activate" {
				if e = validateContractActivationCoverage(ctx, tx, t, id); e != nil {
					return fail(e)
				}
				if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET activation_status='activated' WHERE id=?", id); e != nil {
					return fail(e)
				}
			}
		}
		if !create {
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET row_version=row_version+1,updated_by=? WHERE id=?", who.Actor, id); e != nil {
				return fail(e)
			}
		}
		snapshot, e := contractSnapshot(ctx, tx, t, id)
		if e != nil {
			return fail(e)
		}
		b, e := json.Marshal(map[string]any{"data": snapshot})
		if e != nil {
			return fail(e)
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_audit_log"]+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('contract',?,?, 'version',?,?,'user',?)", id, code, string(b), who.Actor, who.RequestID); e != nil {
			return fail(e)
		}
		h := sha256.Sum256(b)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "contract", TargetBizCode: code + ":v" + fmt.Sprint(snapshot["row_version"]), HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(h[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, contractError(409, "altoc_contract_idempotency_conflict")
	}
	if e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, contractError(503, "altoc_contract_receipt_invalid")
	}
	var b []byte
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+t["altoc_audit_log"]+" WHERE entity_type='contract' AND BINARY entity_code=BINARY ? AND action='version' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.data.row_version'))=?", parts[0], parts[1]).Scan(&b); e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &out); e != nil {
		return nil, e
	}
	if hooks.after != nil {
		if e = hooks.after(ctx, tx, code); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	_ = customerCode
	return out, nil
}
func lockContractCustomer(ctx context.Context, tx *sql.Tx, t map[string]string, id string, who Identity, scope altoc.BasicReadScope) (map[string]string, error) {
	var code, owner, dept string
	e := tx.QueryRowContext(ctx, "SELECT code,owner_uid,COALESCE(owner_dept_code,'') FROM "+t["altoc_customer"]+" WHERE id=? AND deleted_at IS NULL FOR UPDATE", id).Scan(&code, &owner, &dept)
	if e == sql.ErrNoRows {
		return nil, contractError(404, "altoc_customer_not_found")
	}
	if e != nil {
		return nil, e
	}
	if !altocScopeAllows(scope, who.Actor, owner, dept) {
		return nil, contractError(403, "altoc_contract_scope_denied")
	}
	return map[string]string{"code": code, "dept": dept}, nil
}
func lockContractChildren(ctx context.Context, tx *sql.Tx, t map[string]string, id string) error {
	if id == "" {
		return nil
	}
	for _, n := range []string{"altoc_contract_line", "altoc_contract_payment_term", "altoc_contract_obligation", "altoc_billing_schedule", "altoc_contract_project_link"} {
		rows, e := tx.QueryContext(ctx, "SELECT id FROM "+t[n]+" WHERE contract_id=? ORDER BY id FOR UPDATE", id)
		if e != nil {
			return e
		}
		for rows.Next() {
			var ignored int64
			if e = rows.Scan(&ignored); e != nil {
				rows.Close()
				return e
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
func (s *Service) ContractRead(ctx context.Context, id, actor string, scope altoc.BasicReadScope, q altoc.BasicReadQuery, customerScopes ...altoc.BasicReadScope) (any, error) {
	if e := q.Validate("contract"); e != nil {
		return nil, e
	}
	where, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return nil, e
	}
	tx, rs, metadata, e := s.beginW3Read(ctx, id != "")
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	t, e := contractTables(rs[0])
	if e != nil {
		return nil, e
	}
	columns, e := w3ExistingColumns(ctx, tx, t["altoc_contract"], contractCols, contractW3Columns)
	if e != nil {
		return nil, e
	}
	customerScope := altoc.BasicReadScope{Access: "none"}
	if len(customerScopes) > 1 {
		return nil, contractError(403, "altoc_customer_scope_invalid")
	}
	if len(customerScopes) == 1 {
		customerScope = customerScopes[0]
	}
	customerWhere, customerArgs, e := scopeSQL("altoc", actor, customerScope)
	if e != nil {
		return nil, e
	}
	signedDate := contractSignedDateSQL(columns)
	where = "deleted_at IS NULL AND (" + where + ")"
	// The rollup describes the customer, so it keeps scope but not list filters.
	scopeWhere, scopeArgs := where, append([]any{}, args...)
	if id != "" {
		where += " AND id=?"
		args = append(args, id)
	}
	if q.Search != "" {
		where += " AND (LOCATE(?,name)>0 OR LOCATE(?,code)>0 OR LOCATE(?,contract_no)>0 OR customer_id IN (SELECT id FROM " + t["altoc_customer"] + " WHERE deleted_at IS NULL AND (" + customerWhere + ") AND (LOCATE(?,name)>0 OR LOCATE(?,code)>0)))"
		args = append(args, q.Search, q.Search, q.Search)
		args = append(args, customerArgs...)
		args = append(args, q.Search, q.Search)
	}
	for _, f := range []struct{ column, value string }{{"owner_uid", q.OwnerUID}, {"direction", q.Direction}, {"primary_type", q.ContractType}} {
		if f.value != "" {
			where += " AND BINARY " + f.column + "=BINARY ?"
			args = append(args, f.value)
		}
	}
	amountSQL := "amount_tax_inclusive"
	for _, column := range columns {
		if column == "signed_amount" {
			amountSQL = "CASE WHEN origin_type='historical_import' THEN signed_amount ELSE amount_tax_inclusive END"
		}
	}
	for _, f := range []struct{ value, operator string }{{q.AmountMin, ">="}, {q.AmountMax, "<="}} {
		if f.value != "" {
			where += " AND (" + amountSQL + ")" + f.operator + "CAST(? AS DECIMAL(18,2))"
			args = append(args, f.value)
		}
	}

	if q.Status != "" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	customers := []any{}
	if q.CustomerID != "" {
		customers = append(customers, q.CustomerID)
		if q.IncludeDescendants {
			if customers, e = customerSubtree(ctx, tx, t["altoc_customer"], q.CustomerID); e != nil {
				return nil, e
			}
		}
		where += " AND customer_id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(customers)), ",") + ")"
		args = append(args, customers...)
	}
	if q.ParentContractID != "" {
		has, err := financeHasColumn(ctx, tx, t["altoc_contract"], "parent_contract_id")
		if err != nil {
			return nil, err
		}
		if has {
			where += " AND parent_contract_id=?"
			args = append(args, q.ParentContractID)
		} else {
			where += " AND 1=0"
		}
	}
	if q.CustomerIDs != "" {
		ids := strings.Split(q.CustomerIDs, ",")
		where += " AND customer_id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + ")"
		for _, customer := range ids {
			args = append(args, customer)
		}
	}
	if q.OwnerUnassigned {
		where += " AND owner_uid=?"
		args = append(args, unassignedOwnerReadFilter())
	}
	for _, filter := range []struct{ column, value string }{{"origin_type", q.Origin}, {"contract_category", q.Category}} {
		if filter.value == "" {
			continue
		}
		has, e := financeHasColumn(ctx, tx, t["altoc_contract"], filter.column)
		if e != nil {
			return nil, e
		}
		if has {
			where += " AND " + filter.column + "=?"
			args = append(args, filter.value)
		} else {
			where += " AND 1=0"
		}
	}
	for _, filter := range []struct{ value, operator string }{{q.SignedDateFrom, ">="}, {q.SignedDateTo, "<="}} {
		if filter.value != "" {
			where += " AND (" + signedDate + ")" + filter.operator + "?"
			args = append(args, filter.value)
		}
	}
	var total int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["altoc_contract"]+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	if id != "" {
		if total != 1 {
			return nil, contractError(404, "altoc_contract_not_found")
		}
		out, e := contractSnapshot(ctx, tx, t, id)
		if e != nil {
			return nil, e
		}
		var normalizedDate sql.NullString
		if e = tx.QueryRowContext(ctx, "SELECT CAST(("+signedDate+") AS CHAR) FROM "+t["altoc_contract"]+" WHERE id=?", id).Scan(&normalizedDate); e != nil {
			return nil, e
		}
		out["signed_date"] = nil
		if normalizedDate.Valid {
			out["signed_date"] = normalizedDate.String
		}
		if e = contractCustomerNames(ctx, tx, t["altoc_customer"], actor, customerScope, []map[string]any{out}); e != nil {
			return nil, e
		}
		if e = w3ContractNames(ctx, tx, rs[0], metadata, out); e != nil {
			return nil, e
		}
		if e = w3ObjectMetadata(ctx, tx, metadata, "contract", out); e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	out := map[string]any{"total": total, "page": q.Page, "pageSize": q.PageSize}
	if q.CustomerIDs != "" {
		// One grouped query under contract:view scope; no customer names or
		// existence/hidden counts are read using this permit.
		summaries, err := w3ContractCustomerSummaries(ctx, tx, t["altoc_contract"], where, args, strings.Split(q.CustomerIDs, ","))
		if err != nil {
			return nil, err
		}
		out["customerSummaries"] = summaries
	}
	// Totals cover the whole filtered result, never only the returned page.
	amounts, e := contractAmounts(ctx, tx, t["altoc_contract"], where, args)
	if e != nil {
		return nil, e
	}
	metrics, err := contractEffectiveMetrics(ctx, tx, t["altoc_contract"], where, args)
	if err != nil {
		return nil, err
	}
	out["summary"] = map[string]any{"count": total, "amounts": amounts, "effectiveMetrics": metrics}
	if len(customers) > 0 {
		if out["rollup"], e = contractRollup(ctx, tx, t["altoc_contract"], scopeWhere, scopeArgs, customers); e != nil {
			return nil, e
		}
	}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	rows, e := tx.QueryContext(ctx, "SELECT "+w3Select(columns)+",CAST(("+signedDate+") AS CHAR) AS signed_date FROM "+t["altoc_contract"]+" WHERE "+where+" ORDER BY ("+signedDate+") DESC,id DESC LIMIT ? OFFSET ?", args...)
	columns = append(columns, "signed_date")
	if e != nil {
		return nil, e
	}
	v, e := readFinanceRows(rows, columns)
	if e != nil {
		return nil, e
	}
	if e = contractCustomerNames(ctx, tx, t["altoc_customer"], actor, customerScope, v); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	out["items"] = v
	return out, nil
}

// W1 signed_at is already UTC. Fixed +08:00 conversion avoids depending on
// MySQL timezone tables or the host/session timezone. Native DATE is unchanged.
func contractSignedDateSQL(columns []string) string {
	has := map[string]bool{}
	for _, c := range columns {
		has[c] = true
	}
	if has["origin_type"] && has["signed_at"] {
		return "CASE WHEN origin_type='historical_import' AND signed_at IS NOT NULL THEN DATE(DATE_ADD(signed_at,INTERVAL 8 HOUR)) ELSE sign_date END"
	}
	return "sign_date"
}

// One scoped query per returned page, not one query per contract. Contract
// visibility/counts are independent of customer visibility and names.
func contractCustomerNames(ctx context.Context, tx *sql.Tx, table, actor string, scope altoc.BasicReadScope, contracts []map[string]any) error {
	where, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return e
	}
	ids := []any{}
	seen := map[string]bool{}
	for _, row := range contracts {
		row["customer_name"] = nil
		row["customer_visible"] = false
		id := fmt.Sprint(row["customer_id"])
		if id != "" && id != "<nil>" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || scope.Access == "none" {
		return nil
	}
	rows, e := tx.QueryContext(ctx, "SELECT id,name FROM "+table+" WHERE deleted_at IS NULL AND ("+where+") AND id IN ("+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+")", append(args, ids...)...)
	if e != nil {
		return e
	}
	names, e := readFinanceRows(rows, []string{"id", "name"})
	if e != nil {
		return e
	}
	byID := map[string]any{}
	for _, row := range names {
		byID[fmt.Sprint(row["id"])] = row["name"]
	}
	for _, row := range contracts {
		if name, ok := byID[fmt.Sprint(row["customer_id"])]; ok {
			row["customer_name"] = name
			row["customer_visible"] = true
		}
	}
	return nil
}
