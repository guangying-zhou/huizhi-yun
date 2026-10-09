package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"strings"
	"sync"
	"testing"
)

func offboardingFixture(t *testing.T) (PeopleFactsService, *sql.DB) {
	t.Helper()
	s, db := factsFixture(t, true)
	ctx := context.Background()
	b, e := domaininstall.WithPeopleOffboarding(s.Binding)
	if e != nil {
		t.Fatal(e)
	}
	install := domaininstall.ForPeopleOffboarding(domaininstall.Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: "host-test"})
	p, e := install.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	off := func(context.Context) error { return nil }
	var receipt domaininstall.Receipt
	if e = install.Apply(ctx, db, p, off, func(r domaininstall.Receipt) error { receipt = r; return nil }); e != nil {
		t.Fatal(e)
	}
	if e = install.Verify(ctx, db, p); e != nil {
		t.Fatal(e)
	}
	if e = install.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	p, e = install.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	if e = install.Apply(ctx, db, p, off, func(domaininstall.Receipt) error { return nil }); e != nil {
		t.Fatal(e)
	}
	if e = install.Verify(ctx, db, p); e != nil {
		t.Fatal(e)
	}
	for _, q := range []string{
		"CREATE TABLE assets_items(id BIGINT PRIMARY KEY,user_uid VARCHAR(64),status VARCHAR(30),archived_at DATETIME NULL) ENGINE=InnoDB",
		"CREATE TABLE assets_offboarding(id BIGINT AUTO_INCREMENT PRIMARY KEY,case_code VARCHAR(64) UNIQUE,source_app VARCHAR(30),source_event_key VARCHAR(191),source_payload_sha256 CHAR(64),departed_employee_uid VARCHAR(64),offboarded_at DATETIME,recovery_due_at DATE,recovery_responsible_uid VARCHAR(64),status VARCHAR(20) DEFAULT 'active',created_by VARCHAR(64),updated_by VARCHAR(64),UNIQUE(source_app,source_event_key)) ENGINE=InnoDB",
		"INSERT INTO people_employees(employee_uid,employee_no,display_name,dept_code,created_by,updated_by) VALUES('leaver','P1','员工','A','HR','HR'),('HR','P2','人事','A','HR','HR'),('AssetManager','P3','资产经理','A','HR','HR')",
		"INSERT INTO people_assignments(assignment_code,employee_uid,change_type,effective_from,approval_status,created_by,updated_by) VALUES('ASN-leave','leaver','leave','2020-01-01','approved','HR','HR')",
		"INSERT INTO assets_items VALUES(1,'leaver','in_use',NULL)",
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	b.Domains["assets"] = enterprise.DomainBinding{OwnerDeployment: "assets-test", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"asset_items": "assets_items", "asset_offboarding_recovery_cases": "assets_offboarding"}}
	s.Binding = b
	s.Registry = enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = s.Registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	return s, db
}

func TestAPFPeopleOffboardingRollbackAndConcurrentCASMySQL(t *testing.T) {
	s, db := offboardingFixture(t)
	ctx := context.Background()
	all := altoc.BasicReadScope{Access: "all"}
	who := Identity{Actor: "HR", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "create", RequestID: "17b-fault"}
	i := people.EnterpriseFactsInput{EmployeeUID: "leaver", Payload: map[string]any{"leaveAssignmentCode": "ASN-leave"}}
	for _, bad := range []Identity{{Actor: "HR", Tenant: "Other", Deployment: "host-test", Client: "enterprise.runtime", Key: "create"}, {Actor: "HR", Tenant: "C000001", Deployment: "Other", Client: "enterprise.runtime", Key: "create"}, {Actor: "HR", Tenant: "C000001", Deployment: "host-test", Client: "people.runtime", Key: "create"}} {
		if _, e := s.Execute(ctx, "offboarding-create", i, bad, all); peopleStatus(e) != 403 {
			t.Fatal("identity allowed", e)
		}
	}
	if _, e := s.Execute(ctx, "offboarding-create", i, who, altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"B"}}); peopleStatus(e) != 403 {
		t.Fatal("outside department", e)
	}
	v, e := s.Execute(ctx, "offboarding-create", i, who, all)
	if e != nil {
		t.Fatal(e)
	}
	i.ID = fmt.Sprint(v.(map[string]any)["data"].(map[string]any)["id"])
	i.Payload = map[string]any{"expectedVersion": float64(1), "handoverResponsibleUid": "HR", "handoverDueAt": "2030-01-01T00:00:00Z", "assetRecoveryResponsibleUid": "AssetManager", "assetRecoveryDueAt": "2030-01-02T00:00:00Z"}
	who.Key = "arrange"
	if _, e = db.Exec("UPDATE people_employees SET employment_status='left' WHERE employee_uid='AssetManager'"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "offboarding-arrange", i, who, all); peopleStatus(e) != 409 {
		t.Fatal("inactive responsibility", e)
	}
	if _, e = db.Exec("UPDATE people_employees SET employment_status='active' WHERE employee_uid='AssetManager'"); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON assets_offboarding FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated recovery failure'"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "offboarding-arrange", i, who, all); e == nil {
		t.Fatal("fault not reached")
	}
	var count int
	var version int
	if e = db.QueryRow("SELECT COUNT(*) FROM people_offboarding_tasks").Scan(&count); e != nil || count != 0 {
		t.Fatal("partial tasks", e, count)
	}
	if e = db.QueryRow("SELECT row_version FROM people_offboarding_cases WHERE id=?", i.ID).Scan(&version); e != nil || version != 1 {
		t.Fatal("partial case", e, version)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt").Scan(&count); e != nil || count != 1 {
		t.Fatal("failed receipt committed", e, count)
	}
	if _, e = db.Exec("DROP TRIGGER reject_recovery"); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			w := who
			w.Key = fmt.Sprintf("arrange-%d", n)
			_, err := s.Execute(ctx, "offboarding-arrange", i, w, all)
			results <- err
		}(n)
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if peopleStatus(err) == 409 {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal("concurrent CAS", success, conflict)
	}
	i.Payload = map[string]any{"expectedVersion": float64(2), "taskType": "handover", "reason": "交接事项由其他正式程序处理"}
	who.Key = "cancel"
	if _, e = s.Execute(ctx, "offboarding-cancel", i, who, all); e != nil {
		t.Fatal(e)
	}
	var recoveryStatus string
	if e = db.QueryRow("SELECT status FROM assets_offboarding").Scan(&recoveryStatus); e != nil || recoveryStatus != "active" {
		t.Fatal("cancellation hid asset recovery", e, recoveryStatus)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM assets_items WHERE user_uid='leaver'").Scan(&count); e != nil || count != 1 {
		t.Fatal("People returned asset", e, count)
	}
}

