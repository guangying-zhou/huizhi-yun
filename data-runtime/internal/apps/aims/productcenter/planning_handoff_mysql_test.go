package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

// Uses a transaction-local project-side fixture to inject downstream failures.
// Production project eligibility and requirement creation are adapter concerns.
func exerciseHandoffTransaction(t *testing.T, db *sql.DB, check PlanningDeliveryCheck) PlanningDeliveryCheck {
	t.Helper()
	ctx := context.Background()
	if _, err := db.Exec(`CREATE TABLE pc_handoff_test_drafts(id BIGINT PRIMARY KEY AUTO_INCREMENT,title VARCHAR(500)) ENGINE=InnoDB`); err != nil {
		t.Fatal(err)
	}
	input := handoffInput()
	input.PlanningDeliveryCheck = check
	identity := CommandIdentity{ProductCode: "P-SELECT", ActorUID: "pm", Action: "product_priorities:handoff", IdempotencyKey: "handoff"}
	denied := errors.New("project access revoked")
	allow := true
	calls := 0
	target := PlanningHandoffTarget{
		AuthorizeProject: func(context.Context, *sql.Tx) (int64, error) {
			if !allow {
				return 0, denied
			}
			return 42, nil
		},
		ResolveRequirement: func(ctx context.Context, tx *sql.Tx) (int64, error) {
			calls++
			r, err := tx.ExecContext(ctx, `INSERT INTO pc_handoff_test_drafts(title) VALUES(?)`, input.Title)
			if err != nil {
				return 0, err
			}
			return r.LastInsertId()
		},
	}
	run := func() (CommandResult, error) {
		p := workspacePermit(t, db, "P-SELECT", "pm", "handoff")
		p.Resource = "product_priorities"
		return HandoffPlanningItem(ctx, db, identity, p, AuthorizationPermit{}, input, target)
	}
	// Fail after the project draft and source link have both been inserted.
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_handoff BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='handoff audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err := run(); err == nil {
		t.Fatal("audit failure committed")
	}
	for _, table := range []string{"pc_handoff_test_drafts", "product_request_delivery_links"} {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("rollback %s: %d %v", table, n, err)
		}
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts WHERE action='product_priorities:handoff'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("rollback receipt: %d %v", n, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_handoff`); err != nil {
		t.Fatal(err)
	}
	result, err := run()
	if err != nil {
		t.Fatal(err)
	}
	beforeReplay := calls
	replay, err := run()
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID || calls != beforeReplay {
		t.Fatalf("replay %+v %v calls=%d", replay, err, calls)
	}
	allow = false
	if _, err = run(); !errors.Is(err, denied) {
		t.Fatalf("revoked replay: %v", err)
	}
	allow = true
	input.ExpectedRevision++
	input.ExpectedItemRevision++
	identity.IdempotencyKey = "same-slice-new-key"
	if _, err = run(); err != nil || calls != beforeReplay {
		t.Fatalf("slice replay: %v calls=%d", err, calls)
	}
	identity.IdempotencyKey = "different-scope"
	input.ScopeSummary = "不同范围"
	_, err = run()
	requireProductRule(t, err, "planning_handoff_slice_conflict")
	for _, table := range []string{"pc_handoff_test_drafts", "product_request_delivery_links"} {
		if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil || n != 1 {
			t.Fatalf("committed %s: %d %v", table, n, err)
		}
	}
	check.ExpectedRevision++
	check.ExpectedItemRevision++
	return check
}
