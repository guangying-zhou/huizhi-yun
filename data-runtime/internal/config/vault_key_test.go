package config

import (
	"errors"
	"os"
	"testing"
)

func TestConsoleVaultMasterKeyPrecedenceAndMissing(t *testing.T) {
	for _, test := range []struct {
		name      string
		env       map[string]string
		path, key string
		reads     int
	}{
		{"literal", map[string]string{"HZY_CONSOLE_VAULT_MASTER_KEY": " synthetic ", "HZY_CONSOLE_VAULT_MASTER_KEY_FILE": "/must-not-read"}, "/must-not-read", "synthetic", 0},
		{"file", map[string]string{"HZY_CONSOLE_VAULT_MASTER_KEY_FILE": "/protected/custom.key", "HZY_DATA_RUNTIME_CONFIG_DIR": "/ignored"}, "/protected/custom.key", "file-synthetic", 1},
		{"config-dir", map[string]string{"HZY_DATA_RUNTIME_CONFIG_DIR": "/protected/config"}, "/protected/config/console-vault-master-key", "file-synthetic", 1},
		{"default", map[string]string{}, "/etc/hzy-data-runtime/console-vault-master-key", "file-synthetic", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			get := func(k string) string { return test.env[k] }
			reads := 0
			key, err := ResolveConsoleVaultMasterKey(get, func(p string) ([]byte, error) {
				reads++
				if p != test.path {
					t.Fatal(p)
				}
				return []byte(" file-synthetic "), nil
			})
			if err != nil || key != test.key || reads != test.reads || ConsoleVaultMasterKeyFile(get) != test.path {
				t.Fatal("precedence changed")
			}
		})
	}
	key, err := ResolveConsoleVaultMasterKey(func(string) string { return "" }, func(string) ([]byte, error) { return nil, os.ErrNotExist })
	if key != "" || err != nil {
		t.Fatal("missing must preserve unconfigured runtime")
	}
	_, err = ResolveConsoleVaultMasterKey(func(string) string { return "" }, func(string) ([]byte, error) { return nil, errors.New("denied") })
	if err == nil {
		t.Fatal("read error swallowed")
	}
}
