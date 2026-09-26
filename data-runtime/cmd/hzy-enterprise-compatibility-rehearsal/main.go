// hzy-enterprise-compatibility-rehearsal installs reviewed compatibility views
// only into a verified generation-zero shadow copy. It is not a cutover tool.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/go-sql-driver/mysql"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseassets"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseplanning"
	"github.com/huizhi-yun/data-runtime/internal/enterprisescheduler"
)

type rehearsalConfig struct {
	Migration struct {
		Tenant, Environment, RuntimeDeployment, InstanceID, SchemaVersion, SourceAims, SourceAssets, Target string
		Generation                                                                                          uint64
	}
	Connection struct {
		Host, User, Password string
		Port                 int
	}
}

type candidate struct {
	Enterprise struct {
		Enabled       bool   `json:"enabled"`
		SchemaVersion string `json:"schemaVersion"`
		Generation    uint64 `json:"generation"`
		InstanceID    string `json:"instanceId"`
		DB            struct {
			Database string `json:"database"`
		} `json:"db"`
		Domains map[string]struct {
			OwnerDeployment string            `json:"ownerDeployment"`
			Read            e.PathMode        `json:"read"`
			Write           e.PathMode        `json:"write"`
			Scheduler       e.PathMode        `json:"scheduler"`
			Tables          map[string]string `json:"tables"`
		} `json:"domains"`
	} `json:"enterprise"`
}

type artifact struct {
	Version        string                             `json:"version"`
	MigrationHash  string                             `json:"migrationReviewHash"`
	Binding        e.Binding                          `json:"binding"`
	Plans          map[string]e.CompatibilityViewPlan `json:"plans"`
	ReadChecks     map[string]int                     `json:"readChecks"`
	RuntimeVerify  string                             `json:"runtimeVerify"`
	ProductService string                             `json:"productServiceConstruction"`
}

const c000001FinalMigrationHash = "f835241cf6ab0ea311b43b120cc88cdb73760e0295df05153510777200dea866"

func validateFinalTestTarget(c rehearsalConfig, b e.Binding, hash string, final, apply bool) error {
	if !final {
		if apply {
			return errors.New("--apply requires --final-test-target")
		}
		if b.Storage.Database == "hzy_enterprise_shadow_review_20260913" {
			return errors.New("approved C000001 final test target requires --final-test-target --apply")
		}
		return nil
	}
	if !apply || hash != c000001FinalMigrationHash || b.Key.Tenant != "C000001" || b.Key.Environment != "test" || b.Key.RuntimeDeployment != "c000001-test-tenant-runtime" || b.Storage.Database != "hzy_enterprise_shadow_review_20260913" || c.Migration.SourceAims != "hzy_aims_test_local_20260910" || c.Migration.SourceAssets != "hzy_assets_test_local_20260910" {
		return errors.New("approved C000001 final test target, exact migration hash and --apply required")
	}
	return nil
}

func readJSON(path string, target any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func binding(c rehearsalConfig, source candidate) (e.Binding, error) {
	if source.Enterprise.Enabled || source.Enterprise.Generation != c.Migration.Generation || source.Enterprise.SchemaVersion != c.Migration.SchemaVersion || source.Enterprise.InstanceID != c.Migration.InstanceID || c.Migration.Generation == 0 || c.Connection.Host == "" || c.Connection.Port < 1 || c.Connection.Port > 65535 {
		return e.Binding{}, errors.New("candidate or rehearsal identity mismatch")
	}
	b := e.Binding{
		Key:           e.BindingKey{Tenant: c.Migration.Tenant, Environment: c.Migration.Environment, RuntimeDeployment: c.Migration.RuntimeDeployment},
		Storage:       e.Storage{InstanceID: c.Migration.InstanceID, Address: fmt.Sprintf("%s:%d", c.Connection.Host, c.Connection.Port), Database: c.Migration.Target},
		SchemaVersion: c.Migration.SchemaVersion, Generation: c.Migration.Generation, Domains: map[string]e.DomainBinding{},
	}
	for name, d := range source.Enterprise.Domains {
		b.Domains[name] = e.DomainBinding{OwnerDeployment: d.OwnerDeployment, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler, Tables: d.Tables}
	}
	if len(b.Domains) != 2 || b.Domains["aims"].Tables == nil || b.Domains["assets"].Tables == nil {
		return e.Binding{}, errors.New("candidate domain mapping incomplete")
	}
	return b, nil
}

func verifyShadow(ctx context.Context, db *sql.DB, b e.Binding, migrationHash string) error {
	var hash, state, tenant, environment, deployment, version string
	var generation uint64
	if err := db.QueryRowContext(ctx, "SELECT review_hash,status FROM enterprise_migration_ledger WHERE id=1").Scan(&hash, &state); err != nil || hash != migrationHash || state != "verified-shadow" {
		return errors.New("target ledger is not the verified rehearsal plan")
	}
	if err := db.QueryRowContext(ctx, "SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1").Scan(&tenant, &environment, &deployment, &version, &generation); err != nil || tenant != b.Key.Tenant || environment != b.Key.Environment || deployment != b.Key.RuntimeDeployment || version != b.SchemaVersion || generation != 0 {
		return errors.New("target registry is not a generation-zero rehearsal")
	}
	return nil
}

func aimsPilotAndCompletionViews() []string {
	seen := map[string]bool{}
	for _, names := range [][]string{enterpriseplanning.PilotViewNames(), enterprisescheduler.CompletionViewNames()} {
		for _, name := range names {
			seen[name] = true
		}
	}
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}

func verifyViewReads(ctx context.Context, db *sql.DB, names map[string][]string) (map[string]int, error) {
	checked := make(map[string]int, len(names))
	for domain, logicalNames := range names {
		for _, name := range logicalNames {
			var count uint64
			if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM `"+name+"`").Scan(&count); err != nil {
				return nil, fmt.Errorf("cannot read %s view %s: %w", domain, name, err)
			}
			checked[domain]++
		}
	}
	return checked, nil
}

