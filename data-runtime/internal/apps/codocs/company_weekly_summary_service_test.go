package codocs

import "testing"

func TestCompanyWeeklySummaryServiceIdentityHelpers(t *testing.T) {
	if !isCompanySummaryPeriodKey("2026-W30") {
		t.Fatal("expected valid ISO period key")
	}
	for _, value := range []string{"2026-W00", "2026-W54", "W30", "2026-30"} {
		if isCompanySummaryPeriodKey(value) {
			t.Fatalf("expected invalid period key: %s", value)
		}
	}
	hash := companySummarySHA256([]byte("# summary\n"))
	if !isCompanySummarySHA256(hash) || len(hash) != 64 {
		t.Fatalf("expected valid SHA-256, got %q", hash)
	}
}

func TestCompanySummaryCommandStringSliceIsStable(t *testing.T) {
	items, err := companySummaryCommandStringSlice([]any{"u2", "u1", "u2"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 2 || items[0] != "u1" || items[1] != "u2" {
		t.Fatalf("unexpected recipients: %#v", items)
	}
}
