package enterpriseapf

import (
	"context"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"strings"
	"testing"
)

func TestAPFW3Batch6CustomerAndContractReadsMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		t.Run(fmt.Sprint(installed), func(t *testing.T) {
			s, db := customerFixture(t)
			ctx := context.Background()
			if !installed {
				dropW1ContractColumns(t, db)
			} else {
				s = w3InstallReadTables(t, s, db, "w1-migration-ledger")
			}
			w3Exec(t, db, "INSERT INTO altoc_customer_level(id,code,name) VALUES(1,'A','Priority')",
				"INSERT INTO altoc_customer(id,code,name,owner_uid,customer_level_id,parent_customer_id) VALUES(1,'ROOT','Root','person',1,NULL),(2,'CHILD','Child','person',NULL,1),(3,'HIDDEN','DO-NOT-LEAK','second',NULL,1)",
				"INSERT INTO altoc_contact(id,code,customer_id,name) VALUES(1,'CONTACT',1,'Contact')",
				"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,direction,currency_code,amount_tax_inclusive,status) VALUES(1,'CT1','First',2,'person','sales','CNY',100,'effective'),(2,'CT2','Second',2,'person','sales','USD',10,'effective'),(3,'SECRET','DO-NOT-LEAK',2,'second','sales','CNY',999,'effective'),(4,'CT4','Purchase',2,'person','purchase','CNY',500,'effective'),(5,'CT5','Terminated',2,'person','sales','CNY',700,'terminated')")
			if installed {
				w3Exec(t, db, "UPDATE altoc_contract SET parent_contract_id=1 WHERE id IN(2,3)",
					"INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'B6','wizbiz','snap','{}',REPEAT('0',64),'applied','tool')",
					"INSERT INTO mig_object_map(batch_id,source_system,source_table,source_pk,target_domain,target_table,target_key,map_role,disposition) VALUES(1,'wizbiz','wb_linkman','9','altoc','altoc_contact','CONTACT','primary','created')")
			}
			scope := altoc.BasicReadScope{Access: "self"}
			q := altoc.BasicReadQuery{Page: 1, PageSize: 1}
			root, e := s.CustomerRead(ctx, "1", "person", scope, q)
			if e != nil {
				t.Fatal(e)
			}
			item := root.(map[string]any)
			if item["customer_level_name"] != "Priority" {
				t.Fatal(item)
			}
			contact := item["contacts"].([]map[string]any)[0]
			_, hasSource := contact["source_info"]
			if hasSource != installed {
				t.Fatal(contact)
			}
			child, e := s.CustomerRead(ctx, "2", "person", scope, q)
			if e != nil || child.(map[string]any)["customer_level_id"] != nil {
				t.Fatal(child, e)
			}
			if _, e = s.CustomerRead(ctx, "3", "person", scope, q); e == nil {
				t.Fatal("customer detail scope bypass")
			}
			q.CustomerIDs = "2,3,999"
			v, e := s.ContractRead(ctx, "", "person", scope, q)
			if e != nil {
				t.Fatal(e)
			}
			summaries := v.(map[string]any)["customerSummaries"].(map[string]any)
			sum := summaries["2"].(map[string]any)
			if sum["count"] != int64(2) || len(sum["amounts"].([]map[string]any)) != 2 {
				t.Fatal(sum)
			}
			if summaries["3"].(map[string]any)["count"] != int64(0) || summaries["999"].(map[string]any)["count"] != int64(0) {
				t.Fatal("customer existence leak", summaries)
			}
			raw := w3Raw(summaries)
			if strings.Contains(raw, "999.00") || strings.Contains(raw, "DO-NOT-LEAK") || strings.Contains(raw, "hidden") {
				t.Fatal(raw)
			}
			if _, e = s.ContractRead(ctx, "3", "person", scope, altoc.BasicReadQuery{Page: 1, PageSize: 20}); e == nil {
				t.Fatal("contract detail scope bypass")
			}
			denied, err := s.ContractRead(ctx, "", "person", altoc.BasicReadScope{Access: "none"}, q)
			if err != nil || denied.(map[string]any)["total"] != 0 || denied.(map[string]any)["customerSummaries"].(map[string]any)["2"].(map[string]any)["count"] != int64(0) {
				t.Fatal("batch scope bypass", denied, err)
			}
			q.CustomerIDs = ""
			q.ParentContractID = "1"
			v, e = s.ContractRead(ctx, "", "person", scope, q)
			if e != nil {
				t.Fatal(e)
			}
			want := 0
			if installed {
				want = 1
			}
			if v.(map[string]any)["total"] != want {
				t.Fatal(v)
			}
			q.Page = 2
			v, e = s.ContractRead(ctx, "", "person", scope, q)
			if e != nil || len(v.(map[string]any)["items"].([]map[string]any)) != 0 {
				t.Fatal(v, e)
			}
		})
	}
}

