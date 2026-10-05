package altoc

import (
	"strings"
	"testing"
)

func TestOverdueReceivableWhereUsesOnlyOpenUnpaidPlans(t *testing.T) {
	where := stringsJoinForTest(overdueReceivableWhere())
	for _, selector := range []string{
		"rp.deleted_at IS NULL",
		"rp.planned_payment_date < CURDATE()",
		"rp.status IN ('to_receive', 'partially_received')",
		"GREATEST(COALESCE(rp.amount, 0) - COALESCE(rp.received_amount, 0), 0) > 0",
	} {
		if !strings.Contains(where, selector) {
			t.Fatalf("overdue where missing %q: %s", selector, where)
		}
	}
	if strings.Contains(where, "collection_responsible_uid") {
		t.Fatalf("status marker must not skip unassigned plans: %s", where)
	}
}

func TestScanCommandsRequireResourceEditScopes(t *testing.T) {
	if err := altocRequireActionScope(map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write"},
	}, "opportunity", "edit"); err == nil {
		t.Fatal("expected broad-only opportunity scan scope to be rejected")
	}

	err := altocRequireActionScope(map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write", "altoc:receivable:edit"},
	}, "receivable", "edit")
	if err != nil {
		t.Fatalf("expected receivable edit scope to pass, got %v", err)
	}
}

func TestScanCommandPathsAreSkippedByGenericRuntimeResource(t *testing.T) {
	for _, path := range []string{
		"/v1/altoc/opportunities/scan-stale",
		"/v1/altoc/payments/scan-overdue",
		"/v1/altoc/service/notifications:scan-due",
	} {
		if resource, ok := genericRuntimeActionResource(path); ok {
			t.Fatalf("expected %q to skip generic resource, got %q", path, resource)
		}
	}
}

func stringsJoinForTest(values []string) string {
	return strings.Join(values, " AND ")
}
