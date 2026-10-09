package wizbiztool

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Protected hzy0 object shape; every value is synthetic, never a live config.
func runtimeConfigShape() map[string]any {
	return map[string]any{
		"tenant": "C000001", "deployment": "c000001-test-tenant-runtime", "deploymentBindings": map[string]any{"enterprise": "C000001-test-enterprise"}, "server": map[string]any{"host": "127.0.0.1", "port": 18084}, "auth": map[string]any{"mode": "jwt", "jwt": map[string]any{"issuer": "https://console.invalid", "audience": "data-runtime"}},
		"apps": map[string]any{"console": map[string]any{"enabled": true, "gatewayExchangeEnabled": true, "vaultMasterKeyFile": "/nonexistent/protected/vault-key", "db": map[string]any{"host": "127.0.0.1", "port": 3306, "database": "console_test", "user": "fixture", "password": "synthetic", "connectionLimit": 2}, "policyEnvelope": map[string]any{"enabled": true, "enterpriseReadEnabled": true, "environment": "test", "maxAgeMs": 1000}}, "workflow": map[string]any{"enabled": true}}}
}
func TestRuntimeBindingConfigExactLocalVaultPath(t *testing.T) {
	v := runtimeConfigShape()
	raw, _ := json.Marshal(v)
	p := filepath.Join(t.TempDir(), "runtime.json")
	if err := os.WriteFile(p, raw, 0600); err != nil {
		t.Fatal(err)
	}
	cfg, h, err := readRuntimeBindingConfig(p)
	if err != nil || h != Digest(raw) || cfg.Tenant != "C000001" || cfg.Server.Port != 18084 || !cfg.Apps.Workflow.Enabled || cfg.Apps.Console.DB.Database != "console_test" || !cfg.Apps.Console.PolicyEnvelope.Enabled {
		t.Fatalf("config facts lost: %v", err)
	}
	if cfg.Apps.Console.VaultMasterKeyFile != "" || cfg.Apps.Console.VaultMasterKey != "" {
		t.Fatal("key material must not enter binding")
	}
	if _, err := os.Stat("/nonexistent/protected/vault-key"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fixture path exists")
	}
}
func TestRuntimeBindingConfigUnknownFieldsStillRejected(t *testing.T) {
	for _, where := range []string{"root", "apps", "console", "db", "workflow", "path-type", "protected-mode"} {
		t.Run(where, func(t *testing.T) {
			v := runtimeConfigShape()
			a := v["apps"].(map[string]any)
			c := a["console"].(map[string]any)
			switch where {
			case "root":
				v["unknown"] = true
			case "apps":
				a["unknown"] = true
			case "console":
				c["vaultMasterKey"] = "forbidden"
			case "db":
				c["db"].(map[string]any)["unknown"] = true
			case "workflow":
				a["workflow"].(map[string]any)["unknown"] = true
			case "path-type":
				c["vaultMasterKeyFile"] = 42
			}
			raw, _ := json.Marshal(v)
			p := filepath.Join(t.TempDir(), "runtime.json")
			if err := os.WriteFile(p, raw, 0600); err != nil {
				t.Fatal(err)
			}
			if where == "protected-mode" {
				os.Chmod(p, 0644)
			}
			cfg, h, err := readRuntimeBindingConfig(p)
			if !errors.Is(err, ErrProfile) || h != "" || !reflect.ValueOf(cfg).IsZero() {
				t.Fatal("unknown field/unprotected file accepted")
			}
		})
	}
}
func TestRuntimeBindingLocalVaultPathMySQL(t *testing.T) {
	f := newToolFixture(t)
	raw, err := os.ReadFile(f.profile.RuntimeConfig)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil {
		t.Fatal("fixture")
	}
	v["apps"].(map[string]any)["console"].(map[string]any)["vaultMasterKeyFile"] = "/nonexistent/protected/vault-key"
	raw, _ = json.Marshal(v)
	if err := os.WriteFile(f.profile.RuntimeConfig, raw, 0600); err != nil {
		t.Fatal(err)
	}
	b, h, err := f.profile.RuntimeBinding()
	if err != nil || h != Digest(raw) || !reflect.DeepEqual(b, f.binding) {
		t.Fatalf("binding changed: %v", err)
	}
}

func TestVaultUsesSameProtectedConfigDecoder(t *testing.T) {
	t.Setenv("HZY_CONSOLE_VAULT_MASTER_KEY", "")
	t.Setenv("HZY_CONSOLE_VAULT_MASTER_KEY_FILE", filepath.Join(t.TempDir(), "missing-vault-key"))
	v := runtimeConfigShape()
	p := filepath.Join(t.TempDir(), "runtime.json")
	raw, _ := json.Marshal(v)
	if err := os.WriteFile(p, raw, 0600); err != nil {
		t.Fatal(err)
	}
	// The exact local path field is accepted but ignored; no colocated key exists.
	if _, err := openRuntimeVault(Profile{RuntimeConfig: p}); !errors.Is(err, ErrVault) {
		t.Fatal("must reach only protected colocated key check", err)
	}
	v["apps"].(map[string]any)["console"].(map[string]any)["unknownVaultField"] = true
	raw, _ = json.Marshal(v)
	os.WriteFile(p, raw, 0600)
	if _, err := openRuntimeVault(Profile{RuntimeConfig: p}); !errors.Is(err, ErrProfile) {
		t.Fatal("unknown field accepted", err)
	}
}
