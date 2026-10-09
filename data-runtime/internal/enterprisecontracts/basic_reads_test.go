package enterprisecontracts

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestAltocBasicReadPersistentFenceBeforeBusinessSQL(t *testing.T) {
	for _, scenario := range []string{"valid", "tenant", "environment", "deployment", "schema", "generation", "missing"} {
		t.Run(scenario, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
			tables := map[string]string{}
			for _, table := range altoc.BasicReadTables {
				tables[table] = "altoc_" + table
			}
			binding := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test"}, Storage: e.Storage{InstanceID: "mysql-instance", Address: "127.0.0.1:3306", Database: "test_business"}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"altoc": {OwnerDeployment: "enterprise-test", Tables: tables, Read: e.PathUnified, Write: e.PathDisabled, Scheduler: e.PathDisabled}}}
			if err = registry.Register(context.Background(), binding); err != nil {
				t.Fatal(err)
			}
			service, err := NewBasicReadService(registry, binding)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectBegin()
			fence := mock.ExpectQuery("SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1 FOR SHARE")
			tenant, environment, deployment, schema, generation := "tenant-a", "test", "runtime-test", "v1", 1
			switch scenario {
			case "tenant":
				tenant = "other"
			case "environment":
				environment = "prod"
			case "deployment":
				deployment = "other"
			case "schema":
				schema = "v0"
			case "generation":
				generation = 2
			}
			if scenario == "missing" {
				fence.WillReturnError(sql.ErrNoRows)
			} else {
				fence.WillReturnRows(sqlmock.NewRows([]string{"tenant", "environment", "deployment", "schema", "generation"}).AddRow(tenant, environment, deployment, schema, generation))
			}
			if scenario == "valid" {
				mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM `altoc_customer`").WithArgs("actor").WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(0))
				mock.ExpectQuery("SELECT .* FROM `altoc_customer`").WithArgs("actor", 20, 0).WillReturnRows(sqlmock.NewRows([]string{"id"}))
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			_, err = service.Read(context.Background(), "customer", "", "actor", altoc.BasicReadScope{Access: "self"}, altoc.BasicReadQuery{Page: 1, PageSize: 20})
			if (err == nil) != (scenario == "valid") {
				t.Fatalf("unexpected fence outcome %v", err)
			}
			mock.ExpectClose()
			if err = registry.Close(); err != nil {
				t.Fatal(err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
