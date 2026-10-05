package aims

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"strings"
	"testing"
)

func projectModuleTestInput() map[string]any {
	config := map[string]any{}
	for _, key := range enterpriseProjectModuleKeys {
		config[key] = true
	}
	return map[string]any{"expectedVersion": strings.Repeat("a", 64), "expectedModuleConfig": nil, "moduleConfig": config}
}
func TestEnterpriseProjectModuleAllowlist(t *testing.T) {
	for _, kind := range []string{"valid", "extra", "missing", "string", "array", "invalid-original", "invalid-original-text", "adjacent"} {
		t.Run(kind, func(t *testing.T) {
			input := projectModuleTestInput()
			config := input["moduleConfig"].(map[string]any)
			switch kind {
			case "extra":
				config["workflowConfig"] = true
			case "missing":
				delete(config, "workflows")
			case "string":
				config["milestones"] = "true"
			case "array":
				input["moduleConfig"] = []any{}
			case "invalid-original":
				input["expectedModuleConfig"] = []any{}
			case "invalid-original-text":
				input["expectedModuleConfig"] = "not-json"
			case "adjacent":
				input["lifecycleStatus"] = "completed"
			}
			err := validateEnterpriseProjectModules(input)
			if (err == nil) != (kind == "valid") {
				t.Fatalf("%s: %v", kind, err)
			}
		})
	}
}
func versionTestRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"name", "short", "internal", "description", "method", "portfolio", "domain", "dept", "leader", "start", "end", "security", "confidentiality", "whitelist"}).AddRow("Project", "P", nil, nil, "PIVR", nil, nil, nil, "manager", nil, nil, "company", "L1", nil)
}
func TestEnterpriseProjectModuleSaveAndStaleOriginal(t *testing.T) {
	for _, conflict := range []string{"none", "basic", "modules"} {
		t.Run(conflict, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectQuery("SELECT name,short_name").WithArgs("7").WillReturnRows(versionTestRows())
			_, version, err := a.EnterpriseProjectEditableSnapshot(context.Background(), "7")
			if err != nil {
				t.Fatal(err)
			}
			input := projectModuleTestInput()
			input["expectedVersion"] = version
			if conflict == "basic" {
				input["expectedVersion"] = strings.Repeat("0", 64)
			}
			m.ExpectBegin()
			tx, _ := a.DB().BeginTx(context.Background(), nil)
			m.ExpectQuery("SELECT name,short_name").WithArgs("7").WillReturnRows(versionTestRows())
			if conflict != "basic" {
				var original any
				if conflict == "modules" {
					original = `{"milestones":false}`
				}
				m.ExpectQuery("SELECT CAST\\(module_config AS CHAR\\)").WithArgs("7").WillReturnRows(sqlmock.NewRows([]string{"config"}).AddRow(original))
			}
			if conflict == "none" {
				m.ExpectExec("UPDATE aims_projects SET module_config").WithArgs(sqlmock.AnyArg(), "7").WillReturnResult(sqlmock.NewResult(0, 1))
				m.ExpectExec("INSERT INTO project_activity_logs").WithArgs("7", "7", "manager", sqlmock.AnyArg(), "intent-7").WillReturnResult(sqlmock.NewResult(1, 1))
			}
			result, err := saveProjectModulesTx(context.Background(), tx, lifecycleRequestIdentity(), "7", input)
			if (err == nil) != (conflict == "none") {
				t.Fatalf("result=%v err=%v", result, err)
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEnterpriseSettingsManagerGate(t *testing.T) {
	for _, kind := range []string{"leader", "active-manager", "member"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			tx, _ := a.DB().BeginTx(context.Background(), nil)
			count := 0
			leader := "other"
			if kind == "leader" {
				leader = "manager"
			}
			if kind == "active-manager" {
				count = 1
			}
			m.ExpectQuery("SELECT COUNT\\(\\*\\) FROM aims_project_members").WithArgs("7", "manager").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(count))
			err := requireEnterpriseSettingsManagerTx(context.Background(), tx, "7", "manager", leader)
			if (err == nil) != (kind != "member") {
				t.Fatalf("%s: %v", kind, err)
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestEnterpriseModulesRequiresScopeBeforeDatabase(t *testing.T) {
	a, m, done := newAimsSQLMockAdapter(t)
	defer done()
	if _, err := a.UpdateEnterpriseProjectModules(context.Background(), EnterpriseProjectUpdateIdentity{}, "7", projectModuleTestInput()); err == nil {
		t.Fatal("unscoped module write accepted")
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
