package wizbiztool

import "testing"

func TestOpeningConfirmationClosed(t *testing.T) {
	data := SourceData{"wb_contract": {{"contract_id": "1", "contract_type": "1", "total_amount": "100.00", "exec_amount": "30.00"}}, "wb_project_income": {{"contract_id": "1", "amount": "80.00"}}}
	c := OpeningConfirmation{Contracts: []OpeningConfirmedRow{{SourcePK: "1", Amount: "25.00"}}}
	rows, total, err := openingRows(data, c)
	if err != nil || rows[0].Candidate != "30.00" || !rows[0].Differs || total != "25.00" {
		t.Fatal("cache mismatch/override", err)
	}
	if rows, total, err = openingRows(data, OpeningConfirmation{}); err != nil || len(rows) != 0 || total != "0.00" {
		t.Fatal("missing confirmation generated rows")
	}
	for _, bad := range []OpeningConfirmation{{Contracts: []OpeningConfirmedRow{{SourcePK: "2", Amount: "1.00"}}}, {Contracts: []OpeningConfirmedRow{{SourcePK: "1", Amount: "0.00"}}}, {Contracts: []OpeningConfirmedRow{{SourcePK: "1", Amount: "1.00"}, {SourcePK: "1", Amount: "1.00"}}}} {
		if _, _, err = openingRows(data, bad); err == nil {
			t.Fatal("invalid finance confirmation accepted")
		}
	}
	data["wb_contract"][0]["contract_type"] = "0"
	if _, _, err = openingRows(data, c); err == nil {
		t.Fatal("purchase opening accepted")
	}
}
