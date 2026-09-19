package enterpriseplanning

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"testing"
	"time"
)

func TestMySQLComponentCommandsShareOwningTreeTransaction(t *testing.T) {
	db, registry, b := planningMySQLFixture(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	// This canonical constraint is an ALTER after CREATE TABLE and therefore is
	// installed explicitly by this fixture, rather than silently omitting it.
	exec("ALTER TABLE u_product_requests ADD CONSTRAINT test_request_component FOREIGN KEY(component_id,product_code) REFERENCES u_product_components(id,product_code)")
	for _, code := range []string{"P", "OTHER"} {
		exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", code, uuid.NewString())
		exec("INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES(?,'pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", code)
	}
	service, err := NewComponentService(ctx, registry, b)
	if err != nil {
		t.Fatal(err)
	}
	permit := func(action string) pc.AuthorizationPermit {
		facts, err := pc.LoadAuthorizationFacts(ctx, db, "P", "pm")
		if err != nil {
			t.Fatal(err)
		}
		return pc.AuthorizationPermit{Resource: "product_components", Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	identity := func(action, key string) pc.CommandIdentity {
		return pc.CommandIdentity{ProductCode: "P", ActorUID: "pm", Action: "product_components:" + action, IdempotencyKey: key}
	}
	state := func() [4]int64 {
		var v [4]int64
		if err = db.QueryRow("SELECT (SELECT revision FROM product_workspaces WHERE product_code='P'),(SELECT COUNT(*) FROM product_components),(SELECT COUNT(*) FROM product_activity_logs),(SELECT COUNT(*) FROM product_command_receipts)").Scan(&v[0], &v[1], &v[2], &v[3]); err != nil {
			t.Fatal(err)
		}
		return v
	}
	verify := func(call, old func() (pc.CommandResult, error)) map[string]any {
		t.Helper()
		before := state()
		exec("CREATE TRIGGER component_late BEFORE INSERT ON u_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late audit'")
		if _, err = call(); err == nil {
			t.Fatal("late failure accepted")
		}
		if after := state(); after != before {
			t.Fatal("partial mutation", before, after)
		}
		exec("DROP TRIGGER component_late")
		result, err := call()
		if err != nil {
			t.Fatal(err)
		}
		replay, err := old()
		if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
			t.Fatal("old replay", err)
		}
		var v map[string]any
		if err = json.Unmarshal(result.Value, &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	rootInput := pc.ProductComponentDraft{Name: "Root", ExpectedRevision: 1}
	rootID := identity("create", "root")
	root := verify(func() (pc.CommandResult, error) { return service.Create(ctx, rootID, permit("edit"), rootInput) }, func() (pc.CommandResult, error) {
		return pc.CreateProductComponent(ctx, db, rootID, permit("edit"), rootInput)
	})
	rootComponent := int64(root["id"].(float64))
	childInput := pc.ProductComponentDraft{Name: "Child", ExpectedRevision: 2}
	childID := identity("create", "child")
	child, err := service.Create(ctx, childID, permit("edit"), childInput)
	if err != nil {
		t.Fatal(err)
	}
	var childValue map[string]any
	json.Unmarshal(child.Value, &childValue)
	childComponent := int64(childValue["id"].(float64))
	editInput := pc.ProductComponentEdit{ComponentID: rootComponent, Name: "Edited root", Reason: "clarify", ExpectedRevision: 3, ExpectedComponentRevision: 1}
	editID := identity("edit", "edit")
	verify(func() (pc.CommandResult, error) { return service.Edit(ctx, editID, permit("edit"), editInput) }, func() (pc.CommandResult, error) {
		return pc.EditProductComponent(ctx, db, editID, permit("edit"), editInput)
	})
	moveInput := pc.ProductComponentMove{ComponentID: childComponent, ParentID: &rootComponent, Reason: "nest", ExpectedRevision: 4, ExpectedComponentRevision: 1}
	moveID := identity("move", "move")
	verify(func() (pc.CommandResult, error) { return service.Move(ctx, moveID, permit("edit"), moveInput) }, func() (pc.CommandResult, error) {
		return pc.MoveProductComponent(ctx, db, moveID, permit("edit"), moveInput)
	})
	if _, err = service.Move(ctx, identity("move", "cycle"), permit("edit"), pc.ProductComponentMove{ComponentID: rootComponent, ParentID: &childComponent, Reason: "cycle", ExpectedRevision: 5, ExpectedComponentRevision: 2}); err == nil {
		t.Fatal("cycle accepted")
	}
	foreign, err := db.Exec("INSERT INTO product_components(biz_id,product_code,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'OTHER','Foreign','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	if err != nil {
		t.Fatal(err)
	}
	foreignID, _ := foreign.LastInsertId()
	if _, err = service.Move(ctx, identity("move", "foreign"), permit("edit"), pc.ProductComponentMove{ComponentID: childComponent, ParentID: &foreignID, Reason: "foreign", ExpectedRevision: 5, ExpectedComponentRevision: 2}); err == nil {
		t.Fatal("foreign parent accepted")
	}
	if _, err = service.Delete(ctx, identity("delete", "root-blocked"), permit("delete"), pc.ProductComponentDelete{ComponentID: rootComponent, Reason: "remove", ExpectedRevision: 5, ExpectedComponentRevision: 2}); err == nil {
		t.Fatal("parent removed")
	}
	deleteInput := pc.ProductComponentDelete{ComponentID: childComponent, Reason: "remove", ExpectedRevision: 5, ExpectedComponentRevision: 2}
	deleteID := identity("delete", "delete")
	exec("INSERT INTO product_requests(biz_id,product_code,component_id,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P',?,'Referenced need','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", childComponent)
	if _, err = service.Delete(ctx, deleteID, permit("delete"), deleteInput); err == nil {
		t.Fatal("request reference removed")
	}
	exec("UPDATE product_requests SET component_id=NULL WHERE component_id=?", childComponent)
	exec("INSERT INTO product_line_workspaces(line_code,product_code,line_label,source_watermark) VALUES('L','P','Historical line','historical')")
	exec("INSERT INTO product_component_sources(source_product_code,product_code,component_id,source_product_name) VALUES('ASSET','P',?,'Historical snapshot')", childComponent)
	if _, err = service.Delete(ctx, deleteID, permit("delete"), deleteInput); err == nil {
		t.Fatal("source ownership removed")
	}
	exec("DELETE FROM product_component_sources WHERE component_id=?", childComponent)
	verify(func() (pc.CommandResult, error) { return service.Delete(ctx, deleteID, permit("delete"), deleteInput) }, func() (pc.CommandResult, error) {
		return pc.DeleteProductComponent(ctx, db, deleteID, permit("delete"), deleteInput)
	})
	start := make(chan struct{})
	results := make(chan error, 2)
	sharedPermit := permit("edit")
	for _, key := range []string{"race-a", "race-b"} {
		go func(key string) {
			<-start
			_, err := service.Edit(ctx, identity("edit", key), sharedPermit, pc.ProductComponentEdit{ComponentID: rootComponent, Name: key, Reason: "race", ExpectedRevision: 6, ExpectedComponentRevision: 2})
			results <- err
		}(key)
	}
	close(start)
	wins := 0
	for range 2 {
		if <-results == nil {
			wins++
		}
	}
	if wins != 1 {
		t.Fatal("stale concurrent edit committed", wins)
	}
	var rev uint64
	if err = db.QueryRow("SELECT revision FROM product_workspaces WHERE product_code='P'").Scan(&rev); err != nil || rev != 7 {
		t.Fatal("root revision", rev, err)
	}
}
