package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
)

type costTestCalendar struct{ Hours string }

func (c costTestCalendar) ReadCNMonth(context.Context, string) (projectcost.CalendarInput, error) {
	return projectcost.CalendarInput{Code: "CN", Month: "2026-10", StandardHours: c.Hours, HoursPerDay: "8", SHA256: projectcost.Hash(c.Hours), SourceVersion: "1", WorkdayCount: 20}, nil
}
func costFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	s, db := financeSpendFixture(t)
	b, e := domaininstall.WithFinanceCost(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	tables, _ := domaininstall.APFTables("people")
	for _, v := range append(tables, domaininstall.FinanceCostTables()...) {
		if _, e = db.Exec(v.DDL); e != nil {
			t.Fatal(v.Logical, e)
		}
	}
	var schema []byte
	schema, e = os.ReadFile("../../../aims/docs/aims_schema.sql")
	if e != nil {
		t.Fatal(e)
	}
	start := strings.Index(string(schema), "CREATE TABLE IF NOT EXISTS `time_entries`")
	end := strings.Index(string(schema[start:]), "ENGINE=InnoDB")
	ddl := string(schema[start:start+end]) + "ENGINE=InnoDB"
	db.SetMaxOpenConns(1)
	db.Exec("SET FOREIGN_KEY_CHECKS=0")
	for _, q := range []string{"CREATE TABLE aims_projects(id BIGINT UNSIGNED PRIMARY KEY,project_code VARCHAR(64) UNIQUE,name VARCHAR(200) NOT NULL DEFAULT '项目') ENGINE=InnoDB", ddl} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	db.Exec("SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(12)
	b.Domains["aims"] = enterprise.DomainBinding{OwnerDeployment: "host-test", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"aims_projects": "aims_projects", "time_entries": "time_entries"}}
	for _, domain := range []string{"people", "finance"} {
		d := b.Domains[domain]
		d.Read = enterprise.PathUnified
		d.Write = enterprise.PathUnified
		b.Domains[domain] = d
	}
	r := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = r.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e = New(r, b)
	if e != nil {
		t.Fatal(e)
	}
	s.ConfigureProjectCostCalendar(costTestCalendar{"160"})
	for _, q := range []string{
		"INSERT INTO aims_projects(id,project_code) VALUES(1,'P1'),(2,'P2')",
		"INSERT INTO people_employees(employee_uid,employee_no,display_name,employment_type) VALUES('u1','E1','Fixture','full_time'),('u2','E2','Other','full_time')",
		"INSERT INTO people_assignments(assignment_code,employee_uid,change_type,effective_from,is_primary,rank_code,dept_code,approval_status) VALUES('A1','u1','onboard','2026-01-01',1,'R1','D1','approved'),('A2','u2','onboard','2026-01-01',1,'R1','D2','approved')",
		"INSERT INTO people_ranks(rank_code,rank_name) VALUES('R1','Fixture')",
		"INSERT INTO people_standard_cost_rates(rate_code,rate_name,rank_code,rank_salary,performance_salary_min,performance_salary_max,currency,effective_from,enabled) VALUES('RATE','Fixture','R1',500,0,0,'CNY','2026-01-01',1)",
		"INSERT INTO finance_people_cost_parameter(code,name,effective_from,base_salary,welfare_cost_rate,management_allocation_rate,resource_allocation_cost,currency_code,status) VALUES('PARAM','Fixture','2026-01-01',1000,0,0,0,'CNY','active')",
		"INSERT INTO time_entries(project_id,uid,entry_date,hours,review_status) VALUES(1,'u1','2026-10-01',8,'approved')",
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(q, e)
		}
	}
	return s, db
}
func costActor(s *Service) Identity {
	return Identity{Actor: "manager", Client: "enterprise.runtime", Tenant: s.binding.Key.Tenant, Deployment: "host-test"}
}
func costAll() CostScope {
	return CostScope{Access: "all", ProjectCodes: []string{}, Salary: altoc.BasicReadScope{Access: "none", DepartmentCodes: []string{}}}
}
func previewCost(t *testing.T, s *Service, p string) map[string]any {
	t.Helper()
	out, e := s.ProjectCost(context.Background(), "project-labor-preview", CostInput{ProjectCode: p, PeriodMonth: "2026-10"}, costActor(s), costAll())
	if e != nil {
		t.Fatal(e)
	}
	return out.(map[string]any)
}
func writeCost(t *testing.T, s *Service, op, key string, pre map[string]any) (map[string]any, error) {
	t.Helper()
	who := costActor(s)
	who.Key = key
	v, e := s.ProjectCost(context.Background(), op, CostInput{ProjectCode: pre["projectCode"].(string), PeriodMonth: "2026-10", ExpectedVersion: costVersion(pre["expectedVersion"]), ExpectedInputHash: pre["inputHash"].(string)}, who, costAll())
	if e != nil {
		return nil, e
	}
	return v.(map[string]any), nil
}
func costVersion(v any) int64 {
	switch v := v.(type) {
	case int64:
		return v
	case float64:
		return int64(v)
	}
	return 0
}
func assertCostCode(t *testing.T, e error, code string) {
	t.Helper()
	var h httperror.Error
	if !errors.As(e, &h) || h.Code != "finance_project_cost_"+code {
		t.Fatalf("want %s got %v", code, e)
	}
}
func TestAPF14CostFullReplaceHistoryMySQL(t *testing.T) {
	s, db := costFixture(t)
	pre := previewCost(t, s, "P1")
	if pre["laborCostAmount"] != "75.00" {
		t.Fatal(pre)
	}
	first, e := writeCost(t, s, "project-labor-recalculate", "first", pre)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := writeCost(t, s, "project-labor-recalculate", "first", pre)
	if e != nil || replay["batchCode"] != first["batchCode"] {
		t.Fatal(replay, e)
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM finance_project_cost_batch").Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
	// Another intent under the same receipt key must not execute or get a reply.
	altered := cloneCostMap(pre)
	altered["inputHash"] = strings.Repeat("f", 64)
	if _, e = writeCost(t, s, "project-labor-recalculate", "first", altered); e == nil {
		t.Fatal("same-key changed intent")
	}
	same, e := writeCost(t, s, "project-labor-recalculate", "same-input", previewCost(t, s, "P1"))
	if e != nil || same["batchCode"] != first["batchCode"] {
		t.Fatal(same, e)
	}
	// Unmanaged labor is deliberately not replaced or reversed.
	if _, e = db.Exec("INSERT INTO finance_project_cost_allocation(code,project_code,period_month,allocation_type,source_table,amount,currency_code,allocation_basis,basis_value,rule_code,source_refs_json,status,created_by) VALUES('MANUAL','P1','2026-10','labor','manual',5,'CNY','manual',1,'manual','{}','active','fixture')"); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE time_entries SET hours=16,row_version=row_version+1 WHERE project_id=1"); e != nil {
		t.Fatal(e)
	}
	if _, e = writeCost(t, s, "project-labor-recalculate", "stale", pre); e == nil {
		t.Fatal("stale input")
	}
	next, e := writeCost(t, s, "project-labor-recalculate", "next", previewCost(t, s, "P1"))
	if e != nil || next["laborCostAmount"] != "150.00" {
		t.Fatal(next, e)
	}
	var historical string
	if e = db.QueryRow("SELECT CAST(labor_cost_amount AS CHAR) FROM finance_project_cost_batch WHERE code=?", first["batchCode"]).Scan(&historical); e != nil || historical != "75.00" {
		t.Fatal(historical, e)
	}
	// Remove approved input and leave returned input: whole month is not_ready.
	db.Exec("UPDATE time_entries SET review_status='returned',row_version=row_version+1 WHERE project_id=1")
	notReady, e := writeCost(t, s, "project-labor-recalculate", "returned", previewCost(t, s, "P1"))
	if e != nil || notReady["laborCostAmount"] != nil {
		t.Fatal(notReady, e)
	}
	db.QueryRow("SELECT COUNT(*) FROM finance_project_cost_allocation WHERE source_table='aims.time_entries' AND status='active'").Scan(&count)
	if count != 0 {
		t.Fatal("partial managed collection")
	}
	db.QueryRow("SELECT COUNT(*) FROM finance_project_cost_allocation WHERE code='MANUAL' AND status='active'").Scan(&count)
	if count != 1 {
		t.Fatal("manual touched")
	}
	var labor, profit, margin sql.NullString
	db.QueryRow("SELECT labor_cost_amount,gross_profit_amount,gross_margin_rate FROM finance_project_summary WHERE project_code='P1'").Scan(&labor, &profit, &margin)
	if labor.Valid || profit.Valid || margin.Valid {
		t.Fatal("not-ready zero substitute")
	}
	out, e := s.ProjectCost(context.Background(), "project-labor-history-view", CostInput{ProjectCode: "P1", PeriodMonth: "2026-10", Code: first["batchCode"].(string)}, costActor(s), costAll())
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(out)
	for _, secret := range []string{"RankSalary", "RankCode", "input_snapshot_json", "calendar_snapshot_json", "employee_uid", "source_snapshot_json"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("history disclosure", secret)
		}
	}
}
func cloneCostMap(v map[string]any) map[string]any {
	out := map[string]any{}
	for k, x := range v {
		out[k] = x
	}
	return out
}
func TestAPF14ZeroCloseAndAtomicRollbackMySQL(t *testing.T) {
	s, db := costFixture(t)
	pre := previewCost(t, s, "P2")
	if pre["laborCostAmount"] != nil {
		t.Fatal("implicit zero")
	}
	if _, e := writeCost(t, s, "project-cost-period-confirm-zero", "zero", pre); e != nil {
		t.Fatal(e)
	}
	pre = previewCost(t, s, "P2")
	if pre["laborCostAmount"] != "0.00" {
		t.Fatal(pre)
	}
	if _, e := writeCost(t, s, "project-labor-recalculate", "zero-recalc", pre); e != nil {
		t.Fatal(e)
	}
	pre = previewCost(t, s, "P2")
	closed, e := writeCost(t, s, "project-cost-period-close", "close", pre)
	if e != nil || closed["closed"] != true {
		t.Fatal(closed, e)
	}
	if _, e = writeCost(t, s, "project-labor-recalculate", "closed-denied", previewCost(t, s, "P2")); e == nil {
		t.Fatal("closed recalculated")
	}
	if _, e = writeCost(t, s, "project-cost-period-close", "close", pre); e != nil {
		t.Fatal("closed receipt replay", e)
	}
	// Recalc failure late in the Tx must roll back projection, batch, period, audit,
	// and receipt. The fixture uses a private trigger; no production mechanism.
	db.Exec("CREATE TRIGGER cost_fail BEFORE INSERT ON finance_project_cost_batch_item FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture failure'")
	pre = previewCost(t, s, "P1")
	if _, e = writeCost(t, s, "project-labor-recalculate", "atomic-fail", pre); e == nil {
		t.Fatal("late failure did not fire")
	}
	for _, table := range []string{"finance_project_cost_period", "finance_project_summary", "finance_project_cost_allocation", "finance_project_cost_batch"} {
		var n int
		db.QueryRow("SELECT COUNT(*) FROM " + table + " WHERE project_code='P1'").Scan(&n)
		if n != 0 {
			t.Fatal("partial write", table, n)
		}
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM finance_service_command_receipt WHERE idempotency_key='atomic-fail'").Scan(&n)
	if n != 0 {
		t.Fatal("partial receipt")
	}
}
func TestAPF14TimeInputRangeIsolationMySQL(t *testing.T) {
	for _, mutation := range []string{"insert-empty", "delete", "return"} {
		t.Run(mutation, func(t *testing.T) {
			s, db := costFixture(t)
			p, _ := projectcost.NewPeriod("P1", "2026-10")
			if mutation == "insert-empty" {
				db.Exec("DELETE FROM time_entries")
			}
			req, _ := s.request("aims", enterprise.Write)
			tx, rs, e := s.registry.BeginRepeatableWriteTransaction(context.Background(), req)
			if e != nil {
				t.Fatal(e)
			}
			defer tx.Rollback()
			port := aims.ProjectCostInputs{Table: rs[0].Table}
			before, e := port.ReadProjectTimeInputs(context.Background(), tx, p)
			if e != nil {
				t.Fatal(e)
			}
			started := make(chan int64)
			done := make(chan error, 1)
			go func() {
				conn, e := db.Conn(context.Background())
				if e != nil {
					done <- e
					return
				}
				defer conn.Close()
				var connectionID int64
				if e = conn.QueryRowContext(context.Background(), "SELECT CONNECTION_ID()").Scan(&connectionID); e != nil {
					done <- e
					return
				}
				started <- connectionID
				q := "DELETE FROM time_entries WHERE project_id=1"
				if mutation == "insert-empty" {
					q = "INSERT INTO time_entries(project_id,uid,entry_date,hours,review_status) VALUES(1,'u1','2026-10-02',8,'approved')"
				}
				if mutation == "return" {
					q = "UPDATE time_entries SET review_status='returned',row_version=row_version+1 WHERE project_id=1"
				}
				_, e = conn.ExecContext(context.Background(), q)
				done <- e
			}()
			connectionID := <-started
			waiting := false
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				var n int
				if e = db.QueryRow("SELECT COUNT(*) FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=? AND trx_state='LOCK WAIT'", connectionID).Scan(&n); e != nil {
					t.Fatal(e)
				}
				if n == 1 {
					waiting = true
					break
				}
				select {
				case e := <-done:
					t.Fatal("mutation passed owning range lock", e)
				case <-time.After(20 * time.Millisecond):
				}
			}
			if !waiting {
				t.Fatal("writer never observed in InnoDB LOCK WAIT")
			}
			still, e := port.ReadProjectTimeInputs(context.Background(), tx, p)
			if e != nil || still.SHA256 != before.SHA256 {
				t.Fatal("locked set changed", e)
			}
			if e = tx.Commit(); e != nil {
				t.Fatal(e)
			}
			select {
			case e := <-done:
				if e != nil {
					t.Fatal(e)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("range not released")
			}
			tx, rs, e = s.registry.BeginRepeatableWriteTransaction(context.Background(), req)
			if e != nil {
				t.Fatal(e)
			}
			after, e := (aims.ProjectCostInputs{Table: rs[0].Table}).ReadProjectTimeInputs(context.Background(), tx, p)
			tx.Rollback()
			if e != nil || after.SHA256 == before.SHA256 {
				t.Fatal("did not observe mutation", e)
			}
		})
	}
}
func TestAPF14ConcurrentCASAndCrossProjectHistoryMySQL(t *testing.T) {
	s, db := costFixture(t)
	pre := previewCost(t, s, "P1")
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, e := writeCost(t, s, "project-labor-recalculate", fmt.Sprint("race-", n), pre)
			errs <- e
		}(n)
	}
	wg.Wait()
	close(errs)
	success := 0
	for e := range errs {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("CAS winners", success)
	}
	var batch, original string
	db.QueryRow("SELECT code,CAST(labor_cost_amount AS CHAR) FROM finance_project_cost_batch WHERE project_code='P1'").Scan(&batch, &original)
	db.Exec("INSERT INTO time_entries(project_id,uid,entry_date,hours,review_status) VALUES(2,'u1','2026-10-01',16,'approved')")
	db.Exec("UPDATE finance_people_cost_parameter SET base_salary=2000,row_version=row_version+1")
	if _, e := writeCost(t, s, "project-labor-recalculate", "other-project", previewCost(t, s, "P2")); e != nil {
		t.Fatal(e)
	}
	var old string
	db.QueryRow("SELECT CAST(labor_cost_amount AS CHAR) FROM finance_project_cost_batch WHERE code=?", batch).Scan(&old)
	if old != original {
		t.Fatal("history drift")
	}
}

