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
	"log"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/version"
)

const DefaultBaseURL = "https://downloads.huizhi.yun/packages/hzy-data-runtime"

const RollbackConfirmation = "hzy-data-runtime.previous"

func SourceFingerprint(baseURL string) string {
	hash := sha256.Sum256([]byte(strings.TrimRight(strings.TrimSpace(baseURL), "/")))
	return hex.EncodeToString(hash[:])
}

type Options struct {
	BaseURL                string
	TargetVersion          string
	InstallDir             string
	ServiceName            string
	SkipChecksum           bool
	Force                  bool
	RestartService         bool
	ExpectedArtifactSHA256 string
	ReleasePublicKeyFile   string
	ExpectedSigningKeyID   string
	HTTPClient             *http.Client
}

type Result struct {
	CurrentVersion   string
	AvailableVersion string
	ArchiveURL       string
	Updated          bool
	Restarted        bool
	ArtifactSHA256   string
	ManifestSHA256   string
	SigningKeyID     string
}

type releaseManifest struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuiltAt   string `json:"builtAt"`
	Installer struct {
		Path          string `json:"path"`
		SHA256        string `json:"sha256"`
		SignaturePath string `json:"signaturePath"`
	} `json:"installer"`
	Signature struct {
		Algorithm string `json:"algorithm"`
		KeyID     string `json:"keyId"`
		Path      string `json:"path"`
	} `json:"signature"`
	Platforms []struct {
		OS   string `json:"os"`
		Arch string `json:"arch"`
	} `json:"platforms"`
	Artifacts []struct {
		OS            string `json:"os"`
		Arch          string `json:"arch"`
		Path          string `json:"path"`
		SHA256        string `json:"sha256"`
		SignaturePath string `json:"signaturePath"`
	} `json:"artifacts"`
}

type releaseArtifactInfo struct {
	ArtifactSHA256    string
	ManifestSHA256    string
	ManifestSignature string
	ArtifactSignature string
	SigningKeyID      string
}

type RollbackOptions struct {
	InstallDir     string
	ServiceName    string
	Execute        bool
	Confirm        string
	RestartService bool
	restartFn      func(context.Context, string) error
}

