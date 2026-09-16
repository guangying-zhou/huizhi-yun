package config

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	AgentID   string            `json:"agentId"`
	Server    ServerConfig      `json:"server"`
	Auth      AuthConfig        `json:"auth"`
	Repos     []RepoConfig      `json:"repos"`
	Templates []TemplateConfig  `json:"templates"`
	Settings  map[string]string `json:"settings"`
}

type ServerConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type AuthConfig struct {
	StaticToken string `json:"staticToken"`
}

type RepoConfig struct {
	ID            string `json:"id"`
	Path          string `json:"path"`
	DefaultBranch string `json:"defaultBranch"`
}

type TemplateConfig struct {
	ID                 string            `json:"id"`
	Type               string            `json:"type"`
	RepoID             string            `json:"repoId"`
	CWD                string            `json:"cwd"`
	Runner             string            `json:"runner"`
	CodexSandboxPolicy string            `json:"codexSandboxPolicy"`
	Argv               []string          `json:"argv"`
	Environment        map[string]string `json:"environment"`
	TimeoutSec         int               `json:"timeoutSec"`
}

func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

func Load() (Config, error) {
	_ = loadDotEnv(".env")
	configDir := ""

	cfg := Config{
		AgentID: envString("HZY_DEV_AGENT_ID", "local-dev-agent"),
		Server: ServerConfig{
			Host: envString("HZY_DEV_AGENT_HOST", "127.0.0.1"),
			Port: envInt("HZY_DEV_AGENT_PORT", 19090),
		},
		Auth: AuthConfig{
			StaticToken: strings.TrimSpace(os.Getenv("HZY_DEV_AGENT_TOKEN")),
		},
		Settings: map[string]string{},
	}

	if path := strings.TrimSpace(os.Getenv("HZY_DEV_AGENT_CONFIG")); path != "" {
		absConfigPath, err := filepath.Abs(path)
		if err != nil {
			return cfg, err
		}
		configDir = filepath.Dir(absConfigPath)
		content, err := os.ReadFile(path)
		if err != nil {
			return cfg, err
		}
		if err := json.Unmarshal(content, &cfg); err != nil {
			return cfg, err
		}
	}

	if cfg.AgentID == "" {
		cfg.AgentID = "local-dev-agent"
	}
	if cfg.Server.Host == "" {
		cfg.Server.Host = "127.0.0.1"
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 19090
	}
	if token := strings.TrimSpace(os.Getenv("HZY_DEV_AGENT_TOKEN")); token != "" {
		cfg.Auth.StaticToken = token
	}
	if len(cfg.Repos) == 0 {
		defaultRepo := strings.TrimSpace(os.Getenv("HZY_DEV_AGENT_REPO_PATH"))
		if defaultRepo != "" {
			cfg.Repos = append(cfg.Repos, RepoConfig{
				ID:            envString("HZY_DEV_AGENT_REPO_ID", filepath.Base(defaultRepo)),
				Path:          defaultRepo,
				DefaultBranch: envString("HZY_DEV_AGENT_REPO_DEFAULT_BRANCH", "main"),
			})
		}
	}
	if cfg.Settings == nil {
		cfg.Settings = map[string]string{}
	}
	if err := resolveRepoPaths(&cfg, configDir); err != nil {
		return cfg, err
	}
	return cfg, validate(cfg)
}

func resolveRepoPaths(cfg *Config, configDir string) error {
	baseDir := configDir
	if baseDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		baseDir = cwd
	}
	for index := range cfg.Repos {
		path := strings.TrimSpace(os.ExpandEnv(cfg.Repos[index].Path))
		if path == "" {
			continue
		}
		if !filepath.IsAbs(path) {
			path = filepath.Join(baseDir, path)
		}
		absPath, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("resolve repo path %s: %w", cfg.Repos[index].Path, err)
		}
		cfg.Repos[index].Path = filepath.Clean(absPath)
	}
	return nil
}

func validate(cfg Config) error {
	repoIDs := map[string]bool{}
	for _, repo := range cfg.Repos {
		if strings.TrimSpace(repo.ID) == "" {
			return fmt.Errorf("repo id is required")
		}
		if strings.TrimSpace(repo.Path) == "" {
			return fmt.Errorf("repo path is required for repo %s", repo.ID)
		}
		absPath, err := filepath.Abs(repo.Path)
		if err != nil {
			return fmt.Errorf("resolve repo path %s: %w", repo.Path, err)
		}
		info, err := os.Stat(absPath)
		if err != nil {
			return fmt.Errorf("repo path %s is not accessible: %w", absPath, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("repo path %s is not a directory", absPath)
		}
		repoIDs[repo.ID] = true
	}

	for _, template := range cfg.Templates {
		if strings.TrimSpace(template.ID) == "" {
			return fmt.Errorf("template id is required")
		}
		if strings.TrimSpace(template.Type) == "" {
			return fmt.Errorf("template type is required for %s", template.ID)
		}
		if strings.TrimSpace(template.RepoID) == "" || !repoIDs[template.RepoID] {
			return fmt.Errorf("template %s references unknown repo %s", template.ID, template.RepoID)
		}
		runner := strings.TrimSpace(template.Runner)
		if runner != "" && runner != "command" && runner != "codex_app_server" {
			return fmt.Errorf("template %s runner %s is not supported", template.ID, runner)
		}
		sandboxPolicy := strings.TrimSpace(template.CodexSandboxPolicy)
		if sandboxPolicy != "" && sandboxPolicy != "workspaceWrite" && sandboxPolicy != "workspace-write" && sandboxPolicy != "dangerFullAccess" && sandboxPolicy != "danger-full-access" {
			return fmt.Errorf("template %s codexSandboxPolicy %s is not supported", template.ID, sandboxPolicy)
		}
		if len(template.Argv) == 0 {
			return fmt.Errorf("template %s argv is required", template.ID)
		}
	}

	return nil
}

func loadDotEnv(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		index := strings.Index(line, "=")
		if index <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:index])
		value := strings.TrimSpace(line[index+1:])
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if len(value) >= 2 {
			quote := value[0]
			if (quote == '"' || quote == '\'') && value[len(value)-1] == quote {
				value = value[1 : len(value)-1]
			}
		}
		_ = os.Setenv(key, value)
	}
	return scanner.Err()
}

func envString(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
