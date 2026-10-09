package enterpriseapf

import "testing"

func TestRenewalClosedOperationsAndNoAutomaticActions(t *testing.T) {
	if len(renewalOps) != 4 {
		t.Fatal("closed four operations")
	}
	for op, p := range renewalOps {
		resource, action, ok := SalesPermission(op)
		if !ok || resource != "renewal_opportunity" || action != p[1] {
			t.Fatal(op)
		}
	}
	good := SalesInput{Payload: map[string]any{"name": "续约", "customer_id": "1", "owner_uid": "person"}}
	if validateRenewal("renewals-create", good) != nil {
		t.Fatal("create")
	}
	for _, field := range []string{"opportunity_id", "maintenance_contract_id", "effective_to", "sourceApp", "actor", "row_version", "auto_extend"} {
		p := map[string]any{}
		for k, v := range good.Payload {
			p[k] = v
		}
		p[field] = "1"
		if validateRenewal("renewals-create", SalesInput{Payload: p}) == nil {
			t.Fatal(field)
		}
	}
	for _, p := range []map[string]any{{"expectedVersion": float64(0), "name": "x"}, {"expectedVersion": float64(1), "status": "activate"}, {"expectedVersion": float64(1), "expected_amount": "1.001"}, {"expectedVersion": float64(1), "expected_sign_date": "2026-02-30"}} {
		if validateRenewal("renewals-update", SalesInput{ID: "1", Payload: p}) == nil {
			t.Fatal(p)
		}
	}
	if validateRenewal("renewals-page", SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(101)}}) == nil {
		t.Fatal("unbounded")
	}
}
