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
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	runtimeversion "github.com/huizhi-yun/data-runtime/internal/version"
)

func TestRollbackPreviewDoesNotChangeBinaries(t *testing.T) {
	installDir := prepareRollbackBinaries(t, "current", "previous")

	result, err := Rollback(context.Background(), RollbackOptions{InstallDir: installDir})
	if err != nil {
		t.Fatalf("Rollback() error = %v", err)
	}
	if result.Executed {
		t.Fatal("preview unexpectedly executed")
	}
	if len(result.CurrentSHA256) != 64 || len(result.PreviousSHA256) != 64 {
		t.Fatalf("unexpected hashes: current=%q previous=%q", result.CurrentSHA256, result.PreviousSHA256)
	}
	assertBinaryContents(t, installDir, "current", "previous")
}

func TestRollbackExecuteRequiresExactConfirmation(t *testing.T) {
	for _, confirm := range []string{"", "previous", "hzy-data-runtime"} {
		t.Run(confirm, func(t *testing.T) {
			installDir := prepareRollbackBinaries(t, "current", "previous")
			_, err := Rollback(context.Background(), RollbackOptions{
				InstallDir: installDir,
				Execute:    true,
				Confirm:    confirm,
			})
			if err == nil || !strings.Contains(err.Error(), RollbackConfirmation) {
				t.Fatalf("Rollback() error = %v, want exact confirmation error", err)
			}
			assertBinaryContents(t, installDir, "current", "previous")
		})
	}
}

func TestRollbackExecuteSwapsAndRetainsCurrentBinary(t *testing.T) {
	installDir := prepareRollbackBinaries(t, "current", "previous")

	result, err := Rollback(context.Background(), RollbackOptions{
		InstallDir: installDir,
		Execute:    true,
		Confirm:    RollbackConfirmation,
	})
	if err != nil {
		t.Fatalf("Rollback() error = %v", err)
	}
	if !result.Executed || result.Restarted {
		t.Fatalf("unexpected result: %+v", result)
	}
	assertBinaryContents(t, installDir, "previous", "current")
}

