package config

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAppDBConfigUsesSharedDataRuntimeDefaults(t *testing.T) {
	withEnv(t, map[string]string{
		"HZY_DATA_RUNTIME_DB_HOST":             "127.0.0.9",
		"HZY_DATA_RUNTIME_DB_PORT":             "3307",
		"HZY_DATA_RUNTIME_DB_USER":             "cf_app",
		"HZY_DATA_RUNTIME_DB_PASSWORD":         "shared-pass",
		"HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT": "11",
	}, func() {
		cfg := appDBConfig("FINANCE", "hzy_finance")

		if cfg.Host != "127.0.0.9" {
			t.Fatalf("expected shared host, got %q", cfg.Host)
		}
		if cfg.Port != 3307 {
			t.Fatalf("expected shared port, got %d", cfg.Port)
		}
		if cfg.User != "cf_app" {
			t.Fatalf("expected shared user, got %q", cfg.User)
		}
		if cfg.Password != "shared-pass" {
			t.Fatalf("expected shared password, got %q", cfg.Password)
		}
		if cfg.Database != "hzy_finance" {
			t.Fatalf("expected app database default, got %q", cfg.Database)
		}
		if cfg.ConnectionLimit != 11 {
			t.Fatalf("expected shared connection limit, got %d", cfg.ConnectionLimit)
		}
	})
}

func TestAppDBConfigAllowsAppSpecificOverrides(t *testing.T) {
	withEnv(t, map[string]string{
		"HZY_DATA_RUNTIME_DB_HOST":             "127.0.0.9",
		"HZY_DATA_RUNTIME_DB_PORT":             "3307",
		"HZY_DATA_RUNTIME_DB_USER":             "cf_app",
		"HZY_DATA_RUNTIME_DB_PASSWORD":         "shared-pass",
		"HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT": "11",
		"HZY_WORKFLOW_DB_HOST":                 "10.0.0.8",
		"HZY_WORKFLOW_DB_PORT":                 "3308",
		"HZY_WORKFLOW_DB_USER":                 "workflow_user",
		"HZY_WORKFLOW_DB_PASSWORD":             "workflow-pass",
		"HZY_WORKFLOW_DB_NAME":                 "custom_workflow",
		"HZY_WORKFLOW_DB_CONNECTION_LIMIT":     "3",
	}, func() {
		cfg := appDBConfig("WORKFLOW", "hzy_workflow")

		if cfg.Host != "10.0.0.8" {
			t.Fatalf("expected app host override, got %q", cfg.Host)
		}
		if cfg.Port != 3308 {
			t.Fatalf("expected app port override, got %d", cfg.Port)
		}
		if cfg.User != "workflow_user" {
			t.Fatalf("expected app user override, got %q", cfg.User)
		}
		if cfg.Password != "workflow-pass" {
			t.Fatalf("expected app password override, got %q", cfg.Password)
		}
		if cfg.Database != "custom_workflow" {
			t.Fatalf("expected app database override, got %q", cfg.Database)
		}
		if cfg.ConnectionLimit != 3 {
			t.Fatalf("expected app connection limit override, got %d", cfg.ConnectionLimit)
		}
	})
}

func TestLoadEnablesPeopleAdapterFromEnv(t *testing.T) {
	withEnv(t, map[string]string{
		"HZY_PEOPLE_AGENT_ENABLED": "true",
		"HZY_PEOPLE_DB_NAME":       "custom_people",
	}, func() {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}

		if !cfg.Apps.People.Enabled {
			t.Fatal("expected People adapter to be enabled")
		}
		if cfg.Apps.People.DB.Database != "custom_people" {
			t.Fatalf("expected custom People database, got %q", cfg.Apps.People.DB.Database)
		}
	})
}

func TestLoadEnablesDirectoryRuntimeWithConsoleDatabaseDefault(t *testing.T) {
	withEnv(t, map[string]string{
		"HZY_DIRECTORY_RUNTIME_ENABLED": "true",
	}, func() {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if !cfg.Apps.Directory.Enabled {
			t.Fatal("expected Directory Runtime adapter to be enabled")
		}
		if cfg.Apps.Directory.DB.Database != "hzy_console" {
			t.Fatalf("expected hzy_console database, got %q", cfg.Apps.Directory.DB.Database)
		}
	})
}

