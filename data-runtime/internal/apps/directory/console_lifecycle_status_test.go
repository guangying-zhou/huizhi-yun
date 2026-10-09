package directory

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"strings"
	"testing"
)

func TestConsoleExactLifecycleProbeSeparatesRevokeAndEmployment(t *testing.T) {
	for _, kind := range []string{"employment", "offboarding"} {
		for _, status := range []string{"pending", "succeeded", "partial_unknown"} {
			t.Run(kind+"/"+status, func(t *testing.T) {
				db, m, e := sqlmock.New()
				if e != nil {
					t.Fatal(e)
				}
				defer db.Close()
				a := newAdapter(db, false, "C000001", "", "")
				hash := strings.Repeat("a", 64)
				m.ExpectBegin()
				m.ExpectQuery("SELECT applied_revision,snapshot_hash,lifecycle_type").WithArgs("employee-1").WillReturnRows(sqlmock.NewRows([]string{"applied_revision", "snapshot_hash", "lifecycle_type"}).AddRow(7, hash, kind))
				code := consoleEmploymentPlatformOperation
				if kind == "offboarding" {
					code = consoleOffboardingPlatformOperation
				}
				m.ExpectQuery("SELECT status FROM integration_operation").WithArgs("C000001", code, "employee-1", consoleLifecyclePlatformKey("employee-1", 7)).WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(status))
				m.ExpectCommit()
				out, e := a.ConsoleReadLifecycleCommandStatus(context.Background(), "employee-1", kind, hash, 7)
				if e != nil {
					t.Fatal(e)
				}
				if out["directoryStatus"] != "succeeded" || out["platformStatus"] != status || len(out) != 3 {
					t.Fatal(out)
				}
				if e = m.ExpectationsWereMet(); e != nil {
					t.Fatal(e)
				}
			})
		}
	}
}
func TestConsoleExactLifecycleProbeRejectsMismatchedRevisionAndDependencyError(t *testing.T) {
	for _, failure := range []string{"hash", "db", "superseded"} {
		t.Run(failure, func(t *testing.T) {
			db, m, _ := sqlmock.New()
			defer db.Close()
			a := newAdapter(db, false, "C000001", "", "")
			hash := strings.Repeat("a", 64)
			m.ExpectBegin()
			q := m.ExpectQuery("SELECT applied_revision,snapshot_hash,lifecycle_type").WithArgs("employee-1")
			if failure == "db" {
				q.WillReturnError(errors.New("dependency unavailable"))
			} else {
				revision := 7
				if failure == "superseded" {
					revision = 8
				}
				q.WillReturnRows(sqlmock.NewRows([]string{"applied_revision", "snapshot_hash", "lifecycle_type"}).AddRow(revision, strings.Repeat("b", 64), "offboarding"))
			}
			if failure == "superseded" {
				m.ExpectQuery("SELECT status FROM integration_operation").WithArgs("C000001", consoleOffboardingPlatformOperation, "employee-1", consoleLifecyclePlatformKey("employee-1", 7)).WillReturnRows(sqlmock.NewRows([]string{"status"}))
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			out, e := a.ConsoleReadLifecycleCommandStatus(context.Background(), "employee-1", "offboarding", hash, 7)
			if failure == "superseded" {
				if e != nil || out["directoryStatus"] != "superseded" || out["platformStatus"] != "unknown" {
					t.Fatal(out, e)
				}
			} else if e == nil {
				t.Fatal("failure accepted")
			}
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}
