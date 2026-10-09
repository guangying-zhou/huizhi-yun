// hzy-enterprise-add-apf installs only the reviewed local APF object set.
// It never edits live configuration, Registry, grants, or Runtime processes.
package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

const owner = "C000001-test-enterprise"
const planVersion = "apf-local-install.v1"

var rejected = domaininstall.ErrBoundary

type options struct {
	mode, config, migration, proposed, plan, receipt, review, altocWrite, financeWrite, subset, profile, profileSHA string
	production                                                                                                      *productionProfile
}
type reviewPlan struct {
	Subset                       string `json:",omitempty"`
	ProductionProfileSHA256      string `json:",omitempty"`
	Version                      string
	Installation                 domaininstall.Plan
	SourceSHA256, ProposedSHA256 string
	AltocWrite, FinanceWrite     enterprise.PathMode
	ReviewHash                   string
}
type receipt struct {
	Plan         reviewPlan
	Installation domaininstall.Receipt
}
type dependencies struct {
	stopped           domaininstall.Stopped
	productionStopped func(context.Context, *productionProfile) error
	open              func(config.DBConfig) (*sql.DB, error)
	output            io.Writer
}

func digest(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func reviewHash(p reviewPlan) string {
	p.ReviewHash = ""
	raw, _ := json.Marshal(p)
	return digest(raw)
}
func parse(args []string) (options, error) {
	var o options
	fs := flag.NewFlagSet("hzy-enterprise-add-apf", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&o.profile, "profile", "", "absolute 0600 reviewed production install profile; omitted retains local test path")
	fs.StringVar(&o.subset, "subset", "", "fixed incremental subset (empty installs base APF)")
	fs.StringVar(&o.mode, "mode", "plan", "plan/apply/verify/rollback")
	fs.StringVar(&o.config, "config", "", "owner-private source config; base install requires absent APF domains")
	fs.StringVar(&o.migration, "migration-db-config", "", "independent 0600 migration DB configuration")
	fs.StringVar(&o.proposed, "proposed-config", "", "0600 candidate output (plan) / reviewed input (other modes)")
	fs.StringVar(&o.plan, "plan", "", "0600 review plan")
	fs.StringVar(&o.receipt, "receipt", "", "0600 per-DDL receipt")
	fs.StringVar(&o.review, "review-hash", "", "approved APF review hash")
	fs.StringVar(&o.altocWrite, "altoc-write", "unified", "candidate write mode: unified/disabled")
	fs.StringVar(&o.financeWrite, "finance-write", "unified", "candidate write mode: unified/disabled")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	if o.subset != "" {
		explicitWrite := false
		fs.Visit(func(f *flag.Flag) {
			if f.Name == "altoc-write" || f.Name == "finance-write" {
				explicitWrite = true
			}
		})
		if explicitWrite {
			return o, rejected
		}
	}
	if _, err := subsetInstaller(o.subset, domaininstall.Expectation{}); err != nil {
		return o, rejected
	}
	if fs.NArg() != 0 || (o.mode != "plan" && o.mode != "apply" && o.mode != "verify" && o.mode != "rollback") {
		return o, rejected
	}
	if o.config == "" || o.migration == "" || o.proposed == "" || o.plan == "" || (o.mode != "plan" && (o.receipt == "" || o.review == "")) {
		return o, rejected
	}
	for _, mode := range []string{o.altocWrite, o.financeWrite} {
		if mode != "unified" && mode != "disabled" {
			return o, rejected
		}
	}
	if o.profile != "" && !filepath.IsAbs(o.profile) {
		return o, rejected
	}
	paths := map[string]bool{}
	for _, path := range []string{o.config, o.migration, o.proposed, o.plan, o.receipt, o.profile} {
		if path == "" {
			continue
		}
		full, err := filepath.Abs(path)
		if err != nil || paths[full] {
			return o, rejected
		}
		paths[full] = true
	}
	return o, nil
}

// proposal preserves every unknown/future configuration field. Installation
// Binding stays write-disabled; activation modes are hashed separately.
func proposal(raw []byte, o options) (enterprise.Binding, []byte, config.DBConfig, error) {
	var cfg config.Config
	if json.Unmarshal(raw, &cfg) != nil || !cfg.Enterprise.Enabled {
		return enterprise.Binding{}, nil, config.DBConfig{}, rejected
	}
	if o.production == nil {
		if cfg.Tenant != "C000001" || cfg.Server.Host != "127.0.0.1" || cfg.Server.Port != 18084 || cfg.Enterprise.Environment != "test" || cfg.Enterprise.DB.Host != "127.0.0.1" || cfg.DeploymentBindings["enterprise"] != owner {
			return enterprise.Binding{}, nil, config.DBConfig{}, rejected
		}
	} else if !o.production.matches(cfg) {
		return enterprise.Binding{}, nil, config.DBConfig{}, rejected
	}

	b, err := cfg.EnterpriseBinding()
	if err != nil {
		return b, nil, config.DBConfig{}, rejected
	}
	if o.subset == "" {
		b, err = domaininstall.WithAPF(b, installExpectation(o).OwnerDeployment)
	} else {
		b, err = extendSubset(b, o.subset, installExpectation(o).OwnerDeployment)
	}
	if err != nil {
		return b, nil, config.DBConfig{}, rejected
	}
	if err = enterprise.ValidateBinding(b); err != nil {
		return b, nil, config.DBConfig{}, rejected
	}
	if domaininstall.IsColumnSubset(o.subset) {
		return b, append([]byte(nil), raw...), cfg.Enterprise.DB, nil
	}
	var root, ent, domains map[string]json.RawMessage
	if json.Unmarshal(raw, &root) != nil || json.Unmarshal(root["enterprise"], &ent) != nil || json.Unmarshal(ent["domains"], &domains) != nil {
		return b, nil, config.DBConfig{}, rejected
	}
	if o.subset != "" {
		domain := subsetDomain(o.subset)
		var existing map[string]json.RawMessage
		if domain == "migration" && len(domains[domain]) == 0 {
			d := b.Domains[domain]
			initial, _ := json.Marshal(config.EnterpriseDomainConfig{OwnerDeployment: d.OwnerDeployment, Tables: d.Tables, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler})
			domains[domain] = initial
		}
		if json.Unmarshal(domains[domain], &existing) != nil {
			return b, nil, config.DBConfig{}, rejected
		}
		existing["tables"], _ = json.Marshal(b.Domains[domain].Tables)
		domains[domain], _ = json.Marshal(existing)
	} else {
		for _, domain := range []string{"altoc", "finance", "people"} {
			d := b.Domains[domain]
			write := enterprise.PathDisabled
			if domain == "altoc" {
				write = enterprise.PathMode(o.altocWrite)
			}
			if domain == "finance" {
				write = enterprise.PathMode(o.financeWrite)
			}
			domains[domain], err = json.Marshal(config.EnterpriseDomainConfig{OwnerDeployment: d.OwnerDeployment, Tables: d.Tables, Read: d.Read, Write: write, Scheduler: enterprise.PathDisabled})
			if err != nil {
				return b, nil, config.DBConfig{}, err
			}
		}
	}
	ent["domains"], _ = json.Marshal(domains)
	root["enterprise"], _ = json.Marshal(ent)
	candidate, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return b, nil, config.DBConfig{}, err
	}
	candidate = append(candidate, '\n')
	var checked config.Config
	if json.Unmarshal(candidate, &checked) != nil {
		return b, nil, config.DBConfig{}, rejected
	}
	if _, err = checked.EnterpriseBinding(); err != nil {
		return b, nil, config.DBConfig{}, rejected
	}
	return b, candidate, cfg.Enterprise.DB, nil
}
func validatePlan(p reviewPlan, b enterprise.Binding, source, candidate []byte, o options) error {
	if p.ProductionProfileSHA256 != o.profileSHA || p.Subset != o.subset || p.Version != planVersion || p.ReviewHash == "" || p.ReviewHash != reviewHash(p) || p.ReviewHash != o.review || p.SourceSHA256 != digest(source) || p.ProposedSHA256 != digest(candidate) || p.AltocWrite != enterprise.PathMode(o.altocWrite) || p.FinanceWrite != enterprise.PathMode(o.financeWrite) || !reflect.DeepEqual(p.Installation.Binding, b) {
		return rejected
	}
	return nil
}
func execute(ctx context.Context, args []string, dep dependencies) error {
	o, err := parse(args)
	if err != nil {
		return err
	}
	if o.profile != "" {
		o.production, o.profileSHA, err = loadProductionProfile(o.profile)
		if err != nil || dep.productionStopped == nil {
			return rejected
		}
		p, hash := o.production, o.profileSHA
		dep.stopped = func(ctx context.Context) error {
			_, current, e := loadProductionProfile(o.profile)
			if e != nil || current != hash {
				return rejected
			}
			return dep.productionStopped(ctx, p)
		}
	}
	if dep.stopped == nil || dep.open == nil || dep.output == nil {
		return rejected
	}
	if err = dep.stopped(ctx); err != nil {
		return rejected
	}
	source, err := privateRead(o.config)
	if err != nil {
		return rejected
	}
	b, candidate, runtimeDB, err := proposal(source, o)
	if err != nil {
		return err
	}
	adminRaw, err := privateRead(o.migration)
	if err != nil {
		return rejected
	}
	var admin config.DBConfig
	if json.Unmarshal(adminRaw, &admin) != nil {
		return rejected
	}
	admin, err = migrationConnection(runtimeDB, admin)
	if err != nil {
		return err
	}
	var p reviewPlan
	if o.mode != "plan" {
		if err = readJSON(o.plan, &p); err != nil {
			return err
		}
		if err = validatePlan(p, b, source, candidate, o); err != nil {
			return err
		}
		stored, err := privateRead(o.proposed)
		if err != nil || digest(stored) != p.ProposedSHA256 {
			return rejected
		}
	}
	db, err := dep.open(admin)
	if err != nil {
		return rejected
	}
	defer db.Close()
	if err = cutoverprofile.CheckAccount(ctx, db); err != nil {
		return rejected
	}
	expectation := installExpectation(o)
	expectation.Address = b.Storage.Address
	i, err := subsetInstaller(o.subset, expectation)
	if err != nil {
		return rejected
	}
	if o.mode == "plan" {
		install, err := i.PlanInstall(ctx, db, b)
		if err != nil {
			return err
		}
		if err = dep.stopped(ctx); err != nil {
			return rejected
		}
		p = reviewPlan{ProductionProfileSHA256: o.profileSHA, Subset: o.subset, Version: planVersion, Installation: install, SourceSHA256: digest(source), ProposedSHA256: digest(candidate), AltocWrite: enterprise.PathMode(o.altocWrite), FinanceWrite: enterprise.PathMode(o.financeWrite)}
		p.ReviewHash = reviewHash(p)
		// Never overwrite either artifact, even on repeated plan/apply.
		if err = writeBytes(o.proposed, candidate); err != nil {
			return err
		}
		if err = writeJSON(o.plan, p); err != nil {
			return err
		}
		if install.Column != nil {
			fmt.Fprintf(dep.output, "plan: %d column/index steps; reviewHash=%s; config/Registry unchanged\n", len(install.Column.Steps), p.ReviewHash)
		} else {
			fmt.Fprintf(dep.output, "plan: %d tables, %d views; reviewHash=%s; proposed config is NOT activated\n", len(install.Tables), len(install.Views), p.ReviewHash)
		}
		return nil
	}
	switch o.mode {
	case "apply":
		var existing receipt
		if domaininstall.IsColumnSubset(o.subset) {
			if _, statErr := os.Lstat(o.receipt); statErr == nil {
				if err = readJSON(o.receipt, &existing); err != nil {
					return err
				}
				if !reflect.DeepEqual(existing.Plan, p) || !reflect.DeepEqual(existing.Installation.Plan, p.Installation) {
					return rejected
				}
				err = i.Resume(ctx, db, existing.Installation, dep.stopped, func(r domaininstall.Receipt) error { return checkpoint(o.receipt, receipt{Plan: p, Installation: r}) })
				break
			} else if !errors.Is(statErr, os.ErrNotExist) {
				return rejected
			}
		}
		if err = writeJSON(o.receipt, receipt{Plan: p, Installation: domaininstall.Receipt{Plan: p.Installation, Created: map[string]string{}}}); err != nil {
			return err
		}
		err = i.Apply(ctx, db, p.Installation, dep.stopped, func(r domaininstall.Receipt) error { return checkpoint(o.receipt, receipt{Plan: p, Installation: r}) })

	case "verify", "rollback":
		var r receipt
		if err = readJSON(o.receipt, &r); err != nil {
			return err
		}
		if !reflect.DeepEqual(r.Plan, p) || !reflect.DeepEqual(r.Installation.Plan, p.Installation) {
			return rejected
		}
		if o.mode == "verify" {
			err = i.VerifyReceipt(ctx, db, r.Installation)
		} else {
			err = i.Rollback(ctx, db, r.Installation, dep.stopped)
		}
	}
	if err != nil {
		return err
	}
	if err = dep.stopped(ctx); err != nil {
		return rejected
	}
	fmt.Fprintln(dep.output, o.mode+": PASS; live config/Registry/grants unchanged")
	return nil
}
func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	err := execute(ctx, os.Args[1:], dependencies{stopped: stopped, productionStopped: productionStopped, open: openMigration, output: os.Stdout})
	if errors.Is(err, flag.ErrHelp) {
		fmt.Println("hzy-enterprise-add-apf: --subset <fixed-name> --mode plan/apply/verify/rollback --config --migration-db-config --proposed-config --plan [--profile <protected-production-profile>] [--receipt --review-hash] [--altoc-write unified/disabled --finance-write unified/disabled]; see README")
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "apf_install_failed: do not start Runtime; inspect owner-private artifacts; no automatic rollback/config activation/grant change")
		os.Exit(1)
	}
}
