package migration

import "testing"

func TestConnectorRuntimeV1RequiresExplicitReversibleCompatibleCutover(t *testing.T) {
	contract, err := LoadConnectorRuntimeV1()
	if err != nil {
		t.Fatal(err)
	}
	if contract.SchemaVersion != "hzy.connector-runtime-migration.v1" || contract.Activation != "explicit" {
		t.Fatalf("migration must be versioned and explicit: %+v", contract)
	}
	if contract.Source.Product != "hzy-notification-runtime" || contract.Source.MinimumVersion != "0.1.6" || contract.Target.Product != "hzy-connector-runtime" {
		t.Fatalf("unexpected migration products: source=%+v target=%+v", contract.Source, contract.Target)
	}
	if !contract.State.PreserveDeliveryLedger || contract.State.ContainsProviderSecrets {
		t.Fatalf("unsafe state contract: %+v", contract.State)
	}
	if !contract.Rollback.Enabled || !contract.Rollback.KeepSourceInstalled || !contract.Rollback.RestoreSourceOnTargetHealthFailure || !contract.Rollback.DisableSourceUpdaterAfterCutover {
		t.Fatalf("migration is not safely reversible: %+v", contract.Rollback)
	}
	if contract.Security.ArbitraryHTTPProxy || contract.Security.ProviderSecretsInState || contract.Security.ProviderCredentialsSource != "console-vault" {
		t.Fatalf("unsafe security contract: %+v", contract.Security)
	}

	routes := map[string]CompatibilityRoute{}
	for _, route := range contract.Compatibility {
		routes[route.Method+" "+route.Path] = route
	}
	send := routes["POST /v1/notifications/send"]
	if send.SourceScope != "notification-runtime:send" || send.TargetScope != "connector-runtime:notifications:send" {
		t.Fatalf("notification compatibility mapping missing: %+v", send)
	}
	if len(contract.CutoverPreconditions) < 5 {
		t.Fatalf("cutover preconditions are incomplete: %v", contract.CutoverPreconditions)
	}
}
