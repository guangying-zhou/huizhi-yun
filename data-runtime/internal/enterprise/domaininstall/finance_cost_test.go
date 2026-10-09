package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func TestFinanceCostCandidateBoundaries(t *testing.T) {
	b := apfFixture("isolated", "instance")
	var err error
	b, err = WithFinanceB3(b)
	if err != nil {
		t.Fatal(err)
	}
	b, err = WithFinance13a(b)
	if err != nil {
		t.Fatal(err)
	}
	b, err = WithFinance13b(b)
	if err != nil {
		t.Fatal(err)
	}
	before := b.Domains["finance"]
	candidate, err := WithFinanceCost(b)
	if err != nil {
		t.Fatal(err)
	}
	if candidate.Generation != b.Generation || candidate.SchemaVersion != b.SchemaVersion || len(before.Tables)+6 != len(candidate.Domains["finance"].Tables) {
		t.Fatal("binding changed outside cost subset")
	}
	d := candidate.Domains["finance"]
	if d.Write != before.Write || d.Scheduler != before.Scheduler {
		t.Fatal("installer enabled lane")
	}
	i := ForFinanceCost(c000001Expectation)
	if err = i.x.validate(candidate); err != nil {
		t.Fatal(err)
	}
	if !IsFinanceB3Domain(d) || !IsFinance13bDomain(d) {
		t.Fatal("prior readers rejected valid extension")
	}
	if _, err = WithFinanceCost(candidate); err == nil {
		t.Fatal("duplicate install")
	}
	if _, err = WithFinanceCost(apfFixture("isolated", "instance")); err == nil {
		t.Fatal("missing prerequisite accepted")
	}
	candidate.Domains["other"] = enterprise.DomainBinding{Tables: map[string]string{"alias": "finance_project_cost_batch"}}
	if i.x.validate(candidate) == nil {
		t.Fatal("cross-domain collision")
	}
}

func TestFinanceCostManifestColumnsMatchDDL(t *testing.T) {
	fields := regexp.MustCompile(`(?m)(?:^|,\s*)([a-z0-9_]+)\s+(?:BIGINT|VARCHAR|CHAR|DATETIME|DECIMAL|JSON)\b`)
	for _, table := range FinanceCostTables() {
		// Match the body, not the CREATE TABLE header or index/check expressions.
		var columns []string
		for _, m := range fields.FindAllStringSubmatch(strings.TrimSpace(strings.SplitN(table.DDL, "(", 2)[1]), -1) {
			columns = append(columns, m[1])
		}
		if !reflect.DeepEqual(columns, table.Columns) {
			t.Fatal(table.Logical, "columns differ", columns, table.Columns)
		}
	}
}
