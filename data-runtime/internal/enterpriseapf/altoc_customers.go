package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// CustomerInput binds both the owning customer and the child object to the permit.
type CustomerInput struct {
	CustomerID string         `json:"customerId"`
	ChildCode  string         `json:"childCode"`
	Payload    map[string]any `json:"payload"`
}

func CustomerIntent(i CustomerInput) []any {
	keys := make([]string, 0, len(i.Payload))
	for k := range i.Payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := []any{}
	for _, k := range keys {
		pairs = append(pairs, []any{k, i.Payload[k]})
	}
	return []any{i.CustomerID, i.ChildCode, pairs}
}

var customerOps = map[string]string{"customers-create": "customer", "customers-update": "customer", "customers-set-owner": "customer", "customers-set-parent": "customer", "customers-set-primary-contact": "customer", "contacts-create": "contact", "contacts-update": "contact", "contacts-delete": "contact", "invoice-profiles-create": "invoice", "invoice-profiles-update": "invoice", "invoice-profiles-delete": "invoice", "invoice-profiles-set-default": "invoice"}

func CustomerPermission(op string) (string, string, bool) {
	_, ok := customerOps[op]
	return "customer", "edit", ok
}

var customerFields = map[string]int{"name": 200, "short_name": 100, "unified_social_credit_code": 50, "organization_domain": 200, "industry_code": 64, "region_code": 64, "source_type": 50, "credit_level": 20, "website": 300, "telephone": 30, "province": 50, "city": 50, "address": 500, "wechat_official_account": 100, "description": 10000, "remark": 500}
var contactFields = map[string]int{"name": 50, "dept_name": 100, "job_title": 100, "mobile": 30, "alternate_mobile": 30, "phone": 30, "email": 100, "wechat": 100, "mailing_address": 500, "decision_role": 30, "influence_level": 20, "remark": 500}
var invoiceFields = map[string]int{"taxpayer_name": 200, "taxpayer_no": 50, "registered_address": 500, "registered_phone": 50, "bank_name": 200, "bank_account": 100, "invoice_type": 30, "invoice_email": 100, "receiver_name": 100, "receiver_phone": 50, "receiver_address": 500, "remark": 500}

func customerInvalid() error {
	return httperror.New(400, "altoc_customer_input_invalid", "Invalid customer command")
}
func ValidateCustomerInput(op string, i CustomerInput) error {
	kind, ok := customerOps[op]
	if !ok {
		return customerInvalid()
	}
	create := strings.HasSuffix(op, "-create")
	if op == "customers-create" {
		if i.CustomerID != "" {
			return customerInvalid()
		}
	} else if !validCustomerID(i.CustomerID) {
		return customerInvalid()
	}
	if kind == "customer" || create {
		if i.ChildCode != "" {
			return customerInvalid()
		}
	} else if !financeCode.MatchString(i.ChildCode) {
		return customerInvalid()
	}
	fields := customerFields
	if kind == "contact" {
		fields = contactFields
	}
	if kind == "invoice" {
		fields = invoiceFields
	}
	for k, v := range i.Payload {
		if k == "expectedVersion" && !create {
			n, ok := v.(float64)
			if !ok || n < 1 || n > 4294967295 || n != float64(int64(n)) {
				return customerInvalid()
			}
			continue
		}
		// Hierarchy and primary contact are their own commands: one reference,
		// given as an id or cleared with null, and nothing else.
		if op == "customers-set-parent" || op == "customers-set-primary-contact" {
			want := map[string]string{"customers-set-parent": "parent_customer_id", "customers-set-primary-contact": "primary_contact_id"}[op]
			if id, ok := v.(string); k != want || v != nil && (!ok || !validCustomerID(id)) {
				return customerInvalid()
			}
			continue
		}
		if k == "star_level" && kind == "contact" && !strings.HasSuffix(op, "-delete") {
			if n, ok := v.(float64); v != nil && (!ok || n < 1 || n > 6 || n != float64(int64(n))) {
				return customerInvalid()
			}
			continue
		}
		if k == "owner_uid" && (op == "customers-create" || op == "customers-set-owner") {
			if !stringValue(v, 64, false) {
				return customerInvalid()
			}
			continue
		}
		if k == "owner_dept_code" && (op == "customers-create" || op == "customers-set-owner") {
			if !stringValue(v, 64, true) {
				return customerInvalid()
			}
			continue
		}
		if op == "customers-set-owner" || strings.HasSuffix(op, "-delete") || op == "invoice-profiles-set-default" {
			return customerInvalid()
		}
		if k == "status" && kind != "customer" {
			if v != "active" && v != "inactive" {
				return customerInvalid()
			}
			continue
		}
		if k == "is_default" && kind == "invoice" {
			if _, ok := v.(bool); !ok {
				return customerInvalid()
			}
			continue
		}
		max, ok := fields[k]
		if !ok || !stringValue(v, max, k != "name" && k != "taxpayer_name") {
			return customerInvalid()
		}
		if k == "invoice_type" && v != "special_vat" && v != "general_vat" && v != "electronic" {
			return customerInvalid()
		}
	}
	if !create {
		if _, ok := i.Payload["expectedVersion"]; !ok {
			return customerInvalid()
		}
	}
	if create {
		required := "name"
		if kind == "invoice" {
			required = "taxpayer_name"
		}
		if !stringValue(i.Payload[required], fields[required], false) {
			return customerInvalid()
		}
		if op == "customers-create" && !stringValue(i.Payload["owner_uid"], 64, false) {
			return customerInvalid()
		}
	}
	if op == "customers-set-owner" && !stringValue(i.Payload["owner_uid"], 64, false) {
		return customerInvalid()
	}
	if op == "customers-set-parent" || op == "customers-set-primary-contact" {
		if len(i.Payload) != 2 {
			return customerInvalid()
		}
	}
	if len(i.Payload) == 0 || (!create && strings.HasSuffix(op, "-update") && len(i.Payload) < 2) {
		return customerInvalid()
	}
	return nil
}

