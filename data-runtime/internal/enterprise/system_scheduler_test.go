package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestSystemSchedulerAllowlistAndGenerationFence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	registry := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { return db, nil })
	b := fixture("one")
	d := b.Domains["aims"]
	d.Scheduler = PathUnified
	b.Domains["aims"] = d
	if err = registry.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	q := request(b, "aims")
	q.Operation = Scheduler
	guard, err := NewSystemSchedulerBinding(registry, q)
	if err != nil {
		t.Fatal(err)
	}
	if guard.Principal() != "system:enterprise-scheduler" {
		t.Fatal("not a fixed system principal")
	}
	for _, task := range []string{"", "aims.runtime", "aims.integration.claim", "assets.due", "aims.milestone.rollover-other"} {
		if tx, _, err := guard.BeginSystemScheduler(context.Background(), task); !errors.Is(err, ErrBindingMismatch) || tx != nil {
			t.Fatal("task accepted", task, err)
		}
	}
	for _, generation := range []uint64{b.Generation, b.Generation + 1} {
		mock.ExpectBegin()
		mock.ExpectQuery("SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1 FOR SHARE").WillReturnRows(sqlmock.NewRows([]string{"tenant", "environment", "deployment", "schema", "generation"}).AddRow(b.Key.Tenant, b.Key.Environment, b.Key.RuntimeDeployment, b.SchemaVersion, generation))
		mock.ExpectRollback()
		tx, resolved, err := guard.BeginSystemScheduler(context.Background(), SystemMilestoneRolloverTask)
		if generation == b.Generation {
			if err != nil || resolved.Generation != b.Generation {
				t.Fatal(err)
			}
			if err = tx.Rollback(); err != nil {
				t.Fatal(err)
			}
		} else if !errors.Is(err, ErrBindingMismatch) || tx != nil {
			t.Fatal("stale generation accepted", err)
		}
	}
	q.Operation = Write
	if _, err := NewSystemSchedulerBinding(registry, q); err == nil {
		t.Fatal("writer authority accepted")
	}
	q.Operation = Scheduler
	q.Domain = "assets"
	if _, err := NewSystemSchedulerBinding(registry, q); err == nil {
		t.Fatal("other domain accepted")
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