type RollbackResult struct {
	CurrentBinary        string
	PreviousBinary       string
	CurrentSHA256        string
	PreviousSHA256       string
	Executed             bool
	Restarted            bool
	RestoredAfterFailure bool
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
	if comparison, comparable := compareSemanticVersions(resolvedVersion, version.Version); comparable && comparison < 0 {
		return Result{}, fmt.Errorf(
			"refusing runtime downgrade from %s to %s; use the guarded rollback command",
			version.Version,
			resolvedVersion,
		)
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
	manifestPath := filepath.Join(workDir, "manifest.json")
	manifestURL := options.BaseURL + "/" + resolvedVersion + "/manifest.json"
	if err := download(ctx, options, manifestURL+"?v="+resolvedVersion, manifestPath); err != nil {
		return result, err
	}
	artifactInfo, err := releaseArtifactFromManifest(manifestPath, resolvedVersion, arch, filepath.Base(archiveURL))
	if err != nil {
		return result, err
	}
	if expected := strings.ToLower(strings.TrimSpace(options.ExpectedArtifactSHA256)); expected != "" && expected != artifactInfo.ArtifactSHA256 {
		return result, fmt.Errorf("release artifact digest does not match the approved digest")
	}
	if expected := strings.ToLower(strings.TrimSpace(options.ExpectedSigningKeyID)); expected != "" && expected != artifactInfo.SigningKeyID {
		return result, fmt.Errorf("release signing key does not match the approved key ID")
	}
	manifestSignaturePath := filepath.Join(workDir, "manifest.sig")
	if err := download(ctx, options, options.BaseURL+"/"+resolvedVersion+"/"+artifactInfo.ManifestSignature+"?v="+resolvedVersion, manifestSignaturePath); err != nil {
		return result, err
	}
	if err := verifyDetachedEd25519(manifestPath, manifestSignaturePath, options.ReleasePublicKeyFile, artifactInfo.SigningKeyID); err != nil {
		return result, fmt.Errorf("verify release manifest signature: %w", err)
	}
	result.ArtifactSHA256 = artifactInfo.ArtifactSHA256
	result.ManifestSHA256 = artifactInfo.ManifestSHA256
	result.SigningKeyID = artifactInfo.SigningKeyID

	archivePath := filepath.Join(workDir, "package.tar.gz")
	if err := download(ctx, options, archiveURL+"?v="+resolvedVersion, archivePath); err != nil {
		return result, err
	}
	if err := verifyFileSHA256(archivePath, artifactInfo.ArtifactSHA256); err != nil {
		return result, fmt.Errorf("verify release manifest artifact: %w", err)
	}
	archiveSignaturePath := filepath.Join(workDir, "package.tar.gz.sig")
	if err := download(ctx, options, options.BaseURL+"/"+resolvedVersion+"/"+artifactInfo.ArtifactSignature+"?v="+resolvedVersion, archiveSignaturePath); err != nil {
		return result, err
	}
	if err := verifyDetachedEd25519(archivePath, archiveSignaturePath, options.ReleasePublicKeyFile, artifactInfo.SigningKeyID); err != nil {
		return result, fmt.Errorf("verify release artifact signature: %w", err)
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
			restartErr := err
			if restoreErr := restorePreviousBinary(options.InstallDir); restoreErr != nil {
				return result, errors.Join(
					fmt.Errorf("restart updated runtime: %w", restartErr),
					fmt.Errorf("restore previous runtime binary: %w", restoreErr),
				)
			}
			if restoreRestartErr := restartService(ctx, options.ServiceName); restoreRestartErr != nil {
				return result, errors.Join(
					fmt.Errorf("restart updated runtime: %w", restartErr),
					fmt.Errorf("restart restored runtime: %w", restoreRestartErr),
				)
			}
			return result, fmt.Errorf("restart updated runtime: %w; previous runtime restored", restartErr)
		}
		result.Restarted = true
	}

	return result, nil
}

func compareSemanticVersions(left string, right string) (int, bool) {
	parse := func(value string) ([3]int, string, bool) {
		var core [3]int
		parts := strings.SplitN(value, "-", 2)
		numbers := strings.Split(parts[0], ".")
		if len(numbers) != 3 {
			return core, "", false
		}
		for index, number := range numbers {
			parsed, err := strconv.Atoi(number)
			if err != nil {
				return core, "", false
			}
			core[index] = parsed
		}
		preRelease := ""
		if len(parts) == 2 {
			preRelease = parts[1]
		}
		return core, preRelease, true
	}
	leftCore, leftPre, leftOK := parse(left)
	rightCore, rightPre, rightOK := parse(right)
	if !leftOK || !rightOK {
		return 0, false
	}
	for index := range leftCore {
		if leftCore[index] < rightCore[index] {
			return -1, true
		}
		if leftCore[index] > rightCore[index] {
			return 1, true
		}
	}
	if leftPre == rightPre {
		return 0, true
	}
	if leftPre == "" {
		return 1, true
	}
	if rightPre == "" {
		return -1, true
	}
	return strings.Compare(leftPre, rightPre), true
}

