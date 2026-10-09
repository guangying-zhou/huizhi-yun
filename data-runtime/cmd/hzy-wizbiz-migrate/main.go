// hzy-wizbiz-migrate is an offline, profile-only migration tool. No dotenv,
// environment database or live OA connection fallback exists.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool"
	"os"
	"strings"
	"syscall"
	"time"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string) error {
	flags := flag.NewFlagSet("hzy-wizbiz-migrate", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	mode := flags.String("mode", "", "stage-verify, stage-transform-audit, plan, apply, verify, rollback or status")
	profilePath := flags.String("profile", "", "protected profile")
	manifestPath := flags.String("snapshot-manifest", "", "protected snapshot metadata")
	receiptPath := flags.String("stage-receipt", "", "protected source receipt")
	identityPath := flags.String("identity-confirmed", "", "protected confirmed identity map")
	planPath := flags.String("plan", "", "protected reviewed plan")
	openingPath := flags.String("opening-plan", "", "protected reviewed opening plan")
	confirmationPath := flags.String("opening-confirmation", "", "protected finance or user-ruling snapshot confirmation")
	auditPath := flags.String("followup-audit", "", "protected attribution of approved post-migration business changes")
	baselineConfig := flags.String("baseline-runtime-config", "", "original protected Runtime config for strictly bounded follow-up comparison")
	upgradePath := flags.String("vault-upgrade-plan", "", "protected supplemental Vault plan")
	approvalPath := flags.String("vault-upgrade-approval", "", "protected environment-specific approval record")
	reviewHash := flags.String("review-hash", "", "approved plan hash")
	output := flags.String("out", "", "new 0600 output file")
	if flags.Parse(args) != nil || flags.NArg() != 0 || (*mode != "vault-upgrade-plan" && *mode != "vault-upgrade-apply" && *mode != "vault-upgrade-verify" && *mode != "vault-upgrade-rollback" && *mode != "stage-verify" && *mode != "stage-transform-audit" && *mode != "plan" && *mode != "apply" && *mode != "verify" && *mode != "rollback" && *mode != "status" && *mode != "opening-derive" && *mode != "opening-plan" && *mode != "opening-apply" && *mode != "opening-verify" && *mode != "opening-rollback") || *output == "" {
		return wizbiztool.ErrInput
	}
	var profile wizbiztool.Profile
	profileHash, err := wizbiztool.ReadJSON(*profilePath, &profile, 64<<10)
	if err != nil || profile.Validate() != nil {
		return wizbiztool.ErrProfile
	}
	var manifest wizbiztool.SnapshotManifest
	manifestHash, err := wizbiztool.ReadJSON(*manifestPath, &manifest, 32<<20)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	sourceDB, err := profile.Source.Open()
	if err != nil {
		return err
	}
	defer sourceDB.Close()
	source, err := wizbiztool.OpenSourceSnapshot(ctx, sourceDB, profile.Source.Database)
	if err != nil {
		return err
	}
	defer source.Close()
	metadata, err := profile.SourceMetadata.Open()
	if err != nil {
		return err
	}
	defer metadata.Close()
	if err = source.AttachMetadata(ctx, metadata); err != nil {
		return err
	}
	if *mode == "stage-transform-audit" {
		receipt, err := source.VerifyStage(ctx, manifest, manifestHash)
		if err != nil {
			return err
		}
		audit, err := wizbiztool.AuditStageTransforms(ctx, source, manifest, profile)
		if err != nil {
			return err
		}
		audit.SnapshotSHA256 = receipt.SQLSHA256
		audit.ManifestSHA256 = manifestHash
		if err = wizbiztool.WriteJSON(*output, audit); err != nil {
			return err
		}
		if err = json.NewEncoder(os.Stdout).Encode(audit); err != nil {
			return err
		}
		if !audit.Ready {
			return wizbiztool.ErrValue
		}
		return nil
	}
	if *mode == "stage-verify" {
		receipt, err := source.VerifyStage(ctx, manifest, manifestHash)
		if err != nil {
			return err
		}
		if err = wizbiztool.WriteJSON(*output, receipt); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"mode": *mode, "tables": len(receipt.Tables), "status": "verified"})
	}
	var receipt wizbiztool.StageReceipt
	if _, err = wizbiztool.ReadJSON(*receiptPath, &receipt, 32<<20); err != nil {
		return err
	}
	confirmations := map[string]wizbiztool.IdentityConfirmation{}
	identityHash, err := wizbiztool.ReadJSON(*identityPath, &confirmations, 8<<20)
	if err != nil {
		return err
	}
	build, err := wizbiztool.ReadTargetRuntimeBuild(profile.RuntimeBinary, profile.SourceRepository)
	if err != nil {
		return err
	}
	target, err := profile.Target.Open()
	if err != nil {
		return err
	}
	defer target.Close()
	directory, err := profile.Directory.Open()
	if err != nil {
		return err
	}
	defer directory.Close()

	var audit *wizbiztool.FollowupAudit
	if *auditPath != "" {
		audit = &wizbiztool.FollowupAudit{}
		if _, err = wizbiztool.ReadJSON(*auditPath, audit, 1<<20); err != nil {
			return err
		}
	}
	if strings.HasPrefix(*mode, "vault-upgrade-") {
		var main wizbiztool.Plan
		if _, err = wizbiztool.ReadJSON(*planPath, &main, 64<<20); err != nil || wizbiztool.ReviewPlan(main, main.ReviewHash) != nil {
			return wizbiztool.ErrInput
		}
		var p wizbiztool.VaultUpgradePlan
		var approval wizbiztool.Approval
		if *mode == "vault-upgrade-plan" {
			if _, err = wizbiztool.ReadJSON(*approvalPath, &approval, 64<<10); err != nil {
				return err
			}
		} else {
			if _, err = wizbiztool.ReadJSON(*upgradePath, &p, 8<<20); err != nil || wizbiztool.ReviewVaultUpgradePlan(p, *reviewHash) != nil {
				return wizbiztool.ErrInput
			}
		}
		fd, err := syscall.Open(*output, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
		if err != nil {
			return wizbiztool.ErrProfile
		}
		f := os.NewFile(uintptr(fd), *output)
		defer f.Close()
		result, operationErr := wizbiztool.ExecuteVaultUpgrade(ctx, wizbiztool.OpeningInputs{FollowupAudit: audit, BaselineRuntimeConfig: *baselineConfig, Source: source, Target: target, Directory: directory, Profile: profile, ProfileHash: profileHash, Manifest: manifest, ManifestHash: manifestHash, Identities: confirmations, IdentityHash: identityHash, MainPlan: main}, *mode, p, *reviewHash, approval)
		if json.NewEncoder(f).Encode(result) != nil || f.Sync() != nil {
			return wizbiztool.ErrProfile
		}
		state := "completed"
		if operationErr != nil {
			state = "failed"
		}
		if json.NewEncoder(os.Stdout).Encode(map[string]any{"mode": *mode, "status": state}) != nil {
			return wizbiztool.ErrProfile
		}
		return operationErr
	}
	if strings.HasPrefix(*mode, "opening-") {
		var main wizbiztool.Plan
		if _, err = wizbiztool.ReadJSON(*planPath, &main, 64<<20); err != nil || wizbiztool.ReviewPlan(main, main.ReviewHash) != nil {
			return wizbiztool.ErrInput
		}
		var confirmation wizbiztool.OpeningConfirmation
		cHash, err := wizbiztool.ReadJSON(*confirmationPath, &confirmation, 8<<20)
		if err != nil {
			return err
		}
		if *mode == "opening-derive" {
			result, err := wizbiztool.DeriveOpeningConfirmation(ctx, source, manifest, manifestHash, main, confirmation)
			if err != nil {
				return err
			}
			if err = wizbiztool.WriteJSON(*output, result); err != nil {
				return err
			}
			return json.NewEncoder(os.Stdout).Encode(map[string]any{"mode": *mode, "status": "derived", "contracts": len(result.Contracts), "sourceType": result.SourceType})
		}
		var opening wizbiztool.OpeningPlan
		if *mode != "opening-plan" {
			if _, err = wizbiztool.ReadJSON(*openingPath, &opening, 64<<20); err != nil || wizbiztool.ReviewOpeningPlan(opening, *reviewHash) != nil {
				return wizbiztool.ErrInput
			}
		}
		fd, err := syscall.Open(*output, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
		if err != nil {
			return wizbiztool.ErrProfile
		}
		file := os.NewFile(uintptr(fd), *output)
		defer file.Close()
		result, operationErr := wizbiztool.ExecuteOpening(ctx, wizbiztool.OpeningInputs{FollowupAudit: audit, BaselineRuntimeConfig: *baselineConfig, Source: source, Target: target, Directory: directory, Profile: profile, ProfileHash: profileHash, Manifest: manifest, ManifestHash: manifestHash, Identities: confirmations, IdentityHash: identityHash, MainPlan: main, Confirmation: confirmation, ConfirmationHash: cHash}, *mode, opening, *reviewHash)
		if json.NewEncoder(file).Encode(result) != nil || file.Sync() != nil {
			return wizbiztool.ErrProfile
		}
		state := "completed"
		if operationErr != nil {
			state = "failed"
		}
		if json.NewEncoder(os.Stdout).Encode(map[string]any{"mode": *mode, "status": state}) != nil {
			return wizbiztool.ErrProfile
		}
		return operationErr
	}
	if *mode != "plan" {
		var plan wizbiztool.Plan
		if _, err = wizbiztool.ReadJSON(*planPath, &plan, 64<<20); err != nil || wizbiztool.ReviewPlan(plan, *reviewHash) != nil {
			return wizbiztool.ErrInput
		}
		// Reserve the protected receipt before any write. Keep this descriptor
		// open so replacing its pathname cannot redirect the eventual output.
		fd, openErr := syscall.Open(*output, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
		if openErr != nil {
			return wizbiztool.ErrProfile
		}
		file := os.NewFile(uintptr(fd), *output)
		defer file.Close()
		var result any
		switch *mode {
		case "apply":
			result, err = wizbiztool.ExecuteApply(ctx, source, target, directory, profile, profileHash, manifest, manifestHash, confirmations, identityHash, plan, *reviewHash)
		case "verify":
			result, err = wizbiztool.ExecuteVerify(ctx, source, target, directory, profile, profileHash, manifest, manifestHash, confirmations, identityHash, plan, *reviewHash, *baselineConfig)
		case "rollback":
			result, err = wizbiztool.ExecuteRollback(ctx, target, profile, plan, *reviewHash)
		case "status":
			result, err = wizbiztool.ExecuteStatus(ctx, target, profile, plan, *reviewHash)
		}
		if encodeErr := json.NewEncoder(file).Encode(result); encodeErr != nil {
			return wizbiztool.ErrProfile
		}
		if file.Sync() != nil {
			return wizbiztool.ErrProfile
		}
		state := "completed"
		if err != nil {
			state = "failed"
		}
		if json.NewEncoder(os.Stdout).Encode(map[string]any{"mode": *mode, "status": state}) != nil {
			return wizbiztool.ErrProfile
		}
		return err
	}
	plan, err := wizbiztool.BuildPlan(ctx, source, target, directory, profile, profileHash, manifest, manifestHash, receipt, confirmations, identityHash, build)
	if err != nil {
		return err
	}
	if err = wizbiztool.WritePlanArtifacts(*output, plan); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"mode": *mode, "objects": len(plan.Objects), "coverageFields": len(plan.Coverage), "reviewHash": plan.ReviewHash})
}
