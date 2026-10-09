package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestAPFW1ContractCompatibilityMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		t.Run(fmt.Sprint(installed), func(t *testing.T) {
			s, db := customerFixture(t)
			ctx := context.Background()
			if !installed {
				dropW1ContractColumns(t, db)
			}
			who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "w1-customer"}
			scope := altoc.BasicReadScope{Access: "self"}
			v, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "fixture", "owner_uid": "person"}}, who, scope)
			if e != nil {
				t.Fatal(e)
			}
			cid := fmt.Sprint(v.(map[string]any)["data"].(map[string]any)["id"])
			who.Key = "w1-contract"
			v, e = s.Contract(ctx, "contracts-create", ContractInput{CustomerID: cid, Payload: map[string]any{"name": "fixture", "currency_code": "CNY"}}, who, scope)
			if e != nil {
				t.Fatal(e)
			}
			c := v.(map[string]any)["data"].(map[string]any)
			id := fmt.Sprint(c["id"])
			if installed {
				if _, e = db.Exec("UPDATE altoc_contract SET amount_basis='header',origin_type='historical_import',imported_batch_code='W1',tax_rate=NULL,amount_tax_inclusive=888,amount_tax_exclusive=777 WHERE id=?", id); e != nil {
					t.Fatal(e)
				}
			}
			if _, e = s.ContractRead(ctx, id, "person", scope, altoc.BasicReadQuery{Page: 1, PageSize: 20}); e != nil {
				t.Fatal("NULL-safe read", e)
			}
			lines := []map[string]any{{"line_type": "service", "name": "fixture", "quantity": "1.0000", "unit_price": "100.00", "tax_rate": "6.00", "acceptance_required": false, "project_policy": "none"}}
			denied := func(op, key, code string, rows []map[string]any) {
				t.Helper()
				u := who
				u.Key = key
				_, e := s.Contract(ctx, op, ContractInput{ID: id, Payload: map[string]any{"expectedVersion": c["row_version"]}, Rows: rows}, u, scope)
				var he httperror.Error
				if !errors.As(e, &he) || he.Status != 409 || he.Code != code {
					t.Fatal(op, "expected", code, "got", e)
				}
			}
			who.Key = "w1-lines"
			if installed {
				// Imported contracts: every mutating command except project binding is refused.
				denied("contract-lines-replace", "w1-lines", "altoc_contract_header_lines_locked", lines)
				denied("payment-terms-replace", "w1-terms", "altoc_contract_historical_operation_denied", []map[string]any{{"term_name": "fixture", "term_type": "advance", "ratio": "100.0000", "trigger_type": "contract_signed", "invoice_required": true}})
				denied("obligations-replace", "w1-obligations", "altoc_contract_historical_operation_denied", []map[string]any{})
				denied("contracts-sign", "w1-sign", "altoc_contract_historical_operation_denied", nil)
				// A native contract whose amount is on the header keeps its lines locked too.
				if _, e = db.Exec("UPDATE altoc_contract SET origin_type='native',imported_batch_code=NULL WHERE id=?", id); e != nil {
					t.Fatal(e)
				}
				denied("contract-lines-replace", "w1-lines-native", "altoc_contract_header_lines_locked", lines)
				var n int
				if e = db.QueryRow("SELECT COUNT(*) FROM altoc_contract_line WHERE contract_id=?", id).Scan(&n); e != nil || n != 0 {
					t.Fatal("line written to header contract", n, e)
				}
			} else if _, e = s.Contract(ctx, "contract-lines-replace", ContractInput{ID: id, Payload: map[string]any{"expectedVersion": c["row_version"]}, Rows: lines}, who, scope); e != nil {
				t.Fatal("compatible write", e)
			}
			var total string
			if e = db.QueryRow("SELECT amount_tax_inclusive FROM altoc_contract WHERE id=?", id).Scan(&total); e != nil {
				t.Fatal(e)
			}
			expected := "100.00"
			if installed {
				expected = "888.00"
			}
			if total != expected {
				t.Fatal("header amount overwritten or legacy sum broken", total, expected)
			}
		})
	}
}

