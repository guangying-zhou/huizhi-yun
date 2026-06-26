package updater

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/version"
)

const DefaultBaseURL = "https://downloads.huizhi.yun/packages/hzy-data-runtime"

type Options struct {
	BaseURL        string
	TargetVersion  string
	InstallDir     string
	ServiceName    string
	SkipChecksum   bool
	Force          bool
	RestartService bool
	HTTPClient     *http.Client
}

type Result struct {
	CurrentVersion   string
	AvailableVersion string
	ArchiveURL       string
	Updated          bool
	Restarted        bool
}

func Run(ctx context.Context, options Options) (Result, error) {
	options = withDefaults(options)
	if runtime.GOOS != "linux" {
		return Result{}, fmt.Errorf("automatic update is only supported on linux, current os: %s", runtime.GOOS)
	}

	arch, err := packageArch(runtime.GOARCH)
	if err != nil {
		return Result{}, err
	}

	resolvedVersion, err := resolveVersion(ctx, options)
	if err != nil {
		return Result{}, err
	}

	result := Result{
		CurrentVersion:   version.Version,
		AvailableVersion: resolvedVersion,
	}

	if !options.Force && version.Version == resolvedVersion {
		return result, nil
	}

	workDir, err := os.MkdirTemp("", "hzy-data-runtime-update-*")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(workDir)

	archiveURL := packageURL(options.BaseURL, resolvedVersion, arch)
	checksumURL := archiveURL + ".sha256"
	result.ArchiveURL = archiveURL

	archivePath := filepath.Join(workDir, "package.tar.gz")
	if err := download(ctx, options, archiveURL+"?v="+resolvedVersion, archivePath); err != nil {
		return result, err
	}
	if !options.SkipChecksum {
		checksumPath := filepath.Join(workDir, "package.tar.gz.sha256")
		if err := download(ctx, options, checksumURL+"?v="+resolvedVersion, checksumPath); err != nil {
			return result, err
		}
		if err := verifyChecksum(archivePath, checksumPath); err != nil {
			return result, err
		}
	}

	extractDir := filepath.Join(workDir, "extract")
	if err := os.MkdirAll(extractDir, 0755); err != nil {
		return result, err
	}
	if err := extractArchive(archivePath, extractDir); err != nil {
		return result, err
	}

	if err := installExtracted(extractDir, options.InstallDir); err != nil {
		return result, err
	}
	result.Updated = true

	if options.RestartService {
		if err := restartService(ctx, options.ServiceName); err != nil {
			_ = restorePreviousBinary(options.InstallDir)
			_ = restartService(ctx, options.ServiceName)
			return result, err
		}
		result.Restarted = true
	}

	return result, nil
}

func withDefaults(options Options) Options {
	if strings.TrimSpace(options.BaseURL) == "" {
		options.BaseURL = DefaultBaseURL
	}
	options.BaseURL = strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if strings.TrimSpace(options.TargetVersion) == "" {
		options.TargetVersion = "latest"
	}
	if strings.TrimSpace(options.InstallDir) == "" {
		options.InstallDir = "/opt/hzy-data-runtime"
	}
	if strings.TrimSpace(options.ServiceName) == "" {
		options.ServiceName = "hzy-data-runtime"
	}
	options.ServiceName = strings.TrimSuffix(options.ServiceName, ".service")
	if options.HTTPClient == nil {
		options.HTTPClient = &http.Client{Timeout: 60 * time.Second}
	}
	return options
}

func packageArch(goarch string) (string, error) {
	switch goarch {
	case "amd64":
		return "amd64", nil
	case "arm64":
		return "arm64", nil
	default:
		return "", fmt.Errorf("unsupported architecture: %s", goarch)
	}
}

func resolveVersion(ctx context.Context, options Options) (string, error) {
	target := strings.TrimSpace(options.TargetVersion)
	if target != "latest" {
		return target, nil
	}
	versionURL := options.BaseURL + "/latest/version.txt"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, versionURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := options.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("download %s failed: HTTP %d", versionURL, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024))
	if err != nil {
		return "", err
	}
	resolved := strings.TrimSpace(string(body))
	if resolved == "" {
		return "", fmt.Errorf("empty latest version file: %s", versionURL)
	}
	return resolved, nil
}

func packageURL(baseURL string, releaseVersion string, arch string) string {
	return fmt.Sprintf("%s/%s/hzy-data-runtime_%s_linux_%s.tar.gz", baseURL, releaseVersion, releaseVersion, arch)
}

