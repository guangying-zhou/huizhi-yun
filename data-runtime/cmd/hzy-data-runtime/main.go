package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Fatalf("[hzy-data-runtime] shutdown failed: %v", err)
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

	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	flags.StringVar(&options.BaseURL, "base-url", options.BaseURL, "package base URL")
	flags.StringVar(&options.TargetVersion, "version", options.TargetVersion, "target version or latest")
	flags.StringVar(&options.InstallDir, "install-dir", options.InstallDir, "installation directory")
	flags.StringVar(&options.ServiceName, "service-name", options.ServiceName, "systemd service name")
	flags.BoolVar(&options.SkipChecksum, "skip-checksum", options.SkipChecksum, "skip package checksum verification")
	flags.BoolVar(&options.Force, "force", options.Force, "install even when the current version already matches")
	flags.BoolVar(&noRestart, "no-restart", false, "replace files without restarting the service")
	if err := flags.Parse(args); err != nil {
		return err
	}
	options.RestartService = !noRestart

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	result, err := updater.Run(ctx, options)
	if err != nil {
		return err
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

func envDefault(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func checkDB(cfg config.Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

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
