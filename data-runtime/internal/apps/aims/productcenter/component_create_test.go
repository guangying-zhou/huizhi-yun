package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestMySQLProductComponentCreateAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.21_product_components.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	workspaceFixture(t, db, "P-CREATE-TREE")
	identity := CommandIdentity{ProductCode: "P-CREATE-TREE", ActorUID: "pm", Action: "product_components:create", IdempotencyKey: "root"}
	input := ProductComponentDraft{Name: "认证", Description: "认证与会话", ExpectedRevision: 1}
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, identity.ProductCode, "pm", action)
		p.Resource = "product_components"
		return CreateProductComponent(context.Background(), db, identity, p, input)
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
	for _, table := range []string{"product_components", "product_command_receipts"} {
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
	for level := 2; level <= 3; level++ {
		parent := out.ID
		input.ParentID = &parent
		input.ExpectedRevision = uint64(level)
		identity.IdempotencyKey = input.Name + string(rune('0'+level))
		saved, err = run("edit")
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(saved.Value, &out); err != nil {
			t.Fatal(err)
		}
	}
	parent := out.ID
	input.ParentID = &parent
	input.ExpectedRevision = 4
	identity.IdempotencyKey = "fourth"
	_, err = run("edit")
	requireProductRule(t, err, "product_component_depth_exceeded")
	missing := int64(999999)
	input.ParentID = &missing
	_, err = run("edit")
	requireProductRule(t, err, "product_component_parent_invalid")
	input.ParentID = nil
	input.ExpectedRevision = 3
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	for _, table := range []string{"product_components", "product_command_receipts", "product_activity_logs"} {
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 3 {
			t.Fatalf("final %s %d %v", table, count, err)
		}
	}
	var revision uint64
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-CREATE-TREE'`).Scan(&revision); err != nil || revision != 4 {
		t.Fatalf("revision %d %v", revision, err)
	}
	readPermit := workspacePermit(t, db, identity.ProductCode, "pm", "view")
	readPermit.Resource = "product_components"
	roots, err := ListProductComponents(context.Background(), db, identity.ProductCode, "pm", readPermit, nil, 1, 1)
	if err != nil || roots.Total != 1 || len(roots.Items) != 1 || roots.Items[0].ChildCount != 1 || roots.WorkspaceRevision != 4 {
		t.Fatalf("roots %+v %v", roots, err)
	}
	rootID := roots.Items[0].ID
	children, err := ListProductComponents(context.Background(), db, identity.ProductCode, "pm", readPermit, &rootID, 1, 10)
	if err != nil || children.Total != 1 || len(children.Items) != 1 || children.Items[0].ChildCount != 1 || children.Items[0].ParentID == nil || *children.Items[0].ParentID != rootID {
		t.Fatalf("children %+v %v", children, err)
	}
	// Create another root with an earlier sort order and verify real pagination.
	input.ExpectedRevision = 4
	input.SortOrder = -1
	input.Name = "基础模块"
	identity.IdempotencyKey = "second-root"
	if _, err = run("edit"); err != nil {
		t.Fatal(err)
	}
	readPermit = workspacePermit(t, db, identity.ProductCode, "pm", "view")
	readPermit.Resource = "product_components"
	first, err := ListProductComponents(context.Background(), db, identity.ProductCode, "pm", readPermit, nil, 1, 1)
	if err != nil || first.Total != 2 || len(first.Items) != 1 || first.Items[0].Name != input.Name || first.Items[0].ChildCount != 0 {
		t.Fatalf("first page %+v %v", first, err)
	}
	second, err := ListProductComponents(context.Background(), db, identity.ProductCode, "pm", readPermit, nil, 2, 1)
	if err != nil || second.Total != 2 || len(second.Items) != 1 || second.Items[0].ID != rootID {
		t.Fatalf("second page %+v %v", second, err)
	}
	workspaceFixture(t, db, "P-FOREIGN-TREE")
	foreignPermit := workspacePermit(t, db, "P-FOREIGN-TREE", "pm", "view")
	foreignPermit.Resource = "product_components"
	if _, err = ListProductComponents(context.Background(), db, "P-FOREIGN-TREE", "pm", foreignPermit, &rootID, 1, 10); err == nil {
		t.Fatal("foreign parent accepted")
	}
	_, err = ListProductComponents(context.Background(), db, identity.ProductCode, "pm", foreignPermit, nil, 1, 10)
	if err == nil {
		t.Fatal("foreign permit accepted")
	}
	_, err = ListProductComponents(context.Background(), db, identity.ProductCode, "pm", readPermit, nil, 0, 10)
	requireProductRule(t, err, "product_component_list_invalid")
}
