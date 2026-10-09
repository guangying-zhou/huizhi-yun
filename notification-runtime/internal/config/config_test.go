package config

import (
	"path/filepath"
	"testing"
	"time"
)

func clearDeliveryEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"HZY_NOTIFICATION_RUNTIME_CONFIG",
		"HZY_NOTIFICATION_RUNTIME_INSTALL_DIR",
		"HZY_NOTIFICATION_RUNTIME_STORE",
		"HZY_NOTIFICATION_RUNTIME_SQLITE_PATH",
		"HZY_NOTIFICATION_RUNTIME_DB_HOST",
		"HZY_NOTIFICATION_RUNTIME_DB_PORT",
		"HZY_NOTIFICATION_RUNTIME_DB_NAME",
		"HZY_NOTIFICATION_RUNTIME_DB_USER",
		"HZY_NOTIFICATION_RUNTIME_DB_PASSWORD",
	} {
		t.Setenv(key, "")
	}
}

func TestLoadConnectorUsesIndependentProductDefaults(t *testing.T) {
	for _, key := range []string{
		"HZY_CONNECTOR_RUNTIME_HOST", "HZY_CONNECTOR_RUNTIME_PORT", "HZY_CONNECTOR_RUNTIME_TENANT",
		"HZY_CONNECTOR_RUNTIME_DEPLOYMENT", "HZY_CONNECTOR_RUNTIME_AUTH_MODE", "HZY_CONNECTOR_RUNTIME_STATIC_TOKEN",
		"HZY_CONNECTOR_RUNTIME_JWKS_URL", "HZY_CONNECTOR_RUNTIME_INSTALL_DIR", "HZY_CONNECTOR_RUNTIME_STORE",
		"HZY_CONNECTOR_RUNTIME_SQLITE_PATH", "HZY_CONNECTOR_RUNTIME_CLIENT_ID", "HZY_CONNECTOR_RUNTIME_CLIENT_SECRET",
		"HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL", "HZY_CONNECTOR_RUNTIME_CONSOLE_TIMEOUT_MS",
		"HZY_CONSOLE_API_URL", "HZY_CONSOLE_URL", "HZY_CONSOLE_TOKEN_URL",
	} {
		t.Setenv(key, "")
	}
	t.Setenv("HZY_CONNECTOR_RUNTIME_TENANT", "C000001")
	t.Setenv("HZY_CONNECTOR_RUNTIME_DEPLOYMENT", "C000001-connector")
	t.Setenv("HZY_CONNECTOR_RUNTIME_AUTH_MODE", "static_token")
	t.Setenv("HZY_CONNECTOR_RUNTIME_STATIC_TOKEN", "test-token")

	cfg := LoadConnector()
	if cfg.Port != "18082" || cfg.Auth.JWT.Audience != "connector-runtime" || cfg.Console.ClientID != "connector-runtime" {
		t.Fatalf("unexpected connector identity defaults: %+v", cfg)
	}
	if cfg.Update.BinaryName != "hzy-connector-runtime" || cfg.Update.ServiceName != "hzy-connector-runtime" || cfg.Update.InstallDir != "/opt/hzy/connector-runtime" {
		t.Fatalf("unexpected connector update defaults: %+v", cfg.Update)
	}
	if cfg.Delivery.Type != "sqlite" || cfg.Delivery.SQLitePath != "/opt/hzy/connector-runtime/data/operations.db" || cfg.Delivery.Database != "hzy_connector_runtime" {
		t.Fatalf("unexpected connector store defaults: %+v", cfg.Delivery)
	}
	if cfg.PeopleSync.RuntimeURL != "" {
		t.Fatalf("connector data-runtime URL must be explicit, got %q", cfg.PeopleSync.RuntimeURL)
	}
	if cfg.Console.ServiceURL != "" {
		t.Fatalf("connector service URL must be explicit, got %q", cfg.Console.ServiceURL)
	}
	if cfg.Console.Timeout != 30*time.Second {
		t.Fatalf("connector Console timeout = %s, want 30s", cfg.Console.Timeout)
	}
	if !cfg.Auth.AllowTenantServiceDeployments {
		t.Fatal("connector runtime must accept precisely authorized service identities from other deployments in its enrolled tenant")
	}
}

func TestLoadConnectorUsesDataRuntimeForServiceIntegrations(t *testing.T) {
	t.Setenv("HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL", "https://runtime.example.test/")

	cfg := LoadConnector()
	if cfg.PeopleSync.RuntimeURL != "https://runtime.example.test" {
		t.Fatalf("people sync runtime URL = %q", cfg.PeopleSync.RuntimeURL)
	}
	if cfg.Console.ServiceURL != "https://runtime.example.test" {
		t.Fatalf("service integration URL = %q", cfg.Console.ServiceURL)
	}
}

func TestLoadConnectorAllowsConsoleTimeoutOverride(t *testing.T) {
	t.Setenv("HZY_CONNECTOR_RUNTIME_CONSOLE_TIMEOUT_MS", "45000")

	cfg := LoadConnector()
	if cfg.Console.Timeout != 45*time.Second {
		t.Fatalf("connector Console timeout = %s, want 45s", cfg.Console.Timeout)
	}
}

func TestLoadDefaultsFreshInstallToSQLite(t *testing.T) {
	clearDeliveryEnvironment(t)
	installDir := filepath.Join(t.TempDir(), "notification-runtime")
	t.Setenv("HZY_NOTIFICATION_RUNTIME_INSTALL_DIR", installDir)

	cfg := Load()
	if cfg.Delivery.Type != "sqlite" {
		t.Fatalf("delivery type = %q, want sqlite", cfg.Delivery.Type)
	}
	wantPath := filepath.Join(installDir, "data", "delivery.db")
	if cfg.Delivery.SQLitePath != wantPath {
		t.Fatalf("sqlite path = %q, want %q", cfg.Delivery.SQLitePath, wantPath)
	}
}

func TestLoadInfersMySQLForLegacyInstall(t *testing.T) {
	clearDeliveryEnvironment(t)
	t.Setenv("HZY_NOTIFICATION_RUNTIME_DB_HOST", "db.internal")
	t.Setenv("HZY_NOTIFICATION_RUNTIME_DB_USER", "notification_runtime")

	cfg := Load()
	if cfg.Delivery.Type != "mysql" {
		t.Fatalf("delivery type = %q, want mysql for legacy DB settings", cfg.Delivery.Type)
	}
}

func TestLoadExplicitSQLiteOverridesLegacyMySQLVariables(t *testing.T) {
	clearDeliveryEnvironment(t)
	t.Setenv("HZY_NOTIFICATION_RUNTIME_STORE", "SQLITE")
	t.Setenv("HZY_NOTIFICATION_RUNTIME_SQLITE_PATH", "/srv/notification/delivery.db")
	t.Setenv("HZY_NOTIFICATION_RUNTIME_DB_HOST", "db.internal")
	t.Setenv("HZY_NOTIFICATION_RUNTIME_DB_USER", "notification_runtime")

	cfg := Load()
	if cfg.Delivery.Type != "sqlite" || cfg.Delivery.SQLitePath != "/srv/notification/delivery.db" {
		t.Fatalf("delivery config = %+v", cfg.Delivery)
	}
}