func dropW1ContractColumns(t *testing.T, db *sql.DB) {
	t.Helper()
	d := domaininstall.W1Columns("w1-altoc-contract-columns")
	if _, e := db.Exec("ALTER TABLE altoc_contract DROP CHECK ck_altoc_contract_origin"); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec("ALTER TABLE altoc_contract DROP INDEX idx_altoc_contract_origin"); e != nil {
		t.Fatal(e)
	}
	for _, c := range d.Add {
		if _, e := db.Exec("ALTER TABLE altoc_contract DROP COLUMN " + c.Name); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := db.Exec("ALTER TABLE altoc_contract MODIFY tax_rate decimal(5,2) NOT NULL DEFAULT 6.00"); e != nil {
		t.Fatal(e)
	}
}

// Finance must not bill or receive against an imported contract before the P1
// opening-receivable batch; without the W1 columns the previous behavior stays.
func TestAPFW1FinanceHistoricalContractMySQL(t *testing.T) {
	for _, state := range []string{"not-installed", "native", "historical"} {
		t.Run(state, func(t *testing.T) {
			s, db := financeLedgerFixture(t)
			switch state {
			case "not-installed":
				dropW1ContractColumns(t, db)
			case "historical":
				if _, e := db.Exec("UPDATE altoc_contract SET amount_basis='header',origin_type='historical_import',imported_batch_code='W1' WHERE code='CT1'"); e != nil {
					t.Fatal(e)
				}
			}
			who := Identity{Actor: "maker", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime"}
			scope := altoc.BasicReadScope{Access: "all"}
			for n, op := range []string{"invoice-requests-create", "receipts-create"} {
				who.Key = fmt.Sprint("w1-finance-", n)
				p := map[string]any{"customerCode": "C1", "contractCode": "CT1", "currencyCode": "CNY"}
				if op == "invoice-requests-create" {
					p["requestedAmount"], p["invoiceItem"] = "10.00", "Marked work"
				} else {
					p["receivedAmount"], p["receivedAt"], p["responsibleUid"], p["dueAt"] = "10.00", "2026-10-03", "clerk", "2026-10-10 00:00:00"
				}
				_, e := s.FinanceLedger(context.Background(), op, FinanceInput{Payload: p}, who, scope)
				var he httperror.Error
				refused := errors.As(e, &he) && he.Status == 409 && he.Code == "finance_historical_contract_not_ready"
				if state == "historical" && !refused {
					t.Fatal(op, "imported contract accepted", e)
				}
				if state != "historical" && e != nil {
					t.Fatal(op, e)
				}
			}
			var status string
			var version int
			if e := db.QueryRow("SELECT financial_status,row_version FROM altoc_contract WHERE code='CT1'").Scan(&status, &version); e != nil {
				t.Fatal(e)
			}
			if state == "historical" && (status != "unplanned" || version != 1) {
				t.Fatal("imported contract changed by Finance", status, version)
			}
		})
	}
}

// W3 follow-up commands: only an imported contract can be annotated, completed
// or terminated this way, with the state tuples of W1 §5.4 and no side effects.
func TestAPFW1ContractFollowUpCommandsMySQL(t *testing.T) {
	for _, state := range []string{"not-installed", "native", "historical"} {
		t.Run(state, func(t *testing.T) {
			s, db := customerFixture(t)
			ctx := context.Background()
			if state == "not-installed" {
				dropW1ContractColumns(t, db)
			}
			for _, q := range []string{
				"INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'C1','fixture','person'),(2,'C2','other','person')",
				"INSERT INTO altoc_contact(id,code,customer_id,name,owner_uid) VALUES(11,'CN11',1,'own contact','person'),(12,'CN12',2,'foreign contact','person')",
				"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,status,legal_status,fulfillment_status) VALUES(1,'CT1','first',1,'person','effective','effective','in_progress'),(2,'CT2','second',1,'person','effective','effective','in_progress')",
			} {
				if _, e := db.Exec(q); e != nil {
					t.Fatal(e)
				}
			}
			if state == "historical" {
				if _, e := db.Exec("UPDATE altoc_contract SET amount_basis='header',origin_type='historical_import',imported_batch_code='W1',tax_rate=NULL,amount_tax_inclusive=888"); e != nil {
					t.Fatal(e)
				}
			}
			scope := altoc.BasicReadScope{Access: "self"}
			call := func(op, id, key string, payload map[string]any) (map[string]any, error) {
				who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: key, RequestID: key}
				v, e := s.Contract(ctx, op, ContractInput{ID: id, Payload: payload}, who, scope)
				if e != nil {
					return nil, e
				}
				return v.(map[string]any)["data"].(map[string]any), nil
			}
			refused := func(e error, code string) {
				t.Helper()
				var he httperror.Error
				if !errors.As(e, &he) || he.Status != 409 || he.Code != code {
					t.Fatal("expected", code, "got", e)
				}
			}
			version := func(id string) float64 {
				t.Helper()
				var v int
				if e := db.QueryRow("SELECT row_version FROM altoc_contract WHERE id=?", id).Scan(&v); e != nil {
					t.Fatal(e)
				}
				return float64(v)
			}
			payloads := map[string]map[string]any{
				"contracts-annotate":  {"remark": "follow-up note", "contact_id": "11"},
				"contracts-complete":  {},
				"contracts-terminate": {"reason": "customer cancelled"},
			}
			with := func(op, id string) map[string]any {
				out := map[string]any{"expectedVersion": version(id)}
				for k, v := range payloads[op] {
					out[k] = v
				}
				return out
			}
			if state != "historical" {
				// No imported contract exists: the commands never apply and change nothing.
				for op := range payloads {
					_, e := call(op, "1", "na-"+op, with(op, "1"))
					refused(e, "altoc_contract_operation_not_applicable")
				}
				var status string
				if e := db.QueryRow("SELECT status FROM altoc_contract WHERE id=1").Scan(&status); e != nil || status != "effective" || version("1") != 1 {
					t.Fatal("contract changed", status, e)
				}
				return
			}

			// Annotate: only the three descriptive columns; the contact must belong to the customer.
			_, e := call("contracts-annotate", "1", "annotate-foreign", map[string]any{"expectedVersion": version("1"), "contact_id": "12"})
			refused(e, "altoc_contract_contact_invalid")
			out, e := call("contracts-annotate", "1", "annotate", with("contracts-annotate", "1"))
			if e != nil || out["remark"] != "follow-up note" || out["status"] != "effective" {
				t.Fatal("annotate", out, e)
			}
			var contact sql.NullInt64
			var amount string
			if e = db.QueryRow("SELECT contact_id,amount_tax_inclusive FROM altoc_contract WHERE id=1").Scan(&contact, &amount); e != nil || contact.Int64 != 11 || amount != "888.00" {
				t.Fatal("annotate columns", contact, amount, e)
			}
			if _, e = call("contracts-annotate", "1", "annotate-clear", map[string]any{"expectedVersion": version("1"), "contact_id": nil}); e != nil {
				t.Fatal(e)
			}
			if e = db.QueryRow("SELECT contact_id FROM altoc_contract WHERE id=1").Scan(&contact); e != nil || contact.Valid {
				t.Fatal("contact not cleared", contact, e)
			}

			// Stale version is refused before any change.
			_, e = call("contracts-complete", "1", "complete-stale", map[string]any{"expectedVersion": float64(1)})
			refused(e, "altoc_contract_version_conflict")

			// Complete: state tuple of W1 §5.4, one audit row with the reason.
			completeInput := with("contracts-complete", "1")
			out, e = call("contracts-complete", "1", "complete", completeInput)
			if e != nil {
				t.Fatal(e)
			}
			var status, legal, fulfillment, financial, activation, changedBy string
			var completed, terminated bool
			row := func(id string) {
				t.Helper()
				if e := db.QueryRow("SELECT status,legal_status,fulfillment_status,financial_status,activation_status,COALESCE(last_status_changed_by,''),completed_at IS NOT NULL,terminated_at IS NOT NULL FROM altoc_contract WHERE id=?", id).Scan(&status, &legal, &fulfillment, &financial, &activation, &changedBy, &completed, &terminated); e != nil {
					t.Fatal(e)
				}
			}
			row("1")
			if status != "completed" || legal != "closed" || fulfillment != "fulfilled" || financial != "unplanned" || activation != "not_planned" || changedBy != "person" || !completed || terminated {
				t.Fatal("complete tuple", status, legal, fulfillment, financial, activation, changedBy, completed, terminated)
			}
			after := version("1")
			// Replaying the same command returns the first result and writes nothing more.
			again, e := call("contracts-complete", "1", "complete", completeInput)
			if e != nil || fmt.Sprint(again["row_version"]) != fmt.Sprint(out["row_version"]) || version("1") != after {
				t.Fatal("replay", again, e)
			}
			var audits int
			if e = db.QueryRow("SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='contract' AND entity_id=1 AND action='complete'").Scan(&audits); e != nil || audits != 1 {
				t.Fatal("complete audit rows", audits, e)
			}
			// A closed contract cannot be closed again, and stays read-only otherwise.
			_, e = call("contracts-terminate", "1", "terminate-after-complete", with("contracts-terminate", "1"))
			refused(e, "altoc_contract_not_effective")
			_, e = call("contracts-sign", "1", "sign-after-complete", map[string]any{"expectedVersion": version("1")})
			refused(e, "altoc_contract_historical_operation_denied")
			// Annotating a closed contract is still allowed.
			if _, e = call("contracts-annotate", "1", "annotate-closed", map[string]any{"expectedVersion": version("1"), "content_summary": "archived"}); e != nil {
				t.Fatal(e)
			}

			// Terminate the second contract.
			if _, e = call("contracts-terminate", "2", "terminate", with("contracts-terminate", "2")); e != nil {
				t.Fatal(e)
			}
			row("2")
			if status != "terminated" || legal != "terminated" || fulfillment != "cancelled" || financial != "unplanned" || activation != "not_planned" || completed || !terminated {
				t.Fatal("terminate tuple", status, legal, fulfillment, financial, activation, completed, terminated)
			}
			var reason string
			if e = db.QueryRow("SELECT JSON_UNQUOTE(JSON_EXTRACT(new_value,'$.reason')) FROM altoc_audit_log WHERE entity_type='contract' AND entity_id=2 AND action='terminate'").Scan(&reason); e != nil || reason != "customer cancelled" {
				t.Fatal("terminate audit", reason, e)
			}

			// No side effects beyond the contract row and its audit trail. This fixture
			// has no outbox table at all, so an outbound operation would have failed.
			for _, table := range []string{"altoc_billing_schedule", "altoc_contract_line", "altoc_contract_obligation", "altoc_contract_project_link"} {
				var n int
				if e = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); e != nil || n != 0 {
					t.Fatal("side effect in", table, n, e)
				}
			}
			// Scope still applies: another user's self scope cannot reach the contract.
			who := Identity{Actor: "stranger", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "stranger"}
			if _, e = s.Contract(ctx, "contracts-annotate", ContractInput{ID: "2", Payload: map[string]any{"expectedVersion": version("2"), "remark": "x"}}, who, scope); e == nil {
				t.Fatal("out-of-scope annotate accepted")
			}
		})
	}
}
