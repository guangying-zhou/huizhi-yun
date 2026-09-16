package directoryconnector

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	RuntimeURL     string
	ConnectorID    string
	PrivateKeyFile string
	StateCacheFile string
	PollInterval   time.Duration
	HTTPTimeout    time.Duration
	RefreshBackoff time.Duration
}

func LoadConfig() (Config, error) {
	cfg := Config{
		RuntimeURL:     strings.TrimRight(envDefault("HZY_DIRECTORY_CONNECTOR_RUNTIME_URL", "http://127.0.0.1:18080"), "/"),
		ConnectorID:    strings.TrimSpace(os.Getenv("HZY_DIRECTORY_CONNECTOR_ID")),
		PrivateKeyFile: envDefault("HZY_DIRECTORY_CONNECTOR_PRIVATE_KEY_FILE", "/etc/hzy-data-runtime/directory/directory-connector-private.pem"),
		StateCacheFile: envDefault("HZY_DIRECTORY_CONNECTOR_STATE_CACHE_FILE", "/etc/hzy-data-runtime/directory/state-cache.json"),
		PollInterval:   durationSeconds("HZY_DIRECTORY_CONNECTOR_POLL_SECONDS", 3),
		HTTPTimeout:    durationSeconds("HZY_DIRECTORY_CONNECTOR_HTTP_TIMEOUT_SECONDS", 30),
		RefreshBackoff: durationSeconds("HZY_DIRECTORY_CONNECTOR_CONFIG_RETRY_SECONDS", 300),
	}
	if !strings.HasPrefix(cfg.RuntimeURL, "http://127.0.0.1:") && !strings.HasPrefix(cfg.RuntimeURL, "http://localhost:") {
		return Config{}, errors.New("directory connector Runtime URL must use loopback HTTP")
	}
	return cfg, nil
}

func envDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationSeconds(name string, fallback int) time.Duration {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		value = fallback
	}
	return time.Duration(value) * time.Second
}