func releaseArtifactFromManifest(manifestPath string, expectedVersion string, arch string, archiveName string) (releaseArtifactInfo, error) {
	payload, err := os.ReadFile(manifestPath)
	if err != nil {
		return releaseArtifactInfo{}, err
	}
	if len(payload) > 1024*1024 {
		return releaseArtifactInfo{}, fmt.Errorf("release manifest is too large")
	}
	var manifest releaseManifest
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return releaseArtifactInfo{}, fmt.Errorf("decode release manifest: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return releaseArtifactInfo{}, fmt.Errorf("decode release manifest: trailing JSON value")
	}
	if manifest.Name != "hzy-data-runtime" || manifest.Version != expectedVersion {
		return releaseArtifactInfo{}, fmt.Errorf("release manifest identity mismatch")
	}
	if manifest.Signature.Algorithm != "Ed25519" || manifest.Signature.Path != "manifest.json.sig" || !isSHA256(manifest.Signature.KeyID) {
		return releaseArtifactInfo{}, fmt.Errorf("release manifest signature metadata is invalid")
	}
	matched := releaseArtifactInfo{}
	for _, artifact := range manifest.Artifacts {
		if artifact.OS == "linux" && artifact.Arch == arch && artifact.Path == archiveName {
			if matched.ArtifactSHA256 != "" {
				return releaseArtifactInfo{}, fmt.Errorf("release manifest contains duplicate artifact")
			}
			matched.ArtifactSHA256 = strings.ToLower(strings.TrimSpace(artifact.SHA256))
			matched.ArtifactSignature = artifact.SignaturePath
		}
	}
	if !isSHA256(matched.ArtifactSHA256) || matched.ArtifactSignature != archiveName+".sig" {
		return releaseArtifactInfo{}, fmt.Errorf("release manifest is missing a valid signed artifact")
	}
	manifestDigest := sha256.Sum256(payload)
	matched.ManifestSHA256 = hex.EncodeToString(manifestDigest[:])
	matched.ManifestSignature = manifest.Signature.Path
	matched.SigningKeyID = manifest.Signature.KeyID
	return matched, nil
}

func verifyDetachedEd25519(payloadPath string, signaturePath string, publicKeyPath string, expectedKeyID string) error {
	if strings.TrimSpace(publicKeyPath) == "" {
		return fmt.Errorf("trusted release public key file is required")
	}
	publicPEM, err := os.ReadFile(publicKeyPath)
	if err != nil {
		return err
	}
	block, rest := pem.Decode(publicPEM)
	if block == nil || len(strings.TrimSpace(string(rest))) != 0 {
		return fmt.Errorf("release public key is not one PEM public key")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return err
	}
	publicKey, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return fmt.Errorf("release public key is not Ed25519")
	}
	keyDigest := sha256.Sum256(block.Bytes)
	if hex.EncodeToString(keyDigest[:]) != expectedKeyID {
		return fmt.Errorf("release public key ID mismatch")
	}
	payload, err := os.ReadFile(payloadPath)
	if err != nil {
		return err
	}
	signature, err := os.ReadFile(signaturePath)
	if err != nil {
		return err
	}
	if len(signature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, payload, signature) {
		return fmt.Errorf("Ed25519 signature verification failed")
	}
	return nil
}

func verifyFileSHA256(path string, expected string) error {
	actual, err := FileSHA256(path)
	if err != nil {
		return err
	}
	if actual != strings.ToLower(strings.TrimSpace(expected)) {
		return fmt.Errorf("checksum mismatch for %s", path)
	}
	return nil
}

