package directory

import (
	"database/sql"
	"reflect"
	"testing"
)

func TestEnterpriseProjectScopeDepartmentFacts(t *testing.T) {
	rows := []consoleDirectoryDepartmentRow{{Code: "ROOT"}, {Code: "CHILD", ParentCode: sql.NullString{String: "ROOT", Valid: true}}, {Code: "LEAF", ParentCode: sql.NullString{String: "CHILD", Valid: true}}}
	out, err := enterpriseProjectScopeDescendants(rows, []string{"ROOT", "MISSING"})
	if err != nil || !reflect.DeepEqual(out["ROOT"], []string{"CHILD", "LEAF", "ROOT"}) || !reflect.DeepEqual(out["MISSING"], []string{"MISSING"}) {
		t.Fatalf("facts=%v err=%v", out, err)
	}
	rows[0].ParentCode = sql.NullString{String: "LEAF", Valid: true}
	if _, err := enterpriseProjectScopeDescendants(rows, []string{"ROOT"}); err == nil {
		t.Fatal("cyclic directory graph accepted")
	}
}
