package config

import (
	"os"
	"path/filepath"
	"strings"
)

// ConsoleVaultMasterKeyFile is the Runtime's environment path precedence. JSON
// deliberately cannot override this customer-held secret location.
func ConsoleVaultMasterKeyFile(getenv func(string) string) string {
	if value := strings.TrimSpace(getenv("HZY_CONSOLE_VAULT_MASTER_KEY_FILE")); value != "" {
		return value
	}
	dir := strings.TrimSpace(getenv("HZY_DATA_RUNTIME_CONFIG_DIR"))
	if dir == "" {
		dir = "/etc/hzy-data-runtime"
	}
	return filepath.Join(dir, "console-vault-master-key")
}

// ResolveConsoleVaultMasterKey shares Runtime precedence without loading dotenv
// or initializing any other config. Offline tools supply a protected file reader.
func ResolveConsoleVaultMasterKey(getenv func(string) string, readFile func(string) ([]byte, error)) (string, error) {
	if value := strings.TrimSpace(getenv("HZY_CONSOLE_VAULT_MASTER_KEY")); value != "" {
		return value, nil
	}
	content, err := readFile(ConsoleVaultMasterKeyFile(getenv))
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(content)), nil
}
