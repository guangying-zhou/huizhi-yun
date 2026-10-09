package unified

import (
	"context"
	"database/sql"
	"testing"
)

func verifyVersionLifecycleContracts(t *testing.T, db *sql.DB, schema string) {
	t.Helper()
	ctx := context.Background()
	r := qualified(schema, "product_command_receipts")
	a := qualified(schema, "product_activity_logs")
	for _, query := range []string{
		"UPDATE " + qualified(schema, "product_workspaces") + " SET revision=10 WHERE product_code='P-001'",
		"INSERT INTO " + qualified(schema, "product_versions") + " VALUES (3,4,3,'P-001','v3'),(4,4,3,'P-001','v4')",
		"CREATE TABLE " + qualified(schema, "product_release_records") + " (id bigint PRIMARY KEY,version_id bigint) ENGINE=InnoDB",
		"CREATE TABLE " + qualified(schema, "product_release_events") + " (id bigint PRIMARY KEY,release_record_id bigint,event_type varchar(32),actor_uid varchar(64)) ENGINE=InnoDB",
		"INSERT INTO " + qualified(schema, "product_release_records") + " VALUES (20,2),(30,3),(40,4)",
		"INSERT INTO " + qualified(schema, "product_release_events") + " VALUES (1,40,'withdrawn','pm')",
		"INSERT INTO " + r + " SELECT 6,product_code,'product_versions:edit',actor_uid,'edit-linked',request_hash,status,JSON_SET(result_json,'$.revision',2,'$.workspace_revision',4,'$.owner_project_id',1,'$.current_release_record_id',20) FROM " + r + " WHERE id=1",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 13,'version','2',2,product_code,'edit',actor_uid,idempotency_key,JSON_OBJECT('before',JSON_SET(JSON_REMOVE(result_json,'$.workspace_revision'),'$.revision',1),'after',JSON_REMOVE(result_json,'$.workspace_revision'),'reason','linked edit') FROM " + r + " WHERE id=6",
		"INSERT INTO " + r + " VALUES (7,'P-001','product_versions:archive','pm','archive',REPEAT('a',64),'succeeded',JSON_OBJECT('version_id',3,'product_code','P-001','status','archived','revision',3,'scope_revision',2,'workspace_revision',7,'release_record_id',30)),(8,'P-001','product_versions:reopen','pm','reopen',REPEAT('a',64),'succeeded',JSON_OBJECT('version_id',4,'status','developing','revision',4,'scope_revision',3,'workspace_revision',8,'release_record_id',40)),(9,'P-001','product_versions:delete','pm','delete',REPEAT('a',64),'succeeded',JSON_OBJECT('version_id',5,'product_code','P-001','deleted',TRUE,'revision',2,'scope_revision',1,'workspace_revision',9,'release_record_id',NULL))",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 14,'version','3',3,product_code,'archive',actor_uid,idempotency_key,JSON_OBJECT('result',result_json,'reason','archive release','from_status','released') FROM " + r + " WHERE id=7",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 15,'version','4',4,product_code,'reopen',actor_uid,idempotency_key,JSON_OBJECT('result',result_json,'reason','correct release') FROM " + r + " WHERE id=8",
		"INSERT INTO " + a + " (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 16,'version','5',2,product_code,'delete',actor_uid,idempotency_key,JSON_OBJECT('result',result_json,'reason','delete planning','before',JSON_OBJECT('id',5,'product_code','P-001','status','planning','revision',1,'current_release_record_id',NULL)) FROM " + r + " WHERE id=9",
	} {
		if _, err := db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	life, err := inspectVersionLifecycleJSON(ctx, db, schema)
	if err != nil || len(life) != 0 {
		t.Fatalf("valid archive/reopen/delete blocked: %+v %v", life, err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+r+" SELECT 10,product_code,action,actor_uid,'deleted-old-create',request_hash,status,JSON_SET(result_json,'$.id',5,'$.workspace_revision',2) FROM "+r+" WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+a+" (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 17,'version','5',1,product_code,'create',actor_uid,idempotency_key,result_json FROM "+r+" WHERE id=10"); err != nil {
		t.Fatal(err)
	}
	history, err := inspectVersionCreateJSON(ctx, db, schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range history {
		if issue.Source == "aims.product_command_receipts" && issue.KeySHA256 == redactedBusinessKey(issue.Kind, "10") {
			t.Fatalf("valid deleted old create blocked: %+v", issue)
		}
	}
	mutations, err := inspectVersionMutationJSON(ctx, db, schema)
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range mutations {
		if issue.KeySHA256 == redactedBusinessKey(issue.Kind, "6") && issue.Source == "aims.product_command_receipts" {
			t.Fatal("valid owner/release edit blocked")
		}
	}
	verifyDeletedVersionEditHistory(t, db, schema)
	for _, query := range []string{
		"UPDATE " + r + " SET result_json=JSON_SET(result_json,'$.release_record_id',99) WHERE id=7",
		"UPDATE " + a + " SET actor_uid='wrong-actor' WHERE id=16",
		"UPDATE " + r + " SET result_json=JSON_SET(result_json,'$.owner_project_id',99) WHERE id=6",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	life, err = inspectVersionLifecycleJSON(ctx, db, schema)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{"7": false, "9": false}
	for _, issue := range life {
		for id := range found {
			if issue.Source == "aims.product_command_receipts" && issue.KeySHA256 == redactedBusinessKey(issue.Kind, id) {
				found[id] = true
			}
		}
	}
	if !found["7"] || !found["9"] {
		t.Fatalf("bad release/deletion proof ignored: %+v", life)
	}
	mutations, err = inspectVersionMutationJSON(ctx, db, schema)
	if err != nil {
		t.Fatal(err)
	}
	badOwner := false
	for _, issue := range mutations {
		if issue.Source == "aims.product_command_receipts" && issue.KeySHA256 == redactedBusinessKey(issue.Kind, "6") {
			badOwner = true
		}
	}
	if !badOwner {
		t.Fatal("missing owner reference accepted")
	}
}
