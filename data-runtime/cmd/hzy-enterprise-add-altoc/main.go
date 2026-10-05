// Local-only domain installer. Configuration is private; output contains no DSN.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

func privateRead(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, domaininstall.ErrBoundary
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Getuid() {
		return nil, domaininstall.ErrBoundary
	}
	return os.ReadFile(path)
}
func write(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(raw)
	return err
}

// launchctl uses disabled on current macOS and true on some older versions.
// Exactly one explicit target entry is required; unknown states fail closed.
func runtimeDisabled(raw string) bool {
	matches := 0
	disabled := false
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		parts := strings.SplitN(line, " => ", 2)
		if len(parts) != 2 || parts[0] != `"cn.wiztek.hzy-test-runtime"` {
			continue
		}
		matches++
		disabled = parts[1] == "disabled" || parts[1] == "true"
	}
	return matches == 1 && disabled
}
func stopped(ctx context.Context) error {
	label := "cn.wiztek.hzy-test-runtime"
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	raw, err := exec.CommandContext(ctx, "launchctl", "print-disabled", domain).Output()
	if err != nil || !runtimeDisabled(string(raw)) {
		return domaininstall.ErrBoundary
	}
	// Disabled plus booted out, not merely a failed health endpoint.
	cmd := exec.CommandContext(ctx, "launchctl", "print", domain+"/"+label)
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "Could not find service") {
		return domaininstall.ErrBoundary
	}
	for _, port := range []string{"18084"} {
		c, err := net.DialTimeout("tcp", "127.0.0.1:"+port, time.Second)
		if err == nil {
			c.Close()
			return domaininstall.ErrBoundary
		}
	}
	return nil
}
func migrationConnection(runtime, admin config.DBConfig) (config.DBConfig, error) {
	if admin.Host != runtime.Host || admin.Port != runtime.Port || admin.Database != runtime.Database || admin.User == "" {
		return config.DBConfig{}, domaininstall.ErrBoundary
	}
	return admin, nil
}
func run() error {
	mode := flag.String("mode", "plan", "plan/apply/verify/rollback")
	path := flag.String("config", "", "private proposed Runtime config")
	planPath := flag.String("plan", "", "owner-only plan JSON")
	receiptPath := flag.String("receipt", "", "owner-only installation receipt")
	migrationPath := flag.String("migration-db-config", "", "owner-only independent migration DB credentials")
	review := flag.String("review-hash", "", "approved plan hash")
	evidence := flag.Bool("work-item-deletion-evidence", false, "install only the fixed Aims deletion evidence table")
	profilePath := flag.String("profile", "", "protected cutover profile for an explicit tenant/environment; replaces the fixed C000001 local boundary")
	flag.Parse()
	verifyReceipt := domaininstall.VerifyReceipt
	planInstall, apply, rollback := domaininstall.PlanInstall, domaininstall.Apply, domaininstall.Rollback
	if *evidence {
		verifyReceipt = domaininstall.VerifyDeletionEvidenceReceipt
		planInstall, apply, rollback = domaininstall.PlanDeletionEvidence, domaininstall.ApplyDeletionEvidence, domaininstall.RollbackDeletionEvidence
	}
	off := domaininstall.Stopped(stopped)
	planLine := "plan: 13 tables, 13 views, reviewHash=%s\n"
	var raw []byte
	var err error
	var b enterprise.Binding
	var db *sql.DB
	if *profilePath != "" {
		var s profileSetup
		if s, err = setupProfile(*profilePath, *path, *migrationPath, *evidence); err != nil {
			return err
		}
		i := s.installer
		verifyReceipt, planInstall, apply, rollback = i.VerifyReceipt, i.PlanInstall, i.Apply, i.Rollback
		off, planLine, b, db = s.stopped, s.planLine, s.binding, s.db
	} else {
		if b, db, err = legacySetup(*path, *migrationPath); err != nil {
			return err
		}
	}
	defer db.Close()
	ctx := context.Background()
	if *mode == "plan" {
		p, err := planInstall(ctx, db, b)
		if err != nil {
			return err
		}
		if err = write(*planPath, p); err != nil {
			return err
		}
		fmt.Printf(planLine, p.ReviewHash)
		return nil
	}
	raw, err = privateRead(*planPath)
	if err != nil {
		return err
	}
	var p domaininstall.Plan
	if err = json.Unmarshal(raw, &p); err != nil {
		return err
	}
	if *review != p.ReviewHash {
		return domaininstall.ErrBoundary
	}
	a, _ := json.Marshal(b)
	before, _ := json.Marshal(p.Binding)
	if string(a) != string(before) {
		return domaininstall.ErrBoundary
	}
	switch *mode {
	case "apply":
		// Create receipt exclusively before any DDL; every checkpoint is atomic.
		if err = write(*receiptPath, domaininstall.Receipt{Plan: p, Created: map[string]string{}}); err != nil {
			return err
		}
		err = apply(ctx, db, p, off, func(r domaininstall.Receipt) error {
			tmp := *receiptPath + ".next"
			if err := write(tmp, r); err != nil {
				return err
			}
			return os.Rename(tmp, *receiptPath)
		})
	case "verify":
		raw, e := privateRead(*receiptPath)
		if e != nil {
			return e
		}
		var r domaininstall.Receipt
		if e = json.Unmarshal(raw, &r); e != nil {
			return e
		}
		if r.Plan.ReviewHash != p.ReviewHash {
			return domaininstall.ErrBoundary
		}
		err = verifyReceipt(ctx, db, r)
	case "rollback":
		raw, e := privateRead(*receiptPath)
		if e != nil {
			return e
		}
		var r domaininstall.Receipt
		if e = json.Unmarshal(raw, &r); e != nil {
			return e
		}
		if r.Plan.ReviewHash != p.ReviewHash {
			return domaininstall.ErrBoundary
		}
		err = rollback(ctx, db, r, off)
	default:
		return domaininstall.ErrBoundary
	}
	if err == nil {
		fmt.Println(*mode + ": PASS")
	}
	return err
}

