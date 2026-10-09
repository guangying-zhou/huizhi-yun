package wizbiztool

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestVerifierHasNoApplyImports(t *testing.T) {
	entries, err := os.ReadDir("independentverify")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		tree, err := parser.ParseFile(token.NewFileSet(), filepath.Join("independentverify", entry.Name()), nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(tree, func(n ast.Node) bool {
			if imp, ok := n.(*ast.ImportSpec); ok {
				p, err := strconv.Unquote(imp.Path.Value)
				if err != nil {
					t.Fatal(err)
				}
				if strings.HasPrefix(p, "github.com/huizhi-yun/data-runtime/") {
					t.Errorf("independent verifier imports application implementation: %s", p)
				}
			}
			return true
		})
	}
}
