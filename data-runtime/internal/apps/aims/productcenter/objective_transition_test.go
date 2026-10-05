package productcenter

import (
	"context"
	"os"
	"testing"
)

func TestMySQLProductObjectiveTransition(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-OBS")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.22_product_objectives.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	r, err := db.Exec(`INSERT INTO product_objectives(biz_id,product_code,title,starts_on,ends_on,owner_uid,metric_name,metric_unit,measurement_definition,direction,baseline_value,target_value,status,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-OBS','降低失败率','2020-01-01','2099-12-31','pm','失败率','%','失败次数/总次数','decrease',5,2,'draft','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	id, err := r.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}

	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-OBS','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	identity := CommandIdentity{ProductCode: "P-OBS", ActorUID: "pm", Action: "product_objectives:activate", IdempotencyKey: "activate"}
	input := ProductObjectiveTransition{ObjectiveID: id, ExpectedRevision: 1, ExpectedObjectiveRevision: 1, Action: "activate", Reason: "开始执行季度目标"}
	run := func(permission string) (CommandResult, error) {
		p := workspacePermit(t, db, "P-OBS", "pm", permission)
		p.Resource = "product_objectives"
		return TransitionProductObjective(context.Background(), db, identity, p, input)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_objective_transition BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("activate"); err == nil {
		t.Fatal("audit failed but committed")
	}
	var status string
	var revision uint64
	if err = db.QueryRow(`SELECT status,revision FROM product_objectives WHERE id=?`, id).Scan(&status, &revision); err != nil || status != "draft" || revision != 1 {
		t.Fatalf("rollback %s %d %v", status, revision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_objective_transition`); err != nil {
		t.Fatal(err)
	}
	for i, action := range []string{"activate", "close", "reopen", "close", "archive"} {
		input.Action = action
		input.ExpectedRevision = uint64(i + 1)
		input.ExpectedObjectiveRevision = uint64(i + 1)
		identity.Action = "product_objectives:" + action
		identity.IdempotencyKey = action + string(rune('0'+i))
		saved, e := run(action)
		if e != nil {
			t.Fatal(e)
		}
		replay, e := run(action)
		if e != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
			t.Fatalf("replay %+v %v", replay, e)
		}
	}
	if err = db.QueryRow(`SELECT status,revision FROM product_objectives WHERE id=?`, id).Scan(&status, &revision); err != nil || status != "archived" || revision != 6 {
		t.Fatalf("final %s %d %v", status, revision, err)
	}
	input.Action = "reopen"
	input.ExpectedRevision = 6
	input.ExpectedObjectiveRevision = 6
	identity.Action = "product_objectives:reopen"
	identity.IdempotencyKey = "archived-reopen"
	_, err = run("reopen")
	requireProductRule(t, err, "product_objective_state_conflict")
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE object_type='objective'`).Scan(&count); err != nil || count != 5 {
		t.Fatalf("audit %d %v", count, err)
	}
}

func TestProductObjectiveTransitionMatrix(t *testing.T) {
	allowed := map[string]string{"draft/activate": "active", "active/close": "closed", "closed/reopen": "active", "draft/archive": "archived", "closed/archive": "archived"}
	for _, status := range []string{"draft", "active", "closed", "archived"} {
		for _, action := range []string{"activate", "close", "reopen", "archive", "delete"} {
			got, err := objectiveTransition(status, action)
			want, ok := allowed[status+"/"+action]
			if ok && (err != nil || got != want) || !ok && err == nil {
				t.Fatalf("%s/%s: %s %v", status, action, got, err)
			}
		}
	}
}
