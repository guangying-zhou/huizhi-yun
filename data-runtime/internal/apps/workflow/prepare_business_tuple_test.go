package workflow

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

// Exercise the real prepare response consumed by strict Host tuple checks.
func TestPrepareIncludesOwningAppInBusinessTuple(t *testing.T) {
	for _, tuple := range [][3]string{{"finance", "expenses", "claim"}, {"finance", "expenses", "project_expense"}, {"finance", "expenses", "payment"}, {"finance", "invoices", "request"}, {"altoc", "quotation", "approve"}, {"altoc", "contract", "approve"}, {"aims", "tasks", "complete"}} {
		t.Run(tuple[0]+"/"+tuple[1]+"/"+tuple[2], func(t *testing.T) {
			a, m, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
			defer closeDB()
			m.ExpectQuery(`(?s)SELECT id, app_code, resource_code, action_code, name, form_schema_id.*FROM flow_action_defs`).WithArgs(tuple[0], tuple[1], tuple[2]).WillReturnRows(sqlmock.NewRows([]string{"id", "app_code", "resource_code", "action_code", "name", "form_schema_id"}).AddRow(9, tuple[0], tuple[1], tuple[2], "Approval", nil))
			m.ExpectQuery(`(?s)SELECT.*FROM flow_routes`).WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"id", "action_def_id", "flow_schema_id", "name", "description", "level", "conditions", "priority", "is_default"}).AddRow(4, 9, 5, "default", nil, nil, nil, 0, 1))
			m.ExpectQuery(`SELECT id, code, name, nodes, config, version FROM flow_schemas`).WithArgs(int64(5)).WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "nodes", "config", "version"}).AddRow(5, "APF", "Approval", `[{"name":"审批"}]`, nil, 1))
			out, err := a.PrepareInstance(context.Background(), map[string]any{"app_code": tuple[0], "resource_code": tuple[1], "action_code": tuple[2], "current_user": "actor", "biz_id": "marked"})
			if err != nil {
				t.Fatal(err)
			}
			def := out.Data.(map[string]any)["action_def"].(map[string]any)
			if def["app_code"] != tuple[0] || def["resource_code"] != tuple[1] || def["action_code"] != tuple[2] {
				t.Fatalf("incomplete business tuple: %v", def)
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
