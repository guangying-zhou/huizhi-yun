package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func verifyAcceptancePublishSnapshots(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	r := qualified(schema, "product_command_receipts")
	a := qualified(schema, "product_activity_logs")
	release := qualified(schema, "product_release_records")
	accepted := qualified(schema, "product_version_acceptances")
	for _, query := range []string{
		"CREATE TABLE " + accepted + " (id bigint PRIMARY KEY,version_id bigint,scope_revision bigint,accepted_by varchar(64),checklist JSON,exceptions JSON) ENGINE=InnoDB",
		"ALTER TABLE " + release + " ADD biz_id varchar(36),ADD scope_revision bigint,ADD content_hash char(64),ADD scope_snapshot JSON,ADD acceptance_snapshot JSON",
		"CREATE TABLE " + qualified(schema, "product_version_features") + " (id bigint PRIMARY KEY,version_id bigint) ENGINE=InnoDB",
		"INSERT INTO " + qualified(schema, "product_version_features") + " VALUES (101,3)",
	} {
		if _, e := db.ExecContext(ctx, query); e != nil {
			t.Fatal(e)
		}
	}
	execution := executionContractSnapshot{Targets: []executionContractItem{}, OpenDefects: []executionContractItem{}, NoExecutionPlan: true, DefectCoverage: "linked-descendants-only"}
	encoded, _ := json.Marshal(execution)
	digest := sha256.Sum256(encoded)
	execution.ContentHash = hex.EncodeToString(digest[:])
	reviewed := map[string]any{"planning_mode": "cycle", "id": 3, "product_code": "P-001", "version_code": "v3", "name": nil, "description": nil, "status": "developing", "planned_release_date": nil, "owner_project_id": nil, "revision": 3, "scope_revision": 3, "current_release_record_id": nil}
	scopes := []any{map[string]any{"category": nil, "is_public": true, "sort_order": 0, "deferred_from_feature_id": nil, "id": 101, "title": "legacy scope", "description": nil, "status": "delivered", "acceptance_criteria": nil, "product_feature_biz_id": nil, "planning_item_biz_id": nil, "change_type": nil, "legacy_unscored": true}}
	checklist := map[string]any{"version": 1, "review_mode": "manual", "reviewed_version": reviewed, "scope_snapshot": scopes, "execution_snapshot": execution, "checks": []any{map[string]any{"code": "execution-review", "evidence": "reviewed"}, map[string]any{"code": "blocking-defects-review", "evidence": "reviewed"}, map[string]any{"code": "release-readiness", "evidence": "reviewed"}}}
	exceptions := []any{map[string]any{"code": "no-execution-plan", "reason": "manual verification", "responsible_uid": "pm", "impact": "internal release"}}
	checkRaw, _ := json.Marshal(checklist)
	exceptionsRaw, _ := json.Marshal(exceptions)
	if _, e := db.ExecContext(ctx, "INSERT INTO "+accepted+" VALUES (100,3,3,'pm',?,?)", checkRaw, exceptionsRaw); e != nil {
		t.Fatal(e)
	}
	scope := map[string]any{"version": 1, "reviewed_version": reviewed, "scopes": scopes, "features": []any{}, "execution": execution}
	acceptance := map[string]any{"acceptance_id": 100, "accepted_by": "pm", "accepted_at": "2026-09-15T00:00:00Z", "checklist": checklist, "exceptions": exceptions}
	scopeRaw, _ := json.Marshal(scope)
	acceptanceRaw, _ := json.Marshal(acceptance)
	hash, e := releaseSnapshotHash(scopeRaw, acceptanceRaw)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.ExecContext(ctx, "INSERT INTO "+release+" (id,version_id,biz_id,scope_revision,content_hash,scope_snapshot,acceptance_snapshot) VALUES (50,3,'release-50',3,?,?,?)", hash, scopeRaw, acceptanceRaw); e != nil {
		t.Fatal(e)
	}
	for _, query := range []string{
		"INSERT INTO " + r + " VALUES (20,'P-001','product_versions:accept','pm','accept-100',REPEAT('a',64),'succeeded',JSON_OBJECT('acceptance_id',100,'version_id',3,'product_code','P-001','accepted_by','pm','scope_revision',3,'revision',4,'workspace_revision',9))",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 30,'version','3',4,product_code,'accept',actor_uid,idempotency_key,result_json FROM " + r + " WHERE id=20",
		"UPDATE " + qualified(schema, "product_versions") + " SET revision=5 WHERE id=3",
		"INSERT INTO " + r + " VALUES (21,'P-001','product_versions:publish','pm','publish-50',REPEAT('a',64),'succeeded',JSON_OBJECT('release_record_id',50,'release_biz_id','release-50','version_id',3,'product_code','P-001','status','released','content_hash','" + hash + "','revision',5,'workspace_revision',10))",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 31,'version','3',5,product_code,'publish',actor_uid,idempotency_key,JSON_OBJECT('result',result_json,'reason','publish verified','acceptance_id',100) FROM " + r + " WHERE id=21",
	} {
		if _, e = db.ExecContext(ctx, query); e != nil {
			t.Fatal(e)
		}
	}
	assertSnapshots := func(want bool) {
		t.Helper()
		issues, e := inspectAcceptanceReleaseSnapshots(ctx, db, schema)
		if e != nil {
			t.Fatal(e)
		}
		if (len(issues) > 0) != want {
			t.Fatalf("snapshot blocking=%v want=%v %+v", len(issues) > 0, want, issues)
		}
	}
	assertSnapshots(false)
	receipts, e := inspectAcceptPublishReceipts(ctx, db, schema)
	if e != nil || len(receipts) != 0 {
		t.Fatalf("legal accept/publish result/audit blocked: %+v %v", receipts, e)
	}
	if _, e = db.ExecContext(ctx, "UPDATE "+release+" SET content_hash=REPEAT('f',64) WHERE id=50"); e != nil {
		t.Fatal(e)
	}
	assertSnapshots(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+release+" SET content_hash=? WHERE id=50", hash); e != nil {
		t.Fatal(e)
	}
	assertSnapshots(false)
	scope["version"] = 2
	badScope, _ := json.Marshal(scope)
	badHash, _ := releaseSnapshotHash(badScope, acceptanceRaw)
	if _, e = db.ExecContext(ctx, "UPDATE "+release+" SET scope_snapshot=?,content_hash=? WHERE id=50", badScope, badHash); e != nil {
		t.Fatal(e)
	}
	assertSnapshots(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+release+" SET scope_snapshot=?,content_hash=? WHERE id=50", scopeRaw, hash); e != nil {
		t.Fatal(e)
	}
	assertSnapshots(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_version_features")+" SET version_id=99 WHERE id=101"); e != nil {
		t.Fatal(e)
	}
	assertSnapshots(true)
	if _, e = db.ExecContext(ctx, "UPDATE "+qualified(schema, "product_version_features")+" SET version_id=3 WHERE id=101"); e != nil {
		t.Fatal(e)
	}
	assertSnapshots(false)
	if _, e = db.ExecContext(ctx, "UPDATE "+a+" SET actor_uid='wrong-actor' WHERE id=31"); e != nil {
		t.Fatal(e)
	}
	receipts, e = inspectAcceptPublishReceipts(ctx, db, schema)
	if e != nil || len(receipts) == 0 {
		t.Fatal("corrupted publish audit accepted", e)
	}
}
