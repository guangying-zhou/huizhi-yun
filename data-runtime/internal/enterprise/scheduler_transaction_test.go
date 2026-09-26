package enterprise

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestSchedulerTransactionRequiresOwnAuthorityAndCurrentGeneration(t *testing.T) {
	for _, mode := range []PathMode{PathDisabled, PathLegacy, PathUnified} {
		for _, stale := range []bool{false, true} {
			t.Run(string(mode)+map[bool]string{false: "/current", true: "/stale"}[stale], func(t *testing.T) {
				db, mock, err := sqlmock.New()
				if err != nil {
					t.Fatal(err)
				}
				r := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { return db, nil })
				b := fixture("one")
				d := b.Domains["aims"]
				d.Write = PathUnified
				d.Scheduler = mode
				b.Domains["aims"] = d
				if err = r.Register(context.Background(), b); err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				q := request(b, "aims")
				q.Operation = Scheduler
				if mode == PathUnified {
					mock.ExpectBegin()
					generation := b.Generation
					if stale {
						generation++
					}
					mock.ExpectQuery("SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1 FOR SHARE").WillReturnRows(sqlmock.NewRows([]string{"tenant", "environment", "deployment", "schema", "generation"}).AddRow(b.Key.Tenant, b.Key.Environment, b.Key.RuntimeDeployment, b.SchemaVersion, generation))
					mock.ExpectRollback()
				}
				tx, _, err := r.BeginSchedulerTransaction(context.Background(), q)
				if mode != PathUnified || stale {
					if err == nil || tx != nil {
						t.Fatal("unauthorized or stale scheduler accepted")
					}
				} else {
					if err != nil {
						t.Fatal(err)
					}
					if err = tx.Rollback(); err != nil {
						t.Fatal(err)
					}
				}
				// A caller cannot pass its writer resolve request to the scheduler entry.
				q.Operation = Write
				if tx, _, err := r.BeginSchedulerTransaction(context.Background(), q); err == nil || tx != nil {
					t.Fatal("writer authority used for scheduler")
				}
				if err = mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
