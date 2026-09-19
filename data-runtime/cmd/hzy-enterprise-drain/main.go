// hzy-enterprise-drain defaults to transactionally rechecking an approved
// external-evidence report. Only explicit activate + apply writes final-copy state.
package main

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"github.com/go-sql-driver/mysql"
	runtimeconfig "github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
	"os"
	"time"
)

type localInput struct {
	RuntimeConfigPath, FencePlanPath, FinalPlanPath, ApprovalPath, CutoverKey, PinnedPlatformPublicKey string
	Database                                                                                           mysql.Config
}

func readJSON(path string, value any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return errors.New("required local artifact unavailable")
	}
	if json.Unmarshal(raw, value) != nil {
		return errors.New("local artifact invalid")
	}
	return nil
}
func run() error {
	path := flag.String("config", "", "protected local configuration file")
	mode := flag.String("mode", "verify", "verify or activate")
	apply := flag.Bool("apply", false, "commit final-copy activation only")
	review := flag.String("review-hash", "", "exact final-copy review hash for activation")
	flag.Parse()
	if *path == "" || (*mode != "verify" && *mode != "activate") || (*apply && *mode != "activate") {
		return errors.New("explicit valid mode/config required")
	}
	meta, err := os.Stat(*path)
	if err != nil || meta.Mode().Perm()&0077 != 0 {
		return errors.New("configuration must be private to its owner")
	}
	var input localInput
	if err := readJSON(*path, &input); err != nil {
		return err
	}
	var runtime runtimeconfig.Config
	if err := readJSON(input.RuntimeConfigPath, &runtime); err != nil {
		return err
	}
	var source, final unified.Plan
	if err := readJSON(input.FencePlanPath, &source); err != nil {
		return err
	}
	if err := readJSON(input.FinalPlanPath, &final); err != nil {
		return err
	}
	spec, err := unified.BuildFenceSpec(source)
	if err != nil {
		return errors.New("fence source review invalid")
	}
	if runtime.Tenant != spec.Config.Tenant || runtime.Deployment != spec.Config.RuntimeDeployment || runtime.Apps.Aims.DB.Database != spec.Config.SourceAims || runtime.Apps.Assets.DB.Database != spec.Config.SourceAssets || final.Config != spec.Config || unified.ReviewHash(final) != final.ReviewHash {
		return errors.New("local Runtime/source/final identity mismatch")
	}
	var envelope struct{ Payload, Signature, Alg string }
	if err := readJSON(input.ApprovalPath, &envelope); err != nil {
		return err
	}
	key, err := base64.RawURLEncoding.DecodeString(input.PinnedPlatformPublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize || envelope.Alg != "Ed25519" {
		return errors.New("local pinned Platform key required")
	}
	signature, err := base64.RawURLEncoding.DecodeString(envelope.Signature)
	if err != nil {
		return errors.New("approval signature invalid")
	}
	verifier := unified.SQLApprovedExternalDrains{Payload: []byte(envelope.Payload), Signature: signature, PlatformPublicKey: ed25519.PublicKey(key), SourceDeployments: map[string]string{"aims": runtime.DeploymentBindings["aims"], "assets": runtime.DeploymentBindings["assets"]}}
	input.Database.Params = map[string]string{"time_zone": "'+00:00'"}
	input.Database.Timeout = 5 * time.Second
	db, err := sql.Open("mysql", input.Database.FormatDSN())
	if err != nil {
		return errors.New("database configuration unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if *mode == "activate" && *apply {
		if *review != final.ReviewHash {
			return errors.New("exact final review hash required")
		}
		receipt, err := unified.ActivateFinalCopy(ctx, db, spec, input.CutoverKey, final, verifier)
		if err != nil {
			return errors.New("activation rejected; verify frozen source, final copy and approved external evidence")
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"applied": true, "receipt": receipt})
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return errors.New("verification transaction unavailable")
	}
	defer tx.Rollback()
	evidence, err := verifier.VerifyExternalDrain(ctx, tx, spec, input.CutoverKey)
	if err != nil {
		return fmt.Errorf("external verification rejected: %w", err)
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"applied": false, "externalEvidenceVerified": true, "evidenceHash": evidence, "finalReviewHash": final.ReviewHash})
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
