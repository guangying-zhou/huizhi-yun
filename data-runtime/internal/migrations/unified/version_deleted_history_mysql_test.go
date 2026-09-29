package unified

import (
	"context"
	"database/sql"
	"testing"
)

func verifyDeletedVersionEditHistory(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	r := qualified(schema, "product_command_receipts")
	a := qualified(schema, "product_activity_logs")
	for _, query := range []string{
		"UPDATE " + r + " SET result_json=JSON_SET(result_json,'$.revision',4) WHERE id=9",
		"UPDATE " + a + " SET revision=4,changes=JSON_SET(changes,'$.before.revision',3,'$.before.scope_revision',1,'$.result.revision',4) WHERE id=16",
		"INSERT INTO " + r + " SELECT 11,product_code,'product_versions:edit',actor_uid,'deleted-old-edit',request_hash,status,JSON_SET(result_json,'$.id',5,'$.revision',2,'$.workspace_revision',3,'$.current_release_record_id',NULL) FROM " + r + " WHERE id=1",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 8,'version','5',2,product_code,'edit',actor_uid,idempotency_key,JSON_OBJECT('before',JSON_SET(JSON_REMOVE(result_json,'$.workspace_revision'),'$.revision',1),'after',JSON_REMOVE(result_json,'$.workspace_revision'),'reason','historical planning edit') FROM " + r + " WHERE id=11",
	} {
		if _, err := db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	assertReceipt := func(id string, want bool) {
		t.Helper()
		issues, err := inspectVersionMutationJSON(ctx, db, schema)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, issue := range issues {
			if issue.Source == "aims.product_command_receipts" && issue.KeySHA256 == redactedBusinessKey(issue.Kind, id) {
				found = true
			}
		}
		if found != want {
			t.Fatalf("deleted history %s blocked=%v want=%v: %+v", id, found, want, issues)
		}
	}
	assertReceipt("11", false)
	if _, err := db.ExecContext(ctx, "UPDATE "+a+" SET id=20 WHERE id=8"); err != nil {
		t.Fatal(err)
	}
	assertReceipt("11", true)
	if _, err := db.ExecContext(ctx, "UPDATE "+a+" SET id=8 WHERE id=20"); err != nil {
		t.Fatal(err)
	}
	assertReceipt("11", false)
	if _, err := db.ExecContext(ctx, "UPDATE "+r+" SET result_json=JSON_SET(result_json,'$.revision',4) WHERE id=11"); err != nil {
		t.Fatal(err)
	}
	assertReceipt("11", true)
	if _, err := db.ExecContext(ctx, "UPDATE "+r+" SET result_json=JSON_SET(result_json,'$.revision',2,'$.scope_revision',2) WHERE id=11"); err != nil {
		t.Fatal(err)
	}
	assertReceipt("11", true)
	if _, err := db.ExecContext(ctx, "UPDATE "+r+" SET result_json=JSON_SET(result_json,'$.scope_revision',1) WHERE id=11"); err != nil {
		t.Fatal(err)
	}
	assertReceipt("11", false)
	if _, err := db.ExecContext(ctx, "INSERT INTO "+r+" VALUES (12,'P-001','product_versions:transition','pm','impossible-deleted-transition',REPEAT('a',64),'succeeded',JSON_OBJECT('version_id',5,'product_code','P-001','status','developing','revision',3,'workspace_revision',4))"); err != nil {
		t.Fatal(err)
	}
	assertReceipt("12", true)
	if _, err := db.ExecContext(ctx, "UPDATE "+a+" SET actor_uid='forged-delete-actor' WHERE id=16"); err != nil {
		t.Fatal(err)
	}
	assertReceipt("11", true)
}
