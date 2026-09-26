// Test-only, read-only operator check of the C000001 test OSS integration.
// It reports bucket versioning/lifecycle retention for the Codocs snapshot
// prefix and, optionally, reads one exact object version to compare its
// length and SHA-256. It never writes objects or prints credentials; the
// Vault records the credential access as usual.
//
// Usage (same environment as the Runtime LaunchAgent):
//
//	test-oss-version-check [--object KEY --version ID [--size N --sha256 HEX]] [--latest KEY]
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

const snapshotPrefix = "codocs/snapshots/"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "OSS version check stopped:", err)
		os.Exit(1)
	}
}

func run() error {
	object := flag.String("object", "", "object key to read at an exact version")
	version := flag.String("version", "", "provider version id")
	size := flag.Int64("size", -1, "expected byte length")
	digest := flag.String("sha256", "", "expected SHA-256 (hex)")
	latest := flag.String("latest", "", "object key to read at its current version (size, SHA-256, generation stamp only)")
	flag.Parse()
	if (*object == "") != (*version == "") {
		return fmt.Errorf("--object and --version go together")
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config unavailable")
	}
	if cfg.Tenant != "C000001" || cfg.DeploymentBindings["console"] != "wiztek-test-console" {
		return fmt.Errorf("guard: not the C000001 test Runtime")
	}
	adapter, err := consoleapp.New(cfg.Apps.Console, cfg.Tenant)
	if err != nil {
		return fmt.Errorf("console adapter unavailable")
	}
	defer adapter.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	meta := consoleapp.VaultAccessMeta{ActorType: "operator", ActorID: "test-oss-version-check", AppCode: "codocs", Reason: "read-only snapshot storage retention check"}
	report := map[string]any{"integration": "oss.default"}
	retention, err := adapter.GetOSSBucketRetention(ctx, "oss.default", meta)
	if err != nil {
		return fmt.Errorf("retention: %v", err)
	}
	report["versioning"] = retention.Versioning
	report["lifecycleRules"] = retention.Rules
	// v2 snapshots are write-once keys; v1 history overwrites documents in place.
	for label, check := range map[string]error{
		"snapshotWriteOnce":    retention.RetainsVersionsUnder(snapshotPrefix, true),
		"overwrittenHistoryV1": retention.RetainsVersionsUnder("codocs/", false),
	} {
		if check != nil {
			report[label] = map[string]any{"retained": false, "reason": check.Error()}
		} else {
			report[label] = map[string]any{"retained": true}
		}
	}
	if *object != "" {
		read, err := adapter.OpenOSSObjectVersion(ctx, "oss.default", *object, *version, meta)
		if err != nil {
			report["exactRead"] = map[string]any{"ok": false, "error": err.Error()}
		} else {
			hash := sha256.New()
			n, copyErr := io.Copy(hash, read.Body)
			_ = read.Body.Close()
			result := map[string]any{"ok": copyErr == nil, "bytes": n, "versionMatched": read.Version == *version}
			sum := hex.EncodeToString(hash.Sum(nil))
			if *size >= 0 {
				result["sizeMatched"] = n == *size
			}
			if *digest != "" {
				result["sha256Matched"] = sum == *digest
			}
			report["exactRead"] = result
		}
	}
	if *latest != "" {
		body, userMeta, err := adapter.ReadOSSObjectLatest(ctx, "oss.default", *latest, meta)
		if err != nil {
			report["latest"] = map[string]any{"ok": false, "error": err.Error()}
		} else {
			sum := sha256.Sum256(body)
			report["latest"] = map[string]any{"ok": true, "bytes": len(body), "sha256": hex.EncodeToString(sum[:]), "snapshotGeneration": userMeta["hzy-snapshot-generation"]}
		}
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}
