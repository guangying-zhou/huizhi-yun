package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"testing"
)

func TestAPFCustomerClosedCommand(t *testing.T) {
	for _, op := range []string{"customers-create", "customers-update", "customers-set-owner", "contacts-create", "contacts-update", "contacts-delete", "invoice-profiles-create", "invoice-profiles-update", "invoice-profiles-delete", "invoice-profiles-set-default"} {
		r, a, ok := CustomerPermission(op)
		if !ok || r != "customer" || a != "edit" {
			t.Fatal(op)
		}
	}
	good := CustomerInput{CustomerID: "1", ChildCode: "CN-test", Payload: map[string]any{"name": "中文", "expectedVersion": float64(1)}}
	if e := ValidateCustomerInput("contacts-update", good); e != nil {
		t.Fatal(e)
	}
	for _, field := range []string{"customer_id", "actor", "deleted_at", "workflow_instance_id", "approved_by", "status"} {
		bad := good
		bad.Payload = map[string]any{"name": "中文", "expectedVersion": float64(1), field: "forged"}
		if field == "status" {
			bad.Payload[field] = "approved"
		}
		if ValidateCustomerInput("contacts-update", bad) == nil {
			t.Fatal(field)
		}
	}
	if altocScopeAllows(altoc.BasicReadScope{Access: "self"}, "Person", "person", "D1") {
		t.Fatal("UID folded")
	}
	if altocScopeAllows(altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, "p", "p", "D2") {
		t.Fatal("department widened")
	}
}