func validCustomerID(id string) bool {
	n, e := strconv.ParseInt(id, 10, 64)
	return numericID.MatchString(id) && e == nil && n <= 9007199254740991
}

var numericID = regexpNumericID()

func regexpNumericID() *regexp.Regexp { return regexp.MustCompile(`^[1-9][0-9]{0,15}$`) }
func customerColumns(kind string) []string {
	cols := []string{"id", "code", "row_version"}
	fields := customerFields
	if kind == "contact" {
		fields = contactFields
	}
	if kind == "invoice" {
		fields = invoiceFields
	}
	keys := []string{}
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	cols = append(cols, keys...)
	if kind == "customer" {
		cols = append(cols, "owner_uid", "owner_dept_code", "status")
	} else {
		cols = append(cols, "customer_id", "status")
		if kind == "invoice" {
			cols = append(cols, "is_default")
		}
	}
	return cols
}

// Columns that exist only after a reviewed W1 column subset; read and written
// only when present.
var customerW1Columns = map[string][]string{"customer": {"primary_contact_id", "contact_name_text", "sort_no", "customer_level_id"}, "contact": {"star_level"}}

func customerRows(ctx context.Context, tx *sql.Tx, table, where string, args []any, kind string) ([]map[string]any, error) {
	cols := customerColumns(kind)
	if kind == "customer" {
		cols = append(cols, "parent_customer_id")
	}
	if kind == "contact" {
		cols = append(cols, "is_key_contact")
	}
	for _, extra := range customerW1Columns[kind] {
		has, e := financeHasColumn(ctx, tx, table, extra)
		if e != nil {
			return nil, e
		}
		if has {
			cols = append(cols, extra)
		}
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+strings.Join(cols, ",")+" FROM "+table+" WHERE "+where, args...)
	if e != nil {
		return nil, e
	}
	return readFinanceRows(rows, cols)
}

// Every child mutation serializes through its owning customer. Scope is read from
// the signed permit and checked against authoritative pre- and post-write facts.
func (s *Service) Customer(ctx context.Context, op string, i CustomerInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	return s.customer(ctx, op, i, who, scope, customerHooks{})
}

// customerHooks lets another command of this package join the customer write
// transaction: before runs once the transaction is open, after runs with the
// written object's code just before commit. Either failing rolls everything back.
type customerHooks struct {
	before func(ctx context.Context, tx *sql.Tx) error
	after  func(ctx context.Context, tx *sql.Tx, code string) error
}

