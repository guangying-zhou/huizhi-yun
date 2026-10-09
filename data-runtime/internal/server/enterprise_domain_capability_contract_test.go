package server

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"
)

func enterpriseScopeSelectors(file *ast.File) int {
	count := 0
	ast.Inspect(file, func(node ast.Node) bool {
		if selector, ok := node.(*ast.SelectorExpr); ok && selector.Sel.Name == "Scopes" {
			count++
		}
		return true
	})
	return count
}

// Route modules must not reintroduce a second token-scope policy. Scheduler
// and receivable service routes have separate service identities and scopes.
func TestEnterpriseRouteModulesUseOnlyGenericDomainScopeCheck(t *testing.T) {
	allowed := map[string]bool{
		// D11 system and purpose lanes are deliberately separate from user domain auth.
		"enterprise_system_context.go":              true,
		"enterprise_notification_detail_context.go": true,
		"enterprise_context.go":                     true,
		"enterprise_scheduler_context.go":           true,
		"enterprise_milestone_receivable.go":        true,
	}
	paths, err := filepath.Glob("enterprise_*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") || allowed[path] {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		if enterpriseScopeSelectors(file) != 0 {
			t.Errorf("%s reads token scopes outside generic domain auth", path)
		}
	}
}

func TestEnterpriseScopeSelectorGuardCatchesNestedServiceIdentity(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "fixture.go", "package server\nfunc bad(verified struct{ Service struct{ Scopes []string } }) { _ = verified.Service.Scopes }", 0)
	if err != nil {
		t.Fatal(err)
	}
	if enterpriseScopeSelectors(file) == 0 {
		t.Fatal("nested verified.Service.Scopes bypassed the route scope guard")
	}
}
