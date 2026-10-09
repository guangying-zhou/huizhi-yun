package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestCompletionTransactionCoresRejectMissingTxAndWriter(t *testing.T) {
	a := &Adapter{}
	if _, err := a.RequestEnterpriseWorkItemCompletionInTransaction(context.Background(), nil, e.Resolved{}, EnterpriseProjectUpdateIdentity{}, "1", "2", "matter", map[string]any{}); err == nil {
		t.Fatal("nil tx accepted")
	}
	if _, err := a.ApplyWorkItemCompletionCallbackInTransaction(context.Background(), nil, e.Resolved{}, VerifiedWorkItemCompletionCallback{}); err == nil {
		t.Fatal("nil tx accepted")
	}
}

func TestCompletionCallerResolvedMustMatchRegisteredWriter(t *testing.T) {
	db, m, _ := sqlmock.New()
	defer db.Close()
	binding := e.Binding{Key: e.BindingKey{Tenant: "T", Environment: "test", RuntimeDeployment: "runtime"}, Storage: e.Storage{InstanceID: "instance", Address: "127.0.0.1:3306", Database: "business"}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "enterprise", Tables: map[string]string{"service_command_receipt": "aims_service_command_receipt"}, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}}
	r := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err := r.Register(context.Background(), binding); err != nil {
		t.Fatal(err)
	}
	request := e.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: "enterprise", SchemaVersion: "v1", Generation: 1, Operation: e.Write}
	a := &Adapter{enterpriseWrites: &enterpriseWriteBinding{registry: r, writer: request, binding: binding, sourceDeployment: "host"}}
	resolved, err := r.Resolve(request)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.verifyCompletionResolved(resolved); err != nil {
		t.Fatal("valid resolved", err)
	}
	identity := EnterpriseProjectUpdateIdentity{Tenant: "T", SourceDeployment: "host", TargetDeployment: "runtime"}
	for name, mutate := range map[string]func(*e.Resolved){"key": func(v *e.Resolved) { v.Key.Tenant = "other" }, "generation": func(v *e.Resolved) { v.Generation++ }, "db": func(v *e.Resolved) { v.DB = &sql.DB{} }, "owner": func(v *e.Resolved) { v.OwnerDeployment = "other" }, "domain": func(v *e.Resolved) { v.Domain = "workflow" }} {
		t.Run(name, func(t *testing.T) {
			bad := resolved
			mutate(&bad)
			m.ExpectBegin()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			if _, err = a.RequestEnterpriseWorkItemCompletionInTransaction(context.Background(), tx, bad, identity, "1", "2", "matter", nil); err == nil {
				t.Fatal("request accepted mismatched resolved")
			}
			if _, err = a.ApplyWorkItemCompletionCallbackInTransaction(context.Background(), tx, bad, VerifiedWorkItemCompletionCallback{}); err == nil {
				t.Fatal("callback accepted mismatched resolved")
			}
			m.ExpectRollback()
			tx.Rollback()
		})
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionInProcessEmptyDirectorySnapshotFailsBeforeDB(t *testing.T) {
	for _, raw := range []json.RawMessage{nil, json.RawMessage(`null`), json.RawMessage(`{}`), json.RawMessage(`{"context"
 "encoding/json"
 "errors"
 "github.com/huizhi-yun/data-runtime/internal/httperror":null}`), json.RawMessage(`{`)} {
		_, err := (&Adapter{}).requestEnterpriseWorkItemCompletionTx(context.Background(), nil, nil, completionInProcess, EnterpriseProjectUpdateIdentity{}, "1", "2", "matter", nil, raw)
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != 503 || h.Code != "workflow_directory_snapshot_unavailable" {
			t.Fatal(err)
		}
	}
}
