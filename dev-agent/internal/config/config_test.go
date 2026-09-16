package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRepoPathsUsesConfigDirectory(t *testing.T) {
	root := t.TempDir()
	repoDir := filepath.Join(root, "huizhi-yun")
	configDir := filepath.Join(repoDir, "dev-agent")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	cfg := Config{
		Repos: []RepoConfig{
			{
				ID:            "huizhi-yun",
				Path:          "..",
				DefaultBranch: "main",
			},
		},
	}

	if err := resolveRepoPaths(&cfg, configDir); err != nil {
		t.Fatalf("resolve repo paths: %v", err)
	}
	if cfg.Repos[0].Path != repoDir {
		t.Fatalf("expected %q, got %q", repoDir, cfg.Repos[0].Path)
	}
	if err := validate(cfg); err != nil {
		t.Fatalf("validate resolved config: %v", err)
	}
}

func TestValidateRejectsUnsupportedTemplateRunner(t *testing.T) {
	repoDir := t.TempDir()
	cfg := Config{
		Repos: []RepoConfig{
			{ID: "repo", Path: repoDir, DefaultBranch: "main"},
		},
		Templates: []TemplateConfig{
			{ID: "bad", Type: "codex_task", RepoID: "repo", Runner: "unknown", Argv: []string{"codex"}},
		},
	}

	if err := validate(cfg); err == nil {
		t.Fatalf("expected unsupported runner validation error")
	}
}

func TestValidateRejectsUnsupportedCodexSandboxPolicy(t *testing.T) {
	repoDir := t.TempDir()
	cfg := Config{
		Repos: []RepoConfig{
			{ID: "repo", Path: repoDir, DefaultBranch: "main"},
		},
		Templates: []TemplateConfig{
			{ID: "bad", Type: "codex_task", RepoID: "repo", Runner: "codex_app_server", CodexSandboxPolicy: "full", Argv: []string{"codex"}},
		},
	}

	if err := validate(cfg); err == nil {
		t.Fatalf("expected unsupported codex sandbox policy validation error")
	}
}
