package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

func workspacePermit(t *testing.T, db *sql.DB, code, uid, action string) AuthorizationPermit {
	t.Helper()
	facts, err := LoadAuthorizationFacts(context.Background(), db, code, uid)
	if err != nil {
		t.Fatal(err)
	}
	return AuthorizationPermit{Resource: "products", Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
}

func TestMySQLWorkspaceConcurrentChangeAndAuditRollback(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	ctx := context.Background()
	permit := workspacePermit(t, db, "P-A", "pm", "edit")
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"one", "two"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			_, err := ChangeWorkspace(ctx, db, CommandIdentity{ProductCode: "P-A", ActorUID: "pm", Action: "products:edit", IdempotencyKey: key}, permit, WorkspaceChange{ExpectedRevision: 1})
			results <- err
		}(key)
	}
	wg.Wait()
	close(results)
	succeeded, conflicts := 0, 0
	for err := range results {
		if err == nil {
			succeeded++
		} else {
			requireProductRule(t, err, "product_authorization_changed")
			conflicts++
		}
	}
	if succeeded != 1 || conflicts != 1 {
		t.Fatalf("concurrent results: %d %d", succeeded, conflicts)
	}
	if _, err := db.Exec(`CREATE TRIGGER pc_test_fail_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test audit failure'`); err != nil {
		t.Fatal(err)
	}
	_, err := ChangeWorkspace(ctx, db, CommandIdentity{ProductCode: "P-A", ActorUID: "pm", Action: "products:archive", IdempotencyKey: "audit-fail"}, workspacePermit(t, db, "P-A", "pm", "archive"), WorkspaceChange{ExpectedRevision: 2, Reason: "archive"})
	if err == nil {
		t.Fatal("audit failure must roll back command")
	}
	w, err := ReadWorkspace(ctx, db, "P-A", "pm", workspacePermit(t, db, "P-A", "pm", "view"))
	if err != nil || w.Status != "active" || w.Revision != 2 {
		t.Fatalf("audit rollback: %+v %v", w, err)
	}
	var receipts int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if receipts != 1 {
		t.Fatalf("failed commands persisted receipts: %d", receipts)
	}
}

