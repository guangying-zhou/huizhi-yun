package enterpriseapf

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
)

func TestAPFPeopleProvisioningC2MySQL(t *testing.T) {
	s, db := factsFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "HR", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test", RequestID: "c2-isolated"}
	scope := altoc.BasicReadScope{Access: "all"}
	call := func(op, id, key string, version int64, extra map[string]any) (map[string]any, error) {
		p := map[string]any{"expectedVersion": float64(version)}
		for k, v := range extra {
			p[k] = v
		}
		w := who
		w.Key = key
		out, e := s.Execute(ctx, op, people.EnterpriseFactsInput{ID: id, Payload: p}, w, scope)
		if e != nil {
			return nil, e
		}
		return out.(map[string]any)["data"].(map[string]any), nil
	}
	insert := func(provider, uid, date string) string {
		t.Helper()
		res, e := db.Exec("INSERT INTO people_onboarding_cases(onboarding_code,provider_code,provider_subject,candidate_name,status,employee_no,canonical_uid,corporate_email,dept_code,position_code,rank_code,planned_onboard_date,employment_type,created_by,updated_by) VALUES(?,?,?,'候选甲','awaiting_profile',?,?,?,'A','DEV','P1',?,'full_time','HR','HR')", "ONB-"+uid, provider, "subject-"+uid, "NO-"+uid, uid, uid+"@example.test", date)
		if e != nil {
			t.Fatal(e)
		}
		id, e := res.LastInsertId()
		if e != nil {
			t.Fatal(e)
		}
		return fmt.Sprint(id)
	}
	manual := insert("manual", "manual-employee", "2026-01-01")
	for op := range people.ProvisioningOperations {
		if _, e := call(op, manual, "manual-"+op, 1, nil); e == nil {
			t.Fatal("manual candidate permitted", op)
		}
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM people_integration_operation").Scan(&n)
	if n != 0 {
		t.Fatal("manual command leaked", n)
	}
	id := insert("dingtalk", "candidate-employee", "2026-01-01")
	must := func(op, key string, v int64, extra map[string]any) map[string]any {
		t.Helper()
		out, e := call(op, id, key, v, extra)
		if e != nil {
			t.Fatal(op, e)
		}
		return out
	}
	must("onboarding-begin-provisioning", "begin", 1, nil)
	must("onboarding-begin-provisioning", "begin", 1, nil) // immutable intent replay
	if _, e := call("onboarding-begin-provisioning", id, "new-key", 1, nil); e == nil {
		t.Fatal("stale version accepted")
	}
	reserve := must("onboarding-prepare-reserve", "reserve", 2, nil)["frozen"].(map[string]any)
	must("onboarding-prepare-reserve", "reserve", 2, nil)
	confirmation := map[string]any{"uid": "candidate-employee", "reservationId": "reservation-1"}
	if _, e := call("onboarding-reserved", id, "wrong-confirm", 2, map[string]any{"operationKey": reserve["operationKey"], "confirmation": map[string]any{"uid": "foreign", "reservationId": "reservation-1"}}); e == nil {
		t.Fatal("foreign UID confirmed")
	}
	must("onboarding-reserved", "reserved", 2, map[string]any{"operationKey": reserve["operationKey"], "confirmation": confirmation})
	provision := must("onboarding-prepare-provision", "provision", 3, nil)["frozen"].(map[string]any)
	must("onboarding-provisioning", "provisioned", 3, map[string]any{"operationKey": provision["operationKey"], "confirmation": map[string]any{"uid": "candidate-employee", "operationId": "connector-operation-1"}})
	status := must("onboarding-prepare-status", "status", 4, nil)["frozen"].(map[string]any)
	if _, e := call("onboarding-activate", id, "pending", 4, map[string]any{"operationKey": status["operationKey"], "confirmation": map[string]any{"uid": "candidate-employee", "operationId": "connector-operation-1", "status": "pending"}}); e == nil {
		t.Fatal("pending target activated")
	}
	activated := must("onboarding-activate", "activate", 4, map[string]any{"operationKey": status["operationKey"], "confirmation": map[string]any{"uid": "candidate-employee", "operationId": "connector-operation-1", "status": "succeeded"}})
	if activated["status"] != "activating_employee" {
		t.Fatal(activated)
	}
	must("onboarding-activate", "activate", 4, map[string]any{"operationKey": status["operationKey"], "confirmation": map[string]any{"uid": "candidate-employee", "operationId": "connector-operation-1", "status": "succeeded"}})
	db.QueryRow("SELECT COUNT(*) FROM people_employees WHERE employee_uid='candidate-employee'").Scan(&n)
	if n != 1 {
		t.Fatal("duplicate employee", n)
	}
	// Target success + Platform pending is not completed. Both facts are required.
	status2 := must("onboarding-prepare-status", "status2", 5, nil)["frozen"].(map[string]any)
	projected := must("onboarding-aggregate-status", "aggregate", 5, map[string]any{"operationKey": status2["operationKey"], "confirmation": map[string]any{"uid": "candidate-employee", "operationId": "connector-operation-1", "status": "succeeded", "directoryApplied": true, "platformStatus": "pending"}})
	if projected["status"] != "projecting_authorization" {
		t.Fatal(projected)
	}
	status3 := must("onboarding-prepare-status", "status3", 6, nil)["frozen"].(map[string]any)
	completed := must("onboarding-aggregate-status", "complete", 6, map[string]any{"operationKey": status3["operationKey"], "confirmation": map[string]any{"uid": "candidate-employee", "operationId": "connector-operation-1", "status": "succeeded", "directoryApplied": true, "platformStatus": "succeeded"}})
	if completed["status"] != "completed" {
		t.Fatal(completed)
	}
	// Current scope is checked again before an old immutable receipt is loaded.
	w := who
	w.Key = "begin"
	_, e := s.Execute(ctx, "onboarding-begin-provisioning", people.EnterpriseFactsInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1)}}, w, altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"B"}})
	if e == nil {
		t.Fatal("revoked scope replayed")
	}
	// Outer mutation failure must not leave employee, assignment or lifecycle row.
	futureID := insert("dingtalk", "future-employee", time.Now().UTC().AddDate(0, 0, 10).Format("2006-01-02"))
	_, e = call("onboarding-begin-provisioning", futureID, "future-begin", 1, nil)
	if e != nil {
		t.Fatal(e)
	}
	// Separate test covers a rollback of a caller-owned activation transaction.
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		t.Fatal(e)
	}
	table := func(name string) (string, error) { return "`" + s.Binding.Domains["people"].Tables[name] + "`", nil }
	_, e = people.ProvisioningWriteTx(ctx, tx, table, "onboarding-prepare-reserve", people.EnterpriseFactsInput{ID: futureID, Payload: map[string]any{"expectedVersion": float64(2)}}, people.FactsContext{Tenant: who.Tenant, Deployment: who.Deployment, Actor: who.Actor, Client: who.Client, Key: "rollback", AsOf: time.Now().UTC()})
	if e != nil {
		tx.Rollback()
		t.Fatal(e)
	}
	tx.Rollback()
	db.QueryRow("SELECT COUNT(*) FROM people_integration_operation WHERE operation_key=?", people.OnboardingFrozenKey(people.FactsContext{Tenant: who.Tenant, Deployment: who.Deployment, Actor: who.Actor, Key: "rollback"}, "onboarding-prepare-reserve")).Scan(&n)
	if n != 0 {
		t.Fatal("frozen command survived rollback")
	}
	// A future approved primary remains inactive and does not freeze a lifecycle
	// projection before its date, even if account provisioning already succeeded.
	id = futureID
	fr := must("onboarding-prepare-reserve", "future-reserve", 2, nil)["frozen"].(map[string]any)
	must("onboarding-reserved", "future-reserved", 2, map[string]any{"operationKey": fr["operationKey"], "confirmation": map[string]any{"uid": "future-employee", "reservationId": "future-reservation"}})
	fp := must("onboarding-prepare-provision", "future-provision", 3, nil)["frozen"].(map[string]any)
	must("onboarding-provisioning", "future-provisioned", 3, map[string]any{"operationKey": fp["operationKey"], "confirmation": map[string]any{"uid": "future-employee", "operationId": "future-connector"}})
	fs := must("onboarding-prepare-status", "future-status", 4, nil)["frozen"].(map[string]any)
	must("onboarding-activate", "future-activate", 4, map[string]any{"operationKey": fs["operationKey"], "confirmation": map[string]any{"uid": "future-employee", "operationId": "future-connector", "status": "succeeded"}})
	var employment string
	if e := db.QueryRow("SELECT employment_status FROM people_employees WHERE employee_uid='future-employee'").Scan(&employment); e != nil || employment != "inactive" {
		t.Fatal("future employee projected early", employment, e)
	}
	if e := db.QueryRow("SELECT COUNT(*) FROM people_integration_operation WHERE source_biz_type='employee' AND source_biz_code='future-employee'").Scan(&n); e != nil || n != 0 {
		t.Fatal("future lifecycle frozen early", n, e)
	}
	if _, e := call("onboarding-prepare-release", id, "future-forbidden-release", 5, nil); e == nil {
		t.Fatal("provisioned account released through cancellation")
	}
	cancelID := insert("dingtalk", "cancelled-employee", "2026-01-01")
	if _, e := call("onboarding-cancel", cancelID, "cancel", 1, map[string]any{"reason": "候选确认取消尚未预留的身份"}); e != nil {
		t.Fatal(e)
	}
	if _, e := call("onboarding-cancel", cancelID, "cancel", 1, map[string]any{"reason": "候选确认取消尚未预留的身份"}); e != nil {
		t.Fatal("cancel replay", e)
	}
	var cancelledBy string
	if e := db.QueryRow("SELECT cancelled_by FROM people_onboarding_cases WHERE id=? AND status='cancelled'", cancelID).Scan(&cancelledBy); e != nil || cancelledBy != who.Actor {
		t.Fatal("cancellation audit missing", e)
	}
}
