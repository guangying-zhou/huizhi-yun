package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

func verifyScopeCommandContracts(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	receipts := qualified(schema, "product_command_receipts")
	audits := qualified(schema, "product_activity_logs")
	itemBiz := "33333333-3333-4333-8333-333333333333"
	cycleBiz := "44444444-4444-4444-8444-444444444444"
	for _, s := range []string{
		"INSERT INTO " + qualified(schema, "product_versions") + " VALUES(44,3,3,'P-001','cycle-v44')",
		"INSERT INTO " + qualified(schema, "product_version_features") + " VALUES(301,44)",
		"INSERT INTO " + qualified(schema, "product_planning_items") + " VALUES(301,3,'" + itemBiz + "','P-001')",
		"CREATE TABLE " + qualified(schema, "product_planning_cycles") + " (id bigint PRIMARY KEY,biz_id varchar(64),product_code varchar(64),revision bigint,queue_revision bigint) ENGINE=InnoDB",
		"INSERT INTO " + qualified(schema, "product_planning_cycles") + " VALUES(1,'" + cycleBiz + "','P-001',2,2)",
		"CREATE TABLE " + qualified(schema, "product_priority_assessments") + " (id bigint PRIMARY KEY,planning_item_id bigint,cycle_id bigint,scope_revision bigint,evidence_revision bigint,model_version varchar(64)) ENGINE=InnoDB",
		"INSERT INTO " + qualified(schema, "product_priority_assessments") + " VALUES(1,301,1,1,1,'weighted.v1')",
	} {
		if _, e := db.ExecContext(ctx, s); e != nil {
			t.Fatal(e)
		}
	}
	insert := func(id int64, action string, input any, result, changes map[string]any) {
		t.Helper()
		raw, _ := json.Marshal(input)
		hash := sha256.Sum256(raw)
		out, _ := json.Marshal(result)
		change, _ := json.Marshal(changes)
		if _, e := db.ExecContext(ctx, "INSERT INTO "+receipts+" VALUES(?,'P-001',?,'pm',?,?,'succeeded',?)", id, "product_versions:"+action, "scope-key-"+stringID(id), hex.EncodeToString(hash[:]), out); e != nil {
			t.Fatal(e)
		}
		if _, e := db.ExecContext(ctx, "INSERT INTO "+audits+" (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) VALUES(?,'version',?,?,'P-001',?,'pm',?,?)", id+200, stringID(int64(result["version_id"].(int))), result["revision"], action, "scope-key-"+stringID(id), change); e != nil {
			t.Fatal(e)
		}
	}
	check := productcenter.PlanningDeliveryCheck{ItemBizID: itemBiz, CycleBizID: cycleBiz, ExpectedRevision: 16, ExpectedItemRevision: 1, ExpectedCycleRevision: 1, ExpectedQueueRevision: 1}
	input := productcenter.ProductVersionScopeDraft{PlanningDeliveryCheck: check, VersionID: 44, ExpectedVersionRevision: 1, Title: "cycle scope", AcceptanceCriteria: "verified", ChangeType: "new", Reason: "arrange"}
	basis := map[string]any{"item_id": 301, "item_biz_id": itemBiz, "cycle_biz_id": cycleBiz, "scope_revision": 1, "evidence_revision": 1, "decision": map[string]any{"capacity": map[string]any{"version": 1, "item_biz_id": itemBiz, "investment_category": "growth", "effort_person_days": "2.50"}, "assessment_id": 1, "scope_revision": 1, "evidence_revision": 1, "model_version": "weighted.v1", "exceptions": []any{}}}
	result := map[string]any{"id": 301, "version_id": 44, "product_code": "P-001", "planning_item_biz_id": itemBiz, "status": "planned", "revision": 2, "scope_revision": 2, "workspace_revision": 17, "item_revision": 2}
	insert(60, "scope-create", input, result, map[string]any{"after": result, "input": input, "decision_basis": basis})
	input.ExpectedRevision = 17
	input.ExpectedItemRevision = 2
	input.ExpectedVersionRevision = 2
	input.Title = "edited"
	edit := productcenter.ProductVersionScopeEdit{ProductVersionScopeDraft: input, ScopeID: 301}
	result = map[string]any{"id": 301, "version_id": 44, "product_code": "P-001", "revision": 3, "scope_revision": 3, "workspace_revision": 18, "item_revision": 3}
	insert(61, "scope-edit", edit, result, map[string]any{"before": map[string]any{"title": "cycle scope", "description": nil, "acceptance_criteria": "verified", "change_type": "new", "status": "planned"}, "after": edit, "result": result, "decision_basis": basis})
	delivery := productcenter.ProductVersionScopeDelivery{VersionID: 3, ScopeID: 201, ExpectedRevision: 13, ExpectedVersionRevision: 8, ExpectedScopeRevision: 5, Evidence: "verified", Reason: "accept"}
	result = map[string]any{"id": 201, "version_id": 3, "product_code": "P-001", "status": "delivered", "revision": 9, "scope_revision": 6, "workspace_revision": 14}
	insert(62, "scope-deliver", delivery, result, map[string]any{"before": map[string]any{"id": 201, "title": "simple scope", "description": nil, "acceptance_criteria": "verified", "status": "planned"}, "after": result, "evidence": delivery.Evidence, "reason": delivery.Reason, "accepted_scope_revision": 5})
	reopen := productcenter.ProductVersionScopeReopen{VersionID: 3, ScopeID: 201, ExpectedRevision: 14, ExpectedVersionRevision: 9, ExpectedScopeRevision: 6, Reason: "revise"}
	result = map[string]any{"id": 201, "version_id": 3, "product_code": "P-001", "status": "planned", "revision": 10, "scope_revision": 7, "workspace_revision": 15}
	insert(63, "scope-reopen", reopen, result, map[string]any{"before": map[string]any{"id": 201, "title": "simple scope", "description": nil, "acceptance_criteria": "verified", "status": "delivered"}, "after": result, "reason": reopen.Reason, "withdrawn_scope_revision": 6})
	assert := func(want bool) {
		t.Helper()
		issues, e := inspectScopeCommandJSON(ctx, db, schema)
		if e != nil {
			t.Fatal(e)
		}
		if (len(issues) == 0) != want {
			t.Fatalf("scope legal=%v issues=%+v", want, issues)
		}
	}
	assert(true)
	for _, s := range []string{"INSERT INTO " + qualified(schema, "product_versions") + " VALUES(905,2,2,'P-001','source-v905')", "INSERT INTO " + qualified(schema, "product_version_features") + " VALUES(903,905)"} {
		if _, e := db.ExecContext(ctx, s); e != nil {
			t.Fatal(e)
		}
	}
	var originalChange []byte
	var originalHash string
	if e := db.QueryRowContext(ctx, "SELECT changes FROM "+audits+" WHERE id=260").Scan(&originalChange); e != nil {
		t.Fatal(e)
	}
	if e := db.QueryRowContext(ctx, "SELECT request_hash FROM "+receipts+" WHERE id=60").Scan(&originalHash); e != nil {
		t.Fatal(e)
	}
	deferredInput := productcenter.ProductVersionScopeDraft{PlanningDeliveryCheck: check, VersionID: 44, ExpectedVersionRevision: 1, Title: "cycle scope", AcceptanceCriteria: "verified", ChangeType: "new", Reason: "arrange", DeferredFrom: &productcenter.ProductVersionScopeDeferralSource{VersionID: 905, ScopeID: 903, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1}}
	deferredRaw, _ := json.Marshal(deferredInput)
	deferredHash := sha256.Sum256(deferredRaw)
	deferredChange, _ := contractObject(originalChange)
	var deferredMap any
	decoder := json.NewDecoder(strings.NewReader(string(deferredRaw)))
	decoder.UseNumber()
	if e := decoder.Decode(&deferredMap); e != nil {
		t.Fatal(e)
	}
	deferredChange["input"] = deferredMap
	deferredEncoded, _ := json.Marshal(deferredChange)
	if _, e := db.ExecContext(ctx, "UPDATE "+audits+" SET changes=? WHERE id=260", deferredEncoded); e != nil {
		t.Fatal(e)
	}
	if _, e := db.ExecContext(ctx, "UPDATE "+receipts+" SET request_hash=? WHERE id=60", hex.EncodeToString(deferredHash[:])); e != nil {
		t.Fatal(e)
	}
	if _, e := db.ExecContext(ctx, "INSERT INTO "+audits+" (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) VALUES(264,'version','905',2,'P-001','scope-defer','pm','scope-key-60',?)", deferredEncoded); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e := db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_version_features")+" SET version_id=999 WHERE id=903"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e := db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_version_features")+" SET version_id=905 WHERE id=903"); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e := db.ExecContext(ctx, "DELETE FROM "+audits+" WHERE id=264"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e := db.ExecContext(ctx, "UPDATE "+audits+" SET changes=? WHERE id=260", originalChange); e != nil {
		t.Fatal(e)
	}
	if _, e := db.ExecContext(ctx, "UPDATE "+receipts+" SET request_hash=? WHERE id=60", originalHash); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e := db.ExecContext(ctx, "UPDATE "+receipts+" SET request_hash=REPEAT('b',64) WHERE id=60"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	raw, _ := json.Marshal(productcenter.ProductVersionScopeDraft{PlanningDeliveryCheck: check, VersionID: 44, ExpectedVersionRevision: 1, Title: "cycle scope", AcceptanceCriteria: "verified", ChangeType: "new", Reason: "arrange"})
	hash := sha256.Sum256(raw)
	if _, e := db.ExecContext(ctx, "UPDATE "+receipts+" SET request_hash=? WHERE id=60", hex.EncodeToString(hash[:])); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e := db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_SET(changes,'$.decision_basis.decision.capacity.version',2) WHERE id=260"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e := db.ExecContext(ctx, "UPDATE "+audits+" SET changes=JSON_SET(changes,'$.decision_basis.decision.capacity.version',1) WHERE id=260"); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e := db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_priority_assessments")+" SET planning_item_id=999 WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e := db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_priority_assessments")+" SET planning_item_id=301 WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e := db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='other' WHERE id=144"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e := db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='pm' WHERE id=144"); e != nil {
		t.Fatal(e)
	}
	assert(true)
}
