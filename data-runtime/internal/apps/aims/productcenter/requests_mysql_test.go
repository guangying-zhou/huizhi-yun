package productcenter

import (
	"context"
	"encoding/json"
	"reflect"
	"sync"
	"testing"
)

func TestMySQLRequestCreationReplayAndAuditRollback(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-REQ")
	ctx := context.Background()
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-REQ", "pm", "create")
		p.Resource = "product_requests"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-REQ", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "create-one"}
	input := RequestDraft{ExpectedRevision: 1, Title: "统一登录", ProblemStatement: "用户重复登录", SourceType: "customer", UrgencyLevel: "P2"}
	first, err := CreateProductRequest(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := CreateProductRequest(ctx, db, identity, permit(), input)
	var firstValue, replayValue map[string]any
	firstDecodeErr := json.Unmarshal(first.Value, &firstValue)
	replayDecodeErr := json.Unmarshal(replay.Value, &replayValue)
	if err != nil || !replay.Replayed || firstDecodeErr != nil || replayDecodeErr != nil || !reflect.DeepEqual(firstValue, replayValue) {
		t.Fatalf("replay %v %v", replay, err)
	}
	input.Title = "changed"
	if _, err := CreateProductRequest(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("changed payload reused receipt")
	}
	var count, revision int
	var status string
	if err := db.QueryRow(`SELECT COUNT(*),MAX(decision_status) FROM product_requests`).Scan(&count, &status); err != nil || count != 1 || status != "submitted" {
		t.Fatalf("request state %d %s %v", count, status, err)
	}
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-REQ'`).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("revision %d %v", revision, err)
	}
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_request_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "audit-failure"
	input.ExpectedRevision = 2
	if _, err := CreateProductRequest(ctx, db, identity, permit(), input); err == nil {
		t.Fatal("expected audit rollback")
	}
	for _, table := range []string{"product_requests", "product_activity_logs", "product_command_receipts"} {
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s residual rows %d %v", table, count, err)
		}
	}
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-REQ'`).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("rolled back revision %d %v", revision, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_request_audit`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_workspaces SET status='archived',revision=3 WHERE product_code='P-REQ'`); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "archived"
	input.ExpectedRevision = 3
	_, err = CreateProductRequest(ctx, db, identity, permit(), input)
	requireProductRule(t, err, "product_archived")
}

func TestMySQLRequestConcurrentCreationReauthorizesBeforeReplay(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-CONCURRENT-REQ")
	ctx := context.Background()
	p := workspacePermit(t, db, "P-CONCURRENT-REQ", "pm", "create")
	p.Resource = "product_requests"
	input := RequestDraft{ExpectedRevision: 1, Title: "并发提交", ProblemStatement: "两位编辑者基于相同空间版本提交", SourceType: "internal", UrgencyLevel: "P2"}
	identities := []CommandIdentity{
		{ProductCode: "P-CONCURRENT-REQ", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "first"},
		{ProductCode: "P-CONCURRENT-REQ", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "second"},
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	start := make(chan struct{})
	for i := range identities {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, errs[i] = CreateProductRequest(ctx, db, identities[i], p, input)
		}(i)
	}
	close(start)
	wg.Wait()
	winner := -1
	for i, err := range errs {
		if err == nil {
			if winner != -1 {
				t.Fatal("both stale-root commands committed")
			}
			winner = i
		} else {
			requireProductRule(t, err, "product_authorization_changed")
		}
	}
	if winner == -1 {
		t.Fatalf("no creation succeeded: %v", errs)
	}
	// Even a successful receipt must not bypass a now-stale authorization permit.
	_, err := CreateProductRequest(ctx, db, identities[winner], p, input)
	requireProductRule(t, err, "product_authorization_changed")
	for _, table := range []string{"product_requests", "product_activity_logs", "product_command_receipts"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s count %d: %v", table, count, err)
		}
	}
}
