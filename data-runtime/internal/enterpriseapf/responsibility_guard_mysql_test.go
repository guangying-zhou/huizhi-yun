package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/directory"
)

// Exercise the production Directory reader, including exact-case uid lookup,
// missing users and non-login statuses, on the same disposable MySQL fixture.
func installOwnerDirectory(t *testing.T, s *Service, db *sql.DB) {
	t.Helper()
	for _, q := range []string{
		"CREATE TABLE directory_users(uid VARCHAR(64) PRIMARY KEY,status VARCHAR(30) NOT NULL)",
		"INSERT INTO directory_users VALUES('Active','active'),('disabled','disabled'),('inactive','inactive'),('pending','pending')",
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	s.ConfigureOwnerDirectory(directory.NewWithDB(db, s.binding.Key.Tenant, "", "").EnterpriseActiveUser)
	// Any accidental Directory lookup inside a business transaction would block.
	db.SetMaxOpenConns(1)
}

func TestAPFFinanceResponsibilityGuardMySQL(t *testing.T) {
	s, db := financeLedgerFixture(t)
	installOwnerDirectory(t, s, db)
	ctx := context.Background()
	all := altoc.BasicReadScope{Access: "all"}
	who := Identity{Actor: "maker", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime"}
	n := 0
	call := func(op, code string, payload map[string]any) (map[string]any, error) {
		t.Helper()
		n++
		who.Key = fmt.Sprintf("responsibility-%d", n)
		out, err := s.FinanceLedger(ctx, op, FinanceInput{Code: code, Payload: payload}, who, all)
		if err != nil {
			return nil, err
		}
		return out.(map[string]any)["data"].(map[string]any), nil
	}
	req, err := call("invoice-requests-create", "", map[string]any{"requestedAmount": "10.00", "currencyCode": "CNY", "invoiceItem": "isolated", "taxpayerName": "isolated"})
	if err != nil {
		t.Fatal(err)
	}
	ir := fmt.Sprint(req["code"])
	// Seed the existing approval prerequisite; this suite does not bypass it in
	// production or add an approval command to the B3 fixture.
	if _, err = db.Exec("UPDATE finance_invoice_request SET status='approved',workflow_instance_id='fixture-approved' WHERE code=?", ir); err != nil {
		t.Fatal(err)
	}
	receiptPayload := func(uid string) map[string]any {
		return map[string]any{"receivedAmount": "10.00", "currencyCode": "CNY", "receivedAt": "2026-10-04", "responsibleUid": uid, "dueAt": "2026-10-10 00:00:00"}
	}
	for _, uid := range []string{ReservedUnassignedOwner, "SYSTEM:x", "client:finance.runtime", "missing", "active", "disabled", "inactive", "pending"} {
		want := "apf_owner_not_active"
		if ReservedOwner(uid) || ownerShapeInvalid(uid) {
			want = "apf_owner_invalid"
		}
		for _, op := range []string{"receipts-create", "invoice-requests-assign-issuance"} {
			p, code := receiptPayload(uid), ""
			if op == "invoice-requests-assign-issuance" {
				p, code = map[string]any{"expectedVersion": float64(1), "responsibleUid": uid, "dueAt": "2026-10-10 00:00:00"}, ir
			}
			if _, err := call(op, code, p); err == nil {
				t.Fatalf("%s accepted %q", op, uid)
			} else if status, got := ownerErrorCode(err); status != 400 || got != want {
				t.Fatalf("%s %q: %v", op, uid, err)
			}
		}
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM finance_receipt").Scan(&count); err != nil || count != 0 {
		t.Fatalf("rejected creates wrote rows: %d %v", count, err)
	}
	if _, err = call("invoice-requests-assign-issuance", ir, map[string]any{"expectedVersion": float64(1), "responsibleUid": "Active", "dueAt": "2026-10-10 00:00:00"}); err != nil {
		t.Fatal(err)
	}
	rc, err := call("receipts-create", "", receiptPayload("Active"))
	if err != nil {
		t.Fatal(err)
	}
	rcCode := fmt.Sprint(rc["code"])
	if _, err = call("receipts-update", rcCode, map[string]any{"expectedVersion": float64(1), "responsibleUid": ReservedUnassignedOwner, "dueAt": "2026-10-10 00:00:00"}); err == nil {
		t.Fatal("reserved receipt reassignment accepted")
	}
	// Simulate a pre-existing migration row; do not normalize it on read/update.
	if _, err = db.Exec("UPDATE finance_receipt SET reconciliation_responsible_uid=? WHERE code=?", ReservedUnassignedOwner, rcCode); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE finance_invoice_request SET issuance_responsible_uid=? WHERE code=?", ReservedUnassignedOwner, ir); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DROP TABLE directory_users"); err != nil {
		t.Fatal(err)
	}
	for op, code := range map[string]string{"receipts-detail": rcCode, "invoice-requests-detail": ir} {
		row, err := call(op, code, nil)
		if err != nil {
			t.Fatal(op, err)
		}
		column := "reconciliation_responsible_uid"
		if op == "invoice-requests-detail" {
			column = "issuance_responsible_uid"
		}
		if row[column] != ReservedUnassignedOwner {
			t.Fatalf("historical value changed: %v", row)
		}
	}
	if _, err = call("receipts-update", rcCode, map[string]any{"expectedVersion": float64(1), "note": "history preserved"}); err != nil {
		t.Fatal(err)
	}
	if _, err = call("receipts-update", rcCode, map[string]any{"expectedVersion": float64(2), "responsibleUid": "Active", "dueAt": "2026-10-10 00:00:00"}); err == nil {
		t.Fatal("Directory failure accepted")
	} else if status, code := ownerErrorCode(err); status != 503 || code != "directory_subject_status_unavailable" {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM finance_receipt WHERE code=? AND reconciliation_responsible_uid=? AND row_version=2", rcCode, ReservedUnassignedOwner).Scan(&count); err != nil || count != 1 {
		t.Fatalf("failed assignment changed historical row: %d %v", count, err)
	}
}

func TestAPFInheritedSalesResponsibilityGuardMySQL(t *testing.T) {
	s, db := salesFixture(t)
	installOwnerDirectory(t, s, db)
	ctx := context.Background()
	who := Identity{Actor: "Active", Tenant: s.binding.Key.Tenant, Deployment: "host-test", Client: "enterprise.runtime"}
	all := altoc.BasicReadScope{Access: "all"}
	n := 0
	call := func(op, id string, payload map[string]any) (map[string]any, error) {
		n++
		who.Key = fmt.Sprintf("inherited-%d", n)
		out, err := s.Sales(ctx, op, SalesInput{ID: id, Payload: payload}, who, all)
		if err != nil {
			return nil, err
		}
		return out.(map[string]any)["data"].(map[string]any), nil
	}
	lead, err := call("leads-create", "", map[string]any{"name": "owner guard", "org_name": "isolated", "source_type": "referral", "need_summary": "test", "contact_name": "contact", "owner_uid": "Active", "next_action": "initial task", "next_action_due_at": "2026-10-10 00:00:00"})
	if err != nil {
		t.Fatal(err)
	}
	id := fmt.Sprint(lead["id"])
	if _, err = db.Exec("DELETE FROM altoc_sales_task"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE altoc_lead SET next_action=NULL,next_action_due_at=NULL WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	for _, uid := range []string{ReservedUnassignedOwner, "disabled", "missing"} {
		if _, err = db.Exec("UPDATE altoc_lead SET owner_uid=? WHERE id=?", uid, id); err != nil {
			t.Fatal(err)
		}
		for _, op := range []string{"leads-update", "leads-convert"} {
			p := map[string]any{"expectedVersion": float64(1)}
			if op == "leads-update" {
				p["next_action"], p["next_action_due_at"] = "new task", "2026-10-10 00:00:00"
			}
			if _, err = call(op, id, p); err == nil {
				t.Fatalf("%s inherited invalid uid %q", op, uid)
			} else if status, _ := ownerErrorCode(err); status != 400 {
				t.Fatal(err)
			}
		}
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM altoc_sales_task").Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid owner created tasks: %d %v", count, err)
	}
	if _, err = call("leads-update", id, map[string]any{"expectedVersion": float64(1), "name": "historical owner retained"}); err != nil {
		t.Fatal(err)
	}
	if _, err = call("leads-assign", id, map[string]any{"expectedVersion": float64(2), "owner_uid": "Active"}); err != nil {
		t.Fatal(err)
	}
	if _, err = call("leads-update", id, map[string]any{"expectedVersion": float64(3), "next_action": "new task", "next_action_due_at": "2026-10-10 00:00:00"}); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM altoc_sales_task WHERE assignee_uid='Active'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("valid task missing: %d %v", count, err)
	}
	if _, err = db.Exec("UPDATE directory_users SET status='disabled' WHERE uid='Active'"); err != nil {
		t.Fatal(err)
	}
	// Matching existing task is not a new assignment, so it remains usable.
	if _, err = call("leads-update", id, map[string]any{"expectedVersion": float64(4), "name": "no new assignment"}); err != nil {
		t.Fatal(err)
	}
	if _, err = call("leads-update", id, map[string]any{"expectedVersion": float64(5), "next_action": "another task"}); err == nil {
		t.Fatal("new task assigned to disabled inherited owner")
	}
	// Change the source owner between Directory pre-read and business locking.
	// The check for Active must not authorize a task assigned to someone else.
	if _, err = db.Exec("UPDATE directory_users SET status='active' WHERE uid='Active'"); err != nil {
		t.Fatal(err)
	}
	reader := directory.NewWithDB(db, s.binding.Key.Tenant, "", "").EnterpriseActiveUser
	s.ConfigureOwnerDirectory(func(ctx context.Context, uid string) (bool, error) {
		active, err := reader(ctx, uid)
		if err == nil {
			_, err = db.ExecContext(ctx, "UPDATE altoc_lead SET owner_uid='disabled' WHERE id=?", id)
		}
		return active, err
	})
	if _, err = call("leads-update", id, map[string]any{"expectedVersion": float64(5), "next_action": "racing assignment"}); err == nil {
		t.Fatal("another uid consumed the Directory check")
	} else if status, code := ownerErrorCode(err); status != 409 || code != "altoc_sales_owner_changed" {
		t.Fatal(err)
	}
	s.ConfigureOwnerDirectory(reader)
	if _, err = db.Exec("DROP TABLE directory_users"); err != nil {
		t.Fatal(err)
	}
	if _, err = call("leads-update", id, map[string]any{"expectedVersion": float64(5), "next_action": "unverifiable assignment"}); err == nil {
		t.Fatal("Directory failure accepted for an inherited assignment")
	} else if status, code := ownerErrorCode(err); status != 503 || code != "directory_subject_status_unavailable" {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM altoc_sales_task").Scan(&count); err != nil || count != 1 {
		t.Fatalf("refused assignment added a task: %d %v", count, err)
	}
}
