package capabilities

import (
	"strings"
	"testing"
)

func TestCurrentRegistryIsTypedClosedAndMigrationCompatible(t *testing.T) {
	registry := Current()
	if registry.SchemaVersion != RegistrySchemaVersion || registry.RuntimeProduct != "hzy-notification-runtime" || registry.MigrationTarget != "hzy-connector-runtime" {
		t.Fatalf("unexpected registry identity: %+v", registry)
	}
	if registry.ArbitraryHTTPProxy {
		t.Fatal("runtime must never advertise an arbitrary HTTP proxy")
	}

	providerCodes := map[string]bool{}
	for _, provider := range registry.Providers {
		if provider.Code == "" || provider.DynamicTargetAllowed || provider.CredentialSource != "console-vault" {
			t.Fatalf("unsafe provider policy: %+v", provider)
		}
		providerCodes[provider.Code] = true
		for _, origin := range provider.AllowedOrigins {
			if !strings.HasPrefix(origin, "https://") {
				t.Fatalf("provider origin is not HTTPS: %q", origin)
			}
		}
	}

	seen := map[string]bool{}
	for _, capability := range registry.Capabilities {
		key := capability.Code + "@" + capability.Version
		if seen[key] || capability.Method == "" || !strings.HasPrefix(capability.Path, "/v1/") {
			t.Fatalf("invalid capability: %+v", capability)
		}
		seen[key] = true
		if !strings.HasPrefix(capability.TargetScope, "connector-runtime:") {
			t.Fatalf("invalid target scope: %+v", capability)
		}
		for _, provider := range capability.Providers {
			if !providerCodes[provider] {
				t.Fatalf("capability references unknown provider %q", provider)
			}
		}
	}

	if !seen["notifications.send@v1"] || !seen["deliveries.read@v1"] || !seen["deliveries.reconcile@v1"] {
		t.Fatalf("missing compatibility capabilities: %v", seen)
	}
}

func TestConnectorRegistryUsesOnlyTargetScopes(t *testing.T) {
	registry := Connector()
	if registry.RuntimeProduct != "hzy-connector-runtime" || registry.MigrationTarget != "" {
		t.Fatalf("unexpected connector identity: %+v", registry)
	}
	for _, capability := range registry.Capabilities {
		if capability.RequiredScope != capability.TargetScope || !strings.HasPrefix(capability.RequiredScope, "connector-runtime:") {
			t.Fatalf("connector capability retained legacy scope: %+v", capability)
		}
	}
}
