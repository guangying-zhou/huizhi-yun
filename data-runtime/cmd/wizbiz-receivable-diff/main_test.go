package main

import (
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiz"
)

func TestMySQLConfigParsesTimeValuesInUTC(t *testing.T) {
	cfg := mysqlConfig(wizbiz.DBConfig{
		Host:     "127.0.0.1",
		Port:     3307,
		User:     "runtime",
		Password: "secret",
		Database: "tenant",
	})

	if !cfg.ParseTime {
		t.Fatal("mysqlConfig ParseTime = false, want true so DATETIME scans into time.Time")
	}
	if cfg.Loc != time.UTC {
		t.Fatalf("mysqlConfig Loc = %v, want UTC", cfg.Loc)
	}
	if dsn := cfg.FormatDSN(); !strings.Contains(dsn, "parseTime=true") {
		t.Fatalf("mysqlConfig DSN = %q, want parseTime=true", dsn)
	}
}
