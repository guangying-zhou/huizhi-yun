package db

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func Open(cfg config.DBConfig) (*sql.DB, error) {
	mysqlCfg := mysql.NewConfig()
	mysqlCfg.Net = "tcp"
	mysqlCfg.Addr = fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	mysqlCfg.User = cfg.User
	mysqlCfg.Passwd = cfg.Password
	mysqlCfg.DBName = cfg.Database
	mysqlCfg.ParseTime = false
	mysqlCfg.Params = map[string]string{
		"charset":   "utf8mb4",
		"collation": "utf8mb4_unicode_ci",
	}
	mysqlCfg.Loc = time.UTC

	conn, err := sql.Open("mysql", mysqlCfg.FormatDSN())
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(cfg.ConnectionLimit)
	conn.SetMaxIdleConns(cfg.ConnectionLimit)
	conn.SetConnMaxLifetime(30 * time.Minute)
	return conn, nil
}