func requireProductRule(t *testing.T, err error, code string) {
	t.Helper()
	var rule *RuleError
	if !errors.As(err, &rule) || rule.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func TestMySQLWorkspaceLifecycleAndReceipt(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	ctx := context.Background()
	text := "面向研发团队的产品"
	input := WorkspaceChange{ExpectedRevision: 1, Positioning: &text}
	identity := CommandIdentity{ProductCode: "P-A", ActorUID: "pm", Action: "products:edit", IdempotencyKey: "edit-1"}
	result, err := ChangeWorkspace(ctx, db, identity, workspacePermit(t, db, "P-A", "pm", "edit"), input)
	if err != nil {
		t.Fatal(err)
	}
	var updated Workspace
	if err := json.Unmarshal(result.Value, &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updated.Positioning == nil || *updated.Positioning != text || updated.TargetUsers != nil {
		t.Fatalf("unexpected edit: %+v", updated)
	}
	replayed, err := ChangeWorkspace(ctx, db, identity, workspacePermit(t, db, "P-A", "pm", "edit"), input)
	if err != nil || !replayed.Replayed || replayed.ReceiptID != result.ReceiptID {
		t.Fatalf("replay: %+v %v", replayed, err)
	}
	changed := input
	changed.Reason = "different payload"
	_, err = ChangeWorkspace(ctx, db, identity, workspacePermit(t, db, "P-A", "pm", "edit"), changed)
	requireProductRule(t, err, "idempotency_payload_mismatch")
	identity.IdempotencyKey = "stale"
	_, err = ChangeWorkspace(ctx, db, identity, workspacePermit(t, db, "P-A", "pm", "edit"), input)
	requireProductRule(t, err, "product_revision_conflict")
	identity.Action, identity.IdempotencyKey = "products:archive", "archive-1"
	_, err = ChangeWorkspace(ctx, db, identity, workspacePermit(t, db, "P-A", "pm", "archive"), WorkspaceChange{ExpectedRevision: 2, Reason: "产品停止新规划"})
	if err != nil {
		t.Fatal(err)
	}
	read, err := ReadWorkspace(ctx, db, "P-A", "pm", workspacePermit(t, db, "P-A", "pm", "view"))
	if err != nil || read.Status != "archived" || read.Revision != 3 {
		t.Fatalf("archived read: %+v %v", read, err)
	}
	identity.Action, identity.IdempotencyKey = "products:edit", "archived-edit"
	input.ExpectedRevision = 3
	_, err = ChangeWorkspace(ctx, db, identity, workspacePermit(t, db, "P-A", "pm", "edit"), input)
	requireProductRule(t, err, "product_archived")
	identity.Action, identity.IdempotencyKey = "products:restore", "restore-1"
	_, err = ChangeWorkspace(ctx, db, identity, workspacePermit(t, db, "P-A", "pm", "restore"), WorkspaceChange{ExpectedRevision: 3, Reason: "恢复维护"})
	if err != nil {
		t.Fatal(err)
	}
	read, err = ReadWorkspace(ctx, db, "P-A", "pm", workspacePermit(t, db, "P-A", "pm", "view"))
	if err != nil || read.Status != "active" || read.Revision != 4 {
		t.Fatalf("restore: %+v %v", read, err)
	}
	var receipts, activities int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs`).Scan(&activities); err != nil {
		t.Fatal(err)
	}
	if receipts != 3 || activities != 3 {
		t.Fatalf("failed/replayed commands changed history: %d %d", receipts, activities)
	}
}

func TestMySQLWorkspaceRejectsChangedAuthorizationBeforeReplay(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	_, err := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at)
		VALUES ('P-A','pm','manager','active',UTC_TIMESTAMP(3)-INTERVAL 1 DAY,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	id := CommandIdentity{ProductCode: "P-A", ActorUID: "pm", Action: "products:edit", IdempotencyKey: "edit"}
	input := WorkspaceChange{ExpectedRevision: 1}
	_, err = ChangeWorkspace(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "edit"), input)
	if err != nil {
		t.Fatal(err)
	}
	permit := workspacePermit(t, db, "P-A", "pm", "edit")
	if _, err := db.Exec(`UPDATE product_members SET status='inactive' WHERE product_code='P-A' AND uid='pm'`); err != nil {
		t.Fatal(err)
	}
	_, err = ChangeWorkspace(ctx, db, id, permit, input)
	requireProductRule(t, err, "product_authorization_changed")
	permit = workspacePermit(t, db, "P-A", "pm", "view")
	permit.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	_, err = ReadWorkspace(ctx, db, "P-A", "pm", permit)
	requireProductRule(t, err, "product_authorization_expired")
	permit = workspacePermit(t, db, "P-A", "pm", "view")
	_, err = ReadWorkspace(ctx, db, "P-B", "pm", permit)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = ReadWorkspace(ctx, db, "P-A", "other", permit)
	requireProductRule(t, err, "product_authorization_invalid")
	permit.Action = "edit"
	_, err = ReadWorkspace(ctx, db, "P-A", "pm", permit)
	requireProductRule(t, err, "product_authorization_invalid")
}

// The product workspace header shows a name only when the active catalog
// generation actually carries one; a missing generation or product keeps the
// display fields null so the UI falls back to the product code.
func TestMySQLWorkspaceReadCarriesCatalogIdentity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	workspaceFixture(t, db, "P-001")
	workspaceFixture(t, db, "P-OFFLINE")
	before, err := ReadWorkspace(ctx, db, "P-001", "pm", workspacePermit(t, db, "P-001", "pm", "view"))
	if err != nil {
		t.Fatal(err)
	}
	if before.ProductCode != "P-001" || before.ProductName != nil || before.ProductLine != nil || before.ProductLineLabel != nil {
		t.Fatalf("catalog identity invented before refresh: %#v", before)
	}
	permit := catalogPermit("pm")
	refresh, err := StartCatalogRefresh(ctx, db, "pm", "identity", permit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", refresh.BizID, permit, 1, catalogPage(1, 1, "epoch:1")); err != nil {
		t.Fatal(err)
	}
	after, err := ReadWorkspace(ctx, db, "P-001", "pm", workspacePermit(t, db, "P-001", "pm", "view"))
	if err != nil {
		t.Fatal(err)
	}
	if after.ProductName == nil || *after.ProductName != "Product 1" || after.ProductLine == nil || *after.ProductLine != "software" {
		t.Fatalf("catalog identity missing after refresh: %#v", after)
	}
	if after.Revision != before.Revision || after.Status != before.Status {
		t.Fatalf("catalog join changed workspace facts: %#v", after)
	}
	uncatalogued, err := ReadWorkspace(ctx, db, "P-OFFLINE", "pm", workspacePermit(t, db, "P-OFFLINE", "pm", "view"))
	if err != nil {
		t.Fatal(err)
	}
	if uncatalogued.ProductName != nil || uncatalogued.ProductLine != nil {
		t.Fatalf("catalog identity invented for uncatalogued product: %#v", uncatalogued)
	}
}
