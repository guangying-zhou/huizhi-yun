// hzy-enterprise-test-cutover performs only the reviewed C000001 test cutover
// preparation phases. It never activates a target, changes Runtime config, or
// publishes a route.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

type localConfig struct {
	Migration  unified.Config
	Connection struct {
		Host           string
		Port           int
		User, Password string
	}
}

func atomicJSON(path string, value any) error {
	if path == "" {
		return errors.New("output path required")
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".enterprise-cutover-")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err = tmp.Write(append(raw, '\n')); err == nil {
		err = tmp.Chmod(0600)
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, path)
}

func readPlan(path string) (unified.Plan, error) {
	var p unified.Plan
	raw, err := os.ReadFile(path)
	if err != nil {
		return p, errors.New("reviewed source plan unavailable")
	}
	if json.Unmarshal(raw, &p) != nil {
		return p, errors.New("reviewed source plan invalid")
	}
	return p, nil
}

func validateC000001TestPlan(p unified.Plan, expected unified.Config, review string, phase string, apply bool, key string) error {
	if expected != p.Config || p.ReviewHash == "" || unified.ReviewHash(p) != p.ReviewHash || review != p.ReviewHash {
		return errors.New("exact approved source review and matching local migration required")
	}
	if p.Config.Tenant != "C000001" || p.Config.Environment != "test" || p.Config.RuntimeDeployment != "c000001-test-tenant-runtime" || p.Config.SourceAims != "hzy_aims_test_local_20260910" || p.Config.SourceAssets != "hzy_assets_test_local_20260910" || p.Config.Target != "hzy_enterprise_shadow_review_20260913" || strings.Contains(p.Config.Target, "rehearsal") {
		return errors.New("approved C000001 test source and final target required")
	}
	if phase != "plan" && (!apply || strings.TrimSpace(key) == "") {
		return errors.New("--apply and stable --cutover-key required for write phase")
	}
	return nil
}

func run() error {
	configPath := flag.String("config", "", "private C000001 test migration config")
	sourcePath := flag.String("source-plan", "", "reviewed source migration plan")
	output := flag.String("output", "", "fence or final plan output")
	phase := flag.String("phase", "plan", "plan, install-fence, fence, or prepare-final")
	apply := flag.Bool("apply", false, "permit the named maintenance phase")
	review := flag.String("source-review-hash", "", "exact approved source plan SHA-256")
	key := flag.String("cutover-key", "", "stable cutover key required for fenced phases")
	flag.Parse()
	if *configPath == "" || *sourcePath == "" || *output == "" {
		return errors.New("config, source-plan and output required")
	}
	if *phase != "plan" && *phase != "install-fence" && *phase != "fence" && *phase != "prepare-final" {
		return errors.New("invalid phase")
	}
	meta, statErr := os.Stat(*configPath)
	if statErr != nil || !meta.Mode().IsRegular() || meta.Mode().Perm()&0077 != 0 {
		return errors.New("configuration must be an owner-private file")
	}
	var c localConfig
	raw, err := os.ReadFile(*configPath)
	if err != nil || json.Unmarshal(raw, &c) != nil {
		return errors.New("private migration config invalid")
	}
	p, err := readPlan(*sourcePath)
	if err != nil {
		return err
	}
	if err = validateC000001TestPlan(p, c.Migration, *review, *phase, *apply, *key); err != nil {
		return err
	}
	s, err := unified.BuildFenceSpec(p)
	if err != nil {
		return errors.New("source fence contract invalid")
	}
	if *phase == "plan" {
		return atomicJSON(*output, s)
	}
	mc := mysql.NewConfig()
	mc.User, mc.Passwd, mc.Net, mc.Addr = c.Connection.User, c.Connection.Password, "tcp", fmt.Sprintf("%s:%d", c.Connection.Host, c.Connection.Port)
	mc.Params = map[string]string{"time_zone": "'+00:00'"}
	mc.Timeout = 5 * time.Second
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return errors.New("migration database unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	switch *phase {
	case "install-fence":
		err = unified.InstallSourceFence(ctx, db, s)
	case "fence":
		err = unified.FenceSources(ctx, db, s, *key)
	case "prepare-final":
		var final unified.Plan
		final, err = unified.PrepareFinalCopy(ctx, db, s, *key)
		if err == nil {
			return atomicJSON(*output, final)
		}
	}
	if err != nil {
		return errors.New("cutover phase rejected")
	}
	return atomicJSON(*output, s)
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