// legacySetup is the unchanged fixed C000001 local boundary.
func legacySetup(path, migrationPath string) (enterprise.Binding, *sql.DB, error) {
	raw, err := privateRead(path)
	if err != nil {
		return enterprise.Binding{}, nil, err
	}
	var cfg config.Config
	if err = json.Unmarshal(raw, &cfg); err != nil {
		return enterprise.Binding{}, nil, err
	}
	if cfg.Server.Host != "127.0.0.1" || cfg.Server.Port != 18084 || cfg.Tenant != "C000001" {
		return enterprise.Binding{}, nil, domaininstall.ErrBoundary
	}
	b, err := cfg.EnterpriseBinding()
	if err != nil {
		return enterprise.Binding{}, nil, err
	}
	dbc := cfg.Enterprise.DB
	if migrationPath != "" {
		raw, e := privateRead(migrationPath)
		if e != nil {
			return enterprise.Binding{}, nil, e
		}
		var admin config.DBConfig
		if e = json.Unmarshal(raw, &admin); e != nil {
			return enterprise.Binding{}, nil, e
		}
		dbc, e = migrationConnection(dbc, admin)
		if e != nil {
			return enterprise.Binding{}, nil, e
		}
	}

	if dbc.Host != "127.0.0.1" {
		return enterprise.Binding{}, nil, domaininstall.ErrBoundary
	}
	mc := mysql.NewConfig()
	mc.Net = "tcp"
	mc.Addr = net.JoinHostPort(dbc.Host, fmt.Sprint(dbc.Port))
	mc.User = dbc.User
	mc.Passwd = dbc.Password
	mc.DBName = dbc.Database
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return enterprise.Binding{}, nil, err
	}
	return b, db, nil
}
func main() {
	if err := run(); err != nil {
		if errors.Is(err, cutoverprofile.ErrProfile) {
			fmt.Fprintln(os.Stderr, err)
		}
		fmt.Fprintln(os.Stderr, "domain_install_failed: Runtime stays stopped; inspect owner-only plan/receipt; DDL is non-transactional, no automatic rollback or restart")
		os.Exit(1)
	}
}
