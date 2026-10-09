package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"math/big"
	"strings"
	"time"
)

type contractCollection struct {
	key, table, order string
	cols              []string
}

func (c contractCollection) selects() string {
	cols := append([]string{}, c.cols...)
	for n, k := range cols {
		if strings.HasSuffix(k, "_date") || strings.HasSuffix(k, "_at") {
			cols[n] = "CAST(" + k + " AS CHAR) AS " + k
		}
	}
	return strings.Join(cols, ",")
}

var contractCollections = map[string]contractCollection{
	"lines":             {"lines", "altoc_contract_line", "line_no,id", []string{"id", "code", "contract_id", "line_no", "line_type", "name", "quantity", "unit", "unit_price", "amount_tax_inclusive", "amount_tax_exclusive", "tax_rate", "currency_code", "acceptance_required", "project_policy", "status", "row_version"}},
	"payment_terms":     {"payment_terms", "altoc_contract_payment_term", "sort_no,id", []string{"id", "code", "contract_id", "contract_line_id", "term_name", "term_type", "amount", "ratio", "currency_code", "trigger_type", "trigger_stage_type", "trigger_obligation_id", "expected_date", "recurrence_interval", "service_start_date", "service_end_date", "invoice_required", "row_version"}},
	"obligations":       {"obligations", "altoc_contract_obligation", "sort_no,id", []string{"id", "code", "contract_id", "contract_line_id", "obligation_type", "name", "status", "acceptance_required", "source_type", "row_version"}},
	"billing_schedules": {"billing_schedules", "altoc_billing_schedule", "id", []string{"id", "code", "contract_id", "contract_line_id", "obligation_id", "payment_term_id", "name", "direction", "amount", "currency_code", "trigger_type", "trigger_ref_code", "recurrence_period", "due_date", "status", "invoiced_amount", "received_amount", "source_type", "source_ref_code", "row_version"}},
	"project_links":     {"project_links", "altoc_contract_project_link", "id", []string{"id", "contract_id", "project_code", "project_name_snapshot", "project_role", "link_mode", "status", "row_version"}},
}

