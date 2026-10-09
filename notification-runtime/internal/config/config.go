package config

import (
	"encoding/json"
	"os"
	"path/filepath"
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
	RuntimeID  string
	Auth       AuthConfig
	Console    ConsoleConfig
	HTTP       HTTPConfig
	Update     UpdateConfig
	Delivery   DeliveryStoreConfig
	PeopleSync PeopleSyncConfig
}

type PeopleSyncConfig struct {
	RuntimeURL     string
	PrivateKeyFile string
}

type AuthConfig struct {
	Mode                          AuthMode
	StaticToken                   string
	JWT                           JWTConfig
	AllowTenantServiceDeployments bool
}

type JWTConfig struct {
	Audience string
	Issuer   string
	JWKSURL  string
	JWKSJSON string
}

type ConsoleConfig struct {
	BaseURL      string
	ServiceURL   string
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
	PackageBaseURL       string
	ReleasePublicKeyFile string
	ServiceName          string
	InstallDir           string
	BinaryName           string
	ProductName          string
}

type DeliveryStoreConfig struct {
	Type            string
	SQLitePath      string
	Host            string
	Port            int
	User            string
	Password        string
	Database        string
	ConnectionLimit int
	LeaseDuration   time.Duration
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
	Delivery   deliveryFile   `json:"deliveryStore"`
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
	ServiceURL   string `json:"serviceUrl"`
	TokenURL     string `json:"tokenUrl"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	TimeoutMs    int    `json:"timeoutMs"`
}

type updateFile struct {
	PackageBaseURL string `json:"packageBaseUrl"`
	ServiceName    string `json:"serviceName"`
	InstallDir     string `json:"installDir"`
}

type deliveryFile struct {
	Type            string `json:"type"`
	SQLitePath      string `json:"sqlitePath"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	User            string `json:"user"`
	Password        string `json:"password"`
	Database        string `json:"database"`
	ConnectionLimit int    `json:"connectionLimit"`
	LeaseMs         int    `json:"leaseMs"`
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
	installDir := first(
		env("HZY_NOTIFICATION_RUNTIME_INSTALL_DIR", ""),
		file.Update.InstallDir,
		"/opt/hzy/notification-runtime",
	)
	deliveryStoreType := strings.ToLower(first(
		env("HZY_NOTIFICATION_RUNTIME_STORE", ""),
		file.Delivery.Type,
	))
	if deliveryStoreType == "" {
		if first(env("HZY_NOTIFICATION_RUNTIME_DB_HOST", ""), file.Delivery.Host) != "" ||
			first(env("HZY_NOTIFICATION_RUNTIME_DB_USER", ""), file.Delivery.User) != "" {
			deliveryStoreType = "mysql"
		} else {
			deliveryStoreType = "sqlite"
		}
	}
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
		RuntimeID:  first(env("HZY_NOTIFICATION_RUNTIME_ID", ""), "notification-runtime"),
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
			BaseURL:    trimSlash(consoleBase),
			ServiceURL: trimSlash(first(env("HZY_NOTIFICATION_RUNTIME_DATA_RUNTIME_URL", ""), file.Console.ServiceURL)),
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
			ReleasePublicKeyFile: env("HZY_NOTIFICATION_RUNTIME_RELEASE_PUBLIC_KEY_FILE", ""),
			ServiceName: first(
				env("HZY_NOTIFICATION_RUNTIME_SERVICE_NAME", ""),
				file.Update.ServiceName,
				"hzy-notification-runtime",
			),
			InstallDir:  installDir,
			BinaryName:  "hzy-notification-runtime",
			ProductName: "hzy-notification-runtime",
		},
		Delivery: DeliveryStoreConfig{
			Type: deliveryStoreType,
			SQLitePath: first(
				env("HZY_NOTIFICATION_RUNTIME_SQLITE_PATH", ""),
				file.Delivery.SQLitePath,
				filepath.Join(installDir, "data", "delivery.db"),
			),
			Host:            first(env("HZY_NOTIFICATION_RUNTIME_DB_HOST", ""), file.Delivery.Host),
			Port:            firstInt(env("HZY_NOTIFICATION_RUNTIME_DB_PORT", ""), file.Delivery.Port, 3306),
			User:            first(env("HZY_NOTIFICATION_RUNTIME_DB_USER", ""), file.Delivery.User),
			Password:        first(env("HZY_NOTIFICATION_RUNTIME_DB_PASSWORD", ""), file.Delivery.Password),
			Database:        first(env("HZY_NOTIFICATION_RUNTIME_DB_NAME", ""), file.Delivery.Database, "hzy_notification_runtime"),
			ConnectionLimit: firstInt(env("HZY_NOTIFICATION_RUNTIME_DB_CONNECTION_LIMIT", ""), file.Delivery.ConnectionLimit, 5),
			LeaseDuration:   millis(firstInt(env("HZY_NOTIFICATION_RUNTIME_DELIVERY_LEASE_MS", ""), file.Delivery.LeaseMs, 120000)),
		},
		PeopleSync: PeopleSyncConfig{},
	}
}

