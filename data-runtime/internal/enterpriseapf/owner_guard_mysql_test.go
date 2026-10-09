package enterpriseapf

import (
	"context"
	"fmt"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
)

// Owner assignment on real tables (WizBiz migration W2, prerequisite 2).
func TestAPFOwnerGuardMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	all := altoc.BasicReadScope{Access: "all", DepartmentCodes: []string{}}
	who := Identity{Actor: "admin", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "isolated"}
	key := 0
	customer := func(op, id string, payload map[string]any) (map[string]any, int, string) {
		t.Helper()
		key++
		who.Key = fmt.Sprintf("owner-guard-%d", key)
		out, err := s.Customer(ctx, op, CustomerInput{CustomerID: id, Payload: payload}, who, all)
		status, code := ownerErrorCode(err)
		if err != nil {
			if code == "" {
				t.Fatalf("%s: unexpected error %v", op, err)
			}
			return nil, status, code
		}
		return out.(map[string]any)["data"].(map[string]any), 0, ""
	}
	count := func(q string, args ...any) (n int) {
		t.Helper()
		if err := db.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Creation: reserved, inactive and unverifiable owners write nothing.
	restore := setTestOwners([]string{"left"}, false)
	for _, uid := range []string{ReservedUnassignedOwner, "system:x", "client:aims.runtime"} {
		if _, status, code := customer("customers-create", "", map[string]any{"name": "保留值客户", "owner_uid": uid}); status != 400 || code != "apf_owner_invalid" {
			t.Fatalf("create with %q -> %d %s", uid, status, code)
		}
	}
	if _, status, code := customer("customers-create", "", map[string]any{"name": "离职负责人客户", "owner_uid": "left"}); status != 400 || code != "apf_owner_not_active" {
		t.Fatalf("create with inactive owner -> %d %s", status, code)
	}
	restore()
	restore = setTestOwners(nil, true)
	if _, status, code := customer("customers-create", "", map[string]any{"name": "目录不可用客户", "owner_uid": "alice"}); status != 503 || code != "directory_subject_status_unavailable" {
		t.Fatalf("create while Directory is down -> %d %s", status, code)
	}
	restore()
	if n := count("SELECT COUNT(*) FROM altoc_customer"); n != 0 {
		t.Fatalf("rejected creations wrote %d customers", n)
	}

	restore = setTestOwners([]string{"left"}, false)
	defer restore()
	created, _, code := customer("customers-create", "", map[string]any{"name": "正常客户", "owner_uid": "alice"})
	if code != "" {
		t.Fatalf("create code=%s", code)
	}
	id := fmt.Sprint(created["id"])

	// Reassignment: the same three refusals, and the owner stays unchanged.
	for uid, want := range map[string]string{ReservedUnassignedOwner: "apf_owner_invalid", "left": "apf_owner_not_active"} {
		if _, _, code := customer("customers-set-owner", id, map[string]any{"owner_uid": uid, "expectedVersion": float64(1)}); code != want {
			t.Fatalf("set-owner %q code=%s", uid, code)
		}
	}
	if n := count("SELECT COUNT(*) FROM altoc_customer WHERE id=? AND owner_uid='alice' AND row_version=1", id); n != 1 {
		t.Fatal("a rejected reassignment changed the customer")
	}

	// An update that does not touch the owner never consults Directory, even when it is down.
	down := setTestOwners(nil, true)
	if _, _, code := customer("customers-update", id, map[string]any{"name": "正常客户（改名）", "expectedVersion": float64(1)}); code != "" {
		t.Fatalf("update without owner change code=%s", code)
	}
	testOwnerState.Lock()
	asked := len(testOwnerState.calls)
	testOwnerState.Unlock()
	down()
	if asked != 0 {
		t.Fatalf("Directory was consulted %d times for an update that assigns no owner", asked)
	}
	if _, _, code := customer("customers-set-owner", id, map[string]any{"owner_uid": "bob", "expectedVersion": float64(2)}); code != "" {
		t.Fatalf("valid reassignment code=%s", code)
	}

	// An object whose owner is the unassigned marker (written by the migration
	// lane only; simulated here directly) is not addressable by self scope, and
	// what is created under it never inherits the marker.
	if _, err := db.Exec("UPDATE altoc_customer SET owner_uid=?, owner_dept_code=NULL WHERE id=?", ReservedUnassignedOwner, id); err != nil {
		t.Fatal(err)
	}
	self := altoc.BasicReadScope{Access: "self"}
	who.Key = "owner-guard-self"
	if _, err := s.Customer(ctx, "customers-update", CustomerInput{CustomerID: id, Payload: map[string]any{"name": "x", "expectedVersion": float64(3)}}, Identity{Actor: "alice", Tenant: who.Tenant, Deployment: who.Deployment, Client: who.Client, Key: who.Key, RequestID: who.RequestID}, self); err == nil {
		t.Fatal("a self-scoped user must not reach an unassigned customer")
	}
	who.Key = "owner-guard-quotation"
	quote, err := s.Quotation(ctx, "quotations-create", QuotationInput{CustomerID: id, Payload: map[string]any{"currency_code": "CNY"}}, who, all)
	if err != nil {
		t.Fatalf("all-scoped quotation under an unassigned customer: %v", err)
	}
	quoteID := fmt.Sprint(quote.(map[string]any)["data"].(map[string]any)["id"])
	if n := count("SELECT COUNT(*) FROM altoc_quotation WHERE id=? AND owner_uid='admin'", quoteID); n != 1 {
		t.Fatal("a quotation under an unassigned customer must be owned by its creator")
	}
	if n := count("SELECT (SELECT COUNT(*) FROM altoc_quotation WHERE owner_uid LIKE 'system:%') + (SELECT COUNT(*) FROM altoc_contact WHERE owner_uid LIKE 'system:%')"); n != 0 {
		t.Fatalf("the unassigned marker was inherited by %d rows", n)
	}
	// A proper reassignment brings the customer back to a person.
	if _, _, code := customer("customers-set-owner", id, map[string]any{"owner_uid": "bob", "expectedVersion": float64(3)}); code != "" {
		t.Fatalf("reassign unassigned customer code=%s", code)
	}
	if n := count("SELECT COUNT(*) FROM altoc_customer WHERE id=? AND owner_uid='bob'", id); n != 1 {
		t.Fatal("reassignment did not take effect")
	}
}
