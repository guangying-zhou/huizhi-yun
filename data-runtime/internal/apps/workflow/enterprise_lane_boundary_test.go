package workflow

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Check expressions structurally: nested selectors and arbitrary receiver names
// must not turn a transport handler into an owning transaction coordinator.
func laneBoundaryViolations(source string) ([]string, error) {
	f, err := parser.ParseFile(token.NewFileSet(), "boundary.go", source, 0)
	if err != nil {
		return nil, err
	}
	var bad []string
	for _, i := range f.Imports {
		if strings.Contains(i.Path.Value, "/workflow/internal/lane") {
			bad = append(bad, "lane import")
		}
	}
	forbidden := map[string]bool{"AimsTransaction": true, "WorkflowTransaction": true, "DirectorySnapshot": true, "Employee": true, "RequestCompletionInLane": true, "ApplyCompletionDecisionInLane": true, "RequestEnterpriseWorkItemCompletionInTransaction": true, "ApplyWorkItemCompletionCallbackInTransaction": true, "BeginWorkflowWriteTransaction": true, "LockCompletionObjects": true}
	ast.Inspect(f, func(n ast.Node) bool {
		switch v := n.(type) {
		case *ast.SelectorExpr:
			if forbidden[v.Sel.Name] {
				bad = append(bad, v.Sel.Name)
			}
		case *ast.FuncDecl:
			if forbidden[v.Name.Name] {
				bad = append(bad, "implementation:"+v.Name.Name)
			}
		case *ast.CompositeLit:
			if s, ok := v.Type.(*ast.SelectorExpr); ok && (s.Sel.Name == "WorkflowInitiatorSnapshot" || s.Sel.Name == "WorkflowEmployees" || s.Sel.Name == "CompletionLane") {
				bad = append(bad, "facts:"+s.Sel.Name)
			}
		}
		return true
	})
	return bad, nil
}
func TestCompletionLaneTransportASTBoundary(t *testing.T) {
	for _, root := range []string{"../..", "../../../cmd"} {
		err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			clean := filepath.ToSlash(p)
			if d.IsDir() && (clean == "../../apps/workflow" || clean == "../../apps/aims") {
				return filepath.SkipDir
			}
			if d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
				return nil
			}
			raw, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			bad, err := laneBoundaryViolations(string(raw))
			// B2 Registry primitives are the trusted implementation, not lane consumers.
			// Allow only their own declarations; all imports/calls remain scanned.
			allowedDeclaration := ""
			if clean == "../../enterprise/workflow_lock_order.go" {
				allowedDeclaration = "implementation:LockCompletionObjects"
			}
			if clean == "../../enterprise/workflow_transaction.go" {
				allowedDeclaration = "implementation:BeginWorkflowWriteTransaction"
			}
			if allowedDeclaration != "" {
				filtered := bad[:0]
				for _, v := range bad {
					if v != allowedDeclaration {
						filtered = append(filtered, v)
					}
				}
				bad = filtered
			}
			if err != nil || len(bad) > 0 {
				t.Fatalf("%s: %v %v", p, bad, err)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, src := range []string{
		`package server;func f(){verified.Nested.Service.RequestCompletionInLane()}`,
		`package server;func (a *Fake) Employee(s string)bool{return true}`,
		`package server;func f(){_ = facts.WorkflowEmployees{}}`,
		`package server;import disguised "github.com/huizhi-yun/data-runtime/internal/apps/workflow/internal/lane"`,
	} {
		bad, err := laneBoundaryViolations(src)
		if err != nil || len(bad) == 0 {
			t.Fatal("boundary scanner missed fixture", bad, err)
		}
	}
}
func TestCompletionLaneGoInternalRejectsTransportImport(t *testing.T) {
	dir := t.TempDir()
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	// Compile an external package; Go enforces the Workflow owning subtree,
	// independent of aliases or HTTP handler variable names.
	module := "module github.com/huizhi-yun/data-runtime/internal/server/lane-boundary-probe\n\ngo 1.24\n\nrequire github.com/huizhi-yun/data-runtime v0.0.0\nreplace github.com/huizhi-yun/data-runtime => " + root + "\n"
	if err = os.WriteFile(filepath.Join(dir, "go.mod"), []byte(module), 0600); err != nil {
		t.Fatal(err)
	}
	src := `package probe
import _ "github.com/huizhi-yun/data-runtime/internal/apps/workflow/internal/lane"`
	if err = os.WriteFile(filepath.Join(dir, "probe.go"), []byte(src), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("go", "test", "-mod=mod", ".")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GOPROXY=off", "GOSUMDB=off", "GOWORK=off")
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "use of internal package github.com/huizhi-yun/data-runtime/internal/apps/workflow/internal/lane not allowed") {
		t.Fatalf("not rejected by compiler: %s %v", out, err)
	}
}
