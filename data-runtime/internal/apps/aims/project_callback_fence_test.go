package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func bindProjectCallbackMock(t *testing.T, a *Adapter) {
	t.Helper()
	b := e.Binding{Key: e.BindingKey{Tenant: "T", Environment: "test", RuntimeDeployment: "runtime"}, Storage: e.Storage{InstanceID: "instance", Address: "127.0.0.1:3306", Database: "business"}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "enterprise", Tables: map[string]string{"service_command_receipt": "service_command_receipt"}, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}}
	r := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return a.DB(), nil })
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	a.enterpriseWrites = &enterpriseWriteBinding{registry: r, writer: e.ResolveRequest{Key: b.Key, Domain: "aims", OwnerDeployment: "enterprise", SchemaVersion: "v1", Generation: 1, Operation: e.Write}, binding: b, sourceDeployment: "host"}
}
func expectProjectCallbackFence(m sqlmock.Sqlmock, generation int) {
	m.ExpectQuery("SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1 FOR SHARE").WillReturnRows(sqlmock.NewRows([]string{"tenant", "environment", "deployment", "schema", "generation"}).AddRow("T", "test", "runtime", "v1", generation))
}
func TestProjectCallbacksRejectStaleGenerationBeforeBusinessWrites(t *testing.T) {
	for _, kind := range []string{"lifecycle", "initiation"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			bindProjectCallbackMock(t, a)
			m.ExpectBegin()
			expectProjectCallbackFence(m, 2)
			m.ExpectRollback()
			var err error
			if kind == "lifecycle" {
				_, err = a.applyProjectLifecycleWorkflowCallback(context.Background(), url.Values{"workflow_callback_verified": {"true"}}, lifecycleCallback("pause", "approved"))
			} else {
				_, err = a.applyProjectInitiationWorkflowCallback(context.Background(), url.Values{"workflow_callback_verified": {"true"}}, projectInitiationCallbackBody("approved"))
			}
			if !errors.Is(err, e.ErrBindingMismatch) {
				t.Fatalf("stale generation error=%v", err)
			}
			// No business query/write expectations: any attempt to write is a test failure.
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestProjectLifecycleBindValidatesActualWorkflowOwnership(t *testing.T) {
	for _, kind := range []string{"valid", "number", "request", "project", "actor", "action", "missing"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			tx, _ := a.DB().Begin()
			form := map[string]any{"requestNo": "PLC-test", "projectId": "7", "requestedBy": "manager", "actionCode": "pause"}
			number, biz, actor, action := "WF44", "7", "manager", "pause"
			switch kind {
			case "number":
				number = "WF45"
			case "request":
				form["requestNo"] = "PLC-other"
			case "project":
				biz = "8"
			case "actor":
				actor = "other"
			case "action":
				action = "finish"
			}
			raw, _ := json.Marshal(form)
			rows := sqlmock.NewRows([]string{"number", "biz", "actor", "app", "resource", "action", "form"})
			if kind != "missing" {
				rows.AddRow(number, biz, actor, "aims", "projects", action, string(raw))
			}
			m.ExpectQuery("SELECT instance_no,biz_id,initiator_uid").WithArgs("44").WillReturnRows(rows)
			err := verifyProjectLifecycleInstanceTx(context.Background(), tx, "`flow_instances`", lifecycleRequestIdentity(), "7", map[string]any{"instanceId": "44", "instanceNo": "WF44", "requestNo": "PLC-test", "actionCode": "pause"})
			if (err == nil) != (kind == "valid") {
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