func TestLoadEnablesConsoleRuntimeWithIndependentDatabaseConfig(t *testing.T) {
	withEnv(t, map[string]string{
		"HZY_CONSOLE_RUNTIME_ENABLED":  "true",
		"HZY_CONSOLE_DB_HOST":          "10.0.0.12",
		"HZY_CONSOLE_DB_NAME":          "tenant_console",
		"HZY_CONSOLE_VAULT_MASTER_KEY": "customer-held-key",
	}, func() {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if !cfg.Apps.Console.Enabled {
			t.Fatal("expected Console Runtime adapter to be enabled")
		}
		if cfg.Apps.Console.DB.Host != "10.0.0.12" || cfg.Apps.Console.DB.Database != "tenant_console" {
			t.Fatalf("unexpected Console database config: %#v", cfg.Apps.Console.DB)
		}
		if cfg.Apps.Console.VaultMasterKey != "customer-held-key" {
			t.Fatal("expected the customer-held Vault key to be loaded into Console Runtime")
		}
	})
}

func TestLoadEnablesConsoleRuntimeFromDeploymentBindingAndReadsProtectedKeyFile(t *testing.T) {
	keyFile := filepath.Join(t.TempDir(), "console-vault-master-key")
	if err := os.WriteFile(keyFile, []byte("file-held-key\n"), 0600); err != nil {
		t.Fatal(err)
	}
	bindings, err := json.Marshal(map[string]string{"console": "tenant-console-prod"})
	if err != nil {
		t.Fatal(err)
	}
	withEnv(t, map[string]string{
		"HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64": base64.StdEncoding.EncodeToString(bindings),
		"HZY_CONSOLE_VAULT_MASTER_KEY_FILE":        keyFile,
	}, func() {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if !cfg.Apps.Console.Enabled {
			t.Fatal("expected Console Runtime to be enabled from its enrolled deployment binding")
		}
		if cfg.Apps.Console.VaultMasterKey != "file-held-key" {
			t.Fatal("expected Console Vault key to be loaded from the protected Runtime file")
		}
	})
}

func TestLoadReadsPublicPlatformSigningKeyForLocalEnrollmentVerification(t *testing.T) {
	publicKey := "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAtest\n-----END PUBLIC KEY-----"
	withEnv(t, map[string]string{
		"HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID":         "psk_20260717_test",
		"HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64": base64.StdEncoding.EncodeToString([]byte(publicKey)),
	}, func() {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if cfg.Control.PlatformSigningKeyID != "psk_20260717_test" ||
			cfg.Control.PlatformSigningPublicKey != publicKey {
			t.Fatalf("unexpected Platform signing config: %#v", cfg.Control)
		}
	})
}

func TestLoadPrefersProtectedPlatformSigningKeyOverlay(t *testing.T) {
	configDir := t.TempDir()
	overlay := map[string]string{
		"kid":       "psk_rotated",
		"alg":       "Ed25519",
		"publicKey": "-----BEGIN PUBLIC KEY-----\nrotated\n-----END PUBLIC KEY-----",
	}
	content, err := json.Marshal(overlay)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "platform-signing-key.json"), content, 0600); err != nil {
		t.Fatal(err)
	}
	withEnv(t, map[string]string{
		"HZY_DATA_RUNTIME_CONFIG_DIR":                      configDir,
		"HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID":         "psk_enrolled",
		"HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64": base64.StdEncoding.EncodeToString([]byte("enrolled")),
	}, func() {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if cfg.Control.PlatformSigningKeyID != "psk_rotated" ||
			cfg.Control.PlatformSigningPublicKey != overlay["publicKey"] {
			t.Fatalf("protected Platform signing overlay was not preferred: %#v", cfg.Control)
		}
	})
}

func TestDeploymentForAppBindsConnectorRuntimeToConsoleDeployment(t *testing.T) {
	cfg := Config{
		Deployment: "tenant-runtime-prod",
		DeploymentBindings: map[string]string{
			"console":           "tenant-console-prod",
			"connector-runtime": "explicit-connector-prod",
		},
	}

	if got := cfg.DeploymentForApp("connector-runtime"); got != "explicit-connector-prod" {
		t.Fatalf("explicit Connector Runtime deployment = %q", got)
	}
	delete(cfg.DeploymentBindings, "connector-runtime")
	if got := cfg.DeploymentForApp(" Connector-Runtime "); got != "tenant-console-prod" {
		t.Fatalf("Console-anchored Connector Runtime deployment = %q", got)
	}
	if got := cfg.DeploymentForApp("unknown-service"); got != "tenant-runtime-prod" {
		t.Fatalf("unknown service deployment = %q", got)
	}
}

