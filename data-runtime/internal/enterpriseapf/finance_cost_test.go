package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"strings"
	"testing"
)

func TestAPF14CostClosedInput(t *testing.T) {
	if len(costOps) != 13 {
		t.Fatal("budget")
	}
	good := CostInput{ProjectCode: "P1", PeriodMonth: "2026-10", ExpectedInputHash: strings.Repeat("a", 64)}
	for op := range costOps {
		i := good
		if !CostWrite(op) {
			i.ExpectedInputHash = ""
		}
		if strings.HasSuffix(op, "-page") {
			i.Page = 1
			i.PageSize = 20
		}
		if op == "project-labor-history-view" || op == "employee-costs-view" || op == "project-cost-allocations-view" {
			i.Code = "CODE"
		}
		if e := ValidateCostInput(op, i); e != nil {
			t.Fatal(op, e)
		}
		r, _, ok := CostPermission(op)
		if !ok || r != "project_accounting" {
			t.Fatal(op)
		}
	}
	for _, i := range []CostInput{{ProjectCode: "../p", PeriodMonth: "2026-10"}, {ProjectCode: "P1", PeriodMonth: "2026-13"}, {ProjectCode: "P1", PeriodMonth: "2026-10", ExpectedInputHash: "forged"}, {ProjectCode: "P1", PeriodMonth: "2026-10", ExpectedInputHash: strings.Repeat("a", 64), ExpectedVersion: -1}} {
		if ValidateCostInput("project-labor-recalculate", i) == nil {
			t.Fatal("invalid", i)
		}
	}
	s := CostScope{Access: "projects", ProjectCodes: []string{"P1"}, Salary: altoc.BasicReadScope{Access: "none"}}
	if s.Validate("P1", "project-labor-preview") != nil || s.Validate("P2", "project-labor-preview") == nil || s.Validate("P1", "employee-costs-page") == nil {
		t.Fatal("scope boundary")
	}
}
