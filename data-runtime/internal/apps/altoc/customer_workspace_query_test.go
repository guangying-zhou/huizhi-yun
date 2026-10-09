package altoc

import "testing"

func TestCustomerWorkspaceQueryValidation(t *testing.T) {
	valid := []BasicReadQuery{{OwnerUID: "person", IndustryCode: "IT", RegionCode: "SD", CustomerSort: "updated_desc", UpdatedDateFrom: "2024-02-29", UpdatedDateTo: "2026-01-01"}, {ContactsOnly: true, DecisionRole: "decision_maker", PrimaryOnly: true, StarredOnly: true}, {Workspace: true}}
	for _, q := range valid {
		q.Page = 1
		q.PageSize = 20
		if e := q.Validate("customer"); e != nil {
			t.Fatal(q, e)
		}
		if e := q.Validate("contract"); e == nil {
			t.Fatal("customer query accepted for contract", q)
		}
	}
	invalid := []BasicReadQuery{{CustomerSort: "name;DROP"}, {UpdatedDateFrom: "2026-02-30"}, {UpdatedDateFrom: "2026-02-02", UpdatedDateTo: "2026-01-01"}, {ContactsOnly: true, OwnerUID: "person"}, {ContactsOnly: true, Workspace: true}, {ContactsOnly: true, RootsOnly: true}, {DecisionRole: "buyer"}, {PrimaryOnly: true}, {StarredOnly: true}, {IndustryCode: "x\x00"}, {ContactsOnly: true, CustomerID: "2"}}
	for _, q := range invalid {
		q.Page = 1
		q.PageSize = 20
		if e := q.Validate("customer"); e == nil {
			t.Fatal("unsafe query accepted", q)
		}
	}
}
