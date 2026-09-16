package people

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRemapHRSourceDepartmentsUpdatesEmployeeAndAssignmentReferences(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectExec(`UPDATE people_employees`).WithArgs("DPT-RD", "DT-100").WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(`UPDATE people_assignments`).WithArgs("DPT-RD", "DT-100").WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectCommit()

	result, err := adapter.remapHRSourceDepartments(context.Background(), map[string]any{
		"aliases": []any{map[string]any{"aliasDeptCode": "DT-100", "canonicalDeptCode": "DPT-RD"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["employeesUpdated"] != int64(2) || result["assignmentsUpdated"] != int64(3) {
		t.Fatalf("unexpected result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
