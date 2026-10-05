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

func TestInProcessSchedulerConfig(t *testing.T) {
	c := Config{}
	if interval, err := c.EnterpriseInProcessSchedulerInterval(); err != nil || interval != 0 {
		t.Fatal("default must be off", interval, err)
	}
	c.Enterprise.InProcessScheduler.Enabled = true
	if _, err := c.EnterpriseInProcessSchedulerInterval(); err == nil {
		t.Fatal("missing enterprise accepted")
	}
	c.Enterprise.Enabled = true
	c.Enterprise.Domains = map[string]EnterpriseDomainConfig{"aims": {Scheduler: enterprise.PathUnified}}
	if interval, err := c.EnterpriseInProcessSchedulerInterval(); err != nil || interval.Seconds() != 300 {
		t.Fatal("default interval", interval, err)
	}
	for _, seconds := range []int{-1, 1, 59, 3601} {
		c.Enterprise.InProcessScheduler.IntervalSeconds = seconds
		if _, err := c.EnterpriseInProcessSchedulerInterval(); err == nil {
			t.Fatal("invalid interval", seconds)
		}
	}
	for _, seconds := range []int{60, 3600} {
		c.Enterprise.InProcessScheduler.IntervalSeconds = seconds
		if _, err := c.EnterpriseInProcessSchedulerInterval(); err != nil {
			t.Fatal(err)
		}
	}
	c.Enterprise.Domains["aims"] = EnterpriseDomainConfig{Scheduler: enterprise.PathLegacy}
	if _, err := c.EnterpriseInProcessSchedulerInterval(); err == nil {
		t.Fatal("legacy path accepted")
	}
	c.Enterprise.InProcessScheduler.Enabled = false
	if interval, err := c.EnterpriseInProcessSchedulerInterval(); err != nil || interval != 0 {
		t.Fatal("disabled behaviour changed")
	}
}

func TestWorkflowDomainOptInRetainsDeploymentValidation(t *testing.T) {
	c := enterpriseConfigFixture()
	c.DeploymentBindings["workflow"] = "workflow-site"
	c.Enterprise.Domains["workflow"] = EnterpriseDomainConfig{OwnerDeployment: "workflow-site", Tables: map[string]string{"workflow_system_parameters": "workflow_system_parameters", "service_command_receipt": "workflow_service_command_receipt"}, Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled}
	if _, err := c.EnterpriseBinding(); err != nil {
		t.Fatal(err)
	}
	d := c.Enterprise.Domains["workflow"]
	d.OwnerDeployment = "unregistered"
	c.Enterprise.Domains["workflow"] = d
	if _, err := c.EnterpriseBinding(); err == nil {
		t.Fatal("unregistered Workflow owner")
	}
}

func TestWorkflowLaneExplicitOptInFailsClosed(t *testing.T) {
	if err := (Config{}).ValidateWorkflowLane(); err != nil {
		t.Fatal("default off changed", err)
	}
	fixture := func() Config {
		c := enterpriseConfigFixture()
		c.DeploymentBindings["workflow"] = "workflow-site"
		c.Enterprise.WorkflowLane.Enabled = true
		c.Apps.Aims.Enabled = true
		c.Apps.Workflow.Enabled = true
		c.Apps.Directory.Enabled = true
		a := c.Enterprise.Domains["aims"]
		a.Write = enterprise.PathUnified
		c.Enterprise.Domains["aims"] = a
		c.Enterprise.Domains["workflow"] = EnterpriseDomainConfig{OwnerDeployment: "workflow-site", Tables: map[string]string{"service_command_receipt": "workflow_service_command_receipt", "flow_tasks": "workflow_flow_tasks"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled}
		return c
	}
	c := fixture()
	if err := c.ValidateWorkflowLane(); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*Config){
		"enterprise": func(c *Config) { c.Enterprise.Enabled = false }, "workflow": func(c *Config) { c.Apps.Workflow.Enabled = false }, "aims": func(c *Config) { c.Apps.Aims.Enabled = false }, "directory": func(c *Config) { c.Apps.Directory.Enabled = false }, "missing domain": func(c *Config) { delete(c.Enterprise.Domains, "workflow") }, "legacy": func(c *Config) {
			d := c.Enterprise.Domains["workflow"]
			d.Write = enterprise.PathLegacy
			c.Enterprise.Domains["workflow"] = d
		}, "deployment": func(c *Config) { delete(c.DeploymentBindings, "workflow") }, "generation": func(c *Config) { c.Enterprise.Generation = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			c := fixture()
			change(&c)
			if err := c.ValidateWorkflowLane(); err == nil {
				t.Fatal("silent legacy fallback")
			}
		})
	}
	c = fixture()
	c.Enterprise.WorkflowLane.Enabled = false
	c.Apps.Workflow.DB.Database = c.Enterprise.DB.Database
	if err := c.ValidateWorkflowLane(); err == nil {
		t.Fatal("legacy independent adapter allowed unified DB")
	}
}
