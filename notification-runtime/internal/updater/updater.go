package updater

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/deliveryledger"
	"github.com/huizhi-yun/notification-runtime/internal/version"
)

type manifest struct {
	Version    string            `json:"version"`
	Files      map[string]string `json:"files"`
	SHA256     map[string]string `json:"sha256"`
	Signatures map[string]string `json:"signatures"`
	Signature  releaseSignature  `json:"signature"`
	Schema     schemaManifest    `json:"schema"`
	Schemas    []schemaManifest  `json:"schemas"`
}

type releaseSignature struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	Path      string `json:"path"`
}

type schemaManifest struct {
	Version string `json:"version"`
	Path    string `json:"path"`
	SHA256  string `json:"sha256"`
}

var verifyDeliveryStore = func(ctx context.Context, cfg config.DeliveryStoreConfig) error {
	storeContext, cancelStore := context.WithTimeout(ctx, 10*time.Second)
	defer cancelStore()
	store, err := deliveryledger.Open(storeContext, cfg)
	if err != nil {
		return err
	}
	return store.Close()
}

func CheckAndApply(ctx context.Context, cfg config.Config) error {
	productName := first(cfg.Update.ProductName, "hzy-notification-runtime")
	baseURL := strings.TrimRight(cfg.Update.PackageBaseURL, "/")
	if baseURL == "" {
		return errors.New("package base URL is not configured")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	manifest, err := fetchManifest(ctx, client, baseURL, cfg.Update.ReleasePublicKeyFile)
	if err != nil {
		return err
	}
	if manifest.Version == "" {
		return errors.New("latest manifest is missing version")
	}
	if err := validateSchemaManifest(manifest); err != nil {
		return err
	}
	if version.Version != "dev" && manifest.Version == version.Version {
		fmt.Printf("%s already up to date: %s\n", productName, version.Version)
		return nil
	}

	target := runtime.GOOS + "-" + runtime.GOARCH
	fileName := manifest.Files[target]
	if fileName == "" {
		return fmt.Errorf("no package for %s", target)
	}
	expectedSHA := manifest.SHA256[target]
	if expectedSHA == "" {
		return fmt.Errorf("missing checksum for %s", target)
	}

	tmpDir, err := os.MkdirTemp("", productName+"-update-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	archivePath := filepath.Join(tmpDir, filepath.Base(fileName))
	if err := download(ctx, client, baseURL+"/"+fileName, archivePath); err != nil {
		return err
	}
	actualSHA, err := checksum(archivePath)
	if err != nil {
		return err
	}
	if !strings.EqualFold(actualSHA, expectedSHA) {
		return fmt.Errorf("checksum mismatch: expected %s got %s", expectedSHA, actualSHA)
	}
	if cfg.Update.ReleasePublicKeyFile != "" {
		signatureName := manifest.Signatures[target]
		if signatureName == "" {
			return fmt.Errorf("missing release signature for %s", target)
		}
		signaturePath := filepath.Join(tmpDir, filepath.Base(signatureName))
		if err := download(ctx, client, baseURL+"/"+signatureName, signaturePath); err != nil {
			return fmt.Errorf("download release signature: %w", err)
		}
		if err := verifyDetachedEd25519File(archivePath, signaturePath, cfg.Update.ReleasePublicKeyFile, manifest.Signature.KeyID); err != nil {
			return fmt.Errorf("verify release artifact signature: %w", err)
		}
	}

	extractDir := filepath.Join(tmpDir, "extract")
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return err
	}
	if err := extractTarGz(archivePath, extractDir); err != nil {
		return err
	}
	current, err := os.Executable()
	if err != nil {
		return err
	}
	if err := applyExtractedUpdate(ctx, cfg, manifest, extractDir, current); err != nil {
		return err
	}

	fmt.Printf("updated %s from %s to %s\n", productName, version.Version, manifest.Version)
	restartService(cfg.Update.ServiceName)
	return nil
}

func applyExtractedUpdate(ctx context.Context, cfg config.Config, manifest manifest, extractDir string, current string) error {
	binaryName := first(cfg.Update.BinaryName, "hzy-notification-runtime")
	binary := filepath.Join(extractDir, binaryName)
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	if _, err := os.Stat(binary); err != nil {
		return fmt.Errorf("package does not contain executable %s: %w", binaryName, err)
	}
	if err := validateSchemaManifest(manifest); err != nil {
		return err
	}
	installedSchemaDir := filepath.Join(cfg.Update.InstallDir, "schema")
	for _, schema := range manifest.Schemas {
		packageSchema := filepath.Join(extractDir, filepath.FromSlash(schema.Path))
		schemaSHA, err := checksum(packageSchema)
		if err != nil {
			return fmt.Errorf("package does not contain delivery schema %s: %w", schema.Version, err)
		}
		if !strings.EqualFold(schemaSHA, schema.SHA256) {
			return fmt.Errorf("delivery schema %s checksum mismatch: expected %s got %s", schema.Version, schema.SHA256, schemaSHA)
		}
		installedSchema := filepath.Join(cfg.Update.InstallDir, filepath.FromSlash(schema.Path))
		if err := os.MkdirAll(filepath.Dir(installedSchema), 0o755); err != nil {
			return err
		}
		if err := copyFileAtomic(packageSchema, installedSchema, 0o644); err != nil {
			return fmt.Errorf("install delivery schema %s preflight artifact: %w", schema.Version, err)
		}
	}

	if err := verifyDeliveryStore(ctx, cfg.Delivery); err != nil {
		if strings.EqualFold(cfg.Delivery.Type, "mysql") {
			return fmt.Errorf("delivery schema preflight failed; apply migrations in %s in version order before retrying update: %w", installedSchemaDir, err)
		}
		return fmt.Errorf("SQLite delivery store preflight failed; verify the local path and filesystem permissions before retrying update: %w", err)
	}
	if binaryName == "hzy-connector-runtime" {
		operationalFiles := []string{
			"migrate-notification-runtime.sh",
			"verify-installation.sh",
			"verify-slo-window.sh",
		}
		for _, name := range operationalFiles {
			packageFile := filepath.Join(extractDir, name)
			info, err := os.Stat(packageFile)
			if err != nil {
				return fmt.Errorf("package does not contain Connector Runtime operational file %s: %w", name, err)
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("Connector Runtime operational file %s is not a regular file", name)
			}
		}
		for _, name := range operationalFiles {
			packageFile := filepath.Join(extractDir, name)
			installedFile := filepath.Join(cfg.Update.InstallDir, name)
			if err := copyFileAtomic(packageFile, installedFile, 0o755); err != nil {
				return fmt.Errorf("install Connector Runtime operational file %s: %w", name, err)
			}
		}
	}
	backup := current + ".bak"
	if err := os.Rename(current, backup); err != nil {
		return err
	}
	if err := copyFile(binary, current, 0o755); err != nil {
		_ = os.Rename(backup, current)
		return err
	}
	_ = os.Remove(backup)

	return nil
}

func first(values ...string) string {
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return ""
}

func validateSchemaManifest(value manifest) error {
	want := []struct {
		version string
		path    string
	}{
		{version: "001", path: "schema/001_notification_delivery_ledger.sql"},
		{version: "002", path: "schema/002_notification_delivery_reconciliation.sql"},
	}
	if len(value.Schemas) != len(want) {
		return errors.New("latest manifest is missing the reviewed notification delivery schema sequence")
	}
	for index, expected := range want {
		actual := value.Schemas[index]
		if actual.Version != expected.version || actual.Path != expected.path || actual.SHA256 == "" {
			return fmt.Errorf("latest manifest has invalid notification delivery schema %s", expected.version)
		}
	}
	last := value.Schemas[len(value.Schemas)-1]
	if value.Schema != last {
		return errors.New("latest manifest legacy schema pointer must reference schema 002")
	}
	return nil
}

func fetchManifest(ctx context.Context, client *http.Client, baseURL string, releasePublicKeyFile string) (manifest, error) {
	var result manifest
	body, err := fetchBytes(ctx, client, baseURL+"/latest.json", 1<<20)
	if err != nil {
		return result, err
	}
	if releasePublicKeyFile != "" {
		signature, signatureErr := fetchBytes(ctx, client, baseURL+"/latest.json.sig", ed25519.SignatureSize+1)
		if signatureErr != nil {
			return result, fmt.Errorf("fetch release manifest signature: %w", signatureErr)
		}
		keyID, verifyErr := verifyDetachedEd25519(body, signature, releasePublicKeyFile)
		if verifyErr != nil {
			return result, fmt.Errorf("verify release manifest signature: %w", verifyErr)
		}
		if err := json.Unmarshal(body, &result); err != nil {
			return result, err
		}
		if result.Signature.Algorithm != "Ed25519" || result.Signature.Path != "latest.json.sig" || !strings.EqualFold(result.Signature.KeyID, keyID) {
			return result, errors.New("release manifest signature metadata is invalid")
		}
		return result, nil
	}
	return result, json.Unmarshal(body, &result)
}

func fetchBytes(ctx context.Context, client *http.Client, source string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

func verifyDetachedEd25519File(payloadPath string, signaturePath string, publicKeyPath string, expectedKeyID string) error {
	payload, err := os.ReadFile(payloadPath)
	if err != nil {
		return err
	}
	signature, err := os.ReadFile(signaturePath)
	if err != nil {
		return err
	}
	keyID, err := verifyDetachedEd25519(payload, signature, publicKeyPath)
	if err != nil {
		return err
	}
	if !strings.EqualFold(keyID, expectedKeyID) {
		return errors.New("release signing key ID mismatch")
	}
	return nil
}

func verifyDetachedEd25519(payload []byte, signature []byte, publicKeyPath string) (string, error) {
	publicPEM, err := os.ReadFile(publicKeyPath)
	if err != nil {
		return "", err
	}
	block, _ := pem.Decode(publicPEM)
	if block == nil {
		return "", errors.New("release public key PEM is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return "", err
	}
	publicKey, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return "", errors.New("release public key is not Ed25519")
	}
	if len(signature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, payload, signature) {
		return "", errors.New("Ed25519 release signature verification failed")
	}
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(der)
	return hex.EncodeToString(digest[:]), nil
}

func download(ctx context.Context, client *http.Client, source string, target string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}
	file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, resp.Body)
	return err
}

func checksum(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func extractTarGz(archivePath string, targetDir string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(header.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return fmt.Errorf("unsafe archive path: %s", header.Name)
		}
		target := filepath.Join(targetDir, name)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, reader); err != nil {
				_ = out.Close()
				return err
			}
			if err := out.Close(); err != nil {
				return err
			}
		}
	}
}

func copyFile(source string, target string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func copyFileAtomic(source string, target string, mode os.FileMode) error {
	temporary, err := os.CreateTemp(filepath.Dir(target), ".schema-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	in, err := os.Open(source)
	if err != nil {
		_ = temporary.Close()
		return err
	}
	_, copyErr := io.Copy(temporary, in)
	closeInErr := in.Close()
	chmodErr := temporary.Chmod(mode)
	closeOutErr := temporary.Close()
	for _, candidate := range []error{copyErr, closeInErr, chmodErr, closeOutErr} {
		if candidate != nil {
			return candidate
		}
	}
	return os.Rename(temporaryPath, target)
}

func restartService(serviceName string) {
	if runtime.GOOS != "linux" || strings.TrimSpace(serviceName) == "" {
		return
	}
	cmd := exec.Command("systemctl", "restart", serviceName)
	_ = cmd.Run()
}