func TestPersistedJWTTrustOverlayOverridesLegacyGlobalIssuer(t *testing.T) {
	configDir := t.TempDir()
	trust := JWTConfig{
		Issuer:   "https://wiztek.huizhi.yun",
		Audience: "data-runtime",
		JWKSURL:  "https://wiztek.huizhi.yun/.well-known/jwks.json",
	}
	if err := PersistJWTTrustOverlay(configDir, trust); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(configDir, "auth-jwt-trust.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("JWT trust overlay mode = %#o, want 0600", info.Mode().Perm())
	}
	withEnv(t, map[string]string{
		"HZY_DATA_RUNTIME_CONFIG_DIR": configDir,
		"HZY_DATA_RUNTIME_JWT_ISSUER": "https://console.huizhi.yun",
		"HZY_DATA_RUNTIME_JWKS_URL":   "https://console.huizhi.yun/.well-known/jwks.json",
	}, func() {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if cfg.Auth.JWT != trust {
			t.Fatalf("protected JWT trust overlay was not preferred: %#v", cfg.Auth.JWT)
		}
	})
}

func withEnv(t *testing.T, values map[string]string, fn func()) {
	t.Helper()

	keys := []string{
		"DB_HOST",
		"DB_PORT",
		"DB_USER",
		"DB_PASSWORD",
		"DB_NAME",
		"DB_CONNECTION_LIMIT",
		"HZY_DATA_RUNTIME_DB_HOST",
		"HZY_DATA_RUNTIME_DB_PORT",
		"HZY_DATA_RUNTIME_DB_USER",
		"HZY_DATA_RUNTIME_DB_PASSWORD",
		"HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT",
		"HZY_FINANCE_DB_HOST",
		"HZY_FINANCE_DB_PORT",
		"HZY_FINANCE_DB_USER",
		"HZY_FINANCE_DB_PASSWORD",
		"HZY_FINANCE_DB_NAME",
		"HZY_FINANCE_DB_CONNECTION_LIMIT",
		"HZY_WORKFLOW_DB_HOST",
		"HZY_WORKFLOW_DB_PORT",
		"HZY_WORKFLOW_DB_USER",
		"HZY_WORKFLOW_DB_PASSWORD",
		"HZY_WORKFLOW_DB_NAME",
		"HZY_WORKFLOW_DB_CONNECTION_LIMIT",
		"HZY_WEBDEV_DB_HOST",
		"HZY_WEBDEV_DB_PORT",
		"HZY_WEBDEV_DB_USER",
		"HZY_WEBDEV_DB_PASSWORD",
		"HZY_WEBDEV_DB_NAME",
		"HZY_WEBDEV_DB_CONNECTION_LIMIT",
		"HZY_PEOPLE_AGENT_ENABLED",
		"HZY_PEOPLE_DB_HOST",
		"HZY_PEOPLE_DB_PORT",
		"HZY_PEOPLE_DB_USER",
		"HZY_PEOPLE_DB_PASSWORD",
		"HZY_PEOPLE_DB_NAME",
		"HZY_PEOPLE_DB_CONNECTION_LIMIT",
		"HZY_DIRECTORY_RUNTIME_ENABLED",
		"HZY_DIRECTORY_DB_HOST",
		"HZY_DIRECTORY_DB_PORT",
		"HZY_DIRECTORY_DB_USER",
		"HZY_DIRECTORY_DB_PASSWORD",
		"HZY_DIRECTORY_DB_NAME",
		"HZY_DIRECTORY_DB_CONNECTION_LIMIT",
		"HZY_CONSOLE_RUNTIME_ENABLED",
		"HZY_CONSOLE_DB_HOST",
		"HZY_CONSOLE_DB_PORT",
		"HZY_CONSOLE_DB_USER",
		"HZY_CONSOLE_DB_PASSWORD",
		"HZY_CONSOLE_DB_NAME",
		"HZY_CONSOLE_DB_CONNECTION_LIMIT",
		"HZY_CONSOLE_VAULT_MASTER_KEY",
		"HZY_CONSOLE_VAULT_MASTER_KEY_FILE",
		"HZY_DATA_RUNTIME_CONFIG_DIR",
		"HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64",
		"HZY_DATA_RUNTIME_JWT_ISSUER",
		"HZY_DATA_RUNTIME_JWKS_URL",
		"HZY_DATA_RUNTIME_JWKS_JSON",
		"HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID",
		"HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64",
	}

	previous := map[string]struct {
		value string
		ok    bool
	}{}
	for _, key := range keys {
		value, ok := os.LookupEnv(key)
		previous[key] = struct {
			value string
			ok    bool
		}{value: value, ok: ok}
		_ = os.Unsetenv(key)
	}
	for key, value := range values {
		if err := os.Setenv(key, value); err != nil {
			t.Fatalf("set env %s: %v", key, err)
		}
	}

	defer func() {
		for _, key := range keys {
			item := previous[key]
			if !item.ok {
				_ = os.Unsetenv(key)
				continue
			}
			_ = os.Setenv(key, item.value)
		}
	}()

	fn()
}
