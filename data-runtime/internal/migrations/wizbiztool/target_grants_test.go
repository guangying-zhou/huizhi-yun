package wizbiztool

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"strings"
	"testing"
)

func nativeTargetGrants(plan TargetGrantPlan) []string {
	result := []string{"GRANT USAGE ON *.* TO `hzy_wizbiz_migrate`@`127.0.0.1`"}
	for _, s := range plan.Grants {
		result = append(result, strings.ReplaceAll(strings.TrimSuffix(s, ";"), "'hzy_wizbiz_migrate'@'127.0.0.1'", "`hzy_wizbiz_migrate`@`127.0.0.1`"))
	}
	return result
}
func TestTargetGrantCandidateMatchesActualToolGateMySQL(t *testing.T) {
	f := newToolFixture(t)
	plan, err := BuildTargetGrantPlan(f.profile)
	if err != nil {
		t.Fatal(err)
	}
	grants := nativeTargetGrants(plan)
	if err := CheckTargetGrantSnapshot(plan, grants); err != nil {
		t.Fatal(err)
	}
	// Execute the real gate with this candidate's native grants; no account created.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT CURRENT_USER").WillReturnRows(sqlmock.NewRows([]string{"user"}).AddRow(plan.Account))
	rows := sqlmock.NewRows([]string{"grant"})
	for _, g := range grants {
		rows.AddRow(g)
	}
	mock.ExpectQuery("SHOW GRANTS FOR CURRENT_USER").WillReturnRows(rows)
	if err := CheckTargetPrivileges(context.Background(), db, f.profile); err != nil {
		t.Fatalf("candidate does not satisfy unchanged tool gate: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if len(plan.DMLTables) != len(targetTableSet())-1 {
		t.Fatal("target DML closure drift")
	}
	for _, table := range plan.ReadOnlyTables {
		if table != "enterprise_schema_registry" && targetTableSet()[table] {
			t.Fatal("DML misclassified")
		}
	}
	for _, mutation := range []string{"missing", "schema", "ddl", "grant-option", "adjacent", "duplicate", "wrong-host"} {
		t.Run(mutation, func(t *testing.T) {
			bad := append([]string{}, grants...)
			switch mutation {
			case "missing":
				bad = bad[:len(bad)-1]
			case "schema":
				bad = append(bad, "GRANT SELECT ON `"+plan.Database+"`.* TO `hzy_wizbiz_migrate`@`127.0.0.1`")
			case "ddl":
				bad[1] = strings.Replace(bad[1], "GRANT SELECT", "GRANT ALTER, SELECT", 1)
			case "grant-option":
				bad[1] += " WITH GRANT OPTION"
			case "adjacent":
				bad = append(bad, "GRANT SELECT ON `"+plan.Database+"`.`not_registered` TO `hzy_wizbiz_migrate`@`127.0.0.1`")
			case "duplicate":
				bad = append(bad, bad[1])
			case "wrong-host":
				bad[1] = strings.ReplaceAll(bad[1], "127.0.0.1", "localhost")
			}
			if !errors.Is(CheckTargetGrantSnapshot(plan, bad), ErrTarget) {
				t.Fatal("non-exact candidate accepted")
			}
		})
	}
	// Removing registered mappings changes the plan/hash; no stale static inventory.
	p2, err := BuildTargetGrantPlan(f.profile)
	if err != nil || p2.ReviewHash != plan.ReviewHash {
		t.Fatal("plan is not deterministic")
	}
}
