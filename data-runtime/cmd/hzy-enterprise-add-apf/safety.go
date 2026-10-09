package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

func privateRead(path string) ([]byte, error) {
	return cutoverprofile.ReadProtected(path, cutoverprofile.MaxFileSize)
}
func migrationConnection(runtime, admin config.DBConfig) (config.DBConfig, error) {
	if admin.Host != runtime.Host || admin.Port != runtime.Port || admin.Database != runtime.Database || admin.User == "" || admin.User == runtime.User || strings.EqualFold(admin.User, "root") {
		return config.DBConfig{}, rejected
	}
	return admin, nil
}
func openMigration(dbc config.DBConfig) (*sql.DB, error) {
	mc := mysql.NewConfig()
	mc.Net = "tcp"
	mc.Addr = net.JoinHostPort(dbc.Host, fmt.Sprint(dbc.Port))
	mc.User = dbc.User
	mc.Passwd = dbc.Password
	mc.DBName = dbc.Database
	mc.Timeout = 5 * time.Second
	mc.ReadTimeout = 2 * time.Minute
	mc.WriteTimeout = 2 * time.Minute
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return nil, rejected
	}
	db.SetMaxOpenConns(1)
	return db, nil
}
func runtimeDisabled(raw string) bool {
	matches := 0
	disabled := false
	for _, line := range strings.Split(raw, "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), " => ", 2)
		if len(parts) != 2 || parts[0] != `"cn.wiztek.hzy-test-runtime"` {
			continue
		}
		matches++
		disabled = parts[1] == "disabled" || parts[1] == "true"
	}
	return matches == 1 && disabled
}

type launchCommand func(context.Context, string, ...string) ([]byte, error)
type dialPort func(context.Context, string, string) (net.Conn, error)

func stoppedWith(ctx context.Context, command launchCommand, dial dialPort) error {
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	raw, err := command(ctx, "launchctl", "print-disabled", domain)
	if err != nil || !runtimeDisabled(string(raw)) {
		return rejected
	}
	raw, err = command(ctx, "launchctl", "print", domain+"/cn.wiztek.hzy-test-runtime")
	if err == nil || !strings.Contains(string(raw), "Could not find service") {
		return rejected
	}
	conn, err := dial(ctx, "tcp", "127.0.0.1:18084")
	if err == nil {
		if conn != nil {
			conn.Close()
		}
		return rejected
	}
	// Timeout, permission failure and unknown network errors do not prove absence.
	if !errors.Is(err, syscall.ECONNREFUSED) {
		return rejected
	}
	return nil
}
func stopped(ctx context.Context) error {
	return stoppedWith(ctx, func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return exec.CommandContext(ctx, name, args...).CombinedOutput()
	}, (&net.Dialer{Timeout: time.Second}).DialContext)
}
