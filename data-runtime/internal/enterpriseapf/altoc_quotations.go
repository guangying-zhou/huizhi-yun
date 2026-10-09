package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type QuotationItem struct {
	Name          string  `json:"item_name"`
	Specification *string `json:"specification"`
	Unit          *string `json:"unit"`
	Quantity      string  `json:"quantity"`
	Price         string  `json:"unit_price"`
	Discount      string  `json:"discount_rate"`
	Tax           string  `json:"tax_rate"`
}
type QuotationInput struct {
	ID         string          `json:"id"`
	CustomerID string          `json:"customerId"`
	Page       int             `json:"page"`
	PageSize   int             `json:"pageSize"`
	Version    int             `json:"version"`
	Payload    map[string]any  `json:"payload"`
	Items      []QuotationItem `json:"items"`
}

func QuotationPermission(op string) (string, string, bool) {
	switch op {
	case "quotation-versions-list", "quotation-versions-view":
		return "quotation", "view", true
	case "quotations-create", "quotations-update", "quotation-items-replace", "quotations-transition":
		return "quotation", "edit", true
	}
	return "", "", false
}
func QuotationIntent(i QuotationInput) []any {
	keys := []string{}
	for k := range i.Payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := []any{}
	for _, k := range keys {
		pairs = append(pairs, []any{k, i.Payload[k]})
	}
	items := []any{}
	for _, v := range i.Items {
		items = append(items, []any{v.Name, v.Specification, v.Unit, v.Quantity, v.Price, v.Discount, v.Tax})
	}
	return []any{i.ID, i.CustomerID, i.Page, i.PageSize, i.Version, pairs, items}
}
func quoteInvalid() error {
	return httperror.New(400, "altoc_quotation_input_invalid", "Invalid quotation command")
}
func ValidateQuotationInput(op string, i QuotationInput) error {
	_, action, ok := QuotationPermission(op)
	if !ok {
		return quoteInvalid()
	}
	create := op == "quotations-create"
	if create {
		if i.ID != "" || !validCustomerID(i.CustomerID) {
			return quoteInvalid()
		}
	} else if !validCustomerID(i.ID) || i.CustomerID != "" {
		return quoteInvalid()
	}
	if op == "quotation-versions-list" {
		if i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 {
			return quoteInvalid()
		}
	} else if i.Page != 0 || i.PageSize != 0 {
		return quoteInvalid()
	}
	if op == "quotation-versions-view" {
		if i.Version < 1 {
			return quoteInvalid()
		}
	} else if i.Version != 0 {
		return quoteInvalid()
	}
	if action == "view" {
		if len(i.Payload) > 0 || len(i.Items) > 0 {
			return quoteInvalid()
		}
		return nil
	}
	if !create {
		v, ok := i.Payload["expectedVersion"].(float64)
		if !ok || v < 1 || v > 4294967295 || v != float64(int64(v)) {
			return quoteInvalid()
		}
	}
	for k, v := range i.Payload {
		if k == "expectedVersion" && !create {
			continue
		}
		switch k {
		case "quotation_no":
			if op == "quotation-items-replace" || op == "quotations-transition" || !stringValue(v, 50, true) {
				return quoteInvalid()
			}
		case "valid_until":
			if op == "quotation-items-replace" || op == "quotations-transition" {
				return quoteInvalid()
			}
			if v != nil {
				str, ok := v.(string)
				if !ok || !dateValid(str) {
					return quoteInvalid()
				}
			}
		case "remark":
			if op == "quotation-items-replace" || op == "quotations-transition" || !stringValue(v, 500, true) {
				return quoteInvalid()
			}
		case "currency_code":
			value, valid := v.(string)
			if !create || !valid || !currencyCode.MatchString(value) {
				return quoteInvalid()
			}
		case "action":
			if op != "quotations-transition" || (v != "submit" && v != "send" && v != "accept") {
				return quoteInvalid()
			}
		default:
			return quoteInvalid()
		}
	}
	if create {
		v, ok := i.Payload["currency_code"].(string)
		if !ok || !currencyCode.MatchString(v) {
			return quoteInvalid()
		}
	}
	if op == "quotations-transition" && i.Payload["action"] == nil {
		return quoteInvalid()
	}
	if op == "quotations-update" && len(i.Payload) < 2 {
		return quoteInvalid()
	}
	if op != "quotation-items-replace" {
		if len(i.Items) != 0 {
			return quoteInvalid()
		}
	} else {
		if len(i.Items) == 0 || len(i.Items) > 1000 {
			return quoteInvalid()
		}
		for _, v := range i.Items {
			if !stringValue(v.Name, 200, false) || v.Specification != nil && !stringValue(*v.Specification, 500, true) || v.Unit != nil && !stringValue(*v.Unit, 20, true) || !decimalValid(v.Quantity, 18, 4) || !decimalValid(v.Price, 18, 2) || !decimalValid(v.Discount, 5, 2) || !decimalValid(v.Tax, 5, 2) {
				return quoteInvalid()
			}
			q, _ := new(big.Rat).SetString(v.Quantity)
			d, _ := new(big.Rat).SetString(v.Discount)
			tax, _ := new(big.Rat).SetString(v.Tax)
			if q.Sign() <= 0 || d.Cmp(big.NewRat(100, 1)) > 0 || tax.Cmp(big.NewRat(100, 1)) > 0 {
				return quoteInvalid()
			}
		}
	}
	return nil
}

