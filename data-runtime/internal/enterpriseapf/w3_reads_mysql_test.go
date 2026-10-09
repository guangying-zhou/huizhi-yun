package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

func w3InstallReadTables(t *testing.T, s *Service, db *sql.DB, subsets ...string) *Service {
	t.Helper()
	b := s.binding
	for _, subset := range subsets {
		for _, table := range domaininstall.W1Tables(subset) {
			if _, e := db.Exec(table.DDL); e != nil {
				t.Fatal(table.Logical, e)
			}
		}
		var e error
		b, e = domaininstall.WithW1(b, subset, "host-test")
		if e != nil {
			t.Fatal(e)
		}
	}
	r := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e := r.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	out, e := New(r, b)
	if e != nil {
		t.Fatal(e)
	}
	return out
}
func w3Exec(t *testing.T, db *sql.DB, queries ...string) {
	t.Helper()
	for _, q := range queries {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(q, e)
		}
	}
}
func w3Raw(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestAPFW3CustomerReadsMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		t.Run(fmt.Sprint(installed), func(t *testing.T) {
			s, db := customerFixture(t)
			ctx := context.Background()
			w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id) VALUES(1,'ROOT','Root','person',NULL),(2,'CHILD','Visible child','person',1),(3,'HIDDEN','SECRET-NAME','second',1),(4,'ORPHAN','Scoped child','person',3),(5,'UNASSIGNED','Unassigned','system:unassigned',NULL)")
			if installed {
				s = w3InstallReadTables(t, s, db, "w1-altoc-customer-snapshot", "w1-migration-ledger")
				w3Exec(t, db,
					"INSERT INTO altoc_customer_migration_snapshot(customer_id,snapshot_at,batch_code,source_note,contract_count_direct,contract_amount_direct) VALUES(1,'2024-01-31','W1','cache',2,120.00)",
					"INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'W1','wizbiz','snap','{}',REPEAT('0',64),'applied','tool')",
					"INSERT INTO mig_object_map(batch_id,source_system,source_table,source_pk,target_domain,target_table,target_key,map_role,disposition) VALUES(1,'wizbiz','wb_organization','1','altoc','altoc_customer','ROOT','primary','created'),(1,'wizbiz','wb_organization','5','altoc','altoc_customer','UNASSIGNED','primary','created')",
					"INSERT INTO mig_identity_map(source_system,source_user_id,display_name,match_status) VALUES('wizbiz','employee:7','Source salesperson','unmatched'),('wizbiz','user:7','DO-NOT-MATCH','unmatched')",
					`INSERT INTO mig_exception(batch_id,owning_domain,kind,source_table,source_pk,target_table,target_key,detail_json) VALUES(1,'altoc','owner_unmatched','wb_organization','5','altoc_customer','UNASSIGNED','{"sourceUserId":"7","private":"DO-NOT-LEAK"}')`)
			}
			scope := altoc.BasicReadScope{Access: "self"}
			read := func(id string, q altoc.BasicReadQuery, sc altoc.BasicReadScope) map[string]any {
				t.Helper()
				v, e := s.CustomerRead(ctx, id, "person", sc, q)
				if e != nil {
					t.Fatal(e)
				}
				return v.(map[string]any)
			}
			root := read("1", altoc.BasicReadQuery{Page: 1, PageSize: 20}, scope)
			if root["childCount"] != int64(1) || root["hasHiddenChildren"] != true || strings.Contains(w3Raw(root), "SECRET-NAME") {
				t.Fatal(root)
			}
			for key := range root {
				if strings.Contains(strings.ToLower(key), "hidden") && strings.Contains(strings.ToLower(key), "count") {
					t.Fatal("hidden quantity leaked", key)
				}
			}
			w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id) VALUES(6,'HIDDEN2','SECRET-NAME-2','second',1)")
			if w3Raw(read("1", altoc.BasicReadQuery{Page: 1, PageSize: 20}, scope)) != w3Raw(root) {
				t.Fatal("hidden population changed response")
			}
			if _, present := root["migration_snapshot"]; present != installed {
				t.Fatal("snapshot compatibility", root)
			}
			if installed {
				if root["source_info"] == nil || root["source_owner_name"] != nil {
					t.Fatal(root)
				}
				u := read("5", altoc.BasicReadQuery{Page: 1, PageSize: 20}, altoc.BasicReadScope{Access: "all"})
				if u["source_owner_name"] != "Source salesperson" || strings.Contains(w3Raw(u), "DO-NOT") {
					t.Fatal(u)
				}
			}
			child := read("2", altoc.BasicReadQuery{Page: 1, PageSize: 20}, scope)
			if child["hasHiddenChildren"] != false || !strings.Contains(w3Raw(child), `"name":"Root"`) {
				t.Fatal(child)
			}
			orphan := read("4", altoc.BasicReadQuery{Page: 1, PageSize: 20}, scope)
			if orphan["parentHidden"] != true || orphan["parent_customer_id"] != nil || strings.Contains(w3Raw(orphan), "SECRET-NAME") {
				t.Fatal(orphan)
			}
			if _, e := s.CustomerRead(ctx, "3", "person", scope, altoc.BasicReadQuery{Page: 1, PageSize: 20}); e == nil {
				t.Fatal("hidden detail accepted")
			}
			for _, tc := range []struct {
				q     altoc.BasicReadQuery
				total int
			}{{altoc.BasicReadQuery{ParentID: "1"}, 1}, {altoc.BasicReadQuery{RootsOnly: true}, 1}, {altoc.BasicReadQuery{OwnerUnassigned: true}, 0}} {
				q := tc.q
				q.Page = 1
				q.PageSize = 1
				v := read("", q, scope)
				if fmt.Sprint(v["total"]) != fmt.Sprint(tc.total) {
					t.Fatal(q, v)
				}
			}
			q := altoc.BasicReadQuery{Page: 1, PageSize: 1, OwnerUnassigned: true}
			if fmt.Sprint(read("", q, altoc.BasicReadScope{Access: "all"})["total"]) != "1" {
				t.Fatal("unassigned filter")
			}
		})
	}
}

