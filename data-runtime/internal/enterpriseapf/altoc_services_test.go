package enterpriseapf

import (
	"fmt"
	"testing"
)

func serviceTestInput(op string) SalesInput {
	i := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "childId": "1"}}
	switch op {
	case "service-agreements-page":
		i.ID = ""
		fallthrough
	case "service-coverages-page", "service-projects-page":
		i.Payload = map[string]any{"page": float64(1), "pageSize": float64(20)}
	case "service-agreements-view":
		i.Payload = map[string]any{}
	case "service-agreements-create":
		i.ID = ""
		i.Payload = map[string]any{"name": "服务", "contract_id": "1"}
	case "service-agreements-update":
		i.Payload = map[string]any{"expectedVersion": float64(1), "name": "服务更新"}
	case "service-coverages-create", "service-coverages-resolve":
		i.Payload = map[string]any{"expectedVersion": float64(1), "target_type": "delivery_asset_environment", "delivery_asset_code": "DA-1", "environment_code": "ENV-1"}
		if op == "service-coverages-resolve" {
			i.Payload["childId"] = "1"
		}
	case "service-projects-bind":
		i.Payload = map[string]any{"expectedVersion": float64(1), "project_code": "PROJECT-1", "project_role": "maintenance"}
	}
	return i
}
func TestServiceAgreementClosedOperations(t *testing.T) {
	if len(serviceAgreementOps) != 14 {
		t.Fatal("budget")
	}
	for op, p := range serviceAgreementOps {
		i := serviceTestInput(op)
		if e := ValidateSalesInput(op, i); e != nil {
			t.Fatal(op, e)
		}
		r, a, ok := SalesPermission(op)
		if !ok || r != "contract" || a != p[1] {
			t.Fatal(op)
		}
		i.Payload["source_app"] = "forged"
		if ValidateSalesInput(op, i) == nil {
			t.Fatal("forged", op)
		}
	}
	for _, op := range []string{"service-coverages-confirm-legacy", "maintenance-create", "service-entitlements-update"} {
		if IsServiceAgreementOperation(op) {
			t.Fatal("legacy write")
		}
	}
	for _, target := range []string{"legacy", "delivery_asset", "delivery_asset_environment"} {
		i := serviceTestInput("service-coverages-create")
		i.Payload["target_type"] = target
		if target == "delivery_asset_environment" {
			i.Payload["delivery_asset_code"] = ""
		}
		if ValidateSalesInput("service-coverages-create", i) == nil {
			t.Fatal(fmt.Sprint(i))
		}
	}
}
