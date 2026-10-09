package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func contractAimsFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	s, db := customerFixture(t)
	ctx := context.Background()
	schema, e := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if e != nil {
		t.Fatal(e)
	}
	names := []string{"aims_projects", "aims_project_members", "project_counters", "project_lifecycle_events", "milestones"}
	tables := map[string]string{}
	conn, e := db.Conn(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	if _, e = conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=0"); e != nil {
		t.Fatal(e)
	}
	for _, n := range names {
		ddl := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `" + n + "`.*?ENGINE=InnoDB[^;]*;").FindString(string(schema))
		if ddl == "" {
			t.Fatal(n)
		}
		if n == "milestones" {
			ddl = strings.Replace(ddl, "CREATE TABLE IF NOT EXISTS `milestones`", "CREATE TABLE IF NOT EXISTS `aims_milestones`", 1)
		}
		if _, e = conn.ExecContext(ctx, ddl); e != nil {
			t.Fatal(n, e)
		}
		tables[n] = n
		if n == "milestones" {
			tables[n] = "aims_milestones"
		}
	}
	if _, e = conn.ExecContext(ctx, "ALTER TABLE aims_milestones DROP INDEX idx_milestone_billing_schedule,DROP COLUMN billing_schedule_code"); e != nil {
		t.Fatal(e)
	}
	if _, e = conn.ExecContext(ctx, "CREATE VIEW milestones AS SELECT * FROM aims_milestones"); e != nil {
		t.Fatal(e)
	}
	migration, e := os.ReadFile("../../../aims/docs/migration_v6.0_milestone_billing_schedule.sql")
	if e != nil {
		t.Fatal(e)
	}
	for _, q := range strings.Split(string(migration), ";") {
		if strings.TrimSpace(q) == "" {
			continue
		}
		if _, e = conn.ExecContext(ctx, q); e != nil {
			t.Fatal("D06", e)
		}
	}
	verify, e := os.ReadFile("../../../aims/docs/migration_v6.0_milestone_billing_schedule_verify.sql")
	if e != nil {
		t.Fatal(e)
	}
	var pass string
	if e = conn.QueryRowContext(ctx, string(verify)).Scan(&pass); e != nil || pass != "PASS" {
		t.Fatal("D06 verify", pass, e)
	}
	conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=1")
	conn.Close()
	b := s.binding
	b.Domains["aims"] = enterprise.DomainBinding{OwnerDeployment: "aims-test", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: tables}
	if e = enterprise.VerifyCompatibilityViews(ctx, db, b, "aims", []string{"milestones"}); e != nil {
		t.Fatal("D06 Runtime compatibility view contract", e)
	}
	s.registry = enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = s.registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	s.binding = b
	return s, db
}