func TestAPFW3ContractReadsMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		t.Run(fmt.Sprint(installed), func(t *testing.T) {
			s, db := customerFixture(t)
			ctx := context.Background()
			if !installed {
				dropW1ContractColumns(t, db)
			}
			w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'CU','Customer','person')",
				"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,direction,currency_code,amount_tax_inclusive,status) VALUES(1,'CT1','Contract',1,'person','sales','CNY',100,'effective'),(2,'CT2','Second',1,'person','sales','CNY',200,'effective'),(3,'CT3','Dollar',1,'person','sales','USD',10,'effective'),(4,'CT4','Hidden',1,'second','sales','CNY',999,'effective'),(5,'CT5','Terminated',1,'person','sales','CNY',1000,'terminated'),(6,'CT6','Purchase',1,'person','purchase','CNY',900,'effective')")
			if installed {
				s = w3InstallReadTables(t, s, db, "w1-altoc-contract-snapshot", "w1-migration-ledger")
				w3Exec(t, db, "UPDATE altoc_contract SET origin_type='historical_import',amount_basis='header',imported_batch_code='W1',signed_amount=80,effective_amount=90,contract_category='software_development' WHERE id=1", "UPDATE altoc_contract SET effective_amount=9 WHERE id=3",
					"INSERT INTO altoc_contract_migration_snapshot(contract_id,snapshot_at,batch_code,remaining_uninvoiced_amount,remaining_settlement_amount,settlement_direction) VALUES(1,'2024-01-31','W1',NULL,40,'receivable')")
			}
			scope := altoc.BasicReadScope{Access: "self"}
			q := altoc.BasicReadQuery{Page: 1, PageSize: 1, CustomerID: "1"}
			v, e := s.ContractRead(ctx, "", "person", scope, q)
			if e != nil {
				t.Fatal(e)
			}
			out := v.(map[string]any)
			if fmt.Sprint(out["total"]) != "5" {
				t.Fatal(out)
			}
			roll := out["rollup"].(map[string]any)
			if roll["count"] != int64(3) || roll["terminatedCount"] != int64(1) || roll["excluded"] != true {
				t.Fatal(roll)
			}
			amounts := roll["amounts"].([]map[string]any)
			if len(amounts) != 2 || amounts[0]["amount"] != "300.00" || amounts[1]["amount"] != "10.00" {
				t.Fatal(amounts)
			}
			if _, ok := roll["effectiveAmounts"]; ok != installed {
				t.Fatal(roll)
			}
			if installed {
				values := roll["effectiveAmounts"].([]map[string]any)
				if values[0]["amount"] != "90.00" || values[0]["missingCount"] != int64(1) {
					t.Fatal(values)
				}
			}
			detail, e := s.ContractRead(ctx, "1", "person", scope, altoc.BasicReadQuery{Page: 1, PageSize: 20})
			if e != nil {
				t.Fatal(e)
			}
			row := detail.(map[string]any)
			if _, ok := row["signed_amount"]; ok != installed {
				t.Fatal(row)
			}
			if installed {
				if row["origin_type"] != "historical_import" || row["migration_snapshot"].(map[string]any)["remaining_uninvoiced_amount"] != nil {
					t.Fatal(row)
				}
			}
			q.Origin = "historical_import"
			q.Category = "software_development"
			v, e = s.ContractRead(ctx, "", "person", scope, q)
			if e != nil {
				t.Fatal(e)
			}
			expected := "0"
			if installed {
				expected = "1"
			}
			if fmt.Sprint(v.(map[string]any)["total"]) != expected {
				t.Fatal(v)
			}
			q.Origin = ""
			q.Category = ""
			q.OwnerUnassigned = true
			v, e = s.ContractRead(ctx, "", "person", scope, q)
			if e != nil || fmt.Sprint(v.(map[string]any)["total"]) != "0" {
				t.Fatal(v, e)
			}
		})
	}
}

