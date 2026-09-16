package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestWriteDeploymentBindingsPersistsProtectedControlPlaneOverlay(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("HZY_DATA_RUNTIME_CONFIG_DIR", configDir)
	bindings := map[string]string{
		" Console ": " C000001-console ",
		"finance":   "C000001-finance",
	}
	if err := writeDeploymentBindings(bindings); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(configDir, "deployment-bindings.json")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]string
	if err := json.Unmarshal(content, &stored); err != nil {
		t.Fatal(err)
	}
	if stored["console"] != "C000001-console" || stored["finance"] != "C000001-finance" {
		t.Fatalf("stored bindings = %#v", stored)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("deployment binding mode = %#o, want 0600", info.Mode().Perm())
	}
}

func TestBindingsChangedFailsClosedOnEmptyPlatformResponse(t *testing.T) {
	if bindingsChanged(map[string]string{"finance": "finance-prod"}, nil) {
		t.Fatal("empty Platform response must not erase enrolled bindings")
	}
	if !bindingsChanged(
		map[string]string{"finance": "finance-prod"},
		map[string]string{"finance": "finance-prod", "console": "console-prod"},
	) {
		t.Fatal("new Console binding must require a protected overlay restart")
	}
}

func TestWritePlatformSigningKeyPersistsValidatedHTTPSOverlay(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	signingKey := controlPlatformSigningKey{
		KID:       "psk_20260718_rotation",
		Algorithm: "Ed25519",
		PublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})),
	}
	configDir := t.TempDir()
	t.Setenv("HZY_DATA_RUNTIME_CONFIG_DIR", configDir)
	if err := writePlatformSigningKey("https://huizhi.yun", signingKey); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(configDir, "platform-signing-key.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("Platform signing key overlay mode = %#o, want 0600", info.Mode().Perm())
	}
	if !platformSigningKeyChanged(config.ControlConfig{
		PlatformSigningKeyID:     "old",
		PlatformSigningPublicKey: signingKey.PublicKey,
	}, signingKey) {
		t.Fatal("rotated Platform kid must require a protected overlay restart")
	}
	if err := writePlatformSigningKey("http://huizhi.yun", signingKey); err == nil {
		t.Fatal("Platform signing key sync over plain HTTP must fail closed")
	}
}
