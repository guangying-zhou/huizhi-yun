package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
	"github.com/huizhi-yun/data-runtime/internal/server"
	"github.com/huizhi-yun/data-runtime/internal/updater"
	"github.com/huizhi-yun/data-runtime/internal/version"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "version":
			printVersion()
			return
		case "update":
			if err := runUpdate(os.Args[2:]); err != nil {
				log.Fatalf("[hzy-data-runtime] update failed: %v", err)
			}
			return
		case "rollback":
			if err := runRollback(os.Args[2:]); err != nil {
				log.Fatalf("[hzy-data-runtime] rollback failed: %v", err)
			}
			return
		case "auto-update":
			if err := runAutoUpdatePolicy(os.Args[2:]); err != nil {
				log.Fatalf("[hzy-data-runtime] auto-update policy failed: %v", err)
			}
			return
		case "enroll":
			if err := runEnrollment(os.Args[2:]); err != nil {
				log.Fatalf("[hzy-data-runtime] enrollment failed: %v", err)
			}
			return
		case "directory-connector":
			if err := runDirectoryConnector(); err != nil {
				log.Fatalf("[hzy-data-runtime] directory connector failed: %v", err)
			}
			return
		case "directory-connector-enroll":
			if err := runDirectoryConnectorEnrollment(os.Args[2:]); err != nil {
				log.Fatalf("[hzy-data-runtime] directory connector enrollment failed: %v", err)
			}
			return
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[hzy-data-runtime] load config failed: %v", err)
	}

	if len(os.Args) > 1 && (os.Args[1] == "--check-db" || os.Args[1] == "check-db") {
		if err := checkDB(cfg); err != nil {
			log.Fatalf("[hzy-data-runtime] database check failed: %v", err)
		}
		return
	}

	runtime, err := server.New(cfg)
	if err != nil {
		log.Fatalf("[hzy-data-runtime] create server failed: %v", err)
	}
	defer runtime.Close()
	runtimeContext, cancelRuntime := context.WithCancel(context.Background())
	defer cancelRuntime()
	if cfg.GatewayKeyset.Enabled {
		go func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for {
				if err := runtime.SyncGatewayKeyset(runtimeContext); err != nil {
					log.Printf("[hzy-data-runtime] Gateway keyset sync unavailable")
				}
				select {
				case <-runtimeContext.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	}
	restartCh := make(chan struct{}, 1)
	startControlHeartbeat(runtimeContext, cfg, runtime.ControlSnapshot, runtime.RequestControlPlaneUpdate, func() {
		select {
		case restartCh <- struct{}{}:
		default:
		}
	})

	httpServer := &http.Server{
		Addr:              cfg.Server.Addr(),
		Handler:           runtime,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("[hzy-data-runtime] listening on %s", cfg.Server.Addr())
		errCh <- httpServer.ListenAndServe()
	}()

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[hzy-data-runtime] server stopped: %v", err)
		}
	case <-signalCh:
		cancelRuntime()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Fatalf("[hzy-data-runtime] shutdown failed: %v", err)
		}
	case <-restartCh:
		cancelRuntime()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Fatalf("[hzy-data-runtime] restart shutdown failed: %v", err)
		}
	}
}

func printVersion() {
	fmt.Printf("hzy-data-runtime %s (%s, %s)\n", version.Version, version.Commit, version.BuiltAt)
}

