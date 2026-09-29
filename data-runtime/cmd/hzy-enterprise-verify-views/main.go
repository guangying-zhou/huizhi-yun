// hzy-enterprise-verify-views checks the active binding with Runtime's startup verifier.
// It is read-only and prints counts only; the local config remains private.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"sort"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

func main() {
	path := flag.String("config", "", "private Runtime JSON config")
	socket := flag.String("socket", "", "isolated MySQL socket")
	profilePath := flag.String("profile", "", "protected cutover profile; binds the Runtime config to its tenant/environment/target/generation")
	flag.Parse()
	if *path == "" {
		fmt.Fprintln(os.Stderr, "config required")
		os.Exit(2)
	}
	var prof *cutoverprofile.Profile
	var content []byte
	var err error
	if *profilePath != "" {
		if *socket != "" {
			fmt.Fprintln(os.Stderr, "--socket is not used with --profile")
			os.Exit(2)
		}
		loaded, loadErr := cutoverprofile.Load(*profilePath)
		if loadErr != nil {
			fmt.Fprintln(os.Stderr, loadErr)
			os.Exit(1)
		}
		prof = &loaded
		content, err = cutoverprofile.ReadProtected(*path, cutoverprofile.MaxFileSize)
	} else {
		content, err = os.ReadFile(*path)
	}
	if err != nil {
		fail(err)
	}
	var cfg config.Config
	if err := json.Unmarshal(content, &cfg); err != nil {
		fail(err)
	}
	b, err := cfg.EnterpriseBinding()
	if err != nil {
		fail(err)
	}
	if prof != nil {
		if err := prof.CheckRuntimeConfig(cfg); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := prof.CheckBinding(b, prof.Generation); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	dbc := cfg.Enterprise.DB
	connection := mysql.NewConfig()
	connection.Net = "tcp"
	connection.Addr = net.JoinHostPort(dbc.Host, fmt.Sprint(dbc.Port))
	if *socket != "" {
		connection.Net, connection.Addr = "unix", *socket
	}
	connection.User, connection.Passwd, connection.DBName = dbc.User, dbc.Password, dbc.Database
	connection.ParseTime = true
	db, err := sql.Open("mysql", connection.FormatDSN())
	if err != nil {
		fail(err)
	}
	defer db.Close()
	ctx := context.Background()
	if prof != nil {
		if err := cutoverprofile.CheckAccount(ctx, db); err != nil {
			fmt.Fprintln(os.Stderr, cutoverprofile.Redact(err))
			os.Exit(1)
		}
		state, err := prof.InspectTarget(ctx, db)
		if err != nil || !state.Registry || state.Generation != prof.Generation {
			fmt.Fprintln(os.Stderr, "target registry is not the activated profile generation")
			os.Exit(1)
		}
	}
	rows, err := db.QueryContext(ctx, `SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME`, b.Storage.Database)
	if err != nil {
		fail(err)
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			fail(err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		fail(err)
	}
	rows.Close()
	count, failed, ambiguous := 0, 0, 0
	for _, name := range names {
		var candidates []string
		for domain, d := range b.Domains {
			if physical, ok := d.Tables[name]; ok && physical != name {
				candidates = append(candidates, domain)
			}
		}
		sort.Strings(candidates)
		matched := 0
		for _, domain := range candidates {
			binding := b
			if len(candidates) > 1 {
				// The live config can map one logical name in several domains. The
				// verifier rejects ambiguity; identify the one exact installed
				// definition with the same Runtime generator, without changing it.
				binding.Domains = map[string]enterprise.DomainBinding{domain: b.Domains[domain]}
			}
			if enterprise.VerifyCompatibilityViews(ctx, db, binding, domain, []string{name}) == nil {
				matched++
			}
		}
		if matched != 1 {
			fmt.Fprintf(os.Stderr, "%s: compatibility verification failed (matches=%d)\n", name, matched)
			failed++
			continue
		}
		count++
		if len(candidates) > 1 {
			ambiguous++
		}
	}
	fmt.Printf("total: %d/%d views verified, %d ambiguous mappings resolved by exact definition, %d failed\n", count, len(names), ambiguous, failed)
	if prof != nil && len(names) == 0 {
		fmt.Fprintln(os.Stderr, "no compatibility views installed; nothing verified")
		os.Exit(1)
	}
	if failed != 0 {
		os.Exit(1)
	}
}

func fail(err error) {
	_ = err // Never print a DSN or config-derived error.
	fmt.Fprintln(os.Stderr, "compatibility verification setup failed")
	os.Exit(1)
}
