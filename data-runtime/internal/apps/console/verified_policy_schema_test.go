package console

import "testing"

func TestVerifiedPolicySchemaIsOptIn(t *testing.T) {
	for _, optional := range []string{"verified_policy_snapshots", "console_service_assertion_replay", "gateway_service_assertion_replay"} {
		if _, required := consoleSchemaManifest.Tables[optional]; required {
			t.Fatalf("optional %s migration became a legacy startup requirement", optional)
		}
		recorded := false
		for _, table := range consoleSchemaManifest.ExcludedTables {
			recorded = recorded || table == optional
		}
		if !recorded {
			t.Fatalf("optional %s migration not recorded", optional)
		}
	}
}