func TestRollbackRestartsServiceAfterSwap(t *testing.T) {
	installDir := prepareRollbackBinaries(t, "current", "previous")
	var serviceNames []string

	result, err := Rollback(context.Background(), RollbackOptions{
		InstallDir:     installDir,
		ServiceName:    "hzy-data-runtime.service",
		Execute:        true,
		Confirm:        RollbackConfirmation,
		RestartService: true,
		restartFn: func(_ context.Context, serviceName string) error {
			serviceNames = append(serviceNames, serviceName)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("Rollback() error = %v", err)
	}
	if !result.Restarted || len(serviceNames) != 1 || serviceNames[0] != "hzy-data-runtime" {
		t.Fatalf("unexpected restart result=%+v services=%v", result, serviceNames)
	}
	assertBinaryContents(t, installDir, "previous", "current")
}

func TestRollbackRestoresOriginalWhenRestartFails(t *testing.T) {
	installDir := prepareRollbackBinaries(t, "current", "previous")
	restartCalls := 0

	result, err := Rollback(context.Background(), RollbackOptions{
		InstallDir:     installDir,
		Execute:        true,
		Confirm:        RollbackConfirmation,
		RestartService: true,
		restartFn: func(_ context.Context, _ string) error {
			restartCalls++
			if restartCalls == 1 {
				return errors.New("rolled-back version unhealthy")
			}
			return nil
		},
	})
	if err == nil || !strings.Contains(err.Error(), "original runtime restored") {
		t.Fatalf("Rollback() error = %v, want restored error", err)
	}
	if !result.Executed || !result.RestoredAfterFailure || restartCalls != 2 {
		t.Fatalf("unexpected result=%+v restartCalls=%d", result, restartCalls)
	}
	assertBinaryContents(t, installDir, "current", "previous")
}

func TestRollbackReportsRestoredRuntimeRestartFailure(t *testing.T) {
	installDir := prepareRollbackBinaries(t, "current", "previous")

	result, err := Rollback(context.Background(), RollbackOptions{
		InstallDir:     installDir,
		Execute:        true,
		Confirm:        RollbackConfirmation,
		RestartService: true,
		restartFn: func(_ context.Context, _ string) error {
			return errors.New("restart failed")
		},
	})
	if err == nil || !strings.Contains(err.Error(), "restart restored runtime") {
		t.Fatalf("Rollback() error = %v, want restored restart error", err)
	}
	if !result.RestoredAfterFailure {
		t.Fatalf("unexpected result: %+v", result)
	}
	assertBinaryContents(t, installDir, "current", "previous")
}

func TestRollbackRejectsMissingPreviousBinary(t *testing.T) {
	installDir := t.TempDir()
	writeExecutable(t, filepath.Join(installDir, "hzy-data-runtime"), "current")

	_, err := Rollback(context.Background(), RollbackOptions{InstallDir: installDir})
	if err == nil || !strings.Contains(err.Error(), "validate previous binary") {
		t.Fatalf("Rollback() error = %v, want missing previous error", err)
	}
	assertFileContents(t, filepath.Join(installDir, "hzy-data-runtime"), "current")
}

func TestInstallExtractedAtomicallyPreservesRollbackAnchor(t *testing.T) {
	installDir := prepareRollbackBinaries(t, "current", "older-previous")
	extractDir := t.TempDir()
	writeExecutable(t, filepath.Join(extractDir, "hzy-data-runtime"), "new")

	if err := installExtracted(extractDir, installDir); err != nil {
		t.Fatalf("installExtracted() error = %v", err)
	}
	assertBinaryContents(t, installDir, "new", "current")
	leftovers, err := filepath.Glob(filepath.Join(installDir, ".hzy-data-runtime*.new-*"))
	if err != nil {
		t.Fatalf("glob atomic install temporary files: %v", err)
	}
	if len(leftovers) != 0 {
		t.Fatalf("atomic install left temporary files: %v", leftovers)
	}
}

func TestSemanticVersionComparisonRejectsDowngradeOrdering(t *testing.T) {
	for _, testCase := range []struct {
		left  string
		right string
		want  int
	}{
		{left: "0.3.96", right: "0.3.97", want: -1},
		{left: "0.3.97", right: "0.3.97", want: 0},
		{left: "0.4.0", right: "0.3.97", want: 1},
		{left: "0.3.97-rc.1", right: "0.3.97", want: -1},
	} {
		got, comparable := compareSemanticVersions(testCase.left, testCase.right)
		if !comparable || got != testCase.want {
			t.Fatalf("compareSemanticVersions(%q, %q) = (%d, %t), want (%d, true)", testCase.left, testCase.right, got, comparable, testCase.want)
		}
	}
}

func TestRunRejectsDowngradeBeforeDownloadingArtifacts(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("automatic updater is Linux-only")
	}
	previousVersion := runtimeversion.Version
	runtimeversion.Version = "1.0.0"
	t.Cleanup(func() { runtimeversion.Version = previousVersion })

	_, err := Run(context.Background(), Options{TargetVersion: "0.0.1"})
	if err == nil || !strings.Contains(err.Error(), "refusing runtime downgrade") {
		t.Fatalf("Run(downgrade) error = %v, want downgrade refusal", err)
	}
}

func TestAtomicCopyFailureLeavesExistingTargetUntouched(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "hzy-data-runtime.previous")
	writeExecutable(t, target, "existing-anchor")

	err := copyFileAtomic(filepath.Join(dir, "missing"), target, 0755, true)
	if err == nil {
		t.Fatal("copyFileAtomic() error = nil, want missing source error")
	}
	assertFileContents(t, target, "existing-anchor")
	leftovers, globErr := filepath.Glob(filepath.Join(dir, ".hzy-data-runtime.previous.new-*"))
	if globErr != nil {
		t.Fatalf("glob temporary files: %v", globErr)
	}
	if len(leftovers) != 0 {
		t.Fatalf("failed atomic copy left temporary files: %v", leftovers)
	}
}

func TestReleaseManifestLocksExactArchitectureArtifactDigest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.json")
	payload := `{
  "name": "hzy-data-runtime",
  "version": "0.3.95",
  "commit": "abc123",
  "builtAt": "2026-07-10T12:00:00Z",
  "installer": {"path": "install.sh", "sha256": "` + strings.Repeat("c", 64) + `"},
  "signature": {"algorithm": "Ed25519", "keyId": "` + strings.Repeat("d", 64) + `", "path": "manifest.json.sig"},
  "platforms": [{"os": "linux", "arch": "amd64"}, {"os": "linux", "arch": "arm64"}],
  "artifacts": [
    {"os": "linux", "arch": "amd64", "path": "hzy-data-runtime_0.3.95_linux_amd64.tar.gz", "sha256": "` + strings.Repeat("a", 64) + `", "signaturePath": "hzy-data-runtime_0.3.95_linux_amd64.tar.gz.sig"},
    {"os": "linux", "arch": "arm64", "path": "hzy-data-runtime_0.3.95_linux_arm64.tar.gz", "sha256": "` + strings.Repeat("b", 64) + `", "signaturePath": "hzy-data-runtime_0.3.95_linux_arm64.tar.gz.sig"}
  ]
}`
	if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := releaseArtifactFromManifest(
		path,
		"0.3.95",
		"arm64",
		"hzy-data-runtime_0.3.95_linux_arm64.tar.gz",
	)
	if err != nil {
		t.Fatalf("releaseArtifactFromManifest() error = %v", err)
	}
	if info.ArtifactSHA256 != strings.Repeat("b", 64) || len(info.ManifestSHA256) != 64 || info.SigningKeyID != strings.Repeat("d", 64) {
		t.Fatalf("unexpected release artifact info: %+v", info)
	}
}

