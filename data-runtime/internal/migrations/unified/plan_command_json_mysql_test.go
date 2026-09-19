package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

func verifyPlanCommandContracts(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	receipts := qualified(schema, "product_command_receipts")
	audits := qualified(schema, "product_activity_logs")
	plans := qualified(schema, "product_version_plans")
	confirmations := qualified(schema, "product_version_plan_confirmations")
	for _, s := range []string{
		"UPDATE " + qualified(schema, "product_versions") + " SET revision=12,scope_revision=10 WHERE id=3",
		"UPDATE " + qualified(schema, "product_workspaces") + " SET revision=20 WHERE product_code='P-001'",
		"UPDATE " + plans + " SET revision=5,scope_revision=10 WHERE version_id=3",
		"ALTER TABLE " + confirmations + " ADD confirmed_by varchar(64)",
		"INSERT INTO " + qualified(schema, "product_version_features") + " VALUES(201,3)",
		"INSERT INTO " + qualified(schema, "product_planning_items") + " VALUES(201,1,'planning-201','P-001')",
	} {
		if _, e := db.ExecContext(ctx, s); e != nil {
			t.Fatal(e)
		}
	}
	amount := productcenter.Hundredths(250)
	createInput := productcenter.LightweightVersionPlanItemCreate{VersionID: 3, ExpectedRevision: 11, ExpectedVersionRevision: 6, ExpectedPlanRevision: 3, ExpectedRequestRevision: 2, RequestBizID: "11111111-1111-1111-1111-111111111111", ScopeSummary: "deliver", EstimatePersonDays: &amount, AcceptanceCriteria: "verified", Reason: "new scope"}
	editInput := productcenter.LightweightVersionPlanItemEdit{VersionID: 3, ScopeID: 201, ExpectedRevision: 12, ExpectedVersionRevision: 7, ExpectedPlanRevision: 3, ExpectedScopeRevision: 4, ScopeSummary: "deliver", EstimatePersonDays: &amount, AcceptanceCriteria: "verified", Reason: "clarify"}
	insert := func(id int64, action string, input any, result, changes map[string]any) {
		t.Helper()
		raw, _ := json.Marshal(input)
		hash := sha256.Sum256(raw)
		out, _ := json.Marshal(result)
		change, _ := json.Marshal(changes)
		if _, e := db.ExecContext(ctx, "INSERT INTO "+receipts+" VALUES(?,'P-001',?,'pm',?,?,'succeeded',?)", id, "product_versions:"+action, "plan-key-"+stringID(id), hex.EncodeToString(hash[:]), out); e != nil {
			t.Fatal(e)
		}
		if _, e := db.ExecContext(ctx, "INSERT INTO "+audits+" (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) VALUES(?,'version','3',?,'P-001',?,'pm',?,?)", id+100, result["version_revision"], action, "plan-key-"+stringID(id), change); e != nil {
			t.Fatal(e)
		}
	}
	result := map[string]any{"version_id": 3, "workspace_revision": 11, "version_revision": 6, "plan_revision": 3, "scope_revision": 3}
	input := productcenter.LightweightVersionPlanEdit{VersionID: 3, ExpectedRevision: 10, ExpectedVersionRevision: 5, ExpectedPlanRevision: 2, Goal: "release", Reason: "adjust"}
	insert(40, "plan-edit", input, result, map[string]any{"input": input, "result": result})
	result = map[string]any{"id": 201, "planning_item_biz_id": "planning-201", "request_biz_id": createInput.RequestBizID, "workspace_revision": 12, "version_revision": 7, "plan_revision": 3, "scope_revision": 4}
	insert(41, "plan-item-create", createInput, result, map[string]any{"input": createInput, "result": result})
	result = map[string]any{"id": 201, "workspace_revision": 13, "version_revision": 8, "plan_revision": 3, "scope_revision": 5, "scope_item_revision": 2}
	insert(42, "plan-item-edit", editInput, result, map[string]any{"before": map[string]any{"scope_summary": "deliver", "estimate_person_days": amount, "acceptance_criteria": "verified", "sort_order": 0, "scope_revision": 1}, "input": editInput, "result": result})
	var frozen []byte
	if e := db.QueryRowContext(ctx, "SELECT snapshot FROM "+confirmations+" WHERE id=10").Scan(&frozen); e != nil {
		t.Fatal(e)
	}
	snapshot, e := contractObject(frozen)
	if e != nil {
		t.Fatal(e)
	}
	snapshot["version_revision"] = 8
	snapshot["plan_revision"] = 3
	snapshot["scope_revision"] = 5
	scope := snapshot["scopes"].([]any)[0].(map[string]any)
	scope["scope_id"] = 201
	scope["planning_item_biz_id"] = "planning-201"
	frozen, _ = json.Marshal(snapshot)
	if _, e = db.ExecContext(ctx, "INSERT INTO "+confirmations+" VALUES(11,3,3,5,?,NULL,'pm')", frozen); e != nil {
		t.Fatal(e)
	}
	confirmInput := productcenter.LightweightVersionPlanConfirm{VersionID: 3, ExpectedRevision: 13, ExpectedVersionRevision: 8, ExpectedPlanRevision: 3, ExpectedScopeRevision: 5}
	result = map[string]any{"confirmation_id": 11, "version_id": 3, "plan_status": "confirmed", "workspace_revision": 13, "version_revision": 8, "plan_revision": 3, "scope_revision": 5}
	insert(43, "plan-confirm", confirmInput, result, map[string]any{"input": confirmInput, "snapshot": snapshot, "result": result})
	deleteInput := productcenter.LightweightVersionPlanItemDelete{VersionID: 3, ScopeID: 201, ExpectedRevision: 15, ExpectedVersionRevision: 10, ExpectedPlanRevision: 3, ExpectedScopeRevision: 7, Reason: "remove"}
	result = map[string]any{"id": 201, "deleted": true, "workspace_revision": 16, "version_revision": 11, "plan_revision": 3, "scope_revision": 8}
	insert(44, "plan-item-delete", deleteInput, result, map[string]any{"deleted": map[string]any{"scope_id": 201, "planning_item_biz_id": "planning-201", "request_biz_id": createInput.RequestBizID, "scope_summary": "deliver", "estimate_person_days": amount, "acceptance_criteria": "verified"}, "reason": "remove", "result": result})
	check := func(want bool) {
		t.Helper()
		issues, e := inspectPlanCommandJSON(ctx, db, schema)
		if e != nil {
			t.Fatal(e)
		}
		if (len(issues) == 0) != want {
			t.Fatalf("plan legal=%v issues=%+v", want, issues)
		}
	}
	check(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_REMOVE(changes,'$.input.goal') WHERE id=140"); e != nil {
		t.Fatal(e)
	}
	check(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_SET(changes,'$.input.goal','release') WHERE id=140"); e != nil {
		t.Fatal(e)
	}
	check(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_SET(changes,'$.input.schemaVersion',2) WHERE id=140"); e != nil {
		t.Fatal(e)
	}
	check(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_REMOVE(changes,'$.input.schemaVersion') WHERE id=140"); e != nil {
		t.Fatal(e)
	}
	check(true)
	for _, s := range []string{"DELETE FROM " + qualified(schema, "product_version_features") + " WHERE id=201", "DELETE FROM " + qualified(schema, "product_planning_items") + " WHERE id=201", "UPDATE " + confirmations + " SET invalidated_at=UTC_TIMESTAMP(3) WHERE id=11"} {
		if _, e = db.ExecContext(ctx, s); e != nil {
			t.Fatal(e)
		}
	}
	check(true)
	issues, e := inspectPlanConfirmationJSON(ctx, db, schema)
	if e != nil || len(issues) > 0 {
		t.Fatalf("deleted plan confirmation rejected: %+v %v", issues, e)
	}
	if _, e = db.ExecContext(ctx, "INSERT INTO "+qualified(schema, "product_version_features")+" VALUES(201,999)"); e != nil {
		t.Fatal(e)
	}
	check(false)
	if _, e = db.ExecContext(ctx, "DELETE FROM "+qualified(schema, "product_version_features")+" WHERE id=201"); e != nil {
		t.Fatal(e)
	}
	check(true)
	if _, e = db.ExecContext(ctx, "INSERT INTO "+qualified(schema, "product_planning_items")+" VALUES(201,1,'planning-201','wrong-product')"); e != nil {
		t.Fatal(e)
	}
	check(false)
	issues, e = inspectPlanConfirmationJSON(ctx, db, schema)
	if e != nil || len(issues) == 0 {
		t.Fatalf("live conflicting planning accepted: %+v %v", issues, e)
	}
	if _, e = db.ExecContext(ctx, "DELETE FROM "+qualified(schema, "product_planning_items")+" WHERE id=201"); e != nil {
		t.Fatal(e)
	}
	check(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='other' WHERE id=144"); e != nil {
		t.Fatal(e)
	}
	check(false)
	issues, e = inspectPlanConfirmationJSON(ctx, db, schema)
	if e != nil || len(issues) == 0 {
		t.Fatalf("unproven deleted planning accepted: %+v %v", issues, e)
	}
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='pm' WHERE id=144"); e != nil {
		t.Fatal(e)
	}
	check(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_SET(changes,'$.deleted.request_biz_id','wrong') WHERE id=144"); e != nil {
		t.Fatal(e)
	}
	check(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_SET(changes,'$.deleted.request_biz_id',?) WHERE id=144", createInput.RequestBizID); e != nil {
		t.Fatal(e)
	}
	check(true)
}