func TestAPF14M3ReadinessAndScopeMySQL(t *testing.T) {
	s, db := costFixture(t)
	for _, q := range []string{
		"INSERT INTO finance_receipt(id,code,project_code,received_amount,currency_code,received_at,status,confirmed_by) VALUES(101,'RC101','P1',100,'CNY','2026-10-01','confirmed','confirmer'),(102,'DRAFT','P1',999,'CNY','2026-10-01','draft',NULL)",
		"INSERT INTO finance_reconciliation(code,receipt_id,target_type,project_code,reconciled_amount,currency_code,reconciled_at,status,idempotency_key,reconciled_by) VALUES('R101',101,'manual','P1',80,'CNY',NOW(),'active','rec-key','reconciler'),('R102',102,'manual','P1',999,'CNY',NOW(),'active','draft-key','reconciler'),('R103',101,'manual','P1',10,'CNY',NOW(),'active','reversed-key','reconciler')",
		"UPDATE finance_reconciliation SET status='reversed',reversed_at=NOW(),reversed_by='reconciler',reverse_reason='fixture' WHERE code='R103'",
		"INSERT INTO finance_expense(code,project_code,expense_date,expense_amount,currency_code,status,confirmed_by) VALUES('EXP1','P1','2026-10-01',10,'CNY','confirmed','payer'),('EXP-DRAFT','P1','2026-10-01',999,'CNY','draft',NULL)",
	} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	first, e := writeCost(t, s, "project-labor-recalculate", "m3", previewCost(t, s, "P1"))
	if e != nil {
		t.Fatal(e)
	}
	var income, expense, profit, margin string
	if e = db.QueryRow("SELECT CAST(receipt_amount AS CHAR),CAST(direct_expense_amount AS CHAR),CAST(gross_profit_amount AS CHAR),CAST(gross_margin_rate AS CHAR) FROM finance_project_summary WHERE project_code='P1'").Scan(&income, &expense, &profit, &margin); e != nil || income != "80.00" || expense != "10.00" || profit != "-5.00" || margin != "-0.0625" {
		t.Fatal(income, expense, profit, margin, e)
	}
	pre := previewCost(t, s, "P1")
	db.Exec("UPDATE finance_reconciliation SET status='reversed',reversed_at=NOW(),reversed_by='reconciler',reverse_reason='fixture',row_version=row_version+1 WHERE code='R101'")
	if _, e = writeCost(t, s, "project-labor-recalculate", "stale-m3", pre); e == nil {
		t.Fatal("M3 CAS bypass")
	}
	if _, e = writeCost(t, s, "project-labor-recalculate", "m3-changed", previewCost(t, s, "P1")); e != nil {
		t.Fatal(e)
	}
	var old string
	db.QueryRow("SELECT CAST(labor_cost_amount AS CHAR) FROM finance_project_cost_batch WHERE code=?", first["batchCode"]).Scan(&old)
	if old != "75.00" {
		t.Fatal("M3 mutated old batch")
	}
	input := CostInput{ProjectCode: "P1", PeriodMonth: "2026-10", Page: 1, PageSize: 20}
	scope := costAll()
	if _, e = s.ProjectCost(context.Background(), "employee-costs-page", input, costActor(s), scope); e == nil {
		t.Fatal("Finance alone saw salary totals")
	}
	scope.Salary = altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}
	db.Exec("UPDATE people_employees SET dept_code='D1' WHERE employee_uid='u1'")
	out, e := s.ProjectCost(context.Background(), "employee-costs-page", input, costActor(s), scope)
	if e != nil || out.(map[string]any)["total"] == int64(0) {
		t.Fatal(out, e)
	}
	db.Exec("UPDATE people_employees SET dept_code='D2' WHERE employee_uid='u1'")
	out, e = s.ProjectCost(context.Background(), "employee-costs-page", input, costActor(s), scope)
	if e != nil || out.(map[string]any)["total"] != int64(0) {
		t.Fatal("old department read salary history", out, e)
	}
	denied := CostScope{Access: "projects", ProjectCodes: []string{"P2"}, Salary: altoc.BasicReadScope{Access: "none"}}
	if _, e = s.ProjectCost(context.Background(), "project-accounting-page", input, costActor(s), denied); e == nil {
		t.Fatal("out of project scope")
	}
	input.ProjectCode = ""
	out, e = s.ProjectCost(context.Background(), "project-accounting-page", input, costActor(s), denied)
	if e != nil || out.(map[string]any)["total"] != int64(1) {
		t.Fatal("scoped pagination includes uncomputed projects", out, e)
	}
	rows := out.(map[string]any)["data"].([]map[string]any)
	if len(rows) != 1 || rows[0]["project_code"] != "P2" || rows[0]["cost_readiness_status"] != "not_ready" || rows[0]["labor_cost_amount"] != nil {
		t.Fatal("uncomputed project must remain selectable without invented cost", rows)
	}
	var snapshotID int64
	if e = db.QueryRow("SELECT id FROM finance_employee_cost_snapshot WHERE employee_uid='u1'").Scan(&snapshotID); e != nil {
		t.Fatal(e)
	}
	employeeView := CostInput{PeriodMonth: "2026-10", Code: fmt.Sprint(snapshotID)}
	joint := costAll()
	joint.Salary = altoc.BasicReadScope{Access: "all"}
	if out, e = s.ProjectCost(context.Background(), "employee-costs-view", employeeView, costActor(s), joint); e != nil || out.(map[string]any)["data"] == nil {
		t.Fatal("joint salary detail without manual project", out, e)
	}
	joint.Access = "projects"
	joint.ProjectCodes = []string{"P2"}
	if out, e = s.ProjectCost(context.Background(), "employee-costs-view", employeeView, costActor(s), joint); e != nil || out.(map[string]any)["data"] != nil {
		t.Fatal("salary id must not bypass project scope", out, e)
	}
	for search, want := range map[string]int64{"P1": 1, "P%": 0, "absent": 0} {
		input.Search = search
		out, e = s.ProjectCost(context.Background(), "project-accounting-page", input, costActor(s), costAll())
		if e != nil || out.(map[string]any)["total"] != want {
			t.Fatal("literal search before pagination", search, out, e)
		}
	}
}
func TestAPF14ZeroInvalidatesAndMissingFactsMySQL(t *testing.T) {
	s, db := costFixture(t)
	if _, e := writeCost(t, s, "project-cost-period-confirm-zero", "zero-input", previewCost(t, s, "P2")); e != nil {
		t.Fatal(e)
	}
	db.Exec("INSERT INTO time_entries(project_id,uid,entry_date,hours,review_status) VALUES(2,'u1','2026-10-01',8,'submitted')")
	p := previewCost(t, s, "P2")
	if p["readiness"] != "not_ready" || p["laborCostAmount"] != nil {
		t.Fatal("zero survived new input", p)
	}
	if _, e := writeCost(t, s, "project-cost-period-confirm-zero", "not-empty", p); e == nil {
		t.Fatal("nonempty zero confirm")
	}
	db.Exec("UPDATE time_entries SET review_status='approved',row_version=row_version+1 WHERE project_id=2")
	db.Exec("UPDATE people_standard_cost_rates SET enabled=0,row_version=row_version+1")
	p = previewCost(t, s, "P2")
	if p["readiness"] != "not_ready" {
		t.Fatal("missing rate", p)
	}
	db.Exec("UPDATE people_standard_cost_rates SET enabled=1,effective_from='2026-11-01',row_version=row_version+1")
	p = previewCost(t, s, "P2")
	if p["readiness"] != "not_ready" {
		t.Fatal("future rate selected", p)
	}
	db.Exec("UPDATE people_standard_cost_rates SET effective_from='2026-10-31',currency='USD',row_version=row_version+1")
	p = previewCost(t, s, "P2")
	if p["readiness"] != "not_ready" {
		t.Fatal("implicit FX", p)
	}
	db.Exec("UPDATE people_standard_cost_rates SET currency='CNY',row_version=row_version+1")
	p = previewCost(t, s, "P2")
	if p["laborCostAmount"] != "75.00" {
		t.Fatal("month-end inclusive", p)
	}
	if _, e := writeCost(t, s, "project-labor-recalculate", "valid-current", p); e != nil {
		t.Fatal(e)
	}
	var hash sql.NullString
	db.QueryRow("SELECT zero_input_sha256 FROM finance_project_cost_period WHERE project_code='P2'").Scan(&hash)
	if hash.Valid {
		t.Fatal("old zero fact not cleared")
	}
	db.Exec("UPDATE enterprise_schema_registry SET generation=generation+1 WHERE id=1")
	if _, e := s.ProjectCost(context.Background(), "project-labor-preview", CostInput{ProjectCode: "P1", PeriodMonth: "2026-10"}, costActor(s), costAll()); e == nil {
		t.Fatal("stale Registry binding")
	}
}

