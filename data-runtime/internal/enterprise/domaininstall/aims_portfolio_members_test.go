package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"os"
	"reflect"
	"regexp"
	"testing"
)

func TestAimsPortfolioMembersCanonicalDDL(t *testing.T) {
	sql, err := os.ReadFile("../../../../aims/docs/migration_v5.42_portfolio_members.sql")
	if err != nil {
		t.Fatal(err)
	}
	ddls := regexp.MustCompile(`(?s)CREATE TABLE aims_.*?;`).FindAllString(string(sql), -1)
	tables := AimsPortfolioMembersTables()
	if len(ddls) != 2 || len(tables) != 2 {
		t.Fatal("canonical table count")
	}
	for n, table := range tables {
		if table.DDL != ddls[n] || table.Logical != table.Physical {
			t.Fatal("DDL drift", table.Logical)
		}
		matches := regexp.MustCompile(`(?m)^  (\w+) (?:BIGINT|VARCHAR|ENUM|DATETIME)`).FindAllStringSubmatch(ddls[n], -1)
		var cols []string
		for _, m := range matches {
			cols = append(cols, m[1])
		}
		if !reflect.DeepEqual(cols, table.Columns) {
			t.Fatal("column drift")
		}
	}
}
func TestAimsPortfolioMembersPreservesExistingMappingAndModes(t *testing.T) {
	base := enterprise.Binding{Domains: map[string]enterprise.DomainBinding{"aims": {OwnerDeployment: "owner", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathUnified, Tables: map[string]string{"projects": "aims_projects", "documents": "aims_documents"}}, "assets": {Tables: map[string]string{"products": "assets_products"}}}}
	before := hash(base)
	out, err := WithAimsPortfolioMembers(base)
	if err != nil {
		t.Fatal(err)
	}
	if hash(base) != before || out.Generation != base.Generation {
		t.Fatal("source mutated")
	}
	d := out.Domains["aims"]
	delete(d.Tables, "aims_portfolio_members")
	delete(d.Tables, "aims_portfolio_doc_repos")
	if !reflect.DeepEqual(d, base.Domains["aims"]) || !reflect.DeepEqual(out.Domains["assets"], base.Domains["assets"]) {
		t.Fatal("existing mapping or mode changed")
	}
	out, _ = WithAimsPortfolioMembers(base)
	if _, err = WithAimsPortfolioMembers(out); err == nil {
		t.Fatal("existing mapping accepted")
	}
	bad := base
	bad.Domains = map[string]enterprise.DomainBinding{"aims": base.Domains["aims"], "assets": {Tables: map[string]string{"wrong": "aims_portfolio_members"}}}
	if _, err = WithAimsPortfolioMembers(bad); err == nil {
		t.Fatal("cross-domain collision")
	}
}
