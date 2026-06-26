package config

import (
	"os"
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
