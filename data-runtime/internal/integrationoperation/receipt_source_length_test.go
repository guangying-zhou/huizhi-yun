package integrationoperation

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestReceiptRejectsValuesLongerThanSchemaBeforeSQL(t *testing.T) {
	for _, item := range []struct {
		name   string
		change func(*ReceiptCommandInput)
	}{
		{"command_schema_version", func(input *ReceiptCommandInput) { input.CommandSchemaVersion = strings.Repeat("v", 31) }},
		{"operation_code", func(input *ReceiptCommandInput) { input.OperationCode = strings.Repeat("o", 192) }},
		{"idempotency_key", func(input *ReceiptCommandInput) { input.IdempotencyKey = strings.Repeat("k", 192) }},
		{"service_client_id", func(input *ReceiptCommandInput) { input.TrustedContext.ServiceClientID = strings.Repeat("c", 101) }},
	} {
		t.Run(item.name, func(t *testing.T) {
			input := validReceiptCommandInput(t)
			item.change(&input)
			if err := validateReceiptCommandInput(input); err == nil || !strings.Contains(err.Error(), item.name) {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

// This catches frozen literals and finite concatenations at review time. Any
// value computed from request data is additionally checked by validateReceiptInput
// before SQL, using the same Aims/Assets/Codocs receipt column widths.
func TestReceiptSourceFieldsFitSchema(t *testing.T) {
	limits := map[string]int{"CommandSchemaVersion": 30, "OperationCode": 191, "IdempotencyKey": 191}
	for _, domain := range []string{"codocs", "aims", "assets"} {
		files, err := filepath.Glob(filepath.Join("..", "apps", domain, "*.go"))
		if err != nil {
			t.Fatal(err)
		}
		globals := map[string]ast.Expr{}
		for _, filename := range files {
			if strings.HasSuffix(filename, "_test.go") {
				continue
			}
			file, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			for _, decl := range file.Decls {
				gen, ok := decl.(*ast.GenDecl)
				if !ok || gen.Tok != token.CONST {
					continue
				}
				for _, spec := range gen.Specs {
					value := spec.(*ast.ValueSpec)
					for i, name := range value.Names {
						if i < len(value.Values) {
							globals[name.Name] = value.Values[i]
						}
					}
				}
			}
		}
		checked := 0
		for _, filename := range files {
			if strings.HasSuffix(filename, "_test.go") {
				continue
			}
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, filename, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Body == nil {
					continue
				}
				env := map[string]ast.Expr{}
				for name, expr := range globals {
					env[name] = expr
				}
				choices := map[string][]string{}
				ast.Inspect(fn.Body, func(node ast.Node) bool {
					switch n := node.(type) {
					case *ast.AssignStmt:
						for i, lhs := range n.Lhs {
							if id, ok := lhs.(*ast.Ident); ok && i < len(n.Rhs) {
								env[id.Name] = n.Rhs[i]
							}
						}
					case *ast.SwitchStmt:
						if id, ok := n.Tag.(*ast.Ident); ok {
							for _, item := range n.Body.List {
								for _, expr := range item.(*ast.CaseClause).List {
									if lit, ok := expr.(*ast.BasicLit); ok && lit.Kind == token.STRING {
										value, _ := strconv.Unquote(lit.Value)
										choices[id.Name] = append(choices[id.Name], value)
									}
								}
							}
						}
					}
					return true
				})
				ast.Inspect(fn.Body, func(node ast.Node) bool {
					var field string
					var value ast.Expr
					switch n := node.(type) {
					case *ast.KeyValueExpr:
						if id, ok := n.Key.(*ast.Ident); ok {
							field, value = id.Name, n.Value
						}
					case *ast.AssignStmt:
						if len(n.Lhs) == 1 && len(n.Rhs) == 1 {
							if sel, ok := n.Lhs[0].(*ast.SelectorExpr); ok {
								field, value = sel.Sel.Name, n.Rhs[0]
							}
						}
					}
					limit, ok := limits[field]
					if !ok || value == nil {
						return true
					}
					for _, candidate := range receiptStaticStrings(value, env, choices, 0) {
						checked++
						if len([]rune(candidate)) > limit {
							t.Errorf("%s:%d %s=%q exceeds %d", filename, fset.Position(node.Pos()).Line, field, candidate, limit)
						}
					}
					return true
				})
			}
		}
		if checked == 0 {
			t.Fatalf("no statically resolved receipt fields in %s", domain)
		}
	}
}

func TestReceiptSourceEvaluatorExpandsFiniteActionConcatenation(t *testing.T) {
	expr, err := parser.ParseExpr(`"codocs-dept-document-" + action + ".v1"`)
	if err != nil {
		t.Fatal(err)
	}
	values := receiptStaticStrings(expr, nil, map[string][]string{"action": {"readonly", "recycle"}}, 0)
	if len(values) != 2 || len(values[0]) <= 30 || len(values[1]) <= 30 {
		t.Fatalf("missed old overlong values: %v", values)
	}
}

func receiptStaticStrings(expr ast.Expr, env map[string]ast.Expr, choices map[string][]string, depth int) []string {
	if depth > 8 {
		return nil
	}
	switch value := expr.(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, err := strconv.Unquote(value.Value)
			if err == nil {
				return []string{text}
			}
		}
	case *ast.Ident:
		if candidates := choices[value.Name]; len(candidates) != 0 {
			return candidates
		}
		if defined, ok := env[value.Name]; ok && defined != expr {
			return receiptStaticStrings(defined, env, choices, depth+1)
		}
	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return nil
		}
		left, right := receiptStaticStrings(value.X, env, choices, depth+1), receiptStaticStrings(value.Y, env, choices, depth+1)
		var out []string
		for _, a := range left {
			for _, b := range right {
				out = append(out, a+b)
			}
		}
		return out
	case *ast.CompositeLit:
		var out []string
		for _, element := range value.Elts {
			if item, ok := element.(*ast.KeyValueExpr); ok {
				out = append(out, receiptStaticStrings(item.Value, env, choices, depth+1)...)
			}
		}
		return out
	case *ast.IndexExpr:
		return receiptStaticStrings(value.X, env, choices, depth+1)
	}
	return nil
}
