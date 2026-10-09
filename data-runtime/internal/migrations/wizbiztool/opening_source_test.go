package wizbiztool

import (
	"strings"
	"testing"
)

func TestOpeningUserRulingSnapshotClosed(t *testing.T) {
	m := SnapshotManifest{SnapshotID: "20261004T173356Z", SQLSHA256: strings.Repeat("a", 64)}
	data := SourceData{"wb_contract": {{"contract_id": "1", "contract_type": "1", "total_amount": "100.00", "exec_amount": "30.00", "prime_amount": "10.00", "tax_rate": "13.00"}, {"contract_id": "2", "contract_type": "1", "total_amount": "60.00", "exec_amount": "60.00"}, {"contract_id": "3", "contract_type": "0", "total_amount": "90.00", "exec_amount": "90.00"}, {"contract_id": "4", "contract_type": "1", "total_amount": "0.00", "exec_amount": "0.00"}}, "wb_project_income": {{"contract_id": "1", "amount": "80.00"}}}
	rows, err := deriveOpeningRows(data)
	if err != nil || len(rows) != 2 || rows[0].Amount != "30.00" || rows[1].Amount != "60.00" {
		t.Fatal("snapshot candidate basis, no effective/tax deduction")
	}
	c := OpeningConfirmation{SourceType: OpeningSourceUserSnapshot, SourceSQLSHA256: m.SQLSHA256, RulesVersion: OpeningRulesVersion, AsOfDate: "2026-10-04", Approver: "user", Date: "2026-10-06", Contracts: rows}
	c.Customers, _ = openingCustomerSummaries(data, rows)
	if validateOpeningSource(data, m, c) != nil {
		t.Fatal("ruling rejected")
	}
	for _, change := range []func(*OpeningConfirmation){func(x *OpeningConfirmation) { x.SourceType = "arbitrary" }, func(x *OpeningConfirmation) { x.SourceSQLSHA256 = strings.Repeat("b", 64) }, func(x *OpeningConfirmation) { x.AsOfDate = "2026-10-06" }, func(x *OpeningConfirmation) { x.RulesVersion = "other" }, func(x *OpeningConfirmation) { x.Contracts = x.Contracts[:1] }, func(x *OpeningConfirmation) {
		x.Contracts = append([]OpeningConfirmedRow{}, x.Contracts...)
		x.Contracts[0].Amount = "20.00"
	}, func(x *OpeningConfirmation) {
		x.Contracts = append([]OpeningConfirmedRow{}, x.Contracts...)
		d := "2026-10-04"
		x.Contracts[0].DueDate = &d
	}} {
		bad := c
		change(&bad)
		if validateOpeningSource(data, m, bad) == nil {
			t.Fatal("ruling provenance or incomplete/changed candidate accepted")
		}
	}
	if validateOpeningSource(data, m, OpeningConfirmation{SourceType: OpeningSourceFinance, Contracts: []OpeningConfirmedRow{{SourcePK: "1", Amount: "20.00"}}}) != nil {
		t.Fatal("manual retained")
	}
}
