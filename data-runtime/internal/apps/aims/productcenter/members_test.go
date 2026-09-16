package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"
)

func managerFixture(t *testing.T, db *sql.DB, code, uid string) int64 {
	t.Helper()
	res, err := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES (?,?,'manager','active',UTC_TIMESTAMP(3)-INTERVAL 1 DAY,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code, uid)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestMySQLConcurrentMemberRevocationKeepsManager(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	ids := []int64{managerFixture(t, db, "P-A", "pm1"), managerFixture(t, db, "P-A", "pm2")}
	permit := workspacePermit(t, db, "P-A", "admin", "admin")
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			uid := fmt.Sprintf("pm%d", i+1)
			other := fmt.Sprintf("pm%d", 2-i)
			_, err := ChangeMember(context.Background(), db, CommandIdentity{ProductCode: "P-A", ActorUID: "admin", Action: "products:member-revoke", IdempotencyKey: uid}, permit, memberEvidence(other), MemberChange{MemberID: ids[i], UID: uid, ExpectedRevision: 1, ExpectedMemberRevision: 1, ContinuingManagerUID: other, Reason: "交接"})
			results <- err
		}(i)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			requireProductRule(t, err, "product_authorization_changed")
		}
	}
	if success != 1 {
		t.Fatalf("concurrent successful revocations=%d", success)
	}
	var remaining int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_members WHERE product_code='P-A' AND relation_type='manager' AND status='active'`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 1 {
		t.Fatalf("remaining managers=%d", remaining)
	}
}
func memberEvidence(uids ...string) MemberDirectoryEvidence {
	return MemberDirectoryEvidence{ActiveUIDs: uids, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
}
func memberCreateInput(uid string) MemberChange {
	return MemberChange{UID: uid, ExpectedRevision: 1, RelationType: "contributor", Status: "active", ValidFrom: "2020-01-01T00:00:00.000Z", ContinuingManagerUID: "pm", Reason: "加入产品团队"}
}

func TestMySQLMemberLifecycleAndLastManager(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	managerID := managerFixture(t, db, "P-A", "pm")
	ctx := context.Background()
	id := CommandIdentity{ProductCode: "P-A", ActorUID: "pm", Action: "products:member-create", IdempotencyKey: "add"}
	input := memberCreateInput("dev")
	result, err := ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm", "dev"), input)
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		Member            Member `json:"member"`
		WorkspaceRevision uint64 `json:"workspace_revision"`
	}
	if err := json.Unmarshal(result.Value, &value); err != nil {
		t.Fatal(err)
	}
	if value.Member.UID != "dev" || value.Member.Revision != 1 || value.WorkspaceRevision != 2 || !value.Member.Effective {
		t.Fatalf("create: %+v", value)
	}
	replayed, err := ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm", "dev"), input)
	if err != nil || !replayed.Replayed {
		t.Fatalf("replay: %+v %v", replayed, err)
	}
	id.IdempotencyKey = "duplicate"
	input.ExpectedRevision = 2
	if _, err := ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm", "dev"), input); err == nil {
		t.Fatal("duplicate relation accepted")
	}
	// Removing or downgrading the only current manager must roll back.
	id.Action, id.IdempotencyKey = "products:member-revoke", "last"
	revoke := MemberChange{MemberID: managerID, ExpectedRevision: 2, ExpectedMemberRevision: 1, UID: "pm", ContinuingManagerUID: "pm", Reason: "交接"}
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm"), revoke)
	requireProductRule(t, err, "product_last_manager")
	id.Action, id.IdempotencyKey = "products:member-update", "downgrade"
	down := memberCreateInput("pm")
	down.MemberID = managerID
	down.ExpectedMemberRevision = 1
	down.ExpectedRevision = 2
	down.RelationType = "viewer"
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm"), down)
	requireProductRule(t, err, "product_last_manager")
	// Establish a verified successor, then revoke the original manager.
	id.Action, id.IdempotencyKey = "products:member-update", "promote"
	input.MemberID = value.Member.ID
	input.ExpectedMemberRevision = 1
	input.RelationType = "manager"
	input.ContinuingManagerUID = "dev"
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("dev"), input)
	if err != nil {
		t.Fatal(err)
	}
	id.Action, id.IdempotencyKey = "products:member-revoke", "handover"
	revoke.ExpectedRevision = 3
	revoke.ContinuingManagerUID = "dev"
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("dev"), revoke)
	if err != nil {
		t.Fatal(err)
	}
	facts, err := LoadAuthorizationFacts(ctx, db, "P-A", "pm")
	if err != nil || facts.IsManager || facts.IsMember {
		t.Fatalf("revoked facts: %+v %v", facts, err)
	}
	page, err := ListMembers(ctx, db, "P-A", "dev", workspacePermit(t, db, "P-A", "dev", "admin"), MemberPageQuery{Page: 1, PageSize: 10})
	if err != nil || page.Total != 2 || page.WorkspaceRevision != 4 {
		t.Fatalf("members: %+v %v", page, err)
	}
	var audits, receipts int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if audits != 3 || receipts != 3 {
		t.Fatalf("failed mutations leaked: audits=%d receipts=%d", audits, receipts)
	}
}

func TestMySQLMemberRequiresDirectoryAndSameProduct(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	workspaceFixture(t, db, "P-B")
	managerFixture(t, db, "P-A", "pm")
	otherID := managerFixture(t, db, "P-B", "other")
	ctx := context.Background()
	id := CommandIdentity{ProductCode: "P-A", ActorUID: "pm", Action: "products:member-create", IdempotencyKey: "new"}
	input := memberCreateInput("dev")
	_, err := ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm"), input)
	requireProductRule(t, err, "product_member_subject_inactive")
	input.Status = "inactive"
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm"), input)
	requireProductRule(t, err, "product_member_subject_inactive")
	input.Status = "active"
	expired := memberEvidence("pm", "dev")
	expired.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), expired, input)
	requireProductRule(t, err, "product_directory_evidence_invalid")
	input.ContinuingManagerUID = "other"
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("dev", "other"), input)
	requireProductRule(t, err, "product_last_manager")
	id.Action = "products:member-revoke"
	input.MemberID = otherID
	input.ExpectedMemberRevision = 1
	input.UID = "other"
	input.ContinuingManagerUID = "pm"
	if _, err := ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm"), input); err != sql.ErrNoRows {
		t.Fatalf("cross-product relation: %v", err)
	}
	id.Action = "products:member-create"
	input = memberCreateInput("new-manager")
	input.RelationType = "manager"
	input.ContinuingManagerUID = "new-manager"
	input.ValidFrom = "2099-01-01T00:00:00.000Z"
	_, err = ChangeMember(ctx, db, id, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("new-manager"), input)
	requireProductRule(t, err, "product_last_manager")
}

func TestMySQLMemberPaginationAndRevisionConflict(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	managerFixture(t, db, "P-A", "pm")
	for i := 0; i < 101; i++ {
		managerFixture(t, db, "P-A", fmt.Sprintf("u%03d", i))
	}
	ctx := context.Background()
	page, err := ListMembers(ctx, db, "P-A", "pm", workspacePermit(t, db, "P-A", "pm", "admin"), MemberPageQuery{Page: 2, PageSize: 100, RelationType: "manager"})
	if err != nil || page.Total != 102 || len(page.Items) != 2 || page.Items[0].UID != "u099" {
		t.Fatalf("page two: %+v %v", page, err)
	}
	input := memberCreateInput("dev")
	input.ExpectedRevision = 2
	_, err = ChangeMember(ctx, db, CommandIdentity{ProductCode: "P-A", ActorUID: "pm", Action: "products:member-create", IdempotencyKey: "stale"}, workspacePermit(t, db, "P-A", "pm", "admin"), memberEvidence("pm", "dev"), input)
	requireProductRule(t, err, "product_revision_conflict")
}
