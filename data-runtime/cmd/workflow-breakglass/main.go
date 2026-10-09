// workflow-breakglass is an offline, approval-bound maintenance command.
// It must never run as part of Runtime startup or a scheduled worker.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
)

type approvalFile struct {
	Stage            string `json:"stage"`
	CaseID           string `json:"caseId"`
	ApprovalID       string `json:"approvalId"`
	ApprovalRecordID string `json:"approvalRecordId"`
	OperatorID       string `json:"operatorId"`
	TenantCode       string `json:"tenantCode"`
	DeploymentCode   string `json:"deploymentCode"`
	EffectKind       string `json:"effectKind"`
	EffectID         string `json:"effectId"`
	Database         string `json:"database"`
	DBHost           string `json:"dbHost"`
	DBPort           int    `json:"dbPort"`
	ServerUUID       string `json:"serverUuid"`
	SecretFile       string `json:"secretFile"`
	ExpiresAtUTC     string `json:"expiresAtUtc"`
}

func protectedFile(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || !ok || stat.Uid != uint32(os.Getuid()) {
		return nil, errors.New("protected file must be regular and owner-only")
	}
	return os.ReadFile(path)
}

func protectedDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.IsDir() || info.Mode().Perm() != 0700 || !ok || stat.Uid != uint32(os.Getuid()) {
		return errors.New("secret directory must be owner-only")
	}
	return nil
}

func caseSecretPath(runtimeRoot, caseID string) string {
	return filepath.Join(runtimeRoot, "breakglass", caseID, "credential.json")
}

func prepareCaseSecretDirectory(runtimeRoot, caseID string) error {
	if err := protectedDirectory(runtimeRoot); err != nil {
		return err
	}
	for _, dir := range []string{filepath.Join(runtimeRoot, "breakglass"), filepath.Join(runtimeRoot, "breakglass", caseID)} {
		if err := os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
			return err
		}
		if err := protectedDirectory(dir); err != nil {
			return err
		}
	}
	return nil
}

func writeSecretFile(path, clientID, secret string) (func(), error) {
	if err := protectedDirectory(filepath.Dir(path)); err != nil {
		return nil, err
	}
	var err error
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	cleanup := func() { _ = os.Remove(path) }
	encoded, err := json.Marshal(map[string]string{"client_id": clientID, "client_secret": secret})
	if err == nil {
		_, err = f.Write(append(encoded, '\n'))
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		cleanup()
		return nil, err
	}
	return cleanup, nil
}

