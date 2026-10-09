package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"os"
	"strings"
	"sync"
	"testing"
)

func dueFixture(t *testing.T, domain string) (*Service, *sql.DB) {
	t.Helper()
	var s *Service
	var db *sql.DB
	switch domain {
	case "altoc":
		s, db = salesFixture(t)
	case "finance":
		s, db = financeLedgerFixture(t)
	case "people":
		ps, pdb := factsFixture(t, true)
		db = pdb
		var e error
		s, e = New(ps.Registry, ps.Binding)
		if e != nil {
			t.Fatal(e)
		}
		b, e := domaininstall.WithPeopleOffboarding(s.binding)
		if e != nil {
			t.Fatal(e)
		}
		for _, v := range domaininstall.PeopleOffboardingTables() {
			if _, e = db.Exec(v.DDL); e != nil {
				t.Fatal(e)
			}
		}
		s.binding = b
	}
	// Test helpers for Altoc/Finance historically omit parseTime; production does not.
	var name string
	if e := db.QueryRow("SELECT DATABASE()").Scan(&name); e != nil {
		t.Fatal(e)
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
	mc.DBName = name
	mc.ParseTime = true
	parsed, e := sql.Open("mysql", mc.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { parsed.Close() })
	db = parsed
	b, e := domaininstall.WithDue(s.binding, domain)
	if e != nil {
		t.Fatal(e)
	}
	installer := domaininstall.ForDue(domaininstall.Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: "host-test"}, domain)
	p, e := installer.PlanInstall(context.Background(), db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	off := func(context.Context) error { return nil }
	if e = installer.Apply(context.Background(), db, p, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = installer.Verify(context.Background(), db, p); e != nil {
		t.Fatal(e)
	}
	if e = installer.Rollback(context.Background(), db, receipt, off); e != nil {
		t.Fatal(e)
	}
	p, e = installer.PlanInstall(context.Background(), db, b)
	if e != nil {
		t.Fatal(e)
	}
	if e = installer.Apply(context.Background(), db, p, off, func(domaininstall.Receipt) error { return nil }); e != nil {
		t.Fatal(e)
	}
	reg := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = reg.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e = New(reg, b)
	if e != nil {
		t.Fatal(e)
	}
	return s, db
}
func TestAPFDueNotificationsMySQL(t *testing.T) {
	for _, domain := range []string{"altoc", "finance", "people"} {
		t.Run(domain, func(t *testing.T) {
			s, db := dueFixture(t, domain)
			ctx := context.Background()
			exec := func(q string) {
				t.Helper()
				if _, e := db.Exec(q); e != nil {
					t.Fatal(e, q)
				}
			}
			var family, update string
			switch domain {
			case "altoc":
				family = "sales-due"
				exec("INSERT INTO altoc_sales_task(code,name,assignee_uid,due_at,status) VALUES('TASK-DUE','isolated','Owner',UTC_TIMESTAMP()-INTERVAL 1 DAY,'todo')")
				update = "UPDATE altoc_sales_task SET assignee_uid='Next' WHERE code='TASK-DUE'"
			case "finance":
				family = "reconciliation-due"
				exec("INSERT INTO finance_receipt(code,received_amount,received_at,reconciliation_responsible_uid,reconciliation_due_at,status) VALUES('RC-DUE',1,UTC_TIMESTAMP(),'Owner',UTC_TIMESTAMP()-INTERVAL 1 DAY,'confirmed')")
				update = "UPDATE finance_receipt SET reconciliation_responsible_uid='Next' WHERE code='RC-DUE'"
			case "people":
				family = "handover-due"
				exec("INSERT INTO people_offboarding_cases(case_code,employee_uid,effective_date,status,created_by,updated_by) VALUES('EXIT-DUE','Employee',UTC_DATE(),'active','HR','HR')")
				exec("INSERT INTO people_offboarding_tasks(case_id,task_type,responsible_uid,due_at) SELECT id,'handover','Owner',UTC_TIMESTAMP()-INTERVAL 1 DAY FROM people_offboarding_cases WHERE case_code='EXIT-DUE'")
				update = "UPDATE people_offboarding_tasks SET responsible_uid='Next' WHERE task_type='handover'"
			}
			who := Identity{Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated-due"}
			owner := DueOwner{Enabled: true, LegacyOwnerDisabled: true}
			call := func(action string, in DueInput) any {
				t.Helper()
				v, e := s.Due(ctx, domain, family+":"+action, in, who, owner)
				if e != nil {
					t.Fatal(e)
				}
				return v
			}
			for _, bad := range []DueOwner{{}, {Enabled: true}, {LegacyOwnerDisabled: true}} {
				if _, e := s.Due(ctx, domain, family+":scan-due", DueInput{}, who, bad); peopleStatus(e) != 503 {
					t.Fatal("owner", e)
				}
			}
			for _, bad := range []Identity{{Tenant: "wrong", Deployment: "host-test", Client: "enterprise.runtime"}, {Tenant: "C000001", Deployment: "wrong", Client: "enterprise.runtime"}, {Tenant: "C000001", Deployment: "host-test", Client: "people.runtime"}, {Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Actor: "Owner"}} {
				if _, e := s.Due(ctx, domain, family+":scan-due", DueInput{}, bad, owner); peopleStatus(e) != 403 {
					t.Fatal("identity", e)
				}
			}
			first := call("scan-due", DueInput{}).(map[string]any)["items"].([]DueCandidate)
			if len(first) != 1 {
				t.Fatal("candidate", first)
			}
			c := first[0]
			repeated := call("scan-due", DueInput{}).(map[string]any)["items"].([]DueCandidate)
			if len(repeated) != 1 || repeated[0].EventKey != c.EventKey {
				t.Fatal("key changed")
			}
			if _, e := s.Due(ctx, domain, family+":closure-ack", DueInput{EventKey: c.EventKey, State: "cancelled"}, who, owner); peopleStatus(e) != 409 {
				t.Fatal("close before create", e)
			}
			// A successful target publish can be acknowledged after the owner changed. It must not lose real receipt evidence.
			exec(update)
			v := call("scan-due", DueInput{}).(map[string]any)
			pending := v["items"].([]DueCandidate)
			if len(pending) != 1 || !pending[0].RecoveryOnly {
				t.Fatal("must probe original key", pending)
			}
			call("published", DueInput{EventKey: c.EventKey, NotificationID: "notif-original", RecipientUID: "Owner"})
			call("published", DueInput{EventKey: c.EventKey, NotificationID: "notif-original", RecipientUID: "Owner"})
			if _, e := s.Due(ctx, domain, family+":published", DueInput{EventKey: c.EventKey, NotificationID: "notif-other", RecipientUID: "Owner"}, who, owner); peopleStatus(e) != 409 {
				t.Fatal("different receipt", e)
			}
			if v, e := s.AuthorizeDue(ctx, domain, "Owner", c.EventKey); e != nil || v.(map[string]any)["allowed"] != false {
				t.Fatal("stale viewer", v, e)
			}
			closures := call("scan-due", DueInput{}).(map[string]any)["closures"].([]DueCandidate)
			if len(closures) != 1 || closures[0].ClosureState != "cancelled" {
				t.Fatal("closure", closures)
			}
			call("closure-ack", DueInput{EventKey: c.EventKey, State: "cancelled"})
			call("closure-ack", DueInput{EventKey: c.EventKey, State: "cancelled"})
			next := call("scan-due", DueInput{}).(map[string]any)["items"].([]DueCandidate)
			if len(next) != 1 || next[0].RecipientUID != "Next" || next[0].EventKey == c.EventKey {
				t.Fatal("new owner generation", next)
			}
			c2 := next[0]
			call("published", DueInput{EventKey: c2.EventKey, NotificationID: "notif-next", RecipientUID: "Next"})
			if v, e := s.AuthorizeDue(ctx, domain, "Next", c2.EventKey); e != nil || v.(map[string]any)["allowed"] != true {
				t.Fatal("current viewer", v, e)
			}
			// Concurrent scans serialize only the family root and retain one immutable generation.
			var wg sync.WaitGroup
			errs := make(chan error, 2)
			start := make(chan struct{})
			for n := 0; n < 2; n++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					_, e := s.Due(ctx, domain, family+":scan-due", DueInput{}, who, owner)
					errs <- e
				}()
			}
			close(start)
			wg.Wait()
			close(errs)
			for e := range errs {
				if e != nil {
					t.Fatal("parallel scan", e)
				}
			}
			var count int
			if e := db.QueryRow("SELECT COUNT(*) FROM " + domain + "_due_checkpoint").Scan(&count); e != nil || count != 2 {
				t.Fatal("duplicate", count, e)
			}
			// Audit failures rollback checkpoint mutation.
			exec("CREATE TRIGGER fail_due_audit BEFORE INSERT ON " + domain + "_due_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated failure'")
			if _, e := s.Due(ctx, domain, family+":scan-due", DueInput{}, who, owner); e == nil {
				t.Fatal("audit fault succeeded")
			}
			exec("DROP TRIGGER fail_due_audit")
			switch domain {
			case "altoc":
				exec("INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'CUSTOMER-DUE','isolated','Owner')")
				exec("INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid) VALUES(1,'CONTRACT-DUE','isolated',1,'Owner')")
				exec("INSERT INTO altoc_billing_schedule(code,contract_id,name,trigger_type,amount,status,collection_responsible_uid,collection_due_at) VALUES('BS-DUE',1,'isolated','manual',1,'billable','Owner',UTC_TIMESTAMP()-INTERVAL 1 DAY)")
			case "finance":
				exec("INSERT INTO finance_invoice_request(code,requested_amount,status,issuance_responsible_uid,issuance_due_at) VALUES('IR-DUE',1,'approved','Owner',UTC_TIMESTAMP()-INTERVAL 1 DAY)")
			case "people":
				exec("INSERT INTO people_offboarding_tasks(case_id,task_type,responsible_uid,due_at) SELECT id,'asset_recovery_coordination','Owner',UTC_TIMESTAMP()-INTERVAL 1 DAY FROM people_offboarding_cases WHERE case_code='EXIT-DUE'")
			}
			for f, spec := range DueFamilies {
				if spec.Domain == domain && f != family {
					result, e := s.Due(ctx, domain, f+":scan-due", DueInput{}, who, owner)
					if e != nil {
						t.Fatal("other family canonical query", f, e)
					}
					items := result.(map[string]any)["items"].([]DueCandidate)
					if len(items) != 1 || items[0].RecipientUID != "Owner" {
						t.Fatal("other family positive", f, items)
					}
					key := items[0].EventKey
					if _, e = s.Due(ctx, domain, f+":published", DueInput{EventKey: key, NotificationID: "other-family", RecipientUID: "Owner"}, who, owner); e != nil {
						t.Fatal(e)
					}
				}
			}
			// Fixtures live in dedicated disposable DB; existing helper drops the DB at cleanup.
		})
	}
}
func TestAPFDueClosedOperations(t *testing.T) {
	n := 0
	for f, v := range DueFamilies {
		if !strings.HasSuffix(v.EnableFlag, "ENABLED") || v.Purpose == "" {
			t.Fatal("family spec")
		}
		for _, a := range []string{"scan-due", "published", "closure-ack"} {
			ff, aa, ok := DueOperation(f + ":" + a)
			if !ok || ff != f || aa != a {
				t.Fatal("operation")
			}
			n++
		}
	}
	if n != 18 {
		t.Fatal(n)
	}
	for _, op := range []string{"scan-due", "sales-due:replay", "unknown:published"} {
		if _, _, ok := DueOperation(op); ok {
			t.Fatal(op)
		}
	}
}

func TestAPFDueFairCursorAndAtomicFreezeMySQL(t *testing.T) {
	s, db := dueFixture(t, "altoc")
	ctx := context.Background()
	who := Identity{Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated-fair"}
	owner := DueOwner{Enabled: true, LegacyOwnerDisabled: true}
	for n := 0; n < 45; n++ {
		if _, e := db.Exec("INSERT INTO altoc_sales_task(code,name,assignee_uid,due_at,status) VALUES(?, 'isolated', 'Owner', UTC_TIMESTAMP()-INTERVAL 1 DAY,'todo')", fmt.Sprintf("TASK-%d", n)); e != nil {
			t.Fatal(e)
		}
	}
	keys := map[string]bool{}
	for n := 0; n < 4; n++ {
		result, e := s.Due(ctx, "altoc", "sales-due:scan-due", DueInput{}, who, owner)
		if e != nil {
			t.Fatal(e)
		}
		for _, c := range result.(map[string]any)["items"].([]DueCandidate) {
			keys[c.EventKey] = true
			if _, e = s.Due(ctx, "altoc", "sales-due:published", DueInput{EventKey: c.EventKey, NotificationID: c.EventKey, RecipientUID: "Owner"}, who, owner); e != nil {
				t.Fatal(e)
			}
		}
	}
	if len(keys) != 45 {
		t.Fatalf("cursor starved rows: %d/45", len(keys))
	}
	if _, e := db.Exec("INSERT INTO altoc_sales_task(code,name,assignee_uid,due_at,status) VALUES('TASK-FAULT','isolated','Owner',UTC_TIMESTAMP()-INTERVAL 1 DAY,'todo')"); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec("UPDATE altoc_due_cursor SET source_cursor='sales_task:45' WHERE family='sales-due'"); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec("CREATE TRIGGER fail_due_audit BEFORE INSERT ON altoc_due_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated failure'"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Due(ctx, "altoc", "sales-due:scan-due", DueInput{}, who, owner); e == nil {
		t.Fatal("audit failure did not roll back")
	}
	var count int
	if e := db.QueryRow("SELECT COUNT(*) FROM altoc_due_checkpoint").Scan(&count); e != nil || count != 45 {
		t.Fatal("partial checkpoint freeze", count, e)
	}
	if _, e := db.Exec("DROP TRIGGER fail_due_audit"); e != nil {
		t.Fatal(e)
	}
}
