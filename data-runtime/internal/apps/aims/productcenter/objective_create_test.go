package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLProductObjectiveCreateAtomicity(t *testing.T) {
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
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_objectives"
		return CreateProductObjective(context.Background(), db, identity, p, input)
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`CREATE TRIGGER fail_component_create BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	for _, table := range []string{"product_objectives", "product_command_receipts"} {
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("rollback %s %d %v", table, count, err)
		}
	}
	if _, err = db.Exec(`DROP TRIGGER fail_component_create`); err != nil {
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
	var out struct {
		ID    int64  `json:"id"`
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(saved.Value, &out); err != nil || out.ID < 1 || out.BizID == "" {
		t.Fatalf("result %+v %v", out, err)
	}

	identity.IdempotencyKey = "stale"
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 2
	input.OwnerUID = "missing"
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_owner_unavailable")
	input.OwnerUID = "pm"
	if _, err = db.Exec(`UPDATE product_members SET status='inactive' WHERE product_code='P-CREATE-TREE'`); err != nil {
		t.Fatal(err)
	}
	_, err = run("edit")
	requireProductRule(t, err, "product_objective_owner_unavailable")
	var title, baseline, target, status string
	var revision uint64
	if err = db.QueryRow(`SELECT title,baseline_value,target_value,status FROM product_objectives WHERE id=?`, out.ID).Scan(&title, &baseline, &target, &status); err != nil || title != input.Title || baseline != "5.000000" || target != "2.000000" || status != "draft" {
		t.Fatalf("persisted %s %s %s %s %v", title, baseline, target, status, err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-CREATE-TREE'`).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("revision %d %v", revision, err)
	}
}

func TestProductObjectiveDraftValidation(t *testing.T) {
	valid := ProductObjectiveDraft{Title: "降低失败率", StartsOn: "2026-09-01", EndsOn: "2026-12-31", OwnerUID: "pm", ExpectedRevision: 1, Metric: ProductObjectiveMetric{"失败率", "%", "失败次数/总次数", "decrease", "5", "2"}}
	for _, mutate := range []func(*ProductObjectiveDraft){
		func(d *ProductObjectiveDraft) { d.StartsOn = "2026-02-30" },
		func(d *ProductObjectiveDraft) { d.StartsOn = "0000-01-01" },
		func(d *ProductObjectiveDraft) { d.EndsOn = "2026-08-31" },
		func(d *ProductObjectiveDraft) { d.Title = " " },
		func(d *ProductObjectiveDraft) { d.OwnerUID = " pm" },
		func(d *ProductObjectiveDraft) { d.ExpectedRevision = 0 },
	} {
		input := valid
		mutate(&input)
		if err := ValidateProductObjectiveDraft(input); err == nil {
			t.Fatalf("accepted %+v", input)
		}
	}
	if err := ValidateProductObjectiveDraft(valid); err != nil {
		t.Fatal(err)
	}
}