func TestAPF14M3WritesRefreshSameTransactionMySQL(t *testing.T) {
	s, db := costFixture(t)
	s.ConfigureOwnerDirectory(testOwnerDirectory)
	first, e := writeCost(t, s, "project-labor-recalculate", "baseline", previewCost(t, s, "P1"))
	if e != nil {
		t.Fatal(e)
	}
	run := func(op, code, key, actor string, p map[string]any) map[string]any {
		t.Helper()
		who := costActor(s)
		who.Actor = actor
		who.Key = key
		v, e := s.FinanceLedger(context.Background(), op, FinanceInput{Code: code, Payload: p}, who, altoc.BasicReadScope{Access: "all"})
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)["data"].(map[string]any)
	}
	version := func(table, code string) float64 {
		t.Helper()
		var n int64
		if e := db.QueryRow("SELECT row_version FROM "+table+" WHERE code=?", code).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return float64(n)
	}
	receipt := run("receipts-create", "", "cash-draft", "maker", map[string]any{"projectCode": "P1", "receivedAmount": "100.00", "currencyCode": "CNY", "receivedAt": "2026-10-03", "responsibleUid": "reconciler", "dueAt": "2026-10-10 00:00:00"})
	code := ledgerText(receipt["code"])
	run("receipts-confirm", code, "confirm-cash", "confirmer", map[string]any{"expectedVersion": version("finance_receipt", code)})
	var amount string
	db.QueryRow("SELECT CAST(receipt_amount AS CHAR) FROM finance_project_summary WHERE project_code='P1'").Scan(&amount)
	if amount != "0.00" {
		t.Fatal("unallocated cash counted", amount)
	}
	rec := run("reconciliation-create", "", "allocate-cash", "reconciler", map[string]any{"receiptCode": code, "targetType": "manual", "reconciledAmount": "80.00", "currencyCode": "CNY", "receiptVersion": version("finance_receipt", code)})
	var income, profit string
	db.QueryRow("SELECT CAST(receipt_amount AS CHAR),CAST(gross_profit_amount AS CHAR) FROM finance_project_summary WHERE project_code='P1'").Scan(&income, &profit)
	if income != "80.00" || profit != "5.00" {
		t.Fatal("not atomically refreshed", income, profit)
	}
	p := map[string]any{"expenseDate": "2026-10-03", "expenseAmount": "25.00", "currencyCode": "CNY", "projectCode": "P1", "description": "fixture"}
	expense := run("expenses-create", "", "expense-draft", "maker", p)
	exCode := ledgerText(expense["code"])
	run("expenses-confirm", exCode, "expense-confirm", "payer", map[string]any{"expectedVersion": version("finance_expense", exCode)})
	var expenseAmount string
	db.QueryRow("SELECT CAST(direct_expense_amount AS CHAR),CAST(gross_profit_amount AS CHAR) FROM finance_project_summary WHERE project_code='P1'").Scan(&expenseAmount, &profit)
	if expenseAmount != "25.00" || profit != "-20.00" {
		t.Fatal(expenseAmount, profit)
	}
	// A summary failure must undo the M3 mutation and its receipt as well.
	db.Exec("CREATE TRIGGER cost_summary_fail BEFORE UPDATE ON finance_project_summary FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture summary failure'")
	who := costActor(s)
	who.Actor = "reconciler"
	who.Key = "atomic-reverse"
	rcCode := ledgerText(rec["code"])
	if _, e = s.FinanceLedger(context.Background(), "reconciliation-void", FinanceInput{Code: rcCode, Payload: map[string]any{"expectedVersion": version("finance_reconciliation", rcCode), "reason": "fixture"}}, who, altoc.BasicReadScope{Access: "all"}); e == nil {
		t.Fatal("late M3 summary failure ignored")
	}
	var status string
	db.QueryRow("SELECT status FROM finance_reconciliation WHERE code=?", rcCode).Scan(&status)
	if status != "active" {
		t.Fatal("partial M3 commit", status)
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM finance_service_command_receipt WHERE idempotency_key='atomic-reverse'").Scan(&n)
	if n != 0 {
		t.Fatal("partial receipt")
	}
	var historical string
	db.QueryRow("SELECT CAST(labor_cost_amount AS CHAR) FROM finance_project_cost_batch WHERE code=?", first["batchCode"]).Scan(&historical)
	if historical != "75.00" {
		t.Fatal("M3 rewrote immutable batch")
	}
}