// LoadConnector builds the Phase 1 Connector Runtime configuration. Generic
// Console settings are shared, while all runtime identity, network, update and
// ledger settings use an independent HZY_CONNECTOR_RUNTIME_* namespace.
func LoadConnector() Config {
	_ = godotenv.Load()
	consoleBase := trimSlash(first(env("HZY_CONSOLE_API_URL", ""), env("HZY_CONSOLE_URL", "")))
	dataRuntimeURL := trimSlash(env("HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL", ""))
	installDir := first(env("HZY_CONNECTOR_RUNTIME_INSTALL_DIR", ""), "/opt/hzy/connector-runtime")
	jwksURL := first(env("HZY_CONNECTOR_RUNTIME_JWKS_URL", ""), appendPath(consoleBase, "/.well-known/jwks.json"))
	issuer := trimSlash(first(env("HZY_CONNECTOR_RUNTIME_JWT_ISSUER", ""), consoleBase))
	staticToken := env("HZY_CONNECTOR_RUNTIME_STATIC_TOKEN", "")
	mode := AuthMode(env("HZY_CONNECTOR_RUNTIME_AUTH_MODE", ""))
	if mode == "" {
		switch {
		case staticToken != "":
			mode = AuthStaticToken
		case jwksURL != "":
			mode = AuthJWT
		default:
			mode = AuthDisabled
		}
	}
	deliveryType := strings.ToLower(first(env("HZY_CONNECTOR_RUNTIME_STORE", ""), "sqlite"))
	return Config{
		Host:       first(env("HZY_CONNECTOR_RUNTIME_HOST", ""), "0.0.0.0"),
		Port:       first(env("HZY_CONNECTOR_RUNTIME_PORT", ""), "18082"),
		Tenant:     first(env("HZY_CONNECTOR_RUNTIME_TENANT", ""), env("HZY_TENANT", "")),
		Deployment: first(env("HZY_CONNECTOR_RUNTIME_DEPLOYMENT", ""), env("HZY_DEPLOYMENT", "")),
		PublicURL:  trimSlash(env("HZY_CONNECTOR_RUNTIME_PUBLIC_URL", "")),
		RuntimeID:  first(env("HZY_CONNECTOR_RUNTIME_ID", ""), "connector-runtime"),
		Auth: AuthConfig{
			Mode:        mode,
			StaticToken: staticToken,
			JWT: JWTConfig{
				Audience: first(env("HZY_CONNECTOR_RUNTIME_AUDIENCE", ""), "connector-runtime"),
				Issuer:   issuer, JWKSURL: jwksURL, JWKSJSON: env("HZY_CONNECTOR_RUNTIME_JWKS_JSON", ""),
			},
			// Connector Runtime is one shared supporting service per tenant. The
			// signed and introspected source deployment remains authoritative for
			// audit/ledger partitioning, but it is not the Console deployment that
			// enrolled the Connector instance.
			AllowTenantServiceDeployments: true,
		},
		Console: ConsoleConfig{
			BaseURL:      consoleBase,
			ServiceURL:   dataRuntimeURL,
			TokenURL:     first(env("HZY_CONSOLE_TOKEN_URL", ""), appendPath(consoleBase, "/oauth/token")),
			ClientID:     first(env("HZY_CONNECTOR_RUNTIME_CLIENT_ID", ""), "connector-runtime"),
			ClientSecret: env("HZY_CONNECTOR_RUNTIME_CLIENT_SECRET", ""),
			Timeout:      millis(firstInt(env("HZY_CONNECTOR_RUNTIME_CONSOLE_TIMEOUT_MS", ""), 0, 30000)),
		},
		HTTP: HTTPConfig{
			ReadHeaderTimeout: 5 * time.Second,
			RequestTimeout:    millis(firstInt(env("HZY_CONNECTOR_RUNTIME_REQUEST_TIMEOUT_MS", ""), 0, 15000)),
		},
		Update: UpdateConfig{
			PackageBaseURL:       trimSlash(first(env("HZY_CONNECTOR_RUNTIME_PACKAGE_BASE_URL", ""), "https://downloads.huizhi.yun/packages/hzy-connector-runtime")),
			ReleasePublicKeyFile: first(env("HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_FILE", ""), "/etc/hzy-connector-runtime/release-signing-public.pem"),
			ServiceName:          first(env("HZY_CONNECTOR_RUNTIME_SERVICE_NAME", ""), "hzy-connector-runtime"),
			InstallDir:           installDir,
			BinaryName:           "hzy-connector-runtime",
			ProductName:          "hzy-connector-runtime",
		},
		Delivery: DeliveryStoreConfig{
			Type:            deliveryType,
			SQLitePath:      first(env("HZY_CONNECTOR_RUNTIME_SQLITE_PATH", ""), filepath.Join(installDir, "data", "operations.db")),
			Host:            env("HZY_CONNECTOR_RUNTIME_DB_HOST", ""),
			Port:            firstInt(env("HZY_CONNECTOR_RUNTIME_DB_PORT", ""), 0, 3306),
			User:            env("HZY_CONNECTOR_RUNTIME_DB_USER", ""),
			Password:        env("HZY_CONNECTOR_RUNTIME_DB_PASSWORD", ""),
			Database:        first(env("HZY_CONNECTOR_RUNTIME_DB_NAME", ""), "hzy_connector_runtime"),
			ConnectionLimit: firstInt(env("HZY_CONNECTOR_RUNTIME_DB_CONNECTION_LIMIT", ""), 0, 5),
			LeaseDuration:   millis(firstInt(env("HZY_CONNECTOR_RUNTIME_DELIVERY_LEASE_MS", ""), 0, 120000)),
		},
		PeopleSync: PeopleSyncConfig{
			RuntimeURL:     dataRuntimeURL,
			PrivateKeyFile: first(env("HZY_CONNECTOR_RUNTIME_PRIVATE_KEY_FILE", ""), "/etc/hzy-connector-runtime/connector-private.pem"),
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