func TestAPFW3FinanceReadsMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		t.Run(fmt.Sprint(installed), func(t *testing.T) {
			s, db := financeFixture(t)
			ctx := context.Background()
			if !installed {
				w3Exec(t, db, "ALTER TABLE finance_bank_account DROP INDEX uk_finance_bank_account_short_name,DROP INDEX idx_finance_bank_account_entity,DROP COLUMN short_name,DROP COLUMN bank_branch_code,DROP COLUMN legal_entity_code,DROP COLUMN sort_no,DROP COLUMN account_subtype")
			}
			if installed {
				s = w3InstallReadTables(t, s, db, "w1-finance-legal-entity")
				w3Exec(t, db, "INSERT INTO finance_legal_entity(code,name,short_name,entity_type) VALUES('LE1','Entity Name','Entity','company')")
			}
			w3Exec(t, db, "INSERT INTO finance_bank_account(id,code,account_name,currency_code) VALUES(1,'BA1','Account','CNY'),(2,'BA2','No snapshots','USD')",
				"INSERT INTO finance_account_balance_snapshot(bank_account_id,snapshot_date,balance_amount,currency_code,source_type) VALUES(1,'2024-01-31',20,'CNY','manual'),(1,'2024-01-31',999,'CNY','import'),(1,'2024-01-30',10,'CNY','import')")
			if installed {
				w3Exec(t, db, "UPDATE finance_bank_account SET legal_entity_code='LE1',short_name='Short' WHERE id=1")
			}
			who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime"}
			read := func(op string, i FinanceInput) map[string]any {
				t.Helper()
				v, e := s.Finance(ctx, op, i, who)
				if e != nil {
					t.Fatal(op, e)
				}
				return v.(map[string]any)
			}
			detail := read("accounts-view", FinanceInput{Code: "BA1"})["data"].(map[string]any)
			if (detail["legal_entity_name"] != nil) != installed {
				t.Fatal(detail)
			}
			if installed && detail["legal_entity_name"] != "Entity Name" {
				t.Fatal(detail)
			}
			list := read("accounts-list", FinanceInput{Page: 1, PageSize: 1})
			row := list["data"].([]map[string]any)[0]
			if row["latest_balance_amount"] != "20.00" || row["latest_balance_date"] != "2024-01-31" {
				t.Fatal(row)
			}
			totals := list["balanceTotals"].([]map[string]any)
			if len(totals) != 1 || totals[0]["amount"] != "20.00" {
				t.Fatal(totals)
			}
			page := read("balances-list", FinanceInput{Page: 1, PageSize: 1, AccountCode: "BA1"})
			if page["total"] != int64(2) || page["data"].([]map[string]any)[0]["source_type"] != "manual" {
				t.Fatal(page)
			}
			none := read("accounts-view", FinanceInput{Code: "BA2"})["data"].(map[string]any)
			if none["latest_balance_amount"] != nil {
				t.Fatal(none)
			}
			// The manual/import preference must not change unrelated API ordering.
			w3Exec(t, db, "INSERT INTO finance_account_balance_snapshot(bank_account_id,snapshot_date,balance_amount,currency_code,source_type) VALUES(1,'2024-01-31',88,'CNY','api')")
			api := read("accounts-view", FinanceInput{Code: "BA1"})["data"].(map[string]any)
			if api["latest_balance_amount"] != "88.00" {
				t.Fatal("API ordering changed", api)
			}
		})
	}
}

func TestAPFW3ContractFinanceReferenceNamesMySQL(t *testing.T) {
	s, db := migrationQueueFixture(t)
	s = w3InstallReadTables(t, s, db, "w1-finance-legal-entity")
	w3Exec(t, db, "INSERT INTO finance_legal_entity(code,name,entity_type) VALUES('LE1','Current Entity','company')", "INSERT INTO finance_bank_account(code,account_name,account_no_masked,account_no_secret_ref,short_name) VALUES('BA1','Account','SECRET-MASK','SECRET-REF','Short')",
		"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,receiving_bank_account_code) VALUES(1,'CT1','Contract',1,'person','BA1')",
		"INSERT INTO altoc_contract_party(contract_id,role_code,party_type,party_ref_code,party_name_snapshot,is_primary) VALUES(1,'seller','legal_entity','LE1','Old Entity',1)")
	v, e := s.ContractRead(context.Background(), "1", "person", altoc.BasicReadScope{Access: "self"}, altoc.BasicReadQuery{Page: 1, PageSize: 20})
	if e != nil {
		t.Fatal(e)
	}
	row := v.(map[string]any)
	if row["legal_entity_name"] != "Current Entity" || row["legal_entity_name_snapshot"] != "Old Entity" || row["receiving_bank_account_short_name"] != "Short" || strings.Contains(w3Raw(row), "SECRET") {
		t.Fatal(row)
	}
	if _, e = s.ContractRead(context.Background(), "1", "second", altoc.BasicReadScope{Access: "self"}, altoc.BasicReadQuery{Page: 1, PageSize: 20}); e == nil {
		t.Fatal("reference names bypass contract scope")
	}
}
