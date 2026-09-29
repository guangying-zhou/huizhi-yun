package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func fixture(tenant string) Binding {
	return Binding{Key: BindingKey{Tenant: tenant, Environment: "test", RuntimeDeployment: tenant + "-runtime"}, Storage: Storage{InstanceID: "verified-mysql-server", Address: "127.0.0.1:3306", Database: tenant + "_business"}, SchemaVersion: "enterprise-v1", Generation: 1, Domains: map[string]DomainBinding{"aims": {OwnerDeployment: tenant + "-aims", Tables: map[string]string{"receipt": "aims_receipt"}, Read: PathUnified, Write: PathLegacy, Scheduler: PathDisabled}, "assets": {OwnerDeployment: tenant + "-assets", Tables: map[string]string{"receipt": "assets_receipt"}, Read: PathUnified, Write: PathUnified, Scheduler: PathDisabled}}}
}
func request(b Binding, domain string) ResolveRequest {
	return ResolveRequest{Key: b.Key, Domain: domain, OwnerDeployment: b.Domains[domain].OwnerDeployment, SchemaVersion: b.SchemaVersion, Generation: b.Generation, Operation: Read}
}
func registry(t *testing.T) (*Registry, *atomic.Int32) {
	t.Helper()
	calls := &atomic.Int32{}
	var mocks []sqlmock.Sqlmock
	r := NewRegistry(func(_ context.Context, _ Storage) (*sql.DB, error) {
		calls.Add(1)
		db, mock, err := sqlmock.New()
		if err != nil {
			return nil, err
		}
		mock.ExpectClose()
		mocks = append(mocks, mock)
		return db, nil
	})
	t.Cleanup(func() {
		if err := r.Close(); err != nil {
			t.Error(err)
		}
		for _, mock := range mocks {
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Error(err)
			}
		}
	})
	return r, calls
}
func TestRegistryContextAndModes(t *testing.T) {
	r, _ := registry(t)
	b := fixture("one")
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	req := request(b, "aims")
	got, err := r.Resolve(req)
	if err != nil {
		t.Fatal(err)
	}
	if table, err := got.Table("receipt"); err != nil || table != "`aims_receipt`" {
		t.Fatal(table, err)
	}
	if _, err := got.Table("unmapped"); !errors.Is(err, ErrBindingMismatch) {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*ResolveRequest){"tenant": func(q *ResolveRequest) { q.Key.Tenant = "other" }, "environment": func(q *ResolveRequest) { q.Key.Environment = "production" }, "runtime": func(q *ResolveRequest) { q.Key.RuntimeDeployment = "other" }, "owner": func(q *ResolveRequest) { q.OwnerDeployment = "other" }, "schema": func(q *ResolveRequest) { q.SchemaVersion = "v0" }, "generation": func(q *ResolveRequest) { q.Generation++ }, "domain": func(q *ResolveRequest) { q.Domain = "unknown" }, "operation": func(q *ResolveRequest) { q.Operation = "" }} {
		t.Run(name, func(t *testing.T) {
			q := req
			change(&q)
			if _, err := r.Resolve(q); err == nil {
				t.Fatal("mismatched request resolved")
			}
		})
	}
	for _, op := range []Operation{Write, Scheduler} {
		q := req
		q.Operation = op
		if _, err := r.Resolve(q); !errors.Is(err, ErrPathDisabled) {
			t.Fatal(err)
		}
	}
}
func TestRegistryDeepCopyAndPoolSharing(t *testing.T) {
	r, calls := registry(t)
	b := fixture("one")
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	req := request(b, "aims")
	b.Domains["aims"].Tables["receipt"] = "poison"
	a, err := r.Resolve(req)
	if err != nil {
		t.Fatal(err)
	}
	if table, _ := a.Table("receipt"); table != "`aims_receipt`" {
		t.Fatal(table)
	}
	second := fixture("one")
	second.Key.RuntimeDeployment = "one-next-runtime"
	second.Storage.Address = "localhost:3306"
	if err := r.Register(context.Background(), second); err != nil {
		t.Fatal(err)
	}
	c, err := r.Resolve(request(second, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	if a.DB != c.DB || calls.Load() != 1 {
		t.Fatal("same instance/schema must reuse pool")
	}
	other := fixture("two")
	other.Storage = second.Storage
	if err := r.Register(context.Background(), other); !errors.Is(err, ErrStorageTenantConflict) {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("conflict opened connection")
	}
}
func TestRegistryRejectsInvalidLocalConfiguration(t *testing.T) {
	for name, change := range map[string]func(*Binding){"empty key": func(b *Binding) { b.Key.Tenant = "" }, "instance": func(b *Binding) { b.Storage.InstanceID = "" }, "schema injection": func(b *Binding) { b.Storage.Database = "a`; DROP TABLE x" }, "address": func(b *Binding) { b.Storage.Address = "localhost" }, "version": func(b *Binding) { b.SchemaVersion = "" }, "generation": func(b *Binding) { b.Generation = 0 }, "domain": func(b *Binding) { b.Domains = nil }, "missing tables": func(b *Binding) { d := b.Domains["aims"]; d.Tables = nil; b.Domains["aims"] = d }, "table injection": func(b *Binding) { b.Domains["aims"].Tables["receipt"] = "a.b" }, "shared receipt": func(b *Binding) { b.Domains["aims"].Tables["receipt"] = "assets_receipt" }, "zero mode": func(b *Binding) { d := b.Domains["aims"]; d.Read = ""; b.Domains["aims"] = d }} {
		t.Run(name, func(t *testing.T) {
			r, calls := registry(t)
			b := fixture("one")
			change(&b)
			if err := r.Register(context.Background(), b); !errors.Is(err, ErrInvalidBinding) {
				t.Fatal(err)
			}
			if calls.Load() != 0 {
				t.Fatal("invalid configuration opened connection")
			}
		})
	}
}
func TestRegistryConcurrentTenantIsolationAndClose(t *testing.T) {
	r, calls := registry(t)
	const tenants = 20
	var wg sync.WaitGroup
	for i := 0; i < tenants; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			b := fixture(fmt.Sprintf("tenant%d", i))
			if err := r.Register(context.Background(), b); err != nil {
				t.Error(err)
				return
			}
			for j := 0; j < 20; j++ {
				got, err := r.Resolve(request(b, "aims"))
				if err != nil || got.Key.Tenant != b.Key.Tenant {
					t.Errorf("cross tenant resolution: %v", err)
				}
			}
		}(i)
	}
	wg.Wait()
	if calls.Load() != tenants {
		t.Fatal(calls.Load())
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Resolve(request(fixture("tenant0"), "aims")); !errors.Is(err, ErrRegistryClosed) {
		t.Fatal(err)
	}
	if err := r.Register(context.Background(), fixture("late")); !errors.Is(err, ErrRegistryClosed) {
		t.Fatal(err)
	}
}
func TestRegistryFailedRegistrationCanRetry(t *testing.T) {
	calls := 0
	r := NewRegistry(func(context.Context, Storage) (*sql.DB, error) { calls++; return nil, errors.New("offline") })
	b := fixture("one")
	for i := 0; i < 2; i++ {
		if err := r.Register(context.Background(), b); err == nil {
			t.Fatal("factory failure accepted")
		}
	}
	if calls != 2 {
		t.Fatal(calls)
	}
	if _, err := r.Resolve(request(b, "aims")); !errors.Is(err, ErrBindingNotFound) {
		t.Fatal(err)
	}
	r2, c := registry(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := r2.Register(ctx, b); !errors.Is(err, context.Canceled) || c.Load() != 0 {
		t.Fatal(err)
	}
	if err := NewRegistry(nil).Register(context.Background(), b); !errors.Is(err, ErrInvalidBinding) {
		t.Fatal(err)
	}
}

func TestRegistryRejectsRebindingAndCrossBindingTableCollision(t *testing.T) {
	r, _ := registry(t)
	b := fixture("one")
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	if err := r.Register(context.Background(), b); !errors.Is(err, ErrBindingExists) {
		t.Fatal(err)
	}
	next := fixture("one")
	next.Key.RuntimeDeployment = "next"
	next.SchemaVersion = "incompatible"
	if err := r.Register(context.Background(), next); !errors.Is(err, ErrBindingMismatch) {
		t.Fatal(err)
	}
	next.SchemaVersion = b.SchemaVersion
	next.Domains = map[string]DomainBinding{"other": {OwnerDeployment: "other", Tables: map[string]string{"receipt": "aims_receipt"}, Read: PathUnified, Write: PathDisabled, Scheduler: PathDisabled}}
	if err := r.Register(context.Background(), next); !errors.Is(err, ErrInvalidBinding) {
		t.Fatal(err)
	}
}

func TestRegistryConcurrentCloseAndRegister(t *testing.T) {
	r, _ := registry(t)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			err := r.Register(context.Background(), fixture(fmt.Sprintf("race%d", i)))
			if err != nil && !errors.Is(err, ErrRegistryClosed) {
				t.Error(err)
			}
		}(i)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := r.Close(); err != nil {
			t.Error(err)
		}
	}()
	wg.Wait()
}