func TestAPFW3Batch6FinanceReadsMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		t.Run(fmt.Sprint(installed), func(t *testing.T) {
			s, db := financeFixture(t)
			ctx := context.Background()
			who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime"}
			if installed {
				s = w3InstallReadTables(t, s, db, "w1-finance-legal-entity", "w1-migration-ledger")
			} else {
				w3Exec(t, db, "ALTER TABLE finance_bank_account DROP INDEX uk_finance_bank_account_short_name, DROP INDEX idx_finance_bank_account_entity, DROP COLUMN short_name, DROP COLUMN bank_branch_code, DROP COLUMN legal_entity_code, DROP COLUMN sort_no, DROP COLUMN account_subtype")
			}
			w3Exec(t, db, "INSERT INTO finance_bank_account(id,code,account_name,account_type,currency_code,status) VALUES(1,'BA1','Main','bank','CNY','active'),(2,'BA2','Cash','cash','CNY','active')",
				"INSERT INTO finance_account_balance_snapshot(bank_account_id,snapshot_date,balance_amount,currency_code,source_type) VALUES(1,'2024-01-31',100,'CNY','import'),(1,'2024-01-31',200,'CNY','manual'),(2,'2024-01-31',10,'CNY','manual')")
			if installed {
				w3Exec(t, db, "INSERT INTO finance_legal_entity(code,name) VALUES('LE1','Entity')", "UPDATE finance_bank_account SET legal_entity_code='LE1' WHERE id=1",
					"INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'B6','wizbiz','snap','{}',REPEAT('0',64),'applied','tool')",
					"INSERT INTO mig_object_map(batch_id,source_system,source_table,source_pk,target_domain,target_table,target_key,map_role,disposition) VALUES(1,'wizbiz','wb_bank_account','1','finance','finance_bank_account','BA1','primary','created')")
			}
			read := func(op string, i FinanceInput) map[string]any {
				t.Helper()
				v, e := s.Finance(ctx, op, i, who)
				if e != nil {
					t.Fatal(e)
				}
				return v.(map[string]any)
			}
			detail := read("accounts-view", FinanceInput{Code: "BA1"})["data"].(map[string]any)
			_, has := detail["source_info"]
			if has != installed {
				t.Fatal(detail)
			}
			q := FinanceInput{Page: 1, PageSize: 1, LegalEntityCode: "LE1"}
			want := int64(0)
			if installed {
				want = 1
			}
			if read("accounts-list", q)["total"] != want {
				t.Fatal("entity filter")
			}
			if read("balances-list", q)["total"] != want {
				t.Fatal("snapshot entity filter")
			}
			if installed {
				items := read("balances-list", q)["data"].([]map[string]any)
				if items[0]["balance_amount"] != "200.00" {
					t.Fatal("manual preference lost", items)
				}
			}
			q.LegalEntityCode = ""
			q.AccountType = "cash"
			if read("accounts-list", q)["total"] != int64(1) {
				t.Fatal("type filter")
			}
			q.AccountType = ""
			q.Complete = true
			for n := 3; n <= 200; n++ {
				w3Exec(t, db, fmt.Sprintf("INSERT INTO finance_bank_account(code,account_name,account_type,currency_code,status) VALUES('BA%d','Fixture','bank','CNY','active')", n))
			}
			out := read("accounts-list", q)
			if out["complete"] != true || len(out["data"].([]map[string]any)) != 200 {
				t.Fatal("complete bound", out)
			}
			w3Exec(t, db, "INSERT INTO finance_bank_account(code,account_name,account_type,currency_code,status) VALUES('BA201','Fixture','bank','CNY','active')")
			out = read("accounts-list", q)
			if out["complete"] != false || len(out["data"].([]map[string]any)) != 1 || out["total"] != int64(201) {
				t.Fatal("pagination fallback", out)
			}
			who.Tenant = "wrong"
			if _, e := s.Finance(ctx, "accounts-view", FinanceInput{Code: "BA1"}, who); e == nil {
				t.Fatal("identity bypass")
			}
		})
	}
}