func validateContractRows(op string, rows []map[string]any) error {
	allowed := map[string]bool{"id": true}
	switch op {
	case "contract-lines-replace":
		for _, k := range []string{"line_type", "name", "quantity", "unit", "unit_price", "tax_rate", "acceptance_required", "project_policy"} {
			allowed[k] = true
		}
	case "payment-terms-replace":
		for _, k := range []string{"contract_line_code", "term_name", "term_type", "amount", "ratio", "trigger_type", "trigger_stage_type", "trigger_obligation_code", "expected_date", "recurrence_interval", "service_start_date", "service_end_date", "invoice_required"} {
			allowed[k] = true
		}
	case "obligations-replace":
		for _, k := range []string{"contract_line_code", "obligation_type", "name", "acceptance_required"} {
			allowed[k] = true
		}
	}
	seen := map[string]bool{}
	for _, r := range rows {
		for k, v := range r {
			if !allowed[k] {
				return contractError(400, "altoc_contract_child_input_invalid")
			}
			switch k {
			case "id":
				if !validCustomerID(fmt.Sprint(v)) || seen[fmt.Sprint(v)] {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
				seen[fmt.Sprint(v)] = true
			case "acceptance_required", "invoice_required":
				if _, ok := v.(bool); !ok {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			case "quantity":
				s, ok := v.(string)
				if !ok || !decimalValid(s, 18, 4) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
				n, _ := new(big.Rat).SetString(s)
				if n.Sign() <= 0 {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			case "unit_price", "amount":
				s, ok := v.(string)
				if !ok || !decimalValid(s, 18, 2) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			case "tax_rate", "ratio":
				if v == nil && k == "ratio" {
					continue
				}
				s, ok := v.(string)
				scale := 2
				width := 5
				if k == "ratio" {
					scale = 4
					width = 8
				}
				if !ok || !decimalValid(s, width, scale) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
				n, _ := new(big.Rat).SetString(s)
				if n.Cmp(big.NewRat(100, 1)) > 0 {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			case "name", "term_name":
				if !stringValue(v, 200, false) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
				if k == "term_name" && !stringValue(v, 100, false) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			case "unit":
				if !stringValue(v, 30, true) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			case "contract_line_code", "trigger_obligation_code":
				if v != nil && !stringValue(v, 64, false) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			case "expected_date", "service_start_date", "service_end_date":
				if v != nil {
					v, ok := v.(string)
					if !ok || !dateValid(v) {
						return contractError(400, "altoc_contract_child_input_invalid")
					}
				}
			default:
				if !stringValue(v, 50, true) {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			}
		}
		if op == "contract-lines-replace" {
			for _, k := range []string{"line_type", "name", "quantity", "unit_price", "tax_rate", "acceptance_required", "project_policy"} {
				if r[k] == nil {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			}
			if !oneOf(r["line_type"], "software_license", "implementation", "customization", "service", "maintenance", "hardware", "training", "other") || !oneOf(r["project_policy"], "none", "optional", "required") {
				return contractError(400, "altoc_contract_child_input_invalid")
			}
		}
		if op == "payment-terms-replace" {
			for _, k := range []string{"term_name", "term_type", "trigger_type", "invoice_required"} {
				if r[k] == nil {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			}
			if r["amount"] == nil && r["ratio"] == nil || !oneOf(r["term_type"], "one_time", "advance", "milestone", "acceptance", "retention", "annual_service", "recurring") || !oneOf(r["trigger_type"], "contract_signed", "stage_completed", "obligation_completed", "obligation_accepted", "milestone_accepted", "date", "recurring", "manual") {
				return contractError(400, "altoc_contract_child_input_invalid")
			}
			if oneOf(r["trigger_type"], "obligation_completed", "obligation_accepted") && r["trigger_obligation_code"] == nil {
				return contractError(400, "altoc_contract_child_input_invalid")
			}
			if r["trigger_type"] == "stage_completed" && !oneOf(r["trigger_stage_type"], "contract_signed", "delivery", "acceptance", "service_end") {
				return contractError(400, "altoc_contract_child_input_invalid")
			}
			if r["trigger_type"] == "recurring" || oneOf(r["term_type"], "recurring", "annual_service") {
				if !oneOf(r["recurrence_interval"], "month", "quarter", "year") || r["service_start_date"] == nil || r["service_end_date"] == nil {
					return contractError(400, "altoc_contract_child_input_invalid")
				}
			}
		}
		if op == "obligations-replace" {
			if r["name"] == nil || !oneOf(r["obligation_type"], "delivery", "acceptance", "service_period", "service_delivery", "goods_delivery", "training", "warranty") || r["acceptance_required"] == nil {
				return contractError(400, "altoc_contract_child_input_invalid")
			}
		}
	}
	return nil
}
func oneOf(v any, values ...string) bool {
	for _, x := range values {
		if v == x {
			return true
		}
	}
	return false
}
func childID(ctx context.Context, tx *sql.Tx, t map[string]string, table, id, code string) (any, error) {
	if code == "" {
		return nil, nil
	}
	var n int64
	e := tx.QueryRowContext(ctx, "SELECT id FROM "+t[table]+" WHERE contract_id=? AND BINARY code=BINARY ? AND deleted_at IS NULL", id, code).Scan(&n)
	if e == sql.ErrNoRows {
		return nil, contractError(403, "altoc_contract_child_mismatch")
	}
	return n, e
}
func text(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func untouchedContractSchedules(ctx context.Context, tx *sql.Tx, t map[string]string, id string) error {
	var n int
	e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["altoc_billing_schedule"]+" WHERE contract_id=? AND (invoiced_amount<>0 OR received_amount<>0 OR status NOT IN('planned','cancelled'))", id).Scan(&n)
	if e != nil {
		return e
	}
	if n > 0 {
		return contractError(409, "altoc_contract_settlement_started")
	}
	return nil
}
func existingChildRows(ctx context.Context, tx *sql.Tx, t map[string]string, table, id string) (map[string]string, error) {
	r, e := tx.QueryContext(ctx, "SELECT id,code FROM "+t[table]+" WHERE contract_id=? AND deleted_at IS NULL ORDER BY id", id)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := map[string]string{}
	for r.Next() {
		var n int64
		var c string
		if e = r.Scan(&n, &c); e != nil {
			return nil, e
		}
		out[fmt.Sprint(n)] = c
	}
	return out, r.Err()
}
func contractChildCode(prefix, contract, key string, index int) string {
	return prefix + "-" + fmt.Sprintf("%x", contractHash(contract+"|"+key+"|"+fmt.Sprint(index)))[:32]
}
func replaceContractLines(ctx context.Context, tx *sql.Tx, t map[string]string, id, code string, who Identity, rows []map[string]any, fromQuote bool) error {
	if e := untouchedContractSchedules(ctx, tx, t, id); e != nil {
		return e
	}
	existing, e := existingChildRows(ctx, tx, t, "altoc_contract_line", id)
	if e != nil {
		return e
	}
	keep := map[string]bool{}
	// Move line numbers temporarily to avoid reorder collisions; deleted rows also
	// retain unique numbers, so reserve a disjoint negative range for all old rows.
	if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_line"]+" SET line_no=-id WHERE contract_id=?", id); e != nil {
		return e
	}
	var currency, direction string
	if e = tx.QueryRowContext(ctx, "SELECT currency_code,direction FROM "+t["altoc_contract"]+" WHERE id=?", id).Scan(&currency, &direction); e != nil {
		return e
	}
	for n, r := range rows {
		rid := text(r["id"])
		childCode := existing[rid]
		if rid != "" && childCode == "" {
			return contractError(403, "altoc_contract_child_mismatch")
		}
		if rid == "" {
			childCode = contractChildCode("CL", code, who.Key, n)
		}
		keep[rid] = true
		item := QuotationItem{Name: text(r["name"]), Quantity: text(r["quantity"]), Price: text(r["unit_price"]), Discount: "0.00", Tax: text(r["tax_rate"])}
		gross, net, e := quotationAmounts(item)
		if e != nil {
			return e
		}
		if fromQuote {
			gross = text(r["source_amount"])
			g, ok := new(big.Rat).SetString(gross)
			if !ok {
				return contractError(400, "altoc_contract_quote_amount_invalid")
			}
			tax, _ := new(big.Rat).SetString(item.Tax)
			net, e = roundedMoney(new(big.Rat).Quo(g, new(big.Rat).Add(big.NewRat(1, 1), new(big.Rat).Quo(tax, big.NewRat(100, 1)))))
			if e != nil {
				return e
			}
		}
		accept := r["acceptance_required"] == true
		policy := text(r["project_policy"])
		if policy == "" {
			policy = "none"
		}
		if rid == "" {
			res, e := tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_line"]+" (code,contract_id,line_no,line_type,name,quantity,unit,unit_price,tax_rate,amount_tax_inclusive,amount_tax_exclusive,currency_code,acceptance_required,project_policy,source_quotation_item_id,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", childCode, id, n+1, r["line_type"], r["name"], r["quantity"], r["unit"], r["unit_price"], r["tax_rate"], gross, net, currency, accept, policy, r["source_quotation_item_id"], who.Actor, who.Actor)
			if e != nil {
				return e
			}
			num, e := res.LastInsertId()
			if e != nil {
				return e
			}
			rid = fmt.Sprint(num)
		} else {
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_line"]+" SET line_no=?,line_type=?,name=?,quantity=?,unit=?,unit_price=?,tax_rate=?,amount_tax_inclusive=?,amount_tax_exclusive=?,acceptance_required=?,project_policy=?,row_version=row_version+1,updated_by=? WHERE id=?", n+1, r["line_type"], r["name"], r["quantity"], r["unit"], r["unit_price"], r["tax_rate"], gross, net, accept, policy, who.Actor, rid); e != nil {
				return e
			}
		}
		keep[rid] = true
		obCode := "OB-" + childCode[3:]
		typ := "delivery"
		if oneOf(r["line_type"], "service", "maintenance") {
			typ = "service_delivery"
		}
		if r["line_type"] == "hardware" {
			typ = "goods_delivery"
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_obligation"]+" (code,contract_id,contract_line_id,obligation_type,name,acceptance_required,source_type,source_ref_code,created_by,updated_by) VALUES (?,?,?,?,?,?,'contract_line',?,?,?) ON DUPLICATE KEY UPDATE deleted_at=NULL,status='not_started',name=VALUES(name),obligation_type=VALUES(obligation_type),acceptance_required=VALUES(acceptance_required),row_version=row_version+1,updated_by=VALUES(updated_by)", obCode, id, rid, typ, r["name"], accept, childCode, who.Actor, who.Actor); e != nil {
			return e
		}
		if accept {
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_obligation"]+" SET acceptance_required=0 WHERE contract_id=? AND BINARY code=BINARY ?", id, obCode); e != nil {
				return e
			}
			obCode += "-ACCEPT"
			if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_obligation"]+" (code,contract_id,contract_line_id,obligation_type,name,acceptance_required,source_type,source_ref_code,created_by,updated_by) VALUES (?,?,?,'acceptance',?,1,'contract_line',?,?,?) ON DUPLICATE KEY UPDATE deleted_at=NULL,status='not_started',name=VALUES(name),row_version=row_version+1,updated_by=VALUES(updated_by)", obCode, id, rid, text(r["name"])+"验收", childCode, who.Actor, who.Actor); e != nil {
				return e
			}
		} else {
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_obligation"]+" SET deleted_at=CURRENT_TIMESTAMP(3),status='cancelled' WHERE contract_id=? AND BINARY code=BINARY ?", id, obCode+"-ACCEPT"); e != nil {
				return e
			}
		}
		obligation, e := childID(ctx, tx, t, "altoc_contract_obligation", id, obCode)
		if e != nil {
			return e
		}
		trigger := "obligation_completed"
		if accept {
			trigger = "obligation_accepted"
		}
		billingDirection := "receivable"
		if direction == "purchase" {
			billingDirection = "payable"
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_billing_schedule"]+" (code,contract_id,contract_line_id,obligation_id,name,direction,amount,currency_code,trigger_type,trigger_ref_code,source_type,source_ref_code,owner_uid,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,'contract_line',?,?,?,?) ON DUPLICATE KEY UPDATE amount=VALUES(amount),trigger_type=VALUES(trigger_type),name=VALUES(name),row_version=row_version+1,updated_by=VALUES(updated_by)", "BS-"+childCode[3:], id, rid, obligation, r["name"], billingDirection, gross, currency, trigger, obCode, childCode, who.Actor, who.Actor, who.Actor); e != nil {
			return e
		}
	}
	for rid := range existing {
		if keep[rid] {
			continue
		}
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["altoc_contract_payment_term"]+" WHERE contract_line_id=? AND deleted_at IS NULL", rid).Scan(&n); e != nil {
			return e
		}
		if n > 0 {
			return contractError(409, "altoc_contract_line_referenced")
		}
		if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_line"]+" SET deleted_at=CURRENT_TIMESTAMP(3),status='inactive',row_version=row_version+1 WHERE id=?", rid); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_obligation"]+" SET deleted_at=CURRENT_TIMESTAMP(3),status='cancelled',row_version=row_version+1 WHERE contract_line_id=?", rid); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_billing_schedule"]+" SET deleted_at=CURRENT_TIMESTAMP(3),status='cancelled',row_version=row_version+1 WHERE contract_line_id=?", rid); e != nil {
			return e
		}
	}
	header, e := contractHeaderAmount(ctx, tx, t["altoc_contract"], id)
	if e != nil {
		return e
	}
	if !header {
		if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET amount_tax_inclusive=(SELECT COALESCE(SUM(amount_tax_inclusive),0) FROM "+t["altoc_contract_line"]+" WHERE contract_id=? AND deleted_at IS NULL),amount_tax_exclusive=(SELECT COALESCE(SUM(amount_tax_exclusive),0) FROM "+t["altoc_contract_line"]+" WHERE contract_id=? AND deleted_at IS NULL),primary_type=(SELECT CASE WHEN COUNT(DISTINCT line_type)>1 THEN 'mixed' ELSE COALESCE(MAX(line_type),'standard') END FROM "+t["altoc_contract_line"]+" WHERE contract_id=? AND deleted_at IS NULL),financial_status=IF(EXISTS(SELECT 1 FROM "+t["altoc_billing_schedule"]+" WHERE contract_id=? AND deleted_at IS NULL),'planned','unplanned') WHERE id=?", id, id, id, id, id); e != nil {
			return e
		}
	}
	return syncContractTermSchedules(ctx, tx, t, id, who)
}
func replaceContractObligations(ctx context.Context, tx *sql.Tx, t map[string]string, id, code string, who Identity, rows []map[string]any) error {
	if e := untouchedContractSchedules(ctx, tx, t, id); e != nil {
		return e
	}
	existing, e := existingChildRows(ctx, tx, t, "altoc_contract_obligation", id)
	if e != nil {
		return e
	}
	keep := map[string]bool{}
	for n, r := range rows {
		rid := text(r["id"])
		childCode := existing[rid]
		if rid != "" && childCode == "" {
			return contractError(403, "altoc_contract_child_mismatch")
		}
		line, e := childID(ctx, tx, t, "altoc_contract_line", id, text(r["contract_line_code"]))
		if e != nil {
			return e
		}
		if rid == "" {
			childCode = contractChildCode("OB", code, who.Key, n)
			res, e := tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_obligation"]+" (code,contract_id,contract_line_id,obligation_type,name,acceptance_required,source_type,created_by,updated_by) VALUES (?,?,?,?,?,?,'manual',?,?)", childCode, id, line, r["obligation_type"], r["name"], r["acceptance_required"], who.Actor, who.Actor)
			if e != nil {
				return e
			}
			num, e := res.LastInsertId()
			if e != nil {
				return e
			}
			rid = fmt.Sprint(num)
		} else {
			var mismatch int
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["altoc_billing_schedule"]+" WHERE obligation_id=? AND deleted_at IS NULL AND NOT (contract_line_id <=> ?)", rid, line).Scan(&mismatch); e != nil {
				return e
			}
			if mismatch > 0 {
				return contractError(409, "altoc_contract_obligation_referenced")
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_obligation"]+" SET contract_line_id=?,obligation_type=?,name=?,acceptance_required=?,row_version=row_version+1,updated_by=? WHERE id=?", line, r["obligation_type"], r["name"], r["acceptance_required"], who.Actor, rid); e != nil {
				return e
			}
		}
		keep[rid] = true
	}
	for rid := range existing {
		if !keep[rid] {
			var count int
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["altoc_billing_schedule"]+" WHERE obligation_id=? AND deleted_at IS NULL", rid).Scan(&count); e != nil {
				return e
			}
			if count > 0 {
				return contractError(409, "altoc_contract_obligation_referenced")
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_obligation"]+" SET deleted_at=CURRENT_TIMESTAMP(3),row_version=row_version+1 WHERE id=?", rid); e != nil {
				return e
			}
		}
	}
	return nil
}
func replaceContractTerms(ctx context.Context, tx *sql.Tx, t map[string]string, id, code string, who Identity, rows []map[string]any) error {
	if e := untouchedContractSchedules(ctx, tx, t, id); e != nil {
		return e
	}
	existing, e := existingChildRows(ctx, tx, t, "altoc_contract_payment_term", id)
	if e != nil {
		return e
	}
	keep := map[string]bool{}
	var currency string
	if e = tx.QueryRowContext(ctx, "SELECT currency_code FROM "+t["altoc_contract"]+" WHERE id=?", id).Scan(&currency); e != nil {
		return e
	}
	for n, r := range rows {
		rid := text(r["id"])
		childCode := existing[rid]
		if rid != "" && childCode == "" {
			return contractError(403, "altoc_contract_child_mismatch")
		}
		if rid == "" {
			childCode = contractChildCode("PT", code, who.Key, n)
		}
		line, e := childID(ctx, tx, t, "altoc_contract_line", id, text(r["contract_line_code"]))
		if e != nil {
			return e
		}
		ob, e := childID(ctx, tx, t, "altoc_contract_obligation", id, text(r["trigger_obligation_code"]))
		if e != nil {
			return e
		}
		if ob != nil && line != nil {
			var ol sql.NullInt64
			if e = tx.QueryRowContext(ctx, "SELECT contract_line_id FROM "+t["altoc_contract_obligation"]+" WHERE id=?", ob).Scan(&ol); e != nil {
				return e
			}
			if ol.Valid && fmt.Sprint(ol.Int64) != fmt.Sprint(line) {
				return contractError(403, "altoc_contract_child_mismatch")
			}
		}
		amount := r["amount"]
		if amount == nil {
			amount = "0.00"
		}
		fields := []string{"contract_line_id", "term_name", "term_type", "amount", "ratio", "currency_code", "trigger_type", "trigger_stage_type", "trigger_obligation_id", "expected_date", "recurrence_interval", "service_start_date", "service_end_date", "invoice_required", "sort_no", "updated_by"}
		vals := []any{line, r["term_name"], r["term_type"], amount, r["ratio"], currency, r["trigger_type"], r["trigger_stage_type"], ob, r["expected_date"], r["recurrence_interval"], r["service_start_date"], r["service_end_date"], r["invoice_required"], n, who.Actor}
		if rid == "" {
			fields = append(fields, "contract_id", "code", "created_by")
			vals = append(vals, id, childCode, who.Actor)
			res, e := tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_payment_term"]+" ("+strings.Join(fields, ",")+") VALUES("+strings.TrimSuffix(strings.Repeat("?,", len(vals)), ",")+")", vals...)
			if e != nil {
				return e
			}
			num, e := res.LastInsertId()
			if e != nil {
				return e
			}
			rid = fmt.Sprint(num)
		} else {
			sets := []string{}
			for _, f := range fields {
				sets = append(sets, f+"=?")
			}
			vals = append(vals, rid)
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_payment_term"]+" SET "+strings.Join(sets, ",")+",row_version=row_version+1 WHERE id=?", vals...); e != nil {
				return e
			}
		}
		keep[rid] = true
	}
	for rid := range existing {
		if !keep[rid] {
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_payment_term"]+" SET deleted_at=CURRENT_TIMESTAMP(3),row_version=row_version+1 WHERE id=?", rid); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_billing_schedule"]+" SET deleted_at=CURRENT_TIMESTAMP(3),status='cancelled',row_version=row_version+1 WHERE payment_term_id=?", rid); e != nil {
				return e
			}
		}
	}
	return syncContractTermSchedules(ctx, tx, t, id, who)
}
func termPeriods(term map[string]any) ([]string, error) {
	if term["trigger_type"] != "recurring" && !oneOf(term["term_type"], "recurring", "annual_service") {
		return []string{""}, nil
	}
	start, e := time.Parse("2006-01-02", text(term["service_start_date"]))
	if e != nil {
		return nil, contractError(400, "altoc_contract_recurrence_invalid")
	}
	end, e := time.Parse("2006-01-02", text(term["service_end_date"]))
	if e != nil || end.Before(start) {
		return nil, contractError(400, "altoc_contract_recurrence_invalid")
	}
	months := 1
	switch term["recurrence_interval"] {
	case "quarter":
		months = 3
	case "year":
		months = 12
	case "month":
	default:
		return nil, contractError(400, "altoc_contract_recurrence_invalid")
	}
	periods := []string{}
	for date := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC); !date.After(end); date = date.AddDate(0, months, 0) {
		periods = append(periods, date.Format("2006-01"))
		if len(periods) > 120 {
			return nil, contractError(400, "altoc_contract_recurrence_limit")
		}
	}
	return periods, nil
}
func syncContractTermSchedules(ctx context.Context, tx *sql.Tx, t map[string]string, id string, who Identity) error {
	var total, direction string
	if e := tx.QueryRowContext(ctx, "SELECT COALESCE(amount_tax_inclusive,0),direction FROM "+t["altoc_contract"]+" WHERE id=?", id).Scan(&total, &direction); e != nil {
		return e
	}
	dir := "receivable"
	if direction == "purchase" {
		dir = "payable"
	}
	c := contractCollections["payment_terms"]
	rows, e := tx.QueryContext(ctx, "SELECT "+c.selects()+" FROM "+t[c.table]+" WHERE contract_id=? AND deleted_at IS NULL ORDER BY id", id)
	if e != nil {
		return e
	}
	terms, e := readFinanceRows(rows, c.cols)
	if e != nil {
		return e
	}
	for _, term := range terms {
		amount := text(term["amount"])
		base := total
		if term["contract_line_id"] != nil {
			if e = tx.QueryRowContext(ctx, "SELECT amount_tax_inclusive FROM "+t["altoc_contract_line"]+" WHERE id=? AND contract_id=? AND deleted_at IS NULL", term["contract_line_id"], id).Scan(&base); e != nil {
				return e
			}
		}
		if term["ratio"] != nil {
			b, ok := new(big.Rat).SetString(base)
			ratio, ok2 := new(big.Rat).SetString(text(term["ratio"]))
			if !ok || !ok2 {
				return contractError(400, "altoc_contract_amount_invalid")
			}
			amount, e = roundedMoney(new(big.Rat).Quo(new(big.Rat).Mul(b, ratio), big.NewRat(100, 1)))
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+t[c.table]+" SET amount=? WHERE id=?", amount, term["id"]); e != nil {
				return e
			}
		}
		periods, e := termPeriods(term)
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_billing_schedule"]+" SET deleted_at=CURRENT_TIMESTAMP(3),status='cancelled' WHERE payment_term_id=? AND status IN ('planned','cancelled')", term["id"]); e != nil {
			return e
		}
		trigger := text(term["trigger_type"])
		ref := text(term["trigger_stage_type"])
		if term["trigger_obligation_id"] != nil {
			if e = tx.QueryRowContext(ctx, "SELECT code FROM "+t["altoc_contract_obligation"]+" WHERE id=? AND contract_id=? AND deleted_at IS NULL", term["trigger_obligation_id"], id).Scan(&ref); e != nil {
				return e
			}
		}
		if trigger == "stage_completed" {
			switch text(term["trigger_stage_type"]) {
			case "contract_signed":
				trigger = "contract_signed"
				ref = "contract_signed"
			case "delivery":
				if term["trigger_obligation_id"] != nil {
					trigger = "obligation_completed"
				}
			case "acceptance", "service_end":
				if term["trigger_obligation_id"] != nil {
					trigger = "obligation_accepted"
				}
			}
		}
		if oneOf(term["term_type"], "recurring", "annual_service") {
			trigger = "recurring"
		}
		for _, period := range periods {
			code := "BS-" + fmt.Sprintf("%x", contractHash(text(term["code"])+"|"+period))[:32]
			due := term["expected_date"]
			if period != "" {
				due = period + "-01"
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_billing_schedule"]+" (code,contract_id,contract_line_id,obligation_id,payment_term_id,name,direction,amount,currency_code,ratio,trigger_type,trigger_ref_code,recurrence_period,due_date,invoice_required,source_type,source_ref_code,owner_uid,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'payment_term',?,?,?,?) ON DUPLICATE KEY UPDATE amount=VALUES(amount),contract_line_id=VALUES(contract_line_id),obligation_id=VALUES(obligation_id),name=VALUES(name),trigger_type=VALUES(trigger_type),trigger_ref_code=VALUES(trigger_ref_code),due_date=VALUES(due_date),invoice_required=VALUES(invoice_required),status='planned',deleted_at=NULL,row_version=row_version+1,updated_by=VALUES(updated_by)", code, id, term["contract_line_id"], term["trigger_obligation_id"], term["id"], term["term_name"], dir, amount, term["currency_code"], term["ratio"], trigger, ref, nullableString(period), due, term["invoice_required"], term["code"], who.Actor, who.Actor, who.Actor); e != nil {
				return e
			}
		}
	}
	if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract"]+" SET financial_status=IF(EXISTS(SELECT 1 FROM "+t["altoc_billing_schedule"]+" WHERE contract_id=? AND deleted_at IS NULL),'planned','unplanned') WHERE id=?", id, id); e != nil {
		return e
	}
	return nil
}
func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
func transitionContractObligation(ctx context.Context, tx *sql.Tx, t map[string]string, id string, who Identity, p map[string]any) error {
	var oid int64
	var status string
	var acceptance bool
	e := tx.QueryRowContext(ctx, "SELECT id,status,acceptance_required FROM "+t["altoc_contract_obligation"]+" WHERE contract_id=? AND BINARY code=BINARY ? AND deleted_at IS NULL", id, p["obligationCode"]).Scan(&oid, &status, &acceptance)
	if e == sql.ErrNoRows {
		return contractError(404, "altoc_obligation_not_found")
	}
	if e != nil {
		return e
	}
	next := ""
	timestamp := ""
	switch p["action"] {
	case "start":
		if oneOf(status, "not_started", "rejected", "blocked") {
			next = "in_progress"
		}
	case "submit":
		if oneOf(status, "in_progress", "rejected") {
			next = "submitted"
			timestamp = "submitted_at"
			if !acceptance {
				next = "completed"
				timestamp = "actual_completed_at"
			}
		}
	case "accept":
		if oneOf(status, "submitted", "completed") {
			next = "accepted"
			timestamp = "accepted_at"
		}
	case "reject":
		if status == "submitted" {
			if text(p["reason"]) == "" {
				return contractError(400, "altoc_obligation_reason_required")
			}
			next = "rejected"
			timestamp = "rejected_at"
		}
	}
	if next == "" {
		return contractError(409, "altoc_obligation_state_conflict")
	}
	sets := "status=?,row_version=row_version+1,updated_by=?"
	if timestamp != "" {
		sets += "," + timestamp + "=CURRENT_TIMESTAMP(3)"
	}
	args := []any{next, who.Actor}
	if next == "rejected" {
		sets += ",reject_reason=?"
		args = append(args, p["reason"])
	}
	args = append(args, oid)
	if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_contract_obligation"]+" SET "+sets+" WHERE id=?", args...); e != nil {
		return e
	}
	if next == "completed" || next == "accepted" {
		triggers := []string{"obligation_completed"}
		if next == "accepted" {
			triggers = append(triggers, "obligation_accepted")
		}
		for _, trigger := range triggers {
			if _, e = tx.ExecContext(ctx, "UPDATE "+t["altoc_billing_schedule"]+" SET status='billable',billable_at=CURRENT_TIMESTAMP(3),billable_source='obligation',row_version=row_version+1 WHERE contract_id=? AND obligation_id=? AND trigger_type IN (?,?) AND deleted_at IS NULL AND status='planned'", id, oid, trigger, "obligation_completed"); e != nil {
				return e
			}
		}
	}
	return nil
}

