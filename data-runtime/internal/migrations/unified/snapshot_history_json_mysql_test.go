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

func verifyFrozenAcceptanceHistory(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	accepted := qualified(schema, "product_version_acceptances")
	release := qualified(schema, "product_release_records")
	audits := qualified(schema, "product_activity_logs")
	if _, e := db.ExecContext(ctx, "CREATE TABLE "+qualified(schema, "work_items")+" (id bigint PRIMARY KEY,project_id bigint) ENGINE=InnoDB"); e != nil {
		t.Fatal(e)
	}
	if _, e := db.ExecContext(ctx, "INSERT INTO "+qualified(schema, "work_items")+" VALUES(501,10)"); e != nil {
		t.Fatal(e)
	}
	var raw, scopeRaw, acceptanceRaw []byte
	if e := db.QueryRowContext(ctx, "SELECT checklist FROM "+accepted+" WHERE id=100").Scan(&raw); e != nil {
		t.Fatal(e)
	}
	checklist, e := contractObject(raw)
	if e != nil {
		t.Fatal(e)
	}
	version, feature := int64(3), int64(101)
	execution := executionContractSnapshot{Targets: []executionContractItem{{ItemKey: "TARGET-501", Title: "verified execution", VersionID: &version, FeatureID: &feature, ContentHash: strings.Repeat("a", 64), ID: 501, ProjectID: 10, Status: "completed", Weight: 100, Priority: "P2"}}, OpenDefects: []executionContractItem{}, TotalWeight: 100, CompletedWeight: 100, DefectCoverage: "linked-descendants-only"}
	encoded, _ := json.Marshal(execution)
	hash := sha256.Sum256(encoded)
	execution.ContentHash = hex.EncodeToString(hash[:])
	checklist["execution_snapshot"] = execution
	raw, _ = json.Marshal(checklist)
	if _, e = db.ExecContext(ctx, "UPDATE "+accepted+" SET checklist=? WHERE id=100", raw); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRowContext(ctx, "SELECT scope_snapshot,acceptance_snapshot FROM "+release+" WHERE id=50").Scan(&scopeRaw, &acceptanceRaw); e != nil {
		t.Fatal(e)
	}
	scope, _ := contractObject(scopeRaw)
	acceptance, _ := contractObject(acceptanceRaw)
	scope["execution"] = execution
	acceptance["checklist"] = checklist
	scopeRaw, _ = json.Marshal(scope)
	acceptanceRaw, _ = json.Marshal(acceptance)
	contentHash, e := releaseSnapshotHash(scopeRaw, acceptanceRaw)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.ExecContext(ctx, "UPDATE "+release+" SET scope_snapshot=?,acceptance_snapshot=?,content_hash=? WHERE id=50", scopeRaw, acceptanceRaw, contentHash); e != nil {
		t.Fatal(e)
	}
	assert := func(want bool) {
		t.Helper()
		issues, e := inspectAcceptanceReleaseSnapshots(ctx, db, schema)
		if e != nil {
			t.Fatal(e)
		}
		if (len(issues) == 0) != want {
			t.Fatalf("frozen acceptance legal=%v issues=%+v", want, issues)
		}
	}
	assert(true)
	writeExecution := func() {
		t.Helper()
		execution.ContentHash = ""
		encoded, _ := json.Marshal(execution)
		sum := sha256.Sum256(encoded)
		execution.ContentHash = hex.EncodeToString(sum[:])
		checklist["execution_snapshot"] = execution
		scope["execution"] = execution
		acceptance["checklist"] = checklist
		checkRaw, _ := json.Marshal(checklist)
		scopeRaw, _ := json.Marshal(scope)
		acceptanceRaw, _ := json.Marshal(acceptance)
		sumHash, e := releaseSnapshotHash(scopeRaw, acceptanceRaw)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, "UPDATE "+accepted+" SET checklist=? WHERE id=100", checkRaw); e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, "UPDATE "+release+" SET scope_snapshot=?,acceptance_snapshot=?,content_hash=? WHERE id=50", scopeRaw, acceptanceRaw, sumHash); e != nil {
			t.Fatal(e)
		}
	}
	version = 2
	writeExecution()
	assert(false)
	version = 3
	writeExecution()
	assert(true)
	feature = 999
	writeExecution()
	assert(false)
	feature = 101
	writeExecution()
	assert(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+qualified(schema, "work_items")+" SET project_id=999 WHERE id=501"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e = db.ExecContext(ctx, "DELETE FROM "+qualified(schema, "work_items")+" WHERE id=501"); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='other' WHERE id=30"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='pm' WHERE id=30"); e != nil {
		t.Fatal(e)
	}
	assert(true)
	// A removed scope requires the later owning delete receipt and its frozen
	// identities; acceptance evidence alone does not permit an arbitrary hole.
	if _, e = db.ExecContext(ctx, "DELETE FROM "+qualified(schema, "product_version_features")+" WHERE id=101"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	deleteInput := productcenter.LightweightVersionPlanItemDelete{VersionID: 3, ScopeID: 101, ExpectedRevision: 18, ExpectedVersionRevision: 11, ExpectedPlanRevision: 5, ExpectedScopeRevision: 9, Reason: "remove old scope"}
	payload, _ := json.Marshal(deleteInput)
	fingerprint := sha256.Sum256(payload)
	result := map[string]any{"id": 101, "deleted": true, "workspace_revision": 19, "version_revision": 12, "plan_revision": 5, "scope_revision": 10}
	changes := map[string]any{"deleted": map[string]any{"scope_id": 101, "planning_item_biz_id": "planning-1", "request_biz_id": "11111111-1111-1111-1111-111111111111", "scope_summary": "legacy scope", "estimate_person_days": nil, "acceptance_criteria": "verified"}, "reason": deleteInput.Reason, "result": result}
	out, _ := json.Marshal(result)
	change, _ := json.Marshal(changes)
	if _, e = db.ExecContext(ctx, "INSERT INTO "+qualified(schema, "product_command_receipts")+" VALUES(80,'P-001','product_versions:plan-item-delete','pm','delete-101',?,'succeeded',?)", hex.EncodeToString(fingerprint[:]), out); e != nil {
		t.Fatal(e)
	}
	if _, e = db.ExecContext(ctx, "INSERT INTO "+audits+" (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) VALUES(380,'version','3',12,'P-001','plan-item-delete','pm','delete-101',?)", change); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='other' WHERE id=380"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+audits+" SET actor_uid='pm' WHERE id=380"); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_versions")+" SET revision=11 WHERE id=3"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_versions")+" SET revision=12 WHERE id=3"); e != nil {
		t.Fatal(e)
	}
	assert(true)
	if _, e = db.ExecContext(ctx, "INSERT INTO "+qualified(schema, "product_version_features")+" VALUES(101,999)"); e != nil {
		t.Fatal(e)
	}
	assert(false)
	if _, e = db.ExecContext(ctx, "ALTER TABLE "+release+" DROP COLUMN acceptance_snapshot"); e != nil {
		t.Fatal(e)
	}
	issues, e := inspectUnregisteredJSON(ctx, db, []Table{{Domain: "aims", Source: schema, Name: "product_release_records"}})
	if e != nil || len(issues) == 0 {
		t.Fatalf("partial release schema bypassed JSON gate: %+v %v", issues, e)
	}
}