func TestAPFPeopleOffboardingMySQL(t *testing.T) {
	s, db := offboardingFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "HR", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "create", RequestID: "17b-isolated"}
	all := altoc.BasicReadScope{Access: "all"}
	input := people.EnterpriseFactsInput{EmployeeUID: "leaver", Payload: map[string]any{"leaveAssignmentCode": "ASN-leave"}}
	call := func(op string) map[string]any {
		t.Helper()
		v, e := s.Execute(ctx, op, input, who, all)
		if e != nil {
			t.Fatal(op, e)
		}
		return v.(map[string]any)
	}
	out := call("offboarding-create")
	input.ID = fmt.Sprint(out["data"].(map[string]any)["id"])
	replay := input
	replay.ID = ""
	if v, e := s.Execute(ctx, "offboarding-create", replay, who, all); e != nil || v.(map[string]any)["replayed"] != true {
		t.Fatal("original create replay", e)
	}
	var tasks int
	if e := db.QueryRow("SELECT COUNT(*) FROM people_offboarding_tasks").Scan(&tasks); e != nil || tasks != 0 {
		t.Fatal("automatic responsibility/deadline", e, tasks)
	}
	input.Payload = map[string]any{"expectedVersion": float64(1), "handoverResponsibleUid": "HR", "handoverDueAt": "2030-01-01T00:00:00Z", "assetRecoveryResponsibleUid": "AssetManager", "assetRecoveryDueAt": "2030-01-02T00:00:00Z"}
	who.Key = "arrange"
	call("offboarding-arrange")
	if call("offboarding-arrange")["replayed"] != true {
		t.Fatal("arrange duplicated")
	}
	view := people.EnterpriseFactsInput{ID: input.ID, Payload: map[string]any{}}
	if _, e := s.Execute(ctx, "offboarding-view", view, Identity{Actor: "HR", Tenant: who.Tenant, Deployment: who.Deployment, Client: who.Client}, altoc.BasicReadScope{Access: "self"}); e != nil {
		t.Fatal("current responsible cannot read", e)
	}
	if _, e := s.Execute(ctx, "offboarding-view", view, Identity{Actor: "leaver", Tenant: who.Tenant, Deployment: who.Deployment, Client: who.Client}, altoc.BasicReadScope{Access: "self"}); peopleStatus(e) != 404 {
		t.Fatal("departed UID became responsible relation", e)
	}
	if _, e := s.Execute(ctx, "offboarding-arrange", input, who, altoc.BasicReadScope{Access: "none"}); peopleStatus(e) != 403 {
		t.Fatal("revoked replay", e)
	}
	changed := input
	changed.Payload = map[string]any{}
	for k, v := range input.Payload {
		changed.Payload[k] = v
	}
	changed.Payload["handoverDueAt"] = "2031-01-01T00:00:00Z"
	if _, e := s.Execute(ctx, "offboarding-arrange", changed, who, all); peopleStatus(e) != 409 {
		t.Fatal("changed-key intent", e)
	}
	input.Payload = map[string]any{"expectedVersion": float64(2), "taskType": "asset_recovery_coordination"}
	who.Key = "assets-confirm"
	if _, e := s.Execute(ctx, "offboarding-confirm", input, who, all); peopleStatus(e) != 409 {
		t.Fatal("unreturned asset confirmed", e)
	}
	var status string
	if e := db.QueryRow("SELECT status FROM people_offboarding_cases WHERE id=?", input.ID).Scan(&status); e != nil || status != "active" {
		t.Fatal("failure changed case", e, status)
	}
	// Security projection is independent of the unfinished asset task.
	if _, e := db.Exec("UPDATE people_employees SET employment_status='left',leave_date='2020-01-01' WHERE employee_uid='leaver'"); e != nil {
		t.Fatal(e)
	}
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	r, e := s.Registry.Resolve(s.request("people", enterprise.Write))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = people.FreezeEnterpriseLifecycleTx(ctx, tx, r.Table, "leaver", people.FactsContext{Actor: "HR", Tenant: who.Tenant, Deployment: who.Deployment, Client: who.Client, RequestID: who.RequestID, Key: "freeze"}); e != nil {
		tx.Rollback()
		t.Fatal(e)
	}
	if e = tx.Commit(); e != nil {
		t.Fatal(e)
	}
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM people_offboarding_cases").Scan(&count); e != nil || count != 1 {
		t.Fatal("automatic duplicated manual event", e, count)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM people_integration_operation WHERE operation_code='people.directory.offboarding-disable.v1'").Scan(&count); e != nil {
		t.Fatal(e)
	}
	// Assert a real pending Console revoke exists, without assuming legacy code spelling.
	if e = db.QueryRow("SELECT COUNT(*) FROM people_integration_operation WHERE required_capability='console:directory-offboarding:disable' AND status='pending'").Scan(&count); e != nil || count != 1 {
		t.Fatal("asset blocked security revoke", e, count)
	}
	if _, e = s.Execute(ctx, "offboarding-confirm", input, who, all); peopleStatus(e) != 409 {
		t.Fatal("effective leave bypassed outstanding assets", e)
	}
	// 17d: carry the frozen security command through delivery while Assets is
	// outstanding. Console acknowledgement and Platform reconciliation are
	// independent of completion of the HR case.
	var revokeKey string
	if e = db.QueryRow("SELECT operation_key FROM people_integration_operation WHERE required_capability='console:directory-offboarding:disable'").Scan(&revokeKey); e != nil {
		t.Fatal(e)
	}
	machine := who
	machine.Actor = ""
	claimed, err := s.Directory(ctx, "claim", PeopleDirectoryInput{OperationKey: revokeKey}, machine)
	if err != nil {
		t.Fatal("offboarding claim", err)
	}
	op, ok := claimed.(map[string]any)["operation"].(map[string]any)
	if !ok {
		t.Fatal("offboarding command not claimed", claimed)
	}
	receipt := map[string]any{"operationId": op["operationId"], "operationCode": op["operationCode"], "idempotencyKey": op["idempotencyKey"], "commandSchemaVersion": "v1", "commandSha256": op["commandSha256"], "receiptId": "7c3034e8-53ed-4a47-a813-42a8df128df2", "receiptStatus": "succeeded", "targetBizType": "directory_user", "targetBizCode": "leaver", "responseSummarySha256": strings.Repeat("a", 64), "platformStatus": "pending"}
	ack := PeopleDirectoryInput{OperationID: op["operationId"].(string), FencingToken: op["fencingToken"].(uint64), Receipt: receipt}
	for range 2 {
		if _, err = s.Directory(ctx, "ack", ack, machine); err != nil {
			t.Fatal("offboarding original receipt ACK", err)
		}
	}
	if e = db.QueryRow("SELECT status FROM people_integration_operation WHERE operation_id=?", ack.OperationID).Scan(&status); e != nil || status != "succeeded" {
		t.Fatal("Platform pending redelivered Console security command", e, status)
	}
	if e = db.QueryRow("SELECT status FROM people_offboarding_cases WHERE id=?", input.ID).Scan(&status); e != nil || status != "active" {
		t.Fatal("security ACK completed unfinished Assets case", e, status)
	}
	if _, e = db.Exec("UPDATE assets_items SET status='in_stock',user_uid=NULL WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	call("offboarding-confirm")
	if call("offboarding-confirm")["replayed"] != true {
		t.Fatal("asset confirmation replay")
	}
	input.Payload = map[string]any{"expectedVersion": float64(3), "taskType": "handover"}
	who.Key = "handover-confirm"
	call("offboarding-confirm")
	if e = db.QueryRow("SELECT status FROM people_offboarding_cases WHERE id=?", input.ID).Scan(&status); e != nil || status != "completed" {
		t.Fatal("case not completed", e, status)
	}
	input = people.EnterpriseFactsInput{ID: input.ID, Payload: map[string]any{}}
	v, e := s.Execute(ctx, "offboarding-view", input, who, all)
	if e != nil || len(v.(map[string]any)["data"].(map[string]any)["tasks"].([]map[string]any)) != 2 {
		t.Fatal("detail", e)
	}
	if _, e = db.Exec("UPDATE enterprise_schema_registry SET generation=8"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Execute(ctx, "offboarding-view", input, who, all); e == nil {
		t.Fatal("stale binding generation read allowed")
	}
}
