package db

import (
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestMySQLConfigAlwaysParsesTemporalColumns(t *testing.T) {
	cfg := config.DBConfig{
		Host: "127.0.0.1", Port: 3306, User: "runtime-user",
		Password: "test-only-password", Database: "hzy_test", ConnectionLimit: 3,
	}
	mysqlCfg := mysqlConfig(cfg)
	if !mysqlCfg.ParseTime {
		t.Fatal("runtime MySQL connection must parse DATETIME/TIMESTAMP into time.Time")
	}
	dsn := mysqlCfg.FormatDSN()
	if !strings.Contains(dsn, "parseTime=true") {
		t.Fatalf("formatted DSN does not preserve parseTime invariant")
	}
	if mysqlCfg.Loc.String() != "UTC" {
		t.Fatalf("MySQL time location = %q, want UTC", mysqlCfg.Loc.String())
	}
	// Contract tests inspect parsed configuration only; production code must not log DSNs.
	if strings.Contains(dsn, "password=") {
		t.Fatal("DSN unexpectedly uses a log-friendly password parameter")
	}
}