func runUpdate(args []string) error {
	options := updater.Options{
		BaseURL:       envDefault("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL", updater.DefaultBaseURL),
		TargetVersion: envDefault("HZY_DATA_RUNTIME_UPDATE_VERSION", envDefault("HZY_DATA_RUNTIME_VERSION", "latest")),
		InstallDir:    envDefault("HZY_DATA_RUNTIME_INSTALL_DIR", "/opt/hzy-data-runtime"),
		ServiceName:   envDefault("HZY_DATA_RUNTIME_SERVICE_NAME", "hzy-data-runtime"),
		SkipChecksum:  os.Getenv("HZY_DATA_RUNTIME_SKIP_CHECKSUM") == "1",
		Force:         os.Getenv("HZY_DATA_RUNTIME_FORCE") == "1",
	}
	noRestart := os.Getenv("HZY_DATA_RUNTIME_NO_RESTART") == "1"
	configDir := envDefault("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime")
	options.ReleasePublicKeyFile = envDefault("HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_FILE", filepath.Join(configDir, "release-signing-public.pem"))
	options.ExpectedSigningKeyID = envDefault("HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID", "")
	trigger := envDefault("HZY_DATA_RUNTIME_UPDATE_TRIGGER", "manual")
	journalFile := envDefault("HZY_DATA_RUNTIME_UPDATE_JOURNAL_FILE", filepath.Join(configDir, "update-journal.json"))
	policyFile := envDefault("HZY_DATA_RUNTIME_AUTO_UPDATE_POLICY_FILE", filepath.Join(configDir, "auto-update-policy.json"))
	lockFile := envDefault("HZY_DATA_RUNTIME_UPDATE_LOCK_FILE", "/run/lock/hzy-data-runtime-update.lock")
	operationID := envDefault("HZY_DATA_RUNTIME_UPDATE_OPERATION_ID", "")

	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	flags.StringVar(&options.BaseURL, "base-url", options.BaseURL, "package base URL")
	flags.StringVar(&options.TargetVersion, "version", options.TargetVersion, "target version or latest")
	flags.StringVar(&options.InstallDir, "install-dir", options.InstallDir, "installation directory")
	flags.StringVar(&options.ServiceName, "service-name", options.ServiceName, "systemd service name")
	flags.StringVar(&options.ReleasePublicKeyFile, "release-public-key-file", options.ReleasePublicKeyFile, "trusted Ed25519 release public key file")
	flags.StringVar(&options.ExpectedSigningKeyID, "signing-key-id", options.ExpectedSigningKeyID, "approved release signing key ID")
	flags.BoolVar(&options.SkipChecksum, "skip-checksum", options.SkipChecksum, "skip package checksum verification")
	flags.BoolVar(&options.Force, "force", options.Force, "install even when the current version already matches")
	flags.BoolVar(&noRestart, "no-restart", false, "replace files without restarting the service")
	flags.StringVar(&trigger, "trigger", trigger, "update trigger: manual, api, or timer")
	flags.StringVar(&journalFile, "journal-file", journalFile, "persistent update journal path")
	flags.StringVar(&policyFile, "policy-file", policyFile, "auto-update policy path")
	flags.StringVar(&lockFile, "lock-file", lockFile, "shared update execution lock path")
	flags.StringVar(&operationID, "operation-id", operationID, "stable update operation ID")
	if err := flags.Parse(args); err != nil {
		return err
	}
	options.RestartService = !noRestart

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if trigger != "manual" && trigger != "api" && trigger != "timer" {
		return fmt.Errorf("invalid update trigger: %s", trigger)
	}
	if (trigger == "api" || trigger == "timer") && options.SkipChecksum {
		return fmt.Errorf("skip-checksum is forbidden for API and timer updates")
	}
	lock, err := updater.AcquireExecutionLock(ctx, lockFile, trigger != "timer")
	if err != nil {
		if trigger == "timer" && errors.Is(err, updater.ErrUpdateExecutionBusy) {
			log.Printf("[hzy-data-runtime] timer update skipped: another update or rollback holds the execution lock")
			return nil
		}
		return err
	}
	defer lock.Release()

	if trigger == "timer" {
		policy, allowed, err := updater.RecordTimerCheck(policyFile, time.Now())
		if err != nil {
			return err
		}
		if !allowed {
			log.Printf("[hzy-data-runtime] timer update skipped: auto-update policy state=%s", policy.State)
			return nil
		}
		options.TargetVersion = policy.TargetVersion
	}
	if operationID == "" {
		operationID = fmt.Sprintf("update-%s-%d", time.Now().UTC().Format("20060102T150405.000000000"), os.Getpid())
	}
	journal := updater.UpdateJournal{
		SchemaVersion:            updater.UpdateJournalSchemaVersion,
		OperationID:              operationID,
		Trigger:                  trigger,
		Status:                   "running",
		Phase:                    "resolving",
		TargetVersion:            options.TargetVersion,
		PackageSourceFingerprint: updater.SourceFingerprint(options.BaseURL),
		BeforeVersion:            version.Version,
		TriggeredAt:              time.Now().UTC().Format(time.RFC3339),
		StartedAt:                time.Now().UTC().Format(time.RFC3339),
		AutomaticRetry:           false,
	}
	if existing, readErr := updater.ReadUpdateJournal(journalFile); readErr == nil && existing.OperationID == operationID {
		journal.RequestID = existing.RequestID
		journal.TriggeredAt = existing.TriggeredAt
	}
	if digest, digestErr := updater.FileSHA256(filepath.Join(options.InstallDir, "hzy-data-runtime")); digestErr == nil {
		journal.BeforeBinarySHA256 = digest
	}
	if err := updater.WriteUpdateJournal(journalFile, journal); err != nil {
		return fmt.Errorf("write running update journal: %w", err)
	}

	result, err := updater.Run(ctx, options)
	if err != nil {
		journal.Status = "failed"
		journal.Phase = "failed"
		journal.ErrorCode = "runtime_update_failed"
		journal.FinishedAt = time.Now().UTC().Format(time.RFC3339)
		if journalErr := updater.WriteUpdateJournal(journalFile, journal); journalErr != nil {
			return errors.Join(err, fmt.Errorf("write failed update journal: %w", journalErr))
		}
		return err
	}
	journal.Status = "succeeded"
	journal.Phase = "completed"
	journal.ArtifactSHA256 = result.ArtifactSHA256
	journal.ManifestSHA256 = result.ManifestSHA256
	journal.SigningKeyID = result.SigningKeyID
	journal.AfterVersion = result.AvailableVersion
	if !result.Updated {
		journal.AfterVersion = result.CurrentVersion
	}
	if digest, digestErr := updater.FileSHA256(filepath.Join(options.InstallDir, "hzy-data-runtime")); digestErr == nil {
		journal.AfterBinarySHA256 = digest
	}
	journal.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	if err := updater.WriteUpdateJournal(journalFile, journal); err != nil {
		return fmt.Errorf("write succeeded update journal: %w", err)
	}
	if !result.Updated {
		log.Printf("[hzy-data-runtime] already up to date: %s", result.CurrentVersion)
		return nil
	}
	if result.Restarted {
		log.Printf("[hzy-data-runtime] updated %s -> %s and restarted %s", result.CurrentVersion, result.AvailableVersion, options.ServiceName)
	} else {
		log.Printf("[hzy-data-runtime] updated %s -> %s", result.CurrentVersion, result.AvailableVersion)
	}
	return nil
}

