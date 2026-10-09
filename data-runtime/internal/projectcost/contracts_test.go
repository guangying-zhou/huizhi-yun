package projectcost

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPeriodUsesMonthEnd(t *testing.T) {
	p, e := NewPeriod("P1", "2028-02")
	if e != nil || p.End.Format("2006-01-02") != "2028-02-29" {
		t.Fatal(p, e)
	}
	for _, m := range []string{"2026-2", "2026-13", "2026-02-01", ""} {
		if _, e = NewPeriod("P1", m); e == nil {
			t.Fatal(m)
		}
	}
}
func TestPublicSummaryCannotExposeOwningInputs(t *testing.T) {
	raw, e := json.Marshal(PublicSummary{Readiness: "not_ready"})
	if e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"rank", "salary", "EmployeeUID", "inputSnapshot", "RateCode"} {
		if strings.Contains(string(raw), key) {
			t.Fatal("sensitive field exposed", key)
		}
	}
	if !strings.Contains(string(raw), `"laborCostAmount":null`) {
		t.Fatal("missing inputs became zero")
	}
}
