package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGatewayKeysetDefaultOffAndPinIndependentOfHeartbeat(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HZY_DATA_RUNTIME_CONFIG_DIR", dir)
	t.Setenv("HZY_DATA_RUNTIME_CONFIG", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Apps.Console.GatewayExchangeEnabled || cfg.GatewayKeyset.Enabled || cfg.GatewayKeyset.PlatformKeyID != "" || cfg.GatewayKeyset.PlatformPublicKey != "" {
		t.Fatal("enabled or trusted implicitly")
	}
	path := filepath.Join(dir, "fixture.json")
	if err = os.WriteFile(path, []byte(`{"gatewayKeyset":{"enabled":true,"environment":"test","gatewayDeployment":"test-gateway","platformKeyId":"operator-pinned","platformPublicKey":"pinned-public"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "platform-signing-key.json"), []byte(`{"kid":"heartbeat-root","alg":"Ed25519","publicKey":"untrusted-overlay"}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HZY_DATA_RUNTIME_CONFIG", path)
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GatewayKeyset.PlatformKeyID != "operator-pinned" || cfg.GatewayKeyset.PlatformPublicKey != "pinned-public" {
		t.Fatal("pin overwritten by unsigned overlay")
	}
}
