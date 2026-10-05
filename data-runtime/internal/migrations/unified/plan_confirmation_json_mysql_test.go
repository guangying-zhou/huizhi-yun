package unified

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
)

func verifyPlanConfirmationSnapshots(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	confirmation := qualified(schema, "product_version_plan_confirmations")
	for _, sql := range []string{
		"ALTER TABLE " + confirmation + " ADD snapshot JSON,ADD invalidated_at datetime(3)",
		"CREATE TABLE " + qualified(schema, "product_version_plans") + " (version_id bigint PRIMARY KEY,revision bigint,scope_revision bigint) ENGINE=InnoDB",
		"INSERT INTO " + qualified(schema, "product_version_plans") + " VALUES(3,2,3)",
		"ALTER TABLE " + qualified(schema, "product_requests") + " ADD product_code varchar(64),ADD revision bigint",
		"UPDATE " + qualified(schema, "product_requests") + " SET product_code='P-001',revision=2",
		"ALTER TABLE " + qualified(schema, "product_planning_items") + " ADD biz_id varchar(64),ADD product_code varchar(64)",
		"UPDATE " + qualified(schema, "product_planning_items") + " SET biz_id='planning-1',product_code='P-001' WHERE id=1",
	} {
		if _, err := db.ExecContext(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	scope := map[string]any{"scope_id": 101, "request_biz_id": "11111111-1111-1111-1111-111111111111", "request_revision": 2, "request_decision": "accepted", "planning_item_biz_id": "planning-1", "scope_summary": "deliver", "estimate_person_days": "2.50", "acceptance_criteria": "verified", "sort_order": 0}
	snapshot := map[string]any{"version": 1, "version_id": 3, "version_revision": 5, "business_owner_uid": "pm", "goal": "release", "starts_on": "2026-09-01", "planned_release_date": "2026-10-01", "available_person_days": "10.00", "reserve_person_days": "1.00", "plan_revision": 2, "scope_revision": 3, "summary": map[string]any{"selected_count": 1, "estimated_person_days": "2.50", "unknown_estimate_count": 0, "remaining_person_days": "6.50", "issues": []any{}}, "scopes": []any{scope}}
	raw, _ := json.Marshal(snapshot)
	if _, e := db.ExecContext(ctx, "INSERT INTO "+confirmation+" VALUES(10,3,2,3,?,NULL)", raw); e != nil {
		t.Fatal(e)
	}
	check := func(want string) {
		t.Helper()
		issues, e := inspectPlanConfirmationJSON(ctx, db, schema)
		if e != nil {
			t.Fatal(e)
		}
		if want == "" && len(issues) > 0 {
			t.Fatalf("valid plan rejected: %+v", issues)
		}
		found := false
		for _, issue := range issues {
			found = found || issue.Kind == want
		}
		if want != "" && !found {
			t.Fatalf("missing %s: %+v", want, issues)
		}
	}
	write := func() {
		t.Helper()
		raw, _ := json.Marshal(snapshot)
		if _, e := db.ExecContext(ctx, "UPDATE "+confirmation+" SET snapshot=? WHERE id=10", raw); e != nil {
			t.Fatal(e)
		}
	}
	check("")
	snapshot["version"] = 2
	write()
	check("plan_confirmation_snapshot_contract_invalid")
	snapshot["version"] = 1
	write()
	check("")
	scope["request_revision"] = 3
	write()
	check("plan_confirmation_snapshot_contract_invalid")
	scope["request_revision"] = 2
	write()
	check("")
	scope["planning_item_biz_id"] = "missing"
	write()
	check("plan_confirmation_snapshot_contract_invalid")
	scope["planning_item_biz_id"] = "planning-1"
	write()
	check("")
	snapshot["summary"].(map[string]any)["remaining_person_days"] = "7.50"
	write()
	check("plan_confirmation_snapshot_contract_invalid")
	snapshot["summary"].(map[string]any)["remaining_person_days"] = "6.50"
	write()
	check("")
	if _, e := db.ExecContext(ctx, "DELETE FROM "+qualified(schema, "product_version_features")+" WHERE id=101"); e != nil {
		t.Fatal(e)
	}
	check("plan_confirmation_snapshot_contract_invalid")
	if _, e := db.ExecContext(ctx, "UPDATE "+confirmation+" SET invalidated_at=UTC_TIMESTAMP(3) WHERE id=10"); e != nil {
		t.Fatal(e)
	}
	check("plan_confirmation_snapshot_contract_invalid")
	if _, e := db.ExecContext(ctx, "INSERT INTO "+qualified(schema, "product_version_features")+" VALUES(101,3)"); e != nil {
		t.Fatal(e)
	}
	check("")
}
