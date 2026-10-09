package updater

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/huizhi-yun/notification-runtime/internal/config"
)

func TestDetachedEd25519ReleaseVerificationRejectsTampering(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPath := filepath.Join(t.TempDir(), "release-signing-public.pem")
	if err := os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"version":"0.4.0"}`)
	signature := ed25519.Sign(privateKey, payload)
	keyID, err := verifyDetachedEd25519(payload, signature, publicPath)
	if err != nil || len(keyID) != 64 {
		t.Fatalf("valid signature rejected: keyID=%q err=%v", keyID, err)
	}
	if _, err := verifyDetachedEd25519([]byte(`{"version":"0.4.1"}`), signature, publicPath); err == nil {
		t.Fatal("tampered release payload was accepted")
	}
}

func TestFetchManifestRequiresTrustedDetachedSignature(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(der)
	keyID := hex.EncodeToString(digest[:])
	publicPath := filepath.Join(t.TempDir(), "release-signing-public.pem")
	if err := os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	body := []byte(fmt.Sprintf(`{"version":"0.4.0","signature":{"algorithm":"Ed25519","keyId":"%s","path":"latest.json.sig"}}`, keyID))
	signature := ed25519.Sign(privateKey, body)
	tampered := false
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/latest.json":
			if tampered {
				_, _ = response.Write(append(body, ' '))
				return
			}
			_, _ = response.Write(body)
		case "/latest.json.sig":
			_, _ = response.Write(signature)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	result, err := fetchManifest(context.Background(), server.Client(), server.URL, publicPath)
	if err != nil || result.Version != "0.4.0" {
		t.Fatalf("signed manifest rejected: version=%q err=%v", result.Version, err)
	}
	tampered = true
	if _, err := fetchManifest(context.Background(), server.Client(), server.URL, publicPath); err == nil {
		t.Fatal("tampered signed manifest was accepted")
	}
}

func TestSchemaPreflightFailurePreservesCurrentBinaryAndInstallsMigration(t *testing.T) {
	root := t.TempDir()
	extract := filepath.Join(root, "extract")
	if err := os.MkdirAll(filepath.Join(extract, "schema"), 0o755); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(root, "current-binary")
	packageBinary := filepath.Join(extract, "hzy-notification-runtime")
	schema001 := filepath.Join(extract, "schema", "001_notification_delivery_ledger.sql")
	schema002 := filepath.Join(extract, "schema", "002_notification_delivery_reconciliation.sql")
	if err := os.WriteFile(current, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(packageBinary, []byte("new-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schema001, []byte("CREATE TABLE notification_delivery_ledger (id BIGINT);"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schema002, []byte("CREATE TABLE notification_delivery_reconciliations (id BIGINT);"), 0o644); err != nil {
		t.Fatal(err)
	}
	schema001SHA, err := checksum(schema001)
	if err != nil {
		t.Fatal(err)
	}
	schema002SHA, err := checksum(schema002)
	if err != nil {
		t.Fatal(err)
	}

	previousVerifier := verifyDeliveryStore
	verifyDeliveryStore = func(context.Context, config.DeliveryStoreConfig) error { return errors.New("schema missing") }
	t.Cleanup(func() { verifyDeliveryStore = previousVerifier })
	cfg := config.Config{
		Update:   config.UpdateConfig{InstallDir: filepath.Join(root, "install")},
		Delivery: config.DeliveryStoreConfig{Type: "mysql"},
	}
	manifest := testSchemaManifest(schema001SHA, schema002SHA)
	err = applyExtractedUpdate(context.Background(), cfg, manifest, extract, current)
	if err == nil || !strings.Contains(err.Error(), "delivery schema preflight failed") {
		t.Fatalf("err=%v", err)
	}
	body, err := os.ReadFile(current)
	if err != nil || string(body) != "old-binary" {
		t.Fatalf("current binary changed: %q %v", body, err)
	}
	if _, err := os.Stat(current + ".bak"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected backup: %v", err)
	}
	installed := filepath.Join(root, "install", "schema", "001_notification_delivery_ledger.sql")
	if body, err := os.ReadFile(installed); err != nil || !strings.Contains(string(body), "notification_delivery_ledger") {
		t.Fatalf("installed schema=%q err=%v", body, err)
	}
	installed002 := filepath.Join(root, "install", "schema", "002_notification_delivery_reconciliation.sql")
	if body, err := os.ReadFile(installed002); err != nil || !strings.Contains(string(body), "notification_delivery_reconciliations") {
		t.Fatalf("installed schema 002=%q err=%v", body, err)
	}
}

func TestSchemaChecksumMismatchStopsBeforePreflightAndBinarySwap(t *testing.T) {
	root := t.TempDir()
	extract := filepath.Join(root, "extract")
	if err := os.MkdirAll(filepath.Join(extract, "schema"), 0o755); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(root, "current-binary")
	if err := os.WriteFile(current, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(extract, "hzy-notification-runtime"), []byte("new-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	schema001 := filepath.Join(extract, "schema", "001_notification_delivery_ledger.sql")
	schema002 := filepath.Join(extract, "schema", "002_notification_delivery_reconciliation.sql")
	if err := os.WriteFile(schema001, []byte("schema-001"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schema002, []byte("schema-002"), 0o644); err != nil {
		t.Fatal(err)
	}
	schema001SHA, _ := checksum(schema001)
	cfg := config.Config{Update: config.UpdateConfig{InstallDir: filepath.Join(root, "install")}}
	manifest := testSchemaManifest(schema001SHA, strings.Repeat("0", 64))
	err := applyExtractedUpdate(context.Background(), cfg, manifest, extract, current)
	if err == nil || !strings.Contains(err.Error(), "schema 002 checksum mismatch") {
		t.Fatalf("err=%v", err)
	}
	body, _ := os.ReadFile(current)
	if string(body) != "old-binary" {
		t.Fatalf("current binary changed: %q", body)
	}
}

func TestConnectorUpdateInstallsSignedOperationalFiles(t *testing.T) {
	root := t.TempDir()
	extract := filepath.Join(root, "extract")
	if err := os.MkdirAll(filepath.Join(extract, "schema"), 0o755); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(root, "hzy-connector-runtime")
	if err := os.WriteFile(current, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(extract, "hzy-connector-runtime"), []byte("new-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	schema001 := filepath.Join(extract, "schema", "001_notification_delivery_ledger.sql")
	schema002 := filepath.Join(extract, "schema", "002_notification_delivery_reconciliation.sql")
	if err := os.WriteFile(schema001, []byte("schema-001"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schema002, []byte("schema-002"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"migrate-notification-runtime.sh", "verify-installation.sh", "verify-slo-window.sh"} {
		if err := os.WriteFile(filepath.Join(extract, name), []byte("#!/usr/bin/env bash\nexit 0\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	schema001SHA, _ := checksum(schema001)
	schema002SHA, _ := checksum(schema002)
	previousVerifier := verifyDeliveryStore
	verifyDeliveryStore = func(context.Context, config.DeliveryStoreConfig) error { return nil }
	t.Cleanup(func() { verifyDeliveryStore = previousVerifier })
	cfg := config.Config{Update: config.UpdateConfig{
		BinaryName: "hzy-connector-runtime",
		InstallDir: filepath.Join(root, "install"),
	}}
	if err := applyExtractedUpdate(context.Background(), cfg, testSchemaManifest(schema001SHA, schema002SHA), extract, current); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"migrate-notification-runtime.sh", "verify-installation.sh", "verify-slo-window.sh"} {
		installed := filepath.Join(cfg.Update.InstallDir, name)
		info, err := os.Stat(installed)
		if err != nil {
			t.Fatalf("%s not installed: %v", name, err)
		}
		if info.Mode().Perm() != 0o755 {
			t.Fatalf("%s mode=%o", name, info.Mode().Perm())
		}
	}
	body, _ := os.ReadFile(current)
	if string(body) != "new-binary" {
		t.Fatalf("current binary=%q", body)
	}
}

func TestConnectorUpdateRejectsMissingOperationalFileBeforeBinarySwap(t *testing.T) {
	root := t.TempDir()
	extract := filepath.Join(root, "extract")
	if err := os.MkdirAll(filepath.Join(extract, "schema"), 0o755); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(root, "hzy-connector-runtime")
	if err := os.WriteFile(current, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(extract, "hzy-connector-runtime"), []byte("new-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	schema001 := filepath.Join(extract, "schema", "001_notification_delivery_ledger.sql")
	schema002 := filepath.Join(extract, "schema", "002_notification_delivery_reconciliation.sql")
	if err := os.WriteFile(schema001, []byte("schema-001"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(schema002, []byte("schema-002"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"migrate-notification-runtime.sh", "verify-installation.sh"} {
		if err := os.WriteFile(filepath.Join(extract, name), []byte("#!/usr/bin/env bash\nexit 0\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	schema001SHA, _ := checksum(schema001)
	schema002SHA, _ := checksum(schema002)
	previousVerifier := verifyDeliveryStore
	verifyDeliveryStore = func(context.Context, config.DeliveryStoreConfig) error { return nil }
	t.Cleanup(func() { verifyDeliveryStore = previousVerifier })
	cfg := config.Config{Update: config.UpdateConfig{
		BinaryName: "hzy-connector-runtime",
		InstallDir: filepath.Join(root, "install"),
	}}
	err := applyExtractedUpdate(context.Background(), cfg, testSchemaManifest(schema001SHA, schema002SHA), extract, current)
	if err == nil || !strings.Contains(err.Error(), "verify-slo-window.sh") {
		t.Fatalf("err=%v", err)
	}
	body, _ := os.ReadFile(current)
	if string(body) != "old-binary" {
		t.Fatalf("current binary changed: %q", body)
	}
}

func testSchemaManifest(schema001SHA string, schema002SHA string) manifest {
	schemas := []schemaManifest{
		{Version: "001", Path: "schema/001_notification_delivery_ledger.sql", SHA256: schema001SHA},
		{Version: "002", Path: "schema/002_notification_delivery_reconciliation.sql", SHA256: schema002SHA},
	}
	return manifest{Schema: schemas[1], Schemas: schemas}
}

func TestManifestRequiresOrdered001And002AndBlocksLegacyUpdaterGap(t *testing.T) {
	valid := testSchemaManifest(strings.Repeat("1", 64), strings.Repeat("2", 64))
	if err := validateSchemaManifest(valid); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}
	legacyOnly := manifest{Schema: schemaManifest{Version: "001", Path: "schema/001_notification_delivery_ledger.sql", SHA256: strings.Repeat("1", 64)}}
	if err := validateSchemaManifest(legacyOnly); err == nil {
		t.Fatal("001-only manifest unexpectedly accepted by reconciliation-capable updater")
	}
	reversed := valid
	reversed.Schemas = []schemaManifest{valid.Schemas[1], valid.Schemas[0]}
	if err := validateSchemaManifest(reversed); err == nil {
		t.Fatal("out-of-order schema sequence unexpectedly accepted")
	}
}
