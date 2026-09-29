package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

// validateProfilePlan is the profile form of validateC000001TestPlan: the
// fixed C000001/test constants are replaced by the protected profile identity;
// the review, --apply and stable cutover key requirements are unchanged.
func validateProfilePlan(prof cutoverprofile.Profile, p unified.Plan, review, phase string, apply bool, key string) error {
	if err := prof.CheckPlanIdentity(p); err != nil {
		return err
	}
	if review != p.ReviewHash {
		return errors.New("exact approved source review hash required")
	}
	if key != "" && key != prof.CutoverKey {
		return errors.New("--cutover-key differs from the reviewed profile cutover key")
	}
	if phase != "plan" && !apply {
		return errors.New("--apply required for write phase")
	}
	return nil
}

// runProfile runs the same install-fence/fence/prepare-final phases for the
// profile tenant. It adds read-only guards before any write: least-privilege
// account, instance identity, no active target generation and no foreign
// source fence.
func runProfile(profilePath, configPath, sourcePath, output, phase string, apply bool, review, key string) error {
	if configPath != "" {
		return errors.New("--profile replaces --config; pass only one")
	}
	if sourcePath == "" || output == "" {
		return errors.New("profile, source-plan and output required")
	}
	if phase != "plan" && phase != "install-fence" && phase != "fence" && phase != "prepare-final" {
		return errors.New("invalid phase")
	}
	prof, err := cutoverprofile.Load(profilePath)
	if err != nil {
		return err
	}
	var p unified.Plan
	if err := cutoverprofile.ReadProtectedJSON(sourcePath, &p); err != nil {
		return errors.New("reviewed source plan unavailable or not owner-private")
	}
	if err := validateProfilePlan(prof, p, review, phase, apply, key); err != nil {
		return err
	}
	s, err := unified.BuildFenceSpec(p)
	if err != nil {
		return errors.New("source fence contract invalid")
	}
	if phase == "plan" {
		if err := atomicJSON(output, s); err != nil {
			return err
		}
		fmt.Printf("phase=plan applied=false contract_hash=%s source_review_hash=%s %s\n", s.ContractHash, p.ReviewHash, prof.Summary())
		return nil
	}
	db, err := sql.Open("mysql", prof.MySQL("").FormatDSN())
	if err != nil {
		return errors.New("migration database unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := cutoverprofile.CheckAccount(ctx, db); err != nil {
		return cutoverprofile.Redact(err)
	}
	if err := prof.CheckInstance(ctx, db); err != nil {
		return cutoverprofile.Redact(err)
	}
	if _, err := prof.RequireInactiveTarget(ctx, db); err != nil {
		return cutoverprofile.Redact(err)
	}
	if err := prof.CheckSourceFences(ctx, db); err != nil {
		return cutoverprofile.Redact(err)
	}
	switch phase {
	case "install-fence":
		err = unified.InstallSourceFence(ctx, db, s)
	case "fence":
		err = unified.FenceSources(ctx, db, s, prof.CutoverKey)
	case "prepare-final":
		var final unified.Plan
		final, err = unified.PrepareFinalCopy(ctx, db, s, prof.CutoverKey)
		if err == nil {
			if err = atomicJSON(output, final); err != nil {
				return err
			}
			fmt.Printf("phase=prepare-final applied=false final_review_hash=%s tables=%d blocking_conflicts=%d %s\n", final.ReviewHash, len(final.Tables), len(final.BlockingConflicts), prof.Summary())
			return nil
		}
	}
	if err != nil {
		return fmt.Errorf("cutover phase rejected: %w", cutoverprofile.Redact(err))
	}
	if err := atomicJSON(output, s); err != nil {
		return err
	}
	fmt.Printf("phase=%s applied=true contract_hash=%s %s\n", phase, s.ContractHash, prof.Summary())
	return nil
}
