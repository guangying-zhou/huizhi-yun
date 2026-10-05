package directory

import (
	"database/sql"
	"reflect"
	"testing"
)

func TestEnterpriseDocumentAccessDepartmentsMatchesPrimaryAndManagedDescendants(t *testing.T) {
	rows := []consoleDirectoryDepartmentRow{
		{Code: "managed", ManagerUID: sql.NullString{String: "actor", Valid: true}},
		{Code: "child", ParentCode: sql.NullString{String: "managed", Valid: true}},
		{Code: "grandchild", ParentCode: sql.NullString{String: "child", Valid: true}},
		{Code: "other", ManagerUID: sql.NullString{String: "someone", Valid: true}},
		{Code: "primary"},
	}
	got := enterpriseDocumentAccessDepartmentCodes(rows, "actor", "primary")
	if !reflect.DeepEqual(got, []string{"child", "grandchild", "managed", "primary"}) {
		t.Fatal(got)
	}
	if got := enterpriseDocumentAccessDepartmentCodes(rows, "nonmanager", "primary"); !reflect.DeepEqual(got, []string{"primary"}) {
		t.Fatal(got)
	}
}