func run() error {
	stage := flag.String("stage", "", "prepare, activate or retire")
	profile := flag.String("profile", "", "owner-only Runtime config.json")
	vaultKey := flag.String("vault-key-file", "", "owner-only Console Vault master key file")
	approval := flag.String("approval-file", "", "owner-only stage approval record")
	secretOut := flag.String("secret-out", "", "owner-only new file; activate only")
	execute := flag.Bool("execute", false, "explicitly execute the approved stage")
	flag.Parse()
	if !*execute || (*stage != "prepare" && *stage != "activate" && *stage != "retire") ||
		*profile == "" || *vaultKey == "" || *approval == "" ||
		(*stage != "prepare") != (*secretOut != "") || flag.NArg() != 0 {
		return errors.New("stage, protected files and explicit --execute required")
	}
	if !filepath.IsAbs(*profile) || !filepath.IsAbs(*vaultKey) || !filepath.IsAbs(*approval) ||
		(*secretOut != "" && !filepath.IsAbs(*secretOut)) {
		return errors.New("all protected paths must be absolute")
	}
	approvalBytes, err := protectedFile(*approval)
	if err != nil {
		return err
	}
	var record approvalFile
	decoder := json.NewDecoder(bytes.NewReader(approvalBytes))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&record); err != nil || record.Stage != *stage || record.ApprovalID == "" {
		return errors.New("approval record invalid or for another stage")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("approval record contains trailing data")
	}
	if record.SecretFile != *secretOut {
		return errors.New("approved secret file differs from command target")
	}
	runtimeRoot := filepath.Clean(filepath.Dir(*profile))
	if runtimeRoot == "/tmp" || runtimeRoot == "/private/tmp" || strings.HasPrefix(runtimeRoot, "/tmp/") ||
		strings.HasPrefix(runtimeRoot, "/private/tmp/") {
		return errors.New("Runtime protected root cannot be temporary storage")
	}
	if *stage != "prepare" && *secretOut != caseSecretPath(runtimeRoot, record.CaseID) {
		return errors.New("secret file must be in this Runtime case directory")
	}
	expiresAt, err := time.Parse(time.RFC3339, record.ExpiresAtUTC)
	if err != nil || time.Now().UTC().After(expiresAt) || time.Until(expiresAt) > time.Hour {
		return errors.New("approval record expired or validity exceeds one hour")
	}
	configBytes, err := protectedFile(*profile)
	if err != nil {
		return err
	}
	var cfg config.Config
	if err = json.Unmarshal(configBytes, &cfg); err != nil {
		return err
	}
	keyBytes, err := protectedFile(*vaultKey)
	if err != nil || len(strings.TrimSpace(string(keyBytes))) < 32 {
		return errors.New("protected Vault key missing")
	}
	if record.TenantCode != cfg.Tenant || record.Database != cfg.Apps.Console.DB.Database ||
		record.DBHost != cfg.Apps.Console.DB.Host || record.DBPort != cfg.Apps.Console.DB.Port ||
		record.ServerUUID == "" {
		return errors.New("approval target does not match local Runtime profile")
	}
	boundWorkflow := cfg.DeploymentBindings["workflow"]
	if overlayBytes, overlayErr := protectedFile(filepath.Join(filepath.Dir(*profile), "deployment-bindings.json")); overlayErr == nil {
		var bindings map[string]string
		if json.Unmarshal(overlayBytes, &bindings) != nil {
			return errors.New("deployment bindings overlay invalid")
		}
		boundWorkflow = bindings["workflow"]
	} else if !os.IsNotExist(overlayErr) {
		return errors.New("deployment bindings overlay not protected")
	}
	localWorkflow := record.TenantCode == "C000001" &&
		cfg.Deployment == "c000001-test-tenant-runtime" &&
		record.DeploymentCode == "C000001-test-workflow-local" &&
		record.DBHost == "127.0.0.1"
	if boundWorkflow != record.DeploymentCode && !(boundWorkflow == "" && localWorkflow) {
		return errors.New("Workflow deployment binding differs from approval")
	}
	cfg.Apps.Console.VaultMasterKey = strings.TrimSpace(string(keyBytes))
	conn, err := db.Open(cfg.Apps.Console.DB)
	if err != nil {
		return err
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var database, serverUUID string
	if err = conn.QueryRowContext(ctx, `SELECT DATABASE(),@@server_uuid`).Scan(&database, &serverUUID); err != nil {
		return err
	}
	if database != record.Database || serverUUID != record.ServerUUID {
		return errors.New("database instance differs from approval")
	}
	a := consoleapp.NewWithDB(cfg.Apps.Console, cfg.Tenant, conn)
	approvalHash := sha256.Sum256(approvalBytes)
	in := consoleapp.WorkflowBreakglassApproval{CaseID: record.CaseID, ApprovalID: record.ApprovalID,
		ApprovalRecordID: record.ApprovalRecordID, ApprovalFileSHA256: hex.EncodeToString(approvalHash[:]),
		OperatorID: record.OperatorID, TenantCode: record.TenantCode, DeploymentCode: record.DeploymentCode,
		EffectKind: record.EffectKind, EffectID: record.EffectID}
	switch *stage {
	case "prepare":
		err = a.PrepareWorkflowBreakglass(ctx, in)
	case "activate":
		var credentialID uint64
		credentialID, err = a.ActivateWorkflowBreakglass(ctx, in, func(clientID, secret string) (func(), error) {
			if directoryErr := prepareCaseSecretDirectory(runtimeRoot, record.CaseID); directoryErr != nil {
				return nil, directoryErr
			}
			return writeSecretFile(*secretOut, clientID, secret)
		})
		if err == nil {
			fmt.Printf("workflow breakglass activate complete; credentialId=%d\n", credentialID)
		}
	case "retire":
		err = a.RetireWorkflowBreakglass(ctx, in)
		if err == nil {
			// The credential has already been revoked; file removal is best effort
			// but a failure is reported so the operator can dispose of the stale file.
			err = os.Remove(*secretOut)
			if os.IsNotExist(err) {
				err = nil
			}
		}
	}
	if err == nil && *stage != "activate" {
		fmt.Printf("workflow breakglass %s complete\n", *stage)
	}
	return err
}

func main() {
	if err := run(); err != nil {
		// Database errors may contain secret-bearing values; never echo details.
		fmt.Fprintln(os.Stderr, "WORKFLOW_BREAKGLASS_STOPPED (details suppressed)")
		os.Exit(1)
	}
}
