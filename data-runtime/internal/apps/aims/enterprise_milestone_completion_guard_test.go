package aims

import (
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"slices"
	"strconv"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEnterpriseMilestoneCRUDCannotSetCompletionFields(t *testing.T) {
	ctx := context.WithValue(t.Context(), enterpriseProjectCommandScopeKey{}, EnterpriseProjectUpdateIdentity{})
	for _, field := range []string{
		"status", "statusCode", "status_code", "lifecycleStatus", "lifecycle_status",
		"completed", "isCompleted", "is_completed", "completedAt", "completed_at",
		"closed", "isClosed", "is_closed", "closedAt", "closed_at",
		"completionLockRequestId", "completion_lock_request_id",
	} {
		body := map[string]any{field: "completed"}
		for _, command := range []struct {
			name string
			run  func() error
		}{
			{"create", func() error { _, err := (&Adapter{}).createProjectMilestone(ctx, "1", nil, body); return err }},
			{"update", func() error { _, err := (&Adapter{}).updateDirectMilestone(ctx, "1", nil, body); return err }},
		} {
			var denied httperror.Error
			if err := command.run(); !errors.As(err, &denied) || denied.Status != 400 || denied.Code != "milestone_completion_workflow_required" {
				t.Fatalf("%s field %s: %v", command.name, field, err)
			}
		}
		if err := rejectEnterpriseMilestoneCompletionFields(t.Context(), body); err != nil {
			t.Fatalf("standalone Aims field %s changed: %v", field, err)
		}
	}
}

// A new body key in the direct writer needs an explicit completion-bypass
// review. The Enterprise wrapper rejects protected fields before this writer.
func TestEnterpriseMilestoneUpdateBodyKeysAreReviewed(t *testing.T) {
	readKeys := milestoneWriterBodyKeys(t, "project_milestones.go")
	nonCompletionKeys := []string{
		"name", "description", "startDate", "start_date", "endDate", "end_date",
		"mode", "pivrStage", "pivr_stage", "paymentTermId", "payment_term_id",
		"recurrenceRule", "recurrence_rule", "sortOrder", "sort_order", "deliverables",
	}
	protectedKeys := []string{"status"}
	want := append(slices.Clone(nonCompletionKeys), protectedKeys...)
	slices.Sort(want)
	if !slices.Equal(readKeys, want) {
		t.Fatalf("updateDirectMilestoneBody reads %q; reviewed non-completion/protected keys are %q; review every new key before registering it", readKeys, want)
	}
}

func milestoneWriterBodyKeys(t *testing.T, filename string) []string {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var writer *ast.FuncDecl
	for _, declaration := range file.Decls {
		if function, ok := declaration.(*ast.FuncDecl); ok && function.Name.Name == "updateDirectMilestoneBody" {
			writer = function
			break
		}
	}
	if writer == nil {
		t.Fatal("updateDirectMilestoneBody missing")
	}
	keys := map[string]bool{}
	ast.Inspect(writer.Body, func(node ast.Node) bool {
		if call, ok := node.(*ast.CallExpr); ok && len(call.Args) > 0 {
			name, isName := call.Fun.(*ast.Ident)
			body, isBody := call.Args[0].(*ast.Ident)
			if isName && isBody && body.Name == "body" && (name.Name == "firstBodyValue" || name.Name == "firstBodyText") {
				for _, argument := range call.Args[1:] {
					literal, ok := argument.(*ast.BasicLit)
					if !ok || literal.Kind != token.STRING {
						t.Fatalf("%s reads a nonliteral body key; review its source", name.Name)
					}
					key, err := strconv.Unquote(literal.Value)
					if err != nil {
						t.Fatal(err)
					}
					keys[key] = true
				}
			}
		}
		if index, ok := node.(*ast.IndexExpr); ok {
			body, isBody := index.X.(*ast.Ident)
			if isBody && body.Name == "body" {
				literal, ok := index.Index.(*ast.BasicLit)
				if !ok || literal.Kind != token.STRING {
					t.Fatal("updateDirectMilestoneBody reads a nonliteral indexed body key")
				}
				key, err := strconv.Unquote(literal.Value)
				if err != nil {
					t.Fatal(err)
				}
				keys[key] = true
			}
		}
		return true
	})
	result := make([]string, 0, len(keys))
	for key := range keys {
		result = append(result, key)
	}
	slices.Sort(result)
	return result
}
