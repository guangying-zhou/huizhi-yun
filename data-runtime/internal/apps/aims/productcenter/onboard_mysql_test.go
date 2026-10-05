package productcenter

import (
	"context"
	"encoding/json"
	"reflect"
	"sync"
	"testing"
	"time"
)

func onboardFixture(code, key string) (CommandIdentity, OnboardPermit, OnboardSourceEvidence, MemberDirectoryEvidence, OnboardInput) {
	deadline := time.Now().Add(15 * time.Second).UnixMilli()
	return CommandIdentity{ProductCode: code, ActorUID: "admin", Action: "products:onboard", IdempotencyKey: key}, OnboardPermit{ProductCode: code, ActorUID: "admin", Resource: "products", Action: "onboard", ExpiresAt: deadline}, OnboardSourceEvidence{ProductCode: code, Watermark: "epoch:1", Onboardable: true, ExpiresAt: deadline}, MemberDirectoryEvidence{ActiveUIDs: []string{"manager"}, ExpiresAt: deadline}, OnboardInput{ManagerUID: "manager", Reason: "接入产品规划"}
}

func TestMySQLOnboardWorkspaceAtomicReplayAndDuplicate(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	id, permit, source, directory, input := onboardFixture("P-NEW", "create-1")
	result, err := OnboardWorkspace(context.Background(), db, id, permit, source, directory, input)
	if err != nil {
		t.Fatal(err)
	}
	var w Workspace
	if err := json.Unmarshal(result.Value, &w); err != nil {
		t.Fatal(err)
	}
	if w.Status != "active" || w.Revision != 1 || w.ProductCode != id.ProductCode || w.BizID == "" {
		t.Fatalf("workspace %#v", w)
	}
	replay, err := OnboardWorkspace(context.Background(), db, id, permit, source, directory, input)
	var replayWorkspace Workspace
	decodeErr := json.Unmarshal(replay.Value, &replayWorkspace)
	if err != nil || !replay.Replayed || decodeErr != nil || !reflect.DeepEqual(replayWorkspace, w) {
		t.Fatalf("replay %#v %v", replay, err)
	}
	other := id
	other.IdempotencyKey = "create-2"
	if _, err := OnboardWorkspace(context.Background(), db, other, permit, source, directory, input); err == nil {
		t.Fatal("duplicate accepted")
	}
	input.Reason = "changed"
	if _, err := OnboardWorkspace(context.Background(), db, id, permit, source, directory, input); err == nil {
		t.Fatal("different payload replayed")
	}
	for _, table := range []string{"product_workspaces", "product_members", "product_activity_logs", "product_command_receipts"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 1 {
			t.Fatalf("%s count=%d err=%v", table, n, err)
		}
	}
	var relation, status string
	var expiry any
	if err := db.QueryRow(`SELECT relation_type,status,valid_until FROM product_members`).Scan(&relation, &status, &expiry); err != nil || relation != "manager" || status != "active" || expiry != nil {
		t.Fatalf("initial manager %s %s %v: %v", relation, status, expiry, err)
	}
}

func TestMySQLOnboardRejectsInvalidEvidenceWithoutResidue(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	for _, kind := range []string{"actor", "product", "source", "inactive", "directory", "expired", "future"} {
		t.Run(kind, func(t *testing.T) {
			id, p, s, d, i := onboardFixture("P-"+kind, "create")
			switch kind {
			case "actor":
				p.ActorUID = "other"
			case "product":
				p.ProductCode = "other"
			case "source":
				s.ProductCode = "other"
			case "inactive":
				s.Onboardable = false
			case "directory":
				d.ActiveUIDs = []string{"other"}
			case "expired":
				p.ExpiresAt = 1
			case "future":
				d.ExpiresAt = time.Now().Add(time.Hour).UnixMilli()
			}
			if _, err := OnboardWorkspace(context.Background(), db, id, p, s, d, i); err == nil {
				t.Fatal("invalid evidence accepted")
			}
		})
	}
	for _, table := range []string{"product_workspaces", "product_members", "product_activity_logs", "product_command_receipts"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s leaked %d: %v", table, n, err)
		}
	}
}

func TestMySQLOnboardAuditFailureRollsBack(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	if _, err := db.Exec(`CREATE TRIGGER reject_onboard_log BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit unavailable'`); err != nil {
		t.Fatal(err)
	}
	id, p, s, d, i := onboardFixture("P-FAIL", "create")
	if _, err := OnboardWorkspace(context.Background(), db, id, p, s, d, i); err == nil {
		t.Fatal("audit failure ignored")
	}
	for _, table := range []string{"product_workspaces", "product_members", "product_command_receipts"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s leaked %d: %v", table, n, err)
		}
	}
}

func TestMySQLOnboardConcurrentSameKeyCreatesOnce(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	id, p, s, d, i := onboardFixture("P-RACE", "create")
	var wg sync.WaitGroup
	results := make(chan CommandResult, 2)
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := OnboardWorkspace(context.Background(), db, id, p, s, d, i)
			results <- r
			errs <- e
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	replays := 0
	for r := range results {
		if r.Replayed {
			replays++
		}
	}
	if replays != 1 {
		t.Fatalf("replays=%d", replays)
	}
}

func TestMySQLOnboardReplayRevalidatesFreshEvidence(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	id, p, s, d, i := onboardFixture("P-REPLAY", "create")
	if _, err := OnboardWorkspace(context.Background(), db, id, p, s, d, i); err != nil {
		t.Fatal(err)
	}
	p.ExpiresAt = 1
	if _, err := OnboardWorkspace(context.Background(), db, id, p, s, d, i); err == nil {
		t.Fatal("expired authorization replayed")
	}
	_, p, s, d, _ = onboardFixture("P-REPLAY", "create")
	if _, err := db.Exec(`UPDATE product_workspaces SET status='archived',revision=2 WHERE product_code=?`, id.ProductCode); err != nil {
		t.Fatal(err)
	}
	id.IdempotencyKey = "another-create"
	if _, err := OnboardWorkspace(context.Background(), db, id, p, s, d, i); err == nil {
		t.Fatal("archived workspace reinitialized")
	}
	var status string
	var revision int
	if err := db.QueryRow(`SELECT status,revision FROM product_workspaces WHERE product_code=?`, id.ProductCode).Scan(&status, &revision); err != nil || status != "archived" || revision != 2 {
		t.Fatalf("archive lost %s %d %v", status, revision, err)
	}
}