func TestReleaseManifestRejectsIdentityDriftAndUnknownFields(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.json")
	for name, payload := range map[string]string{
		"identity": `{"name":"other","version":"0.3.95","commit":"x","builtAt":"x","installer":{"path":"install.sh","sha256":"` + strings.Repeat("c", 64) + `"},"platforms":[],"artifacts":[]}`,
		"unknown":  `{"name":"hzy-data-runtime","version":"0.3.95","commit":"x","builtAt":"x","installer":{"path":"install.sh","sha256":"` + strings.Repeat("c", 64) + `"},"platforms":[],"artifacts":[],"token":"secret"}`,
		"trailing": `{"name":"hzy-data-runtime","version":"0.3.95","commit":"x","builtAt":"x","installer":{"path":"install.sh","sha256":"` + strings.Repeat("c", 64) + `"},"platforms":[],"artifacts":[]} {}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(strings.ReplaceAll(payload, `\"`, `"`)), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := releaseArtifactFromManifest(path, "0.3.95", "amd64", "archive.tar.gz"); err == nil {
				t.Fatal("releaseArtifactFromManifest() accepted invalid manifest")
			}
		})
	}
}

func TestDetachedEd25519VerificationUsesIndependentTrustedKey(t *testing.T) {
	dir := t.TempDir()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPath := filepath.Join(dir, "release-public.pem")
	if err := os.WriteFile(publicPath, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}), 0600); err != nil {
		t.Fatal(err)
	}
	payloadPath := filepath.Join(dir, "artifact")
	payload := []byte("signed artifact")
	if err := os.WriteFile(payloadPath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	signaturePath := filepath.Join(dir, "artifact.sig")
	if err := os.WriteFile(signaturePath, ed25519.Sign(privateKey, payload), 0600); err != nil {
		t.Fatal(err)
	}
	keyDigest := sha256.Sum256(publicDER)
	keyID := hex.EncodeToString(keyDigest[:])
	if err := verifyDetachedEd25519(payloadPath, signaturePath, publicPath, keyID); err != nil {
		t.Fatalf("verifyDetachedEd25519() error = %v", err)
	}
	if err := os.WriteFile(payloadPath, []byte("tampered artifact"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyDetachedEd25519(payloadPath, signaturePath, publicPath, keyID); err == nil {
		t.Fatal("verifyDetachedEd25519() accepted tampered artifact")
	}
	if err := verifyDetachedEd25519(payloadPath, signaturePath, publicPath, strings.Repeat("0", 64)); err == nil {
		t.Fatal("verifyDetachedEd25519() accepted wrong signing key ID")
	}
}

func prepareRollbackBinaries(t *testing.T, current string, previous string) string {
	t.Helper()
	installDir := t.TempDir()
	writeExecutable(t, filepath.Join(installDir, "hzy-data-runtime"), current)
	writeExecutable(t, filepath.Join(installDir, "hzy-data-runtime.previous"), previous)
	return installDir
}

func writeExecutable(t *testing.T, target string, contents string) {
	t.Helper()
	if err := os.WriteFile(target, []byte(contents), 0755); err != nil {
		t.Fatalf("write %s: %v", target, err)
	}
}

func assertBinaryContents(t *testing.T, installDir string, current string, previous string) {
	t.Helper()
	assertFileContents(t, filepath.Join(installDir, "hzy-data-runtime"), current)
	assertFileContents(t, filepath.Join(installDir, "hzy-data-runtime.previous"), previous)
}

func assertFileContents(t *testing.T, target string, expected string) {
	t.Helper()
	contents, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read %s: %v", target, err)
	}
	if string(contents) != expected {
		t.Fatalf("%s contents = %q, want %q", target, contents, expected)
	}
}
