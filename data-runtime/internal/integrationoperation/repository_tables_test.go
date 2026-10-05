package integrationoperation

import (
	"github.com/DATA-DOG/go-sqlmock"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"
)

func mappedTestTables(t *testing.T) OutboxTables {
	t.Helper()
	tables, err := NewOutboxTables("`u_operation`", "`u_attempt`", "`u_receipt`", "`u_dead_letter`")
	if err != nil {
		t.Fatal(err)
	}
	return tables
}
func TestOutboxSQLMappingLeavesLiteralsCommentsAndOtherIdentifiers(t *testing.T) {
	tables := mappedTestTables(t)
	query := "SELECT 'integration_operation', \"service_command_receipt\", 'escaped\\'integration_operation', 'doubled''integration_operation', longer_integration_operation, integration_operation_attempt_extra FROM integration_operation o JOIN `integration_operation_attempt` a /* integration_operation */ -- integration_operation\n# service_command_receipt\nJOIN service_command_receipt r JOIN integration_operation_dead_letter_actionable d"
	want := "SELECT 'integration_operation', \"service_command_receipt\", 'escaped\\'integration_operation', 'doubled''integration_operation', longer_integration_operation, integration_operation_attempt_extra FROM `u_operation` o JOIN `u_attempt` a /* integration_operation */ -- integration_operation\n# service_command_receipt\nJOIN `u_receipt` r JOIN `u_dead_letter` d"
	if got := mapOutboxSQL(query, &tables); got != want {
		t.Fatalf("mapping changed opaque SQL: %s", got)
	}
	if mapOutboxSQL(query, nil) != query {
		t.Fatal("legacy SQL changed")
	}
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := NewRepository(db, WithOutboxTables(OutboxTables{})); err == nil {
		t.Fatal("invalid mapping accepted")
	}
	if _, err := NewReceiptRepository(db, WithReceiptOutboxTables(OutboxTables{})); err == nil {
		t.Fatal("invalid receipt mapping accepted")
	}
}

// Repository queries may be composed in helpers or callbacks. Guard the actual
// SQL boundary so adding a new diagnostic cannot silently fall back to legacy.
func TestRepositorySQLBoundariesAlwaysApplyOutboxMapping(t *testing.T) {
	files, _ := filepath.Glob("repository*.go")
	files = append(files, "receipt.go")
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			c, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			s, ok := c.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			switch s.Sel.Name {
			case "ExecContext", "QueryContext", "QueryRowContext":
				mapped, ok := c.Args[1].(*ast.CallExpr)
				if !ok {
					t.Errorf("%s unmapped SQL", path)
					return true
				}
				sel, ok := mapped.Fun.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "sql" {
					t.Errorf("%s unmapped SQL", path)
				}
			}
			return true
		})
	}
}

func TestReceiptOnlyMappingDoesNotRequireOutboundTables(t *testing.T) {
	r := &ReceiptRepository{}
	if err := WithReceiptTable("`assets_receipt`")(r); err != nil {
		t.Fatal(err)
	}
	query := "SELECT * FROM service_command_receipt WHERE receipt_id=? AND 'service_command_receipt'='service_command_receipt' /* service_command_receipt */"
	want := "SELECT * FROM `assets_receipt` WHERE receipt_id=? AND 'service_command_receipt'='service_command_receipt' /* service_command_receipt */"
	if got := r.sql(query); got != want {
		t.Fatalf("mapping %s", got)
	}
	if got := r.sql("SELECT * FROM integration_operation"); got != "SELECT * FROM integration_operation" {
		t.Fatal("receipt mapping expanded outbound access")
	}
	for _, invalid := range []string{"", "assets_receipt", "`other`.`receipt`", "`receipt`;DROP TABLE x"} {
		if err := WithReceiptTable(invalid)(&ReceiptRepository{}); err == nil {
			t.Fatalf("allowed %s", invalid)
		}
	}
	tables, err := NewOutboxTables("`op`", "`attempt`", "`receipt`", "`dead`")
	if err != nil {
		t.Fatal(err)
	}
	if err := WithReceiptOutboxTables(tables)(r); err == nil {
		t.Fatal("mixed mapping allowed")
	}
	other := &ReceiptRepository{}
	if err := WithReceiptOutboxTables(tables)(other); err != nil {
		t.Fatal(err)
	}
	if err := WithReceiptTable("`single`")(other); err == nil {
		t.Fatal("reverse mixed mapping allowed")
	}
}