func verifyRuntimeBoundary(ctx context.Context, db *sql.DB, mc *mysql.Config, b e.Binding, names map[string][]string) error {
	for domain, logicalNames := range names {
		if err := e.VerifyCompatibilityViews(ctx, db, b, domain, logicalNames); !errors.Is(err, e.ErrCompatibilityView) {
			return errors.New("generation-zero rehearsal unexpectedly passed runtime compatibility verification")
		}
	}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) {
		return sql.Open("mysql", mc.FormatDSN())
	})
	defer registry.Close()
	if err := registry.Register(ctx, b); err != nil {
		return err
	}
	if _, err := enterpriseassets.NewProductService(ctx, registry, b, b.Domains["assets"].OwnerDeployment); !errors.Is(err, e.ErrCompatibilityView) {
		return errors.New("generation-zero rehearsal unexpectedly constructed product service")
	}
	return nil
}

func run() error {
	configPath := flag.String("config", "", "protected rehearsal connection configuration")
	candidatePath := flag.String("binding-candidate", "", "read-only candidate binding artifact")
	migrationPlanPath := flag.String("migration-plan", "", "verified rehearsal shadow-copy plan")
	artifactPath := flag.String("artifact", "", "protected compatibility plan/receipt output")
	finalTarget := flag.Bool("final-test-target", false, "allow only the reviewed C000001 final test target")
	apply := flag.Bool("apply", false, "required with --final-test-target")
	flag.Parse()
	if *configPath == "" || *candidatePath == "" || *migrationPlanPath == "" || *artifactPath == "" {
		return errors.New("config, binding-candidate, migration-plan and artifact are required")
	}
	var config rehearsalConfig
	var source candidate
	var migration struct{ ReviewHash string }
	if err := readJSON(*configPath, &config); err != nil {
		return errors.New("cannot read protected rehearsal configuration")
	}
	if err := readJSON(*candidatePath, &source); err != nil {
		return errors.New("cannot read binding candidate")
	}
	if err := readJSON(*migrationPlanPath, &migration); err != nil || migration.ReviewHash == "" {
		return errors.New("cannot read verified rehearsal plan")
	}
	b, err := binding(config, source)
	if err != nil {
		return err
	}
	if err = validateFinalTestTarget(config, b, migration.ReviewHash, *finalTarget, *apply); err != nil {
		return err
	}
	mc := mysql.NewConfig()
	mc.User, mc.Passwd, mc.Net, mc.Addr, mc.DBName = config.Connection.User, config.Connection.Password, "tcp", b.Storage.Address, b.Storage.Database
	mc.Params = map[string]string{"time_zone": "'+00:00'"}
	mc.Timeout, mc.ReadTimeout, mc.WriteTimeout = 5*time.Second, 30*time.Second, 30*time.Second
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return errors.New("cannot initialize rehearsal connection")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err = verifyShadow(ctx, db, b, migration.ReviewHash); err != nil {
		return err
	}
	names := map[string][]string{"aims": aimsPilotAndCompletionViews(), "assets": enterpriseassets.ProductViewNames()}
	plans := make(map[string]e.CompatibilityViewPlan, len(names))
	for domain, logicalNames := range names {
		plan, err := e.PlanCompatibilityViews(ctx, db, b, domain, logicalNames)
		if err != nil {
			return fmt.Errorf("cannot plan %s compatibility views: %w", domain, err)
		}
		if err = e.ApplyCompatibilityViews(ctx, db, b, domain, logicalNames, plan.ReviewHash); err != nil {
			return fmt.Errorf("cannot apply %s compatibility views: %w", domain, err)
		}
		// Re-entry is the generation-zero, exact-definition verification path. It
		// performs no replacement and rejects drift or an unexpected object type.
		if err = e.ApplyCompatibilityViews(ctx, db, b, domain, logicalNames, plan.ReviewHash); err != nil {
			return fmt.Errorf("cannot verify %s compatibility views: %w", domain, err)
		}
		plans[domain] = plan
	}
	readChecks, err := verifyViewReads(ctx, db, names)
	if err != nil {
		return err
	}
	if err = verifyRuntimeBoundary(ctx, db, mc, b, names); err != nil {
		return err
	}
	result := artifact{Version: "enterprise-compatibility-rehearsal.v1", MigrationHash: migration.ReviewHash, Binding: b, Plans: plans, ReadChecks: readChecks, RuntimeVerify: "blocked as required: registry generation is 0 while runtime Binding generation is 1", ProductService: "blocked as required: NewProductService delegates to VerifyCompatibilityViews before reads"}
	raw, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(*artifactPath, append(raw, '\n'), 0600); err != nil {
		return errors.New("cannot write protected rehearsal artifact")
	}
	var count int
	for _, plan := range plans {
		count += len(plan.Views)
	}
	fmt.Printf("mode=verified-shadow views=%d aims_review_hash=%s assets_review_hash=%s target=%s generation=0\n", count, plans["aims"].ReviewHash, plans["assets"].ReviewHash, b.Storage.Database)
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