func runRollback(args []string) error {
	configDir := envDefault("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime")
	options := updater.RollbackOptions{
		InstallDir:  envDefault("HZY_DATA_RUNTIME_INSTALL_DIR", "/opt/hzy-data-runtime"),
		ServiceName: envDefault("HZY_DATA_RUNTIME_SERVICE_NAME", "hzy-data-runtime"),
	}
	noRestart := false
	lockFile := envDefault("HZY_DATA_RUNTIME_UPDATE_LOCK_FILE", "/run/lock/hzy-data-runtime-update.lock")
	policyFile := envDefault("HZY_DATA_RUNTIME_AUTO_UPDATE_POLICY_FILE", filepath.Join(configDir, "auto-update-policy.json"))
	journalFile := envDefault("HZY_DATA_RUNTIME_UPDATE_JOURNAL_FILE", filepath.Join(configDir, "update-journal.json"))
	changeID := ""

	flags := flag.NewFlagSet("rollback", flag.ContinueOnError)
	flags.StringVar(&options.InstallDir, "install-dir", options.InstallDir, "installation directory")
	flags.StringVar(&options.ServiceName, "service-name", options.ServiceName, "systemd service name")
	flags.BoolVar(&options.Execute, "execute", false, "swap the current and previous runtime binaries")
	flags.StringVar(&options.Confirm, "confirm", "", "exact rollback confirmation")
	flags.BoolVar(&noRestart, "no-restart", false, "swap files without restarting the service")
	flags.StringVar(&lockFile, "lock-file", lockFile, "shared update execution lock path")
	flags.StringVar(&policyFile, "policy-file", policyFile, "auto-update policy path")
	flags.StringVar(&journalFile, "journal-file", journalFile, "persistent update journal path")
	flags.StringVar(&changeID, "change-id", "", "approved rollback change identifier")
	if err := flags.Parse(args); err != nil {
		return err
	}
	options.RestartService = !noRestart

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var journal updater.UpdateJournal
	if options.Execute {
		if changeID == "" {
			return fmt.Errorf("--change-id is required with --execute")
		}
		lock, err := updater.AcquireExecutionLock(ctx, lockFile, true)
		if err != nil {
			return err
		}
		defer lock.Release()
		if _, err := updater.PinAutoUpdatePolicy(policyFile, changeID, time.Now()); err != nil {
			return fmt.Errorf("pin auto-update before rollback: %w", err)
		}
		journal = updater.UpdateJournal{
			SchemaVersion:   updater.UpdateJournalSchemaVersion,
			OperationID:     fmt.Sprintf("rollback-%s-%d", time.Now().UTC().Format("20060102T150405.000000000"), os.Getpid()),
			Trigger:         "manual",
			Status:          "running",
			Phase:           "installing",
			TargetVersion:   "previous",
			BeforeVersion:   version.Version,
			AutoUpdateState: "pinned",
			RollbackStatus:  "running",
			TriggeredAt:     time.Now().UTC().Format(time.RFC3339),
			StartedAt:       time.Now().UTC().Format(time.RFC3339),
			AutomaticRetry:  false,
		}
		if digest, digestErr := updater.FileSHA256(filepath.Join(options.InstallDir, "hzy-data-runtime")); digestErr == nil {
			journal.BeforeBinarySHA256 = digest
		}
		if err := updater.WriteUpdateJournal(journalFile, journal); err != nil {
			return fmt.Errorf("write running rollback journal: %w", err)
		}
	}
	result, err := updater.Rollback(ctx, options)
	if err != nil {
		if options.Execute {
			journal.Status = "failed"
			journal.Phase = "failed"
			journal.ErrorCode = "runtime_rollback_failed"
			journal.RollbackStatus = "failed"
			if result.RestoredAfterFailure {
				journal.RollbackStatus = "original_restored"
			}
			journal.FinishedAt = time.Now().UTC().Format(time.RFC3339)
			if journalErr := updater.WriteUpdateJournal(journalFile, journal); journalErr != nil {
				return errors.Join(err, fmt.Errorf("write failed rollback journal: %w", journalErr))
			}
		}
		return err
	}
	if !result.Executed {
		log.Printf(
			"[hzy-data-runtime] rollback preview: current_sha256=%s previous_sha256=%s; no files changed",
			result.CurrentSHA256,
			result.PreviousSHA256,
		)
		return nil
	}
	journal.Status = "succeeded"
	journal.Phase = "completed"
	journal.AfterBinarySHA256 = result.PreviousSHA256
	journal.RollbackStatus = "completed"
	journal.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	if err := updater.WriteUpdateJournal(journalFile, journal); err != nil {
		return fmt.Errorf("write succeeded rollback journal: %w", err)
	}
	if result.Restarted {
		log.Printf(
			"[hzy-data-runtime] rollback completed and %s restarted: installed_sha256=%s retained_sha256=%s",
			options.ServiceName,
			result.PreviousSHA256,
			result.CurrentSHA256,
		)
	} else {
		log.Printf(
			"[hzy-data-runtime] rollback binary swap completed without restart: installed_sha256=%s retained_sha256=%s",
			result.PreviousSHA256,
			result.CurrentSHA256,
		)
	}
	return nil
}

