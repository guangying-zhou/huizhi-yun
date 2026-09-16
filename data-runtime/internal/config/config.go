package config

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	Server             ServerConfig      `json:"server"`
	Tenant             string            `json:"tenant"`
	Deployment         string            `json:"deployment"`
	DeploymentBindings map[string]string `json:"deploymentBindings"`
	Control            ControlConfig     `json:"control"`
	Auth               AuthConfig        `json:"auth"`
	Apps               AppsConfig        `json:"apps"`
}

type ControlConfig struct {
	ConfigDir                string `json:"-"`
	PlatformURL              string `json:"platformUrl"`
	RuntimeCode              string `json:"runtimeCode"`
	Token                    string `json:"token"`
	RuntimeEndpoint          string `json:"runtimeEndpoint"`
	ReleaseSigningKeyID      string `json:"releaseSigningKeyId"`
	PlatformSigningKeyID     string `json:"platformSigningKeyId"`
	PlatformSigningPublicKey string `json:"-"`
}

type platformSigningKeyOverlay struct {
	KID       string `json:"kid"`
	Algorithm string `json:"alg"`
	PublicKey string `json:"publicKey"`
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

type jwtTrustOverlay struct {
	SchemaVersion string `json:"schemaVersion"`
	Issuer        string `json:"issuer"`
	Audience      string `json:"audience"`
	JWKSURL       string `json:"jwksUrl"`
}

type AppsConfig struct {
	Console   ConsoleConfig   `json:"console"`
	Directory DirectoryConfig `json:"directory"`
	Finance   FinanceConfig   `json:"finance"`
	Workflow  WorkflowConfig  `json:"workflow"`
	WebDev    WebDevConfig    `json:"webdev"`
	Assets    AssetsConfig    `json:"assets"`
	People    PeopleConfig    `json:"people"`
	Altoc     AltocConfig     `json:"altoc"`
	Aims      AimsConfig      `json:"aims"`
	Codocs    CodocsConfig    `json:"codocs"`
}

type ConsoleConfig struct {
	Enabled            bool     `json:"enabled"`
	DB                 DBConfig `json:"db"`
	VaultMasterKey     string   `json:"-"`
	VaultMasterKeyFile string   `json:"-"`
}

type DirectoryConfig struct {
	Enabled bool     `json:"enabled"`
	DB      DBConfig `json:"db"`
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
	configDir := envString("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime")

	cfg := Config{
		Server: ServerConfig{
			Host: envString("HZY_DATA_RUNTIME_HOST", "0.0.0.0"),
			Port: envInt("HZY_DATA_RUNTIME_PORT", 8080),
		},
		Tenant:             firstNonEmpty(os.Getenv("HZY_DATA_RUNTIME_TENANT"), os.Getenv("HZY_PLATFORM_TENANT_CODE"), os.Getenv("HZY_TENANT_CODE"), "dev"),
		Deployment:         firstNonEmpty(os.Getenv("HZY_DATA_RUNTIME_DEPLOYMENT"), os.Getenv("HZY_PLATFORM_DEPLOYMENT_CODE"), os.Getenv("HZY_DEPLOYMENT_CODE"), "dev"),
		DeploymentBindings: deploymentBindingsFromEnv(),
		Control: ControlConfig{
			ConfigDir:           configDir,
			PlatformURL:         strings.TrimRight(strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_PLATFORM_URL")), "/"),
			RuntimeCode:         firstNonEmpty(os.Getenv("HZY_DATA_RUNTIME_INSTANCE"), os.Getenv("HZY_DATA_RUNTIME_DEPLOYMENT")),
			Token:               strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_CONTROL_TOKEN")),
			RuntimeEndpoint:     strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_PUBLIC_ENDPOINT")),
			ReleaseSigningKeyID: strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID")),
			PlatformSigningKeyID: strings.TrimSpace(
				os.Getenv("HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID"),
			),
			PlatformSigningPublicKey: decodedEnvString(
				"HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64",
			),
		},
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
			Console: ConsoleConfig{
				Enabled: envBool("HZY_CONSOLE_RUNTIME_ENABLED", false),
				DB:      appDBConfig("CONSOLE", "hzy_console"),
				VaultMasterKeyFile: firstNonEmpty(
					os.Getenv("HZY_CONSOLE_VAULT_MASTER_KEY_FILE"),
					filepath.Join(envString("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime"), "console-vault-master-key"),
				),
			},
			Directory: DirectoryConfig{
				Enabled: envBool("HZY_DIRECTORY_RUNTIME_ENABLED", false),
				DB:      appDBConfig("DIRECTORY", "hzy_console"),
			},
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
	if cfg.Control.ConfigDir == "" {
		cfg.Control.ConfigDir = configDir
	}

	if overlay, ok, err := loadPlatformSigningKeyOverlay(
		filepath.Join(cfg.Control.ConfigDir, "platform-signing-key.json"),
	); err != nil {
		return cfg, err
	} else if ok {
		cfg.Control.PlatformSigningKeyID = overlay.KID
		cfg.Control.PlatformSigningPublicKey = overlay.PublicKey
	}
	if overlay, ok, err := loadJWTTrustOverlay(
		filepath.Join(cfg.Control.ConfigDir, "auth-jwt-trust.json"),
	); err != nil {
		return cfg, err
	} else if ok {
		cfg.Auth.JWT.Issuer = overlay.Issuer
		cfg.Auth.JWT.Audience = overlay.Audience
		cfg.Auth.JWT.JWKSURL = overlay.JWKSURL
		cfg.Auth.JWT.JWKSJSON = ""
	}

	if _, bound := cfg.DeploymentBindings["console"]; bound {
		cfg.Apps.Console.Enabled = true
	}
	cfg.Apps.Console.VaultMasterKey = strings.TrimSpace(os.Getenv("HZY_CONSOLE_VAULT_MASTER_KEY"))
	if cfg.Apps.Console.VaultMasterKey == "" {
		content, err := os.ReadFile(cfg.Apps.Console.VaultMasterKeyFile)
		if err == nil {
			cfg.Apps.Console.VaultMasterKey = strings.TrimSpace(string(content))
		} else if !os.IsNotExist(err) {
			return cfg, fmt.Errorf("read Console Vault master key file: %w", err)
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
	normalizeDBConfig(&cfg.Apps.Console.DB)
	normalizeDBConfig(&cfg.Apps.Directory.DB)
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

func PersistJWTTrustOverlay(configDir string, trust JWTConfig) error {
	dir := strings.TrimSpace(configDir)
	if dir == "" {
		return fmt.Errorf("JWT trust config directory is required")
	}
	overlay := jwtTrustOverlay{
		SchemaVersion: "data-runtime-jwt-trust.v1",
		Issuer:        strings.TrimRight(strings.TrimSpace(trust.Issuer), "/"),
		Audience:      strings.TrimSpace(trust.Audience),
		JWKSURL:       strings.TrimSpace(trust.JWKSURL),
	}
	if overlay.Issuer == "" || overlay.Audience == "" || overlay.JWKSURL == "" {
		return fmt.Errorf("JWT trust overlay is incomplete")
	}
	content, err := json.Marshal(overlay)
	if err != nil {
		return fmt.Errorf("encode JWT trust overlay: %w", err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create JWT trust config directory: %w", err)
	}
	temp, err := os.CreateTemp(dir, ".auth-jwt-trust-*.tmp")
	if err != nil {
		return fmt.Errorf("create JWT trust overlay: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return fmt.Errorf("secure JWT trust overlay: %w", err)
	}
	if _, err := temp.Write(append(content, '\n')); err != nil {
		temp.Close()
		return fmt.Errorf("write JWT trust overlay: %w", err)
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return fmt.Errorf("sync JWT trust overlay: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close JWT trust overlay: %w", err)
	}
	if err := os.Rename(tempPath, filepath.Join(dir, "auth-jwt-trust.json")); err != nil {
		return fmt.Errorf("activate JWT trust overlay: %w", err)
	}
	return nil
}

func (c Config) DeploymentForApp(appCode string) string {
	normalizedAppCode := strings.ToLower(strings.TrimSpace(appCode))
	if value := strings.TrimSpace(c.DeploymentBindings[normalizedAppCode]); value != "" {
		return value
	}
	// Connector Runtime is a Console-enrolled supporting service rather than a
	// separately deployed tenant application. Its service credential is bound
	// to the owning Console deployment, so direct Tenant Runtime calls must use
	// that enrolled deployment while retaining connector-runtime as source_app.
	if normalizedAppCode == "connector-runtime" {
		if value := strings.TrimSpace(c.DeploymentBindings["console"]); value != "" {
			return value
		}
	}
	return c.Deployment
}

func deploymentBindingsFromEnv() map[string]string {
	bindings := map[string]string{}
	configDir := envString("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime")
	if content, err := os.ReadFile(filepath.Join(configDir, "deployment-bindings.json")); err == nil {
		_ = json.Unmarshal(content, &bindings)
	}
	encoded := strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64"))
	if encoded == "" {
		return bindings
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return bindings
	}
	enrolledBindings := map[string]string{}
	if err := json.Unmarshal(content, &enrolledBindings); err != nil {
		return bindings
	}
	for appCode, deploymentCode := range enrolledBindings {
		bindings[strings.ToLower(strings.TrimSpace(appCode))] = strings.TrimSpace(deploymentCode)
	}
	return bindings
}

func loadPlatformSigningKeyOverlay(path string) (platformSigningKeyOverlay, bool, error) {
	content, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return platformSigningKeyOverlay{}, false, nil
	}
	if err != nil {
		return platformSigningKeyOverlay{}, false, fmt.Errorf("read Platform signing key overlay: %w", err)
	}
	var overlay platformSigningKeyOverlay
	if err := json.Unmarshal(content, &overlay); err != nil {
		return platformSigningKeyOverlay{}, false, fmt.Errorf("decode Platform signing key overlay: %w", err)
	}
	overlay.KID = strings.TrimSpace(overlay.KID)
	overlay.Algorithm = strings.TrimSpace(overlay.Algorithm)
	overlay.PublicKey = strings.TrimSpace(overlay.PublicKey)
	if overlay.KID == "" || overlay.Algorithm != "Ed25519" || overlay.PublicKey == "" {
		return platformSigningKeyOverlay{}, false, fmt.Errorf("Platform signing key overlay is invalid")
	}
	return overlay, true, nil
}

func loadJWTTrustOverlay(path string) (jwtTrustOverlay, bool, error) {
	content, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return jwtTrustOverlay{}, false, nil
	}
	if err != nil {
		return jwtTrustOverlay{}, false, fmt.Errorf("read JWT trust overlay: %w", err)
	}
	var overlay jwtTrustOverlay
	if err := json.Unmarshal(content, &overlay); err != nil {
		return jwtTrustOverlay{}, false, fmt.Errorf("decode JWT trust overlay: %w", err)
	}
	overlay.SchemaVersion = strings.TrimSpace(overlay.SchemaVersion)
	overlay.Issuer = strings.TrimRight(strings.TrimSpace(overlay.Issuer), "/")
	overlay.Audience = strings.TrimSpace(overlay.Audience)
	overlay.JWKSURL = strings.TrimSpace(overlay.JWKSURL)
	if overlay.SchemaVersion != "data-runtime-jwt-trust.v1" ||
		overlay.Issuer == "" || overlay.Audience == "" || overlay.JWKSURL == "" {
		return jwtTrustOverlay{}, false, fmt.Errorf("JWT trust overlay is invalid")
	}
	return overlay, true, nil
}

func decodedEnvString(name string) string {
	encoded := strings.TrimSpace(os.Getenv(name))
	if encoded == "" {
		return ""
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(content))
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