func Rollback(ctx context.Context, options RollbackOptions) (RollbackResult, error) {
	if strings.TrimSpace(options.InstallDir) == "" {
		options.InstallDir = "/opt/hzy-data-runtime"
	}
	if strings.TrimSpace(options.ServiceName) == "" {
		options.ServiceName = "hzy-data-runtime"
	}
	options.ServiceName = strings.TrimSuffix(options.ServiceName, ".service")
	if options.restartFn == nil {
		options.restartFn = restartService
	}

	result := RollbackResult{
		CurrentBinary:  filepath.Join(options.InstallDir, "hzy-data-runtime"),
		PreviousBinary: filepath.Join(options.InstallDir, "hzy-data-runtime.previous"),
	}
	var err error
	result.CurrentSHA256, err = executableSHA256(result.CurrentBinary)
	if err != nil {
		return result, fmt.Errorf("validate current binary: %w", err)
	}
	result.PreviousSHA256, err = executableSHA256(result.PreviousBinary)
	if err != nil {
		return result, fmt.Errorf("validate previous binary: %w", err)
	}

	if !options.Execute {
		return result, nil
	}
	if options.Confirm != RollbackConfirmation {
		return result, fmt.Errorf("rollback confirmation must equal %q", RollbackConfirmation)
	}

	if err := swapInstalledBinaries(options.InstallDir); err != nil {
		return result, fmt.Errorf("swap runtime binaries: %w", err)
	}
	result.Executed = true

	if !options.RestartService {
		return result, nil
	}
	if err := options.restartFn(ctx, options.ServiceName); err == nil {
		result.Restarted = true
		return result, nil
	} else {
		restartErr := err
		if restoreErr := swapInstalledBinaries(options.InstallDir); restoreErr != nil {
			return result, errors.Join(
				fmt.Errorf("restart rolled-back runtime: %w", restartErr),
				fmt.Errorf("restore original runtime binary: %w", restoreErr),
			)
		}
		result.RestoredAfterFailure = true
		if restoreRestartErr := options.restartFn(ctx, options.ServiceName); restoreRestartErr != nil {
			return result, errors.Join(
				fmt.Errorf("restart rolled-back runtime: %w", restartErr),
				fmt.Errorf("restart restored runtime: %w", restoreRestartErr),
			)
		}
		return result, fmt.Errorf("restart rolled-back runtime: %w; original runtime restored", restartErr)
	}
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
		if !autoUpdateTargetPattern.MatchString(target) {
			return "", fmt.Errorf("target version must be an exact semantic version")
		}
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
	if resolved == "latest" || !autoUpdateTargetPattern.MatchString(resolved) {
		return "", fmt.Errorf("latest version file does not contain an exact semantic version")
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
		if err := copyFileAtomic(currentBinary, previousBinary, 0755, true); err != nil {
			return fmt.Errorf("backup current binary: %w", err)
		}
	}

	if err := copyFileAtomic(binaryPath, currentBinary, 0755, true); err != nil {
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
	return swapInstalledBinaries(installDir)
}

func executableSHA256(binaryPath string) (string, error) {
	info, err := os.Stat(binaryPath)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s is not a regular file", binaryPath)
	}
	if info.Mode()&0111 == 0 {
		return "", fmt.Errorf("%s is not executable", binaryPath)
	}

	file, err := os.Open(binaryPath)
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

func FileSHA256(filePath string) (string, error) {
	file, err := os.Open(filePath)
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

func swapInstalledBinaries(installDir string) error {
	currentBinary := filepath.Join(installDir, "hzy-data-runtime")
	previousBinary := filepath.Join(installDir, "hzy-data-runtime.previous")
	if _, err := executableSHA256(currentBinary); err != nil {
		return fmt.Errorf("validate current binary: %w", err)
	}
	if _, err := executableSHA256(previousBinary); err != nil {
		return fmt.Errorf("validate previous binary: %w", err)
	}

	temp, err := os.CreateTemp(installDir, ".hzy-data-runtime-swap-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	if err := os.Remove(tempPath); err != nil {
		return err
	}

	if err := os.Rename(currentBinary, tempPath); err != nil {
		return err
	}
	if err := os.Rename(previousBinary, currentBinary); err != nil {
		restoreErr := os.Rename(tempPath, currentBinary)
		return errors.Join(err, restoreErr)
	}
	if err := os.Rename(tempPath, previousBinary); err != nil {
		moveBackErr := os.Rename(currentBinary, previousBinary)
		restoreErr := os.Rename(tempPath, currentBinary)
		return errors.Join(err, moveBackErr, restoreErr)
	}
	return nil
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

func copyFileAtomic(source string, target string, mode os.FileMode, requireExecutable bool) error {
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".new-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	input, err := os.Open(source)
	if err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := io.Copy(temporary, input); err != nil {
		_ = input.Close()
		_ = temporary.Close()
		return err
	}
	if err := input.Close(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if requireExecutable {
		if _, err := executableSHA256(temporaryPath); err != nil {
			return err
		}
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(target))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
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