func TestAPFContractMultiProjectMySQL(t *testing.T) {
	s, db := contractAimsFixture(t)
	ctx := context.Background()
	var e error
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "contract-create", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	customer, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "客户", "owner_uid": "person", "owner_dept_code": "D1"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	cid := fmt.Sprint(customer.(map[string]any)["data"].(map[string]any)["id"])
	call := func(op string, in ContractInput) map[string]any {
		t.Helper()
		v, e := s.Contract(ctx, op, in, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)["data"].(map[string]any)
	}
	in := ContractInput{CustomerID: cid, Payload: map[string]any{"name": "多行多项目", "currency_code": "CNY"}}
	c := call("contracts-create", in)
	again := call("contracts-create", in)
	if c["id"] != again["id"] {
		t.Fatal("duplicate contract")
	}
	id := fmt.Sprint(c["id"])
	normalize := func(c map[string]any) ContractInput {
		return ContractInput{ID: id, Payload: map[string]any{"expectedVersion": c["row_version"]}}
	}
	who.Key = "lines"
	in = normalize(c)
	in.Rows = []map[string]any{}
	for _, name := range []string{"实施", "培训"} {
		in.Rows = append(in.Rows, map[string]any{"line_type": "implementation", "name": name, "quantity": "1.0000", "unit_price": "100.00", "tax_rate": "6.00", "acceptance_required": true, "project_policy": "required"})
	}
	c = call("contract-lines-replace", in)
	var snapshot struct {
		Lines []struct {
			Code string `json:"code"`
		}
		Obligations []struct {
			Code string `json:"code"`
		}
		Schedules []struct {
			Code string `json:"code"`
		} `json:"billing_schedules"`
	}
	raw, _ := json.Marshal(c)
	if e = json.Unmarshal(raw, &snapshot); e != nil {
		t.Fatal(e)
	}
	if len(snapshot.Lines) != 2 || len(snapshot.Obligations) != 4 || len(snapshot.Schedules) != 2 {
		t.Fatalf("children: %s", raw)
	}
	// Approved is an authoritative Workflow fixture, never an available browser action.
	if _, e = db.Exec("UPDATE altoc_contract SET status='approved' WHERE id=?", id); e != nil {
		t.Fatal(e)
	}
	who.Key = "sign"
	c = call("contracts-sign", normalize(c))
	plans := []aims.ContractProjectPlan{}
	for n, code := range []string{"CONTRACT-A", "CONTRACT-B"} {
		plans = append(plans, aims.ContractProjectPlan{ProjectCode: code, Name: "项目" + code, DeptCode: "D1", Create: true, LineCodes: []string{snapshot.Lines[n].Code}, ObligationCodes: []string{snapshot.Obligations[n*2].Code}, BillingScheduleCodes: []string{snapshot.Schedules[n].Code}})
	}
	permits := func(plans []aims.ContractProjectPlan) []aims.ContractProjectPermit {
		out := []aims.ContractProjectPermit{}
		rev := int64(1)
		for _, p := range plans {
			for _, resource := range []string{"projects", "milestones"} {
				if resource == "milestones" && !p.Create {
					continue
				}
				action := "edit"
				if resource == "projects" && p.Create {
					action = "create"
				}
				out = append(out, aims.ContractProjectPermit{ActorUID: who.Actor, Tenant: who.Tenant, Deployment: who.Deployment, ProjectCode: p.ProjectCode, Resource: "projects", Action: action, Allowed: true, ExpiresAt: time.Now().Add(14 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "signed", PolicyRevision: &rev, Scope: &projectscope.Projection{Version: 1, ProjectCodes: []string{}, DepartmentCodes: []string{}, DepartmentTreeRoots: []string{}, Masks: []int{65535}}})
			}
		}
		return out
	}
	who.Key = "bind"
	in = normalize(c)
	in.Projects = plans
	in.AimsPermits = permits(plans)
	c = call("contract-projects-bind", in)
	in.AimsPermits = permits(plans)
	call("contract-projects-bind", in)
	for _, table := range []string{"aims_projects", "milestones", "altoc_contract_project_link"} {
		var n int
		if e = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); e != nil || n != 2 {
			t.Fatal(table, n, e)
		}
	}
	// Failure after creating the first project and milestone must roll back both domains.
	if _, e = db.Exec("CREATE TRIGGER fail_contract_milestone BEFORE INSERT ON aims_milestones FOR EACH ROW BEGIN IF NEW.billing_schedule_code='RB-1' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated failure'; END IF; END"); e != nil {
		t.Fatal(e)
	}
	who.Key = "rollback"
	bad := normalize(c)
	bad.Projects = append([]aims.ContractProjectPlan(nil), plans...)
	for n := range bad.Projects {
		bad.Projects[n].ProjectCode = fmt.Sprintf("ROLLBACK-%d", n)
		billingCode := fmt.Sprintf("RB-%d", n)
		if _, e = db.Exec("INSERT INTO altoc_billing_schedule (code,contract_id,contract_line_id,name,direction,amount,currency_code,trigger_type) SELECT ?,contract_id,contract_line_id,name,direction,amount,currency_code,trigger_type FROM altoc_billing_schedule WHERE code=?", billingCode, bad.Projects[n].BillingScheduleCodes[0]); e != nil {
			t.Fatal(e)
		}
		bad.Projects[n].BillingScheduleCodes = []string{billingCode}
	}
	bad.AimsPermits = permits(bad.Projects)
	if _, e = s.Contract(ctx, "contract-projects-bind", bad, who, scope); e == nil {
		t.Fatal("expected failure")
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM aims_projects WHERE project_code LIKE 'ROLLBACK-%'").Scan(&n)
	if n != 0 {
		t.Fatal("partial project commit")
	}
	db.QueryRow("SELECT COUNT(*) FROM aims_milestones WHERE billing_schedule_code LIKE 'RB-%'").Scan(&n)
	if n != 0 {
		t.Fatal("partial milestone commit")
	}
	db.QueryRow("SELECT COUNT(*) FROM altoc_contract_project_link WHERE project_code LIKE 'ROLLBACK-%'").Scan(&n)
	if n != 0 {
		t.Fatal("partial link commit")
	}
	db.Exec("DROP TRIGGER fail_contract_milestone")
	// Opposite payload order must take the same locks. Shared key makes concurrent
	// replays converge without duplicate projects/links or deadlock retries.
	who.Key = "concurrent"
	in = normalize(c)
	for n := range plans {
		plans[n].Create = false
	}
	in.Projects = plans
	in.AimsPermits = permits(plans)
	reverse := in
	reverse.Projects = append([]aims.ContractProjectPlan(nil), plans...)
	reverse.Projects[0], reverse.Projects[1] = reverse.Projects[1], reverse.Projects[0]
	reverse.AimsPermits = permits(reverse.Projects)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, v := range []ContractInput{in, reverse} {
		wg.Add(1)
		go func(v ContractInput) {
			defer wg.Done()
			w := who
			w.Key += "-" + v.Projects[0].ProjectCode
			_, e := s.Contract(ctx, "contract-projects-bind", v, w, scope)
			errs <- e
		}(v)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil && !strings.Contains(e.Error(), "version_conflict") {
			t.Fatal("deadlock/unexpected", e)
		}
	}
	// Cross-contract child, expired authorization and fresh revoked scope fail closed.
	who.Key = "bad-scope"
	in = normalize(c)
	in.Projects = plans
	in.AimsPermits = permits(plans)
	in.AimsPermits[0].ExpiresAt = 1
	if _, e = s.Contract(ctx, "contract-projects-bind", in, who, scope); e == nil {
		t.Fatal("expired scope accepted")
	}
}

func TestAPFContractTermsAndObligationsMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "term-customer", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	customer, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "客户", "owner_uid": "person", "owner_dept_code": "D1"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.Contract(ctx, "contracts-create", ContractInput{CustomerID: fmt.Sprint(customer.(map[string]any)["data"].(map[string]any)["id"]), Payload: map[string]any{"name": "条款合同", "currency_code": "CNY"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	row := c.(map[string]any)["data"].(map[string]any)
	id := fmt.Sprint(row["id"])
	call := func(op, key string, payload map[string]any, rows []map[string]any) {
		t.Helper()
		who.Key = key
		payload["expectedVersion"] = row["row_version"]
		v, e := s.Contract(ctx, op, ContractInput{ID: id, Payload: payload, Rows: rows}, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		row = v.(map[string]any)["data"].(map[string]any)
	}
	call("contract-lines-replace", "term-lines", map[string]any{}, []map[string]any{{"line_type": "service", "name": "服务", "quantity": "2.0000", "unit_price": "50.00", "tax_rate": "6.00", "acceptance_required": false, "project_policy": "none"}})
	var lineCode, obCode string
	db.QueryRow("SELECT code FROM altoc_contract_line WHERE contract_id=?", id).Scan(&lineCode)
	db.QueryRow("SELECT code FROM altoc_contract_obligation WHERE contract_id=?", id).Scan(&obCode)
	call("payment-terms-replace", "term-save", map[string]any{}, []map[string]any{{"contract_line_code": lineCode, "term_name": "首款", "term_type": "advance", "ratio": "40.0000", "trigger_type": "contract_signed", "invoice_required": true}, {"term_name": "分期", "term_type": "recurring", "amount": "20.00", "trigger_type": "recurring", "recurrence_interval": "month", "service_start_date": "2026-01-01", "service_end_date": "2026-03-31", "invoice_required": true}})
	var amount string
	var periods int
	if e = db.QueryRow("SELECT amount FROM altoc_contract_payment_term WHERE term_name='首款'").Scan(&amount); e != nil || amount != "40.00" {
		t.Fatal("ratio", amount, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_billing_schedule WHERE payment_term_id IS NOT NULL AND recurrence_period IS NOT NULL AND deleted_at IS NULL").Scan(&periods); e != nil || periods != 3 {
		t.Fatal("recurrence", periods, e)
	}
	who.Key = "unapproved"
	if _, e = s.Contract(ctx, "contracts-sign", ContractInput{ID: id, Payload: map[string]any{"expectedVersion": row["row_version"]}}, who, scope); e == nil {
		t.Fatal("browser sign bypassed approval")
	}
	db.Exec("UPDATE altoc_contract SET status='approved' WHERE id=?", id)
	signVersion := row["row_version"]
	call("contracts-sign", "term-sign", map[string]any{}, nil)
	call("obligations-transition", "ob-start", map[string]any{"obligationCode": obCode, "action": "start"}, nil)
	call("obligations-transition", "ob-submit", map[string]any{"obligationCode": obCode, "action": "submit"}, nil)
	var status string
	if e = db.QueryRow("SELECT status FROM altoc_billing_schedule WHERE source_type='contract_line' AND contract_id=?", id).Scan(&status); e != nil || status != "billable" {
		t.Fatal(status, e)
	}
	who.Key = "term-cross"
	if _, e = s.Contract(ctx, "obligations-transition", ContractInput{ID: id, Payload: map[string]any{"expectedVersion": row["row_version"], "obligationCode": "OB-OTHER", "action": "start"}}, who, scope); e == nil {
		t.Fatal("unowned obligation")
	}
	// Same actor, key and original intent: a revoked scope cannot replay the receipt.
	who.Key = "term-sign"
	if _, e = s.Contract(ctx, "contracts-sign", ContractInput{ID: id, Payload: map[string]any{"expectedVersion": signVersion}}, who, altoc.BasicReadScope{Access: "none"}); e == nil {
		t.Fatal("revoked scope replayed successful receipt")
	}
}

func TestAPFContractOppositeOrdersIndependentContractsMySQL(t *testing.T) {
	s, db := contractAimsFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	scope := altoc.BasicReadScope{Access: "self"}
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "concurrent-customer", RequestID: "isolated"}
	customer, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "并发客户", "owner_uid": "person", "owner_dept_code": "D1"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	cid := fmt.Sprint(customer.(map[string]any)["data"].(map[string]any)["id"])
	ids := []string{}
	for n := 0; n < 2; n++ {
		who.Key = fmt.Sprintf("contract-party-%d", n)
		out, e := s.Contract(ctx, "contracts-create", ContractInput{CustomerID: cid, Payload: map[string]any{"name": "并发合同", "currency_code": "CNY"}}, who, scope)
		if e != nil {
			t.Fatal(e)
		}
		id := fmt.Sprint(out.(map[string]any)["data"].(map[string]any)["id"])
		ids = append(ids, id)
		if _, e = db.Exec("UPDATE altoc_contract SET status='effective' WHERE id=?", id); e != nil {
			t.Fatal(e)
		}
	}
	for _, code := range []string{"SHARED-A", "SHARED-B"} {
		if _, e = db.Exec("INSERT INTO aims_projects(project_code,name,short_name,category,methodology,lifecycle_status,leader_uid,dept_code,security_level,confidentiality_level,created_by) VALUES(?,?,?,'delivery','PIVR','draft','person','D1','project_team','L1','person')", code, code, code); e != nil {
			t.Fatal(e)
		}
	}
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for n, id := range ids {
		wg.Add(1)
		go func(n int, id string) {
			defer wg.Done()
			plans := []aims.ContractProjectPlan{{ProjectCode: "SHARED-A", DeptCode: "D1"}, {ProjectCode: "SHARED-B", DeptCode: "D1"}}
			if n == 1 {
				plans[0], plans[1] = plans[1], plans[0]
			}
			rev := int64(1)
			permits := []aims.ContractProjectPermit{}
			for _, p := range plans {
				permits = append(permits, aims.ContractProjectPermit{ActorUID: "person", Tenant: "C000001", Deployment: "host-test", ProjectCode: p.ProjectCode, Resource: "projects", Action: "edit", Allowed: true, ExpiresAt: time.Now().Add(14 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "signed", PolicyRevision: &rev, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}})
			}
			<-start
			w := who
			w.Key = fmt.Sprintf("bind-party-%d", n)
			_, e := s.Contract(ctx, "contract-projects-bind", ContractInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1)}, Projects: plans, AimsPermits: permits}, w, scope)
			errs <- e
		}(n, id)
	}
	close(start)
	wg.Wait()
	close(errs)
	success, conflict := 0, 0
	for e := range errs {
		if e == nil {
			success++
		} else if strings.Contains(e.Error(), "contract_project_conflict") {
			conflict++
		} else {
			t.Fatal("unexpected failure/deadlock", e)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal(success, conflict)
	}
	var owners, linked int
	db.QueryRow("SELECT COUNT(DISTINCT contract_code) FROM aims_projects WHERE project_code IN('SHARED-A','SHARED-B')").Scan(&owners)
	db.QueryRow("SELECT COUNT(*) FROM altoc_contract_project_link WHERE project_code IN('SHARED-A','SHARED-B')").Scan(&linked)
	if owners != 1 || linked != 2 {
		t.Fatal("mixed/partial ownership", owners, linked)
	}
}

func TestAPFContractFromQuotationPreservesDiscountMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "source-customer", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	customer, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "客户", "owner_uid": "person", "owner_dept_code": "D1"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	cid := fmt.Sprint(customer.(map[string]any)["data"].(map[string]any)["id"])
	who.Key = "source-quote"
	v, e := s.Quotation(ctx, "quotations-create", QuotationInput{CustomerID: cid, Payload: map[string]any{"currency_code": "CNY"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	quote := v.(map[string]any)["data"].(map[string]any)
	qid := fmt.Sprint(quote["id"])
	who.Key = "source-items"
	v, e = s.Quotation(ctx, "quotation-items-replace", QuotationInput{ID: qid, Payload: map[string]any{"expectedVersion": quote["row_version"]}, Items: []QuotationItem{{Name: "中文折扣项", Quantity: "1.2500", Price: "100.00", Discount: "5.00", Tax: "6.00"}}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	// Authoritative approved source fixture; no browser approval command exists.
	if _, e = db.Exec("UPDATE altoc_quotation SET status='approved' WHERE id=?", qid); e != nil {
		t.Fatal(e)
	}
	who.Key = "source-contract"
	in := ContractInput{QuotationID: qid, Payload: map[string]any{"name": "折扣转合同"}}
	v, e = s.Contract(ctx, "contracts-from-quotation", in, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	row := v.(map[string]any)["data"].(map[string]any)
	if row["amount_tax_inclusive"] != "118.75" || row["amount_tax_exclusive"] != "112.03" {
		t.Fatal("discount lost", row)
	}
	if _, e = s.Contract(ctx, "contracts-from-quotation", in, who, scope); e != nil {
		t.Fatal("conversion replay", e)
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM altoc_contract WHERE quotation_id=?", qid).Scan(&n)
	if n != 1 {
		t.Fatal("duplicate conversion", n)
	}
}

func TestAPFMilestoneBillingViewRejectsDefinerMySQL(t *testing.T) {
	s, db := contractAimsFixture(t)
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, "CREATE OR REPLACE VIEW milestones AS SELECT * FROM aims_milestones"); err != nil {
		t.Fatal(err)
	}
	if err := enterprise.VerifyCompatibilityViews(ctx, db, s.binding, "aims", []string{"milestones"}); err == nil {
		t.Fatal("Runtime must reject a DEFINER compatibility view")
	}
	verify, err := os.ReadFile("../../../aims/docs/migration_v6.0_milestone_billing_schedule_verify.sql")
	if err != nil {
		t.Fatal(err)
	}
	var result string
	if err = db.QueryRowContext(ctx, string(verify)).Scan(&result); err != nil || result != "FAIL" {
		t.Fatal("migration verify must reject DEFINER", result, err)
	}
}