// Read the current row rather than querying a W1-only column: old installations
// do not have amount_basis and retain their line-derived behavior.
func contractHeaderAmount(ctx context.Context, tx *sql.Tx, table, id string) (bool, error) {
	basis, _, err := contractW1State(ctx, tx, table, id)
	return basis == "header", err
}

// Both values are empty before W1 columns exist, which keeps every guard inert.
func contractW1State(ctx context.Context, tx *sql.Tx, table, id string) (basis, origin string, err error) {
	rows, err := tx.QueryContext(ctx, "SELECT * FROM "+table+" WHERE id=? FOR UPDATE", id)
	if err != nil {
		return "", "", err
	}
	columns, err := rows.Columns()
	if err != nil {
		rows.Close()
		return "", "", err
	}
	values, err := readFinanceRows(rows, columns)
	if err != nil {
		return "", "", err
	}
	if len(values) != 1 {
		return "", "", contractError(404, "altoc_contract_not_found")
	}
	if v := values[0]["amount_basis"]; v != nil {
		basis = text(v)
	}
	if v := values[0]["origin_type"]; v != nil {
		origin = text(v)
	}
	return basis, origin, nil
}

// W1 §5.4: an imported contract is already in performance. Only project binding
// and the three reviewed follow-up commands may change it.
func contractW1Guard(op, basis, origin string) error {
	switch op {
	case "contracts-annotate", "contracts-complete", "contracts-terminate":
		// Follow-up commands exist only for imported contracts; native contracts
		// close through their own obligation and schedule checks.
		if origin != "historical_import" {
			return contractError(409, "altoc_contract_operation_not_applicable")
		}
		return nil
	}
	if basis == "header" && op == "contract-lines-replace" {
		return contractError(409, "altoc_contract_header_lines_locked")
	}
	// Reassigning the owner changes who is responsible, not the contract itself.
	if origin == "historical_import" && op != "contract-projects-bind" && op != "contracts-set-owner" {
		return contractError(409, "altoc_contract_historical_operation_denied")
	}
	return nil
}
