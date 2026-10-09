package enterprise

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestSchedulerBindingRejectsBorrowedHostIdentity(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	registry := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { return db, nil })
	b := fixture("one")
	d := b.Domains["aims"]
	d.Scheduler = PathUnified
	d.Tables = map[string]string{"integration_operation": "aims_integration_operation", "integration_operation_attempt": "aims_integration_operation_attempt", "service_command_receipt": "aims_service_command_receipt", "integration_operation_dead_letter_actionable": "aims_integration_operation_dead_letter_actionable"}
	b.Domains["aims"] = d
	if err = registry.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	q := request(b, "aims")
	q.Operation = Scheduler
	resolved, err := registry.Resolve(q)
	if err != nil {
		t.Fatal(err)
	}
	source, err := NewOutboundSource(q, resolved, "real-aims-deployment", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewSchedulerBinding(registry, q, source)
	if err != nil {
		t.Fatal(err)
	}
	good := SchedulerIdentity{Tenant: b.Key.Tenant, Deployment: "real-aims-deployment", SourceApp: "aims", ClientID: "aims.runtime", Subject: "aims.runtime"}
	for _, field := range []string{"tenant", "deployment", "app", "client", "subject"} {
		bad := good
		switch field {
		case "tenant":
			bad.Tenant = "other"
		case "deployment":
			bad.Deployment = "enterprise-deployment"
		case "app":
			bad.SourceApp = "enterprise"
		case "client":
			bad.ClientID = "enterprise.runtime"
		case "subject":
			bad.Subject = "enterprise.runtime"
		}
		if tx, _, err := s.Begin(context.Background(), bad); err == nil || tx != nil {
			t.Fatalf("accepted invalid %s", field)
		}
	}
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1 FOR SHARE").WillReturnRows(sqlmock.NewRows([]string{"tenant", "environment", "deployment", "schema", "generation"}).AddRow(b.Key.Tenant, b.Key.Environment, b.Key.RuntimeDeployment, b.SchemaVersion, b.Generation))
	tx, _, err := s.Begin(context.Background(), good)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectCommit()
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
