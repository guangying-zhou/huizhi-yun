package updater

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	"github.com/huizhi-yun/notification-runtime/internal/version"
)

type manifest struct {
	Version string            `json:"version"`
	Files   map[string]string `json:"files"`
	SHA256  map[string]string `json:"sha256"`
}

func CheckAndApply(ctx context.Context, cfg config.UpdateConfig) error {
	baseURL := strings.TrimRight(cfg.PackageBaseURL, "/")
	if baseURL == "" {
		return errors.New("package base URL is not configured")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	manifest, err := fetchManifest(ctx, client, baseURL)
	if err != nil {
		return err
	}
	if manifest.Version == "" {
		return errors.New("latest manifest is missing version")
	}
	if version.Version != "dev" && manifest.Version == version.Version {
		fmt.Printf("hzy-notification-runtime already up to date: %s\n", version.Version)
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

	tmpDir, err := os.MkdirTemp("", "hzy-notification-runtime-update-*")
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

	extractDir := filepath.Join(tmpDir, "extract")
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return err
	}
	if err := extractTarGz(archivePath, extractDir); err != nil {
		return err
	}
	binary := filepath.Join(extractDir, "hzy-notification-runtime")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	if _, err := os.Stat(binary); err != nil {
		return fmt.Errorf("package does not contain executable hzy-notification-runtime: %w", err)
	}

	current, err := os.Executable()
	if err != nil {
		return err
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

	fmt.Printf("updated hzy-notification-runtime from %s to %s\n", version.Version, manifest.Version)
	restartService(cfg.ServiceName)
	return nil
}

func fetchManifest(ctx context.Context, client *http.Client, baseURL string) (manifest, error) {
	var result manifest
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/latest.json", nil)
	if err != nil {
		return result, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return result, fmt.Errorf("latest manifest returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return result, err
	}
	return result, json.Unmarshal(body, &result)
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

func restartService(serviceName string) {
	if runtime.GOOS != "linux" || strings.TrimSpace(serviceName) == "" {
		return
	}
	cmd := exec.Command("systemctl", "restart", serviceName)
	_ = cmd.Run()
}