func (s *Service) customer(ctx context.Context, op string, i CustomerInput, who Identity, scope altoc.BasicReadScope, hooks customerHooks) (out any, err error) {
	defer func() {
		var d *mysql.MySQLError
		if errors.As(err, &d) && (d.Number == 1062 || d.Number == 1213 || d.Number == 1205) {
			err = httperror.New(409, "altoc_customer_write_conflict", "Concurrent customer write conflict")
		}
	}()
	if e := ValidateCustomerInput(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment || who.Key == "" {
		return nil, httperror.New(403, "altoc_customer_identity_invalid", "Invalid actor")
	}
	where, args, e := scopeSQL("altoc", who.Actor, scope)
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
	if hooks.before != nil {
		if e = hooks.before(ctx, tx); e != nil {
			return nil, e
		}
	}
	r := rs[0]
	customer, e := r.Table("altoc_customer")
	if e != nil {
		return nil, e
	}
	kind := customerOps[op]
	logical := "altoc_customer"
	if kind == "contact" {
		logical = "altoc_contact"
	}
	if kind == "invoice" {
		logical = "altoc_customer_invoice_profile"
	}
	table, e := r.Table(logical)
	if e != nil {
		return nil, e
	}
	var owner, dept string
	if op != "customers-create" {
		if e = tx.QueryRowContext(ctx, "SELECT owner_uid,COALESCE(owner_dept_code,'') FROM "+customer+" WHERE id=? AND deleted_at IS NULL FOR UPDATE", i.CustomerID).Scan(&owner, &dept); e == sql.ErrNoRows {
			return nil, httperror.New(404, "altoc_customer_not_found", "Customer unavailable")
		} else if e != nil {
			return nil, e
		}
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+customer+" WHERE id=? AND ("+where+")", append([]any{i.CustomerID}, args...)...).Scan(&n); e != nil {
			return nil, e
		}
		if n != 1 {
			return nil, httperror.New(403, "altoc_customer_scope_denied", "Customer outside authorized scope")
		}
	}
	if op == "customers-create" || op == "customers-set-owner" {
		owner = i.Payload["owner_uid"].(string)
		if value, exists := i.Payload["owner_dept_code"]; exists {
			dept, _ = value.(string)
		}
		if !altocScopeAllows(scope, who.Actor, owner, dept) {
			return nil, httperror.New(403, "altoc_customer_scope_denied", "Target owner outside authorized scope")
		}
	}
	if e = s.customerReferenceChecks(ctx, tx, r, op, i, who, scope, where, args); e != nil {
		return nil, e
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("wp4a|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	code := i.ChildCode
	create := strings.HasSuffix(op, "-create")
	if create {
		prefix := "CU-"
		if kind == "contact" {
			prefix = "CN-"
		}
		if kind == "invoice" {
			prefix = "CIP-"
		}
		code = prefix + strings.ReplaceAll(oid, "-", "")
	}
	if create {
		var currentOwner, currentDept string
		var deleted sql.NullTime
		if kind == "customer" {
			e = tx.QueryRowContext(ctx, "SELECT owner_uid,COALESCE(owner_dept_code,''),deleted_at FROM "+table+" WHERE BINARY code=BINARY ? FOR UPDATE", code).Scan(&currentOwner, &currentDept, &deleted)
			if e != nil && e != sql.ErrNoRows {
				return nil, e
			}
			if e == nil && (deleted.Valid || !altocScopeAllows(scope, who.Actor, currentOwner, currentDept)) {
				return nil, httperror.New(403, "altoc_customer_scope_denied", "Current customer unavailable")
			}
		} else {
			e = tx.QueryRowContext(ctx, "SELECT deleted_at FROM "+table+" WHERE BINARY code=BINARY ? FOR UPDATE", code).Scan(&deleted)
			if e != nil && e != sql.ErrNoRows {
				return nil, e
			}
			if e == nil && deleted.Valid {
				return nil, httperror.New(409, "altoc_child_deleted", "Object deleted")
			}
		}
	}
	if kind == "customer" && !create {
		if e = tx.QueryRowContext(ctx, "SELECT code FROM "+customer+" WHERE id=?", i.CustomerID).Scan(&code); e != nil {
			return nil, e
		}
	}
	if kind != "customer" && !create {
		var id int64
		if e = tx.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE BINARY code=BINARY ? AND customer_id=? FOR UPDATE", code, i.CustomerID).Scan(&id); e == sql.ErrNoRows {
			return nil, httperror.New(404, "altoc_child_not_found", "Child unavailable")
		} else if e != nil {
			return nil, e
		}
	}
	command := map[string]any{"operation": op, "intent": CustomerIntent(i), "actor": who.Actor}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(command)
	receipt, e := r.Table("service_command_receipt")
	if e != nil {
		return nil, e
	}
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.wp4a." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if !create {
			var version int64
			var deleted sql.NullTime
			if e := tx.QueryRowContext(ctx, "SELECT row_version,deleted_at FROM "+table+" WHERE BINARY code=BINARY ?", code).Scan(&version, &deleted); e != nil {
				return fail(e)
			}
			if deleted.Valid {
				return fail(httperror.New(409, "altoc_child_deleted", "Object deleted"))
			}
			if float64(version) != i.Payload["expectedVersion"] {
				return fail(httperror.New(409, "altoc_customer_version_conflict", "Object version changed"))
			}
		}
		if kind == "invoice" && (op == "invoice-profiles-set-default" || i.Payload["is_default"] == true) {
			if op == "invoice-profiles-set-default" {
				var status string
				if e := tx.QueryRowContext(ctx, "SELECT status FROM "+table+" WHERE BINARY code=BINARY ?", code).Scan(&status); e != nil {
					return fail(e)
				}
				if status != "active" {
					return fail(httperror.New(409, "altoc_invoice_inactive", "Default profile must be active"))
				}
			}
			if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET is_default=0,row_version=row_version+1,updated_by=? WHERE customer_id=? AND is_default=1 AND BINARY code<>BINARY ?", who.Actor, i.CustomerID, code); e != nil {
				return fail(e)
			}
		}
		fields := []string{}
		values := []any{}
		for k, v := range i.Payload {
			if k != "expectedVersion" {
				fields = append(fields, k)
				_ = v
			}
		}
		sort.Strings(fields)
		for _, k := range fields {
			values = append(values, i.Payload[k])
		}
		if op == "invoice-profiles-set-default" {
			fields = append(fields, "is_default")
			values = append(values, true)
		}
		if strings.HasSuffix(op, "-delete") {
			fields = append(fields, "deleted_at", "status")
			values = append(values, time.Now().UTC(), "inactive")
			if kind == "invoice" {
				fields = append(fields, "is_default")
				values = append(values, false)
			}
		}
		if create {
			fields = append(fields, "code", "created_by", "updated_by")
			values = append(values, code, who.Actor, who.Actor)
			if kind != "customer" {
				fields = append(fields, "customer_id")
				values = append(values, i.CustomerID)
			}
			if kind == "invoice" {
				if _, ok := i.Payload["is_default"]; !ok {
					fields = append(fields, "is_default")
					values = append(values, false)
				}
			}
			if _, e := tx.ExecContext(ctx, "INSERT INTO "+table+" ("+strings.Join(fields, ",")+") VALUES("+strings.TrimSuffix(strings.Repeat("?,", len(fields)), ",")+")", values...); e != nil {
				return fail(e)
			}
		} else {
			sets := []string{}
			for _, k := range fields {
				sets = append(sets, k+"=?")
			}
			sets = append(sets, "row_version=row_version+1", "updated_by=?")
			values = append(values, who.Actor, code)
			if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+strings.Join(sets, ",")+" WHERE BINARY code=BINARY ?", values...); e != nil {
				return fail(e)
			}
		}
		items, e := customerRows(ctx, tx, table, "BINARY code=BINARY ?", []any{code}, kind)
		if e != nil {
			return fail(e)
		}
		snapshot, e := json.Marshal(map[string]any{"data": items[0]})
		if e != nil {
			return fail(e)
		}
		audit, e := r.Table("altoc_audit_log")
		if e != nil {
			return fail(e)
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES (?,?,?,'version',?,?,'user',?)", kind, items[0]["id"], code, string(snapshot), who.Actor, who.RequestID); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(snapshot)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: kind, TargetBizCode: code + ":v" + strconv.FormatInt(items[0]["row_version"].(int64), 10), HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "altoc_customer_idempotency_conflict", "Intent changed")
	}
	if e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, customerInvalid()
	}
	audit, e := r.Table("altoc_audit_log")
	if e != nil {
		return nil, e
	}
	var snapshot []byte
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE entity_type=? AND BINARY entity_code=BINARY ? AND action='version' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.data.row_version'))=?", kind, parts[0], parts[1]).Scan(&snapshot); e != nil {
		return nil, e
	}
	if hooks.after != nil {
		if e = hooks.after(ctx, tx, parts[0]); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	var response any
	if e = json.Unmarshal(snapshot, &response); e != nil {
		return nil, e
	}
	return response, nil
}
func altocScopeAllows(s altoc.BasicReadScope, actor, owner, dept string) bool {
	switch s.Access {
	case "all":
		return true
	case "self":
		return actor == owner
	case "dept", "self_dept":
		for _, d := range s.DepartmentCodes {
			if d == dept {
				return true
			}
		}
		return s.Access == "self_dept" && actor == owner
	}
	return false
}