var quotationCols = []string{"id", "code", "quotation_no", "customer_id", "version_no", "status", "valid_until", "amount_tax_inclusive", "amount_tax_exclusive", "currency_code", "owner_uid", "owner_dept_code", "remark", "row_version"}
var quotationItemCols = []string{"id", "quotation_id", "line_no", "item_name", "specification", "unit", "quantity", "unit_price", "discount_rate", "tax_rate", "amount_tax_inclusive", "amount_tax_exclusive"}

func quoteRows(ctx context.Context, tx *sql.Tx, t, w string, args []any) ([]map[string]any, error) {
	cols := append([]string{}, quotationCols...)
	selects := append([]string{}, cols...)
	for n, c := range cols {
		if c == "valid_until" {
			selects[n] = "CAST(valid_until AS CHAR)"
		}
	}
	r, e := tx.QueryContext(ctx, "SELECT "+strings.Join(selects, ",")+" FROM "+t+" WHERE "+w, args...)
	if e != nil {
		return nil, e
	}
	return readFinanceRows(r, cols)
}
func quoteSnapshot(ctx context.Context, tx *sql.Tx, table, items, id string) (map[string]any, error) {
	rows, e := quoteRows(ctx, tx, table, "id=?", []any{id})
	if e != nil {
		return nil, e
	}
	if len(rows) != 1 {
		return nil, httperror.New(404, "altoc_quotation_not_found", "Quotation unavailable")
	}
	r, e := tx.QueryContext(ctx, "SELECT "+strings.Join(quotationItemCols, ",")+" FROM "+items+" WHERE quotation_id=? ORDER BY line_no", id)
	if e != nil {
		return nil, e
	}
	children, e := readFinanceRows(r, quotationItemCols)
	if e != nil {
		return nil, e
	}
	rows[0]["items"] = children
	return rows[0], nil
}
func roundedMoney(r *big.Rat) (string, error) {
	n := new(big.Int).Mul(r.Num(), big.NewInt(100))
	q, rem := new(big.Int), new(big.Int)
	q.QuoRem(n, r.Denom(), rem)
	if new(big.Int).Mul(rem, big.NewInt(2)).Cmp(r.Denom()) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	text := q.String()
	if len(text) > 18 {
		return "", quoteInvalid()
	}
	for len(text) < 3 {
		text = "0" + text
	}
	return text[:len(text)-2] + "." + text[len(text)-2:], nil
}
func quotationAmounts(i QuotationItem) (string, string, error) {
	q, _ := new(big.Rat).SetString(i.Quantity)
	p, _ := new(big.Rat).SetString(i.Price)
	d, _ := new(big.Rat).SetString(i.Discount)
	tax, _ := new(big.Rat).SetString(i.Tax)
	gross := new(big.Rat).Mul(q, p)
	gross.Mul(gross, new(big.Rat).Quo(new(big.Rat).Sub(big.NewRat(100, 1), d), big.NewRat(100, 1)))
	g, e := roundedMoney(gross)
	if e != nil {
		return "", "", e
	}
	rounded, _ := new(big.Rat).SetString(g)
	net := new(big.Rat).Quo(rounded, new(big.Rat).Add(big.NewRat(1, 1), new(big.Rat).Quo(tax, big.NewRat(100, 1))))
	n, e := roundedMoney(net)
	return g, n, e
}
func (s *Service) Quotation(ctx context.Context, op string, i QuotationInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var d *mysql.MySQLError
		if errors.As(err, &d) && (d.Number == 1062 || d.Number == 1213 || d.Number == 1205) {
			err = httperror.New(409, "altoc_quotation_conflict", "Concurrent quotation conflict")
		}
	}()
	if e := ValidateQuotationInput(op, i); e != nil {
		return nil, e
	}
	if e := s.verifyOwnerTargets(ctx, i.Payload); e != nil {
		return nil, e
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, httperror.New(403, "altoc_quotation_identity_invalid", "Invalid quotation actor")
	}
	_, action, _ := QuotationPermission(op)
	write := action == "edit"
	if write && who.Key == "" {
		return nil, quoteInvalid()
	}
	req, e := s.request("altoc", enterprise.Read)
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if write {
		req.Operation = enterprise.Write
		tx, rs, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		tx, rs, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	table, e := r.Table("altoc_quotation")
	if e != nil {
		return nil, e
	}
	items, _ := r.Table("altoc_quotation_item")
	versions, _ := r.Table("altoc_quotation_version")
	customer, _ := r.Table("altoc_customer")
	_, _, e = scopeSQL("altoc", who.Actor, scope)
	if e != nil {
		return nil, e
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("wp4b|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	code := "QU-" + strings.ReplaceAll(oid, "-", "")
	id := i.ID
	var owner, dept, status string
	var rowVersion int64
	if op == "quotations-create" {
		var customerOwner, customerDept string
		if e = tx.QueryRowContext(ctx, "SELECT owner_uid,COALESCE(owner_dept_code,'') FROM "+customer+" WHERE id=? AND deleted_at IS NULL FOR UPDATE", i.CustomerID).Scan(&customerOwner, &customerDept); e == sql.ErrNoRows {
			return nil, httperror.New(404, "altoc_customer_not_found", "Customer unavailable")
		} else if e != nil {
			return nil, e
		}
		if !altocScopeAllows(scope, who.Actor, customerOwner, customerDept) {
			return nil, httperror.New(403, "altoc_quotation_scope_denied", "Customer outside scope")
		}
		owner = who.Actor
		dept = customerDept
		if !altocScopeAllows(scope, who.Actor, owner, dept) {
			return nil, httperror.New(403, "altoc_quotation_scope_denied", "Quotation outside scope")
		}
		e = tx.QueryRowContext(ctx, "SELECT id,owner_uid,COALESCE(owner_dept_code,''),status,row_version FROM "+table+" WHERE BINARY code=BINARY ? AND deleted_at IS NULL FOR UPDATE", code).Scan(&id, &owner, &dept, &status, &rowVersion)
		if e != nil && e != sql.ErrNoRows {
			return nil, e
		}
		if e == nil && !altocScopeAllows(scope, who.Actor, owner, dept) {
			return nil, httperror.New(403, "altoc_quotation_scope_denied", "Quotation outside scope")
		}
	} else {
		lock := ""
		if write {
			lock = " FOR UPDATE"
		}
		if e = tx.QueryRowContext(ctx, "SELECT code,owner_uid,COALESCE(owner_dept_code,''),status,row_version FROM "+table+" WHERE id=? AND deleted_at IS NULL"+lock, id).Scan(&code, &owner, &dept, &status, &rowVersion); e == sql.ErrNoRows {
			return nil, httperror.New(404, "altoc_quotation_not_found", "Quotation unavailable")
		} else if e != nil {
			return nil, e
		}
		if !altocScopeAllows(scope, who.Actor, owner, dept) {
			return nil, httperror.New(403, "altoc_quotation_scope_denied", "Quotation outside scope")
		}
	}
	if !write {
		if op == "quotation-versions-view" {
			var snapshot []byte
			if e = tx.QueryRowContext(ctx, "SELECT snapshot_json FROM "+versions+" WHERE quotation_id=? AND version_no=?", id, i.Version).Scan(&snapshot); e == sql.ErrNoRows {
				return nil, httperror.New(404, "altoc_quotation_version_not_found", "Version unavailable")
			} else if e != nil {
				return nil, e
			}
			var data any
			if e = json.Unmarshal(snapshot, &data); e != nil {
				return nil, e
			}
			out = map[string]any{"data": data}
		} else {
			var total int
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+versions+" WHERE quotation_id=?", id).Scan(&total); e != nil {
				return nil, e
			}
			rows, e := tx.QueryContext(ctx, "SELECT id,version_no,snapshot_sha256,created_by,CAST(created_at AS CHAR) AS created_at FROM "+versions+" WHERE quotation_id=? ORDER BY version_no DESC LIMIT ? OFFSET ?", id, i.PageSize, (i.Page-1)*i.PageSize)
			if e != nil {
				return nil, e
			}
			data, e := readFinanceRows(rows, []string{"id", "version_no", "snapshot_sha256", "created_by", "created_at"})
			if e != nil {
				return nil, e
			}
			out = map[string]any{"data": data, "total": total, "page": i.Page, "pageSize": i.PageSize}
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	if (op == "quotations-update" || op == "quotation-items-replace") && status != "draft" && status != "rejected" {
		return nil, httperror.New(409, "altoc_quotation_frozen", "Only draft or rejected quotations can be edited")
	}
	command := map[string]any{"operation": op, "intent": QuotationIntent(i), "actor": who.Actor}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(command)
	receipt, _ := r.Table("service_command_receipt")
	audit, _ := r.Table("altoc_audit_log")
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "altoc", OperationID: oid, OperationCode: "altoc.wp4b." + op + ".v1", RequiredCapability: "altoc:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		fail := func(e error) (integrationoperation.ReceiptBusinessResult, error) {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if op != "quotations-create" && float64(rowVersion) != i.Payload["expectedVersion"] {
			return fail(httperror.New(409, "altoc_quotation_version_conflict", "Quotation version changed"))
		}
		switch op {
		case "quotations-create":
			fields := []string{"code", "customer_id", "owner_uid", "owner_dept_code", "created_by", "updated_by"}
			vals := []any{code, i.CustomerID, owner, dept, who.Actor, who.Actor}
			for _, k := range []string{"quotation_no", "valid_until", "currency_code", "remark"} {
				if v, ok := i.Payload[k]; ok {
					fields = append(fields, k)
					vals = append(vals, v)
				}
			}
			res, e := tx.ExecContext(ctx, "INSERT INTO "+table+" ("+strings.Join(fields, ",")+") VALUES("+strings.TrimSuffix(strings.Repeat("?,", len(vals)), ",")+")", vals...)
			if e != nil {
				return fail(e)
			}
			n, e := res.LastInsertId()
			if e != nil {
				return fail(e)
			}
			id = strconv.FormatInt(n, 10)
		case "quotations-update":
			sets := []string{}
			vals := []any{}
			for _, k := range []string{"quotation_no", "valid_until", "remark"} {
				if v, ok := i.Payload[k]; ok {
					sets = append(sets, k+"=?")
					vals = append(vals, v)
				}
			}
			sets = append(sets, "row_version=row_version+1", "updated_by=?")
			vals = append(vals, who.Actor, id)
			if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+strings.Join(sets, ",")+" WHERE id=?", vals...); e != nil {
				return fail(e)
			}
		case "quotation-items-replace":
			gross, net := big.NewRat(0, 1), big.NewRat(0, 1)
			if _, e := tx.ExecContext(ctx, "DELETE FROM "+items+" WHERE quotation_id=?", id); e != nil {
				return fail(e)
			}
			for n, v := range i.Items {
				g, x, e := quotationAmounts(v)
				if e != nil {
					return fail(e)
				}
				gr, _ := new(big.Rat).SetString(g)
				nr, _ := new(big.Rat).SetString(x)
				gross.Add(gross, gr)
				net.Add(net, nr)
				if _, e = tx.ExecContext(ctx, "INSERT INTO "+items+" (quotation_id,line_no,item_name,specification,unit,quantity,unit_price,discount_rate,tax_rate,amount_tax_inclusive,amount_tax_exclusive,sort_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", id, n+1, v.Name, v.Specification, v.Unit, v.Quantity, v.Price, v.Discount, v.Tax, g, x, n); e != nil {
					return fail(e)
				}
			}
			g, e := roundedMoney(gross)
			if e != nil {
				return fail(e)
			}
			n, e := roundedMoney(net)
			if e != nil {
				return fail(e)
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+table+" SET amount_tax_inclusive=?,amount_tax_exclusive=?,row_version=row_version+1,updated_by=? WHERE id=?", g, n, who.Actor, id); e != nil {
				return fail(e)
			}
		case "quotations-transition":
			act := i.Payload["action"]
			if act == "submit" {
				return fail(httperror.New(409, "altoc_quotation_workflow_not_ready", "Quotation approval is not connected; submission is disabled"))
			}
			next := ""
			if act == "send" && status == "approved" {
				next = "sent"
			}
			if act == "accept" && status == "sent" {
				next = "accepted"
			}
			if next == "" {
				return fail(httperror.New(409, "altoc_quotation_state_conflict", "Invalid quotation transition"))
			}
			if act == "send" {
				var next int
				if e := tx.QueryRowContext(ctx, "SELECT GREATEST(q.version_no,COALESCE(MAX(v.version_no),0)+1) FROM "+table+" q LEFT JOIN "+versions+" v ON v.quotation_id=q.id WHERE q.id=? GROUP BY q.id,q.version_no", id).Scan(&next); e != nil {
					return fail(e)
				}
				if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET version_no=? WHERE id=?", next, id); e != nil {
					return fail(e)
				}
				snapshot, e := quoteSnapshot(ctx, tx, table, items, id)
				if e != nil {
					return fail(e)
				}
				snapshot["status"] = "sent"
				snapshot["row_version"] = rowVersion + 1
				bytes, e := json.Marshal(snapshot)
				if e != nil {
					return fail(e)
				}
				hash := sha256.Sum256(bytes)
				if _, e = tx.ExecContext(ctx, "INSERT INTO "+versions+" (quotation_id,version_no,snapshot_json,snapshot_sha256,created_by) SELECT id,version_no,?,?,? FROM "+table+" WHERE id=?", string(bytes), hex.EncodeToString(hash[:]), who.Actor, id); e != nil {
					return fail(e)
				}
			}
			stamp := "sent_at"
			if next == "accepted" {
				stamp = "accepted_at"
			}
			if _, e := tx.ExecContext(ctx, "UPDATE "+table+" SET status=?,"+stamp+"=CURRENT_TIMESTAMP(3),row_version=row_version+1,last_status_changed_by=?,last_status_changed_at=CURRENT_TIMESTAMP(3),updated_by=? WHERE id=?", next, who.Actor, who.Actor, id); e != nil {
				return fail(e)
			}
		}
		snapshot, e := quoteSnapshot(ctx, tx, table, items, id)
		if e != nil {
			return fail(e)
		}
		bytes, e := json.Marshal(map[string]any{"data": snapshot})
		if e != nil {
			return fail(e)
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('quotation',?,?, 'version',?,?,'user',?)", id, code, string(bytes), who.Actor, who.RequestID); e != nil {
			return fail(e)
		}
		hash := sha256.Sum256(bytes)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "quotation", TargetBizCode: code + ":v" + strconv.FormatInt(snapshot["row_version"].(int64), 10), HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if errors.Is(e, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "altoc_quotation_idempotency_conflict", "Intent changed")
	}
	if e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, quoteInvalid()
	}
	var bytes []byte
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE entity_type='quotation' AND BINARY entity_code=BINARY ? AND action='version' AND JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.data.row_version'))=?", parts[0], parts[1]).Scan(&bytes); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	if e = json.Unmarshal(bytes, &out); e != nil {
		return nil, e
	}
	return out, nil
}
func (s *Service) QuotationRead(ctx context.Context, id, actor string, scope altoc.BasicReadScope, q altoc.SalesReadQuery) (any, error) {
	if e := q.Validate("quotation"); e != nil {
		return nil, e
	}
	if id != "" && !validCustomerID(id) {
		return nil, quoteInvalid()
	}
	req, e := s.request("altoc", enterprise.Read)
	if e != nil {
		return nil, e
	}
	tx, rs, e := s.registry.BeginSnapshotReadTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	table, e := r.Table("altoc_quotation")
	if e != nil {
		return nil, e
	}
	items, _ := r.Table("altoc_quotation_item")
	where, args, e := scopeSQL("altoc", actor, scope)
	if e != nil {
		return nil, e
	}
	where += " AND deleted_at IS NULL"
	if id != "" {
		where += " AND id=?"
		args = append(args, id)
	}
	for _, p := range []struct{ col, value string }{{"status", q.Status}, {"customer_id", q.CustomerID}, {"opportunity_id", q.OpportunityID}} {
		if p.value != "" {
			where += " AND " + p.col + "=?"
			args = append(args, p.value)
		}
	}
	if q.Search != "" {
		where += " AND (LOCATE(?,code)>0 OR LOCATE(?,COALESCE(quotation_no,''))>0)"
		args = append(args, q.Search, q.Search)
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	rows, e := quoteRows(ctx, tx, table, where+" ORDER BY id DESC LIMIT ? OFFSET ?", append(args, q.PageSize, (q.Page-1)*q.PageSize))
	if e != nil {
		return nil, e
	}
	var out any = map[string]any{"items": rows, "total": total, "page": q.Page, "pageSize": q.PageSize}
	if id != "" {
		if len(rows) != 1 {
			return nil, httperror.New(404, "altoc_quotation_not_found", "Quotation unavailable")
		}
		out, e = quoteSnapshot(ctx, tx, table, items, id)
		if e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}
