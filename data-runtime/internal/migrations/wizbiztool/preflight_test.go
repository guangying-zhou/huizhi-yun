package wizbiztool

import (
	"context"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

func TestPreflightReportsEveryIdentityWithoutLeakingErrors(t *testing.T) {
	p := Profile{Source: Connection{User: "root"}, Target: Connection{User: "root"}, Directory: Connection{User: "root"}, SourceMetadata: Connection{User: "root"}}
	r := preflight(context.Background(), p, SnapshotManifest{}, "", func(string, string) (RuntimeBuildEvidence, error) {
		return RuntimeBuildEvidence{}, errors.New("password SECRET SQL")
	}, func(Profile) error { return errors.New("vault secret SECRET") })
	if r.Ready || len(r.Checks) != 9 {
		t.Fatal("must aggregate all failures", r)
	}
	for _, c := range r.Checks {
		if c.Ready || c.Code != c.Name+"_not_ready" {
			t.Fatal(c)
		}
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), "SECRET") || strings.Contains(string(b), "password") {
		t.Fatal("unsafe output")
	}
}

func TestVaultPreflightDoesNotReadKeyContent(t *testing.T) {
	f, err := parser.ParseFile(token.NewFileSet(), "preflight.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, decl := range f.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "preflightVault" {
			continue
		}
		found = true
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			switch sel.Sel.Name {
			case "ReadFile", "ReadProtected", "ResolveConsoleVaultMasterKey", "Load":
				t.Fatal("preflight must inspect metadata, never load key", sel.Sel.Name)
			}
			return true
		})
	}
	if !found {
		t.Fatal("missing vault preflight")
	}
}
