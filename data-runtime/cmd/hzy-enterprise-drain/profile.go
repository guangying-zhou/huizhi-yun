package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

// runProfile verifies (default) or activates (--mode activate --apply
// --review-hash) the final copy for the profile tenant. The approval envelope
// must be Platform-signed by the pinned issuer key id and Ed25519 public key;
// the SQL verifier then re-checks the full closure inside the activation
// transaction exactly as in the fixed test path. There is no unsigned, self-
// signed or local-approval path.
func runProfile(profilePath, configPath, mode string, apply bool, review, fencePlanPath, finalPlanPath, approvalPath string) error {
	if configPath != "" {
		return errors.New("--profile replaces --config; pass only one")
	}
	if (mode != "verify" && mode != "activate") || (apply && mode != "activate") {
		return errors.New("explicit valid mode required")
	}
	if fencePlanPath == "" || finalPlanPath == "" || approvalPath == "" {
		return errors.New("--fence-plan, --final-plan and --approval required with --profile")
	}
	prof, err := cutoverprofile.Load(profilePath)
	if err != nil {
		return err
	}
	var source, final unified.Plan
	if err := cutoverprofile.ReadProtectedJSON(fencePlanPath, &source); err != nil {
		return errors.New("reviewed fence plan unavailable or not owner-private")
	}
	if err := cutoverprofile.ReadProtectedJSON(finalPlanPath, &final); err != nil {
		return errors.New("reviewed final plan unavailable or not owner-private")
	}
	if err := prof.CheckPlanIdentity(source); err != nil {
		return err
	}
	if err := prof.CheckPlanIdentity(final); err != nil {
		return err
	}
	spec, err := unified.BuildFenceSpec(source)
	if err != nil || final.Config != spec.Config {
		return errors.New("fence source review invalid or differs from final copy")
	}
	var envelope cutoverprofile.Envelope
	if err := cutoverprofile.ReadProtectedJSON(approvalPath, &envelope); err != nil {
		return errors.New("approval envelope unavailable or not owner-private")
	}
	payload, signature, err := prof.VerifyEnvelope(envelope)
	if err != nil {
		return err
	}
	key, _ := prof.PinnedPlatformKey()
	verifier := unified.SQLApprovedExternalDrains{Payload: payload, Signature: signature, PlatformPublicKey: key, SourceDeployments: map[string]string{"aims": prof.SourceDeployments["aims"], "assets": prof.SourceDeployments["assets"]}}
	db, err := sql.Open("mysql", prof.MySQL("").FormatDSN())
	if err != nil {
		return errors.New("database configuration unavailable")
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
	state, err := prof.InspectTarget(ctx, db)
	if err != nil {
		return cutoverprofile.Redact(err)
	}
	if !state.Exists || !state.Registry {
		return errors.New("final target has not been applied; run the reviewed final copy first")
	}
	replay := false
	if state.Generation != 0 {
		// Only the exact committed receipt for this cutover key, review hash
		// and generation may be replayed; any other active target is refused.
		replay, err = prof.ActivationReplay(ctx, db, final.ReviewHash)
		if err != nil {
			return cutoverprofile.Redact(err)
		}
		if !replay {
			return cutoverprofile.ErrTargetActive
		}
	}
	if mode == "activate" && apply {
		if err := cutoverprofile.RequireReview(apply, review, final.ReviewHash); err != nil {
			return err
		}
		receipt, err := unified.ActivateFinalCopy(ctx, db, spec, prof.CutoverKey, final, verifier)
		if err != nil {
			return fmt.Errorf("activation rejected; verify frozen source, final copy and approved external evidence: %w", cutoverprofile.Redact(err))
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"applied": true, "replayed": replay, "receipt": receipt, "profile": prof.Summary()})
	}
	if replay {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"applied": false, "alreadyActivated": true, "finalReviewHash": final.ReviewHash, "profile": prof.Summary()})
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("verification transaction unavailable")
	}
	defer tx.Rollback()
	evidence, err := verifier.VerifyExternalDrain(ctx, tx, spec, prof.CutoverKey)
	if err != nil {
		return fmt.Errorf("external verification rejected: %w", cutoverprofile.Redact(err))
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"applied": false, "externalEvidenceVerified": true, "evidenceHash": evidence, "finalReviewHash": final.ReviewHash, "profile": prof.Summary()})
}
