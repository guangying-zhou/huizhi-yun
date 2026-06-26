package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type AuthMode string

const (
	AuthDisabled    AuthMode = "disabled"
	AuthStaticToken AuthMode = "static_token"
	AuthJWT         AuthMode = "jwt"
)

type Config struct {
	Server     ServerConfig `json:"server"`
	Tenant     string       `json:"tenant"`
	Deployment string       `json:"deployment"`
	Auth       AuthConfig   `json:"auth"`
	Apps       AppsConfig   `json:"apps"`
}

type ServerConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type AuthConfig struct {
	Mode        AuthMode  `json:"mode"`
	StaticToken string    `json:"staticToken"`
	JWT         JWTConfig `json:"jwt"`
}

type JWTConfig struct {
	Issuer   string `json:"issuer"`
	Audience string `json:"audience"`
	JWKSURL  string `json:"jwksUrl"`
	JWKSJSON string `json:"jwksJson"`
}

type AppsConfig struct {
	Finance  FinanceConfig  `json:"finance"`
	Workflow WorkflowConfig `json:"workflow"`
	WebDev   WebDevConfig   `json:"webdev"`
	Assets   AssetsConfig   `json:"assets"`
	People   PeopleConfig   `json:"people"`
	Altoc    AltocConfig    `json:"altoc"`
	Aims     AimsConfig     `json:"aims"`
	Codocs   CodocsConfig   `json:"codocs"`
}

type FinanceConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type WorkflowConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type WebDevConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type AssetsConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type PeopleConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type AltocConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type AimsConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type CodocsConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
}

type DBConfig struct {
	Host            string `json:"host"`
	Port            int    `json:"port"`
	User            string `json:"user"`
	Password        string `json:"password"`
	Database        string `json:"database"`
	ConnectionLimit int    `json:"connectionLimit"`
}

func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

func Load() (Config, error) {
	_ = godotenv.Load()

	cfg := Config{
		Server: ServerConfig{
			Host: envString("HZY_DATA_RUNTIME_HOST", "0.0.0.0"),
			Port: envInt("HZY_DATA_RUNTIME_PORT", 8080),
		},
		Tenant:     firstNonEmpty(os.Getenv("HZY_DATA_RUNTIME_TENANT"), os.Getenv("HZY_PLATFORM_TENANT_CODE"), os.Getenv("HZY_TENANT_CODE"), "dev"),
		Deployment: firstNonEmpty(os.Getenv("HZY_DATA_RUNTIME_DEPLOYMENT"), os.Getenv("HZY_PLATFORM_DEPLOYMENT_CODE"), os.Getenv("HZY_DEPLOYMENT_CODE"), "dev"),
		Auth: AuthConfig{
			Mode:        normalizeAuthMode(firstNonEmpty(os.Getenv("HZY_DATA_RUNTIME_AUTH_MODE"), defaultAuthMode())),
			StaticToken: strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_STATIC_TOKEN")),
			JWT: JWTConfig{
				Issuer:   strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_JWT_ISSUER")),
				Audience: envString("HZY_DATA_RUNTIME_JWT_AUDIENCE", "data-runtime"),
				JWKSURL:  strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_JWKS_URL")),
				JWKSJSON: strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_JWKS_JSON")),
			},
		},
		Apps: AppsConfig{
			Finance: FinanceConfig{
				Enabled: envBool("HZY_FINANCE_AGENT_ENABLED", true),
				DB:      appDBConfig("FINANCE", "hzy_finance"),
			},
			Workflow: WorkflowConfig{
				Enabled: envBool("HZY_WORKFLOW_AGENT_ENABLED", false),
				DB:      appDBConfig("WORKFLOW", "hzy_workflow"),
			},
			WebDev: WebDevConfig{
				Enabled: envBool("HZY_WEBDEV_AGENT_ENABLED", false),
				DB:      appDBConfig("WEBDEV", "hzy_webdev"),
			},
			Assets: AssetsConfig{
				Enabled: envBool("HZY_ASSETS_AGENT_ENABLED", false),
				DB:      appDBConfig("ASSETS", "hzy_assets"),
			},
			People: PeopleConfig{
				Enabled: envBool("HZY_PEOPLE_AGENT_ENABLED", false),
				DB:      appDBConfig("PEOPLE", "hzy_people"),
			},
			Altoc: AltocConfig{
				Enabled: envBool("HZY_ALTOC_AGENT_ENABLED", false),
				DB:      appDBConfig("ALTOC", "hzy_altoc"),
			},
			Aims: AimsConfig{
				Enabled: envBool("HZY_AIMS_AGENT_ENABLED", false),
				DB:      appDBConfig("AIMS", "hzy_aims"),
			},
			Codocs: CodocsConfig{
				Enabled: envBool("HZY_CODOCS_AGENT_ENABLED", false),
				DB:      appDBConfig("CODOCS", "hzy_codocs"),
			},
		},
	}

	if path := strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_CONFIG")); path != "" {
		content, err := os.ReadFile(path)
		if err != nil {
			return cfg, err
		}
		if err := json.Unmarshal(content, &cfg); err != nil {
			return cfg, err
		}
	}

	cfg.Auth.Mode = normalizeAuthMode(string(cfg.Auth.Mode))
	if cfg.Auth.JWT.Audience == "" {
		cfg.Auth.JWT.Audience = "data-runtime"
	}
	if cfg.Server.Host == "" {
		cfg.Server.Host = "0.0.0.0"
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	normalizeDBConfig(&cfg.Apps.Finance.DB)
	normalizeDBConfig(&cfg.Apps.Workflow.DB)
	normalizeDBConfig(&cfg.Apps.WebDev.DB)
	normalizeDBConfig(&cfg.Apps.Assets.DB)
	normalizeDBConfig(&cfg.Apps.People.DB)
	normalizeDBConfig(&cfg.Apps.Altoc.DB)
	normalizeDBConfig(&cfg.Apps.Aims.DB)
	normalizeDBConfig(&cfg.Apps.Codocs.DB)
	return cfg, nil
}