func (s *Service) CustomerRead(ctx context.Context, id, actor string, scope altoc.BasicReadScope, q altoc.BasicReadQuery) (any, error) {
	if e := q.Validate("customer"); e != nil {
		return nil, e
	}
	if id != "" && !validCustomerID(id) {
		return nil, customerInvalid()
	}
	tx, rs, metadata, e := s.beginW3Read(ctx, id != "")
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	table, e := r.Table("altoc_customer")
	if e != nil {
		return nil, e
	}
	where, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return nil, e
	}
	if q.ContactsOnly {
		if id == "" {
			return nil, customerInvalid()
		}
		out, err := readCustomerContacts(ctx, tx, r, metadata, table, where, args, id, q)
		if err != nil {
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return out, nil
	}
	where += " AND deleted_at IS NULL"
	if id != "" {
		where += " AND id=?"
		args = append(args, id)
	}
	if q.Search != "" {
		where += " AND (LOCATE(?,name)>0 OR LOCATE(?,code)>0)"
		args = append(args, q.Search, q.Search)
	}
	if q.Status != "" {
		where += " AND status=?"
		args = append(args, q.Status)
	}
	if q.ParentID != "" {
		where += " AND parent_customer_id=?"
		args = append(args, q.ParentID)
	}
	if q.RootsOnly {
		where += " AND parent_customer_id IS NULL"
	}
	if q.OwnerUnassigned {
		where += " AND owner_uid=?"
		args = append(args, unassignedOwnerReadFilter())
	}
	where, args = customerWorkspaceFilters(where, args, q)
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	order := "id"
	if q.CustomerSort == "updated_desc" {
		order = "updated_at DESC,id DESC"
	}
	if q.CustomerSort == "updated_asc" {
		order = "updated_at,id"
	}
	rows, e := customerRows(ctx, tx, table, where+" ORDER BY "+order+" LIMIT ? OFFSET ?", append(args, q.PageSize, (q.Page-1)*q.PageSize), "customer")
	if e != nil {
		return nil, e
	}
	for _, item := range rows {
		if level := item["customer_level_id"]; level != nil {
			if levels, err := r.Table("altoc_customer_level"); err == nil {
				var name string
				err = tx.QueryRowContext(ctx, "SELECT name FROM "+levels+" WHERE id=?", level).Scan(&name)
				if err != nil && err != sql.ErrNoRows {
					return nil, err
				}
				if err == nil {
					item["customer_level_name"] = name
				}
			}
		}
	}
	if e = projectCustomerPrimaryContacts(ctx, tx, r, rows); e != nil {
		return nil, e
	}
	if e = w3CustomerRelations(ctx, tx, table, actor, scope, q, rows); e != nil {
		return nil, e
	}
	var out any = map[string]any{"items": rows, "total": total, "page": q.Page, "pageSize": q.PageSize}
	if id != "" {
		if len(rows) != 1 {
			return nil, httperror.New(404, "altoc_customer_not_found", "Customer unavailable")
		}
		item := rows[0]
		for kind, logical := range map[string]string{"contacts": "altoc_contact", "invoice_profiles": "altoc_customer_invoice_profile"} {
			if kind == "contacts" && q.Workspace {
				item[kind] = []map[string]any{}
				continue
			}
			t, e := r.Table(logical)
			if e != nil {
				return nil, e
			}
			k := "contact"
			if kind == "invoice_profiles" {
				k = "invoice"
			}
			children, e := customerRows(ctx, tx, t, "customer_id=? AND deleted_at IS NULL ORDER BY id", []any{id}, k)
			if e != nil {
				return nil, e
			}
			if k == "contact" {
				for _, contact := range children {
					if e = w3ObjectMetadata(ctx, tx, metadata, "contact", contact); e != nil {
						return nil, e
					}
				}
			}
			item[kind] = children
		}
		if e = w3ObjectMetadata(ctx, tx, metadata, "customer", item); e != nil {
			return nil, e
		}
		out = item
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}

const customerHierarchyDepth = 10

// customerReferenceChecks validates the references the hierarchy, primary
// contact and star commands write, against rows locked or read in this transaction.
func (s *Service) customerReferenceChecks(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i CustomerInput, who Identity, scope altoc.BasicReadScope, where string, args []any) error {
	unavailable := httperror.New(409, "altoc_customer_fields_unavailable", "Customer fields are not installed")
	customers, e := r.Table("altoc_customer")
	if e != nil {
		return e
	}
	contacts, e := r.Table("altoc_contact")
	if e != nil {
		return e
	}
	if _, ok := i.Payload["star_level"]; ok {
		if has, e := financeHasColumn(ctx, tx, contacts, "star_level"); e != nil {
			return e
		} else if !has {
			return unavailable
		}
	}
	switch op {
	case "contacts-delete":
		// Deleting is a soft delete, so the foreign key would not stop it: a
		// customer's primary contact has to be replaced or cleared first.
		if has, e := financeHasColumn(ctx, tx, customers, "primary_contact_id"); e != nil {
			return e
		} else if has {
			var n int
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+customers+" c JOIN "+contacts+" k ON k.id=c.primary_contact_id WHERE c.id=? AND BINARY k.code=BINARY ?", i.CustomerID, i.ChildCode).Scan(&n); e != nil {
				return e
			}
			if n != 0 {
				return httperror.New(409, "altoc_contact_is_primary", "Replace or clear the primary contact first")
			}
		}
	case "customers-set-primary-contact":
		if has, e := financeHasColumn(ctx, tx, customers, "primary_contact_id"); e != nil {
			return e
		} else if !has {
			return unavailable
		}
		// The primary contact is one of this customer's own contacts.
		if v := i.Payload["primary_contact_id"]; v != nil {
			var n int
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+contacts+" WHERE id=? AND customer_id=? AND deleted_at IS NULL FOR SHARE", v, i.CustomerID).Scan(&n); e != nil {
				return e
			}
			if n != 1 {
				return httperror.New(409, "altoc_primary_contact_invalid", "The contact does not belong to this customer")
			}
		}
	case "customers-set-parent":
		parent, _ := i.Payload["parent_customer_id"].(string)
		if parent == "" {
			return nil
		}
		if parent == i.CustomerID {
			return httperror.New(409, "altoc_customer_hierarchy_invalid", "A customer cannot be its own parent")
		}
		// The caller must be allowed to see the parent it links to.
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+customers+" WHERE id=? AND deleted_at IS NULL AND ("+where+")", append([]any{parent}, args...)...).Scan(&n); e != nil {
			return e
		}
		if n != 1 {
			return httperror.New(403, "altoc_customer_scope_denied", "Parent customer outside authorized scope")
		}
		// Walk up from the new parent: reaching this customer is a cycle, and the
		// chain above plus the subtree below must fit the supported depth.
		above := 1
		for current := parent; ; above++ {
			var next sql.NullInt64
			if e = tx.QueryRowContext(ctx, "SELECT parent_customer_id FROM "+customers+" WHERE id=? FOR SHARE", current).Scan(&next); e != nil && e != sql.ErrNoRows {
				return e
			}
			if !next.Valid {
				break
			}
			current = strconv.FormatInt(next.Int64, 10)
			if current == i.CustomerID || above >= customerHierarchyDepth {
				return httperror.New(409, "altoc_customer_hierarchy_invalid", "The parent would create a cycle or exceed the supported depth")
			}
		}
		below, level := 0, []any{i.CustomerID}
		for len(level) > 0 {
			rows, e := tx.QueryContext(ctx, "SELECT id FROM "+customers+" WHERE deleted_at IS NULL AND parent_customer_id IN ("+strings.TrimSuffix(strings.Repeat("?,", len(level)), ",")+")", level...)
			if e != nil {
				return e
			}
			next := []any{}
			for rows.Next() {
				var id int64
				if e = rows.Scan(&id); e != nil {
					rows.Close()
					return e
				}
				next = append(next, id)
			}
			if e = rows.Close(); e != nil {
				return e
			}
			if len(next) > 0 {
				below++
			}
			if above+below >= customerHierarchyDepth || len(next) > customerSubtreeNodes {
				return httperror.New(409, "altoc_customer_hierarchy_invalid", "The parent would create a cycle or exceed the supported depth")
			}
			level = next
		}
	}
	_ = who
	_ = scope
	return nil
}
