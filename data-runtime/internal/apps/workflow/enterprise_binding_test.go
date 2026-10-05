package workflow

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestWorkflowEnterpriseNamesExcludeAssetsParametersAndReceipt(t *testing.T) {
	names := EnterpriseViewNames()
	if len(names) != len(requiredTables)-1 {
		t.Fatal(names)
	}
	for _, name := range names {
		if name == "system_parameters" || name == "workflow_system_parameters" || name == "service_command_receipt" {
			t.Fatal("shared view", name)
		}
	}
	if _, err := NewEnterprise(context.Background(), nil, enterprise.Binding{}, enterprise.ResolveRequest{}); err == nil {
		t.Fatal("missing binding accepted")
	}
}
