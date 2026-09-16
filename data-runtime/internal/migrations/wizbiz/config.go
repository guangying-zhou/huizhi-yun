package wizbiz

import (
	"os"
	"strconv"
	"strings"
)

func LoadConfigFromEnv() Config {
	baseHost := firstEnv("HZY_DATA_RUNTIME_DB_HOST", "DB_HOST")
	basePort := intEnv(3306, "HZY_DATA_RUNTIME_DB_PORT", "DB_PORT")
	baseUser := firstEnv("HZY_DATA_RUNTIME_DB_USER", "DB_USER")
	basePassword := firstEnv("HZY_DATA_RUNTIME_DB_PASSWORD", "DB_PASSWORD")
	baseLimit := intEnv(5, "HZY_DATA_RUNTIME_DB_CONNECTION_LIMIT", "DB_CONNECTION_LIMIT")

	return Config{
		Source: DBConfig{
			Host:            firstEnv("HZY_WIZBIZ_DB_HOST", "WIZBIZ_DB_HOST", "OA_DB_HOST"),
			Port:            intEnv(3306, "HZY_WIZBIZ_DB_PORT", "WIZBIZ_DB_PORT", "OA_DB_PORT"),
			User:            firstEnv("HZY_WIZBIZ_DB_USER", "WIZBIZ_DB_USER", "OA_DB_USER"),
			Password:        firstEnv("HZY_WIZBIZ_DB_PASSWORD", "WIZBIZ_DB_PASSWORD", "OA_DB_PASSWORD"),
			Database:        firstEnvDefault("wizbizdb", "HZY_WIZBIZ_DB_NAME", "WIZBIZ_DB_NAME", "OA_DB_NAME"),
			ConnectionLimit: intEnv(3, "HZY_WIZBIZ_DB_CONNECTION_LIMIT", "WIZBIZ_DB_CONNECTION_LIMIT", "OA_DB_CONNECTION_LIMIT"),
		},
		Altoc: DBConfig{
			Host:            firstEnvDefault(baseHost, "HZY_ALTOC_DB_HOST"),
			Port:            intEnv(basePort, "HZY_ALTOC_DB_PORT"),
			User:            firstEnvDefault(baseUser, "HZY_ALTOC_DB_USER"),
			Password:        firstEnvDefault(basePassword, "HZY_ALTOC_DB_PASSWORD"),
			Database:        firstEnvDefault("hzy_altoc", "HZY_ALTOC_DB_NAME"),
			ConnectionLimit: firstPositive(intEnv(0, "HZY_ALTOC_DB_CONNECTION_LIMIT"), baseLimit),
		},
		Finance: DBConfig{
			Host:            firstEnvDefault(baseHost, "HZY_FINANCE_DB_HOST"),
			Port:            intEnv(basePort, "HZY_FINANCE_DB_PORT"),
			User:            firstEnvDefault(baseUser, "HZY_FINANCE_DB_USER"),
			Password:        firstEnvDefault(basePassword, "HZY_FINANCE_DB_PASSWORD"),
			Database:        firstEnvDefault("hzy_finance", "HZY_FINANCE_DB_NAME"),
			ConnectionLimit: firstPositive(intEnv(0, "HZY_FINANCE_DB_CONNECTION_LIMIT"), baseLimit),
		},
	}
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func firstEnvDefault(fallback string, keys ...string) string {
	if value := firstEnv(keys...); value != "" {
		return value
	}
	return fallback
}

func intEnv(fallback int, keys ...string) int {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}
