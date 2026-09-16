package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLRICEModelPublication(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-RICE")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.29_priority_model_versions.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-RICE", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-RICE", ActorUID: "pm", Action: "product_priorities:model-create", IdempotencyKey: "rice-create"}
	input := RICEModelCreate{ExpectedRevision: 1, Title: "季度用户 RICE", Reason: "冻结季度去重口径", Model: riceModel()}
	if _, err = db.Exec(`CREATE TRIGGER reject_rice_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit unavailable'`); err != nil {
		t.Fatal(err)
	}
	if _, err = CreateRICEModelVersion(ctx, db, identity, permit("admin"), input); err == nil {
		t.Fatal("audit failure accepted")
	}
	var count, revision int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_model_versions`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-RICE'`).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if count != 0 || revision != 1 {
		t.Fatalf("rollback count=%d revision=%d", count, revision)
	}
	if _, err = db.Exec("DROP TRIGGER reject_rice_audit"); err != nil {
		t.Fatal(err)
	}
	saved, err := CreateRICEModelVersion(ctx, db, identity, permit("admin"), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := CreateRICEModelVersion(ctx, db, identity, permit("admin"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	page, err := ListPriorityModels(ctx, db, "P-RICE", "pm", permit("view"), 1, 20)
	if err != nil || page.Total != 1 || page.Items[0].Method != "rice" || page.WorkspaceRevision != 2 {
		t.Fatalf("list %+v %v", page, err)
	}
	var config map[string]any
	if err = json.Unmarshal(page.Items[0].Configuration, &config); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{"reach_unit": "unique_users", "reach_starts_on": "2026-10-01", "reach_ends_on": "2026-12-31", "effort_unit": "person_day", "rounding": "half_up", "priority_decimal_places": float64(8)} {
		if config[key] != want {
			t.Fatalf("%s=%v want %v", key, config[key], want)
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	loaded, err := loadFrozenRICEModel(ctx, tx, "P-RICE", input.Model.Version, page.Items[0].Configuration)
	if err != nil || loaded != input.Model {
		t.Fatalf("loaded %+v %v", loaded, err)
	}
	var changed map[string]any
	if err = json.Unmarshal(page.Items[0].Configuration, &changed); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]any{"reach_unit": "unique_customer_organizations", "reach_ends_on": "2027-12-31", "source_definition": "其他来源", "rounding": "floor"} {
		original := changed[key]
		changed[key] = value
		raw, _ := json.Marshal(changed)
		if _, err = loadFrozenRICEModel(ctx, tx, "P-RICE", input.Model.Version, raw); err == nil {
			t.Fatalf("tampered %s accepted", key)
		}
		changed[key] = original
	}
	if _, err = loadFrozenRICEModel(ctx, tx, "OTHER-PRODUCT", input.Model.Version, page.Items[0].Configuration); err == nil {
		t.Fatal("cross product RICE accepted")
	}
	if _, err = loadFrozenWeightedModel(ctx, tx, "P-RICE", input.Model.Version, page.Items[0].Configuration); err == nil {
		t.Fatal("RICE decoded as weighted model")
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	// Version uniqueness spans methods; publishing weighted rules under a RICE
	// version must not replace the existing immutable definition.
	weighted := DefaultWeightedAssessmentModel()
	weighted.Version = input.Model.Version
	identity.IdempotencyKey = "weighted-collision"
	if _, err = CreateWeightedModelVersion(ctx, db, identity, permit("admin"), WeightedModelCreate{ExpectedRevision: 2, Title: "冲突版本", Reason: "不应覆盖", Model: weighted}); err == nil {
		t.Fatal("cross-method duplicate accepted")
	}
	if _, err = db.Exec(`UPDATE product_priority_model_versions SET configuration='{}' WHERE product_code='P-RICE'`); err == nil {
		t.Fatal("immutable RICE changed")
	}
}
