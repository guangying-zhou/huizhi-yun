package config

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func enterpriseConfigFixture() Config {
	return Config{Tenant: "tenant", Deployment: "runtime", DeploymentBindings: map[string]string{"aims": "aims-site", "enterprise": "enterprise-site"}, Enterprise: EnterpriseConfig{Enabled: true, Environment: "test", SchemaVersion: "v1", Generation: 1, InstanceID: "server-uuid", DB: DBConfig{Host: "127.0.0.1", Port: 3306, User: "runtime", Database: "enterprise_test", ConnectionLimit: 2}, Domains: map[string]EnterpriseDomainConfig{"aims": {OwnerDeployment: "enterprise-site", Tables: map[string]string{"root": "aims_root"}, Read: enterprise.PathUnified, Write: enterprise.PathLegacy, Scheduler: enterprise.PathDisabled}}}}
}
func TestEnterpriseDisabledDoesNotValidateOrChangeLegacy(t *testing.T) {
	c := Config{}
	if b, err := c.EnterpriseBinding(); err != nil || b.Key.Tenant != "" {
		t.Fatal(b, err)
	}
}
func TestEnterpriseConfigurationExplicitOwner(t *testing.T) {
	c := enterpriseConfigFixture()
	b, err := c.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	c.Enterprise.Domains["aims"].Tables["root"] = "mutated"
	if b.Domains["aims"].Tables["root"] != "aims_root" {
		t.Fatal("mutable config escaped")
	}
	for name, change := range map[string]func(*Config){"tenant": func(c *Config) { c.Tenant = "" }, "deployment": func(c *Config) { c.Deployment = "" }, "environment": func(c *Config) { c.Enterprise.Environment = "" }, "instance": func(c *Config) { c.Enterprise.InstanceID = "" }, "schema": func(c *Config) { c.Enterprise.SchemaVersion = "" }, "generation": func(c *Config) { c.Enterprise.Generation = 0 }, "bindings": func(c *Config) { c.DeploymentBindings = nil }, "auth domain": func(c *Config) { c.Enterprise.Domains["console"] = c.Enterprise.Domains["aims"] }, "pool": func(c *Config) { c.Enterprise.DB.ConnectionLimit = 0 }} {
		t.Run(name, func(t *testing.T) {
			v := enterpriseConfigFixture()
			change(&v)
			if _, err := v.EnterpriseBinding(); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
	c = enterpriseConfigFixture()
	d := c.Enterprise.Domains["aims"]
	d.OwnerDeployment = "aims-site"
	c.Enterprise.Domains["aims"] = d
	if _, err := c.EnterpriseBinding(); err != nil {
		t.Fatal(err)
	}
}
