package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"syscall"
	"time"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseviews"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

// viewsReview binds both domain view plans to the verified final migration and
// the exact binding. It is the single hash an operator reviews before --apply.
type viewsReview struct {
	Version       string            `json:"version"`
	MigrationHash string            `json:"migrationReviewHash"`
	Binding       e.Binding         `json:"binding"`
	PlanHashes    map[string]string `json:"planHashes"`
}

func viewsReviewHash(migrationHash string, b e.Binding, plans map[string]e.CompatibilityViewPlan) string {
	r := viewsReview{Version: "enterprise-compatibility-views-review.v1", MigrationHash: migrationHash, Binding: b, PlanHashes: map[string]string{}}
	for domain, plan := range plans {
		r.PlanHashes[domain] = plan.ReviewHash
	}
	raw, _ := json.Marshal(r)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

type profileArtifact struct {
	artifact
	Profile         string `json:"profile"`
	ViewsReviewHash string `json:"viewsReviewHash"`
	Applied         bool   `json:"applied"`
}

func writeArtifact(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	fd, err := syscall.Open(path, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_TRUNC|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return errors.New("cannot write protected artifact")
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	if info, err := f.Stat(); err != nil || !info.Mode().IsRegular() || f.Chmod(0600) != nil {
		return errors.New("cannot write protected artifact")
	}
	_, err = f.Write(append(raw, '\n'))
	return err
}

// runProfile plans (default) or installs (--apply --review-hash) the same
// compatibility views into the verified generation-zero final target of the
// profile tenant. No hardcoded C000001 hash applies; the reviewed hash is the
// combined view plan hash printed by the plan run.
func runProfile(profilePath, configPath, candidatePath, migrationPlanPath, artifactPath string, finalTarget, apply bool, review string) error {
	if configPath != "" || finalTarget {
		return errors.New("--profile replaces --config and --final-test-target")
	}
	if candidatePath == "" || migrationPlanPath == "" || artifactPath == "" {
		return errors.New("profile, binding-candidate, migration-plan and artifact are required")
	}
	prof, err := cutoverprofile.Load(profilePath)
	if err != nil {
		return err
	}
	var source candidate
	if err := cutoverprofile.ReadProtectedJSON(candidatePath, &source); err != nil {
		return errors.New("cannot read protected binding candidate")
	}
	var migration unified.Plan
	if err := cutoverprofile.ReadProtectedJSON(migrationPlanPath, &migration); err != nil {
		return errors.New("cannot read protected verified final plan")
	}
	if err := prof.CheckPlanIdentity(migration); err != nil {
		return err
	}
	if source.Enterprise.DB.Database != prof.Target {
		return errors.New("binding candidate database differs from profile target")
	}
	var c rehearsalConfig
	m := prof.Migration()
	c.Migration.Tenant, c.Migration.Environment, c.Migration.RuntimeDeployment, c.Migration.InstanceID, c.Migration.SchemaVersion = m.Tenant, m.Environment, m.RuntimeDeployment, m.InstanceID, m.SchemaVersion
	c.Migration.SourceAims, c.Migration.SourceAssets, c.Migration.Target, c.Migration.Generation = m.SourceAims, m.SourceAssets, m.Target, m.Generation
	c.Connection.Host, c.Connection.Port = prof.Connection.Host, prof.Connection.Port
	b, err := binding(c, source)
	if err != nil {
		return err
	}
	if err := prof.CheckBinding(b, prof.Generation); err != nil {
		return err
	}
	mc := prof.MySQL(prof.Target)
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return errors.New("cannot initialize migration connection")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
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
	if err := verifyShadow(ctx, db, b, migration.ReviewHash); err != nil {
		return err
	}
	names, err := enterpriseviews.Install(b)
	if err != nil {
		return err
	}
	plans := make(map[string]e.CompatibilityViewPlan, len(names))
	domains := []string{"aims", "assets"}
	sort.Strings(domains)
	for _, domain := range domains {
		plan, err := e.PlanCompatibilityViews(ctx, db, b, domain, names[domain])
		if err != nil {
			return fmt.Errorf("cannot plan %s compatibility views: %w", domain, cutoverprofile.Redact(err))
		}
		plans[domain] = plan
	}
	combined := viewsReviewHash(migration.ReviewHash, b, plans)
	count := 0
	for _, plan := range plans {
		count += len(plan.Views)
	}
	result := profileArtifact{artifact: artifact{Version: "enterprise-compatibility-profile.v1", MigrationHash: migration.ReviewHash, Binding: b, Plans: plans, MappingHash: enterpriseviews.MappingHash(b)}, Profile: prof.Summary(), ViewsReviewHash: combined}
	if !apply {
		if review != "" {
			return errors.New("--review-hash requires --apply")
		}
		if err := writeArtifact(artifactPath, result); err != nil {
			return err
		}
		fmt.Printf("mode=plan applied=false views=%d review_hash=%s mapping_hash=%s %s\n", count, combined, result.MappingHash, prof.Summary())
		return nil
	}
	if err := cutoverprofile.RequireReview(apply, review, combined); err != nil {
		return err
	}
	for _, domain := range domains {
		plan := plans[domain]
		if err := e.ApplyCompatibilityViews(ctx, db, b, domain, names[domain], plan.ReviewHash); err != nil {
			return fmt.Errorf("cannot apply %s compatibility views: %w", domain, cutoverprofile.Redact(err))
		}
		// Re-entry is the generation-zero exact-definition verification path.
		if err := e.ApplyCompatibilityViews(ctx, db, b, domain, names[domain], plan.ReviewHash); err != nil {
			return fmt.Errorf("cannot verify %s compatibility views: %w", domain, cutoverprofile.Redact(err))
		}
	}
	readChecks, err := verifyViewReads(ctx, db, names)
	if err != nil {
		return cutoverprofile.Redact(err)
	}
	if err := verifyRuntimeBoundary(ctx, db, mc, b, names); err != nil {
		return cutoverprofile.Redact(err)
	}
	result.ReadChecks, result.Applied = readChecks, true
	result.RuntimeVerify = "blocked as required: registry generation is 0 while runtime Binding generation is non-zero"
	result.ProductService = "blocked as required: NewProductService delegates to VerifyCompatibilityViews before reads"
	if err := writeArtifact(artifactPath, result); err != nil {
		return err
	}
	fmt.Printf("mode=verified-shadow applied=true views=%d review_hash=%s aims_review_hash=%s assets_review_hash=%s mapping_hash=%s generation=0 %s\n", count, combined, plans["aims"].ReviewHash, plans["assets"].ReviewHash, result.MappingHash, prof.Summary())
	return nil
}
