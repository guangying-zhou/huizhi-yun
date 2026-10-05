package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLProductObjectiveEditAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.22_product_objectives.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	workspaceFixture(t, db, "P-CREATE-TREE")
	identity := CommandIdentity{ProductCode: "P-CREATE-TREE", ActorUID: "pm", Action: "product_objectives:create", IdempotencyKey: "root"}
	input := ProductObjectiveDraft{Title: "降低失败率", StartsOn: "2026-09-01", EndsOn: "2026-12-31", OwnerUID: "pm", ExpectedRevision: 1, Metric: ProductObjectiveMetric{"失败率", "%", "失败次数/总次数", "decrease", "5", "2"}}
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-CREATE-TREE','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}

	permit := workspacePermit(t, db, identity.ProductCode, "pm", "edit")
	permit.Resource = "product_objectives"
	created, err := CreateProductObjective(context.Background(), db, identity, permit, input)
	if err != nil {
		t.Fatal(err)
	}
	var original ProductObjectiveRecord
	if err = json.Unmarshal(created.Value, &original); err != nil {
		t.Fatal(err)
	}
	edit := ProductObjectiveEdit{ProductObjectiveDraft: input, ObjectiveID: original.ID, ExpectedObjectiveRevision: 1, Reason: "提高改善目标"}
	edit.ExpectedRevision = 2
	edit.Title = "降低登录失败率"
	edit.Description = "统一观测口径"
	edit.Metric.TargetValue = "1"
	identity.Action = "product_objectives:edit"
	identity.IdempotencyKey = "edit-goal"
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_objectives"
		return EditProductObjective(context.Background(), db, identity, p, edit)
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_objective_edit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='edit audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	var title, target string
	var revision uint64
	if err = db.QueryRow(`SELECT title,target_value,revision FROM product_objectives WHERE id=?`, original.ID).Scan(&title, &target, &revision); err != nil || title != input.Title || target != "2.000000" || revision != 1 {
		t.Fatalf("rollback %s %s %d %v", title, target, revision, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_objective_edit`); err != nil {
		t.Fatal(err)
	}
	saved, err := run("edit")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("edit")
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	var result ProductObjectiveDetail
	if err = json.Unmarshal(saved.Value, &result); err != nil || result.Objective.BizID != original.BizID || result.Objective.Metric.TargetValue != "1.000000" || result.Objective.Revision != 2 || result.WorkspaceRevision != 3 {
		t.Fatalf("edit %+v %v", result, err)
	}
	identity.IdempotencyKey = "stale-edit"
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	edit.ExpectedRevision = 3
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_revision_conflict")
	edit.ExpectedObjectiveRevision = 2
	edit.OwnerUID = "missing"
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_owner_unavailable")
	edit.OwnerUID = "pm"
	if _, err = db.Exec(`UPDATE product_objectives SET status='closed' WHERE id=?`, original.ID); err != nil {
		t.Fatal(err)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_state_conflict")
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("receipts %d %v", count, err)
	}
}
