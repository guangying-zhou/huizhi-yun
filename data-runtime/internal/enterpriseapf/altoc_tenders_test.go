package enterpriseapf

import "testing"

func TestTenderClosedOperationsAndValidation(t *testing.T) {
	if len(tenderOps) != 10 {
		t.Fatal("operation budget")
	}
	for op, p := range tenderOps {
		r, a, ok := SalesPermission(op)
		if !ok || r != "opportunity" || a != p[1] {
			t.Fatal(op, r, a)
		}
	}
	valid := SalesInput{Payload: map[string]any{"name": "标记", "owner_uid": "person", "budget_amount": "12.30", "bid_submission_deadline": "2026-10-10"}}
	if e := ValidateSalesInput("tenders-create", valid); e != nil {
		t.Fatal(e)
	}
	for k, v := range map[string]any{"owner_uid": "", "budget_amount": "-1", "bid_submission_deadline": "invalid", "status": "approved", "actor": "forged", "row_version": float64(1)} {
		p := map[string]any{}
		for k, v := range valid.Payload {
			p[k] = v
		}
		p[k] = v
		if ValidateSalesInput("tenders-create", SalesInput{Payload: p}) == nil {
			t.Fatal(k, "accepted")
		}
	}
	for _, op := range []string{"tenders-update", "tender-members-add", "tender-members-remove", "tender-milestones-create", "tender-milestones-update"} {
		if ValidateSalesInput(op, SalesInput{ID: "1", Payload: map[string]any{}}) == nil {
			t.Fatal("missing version", op)
		}
	}
	if ValidateSalesInput("tenders-view", SalesInput{ID: "1", Payload: map[string]any{"scope": "all"}}) == nil {
		t.Fatal("read body facts")
	}
	if IsTenderOperation("tenders-delete") {
		t.Fatal("generic operation")
	}
}