func download(ctx context.Context, options Options, url string, output string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := options.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download %s failed: HTTP %d", url, resp.StatusCode)
	}

	file, err := os.Create(output)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := io.Copy(file, resp.Body); err != nil {
		return err
	}
	return file.Close()
}

func verifyChecksum(archivePath string, checksumPath string) error {
	expected, err := os.ReadFile(checksumPath)
	if err != nil {
		return err
	}
	fields := strings.Fields(string(expected))
	if len(fields) == 0 {
		return fmt.Errorf("empty checksum file: %s", checksumPath)
	}

	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if fields[0] != actual {
		return fmt.Errorf("checksum mismatch for %s", archivePath)
	}
	return nil
}

func extractArchive(archivePath string, outputDir string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	reader := tar.NewReader(gzipReader)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}

		cleanName := path.Clean(strings.TrimPrefix(header.Name, "./"))
		if cleanName == "." || cleanName == "" {
			continue
		}

		target, err := safeArchivePath(outputDir, cleanName)
		if err != nil {
			return err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			fileMode := os.FileMode(header.Mode) & 0777
			if fileMode == 0 {
				fileMode = 0644
			}
			output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, fileMode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(output, reader); err != nil {
				_ = output.Close()
				return err
			}
			if err := output.Close(); err != nil {
				return err
			}
		}
	}
	return nil
}

func safeArchivePath(outputDir string, name string) (string, error) {
	clean := path.Clean(strings.TrimPrefix(name, "./"))
	if clean == "." || clean == "" || strings.HasPrefix(clean, "../") || path.IsAbs(clean) {
		return "", fmt.Errorf("unsafe archive path: %s", name)
	}
	return filepath.Join(outputDir, filepath.FromSlash(clean)), nil
}

func installExtracted(extractDir string, installDir string) error {
	binaryPath := filepath.Join(extractDir, "hzy-data-runtime")
	info, err := os.Stat(binaryPath)
	if err != nil {
		return fmt.Errorf("package does not contain executable hzy-data-runtime: %w", err)
	}
	if info.Mode()&0111 == 0 {
		return fmt.Errorf("package hzy-data-runtime is not executable")
	}

	if err := os.MkdirAll(installDir, 0755); err != nil {
		return err
	}

	currentBinary := filepath.Join(installDir, "hzy-data-runtime")
	previousBinary := filepath.Join(installDir, "hzy-data-runtime.previous")
	if _, err := os.Stat(currentBinary); err == nil {
		_ = os.Remove(previousBinary)
		if err := copyFile(currentBinary, previousBinary, 0755); err != nil {
			return fmt.Errorf("backup current binary: %w", err)
		}
	}

	newBinary := filepath.Join(installDir, "hzy-data-runtime.new")
	if err := copyFile(binaryPath, newBinary, 0755); err != nil {
		return err
	}
	if err := os.Rename(newBinary, currentBinary); err != nil {
		return err
	}

	for _, name := range []string{".env.example", "config.example.json", "README.md", "VERSION"} {
		source := filepath.Join(extractDir, name)
		if _, err := os.Stat(source); err == nil {
			if err := copyFile(source, filepath.Join(installDir, name), 0644); err != nil {
				log.Printf("[hzy-data-runtime] skip updating non-critical file %s: %v", name, err)
			}
		}
	}

	return nil
}

func restorePreviousBinary(installDir string) error {
	currentBinary := filepath.Join(installDir, "hzy-data-runtime")
	previousBinary := filepath.Join(installDir, "hzy-data-runtime.previous")
	if _, err := os.Stat(previousBinary); err != nil {
		return err
	}
	return os.Rename(previousBinary, currentBinary)
}

func copyFile(source string, target string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	return os.Chmod(target, mode)
}

func restartService(ctx context.Context, serviceName string) error {
	if strings.TrimSpace(serviceName) == "" {
		return nil
	}
	restart := exec.CommandContext(ctx, "systemctl", "restart", serviceName)
	if output, err := restart.CombinedOutput(); err != nil {
		return fmt.Errorf("restart %s failed: %w: %s", serviceName, err, strings.TrimSpace(string(output)))
	}

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		active := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", serviceName)
		if err := active.Run(); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return fmt.Errorf("service %s did not become active after restart", serviceName)
}
