package config

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type AuthMode string

const (
	AuthDisabled    AuthMode = "disabled"
	AuthStaticToken AuthMode = "static_token"
	AuthJWT         AuthMode = "jwt"
)

type Config struct {
	Host       string
	Port       string
	Tenant     string
	Deployment string
	PublicURL  string
	Auth       AuthConfig
	Console    ConsoleConfig
	HTTP       HTTPConfig
	Update     UpdateConfig
}

type AuthConfig struct {
	Mode        AuthMode
	StaticToken string
	JWT         JWTConfig
}

type JWTConfig struct {
	Audience string
	Issuer   string
	JWKSURL  string
	JWKSJSON string
}

type ConsoleConfig struct {
	BaseURL      string
	TokenURL     string
	ClientID     string
	ClientSecret string
	Timeout      time.Duration
}

type HTTPConfig struct {
	ReadHeaderTimeout time.Duration
	RequestTimeout    time.Duration
}

type UpdateConfig struct {
	PackageBaseURL string
	ServiceName    string
}

type fileConfig struct {
	Host       string         `json:"host"`
	Port       string         `json:"port"`
	Tenant     string         `json:"tenant"`
	Deployment string         `json:"deployment"`
	PublicURL  string         `json:"publicUrl"`
	Auth       authFileConfig `json:"auth"`
	Console    consoleFile    `json:"console"`
	Update     updateFile     `json:"update"`
}

type authFileConfig struct {
	Mode        string `json:"mode"`
	StaticToken string `json:"staticToken"`
	JWT         struct {
		Audience string `json:"audience"`
		Issuer   string `json:"issuer"`
		JWKSURL  string `json:"jwksUrl"`
		JWKSJSON string `json:"jwksJson"`
	} `json:"jwt"`
}

type consoleFile struct {
	BaseURL      string `json:"baseUrl"`
	TokenURL     string `json:"tokenUrl"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	TimeoutMs    int    `json:"timeoutMs"`
}

type updateFile struct {
	PackageBaseURL string `json:"packageBaseUrl"`
	ServiceName    string `json:"serviceName"`
}

func Load() Config {
	_ = godotenv.Load()

	file := loadFile(env("HZY_NOTIFICATION_RUNTIME_CONFIG", ""))
	consoleBase := trimSlash(first(
		env("HZY_CONSOLE_API_URL", ""),
		env("HZY_CONSOLE_URL", ""),
		file.Console.BaseURL,
	))
	jwksURL := first(
		env("HZY_NOTIFICATION_RUNTIME_JWKS_URL", ""),
		file.Auth.JWT.JWKSURL,
	)
	issuer := trimSlash(first(
		env("HZY_NOTIFICATION_RUNTIME_JWT_ISSUER", ""),
		file.Auth.JWT.Issuer,
		consoleBase,
	))
	mode := AuthMode(first(
		env("HZY_NOTIFICATION_RUNTIME_AUTH_MODE", ""),
		file.Auth.Mode,
	))
	staticToken := first(env("HZY_NOTIFICATION_RUNTIME_STATIC_TOKEN", ""), file.Auth.StaticToken)
	if mode == "" {
		switch {
		case staticToken != "":
			mode = AuthStaticToken
		case jwksURL != "" || file.Auth.JWT.JWKSJSON != "" || env("HZY_NOTIFICATION_RUNTIME_JWKS_JSON", "") != "":
			mode = AuthJWT
		default:
			mode = AuthDisabled
		}
	}

	return Config{
		Host:       first(env("HZY_NOTIFICATION_RUNTIME_HOST", ""), file.Host, "0.0.0.0"),
		Port:       first(env("HZY_NOTIFICATION_RUNTIME_PORT", ""), file.Port, "18081"),
		Tenant:     first(env("HZY_NOTIFICATION_RUNTIME_TENANT", ""), env("HZY_TENANT", ""), file.Tenant),
		Deployment: first(env("HZY_NOTIFICATION_RUNTIME_DEPLOYMENT", ""), env("HZY_DEPLOYMENT", ""), file.Deployment),
		PublicURL:  trimSlash(first(env("HZY_NOTIFICATION_RUNTIME_PUBLIC_URL", ""), file.PublicURL)),
		Auth: AuthConfig{
			Mode:        mode,
			StaticToken: staticToken,
			JWT: JWTConfig{
				Audience: first(env("HZY_NOTIFICATION_RUNTIME_AUDIENCE", ""), file.Auth.JWT.Audience, "notification-runtime"),
				Issuer:   issuer,
				JWKSURL:  jwksURL,
				JWKSJSON: first(env("HZY_NOTIFICATION_RUNTIME_JWKS_JSON", ""), file.Auth.JWT.JWKSJSON),
			},
		},
		Console: ConsoleConfig{
			BaseURL: trimSlash(consoleBase),
			TokenURL: first(
				env("HZY_CONSOLE_TOKEN_URL", ""),
				file.Console.TokenURL,
				appendPath(consoleBase, "/oauth/token"),
			),
			ClientID: first(
				env("HZY_NOTIFICATION_RUNTIME_CLIENT_ID", ""),
				env("HZY_SERVICE_CLIENT_ID", ""),
				file.Console.ClientID,
			),
			ClientSecret: first(
				env("HZY_NOTIFICATION_RUNTIME_CLIENT_SECRET", ""),
				env("HZY_SERVICE_CLIENT_SECRET", ""),
				file.Console.ClientSecret,
			),
			Timeout: millis(firstInt(
				env("HZY_NOTIFICATION_RUNTIME_CONSOLE_TIMEOUT_MS", ""),
				file.Console.TimeoutMs,
				10000,
			)),
		},
		HTTP: HTTPConfig{
			ReadHeaderTimeout: 5 * time.Second,
			RequestTimeout:    millis(firstInt(env("HZY_NOTIFICATION_RUNTIME_REQUEST_TIMEOUT_MS", ""), 0, 15000)),
		},
		Update: UpdateConfig{
			PackageBaseURL: trimSlash(first(
				env("HZY_NOTIFICATION_RUNTIME_PACKAGE_BASE_URL", ""),
				file.Update.PackageBaseURL,
				"https://downloads.huizhi.yun/packages/hzy-notification-runtime",
			)),
			ServiceName: first(
				env("HZY_NOTIFICATION_RUNTIME_SERVICE_NAME", ""),
				file.Update.ServiceName,
				"hzy-notification-runtime",
			),
		},
	}
}

func loadFile(path string) fileConfig {
	if path == "" {
		return fileConfig{}
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return fileConfig{}
	}
	var cfg fileConfig
	_ = json.Unmarshal(body, &cfg)
	return cfg
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func first(values ...string) string {
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized != "" {
			return normalized
		}
	}
	return ""
}

func firstInt(envValue string, fileValue int, fallback int) int {
	if envValue != "" {
		if value, err := strconv.Atoi(envValue); err == nil {
			return value
		}
	}
	if fileValue > 0 {
		return fileValue
	}
	return fallback
}

func millis(value int) time.Duration {
	if value <= 0 {
		return 0
	}
	return time.Duration(value) * time.Millisecond
}

func trimSlash(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

func appendPath(base string, path string) string {
	base = trimSlash(base)
	if base == "" {
		return ""
	}
	return base + "/" + strings.TrimLeft(path, "/")
}
