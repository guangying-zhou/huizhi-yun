// Test-only operator tool. Secrets arrive on stdin and use the existing Vault adapter.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Test OSS setup stopped; sensitive diagnostics suppressed.")
		os.Exit(1)
	}
}
func run() error {
	host, _ := os.Hostname()
	if host != "iZcqwiqyhp9u8rZ" || len(os.Args) != 2 || (os.Args[1] != "--check" && os.Args[1] != "--execute" && os.Args[1] != "--rotate") {
		return fmt.Errorf("guard")
	}
	raw, err := os.ReadFile("/wiztek/hzy-test/runtime/config.json")
	if err != nil {
		return err
	}
	var cfg config.Config
	if err = json.Unmarshal(raw, &cfg); err != nil {
		return err
	}
	if cfg.Tenant != "C000001" || cfg.DeploymentBindings["console"] != "wiztek-test-console" || cfg.Apps.Console.DB.Database != "hzy_console_test_20260905" || cfg.Apps.Console.DB.Host != "127.0.0.1" || cfg.Apps.Console.DB.Port != 13316 {
		return fmt.Errorf("binding")
	}
	key, err := os.ReadFile("/wiztek/hzy-test/secrets/vault-key")
	if err != nil {
		return err
	}
	cfg.Apps.Console.VaultMasterKey = strings.TrimSpace(string(key))
	a, err := consoleapp.New(cfg.Apps.Console, cfg.Tenant)
	if err != nil {
		return err
	}
	defer a.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var fields map[string]string
	if err = json.NewDecoder(os.Stdin).Decode(&fields); err != nil {
		return err
	}
	if fields["ALIYUN_OSS_BUCKET_NAME"] != "wiz-rs" || fields["ALIYUN_OSS_ENDPOINT"] != "oss-cn-qingdao.aliyuncs.com" || fields["ALIYUN_OSS_ACCESS_KEY_ID"] == "" || fields["ALIYUN_OSS_ACCESS_KEY_SECRET"] == "" {
		return fmt.Errorf("source")
	}
	var count int
	if err = a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM integrations WHERE integration_code='oss.default'").Scan(&count); err != nil {
		return err
	}
	fmt.Printf("Test OSS integration exists: %t\n", count > 0)
	if os.Args[1] == "--check" {
		return nil
	}
	if os.Args[1] == "--rotate" {
		if count != 1 || fields["ALIYUN_OSS_IMAGES_BUCKET_NAME"] != "wizimages" || fields["ALIYUN_OSS_IMAGES_ENDPOINT"] != "oss-cn-qingdao.aliyuncs.com" || fields["ALIYUN_OSS_IMAGES_BUCKET_DOMAIN"] != "images.wiztek.cn" {
			return fmt.Errorf("images binding")
		}
		meta := func(op string) consoleapp.MutationMeta {
			return consoleapp.MutationMeta{IdempotencyKey: "test-oss-20260906-v2-" + op, RequestID: "test-oss-rotation", ActorID: "operator:approved-test-oss"}
		}
		secret := "test.oss.default.access-key-secret"
		if _, err = a.AddVaultSecretVersion(ctx, secret, map[string]any{"storageBackend": "db_encrypted", "material": map[string]any{"plaintext": fields["ALIYUN_OSS_ACCESS_KEY_SECRET"]}}, true, meta("vault")); err != nil {
			return err
		}
		if _, err = a.RotateIntegrationCredential(ctx, "oss.default", map[string]any{"secretCode": secret}, meta("bind")); err != nil {
			return err
		}
		if _, err = a.UpdateIntegration(ctx, "oss.default", map[string]any{"config": map[string]any{"bucketName": "wiz-rs", "endpoint": "https://oss-cn-qingdao.aliyuncs.com", "accessKeyId": fields["ALIYUN_OSS_ACCESS_KEY_ID"]}}, meta("config")); err != nil {
			return err
		}
		imageSecret := "test.oss.images.access-key-secret"
		if _, err = a.CreateVaultSecret(ctx, map[string]any{"secretCode": imageSecret, "secretName": "Test public images OSS credential", "secretType": "api_key", "usageType": "integration", "ownerType": "integration", "ownerKey": "oss.images", "storageBackend": "db_encrypted", "material": map[string]any{"plaintext": fields["ALIYUN_OSS_ACCESS_KEY_SECRET"]}, "revealPolicy": "deny"}, meta("images-vault")); err != nil {
			return err
		}
		if _, err = a.CreateIntegration(ctx, map[string]any{"integrationCode": "oss.images", "integrationType": "oss", "integrationName": "Public images", "providerCode": "aliyun", "category": "storage", "baseUrl": "https://oss-cn-qingdao.aliyuncs.com", "status": "active", "config": map[string]any{"bucketName": "wizimages", "endpoint": "https://oss-cn-qingdao.aliyuncs.com", "bucketDomain": "images.wiztek.cn", "accessKeyId": fields["ALIYUN_OSS_ACCESS_KEY_ID"]}, "credential": map[string]any{"secretCode": imageSecret}}, meta("images-config")); err != nil {
			return err
		}
		fmt.Println("Test avatar credential rotated and oss.images configured; no OSS objects modified.")
		return nil
	}
	if count != 0 {
		return fmt.Errorf("existing integration requires explicit credential rotation, refusing overwrite")
	}
	const secretCode = "test.oss.default.access-key-secret"
	if count == 0 {
		var secrets int
		if err = a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM vault_secrets WHERE secret_code=?", secretCode).Scan(&secrets); err != nil {
			return err
		}
		if secrets == 0 {
			_, err = a.CreateVaultSecret(ctx, map[string]any{"secretCode": secretCode, "secretName": "Test OSS avatar credential", "secretType": "api_key", "usageType": "integration", "ownerType": "integration", "ownerKey": "oss.default", "storageBackend": "db_encrypted", "material": map[string]any{"plaintext": fields["ALIYUN_OSS_ACCESS_KEY_SECRET"]}, "revealPolicy": "deny"}, consoleapp.MutationMeta{IdempotencyKey: "test-oss-vault-20260906", RequestID: "test-oss-setup", ActorID: "operator:approved-test-oss"})
			if err != nil {
				return err
			}
		}
		_, err = a.CreateIntegration(ctx, map[string]any{"integrationCode": "oss.default", "integrationType": "oss", "integrationName": "Test OSS avatars", "providerCode": "aliyun", "category": "storage", "baseUrl": "https://oss-cn-qingdao.aliyuncs.com", "status": "active", "config": map[string]any{"bucketName": "wiz-rs", "endpoint": "https://oss-cn-qingdao.aliyuncs.com", "accessKeyId": fields["ALIYUN_OSS_ACCESS_KEY_ID"]}, "credential": map[string]any{"secretCode": secretCode}}, consoleapp.MutationMeta{IdempotencyKey: "test-oss-integration-20260906", RequestID: "test-oss-setup", ActorID: "operator:approved-test-oss"})
		if err != nil {
			return err
		}
	}
	fmt.Println("OSS configured via Runtime Vault and integration adapters; no OSS object writes.")
	return nil
}
