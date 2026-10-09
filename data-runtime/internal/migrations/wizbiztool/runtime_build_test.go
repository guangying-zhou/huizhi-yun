package wizbiztool

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuntimeBuildMetadataFailsClosed(t *testing.T) {
	for _, commit := range []string{"f895fb4b", HistoricalContractGuardCommit} {
		evidence, err := parseRuntimeVersion("hzy-data-runtime 0.3.999 (" + commit + ", 2026-10-04T19:00:00Z)\n")
		if err != nil || evidence.Commit != commit || evidence.Version != "0.3.999" {
			t.Fatal("valid release metadata rejected")
		}
	}
	for _, banner := range []string{"", "hzy-data-runtime dev (unknown, unknown)\n", "hzy-data-runtime 0.3.999 (f895fb4b-dirty, 2026-10-04T19:00:00Z)\n", "hzy-data-runtime 0.3.999 (f895fb4b, 2026-10-04T19:00:00Z)\nextra"} {
		if _, err := parseRuntimeVersion(banner); err != ErrRuntimeBuild {
			t.Fatal("unproven build accepted")
		}
	}
}
func TestHistoricalApplyBuildRecheck(t *testing.T) {
	base := RuntimeBuildEvidence{Version: "0.3.999", Commit: HistoricalContractGuardCommit, BinarySHA256: Digest([]byte("runtime")), HistoricalGuardCommit: HistoricalContractGuardCommit}
	if CheckHistoricalContractApply(base, base) != nil {
		t.Fatal("reviewed build rejected")
	}
	old := base
	old.HistoricalGuardCommit = ""
	if CheckHistoricalContractApply(old, old) != ErrHistoricalGuard {
		t.Fatal("old Runtime accepted")
	}
	for _, change := range []func(*RuntimeBuildEvidence){func(e *RuntimeBuildEvidence) { e.HistoricalGuardCommit = "" }, func(e *RuntimeBuildEvidence) { e.BinarySHA256 = Digest([]byte("replacement")) }, func(e *RuntimeBuildEvidence) { e.Version = "0.3.1000" }, func(e *RuntimeBuildEvidence) { e.Commit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }} {
		current := base
		change(&current)
		if CheckHistoricalContractApply(base, current) == nil {
			t.Fatal("changed target Runtime accepted")
		}
	}
}

func TestHistoricalGuardAncestryNotVersionOrdering(t *testing.T) {
	repository := filepath.Join("..", "..", "..", "..")
	full, guard, err := resolveRuntimeCommit(repository, "f895fb4b")
	if err != nil || !guard || full != HistoricalContractGuardCommit {
		t.Fatal("prerequisite build not recognized")
	}
	command := exec.Command("git", "-C", repository, "rev-parse", HistoricalContractGuardCommit+"^")
	output, err := command.Output()
	if err != nil {
		t.Fatal("prerequisite parent unavailable")
	}
	_, guard, err = resolveRuntimeCommit(repository, strings.TrimSpace(string(output)))
	if err != nil || guard {
		t.Fatal("pre-guard build accepted")
	}
	if _, _, err := resolveRuntimeCommit(repository, "0000000000000000000000000000000000000000"); err != ErrRuntimeBuild {
		t.Fatal("unknown build accepted")
	}
}
