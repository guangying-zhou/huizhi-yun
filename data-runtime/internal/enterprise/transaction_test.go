package enterprise

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestWriteTransactionPersistentBinding(t *testing.T) {
	for _, scenario := range []string{"valid", "tenant", "environment", "deployment", "schema", "generation", "missing"} {
		t.Run(scenario, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			r := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { return db, nil })
			b := fixture("one")
			d := b.Domains["aims"]
			d.Write = PathUnified
			b.Domains["aims"] = d
			if err := r.Register(context.Background(), b); err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			mock.ExpectBegin()
			q := mock.ExpectQuery("SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1 FOR SHARE")
			tenant, env, deployment, schema, generation := b.Key.Tenant, b.Key.Environment, b.Key.RuntimeDeployment, b.SchemaVersion, b.Generation
			switch scenario {
			case "tenant":
				tenant = "other"
			case "environment":
				env = "prod"
			case "deployment":
				deployment = "other-runtime"
			case "schema":
				schema = "other-schema"
			case "generation":
				generation++
			}
			if scenario == "missing" {
				q.WillReturnError(sql.ErrNoRows)
			} else {
				q.WillReturnRows(sqlmock.NewRows([]string{"tenant", "environment", "deployment", "schema", "generation"}).AddRow(tenant, env, deployment, schema, generation))
			}
			a, c := request(b, "aims"), request(b, "assets")
			a.Operation, c.Operation = Write, Write
			if scenario != "valid" {
				mock.ExpectRollback()
			}
			tx, domains, err := r.BeginWriteTransaction(context.Background(), a, c)
			if scenario == "valid" {
				if err != nil || tx == nil || len(domains) != 2 || domains[0].DB != domains[1].DB {
					t.Fatalf("invalid transaction: %v", err)
				}
				mock.ExpectCommit()
				if err := tx.Commit(); err != nil {
					t.Fatal(err)
				}
			} else if err == nil || tx != nil || domains != nil {
				t.Fatalf("stale transaction accepted: %v", err)
			}
			mock.ExpectClose()
			if err := r.Close(); err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestWriteTransactionRequiresUnifiedWriters(t *testing.T) {
	r, _ := registry(t)
	b := fixture("one")
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	for _, requests := range [][]ResolveRequest{nil, {request(b, "assets")}, {func() ResolveRequest { q := request(b, "aims"); q.Operation = Write; return q }()}} {
		tx, _, err := r.BeginWriteTransaction(context.Background(), requests...)
		if err == nil || tx != nil {
			t.Fatal("non-writer/legacy request accepted")
		}
	}
}
