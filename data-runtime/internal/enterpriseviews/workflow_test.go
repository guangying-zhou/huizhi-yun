package enterpriseviews

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"reflect"
	"testing"
)

func workflowTestDomain() e.DomainBinding {
	tables := map[string]string{"workflow_system_parameters": "workflow_system_parameters", "service_command_receipt": "workflow_service_command_receipt"}
	for _, name := range workflow.EnterpriseViewNames() {
		tables[name] = "workflow_" + name
	}
	return e.DomainBinding{OwnerDeployment: "workflow-site", Tables: tables}
}
func TestOptionalWorkflowKeepsInstalledAssetsBaseline(t *testing.T) {
	b := PruneExclusive(loadBinding(t, "hzy0-mapping.json"))
	before, err := Install(b)
	if err != nil {
		t.Fatal(err)
	}
	hash := MappingHash(b)
	assetsParameters := b.Domains["assets"].Tables["system_parameters"]
	b.Domains["workflow"] = workflowTestDomain()
	after, err := Install(b)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before["assets"], after["assets"]) || !reflect.DeepEqual(before["aims"], after["aims"]) || assetsParameters != b.Domains["assets"].Tables["system_parameters"] {
		t.Fatal("existing installed family changed")
	}
	if !reflect.DeepEqual(after["workflow"], workflow.EnterpriseViewNames()) {
		t.Fatal(after["workflow"])
	}
	if hash == MappingHash(b) {
		t.Fatal("Workflow mapping not hashed")
	}
	for _, name := range SharedPhysicalNames {
		if name == "system_parameters" {
			t.Fatal("Assets shared exclusion changed")
		}
	}
	delete(b.Domains, "workflow")
	if hash != MappingHash(b) {
		t.Fatal("two-domain mapping hash changed")
	}
}

func TestSharedPhysicalNamesReexportSingleFact(t *testing.T) {
	if len(SharedPhysicalNames) != len(e.SharedPhysicalNames) || &SharedPhysicalNames[0] != &e.SharedPhysicalNames[0] {
		t.Fatal("shared names duplicated instead of re-export")
	}
	for _, name := range SharedPhysicalNames {
		if !e.IsSharedPhysicalName(name) {
			t.Fatal(name, "not in owning registry")
		}
	}
	if e.IsSharedPhysicalName("system_parameters") {
		t.Fatal("Assets parameter contract widened")
	}
}
