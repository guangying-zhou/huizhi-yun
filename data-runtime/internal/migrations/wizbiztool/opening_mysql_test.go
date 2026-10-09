package wizbiztool

import (
	"context"
	"testing"
)

func TestToolOpeningMySQL(t *testing.T) {
	f := newToolFixture(t)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	confirmation := OpeningConfirmation{BatchCode: "w2-opening", MainReviewHash: e.plan.ReviewHash, SnapshotSHA256: e.manifestHash, Approver: "fixture-finance", Date: "2024-02-01", Contracts: []OpeningConfirmedRow{{SourcePK: "1", Amount: "19.00"}}}
	hash := factsHash(confirmation)
	plan, err := e.openingPlan(ctx, confirmation, hash, func(context.Context, string, string, string) error { return nil })
	if err != nil {
		t.Fatal("opening plan", err)
	}
	if len(plan.Rows) != 1 || plan.Rows[0].Code != "BS-W000001" || !plan.Rows[0].Differs || plan.Total != "19.00" {
		t.Fatal("candidate / confirmation binding")
	}
	if _, err = e.openingApply(ctx, plan, confirmation, hash, func(context.Context, string, string, string) error { return nil }); err != nil {
		t.Fatal("opening apply", err)
	}
	if _, err = e.openingVerify(ctx, plan, confirmation, hash); err != nil {
		t.Fatal("opening verify", err)
	}
	if _, err = e.openingApply(ctx, plan, confirmation, hash, func(context.Context, string, string, string) error { return nil }); err != nil {
		t.Fatal("opening replay", err)
	}
	if _, err = e.rollback(ctx); err != ErrUsed {
		t.Fatal("main rollback must follow opening rollback", err)
	}
	var schedules int
	if f.target.QueryRow("SELECT COUNT(*) FROM altoc_billing_schedule").Scan(&schedules) != nil || schedules != 1 {
		t.Fatal("replay duplicated opening")
	}
	if _, err = f.target.Exec("UPDATE altoc_billing_schedule SET amount=amount+1"); err != nil {
		t.Fatal(err)
	}
	result, err := e.openingVerify(ctx, plan, confirmation, hash)
	if err == nil || len(result.Differences) == 0 {
		t.Fatal("opening mutation undetected")
	}
	receipt, err := e.openingRollback(ctx, plan)
	if err != nil || receipt.Status != "rollback_partial" || receipt.Retained != 1 {
		t.Fatal("modified opening removed", err)
	}
	if _, err = f.target.Exec("UPDATE altoc_billing_schedule SET amount=amount-1"); err != nil {
		t.Fatal(err)
	}
	// An external mutation is not magically reset by correcting the amount.
	receipt, err = e.openingRollback(ctx, plan)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Retained != 1 {
		t.Fatal("changed row must remain retained")
	}
}

func TestToolOpeningCleanRollbackMySQL(t *testing.T) {
	f := newToolFixture(t)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	c := OpeningConfirmation{BatchCode: "w2-opening", MainReviewHash: e.plan.ReviewHash, SnapshotSHA256: e.manifestHash, Approver: "fixture", Date: "2024-02-01", Contracts: []OpeningConfirmedRow{{SourcePK: "1", Amount: "20.00"}}}
	hash := factsHash(c)
	p, err := e.openingPlan(ctx, c, hash, func(context.Context, string, string, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.openingApply(ctx, p, c, hash, func(context.Context, string, string, string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err = f.root.Exec("INSERT INTO `" + f.profile.Database + "`.finance_invoice(code,invoice_amount,billing_schedule_code) VALUES('fixture-opening-invoice',20.00,'BS-W000001')"); err != nil {
		t.Fatal("synthetic invoice reference", err)
	}
	retained, err := e.openingRollback(ctx, p)
	if err != nil || retained.Retained != 1 {
		t.Fatal("invoice reference must retain opening", err)
	}
	if _, err = f.root.Exec("DELETE FROM `" + f.profile.Database + "`.finance_invoice WHERE code='fixture-opening-invoice'"); err != nil {
		t.Fatal(err)
	}
	r, err := f.root.Exec("INSERT INTO `" + f.profile.Database + "`.finance_receipt(code,received_amount,received_at) VALUES('fixture-opening-receipt',20.00,'2024-02-01')")
	if err != nil {
		t.Fatal("synthetic receipt", err)
	}
	receiptID, err := r.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.root.Exec("INSERT INTO `"+f.profile.Database+"`.finance_reconciliation(code,receipt_id,target_type,billing_schedule_code,reconciled_amount,reconciled_at,idempotency_key) VALUES('fixture-opening-reconciliation',?,'billing_schedule','BS-W000001',20.00,UTC_TIMESTAMP(3),'fixture-opening-reconciliation')", receiptID); err != nil {
		t.Fatal("synthetic reconciliation", err)
	}
	retained, err = e.openingRollback(ctx, p)
	if err != nil || retained.Retained != 1 {
		t.Fatal("reconciliation must retain opening", err)
	}
	if _, err = f.root.Exec("DELETE FROM `" + f.profile.Database + "`.finance_reconciliation WHERE code='fixture-opening-reconciliation'"); err != nil {
		t.Fatal(err)
	}
	if _, err = f.root.Exec("DELETE FROM `" + f.profile.Database + "`.finance_receipt WHERE code='fixture-opening-receipt'"); err != nil {
		t.Fatal(err)
	}
	receipt, err := e.openingRollback(ctx, p)
	if err != nil || receipt.Status != "rolled_back" {
		t.Fatal("opening rollback", err)
	}
	if _, err = e.openingRollback(ctx, p); err != nil {
		t.Fatal("opening rollback replay", err)
	}
	if _, err = e.rollback(ctx); err != nil {
		t.Fatal("main rollback after opening", err)
	}
}

func TestToolOpeningUserSnapshotMySQL(t *testing.T) {
	f := newToolFixture(t)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal("main apply", err)
	}
	header := OpeningConfirmation{BatchCode: "w2-user-opening", MainReviewHash: e.plan.ReviewHash, SnapshotSHA256: e.manifestHash, Approver: "fixture-user", Date: "2026-10-06", SourceType: OpeningSourceUserSnapshot, SourceSQLSHA256: f.manifest.SQLSHA256, RulesVersion: OpeningRulesVersion, AsOfDate: "2024-02-01"}
	c, err := DeriveOpeningConfirmation(ctx, e.source, f.manifest, f.manifestHash, e.plan, header)
	if err != nil {
		t.Fatal("derive", err)
	}
	hash := factsHash(c)
	p, err := e.openingPlan(ctx, c, hash, func(context.Context, string, string, string) error { return nil })
	if err != nil {
		t.Fatal("plan", err)
	}
	if len(p.Rows) != 1 || p.Total != "20.00" || p.Rows[0].Differs {
		t.Fatal("snapshot basis changed")
	}
	for i := 0; i < 2; i++ {
		if _, err = e.openingApply(ctx, p, c, hash, func(context.Context, string, string, string) error { return nil }); err != nil {
			t.Fatal("apply/replay", err)
		}
	}
	if _, err = e.openingVerify(ctx, p, c, hash); err != nil {
		t.Fatal("verify", err)
	}
	receipt, err := e.openingRollback(ctx, p)
	if err != nil || receipt.Status != "rolled_back" || receipt.Retained != 0 {
		t.Fatal("rollback", err)
	}
	var n int
	if f.target.QueryRow("SELECT COUNT(*) FROM altoc_billing_schedule WHERE plan_type='opening_balance'").Scan(&n) != nil || n != 0 {
		t.Fatal("opening retained")
	}
}
