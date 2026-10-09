package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestAPFW3MigrationQueueReadsMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "sales-admin", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated"}
	unavailable := func(e error) {
		t.Helper()
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != 503 || he.Code != "migration_ledger_unavailable" {
			t.Fatal("expected ledger unavailable, got", e)
		}
	}
	page := MigrationQueueInput{Page: 1, PageSize: 20}

	// Ledger not installed: 503 for every read, never an empty list.
	_, e := s.MigrationExceptions(ctx, "altoc", page, who)
	unavailable(e)
	_, e = s.MigrationIdentities(ctx, page, who)
	unavailable(e)

	for _, table := range domaininstall.W1Tables("w1-migration-ledger") {
		if _, e = db.Exec(table.DDL); e != nil {
			t.Fatal(table.Logical, e)
		}
	}
	b, e := domaininstall.WithW1(s.binding, "w1-migration-ledger", "host-test")
	if e != nil {
		t.Fatal(e)
	}
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	if s, e = New(registry, b); e != nil {
		t.Fatal(e)
	}
	// Installed but empty: a real empty page with zeroed counters for this domain only.
	out, e := s.MigrationExceptions(ctx, "altoc", page, who)
	if e != nil {
		t.Fatal(e)
	}
	empty := out.(map[string]any)
	if empty["total"] != int64(0) || len(empty["openCounts"].(map[string]int64)) != 7 {
		t.Fatal("empty queue", empty)
	}
	if _, finance := empty["openCounts"].(map[string]int64)["balance_without_account"]; finance {
		t.Fatal("Finance kind counted for Altoc")
	}

	const secret = "MUST-NOT-LEAK"
	for _, q := range []string{
		"INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'W1','wizbiz','snapshot','{}',REPEAT('0',64),'applied','tool')",
		`INSERT INTO mig_source_row(source_system,source_table,source_pk,source_snapshot,first_batch_id,row_json,row_sha256,captured_at) VALUES
			('wizbiz','wb_contactman','11','snapshot',1,'{"cm_name":"Marked Zhang","department":"Sales","post":null,"phone":"010-0000","mobile":"13800000001","mobile2":null,"stars":"3","chief":"1","employee_id":"7","address":"` + secret + ` street","weixin_number":"` + secret + `","remarks":"` + secret + `"}',REPEAT('a',64),CURRENT_TIMESTAMP(3)),
			('wizbiz','wb_contactman','12','snapshot',1,'{"cm_name":"Other Li","department":null,"post":null,"phone":null,"mobile":"13900000002","mobile2":null,"stars":"1","chief":"0","employee_id":"8","address":null,"weixin_number":"zhang-in-wechat","remarks":null}',REPEAT('b',64),CURRENT_TIMESTAMP(3))`,
		`INSERT INTO mig_identity_map(source_system,source_user_id,display_name,source_status,directory_uid,match_status,match_basis) VALUES
			('wizbiz','employee:7','Marked Owner','active','u-7','candidate','name_unique'),('wizbiz','employee:8','Second Owner','inactive',NULL,'unmatched',NULL),('wizbiz','user:7','Operator Account',NULL,NULL,'candidate',NULL),('wizbiz','7','Bare Key Must Not Match',NULL,NULL,'candidate',NULL),('other','employee:7','Foreign System',NULL,NULL,'candidate',NULL)`,
		`INSERT INTO mig_exception(batch_id,owning_domain,kind,source_table,source_pk,target_table,target_key,detail_json,status) VALUES
			(1,'altoc','contact_without_customer','wb_contactman','11',NULL,NULL,'{"sourceUserId":"7","note":"` + secret + `"}','open'),
			(1,'altoc','contact_without_customer','wb_contactman','12',NULL,NULL,'{"sourceUserId":"8"}','open'),
			(1,'altoc','owner_unmatched','wb_organization','5','altoc_customer','CU-W000005','{"sourceUserId":"7","mobile":"` + secret + `"}','open'),
			(1,'altoc','owner_unmatched','wb_contract','9','altoc_contract','CT-W000009','{"sourceUserId":"7"}','resolved'),
			(1,'altoc','effective_amount_exceeds_total','wb_contract','3','altoc_contract','CT-W000003','{"totalAmount":"100.00","effectiveAmount":"120.00"}','open'),
			(1,'altoc','future_unknown_kind','wb_contract','4',NULL,NULL,'{"anything":"` + secret + `"}','open'),
			(1,'finance','balance_without_account','wb_account_balance','date:2024-01-31',NULL,NULL,'{"balanceDate":"2024-01-31","entryCount":"3","latestAmounts":["1.00","2.00"],"sourceEntryIds":["1","2","3"]}','open'),
			(1,'finance','contract_balance_mismatch','wb_contract','3','altoc_contract','CT-W000003','{"recomputedAmount":"10.00","cachedAmount":"12.00","difference":"2.00"}','open')`,
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	// B4 filters run before COUNT/page and event projections never expose payloads.
	filtered, err := s.MigrationExceptions(ctx, "altoc", MigrationQueueInput{Page: 1, PageSize: 1, Status: "open,resolved", Options: &MigrationQueryOptions{ObjectSearch: "CT-W", Sort: "created_desc"}}, who)
	if err != nil || filtered.(map[string]any)["total"] != int64(2) {
		t.Fatal("B4 scoped filter/count", filtered, err)
	}
	for n := 0; n < 25; n++ {
		if _, err = db.Exec("INSERT INTO altoc_audit_log(entity_type,entity_id,action,operator_uid,new_value) VALUES('migration_exception',3,'accept','synthetic',JSON_OBJECT('secret',?))", secret); err != nil {
			t.Fatal(err)
		}
	}
	events, err := s.MigrationExceptions(ctx, "altoc", MigrationQueueInput{Page: 2, PageSize: 20, Options: &MigrationQueryOptions{EventsFor: "exception:3"}}, who)
	if err != nil {
		t.Fatal(err)
	}
	ev := events.(map[string]any)
	if ev["total"] != int64(25) || len(ev["data"].([]map[string]any)) != 5 {
		t.Fatal("B4 event pagination", ev)
	}
	encoded, _ := json.Marshal(ev)
	if strings.Contains(string(encoded), secret) || strings.Contains(string(encoded), "new_value") {
		t.Fatal("event payload leaked")
	}
	if _, err = s.MigrationExceptions(ctx, "finance", MigrationQueueInput{Page: 1, PageSize: 20, Options: &MigrationQueryOptions{EventsFor: "exception:3"}}, who); err == nil {
		t.Fatal("cross-domain event accepted")
	}
	read := func(domain string, i MigrationQueueInput) map[string]any {
		t.Helper()
		if i.Page == 0 {
			i.Page, i.PageSize = 1, 20
		}
		v, e := s.MigrationExceptions(ctx, domain, i, who)
		if e != nil {
			t.Fatal(e)
		}
		return v.(map[string]any)
	}
	raw := func(v any) string {
		b, _ := json.Marshal(v)
		return string(b)
	}

	// Altoc sees only its own kinds; an unknown kind is neither listed nor counted.
	altocAll := read("altoc", MigrationQueueInput{})
	if altocAll["total"] != int64(5) || strings.Contains(raw(altocAll), "future_unknown_kind") || strings.Contains(raw(altocAll), "balance_without_account") {
		t.Fatal("altoc list", raw(altocAll))
	}
	counts := altocAll["openCounts"].(map[string]int64)
	if counts["contact_without_customer"] != 2 || counts["owner_unmatched"] != 1 || counts["effective_amount_exceeds_total"] != 1 {
		t.Fatal("open counts", counts)
	}
	// Nothing outside the per-kind whitelist is returned, whatever the ledger holds.
	if strings.Contains(raw(altocAll), secret) {
		t.Fatal("non-whitelisted detail leaked", raw(altocAll))
	}
	finance := read("finance", MigrationQueueInput{})
	if finance["total"] != int64(2) || strings.Contains(raw(finance), "contact_without_customer") {
		t.Fatal("finance list", raw(finance))
	}
	if detail := read("finance", MigrationQueueInput{Kind: "balance_without_account"})["data"].([]map[string]any)[0]["detail"].(map[string]any); detail["balanceDate"] != "2024-01-31" || len(detail["latestAmounts"].([]any)) != 2 {
		t.Fatal("finance detail", detail)
	}

	// Unassigned contacts: fixed source fields plus the original owner's display name.
	contacts := read("altoc", MigrationQueueInput{Kind: "contact_without_customer"})
	rows := contacts["data"].([]map[string]any)
	if contacts["total"] != int64(2) || len(rows) != 2 {
		t.Fatal("contacts", raw(contacts))
	}
	first := rows[0]["contact"].(map[string]any)
	if first["cm_name"] != "Marked Zhang" || first["mobile"] != "13800000001" || first["stars"] != "3" || rows[0]["source_user_name"] != "Marked Owner" || rows[1]["source_user_name"] != "Second Owner" {
		t.Fatal("contact projection", raw(rows[0]))
	}
	for _, hidden := range []string{"employee_id", "address", "weixin_number", "remarks", "row_json", "row_sha256"} {
		if _, ok := first[hidden]; ok || strings.Contains(raw(contacts), `"`+hidden+`"`) {
			t.Fatal("ledger field returned", hidden)
		}
	}
	if strings.Contains(raw(contacts), secret) {
		t.Fatal("contact row leaked", raw(contacts))
	}
	// Search matches name and phones only, not other ledger columns.
	if found := read("altoc", MigrationQueueInput{Kind: "contact_without_customer", Search: "Zhang"}); found["total"] != int64(1) {
		t.Fatal("search by name", found["total"])
	}
	if found := read("altoc", MigrationQueueInput{Kind: "contact_without_customer", Search: "1390000"}); found["total"] != int64(1) {
		t.Fatal("search by mobile", found["total"])
	}
	if found := read("altoc", MigrationQueueInput{Kind: "contact_without_customer", Search: secret}); found["total"] != int64(0) {
		t.Fatal("search reached a non-whitelisted column")
	}
	if found := read("altoc", MigrationQueueInput{Kind: "owner_unmatched", Status: "resolved"}); found["total"] != int64(1) {
		t.Fatal("status filter", found["total"])
	}
	if paged := read("altoc", MigrationQueueInput{Page: 2, PageSize: 2}); len(paged["data"].([]map[string]any)) != 2 || paged["total"] != int64(5) {
		t.Fatal("paging", raw(paged))
	}

	// Identities: only this source system, with the number of open owner items.
	v, e := s.MigrationIdentities(ctx, page, who)
	if e != nil {
		t.Fatal(e)
	}
	identities := v.(map[string]any)
	people := identities["data"].([]map[string]any)
	// The salesperson id in a queue item is a bare employee id; identities are keyed
	// "employee:<id>". An operator account "user:7" or a bare "7" is someone else.
	if identities["total"] != int64(4) || people[0]["source_user_id"] != "employee:7" || people[0]["display_name"] != "Marked Owner" || people[0]["open_owner_items"] != int64(1) || people[0]["directory_uid"] != "u-7" || people[1]["open_owner_items"] != int64(0) || people[2]["open_owner_items"] != int64(0) || people[3]["open_owner_items"] != int64(0) || strings.Contains(raw(identities), "Foreign System") {
		t.Fatal("identities", raw(identities))
	}
	if v, e = s.MigrationIdentities(ctx, MigrationQueueInput{Page: 1, PageSize: 20, Status: "unmatched"}, who); e != nil || v.(map[string]any)["total"] != int64(1) {
		t.Fatal("identity status filter", e)
	}

	// Closed input: cross-domain kinds, search outside contacts, unknown values.
	for name, c := range map[string]struct {
		domain string
		in     MigrationQueueInput
	}{
		"finance kind for altoc":  {"altoc", MigrationQueueInput{Page: 1, PageSize: 20, Kind: "balance_without_account"}},
		"altoc kind for finance":  {"finance", MigrationQueueInput{Page: 1, PageSize: 20, Kind: "owner_unmatched"}},
		"unknown kind":            {"altoc", MigrationQueueInput{Page: 1, PageSize: 20, Kind: "future_unknown_kind"}},
		"search outside contacts": {"altoc", MigrationQueueInput{Page: 1, PageSize: 20, Kind: "owner_unmatched", Search: "x"}},
		"search without kind":     {"altoc", MigrationQueueInput{Page: 1, PageSize: 20, Search: "x"}},
		"unknown status":          {"altoc", MigrationQueueInput{Page: 1, PageSize: 20, Status: "deleted"}},
		"oversized page":          {"altoc", MigrationQueueInput{Page: 1, PageSize: 500}},
		"foreign domain":          {"people", MigrationQueueInput{Page: 1, PageSize: 20}},
	} {
		if _, e = s.MigrationExceptions(ctx, c.domain, c.in, who); e == nil {
			t.Fatal(name)
		}
	}
	bad := who
	bad.Client = "other.client"
	if _, e = s.MigrationExceptions(ctx, "altoc", page, bad); e == nil {
		t.Fatal("foreign client accepted")
	}
	if _, e = db.Exec(`INSERT INTO mig_exception(batch_id,owning_domain,kind,source_table,source_pk,target_table,target_key,detail_json,status) VALUES(1,'altoc','contract_contact_mismatch','wb_contract','44','altoc_contract','CT-W000044','{"sourceContactId":"11","contactSourceOrgId":null,"unapproved":"MUST-NOT-LEAK"}','open')`); e != nil {
		t.Fatal(e)
	}
	mismatch := read("altoc", MigrationQueueInput{Kind: "contract_contact_mismatch"})
	if mismatch["total"] != int64(1) || strings.Contains(raw(mismatch), "MUST-NOT-LEAK") {
		t.Fatal("mismatch projection invalid")
	}
	for _, method := range []string{"accept", "reopen", "mark_done"} {
		in := MigrationResolveInput{ID: "1", ExpectedVersion: 1, Method: method, Reason: "synthetic"}
		if ValidateMigrationResolveInput("altoc", in) != nil {
			t.Fatal("existing manual method rejected")
		}
	}
	// The reads never change the ledger.
	var changed int
	if e = db.QueryRow("SELECT COUNT(*) FROM mig_exception WHERE row_version<>1 OR resolved_by IS NOT NULL").Scan(&changed); e != nil || changed != 0 {
		t.Fatal("ledger changed by a read", changed, e)
	}
}
