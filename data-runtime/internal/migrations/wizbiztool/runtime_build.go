package wizbiztool

import (
	"bytes"
	"context"
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const HistoricalContractGuardCommit = "f895fb4bf59783a0e72049fa5dabb9f5881d885d"

var ErrRuntimeBuild = errors.New("runtime_build_unverified")
var ErrHistoricalGuard = errors.New("historical_contract_guard_missing")

// RuntimeBuildEvidence is part of the reviewed plan. A release number alone
// cannot prove the guard: the exact target executable and reviewed source commit
// are bound, and commit ancestry is checked against the local reviewed source.
type RuntimeBuildEvidence struct {
	Version               string `json:"version"`
	Commit                string `json:"commit"`
	BinarySHA256          string `json:"binarySha256"`
	HistoricalGuardCommit string `json:"historicalGuardCommit,omitempty"`
}

// ReadTargetRuntimeBuild inspects the protected executable using its version-only branch, without
// contacting a running service or initializing Runtime configuration. Symlinks and group/world writable files
// are rejected. The caller selects the installed executable, not this tool's
// own version or a freely asserted profile version.
func ReadTargetRuntimeBuild(binary, repository string) (RuntimeBuildEvidence, error) {
	fd, err := syscall.Open(binary, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	file := os.NewFile(uintptr(fd), binary)
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 || info.Size() < 1 || info.Size() > 256<<20 {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || (stat.Uid != 0 && int(stat.Uid) != os.Geteuid()) {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	build, err := buildinfo.Read(file)
	if err != nil || build.Path != "github.com/huizhi-yun/data-runtime/cmd/hzy-data-runtime" {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	// The reviewed release builder intentionally disables VCS stamping. The
	// existing --version branch exits before config/DB/service initialization.
	// Use it for both build styles; never fall back to this migration tool's build.
	evidence, err := readRuntimeVersion(binary)
	if err != nil {
		return RuntimeBuildEvidence{}, err
	}
	for _, setting := range build.Settings {
		if setting.Key == "vcs.modified" && setting.Value == "true" {
			return RuntimeBuildEvidence{}, ErrRuntimeBuild
		}
		if setting.Key == "vcs.revision" && !strings.HasPrefix(setting.Value, evidence.Commit) {
			return RuntimeBuildEvidence{}, ErrRuntimeBuild
		}
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	evidence.BinarySHA256 = hex.EncodeToString(hash.Sum(nil))
	after, err := os.Lstat(binary)
	if err != nil || !os.SameFile(info, after) || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	if repository == "" {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	// An absent/shallow/unknown commit is not evidence of an old safe build.
	// Neither release-number ordering nor an externally claimed feature flag is
	// a substitute for ancestry of the frozen prerequisite commit.
	full, contains, err := resolveRuntimeCommit(repository, evidence.Commit)
	if err != nil {
		return RuntimeBuildEvidence{}, err
	}
	evidence.Commit = full
	if contains {
		evidence.HistoricalGuardCommit = HistoricalContractGuardCommit
	}

	return evidence, nil
}

func resolveRuntimeCommit(repository, commit string) (string, bool, error) {
	if repository == "" || !regexp.MustCompile(`^[0-9a-f]{7,40}$`).MatchString(commit) {
		return "", false, ErrRuntimeBuild
	}
	resolved := exec.Command("git", "-C", repository, "rev-parse", "--verify", commit+"^{commit}")
	full, err := resolved.Output()
	if err != nil {
		return "", false, ErrRuntimeBuild
	}
	revision := strings.TrimSpace(string(full))
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(revision) {
		return "", false, ErrRuntimeBuild
	}
	ancestry := exec.Command("git", "-C", repository, "merge-base", "--is-ancestor", HistoricalContractGuardCommit, revision)
	if err := ancestry.Run(); err == nil {
		return revision, true, nil
	} else {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 {
			return "", false, ErrRuntimeBuild
		}
	}
	return revision, false, nil
}

type boundedVersionOutput struct{ bytes.Buffer }

func (w *boundedVersionOutput) Write(p []byte) (int, error) {
	if w.Len()+len(p) > 1024 {
		return 0, ErrRuntimeBuild
	}
	return w.Buffer.Write(p)
}
func readRuntimeVersion(binary string) (RuntimeBuildEvidence, error) {
	if !filepath.IsAbs(binary) {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "--version")
	command.Env = []string{"LANG=C", "LC_ALL=C"}
	command.Dir = filepath.Dir(binary)
	var output boundedVersionOutput
	command.Stdout = &output
	command.Stderr = io.Discard
	if command.Run() != nil {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	return parseRuntimeVersion(output.String())
}
func parseRuntimeVersion(banner string) (RuntimeBuildEvidence, error) {
	match := regexp.MustCompile(`^hzy-data-runtime ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?) \(([0-9a-f]{7,40}), ([0-9TZ:._+-]+)\)\n$`).FindStringSubmatch(banner)
	if len(match) != 4 {
		return RuntimeBuildEvidence{}, ErrRuntimeBuild
	}
	return RuntimeBuildEvidence{Version: match[1], Commit: match[2]}, nil
}

// CheckHistoricalContractApply must run before any contract-stage writes,
// including resumed apply. Both the reviewed build and the freshly inspected
// installed executable must contain the guard and match byte-for-byte.
func CheckHistoricalContractApply(planned, current RuntimeBuildEvidence) error {
	if planned.HistoricalGuardCommit != HistoricalContractGuardCommit || current.HistoricalGuardCommit != HistoricalContractGuardCommit {
		return ErrHistoricalGuard
	}
	if !validHash(planned.BinarySHA256) || !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(planned.Commit) || planned.Version == "" || planned != current {
		return ErrRuntimeBuild
	}
	return nil
}
