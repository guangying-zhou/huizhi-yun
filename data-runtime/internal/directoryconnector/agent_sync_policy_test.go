package directoryconnector

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

func TestLDAPFullSyncIsOnlyCalledByExplicitCommandExecution(t *testing.T) {
	parsed, err := parser.ParseFile(token.NewFileSet(), "agent.go", nil, 0)
	if err != nil {
		t.Fatalf("parse agent.go: %v", err)
	}

	callCounts := map[string]int{}
	for _, declaration := range parsed.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Recv == nil || function.Body == nil {
			continue
		}
		ast.Inspect(function.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || selector.Sel.Name != "sync" {
				return true
			}
			receiver, ok := selector.X.(*ast.Ident)
			if ok && receiver.Name == "a" {
				callCounts[function.Name.Name]++
			}
			return true
		})
	}

	if callCounts["Run"] != 0 {
		t.Fatalf("startup must not trigger LDAP full sync; found %d call(s)", callCounts["Run"])
	}
	if callCounts["tick"] != 0 {
		t.Fatalf("periodic tick must not trigger LDAP full sync; found %d call(s)", callCounts["tick"])
	}
	if callCounts["execute"] != 1 {
		t.Fatalf("explicit command execution must retain exactly one LDAP full-sync call; found %d", callCounts["execute"])
	}
}