func normalizeDBConfig(cfg *DBConfig) {
	if cfg.Port == 0 {
		cfg.Port = 3306
	}
	if cfg.ConnectionLimit == 0 {
		cfg.ConnectionLimit = 5
	}
}

func appDBConfig(appCode string, defaultDatabase string) DBConfig {
	prefix := "HZY_" + strings.ToUpper(appCode) + "_DB_"
	return DBConfig{
		Host:            firstNonEmpty(os.Getenv(prefix+"HOST"), os.Getenv("HZY_DATA_RUNTIME_DB_HOST"), os.Getenv("DB_HOST"), "127.0.0.1"),
		Port:            envIntFallback([]string{prefix + "PORT", "HZY_DATA_RUNTIME_DB_PORT", "DB_PORT"}, 3306),
		User:            firstNonEmpty(os.Getenv(prefix+"USER"), os.Getenv("HZY_DATA_RUNTIME_DB_USER"), os.Getenv("DB_USER"), "root"),
		Password:        envStringFallback([]string{prefix + "PASSWORD", "HZY_DATA_RUNTIME_DB_PASSWORD", "DB_PASSWORD"}),
		Database:        firstNonEmpty(os.Getenv(prefix+"NAME"), os.Getenv("DB_NAME"), defaultDatabase),
		ConnectionLimit: envIntFallback([]string{prefix + "CONNECTION_LIMIT", "HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT", "DB_CONNECTION_LIMIT"}, 5),
	}
}

func defaultAuthMode() string {
	if strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_STATIC_TOKEN")) != "" {
		return string(AuthStaticToken)
	}
	return string(AuthDisabled)
}

func normalizeAuthMode(value string) AuthMode {
	switch AuthMode(strings.TrimSpace(value)) {
	case AuthJWT:
		return AuthJWT
	case AuthStaticToken:
		return AuthStaticToken
	default:
		return AuthDisabled
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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

func envIntFallback(names []string, fallback int) int {
	for _, name := range names {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return envInt(name, fallback)
		}
	}
	return fallback
}

func envStringFallback(names []string) string {
	for _, name := range names {
		if value, ok := os.LookupEnv(name); ok {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func envBool(name string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return fallback
	}
	return value != "0" && value != "false" && value != "no" && value != "off"
}