func TestAPFW3Batch6BalanceEvidenceMySQL(t *testing.T) {
	s, db := balanceFixture(t, "w1-migration-ledger")
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime"}
	w3Exec(t, db, "INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'B6','wizbiz','snap','{}',REPEAT('0',64),'applied','tool')",
		`INSERT INTO mig_exception(id,batch_id,owning_domain,kind,source_table,source_pk,detail_json) VALUES(1,1,'finance','balance_without_account','wb_account_balance','date:2024-01-31','{"balanceDate":"2024-01-31","sourceEntryIds":["1","2","3","4"]}')`,
		`INSERT INTO mig_source_row(source_system,source_table,source_pk,source_snapshot,first_batch_id,row_json,row_sha256,captured_at) VALUES
 ('wizbiz','wb_account_balance','1','snap',1,'{"ba_id":"0","check_date":"2024-01-31","balance":"10.00","operate_time":"2024-01-31 12:00:00","operator_id":"12","private":"DO-NOT-LEAK"}',REPEAT('0',64),NOW()),
 ('wizbiz','wb_account_balance','2','snap',1,'{"ba_id":"0","check_date":"2024-01-31","balance":"20.00"}',REPEAT('0',64),NOW()),
 ('wizbiz','wb_account_balance','3','snap',1,'{"ba_id":"7","check_date":"2024-01-31","balance":"999.00"}',REPEAT('0',64),NOW()),
 ('wizbiz','wb_account_balance','4','other-snapshot',1,'{"ba_id":"0","check_date":"2024-01-31","balance":"999.00"}',REPEAT('0',64),NOW())`)
	w3Exec(t, db, "INSERT INTO mig_identity_map(source_system,source_user_id,display_name,match_status) VALUES('wizbiz','user:12','Historical name','unmatched'),('wizbiz','employee:12','DO-NOT-LEAK','unmatched')")
	q := MigrationQueueInput{ExceptionID: "1", Kind: "balance_without_account", Page: 1, PageSize: 1}
	v, e := s.MigrationExceptions(ctx, "finance", q, who)
	if e != nil {
		t.Fatal(e)
	}
	out := v.(map[string]any)
	if out["data"].([]map[string]any)[0]["recordedByName"] != "Historical name" || out["total"] != int64(2) || len(out["data"].([]map[string]any)) != 1 || strings.Contains(w3Raw(out), "DO-NOT-LEAK") || strings.Contains(w3Raw(out), "999.00") {
		t.Fatal(out)
	}
	q.Page = 2
	v, e = s.MigrationExceptions(ctx, "finance", q, who)
	if e != nil || v.(map[string]any)["data"].([]map[string]any)[0]["sourceEntryId"] != "2" {
		t.Fatal(v, e)
	}
	if _, e = s.MigrationExceptions(ctx, "altoc", q, who); e == nil {
		t.Fatal("wrong domain accepted")
	}
	q.ExceptionID = "99"
	if _, e = s.MigrationExceptions(ctx, "finance", q, who); e == nil {
		t.Fatal("unknown detail accepted")
	}
}
