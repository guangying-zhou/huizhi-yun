package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

type profileSetup struct {
	installer domaininstall.Installer
	stopped   domaininstall.Stopped
	planLine  string
	binding   enterprise.Binding
	db        *sql.DB
}

// setupProfile replaces the fixed C000001 local boundary with the protected
// profile identity. The installed objects, baseline digest, receipts, stopped
// proof and review hash rules are unchanged; only the expected tenant,
// environment, owner deployment and exact storage address come from the
// profile. The DDL account is the profile's least-privilege cutover account;
// the Runtime's own business account is never used for DDL.
func setupProfile(profilePath, runtimePath, migrationPath string, evidence bool) (profileSetup, error) {
	var s profileSetup
	if migrationPath != "" {
		return s, fmt.Errorf("%w: --profile supplies the migration account; --migration-db-config is not used", cutoverprofile.ErrProfile)
	}
	prof, err := cutoverprofile.Load(profilePath)
	if err != nil {
		return s, err
	}
	raw, err := cutoverprofile.ReadProtected(runtimePath, cutoverprofile.MaxFileSize)
	if err != nil {
		return s, fmt.Errorf("%w: Runtime config unavailable or not owner-private", cutoverprofile.ErrProfile)
	}
	var cfg config.Config
	if json.Unmarshal(raw, &cfg) != nil {
		return s, fmt.Errorf("%w: Runtime config invalid", cutoverprofile.ErrProfile)
	}
	if err := prof.CheckRuntimeConfig(cfg); err != nil {
		return s, err
	}
	b, err := cfg.EnterpriseBinding()
	if err != nil || !cfg.Enterprise.Enabled {
		return s, fmt.Errorf("%w: enabled enterprise binding required", cutoverprofile.ErrProfile)
	}
	if err := prof.CheckBinding(b, prof.Generation); err != nil {
		return s, err
	}
	if b.Storage.Address != prof.Address() {
		return s, fmt.Errorf("%w: Runtime storage address differs from the profile migration connection", cutoverprofile.ErrProfile)
	}
	expect := domaininstall.Expectation{Tenant: prof.Tenant, Environment: prof.Environment, OwnerDeployment: prof.EnterpriseDeployment, Address: prof.Address()}
	s.installer, s.planLine = domaininstall.ForAltoc(expect), "plan: altoc read-only tables and views, reviewHash=%s\n"
	if evidence {
		s.installer, s.planLine = domaininstall.ForDeletionEvidence(expect), "plan: aims work-item deletion evidence table and view, reviewHash=%s\n"
	}
	s.stopped, s.binding = prof.RuntimeStopped, b
	db, err := sql.Open("mysql", prof.MySQL(prof.Target).FormatDSN())
	if err != nil {
		return s, errors.New("migration database unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := cutoverprofile.CheckAccount(ctx, db); err != nil {
		db.Close()
		return s, cutoverprofile.Redact(err)
	}
	if err := prof.CheckInstance(ctx, db); err != nil {
		db.Close()
		return s, cutoverprofile.Redact(err)
	}
	s.db = db
	return s, nil
}