func runAutoUpdatePolicy(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("auto-update action is required: status, init, pin, or unpin")
	}
	action := args[0]
	configDir := envDefault("HZY_DATA_RUNTIME_CONFIG_DIR", "/etc/hzy-data-runtime")
	policyFile := envDefault("HZY_DATA_RUNTIME_AUTO_UPDATE_POLICY_FILE", filepath.Join(configDir, "auto-update-policy.json"))
	lockFile := envDefault("HZY_DATA_RUNTIME_UPDATE_LOCK_FILE", "/run/lock/hzy-data-runtime-update.lock")
	serviceName := strings.TrimSuffix(envDefault("HZY_DATA_RUNTIME_SERVICE_NAME", "hzy-data-runtime"), ".service")
	timerServiceFile := filepath.Join("/etc/systemd/system", serviceName+"-update.service")
	state := "tracking"
	targetVersion := "latest"
	changeID := ""
	confirm := ""

	flags := flag.NewFlagSet("auto-update "+action, flag.ContinueOnError)
	flags.StringVar(&policyFile, "policy-file", policyFile, "auto-update policy path")
	flags.StringVar(&lockFile, "lock-file", lockFile, "shared update execution lock path")
	flags.StringVar(&timerServiceFile, "timer-service-file", timerServiceFile, "systemd timer service unit path")
	flags.StringVar(&state, "state", state, "policy state: tracking, pinned, or disabled")
	flags.StringVar(&targetVersion, "target-version", targetVersion, "timer target version or channel")
	flags.StringVar(&changeID, "change-id", changeID, "approved change identifier")
	flags.StringVar(&confirm, "confirm", confirm, "exact policy transition confirmation")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var policy updater.AutoUpdatePolicy
	var err error
	switch action {
	case "status":
		policy, err = updater.ReadAutoUpdatePolicy(policyFile)
		if err != nil {
			return fmt.Errorf("read auto-update policy (effective state is unsafe): %w", err)
		}
		lockState := "free"
		lock, lockErr := updater.AcquireExecutionLock(ctx, lockFile, false)
		if errors.Is(lockErr, updater.ErrUpdateExecutionBusy) {
			lockState = "busy"
		} else if lockErr != nil {
			lockState = "unknown"
		} else {
			_ = lock.Release()
		}
		unit, unitErr := os.ReadFile(timerServiceFile)
		timerAware := unitErr == nil
		if timerAware {
			unitText := string(unit)
			timerAware = strings.Contains(unitText, "--trigger timer") &&
				strings.Contains(unitText, "--policy-file "+policyFile) &&
				strings.Contains(unitText, "--lock-file "+lockFile)
		}
		effectiveState := "unsafe"
		if timerAware {
			effectiveState = policy.State
		} else if policy.State == "disabled" && os.IsNotExist(unitErr) {
			effectiveState = "disabled"
		}
		return printJSON(map[string]any{
			"schemaVersion":  1,
			"policyState":    policy.State,
			"effectiveState": effectiveState,
			"targetVersion":  policy.TargetVersion,
			"timerAware":     timerAware,
			"executionLock":  lockState,
			"changedAt":      policy.ChangedAt,
			"lastTimerCheck": policy.LastTimerCheck,
		})
	case "init":
		policy, err = updater.InitializeAutoUpdatePolicy(policyFile, state, targetVersion, time.Now())
	case "pin":
		if confirm != "pin:"+changeID || changeID == "" {
			return fmt.Errorf("pin requires --change-id and --confirm pin:<change-id>")
		}
		lock, lockErr := updater.AcquireExecutionLock(ctx, lockFile, true)
		if lockErr != nil {
			return lockErr
		}
		defer lock.Release()
		policy, err = updater.PinAutoUpdatePolicy(policyFile, changeID, time.Now())
	case "unpin":
		expected := "unpin:" + changeID + ":" + state + ":" + targetVersion
		if confirm != expected || changeID == "" {
			return fmt.Errorf("unpin requires exact --confirm %s", expected)
		}
		lock, lockErr := updater.AcquireExecutionLock(ctx, lockFile, true)
		if lockErr != nil {
			return lockErr
		}
		defer lock.Release()
		policy, err = updater.UnpinAutoUpdatePolicy(policyFile, changeID, state, targetVersion, time.Now())
	default:
		return fmt.Errorf("unknown auto-update action: %s", action)
	}
	if err != nil {
		return err
	}
	return printJSON(map[string]any{
		"schemaVersion": 1,
		"state":         policy.State,
		"targetVersion": policy.TargetVersion,
		"changeId":      policy.ChangeID,
		"changedAt":     policy.ChangedAt,
	})
}

