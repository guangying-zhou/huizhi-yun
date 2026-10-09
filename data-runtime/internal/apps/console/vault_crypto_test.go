package console

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestVaultCipherRoundTripUsesConsoleCompatibleEnvelope(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	adapter := NewWithDB(config.ConsoleConfig{VaultMasterKey: key}, "tenant-1", nil)

	material, err := adapter.encryptVaultPlaintext("tenant-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if material.EncryptionScheme != "aes256-gcm" ||
		!strings.Contains(string(material.CiphertextBlob), `"alg":"aes-256-gcm"`) ||
		material.ContentHash != vaultContentHash("tenant-secret-value") {
		t.Fatalf("material = %#v", material)
	}
	plaintext, err := adapter.decryptVaultPlaintext(material.CiphertextBlob)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "tenant-secret-value" {
		t.Fatalf("plaintext = %q", plaintext)
	}
}

func TestVaultMaterialNeverReturnsPlaintextMetadata(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	adapter := NewWithDB(config.ConsoleConfig{VaultMasterKey: key}, "tenant-1", nil)

	material, err := normalizeVaultMaterial("db_encrypted", map[string]any{
		"plaintext": "top-secret-value",
	}, adapter)
	if err != nil {
		t.Fatal(err)
	}
	encoded := string(material.CiphertextBlob)
	if strings.Contains(encoded, "top-secret-value") ||
		strings.Contains(material.ContentHash, "top-secret-value") ||
		material.MaskedPreview == "top-secret-value" {
		t.Fatalf("secret leaked through material metadata: %#v", material)
	}
}
