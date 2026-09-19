package unified

import (
	"context"
	"database/sql"
	"testing"
)

func verifyVersionMutationContracts(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	r := qualified(schema, "product_command_receipts")
	a := qualified(schema, "product_activity_logs")
	for _, query := range []string{
		"UPDATE " + qualified(schema, "product_versions") + " SET revision=4,version_code='later-code' WHERE id=2",
		"UPDATE " + qualified(schema, "product_workspaces") + " SET revision=6 WHERE product_code='P-001'",
		"INSERT INTO " + r + " SELECT 4,product_code,'product_versions:edit',actor_uid,'v-edit',request_hash,status,JSON_SET(result_json,'$.revision',2,'$.workspace_revision',4,'$.version_code','edited-code','$.current_release_record_id',NULL) FROM " + r + " WHERE id=1",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 11,'version','2',2,product_code,'edit',actor_uid,idempotency_key,JSON_OBJECT('before',JSON_SET(JSON_REMOVE(result_json,'$.workspace_revision'),'$.revision',1,'$.version_code','v1'),'after',JSON_REMOVE(result_json,'$.workspace_revision'),'reason','edit historical version') FROM " + r + " WHERE id=4",
		"INSERT INTO " + r + " (id,product_code,action,actor_uid,idempotency_key,request_hash,status,result_json) VALUES (5,'P-001','product_versions:transition','pm','v-transition',REPEAT('a',64),'succeeded',JSON_OBJECT('version_id',2,'product_code','P-001','status','developing','revision',3,'workspace_revision',5))",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 12,'version','2',3,product_code,'transition',actor_uid,idempotency_key,JSON_OBJECT('result',result_json,'reason','begin development','from_status','planning') FROM " + r + " WHERE id=5",
	} {
		if _, err := db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	issues, err := inspectVersionMutationJSON(ctx, db, schema)
	if err != nil || len(issues) != 0 {
		t.Fatalf("legal historical edit/transition blocked: %+v %v", issues, err)
	}
	all, err := inspectVersionCreateJSON(ctx, db, schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range all {
		if issue.KeySHA256 == redactedBusinessKey(issue.Kind, "1") && issue.Source == "aims.product_command_receipts" {
			t.Fatal("historical create incorrectly compared to mutable current code")
		}
	}
	for _, query := range []string{
		"UPDATE " + r + " SET result_json=JSON_SET(result_json,'$.schemaVersion','unknown.v9') WHERE id=4",
		"UPDATE " + r + " SET result_json=JSON_SET(result_json,'$.version_id',99) WHERE id=5",
		"UPDATE " + a + " SET actor_uid='wrong-actor' WHERE id=12",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	issues, err = inspectVersionMutationJSON(ctx, db, schema)
	if err != nil {
		t.Fatal(err)
	}
	receiptCount, auditCount := 0, 0
	for _, issue := range issues {
		if issue.Source == "aims.product_command_receipts" {
			receiptCount++
		} else {
			auditCount++
		}
	}
	if receiptCount != 2 || auditCount != 2 {
		t.Fatalf("schema/reference/paired audit corruption ignored: %+v", issues)
	}
}
