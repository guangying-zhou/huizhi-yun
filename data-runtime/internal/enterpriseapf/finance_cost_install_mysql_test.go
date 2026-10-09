package enterpriseapf

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"testing"
)

// The fixture uses only the harness-created isolated schema, never hzy0.
func TestAPF14aCostInstallerMySQL(t *testing.T) {
	s, db := financeSpendFixture(t)
	ctx := context.Background()
	b, e := domaininstall.WithFinanceCost(s.binding)
	if e != nil {
		t.Fatal(e)
	}
	i := domaininstall.ForFinanceCost(domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, OwnerDeployment: "host-test", Address: b.Storage.Address})
	p, e := i.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	var receipt domaininstall.Receipt
	save := func(r domaininstall.Receipt) error { receipt = r; return nil }
	off := func(context.Context) error { return nil } // isolated fixture only
	if e = i.Apply(ctx, db, p, off, save); e != nil {
		t.Fatal(e)
	}
	if e = i.Verify(ctx, db, p); e != nil {
		t.Fatal(e)
	}
	if e = i.VerifyReceipt(ctx, db, receipt); e != nil {
		t.Fatal(e)
	}
	if len(receipt.Created) != 6 {
		t.Fatal("wrong subset", len(receipt.Created))
	}
	if _, e = db.Exec("INSERT INTO finance_project_cost_period(project_code,period_month,closed_at) VALUES('P1','2026-10',NOW())"); e == nil {
		t.Fatal("close without actor accepted")
	}
	if _, e = db.Exec("INSERT INTO finance_project_cost_period(project_code,period_month) VALUES('P1','2026-10')"); e != nil {
		t.Fatal(e)
	}
	if i.Rollback(ctx, db, receipt, off) == nil {
		t.Fatal("nonempty rollback accepted")
	}
	if _, e = db.Exec("DELETE FROM finance_project_cost_period"); e != nil {
		t.Fatal(e)
	}
	if e = i.Rollback(ctx, db, receipt, off); e != nil {
		t.Fatal(e)
	}
	// Replan/reapply uses new baseline evidence; no receipt/hash rewriting.
	p, e = i.PlanInstall(ctx, db, b)
	if e != nil {
		t.Fatal(e)
	}
	if e = i.Apply(ctx, db, p, off, save); e != nil {
		t.Fatal(e)
	}
	if e = i.VerifyReceipt(ctx, db, receipt); e != nil {
		t.Fatal(e)
	}
}
