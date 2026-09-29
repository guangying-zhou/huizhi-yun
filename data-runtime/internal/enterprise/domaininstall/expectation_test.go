package domaininstall

import (
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestExplicitExpectationBindsTenantOwnerAndAddress(t *testing.T) {
	check := func(e Expectation, b enterprise.Binding) error { i := ForAltoc(e); return i.x.validate(b) }
	b := fixture("isolated", "instance")
	// Legacy package functions keep the fixed C000001/test local boundary.
	if err := validate(b); err != nil {
		t.Fatal(err)
	}
	prod := enterprise.Binding{Key: enterprise.BindingKey{Tenant: "T900001", Environment: "prod", RuntimeDeployment: "t900001-prod-tenant-runtime"}, Storage: enterprise.Storage{Database: "hzy_enterprise_prod", InstanceID: "instance", Address: "10.0.0.5:3306"}, SchemaVersion: "v1", Generation: 1, Domains: map[string]enterprise.DomainBinding{}}
	d := enterprise.DomainBinding{OwnerDeployment: "T900001-prod-enterprise", Tables: map[string]string{}, Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled}
	for _, v := range tables() {
		d.Tables[v.Logical] = v.Physical
	}
	prod.Domains["altoc"] = d
	if validate(prod) == nil {
		t.Fatal("legacy expectation accepted another tenant")
	}
	expect := Expectation{Tenant: "T900001", Environment: "prod", OwnerDeployment: "T900001-prod-enterprise", Address: "10.0.0.5:3306"}
	if err := check(expect, prod); err != nil {
		t.Fatal(err)
	}
	if check(expect, b) == nil {
		t.Fatal("profile expectation accepted C000001 binding")
	}
	for name, mutate := range map[string]func(*Expectation){
		"tenant":      func(e *Expectation) { e.Tenant = "T900002" },
		"environment": func(e *Expectation) { e.Environment = "test" },
		"unknown env": func(e *Expectation) { e.Environment = "staging" },
		"owner":       func(e *Expectation) { e.OwnerDeployment = "C000001-test-enterprise" },
		"address":     func(e *Expectation) { e.Address = "10.0.0.6:3306" },
	} {
		x := expect
		mutate(&x)
		if check(x, prod) == nil {
			t.Fatal(name, "mismatch accepted")
		}
	}
	if altocInstaller.expect != c000001Expectation || deletionInstaller.expect != c000001Expectation {
		t.Fatal("legacy installers lost the fixed C000001 expectation")
	}
}
