package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

// runProfile is the profile form of the shadow-copy command. Dry-run writes a
// reviewable plan; --apply copies only a post-fence final plan (both sources
// fenced with the profile cutover key) into a target that is not already
// active, with the exact reviewed hash. Recovery keeps its own reviewed
// contract and is not reachable from a forward-cutover profile.
func runProfile(profilePath, configPath, planPath string, recovery, apply bool, approved string) error {
	if configPath != "" {
		return errors.New("--profile replaces --config; pass only one")
	}
	if recovery {
		return errors.New("recovery uses its own reviewed recovery contract (--config), not a forward-cutover profile")
	}
	if planPath == "" {
		return errors.New("--profile and --plan required; default operation is dry-run")
	}
	prof, err := cutoverprofile.Load(profilePath)
	if err != nil {
		return err
	}
	var plan unified.Plan
	if apply {
		if err := cutoverprofile.ReadProtectedJSON(planPath, &plan); err != nil {
			return errors.New("reviewed plan unavailable or not owner-private")
		}
		if err := prof.CheckPlanIdentity(plan); err != nil {
			return err
		}
		if err := cutoverprofile.RequireReview(apply, approved, plan.ReviewHash); err != nil {
			return err
		}
	}
	db, err := sql.Open("mysql", prof.MySQL("").FormatDSN())
	if err != nil {
		return errors.New("cannot initialize migration connection")
	}
	defer db.Close()
	db.SetMaxOpenConns(3)
	ctx, cancel := unified.BoundContext(context.Background())
	defer cancel()
	if err := cutoverprofile.CheckAccount(ctx, db); err != nil {
		return err
	}
	if err := prof.CheckInstance(ctx, db); err != nil {
		return err
	}
	if _, err := prof.RequireInactiveTarget(ctx, db); err != nil {
		return err
	}
	if apply {
		if err := prof.RequireFencedSources(ctx, db); err != nil {
			return err
		}
		if err := unified.Apply(ctx, db, plan, approved); err != nil {
			return fmt.Errorf("apply rejected or interrupted; inspect target ledger and re-plan if source changed: %w", err)
		}
	} else {
		plan, err = unified.Prepare(ctx, db, prof.Migration())
		if err != nil {
			return fmt.Errorf("dry-run failed: %w", err)
		}
		data, err := json.MarshalIndent(plan, "", "  ")
		if err != nil {
			return err
		}
		if err := writePrivate(planPath, append(data, '\n')); err != nil {
			return errors.New("cannot write review plan")
		}
	}
	var rows uint64
	for _, t := range plan.Tables {
		rows += t.Count
	}
	fmt.Printf("mode=%s tables=%d rows=%d blocking_conflicts=%d review_hash=%s %s\n", map[bool]string{false: "dry-run", true: "verified-shadow"}[apply], len(plan.Tables), rows, len(plan.BlockingConflicts), plan.ReviewHash, prof.Summary())
	fmt.Println("Target generation is 0; no runtime route or credential changed.")
	return nil
}

// writePrivate replaces path with an owner-only file and never follows a
// symlink at the destination.
func writePrivate(path string, raw []byte) error {
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return errors.New("plan output must be a regular file")
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".enterprise-plan-")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if _, err = tmp.Write(raw); err == nil {
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