func printJSON(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	fmt.Println(string(payload))
	return nil
}

func envDefault(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func checkDB(cfg config.Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if cfg.Apps.Directory.Enabled {
		if err := pingDB(ctx, "directory", cfg.Apps.Directory.DB); err != nil {
			return err
		}
	}
	if cfg.Apps.Finance.Enabled {
		if err := pingDB(ctx, "finance", cfg.Apps.Finance.DB); err != nil {
			return err
		}
	}
	if cfg.Apps.Workflow.Enabled {
		if err := pingDB(ctx, "workflow", cfg.Apps.Workflow.DB); err != nil {
			return err
		}
	}
	if cfg.Apps.WebDev.Enabled {
		if err := pingDB(ctx, "webdev", cfg.Apps.WebDev.DB); err != nil {
			return err
		}
	}
	if cfg.Apps.Assets.Enabled {
		if err := pingDB(ctx, "assets", cfg.Apps.Assets.DB); err != nil {
			return err
		}
	}
	if cfg.Apps.Altoc.Enabled {
		if err := pingDB(ctx, "altoc", cfg.Apps.Altoc.DB); err != nil {
			return err
		}
	}
	if cfg.Apps.Aims.Enabled {
		if err := pingDB(ctx, "aims", cfg.Apps.Aims.DB); err != nil {
			return err
		}
	}
	if cfg.Apps.Codocs.Enabled {
		if err := pingDB(ctx, "codocs", cfg.Apps.Codocs.DB); err != nil {
			return err
		}
	}
	return nil
}

func pingDB(ctx context.Context, app string, cfg config.DBConfig) error {
	conn, err := db.Open(cfg)
	if err != nil {
		return fmt.Errorf("%s: open database: %w", app, err)
	}
	defer conn.Close()
	if err := conn.PingContext(ctx); err != nil {
		return fmt.Errorf("%s: ping %s@%s:%d/%s: %w", app, cfg.User, cfg.Host, cfg.Port, cfg.Database, err)
	}
	log.Printf("[hzy-data-runtime] database check ok: %s (%s@%s:%d/%s)", app, cfg.User, cfg.Host, cfg.Port, cfg.Database)
	return nil
}
