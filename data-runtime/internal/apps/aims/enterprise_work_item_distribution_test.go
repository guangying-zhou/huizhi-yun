package aims

import "testing"

// service_command_receipt.command_schema_version is VARCHAR(30); an overlong
// identifier fails the whole receipt transaction at runtime.
func TestEnterpriseWorkItemDistributionReceiptIdentifiersFitSchema(t *testing.T) {
	seen := map[string]string{}
	for action := range EnterpriseWorkItemDistributionCapabilities {
		version, ok := enterpriseWorkItemDistributionSchemaVersions[action]
		if !ok || version == "" {
			t.Fatalf("%s has no command schema version", action)
		}
		if len(version) > 30 {
			t.Fatalf("%s schema version %q exceeds 30 characters", action, version)
		}
		if other, dup := seen[version]; dup {
			t.Fatalf("%s and %s share schema version %q", action, other, version)
		}
		seen[version] = action
		if _, ok := enterpriseWorkItemDistributionEdges[action]; !ok {
			t.Fatalf("%s has no status edge", action)
		}
		if operation := "enterprise.aims.work-items." + action + ".v1"; len(operation) > 191 {
			t.Fatalf("%s operation code exceeds 191 characters", action)
		}
	}
}
