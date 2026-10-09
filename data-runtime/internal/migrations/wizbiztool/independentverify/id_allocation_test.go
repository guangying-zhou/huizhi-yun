package independentverify

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"regexp"
	"testing"
)

func TestIndependentExplicitIDRejectsCollisionAndWrongStoredID(t *testing.T) {
	for _, tc := range []struct {
		name, ref, stored string
		reject            bool
	}{
		{"correct", "97", "98", false}, {"reference_collision", "98", "98", true}, {"wrong_stored_id", "97", "99", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, m, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			m.ExpectQuery(regexp.QuoteMeta("SELECT target_key,disposition FROM mig_object_map WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND target_table=? AND map_role=?")).WithArgs("wb_contract", "1", "altoc_contract", "primary").WillReturnRows(sqlmock.NewRows([]string{"target_key", "disposition"}).AddRow("CT-W000001", "created"))
			m.ExpectQuery("SELECT .*altoc_contract.*").WithArgs("CT-W000001").WillReturnRows(sqlmock.NewRows([]string{"id", "code"}).AddRow(tc.stored, "CT-W000001"))
			v := verifier{ctx: context.Background(), q: db, expectedMappings: map[string]bool{}, input: Input{IDAssignments: []IDAssignment{{"wb_contract", "1", "altoc_contract", "primary", "98"}}, IDBoundaries: map[string]IDBoundary{"altoc_contract": {Start: "98", TargetMaximum: "0", ReferenceValues: []string{tc.ref}}}}}
			v.allocatedIDs()
			if (len(v.result.Differences) > 0) != tc.reject {
				t.Fatalf("independent ID verdict mismatch: %s", tc.name)
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