// Migration compatibility: each operation follows its own registered mode, so a
// domain still served by the old registry never resolves here and a unified read
// never enables writes or scheduler work for the same verified identity.
func TestResolveKeepsPerOperationMigrationModes(t *testing.T) {
	r, _ := registry(t)
	b := fixture("one")
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	for operation, expected := range map[Operation]error{Read: nil, Write: ErrPathDisabled, Scheduler: ErrPathDisabled} {
		q := request(b, "aims")
		q.Operation = operation
		resolved, err := r.Resolve(q)
		if !errors.Is(err, expected) {
			t.Fatalf("aims %v: got %v, want %v", operation, err, expected)
		}
		if expected != nil && resolved.DB != nil {
			t.Fatalf("aims %v resolved a pool while disabled", operation)
		}
	}
	// The same identity may write in a domain whose write path is already unified.
	q := request(b, "assets")
	q.Operation = Write
	if _, err := r.Resolve(q); err != nil {
		t.Fatalf("unified assets write rejected: %v", err)
	}
	// An unknown operation must fail closed rather than fall through to a mode.
	q.Operation = Operation("export")
	if _, err := r.Resolve(q); !errors.Is(err, ErrBindingMismatch) {
		t.Fatalf("unknown operation accepted: %v", err)
	}
}
