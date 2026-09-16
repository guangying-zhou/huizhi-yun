package directoryconnector

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConnectorStateCachePersistsOnlyEncryptedConfiguration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "directory", "state-cache.json")
	state := connectorStateCache{
		ConnectorID: "directory-connector.C000001-console",
		Configuration: &LDAPConfiguration{
			Host: "ldap.example.com", BindDN: "cn=Manager,dc=example,dc=com",
			BindPasswordCiphertext: "encrypted-value", SyncIntervalSeconds: 300,
		},
	}
	if err := saveConnectorState(path, state); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("unexpected state cache mode: %o", info.Mode().Perm())
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(content), "ldap-bind-password") {
		t.Fatal("state cache must not contain the plaintext LDAP password")
	}
	loaded, err := loadConnectorState(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ConnectorID != state.ConnectorID || loaded.Configuration == nil || loaded.Configuration.BindPasswordCiphertext != "encrypted-value" {
		t.Fatalf("unexpected cached state: %#v", loaded)
	}
}

func TestNewRestoresConnectorIdentityAndEncryptedConfiguration(t *testing.T) {
	directory := t.TempDir()
	keyPath := filepath.Join(directory, "connector-private.pem")
	key, err := loadOrCreatePrivateKey(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	password := "ldap-bind-password"
	ciphertext, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &key.PublicKey, []byte(password), nil)
	if err != nil {
		t.Fatal(err)
	}
	cachePath := filepath.Join(directory, "state-cache.json")
	if err := saveConnectorState(cachePath, connectorStateCache{
		ConnectorID: "directory-connector.C000001-console",
		Configuration: &LDAPConfiguration{
			Host: "ldap.example.com", BindPasswordCiphertext: base64.StdEncoding.EncodeToString(ciphertext),
			SyncIntervalSeconds: 300,
		},
	}); err != nil {
		t.Fatal(err)
	}
	agent, err := New(Config{
		RuntimeURL: "http://127.0.0.1:18080", PrivateKeyFile: keyPath,
		StateCacheFile: cachePath, HTTPTimeout: 1, RefreshBackoff: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if agent.runtime == nil || agent.cfg.ConnectorID != "directory-connector.C000001-console" || !agent.configured {
		t.Fatalf("cached connector state was not restored: %#v", agent)
	}
	if agent.ldapConfig.BindPassword != password {
		t.Fatal("cached encrypted bind password was not decrypted in memory")
	}
}

func TestSanitizedHTTPErrorDetailExtractsStructuredMessage(t *testing.T) {
	detail := sanitizedHTTPErrorDetail([]byte(`{"code":"projection_failed","message":"write timed out"}`))
	if detail != "projection_failed: write timed out" {
		t.Fatalf("unexpected error detail: %q", detail)
	}
}