func TestAPF14cPublicLaborAllocationIsProjectTotalMySQL(t *testing.T) {
	s, db := costFixture(t)
	if _, e := db.Exec("INSERT INTO time_entries(project_id,uid,entry_date,hours,review_status) VALUES(1,'u2','2026-10-01',8,'approved')"); e != nil {
		t.Fatal(e)
	}
	if _, e := writeCost(t, s, "project-labor-recalculate", "public-total", previewCost(t, s, "P1")); e != nil {
		t.Fatal(e)
	}
	input := CostInput{ProjectCode: "P1", PeriodMonth: "2026-10", Page: 1, PageSize: 20}
	out, e := s.ProjectCost(context.Background(), "project-cost-allocations-page", input, costActor(s), costAll())
	if e != nil {
		t.Fatal(e)
	}
	data := out.(map[string]any)
	rows := data["data"].([]map[string]any)
	if data["total"] != int64(1) || len(rows) != 1 || rows[0]["amount"] != "150.00" || rows[0]["basis_value"] != nil || rows[0]["allocation_basis"] != "project_total" {
		t.Fatal("individual salary must not be derivable from public labor lines", out)
	}
	code := rows[0]["code"].(string)
	if !strings.HasPrefix(code, "CL-") {
		t.Fatal(code)
	}
	view := CostInput{ProjectCode: "P1", PeriodMonth: "2026-10", Code: code}
	out, e = s.ProjectCost(context.Background(), "project-cost-allocations-view", view, costActor(s), costAll())
	if e != nil || out.(map[string]any)["data"] == nil {
		t.Fatal("public total detail", out, e)
	}
	view.Code = "CA-" + projectcost.Hash([]any{"P1", "2026-10", "u1", projectcost.FormulaVersion})[:48]
	out, e = s.ProjectCost(context.Background(), "project-cost-allocations-view", view, costActor(s), costAll())
	if e != nil || out.(map[string]any)["data"] != nil {
		t.Fatal("per-person code cannot retrieve public salary allocation", out, e)
	}
}
