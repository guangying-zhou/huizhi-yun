package enterprise

import (
	"context"
	"testing"
)

func TestResolveDomainsAtomicFailureMatrix(t *testing.T) {
	r, _ := registry(t)
	b := fixture("one")
	delete(b.Domains, "assets")
	b.Domains["workflow"] = DomainBinding{OwnerDeployment: "one-workflow", Tables: map[string]string{"receipt": "workflow_receipt"}, Read: PathUnified, Write: PathUnified, Scheduler: PathDisabled}
	if err := r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	a, c := request(b, "aims"), request(b, "workflow")
	got, err := r.ResolveDomains(a, c)
	if err != nil || len(got) != 2 {
		t.Fatal(got, err)
	}
	got[0].tables["receipt"] = "mutated"
	one, _ := r.Resolve(a)
	one.tables["receipt"] = "single-mutated"
	next, _ := r.Resolve(a)
	if next.tables["receipt"] != "aims_receipt" {
		t.Fatal("mapping mutable")
	}
	for name, change := range map[string]func(*ResolveRequest){"owner": func(q *ResolveRequest) { q.OwnerDeployment = "other" }, "schema": func(q *ResolveRequest) { q.SchemaVersion = "other" }, "generation": func(q *ResolveRequest) { q.Generation++ }, "tenant": func(q *ResolveRequest) { q.Key.Tenant = "other" }, "environment": func(q *ResolveRequest) { q.Key.Environment = "prod" }, "domain": func(q *ResolveRequest) { q.Domain = "unknown" }, "mode": func(q *ResolveRequest) { q.Operation = Write }} {
		t.Run(name, func(t *testing.T) {
			bad := c
			change(&bad)
			if got, err := r.ResolveDomains(a, bad); err == nil || got != nil {
				t.Fatal("partial resolution", got, err)
			}
		})
	}

	other := fixture("two")
	other.Key.Tenant = b.Key.Tenant
	other.Storage.Database = "other_business"
	other.Storage.InstanceID = "other-instance"
	other.Domains = map[string]DomainBinding{"workflow": b.Domains["workflow"]}
	if err := r.Register(context.Background(), other); err != nil {
		t.Fatal(err)
	}
	if got, err := r.ResolveDomains(a, request(other, "workflow")); err == nil || got != nil {
		t.Fatal("mixed registered storage/binding accepted", err)
	}
	for _, qs := range [][]ResolveRequest{nil, {a, a}} {
		if got, err := r.ResolveDomains(qs...); err == nil || got != nil {
			t.Fatal("invalid set")
		}
	}
}
