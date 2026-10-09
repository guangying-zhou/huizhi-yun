package main

import (
	"github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"path/filepath"
	"testing"
)

func TestIdentityClosedSet(t *testing.T) {
	c := config.Config{Tenant: "C000001", Deployment: "c000001-prod-tenant-runtime", DeploymentBindings: map[string]string{"collab": "C000001-collab"}}
	c.Apps.Console.Enabled = true
	o := options{tenant: "C000001", deployment: "C000001-collab", client: "collab.runtime", environment: "prod", approval: "approval-20261007"}
	if e := validate(o, c); e != nil {
		t.Fatal(e)
	}
	for _, f := range []func(*options){func(x *options) { x.tenant = "OTHER" }, func(x *options) { x.deployment = "C000001-test-collab" }, func(x *options) { x.client = "enterprise.runtime" }, func(x *options) { x.environment = "test" }, func(x *options) { x.approval = "" }} {
		wrong := o
		f(&wrong)
		if validate(wrong, c) == nil {
			t.Fatal("wrong binding accepted")
		}
	}
	c.DeploymentBindings["collab"] = ""
	if validate(o, c) == nil {
		t.Fatal("unregistered deployment accepted")
	}
}
func TestAtomicSecretDestinationNeverOverwrites(t *testing.T) {
	d := t.TempDir()
	os.Chmod(d, 0700)
	p := filepath.Join(d, "collab.env")
	if e := persist(p, "synthetic-fixture"); e != nil {
		t.Fatal(e)
	}
	if e := protected(p, false, uint32(os.Geteuid())); e != nil {
		t.Fatal(e)
	}
	if e := persist(p, "changed"); e == nil {
		t.Fatal("overwrote credential")
	}
	s, e := readSecret(p)
	if e != nil || s != "synthetic-fixture" {
		t.Fatal("material changed")
	}
	os.Chmod(p, 0644)
	if protected(p, false, uint32(os.Geteuid())) == nil {
		t.Fatal("unsafe mode accepted")
	}
	os.Chmod(p, 0600)
	link := filepath.Join(d, "link")
	os.Symlink(p, link)
	if protected(link, false, uint32(os.Geteuid())) == nil {
		t.Fatal("symlink accepted")
	}
	if protected(p, false, uint32(os.Geteuid()+1)) == nil {
		t.Fatal("wrong owner accepted")
	}
}
