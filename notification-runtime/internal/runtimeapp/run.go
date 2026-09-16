package runtimeapp

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
	"syscall"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
	"github.com/huizhi-yun/notification-runtime/internal/deliveryledger"
	"github.com/huizhi-yun/notification-runtime/internal/diagnostics"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
	"github.com/huizhi-yun/notification-runtime/internal/identityhandoff"
	"github.com/huizhi-yun/notification-runtime/internal/peoplejobs"
	"github.com/huizhi-yun/notification-runtime/internal/providers"
	"github.com/huizhi-yun/notification-runtime/internal/server"
	"github.com/huizhi-yun/notification-runtime/internal/updater"
	"github.com/huizhi-yun/notification-runtime/internal/version"
)

type Product string

var errConnectorDeviceIdentityRejected = errors.New("connector runtime device identity was rejected")

func IsConnectorDeviceIdentityRejected(err error) bool {
	return errors.Is(err, errConnectorDeviceIdentityRejected)
}

const (
	NotificationRuntime Product = "hzy-notification-runtime"
	ConnectorRuntime    Product = "hzy-connector-runtime"
)

func Run(args []string, product Product) error {
	flags := flag.NewFlagSet(string(product), flag.ContinueOnError)
	update := flags.Bool("update", false, "check and apply runtime update")
	checkStore := flags.Bool("check-store", false, "verify the durable operation store schema")
	showSLOSnapshot := flags.Bool("slo-snapshot", false, "print a redacted Connector Runtime SLO snapshot")
	showVersion := flags.Bool("version", false, "print version")
	if err := flags.Parse(args); err != nil {
		return err
	}

	cfg := config.Load()
	profile := server.NotificationProfile()
	if product == ConnectorRuntime {
		cfg = config.LoadConnector()
		profile = server.ConnectorProfile()
	}
	if *showVersion {
		fmt.Println(version.Version)
		return nil
	}
	if *update {
		return updater.CheckAndApply(context.Background(), cfg)
	}
	if *showSLOSnapshot {
		if product != ConnectorRuntime {
			return errors.New("SLO snapshots are available only for hzy-connector-runtime")
		}
		snapshotContext, cancelSnapshot := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelSnapshot()
		snapshot, err := diagnostics.Collect(snapshotContext, cfg.Delivery.SQLitePath)
		if err != nil {
			return fmt.Errorf("collect Connector Runtime SLO snapshot: %w", err)
		}
		encoded, err := encodeConnectorSLOSnapshot(cfg, snapshot, true)
		if err != nil {
			return fmt.Errorf("encode Connector Runtime SLO snapshot: %w", err)
		}
		fmt.Println(encoded)
		return nil
	}
	if *checkStore {
		storeContext, cancelStore := context.WithTimeout(context.Background(), 10*time.Second)
		store, err := deliveryledger.Open(storeContext, cfg.Delivery)
		cancelStore()
		if err != nil {
			return fmt.Errorf("%s durable operation store unavailable: %w", product, err)
		}
		_ = store.Close()
		fmt.Println("durable operation store ready")
		return nil
	}

	storeContext, cancelStore := context.WithTimeout(context.Background(), 10*time.Second)
	store, err := deliveryledger.Open(storeContext, cfg.Delivery)
	cancelStore()
	if err != nil {
		return fmt.Errorf("%s durable operation store unavailable: %w", product, err)
	}
	defer store.Close()

	console := consoleclient.New(cfg.Console)
	var provider serverNotificationProvider = providers.NewWeComProvider(console)
	var connectorProvider *providers.ConnectorProvider
	if product == ConnectorRuntime {
		connectorProvider = providers.NewConnectorProvider(console)
		provider = connectorProvider
	}
	runtimeServer := server.NewWithProfileAndDependencies(cfg, profile, store, provider)
	var peopleStore *peoplejobs.Store
	var wecomHandoffs *identityhandoff.Store
	if product == ConnectorRuntime {
		handoffContext, cancelHandoffs := context.WithTimeout(context.Background(), 10*time.Second)
		wecomHandoffs, err = identityhandoff.Open(handoffContext, cfg.Delivery.SQLitePath)
		cancelHandoffs()
		if err != nil {
			return fmt.Errorf("open WeCom login handoff store: %w", err)
		}
		defer wecomHandoffs.Close()
		runtimeServer.SetWeComHandoffs(wecomHandoffs)
		jobContext, cancelJobs := context.WithTimeout(context.Background(), 10*time.Second)
		peopleStore, err = peoplejobs.Open(jobContext, cfg.Delivery.SQLitePath)
		cancelJobs()
		if err != nil {
			return fmt.Errorf("open People sync job store: %w", err)
		}
		defer peopleStore.Close()
		peopleSink, sinkErr := peoplejobs.NewDataRuntimeSink(cfg.PeopleSync.RuntimeURL, cfg.RuntimeID, cfg.PeopleSync.PrivateKeyFile)
		if sinkErr != nil {
			return fmt.Errorf("configure People sync data-runtime target: %w", sinkErr)
		}
		sink := peoplejobs.NewScopedSink(peopleSink, peoplejobs.NewConsoleDirectoryProfileSink(console))
		runtimeServer.SetPeopleJobs(peoplejobs.NewManager(peopleStore, connectorProvider, sink))
	}
	addr := cfg.Host + ":" + cfg.Port
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           runtimeServer.Handler(),
		ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
	}

	serverErrors := make(chan error, 1)
	heartbeatErrors := make(chan error, 1)
	heartbeatContext, cancelHeartbeat := context.WithCancel(context.Background())
	defer cancelHeartbeat()
	if product == ConnectorRuntime {
		go runConnectorHeartbeat(heartbeatContext, console, cfg, profile, heartbeatErrors)
	}
	go func() {
		fmt.Printf("%s version=%s addr=%s auth=%s\n", product, version.Version, addr, cfg.Auth.Mode)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErrors <- err
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(stop)
	select {
	case err := <-serverErrors:
		return err
	case err := <-heartbeatErrors:
		return err
	case <-stop:
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(ctx)
}

func runConnectorHeartbeat(ctx context.Context, client *consoleclient.Client, cfg config.Config, profile server.RuntimeProfile, fatal chan<- error) {
	startedAt := time.Now().UTC().Format(time.RFC3339Nano)
	interval := time.Minute
	requestTimeout := connectorHeartbeatRequestTimeout(cfg)
	nextSLOSnapshotAt := time.Time{}
	for {
		requestContext, cancel := context.WithTimeout(ctx, requestTimeout)
		snapshot, snapshotErr := diagnostics.Collect(requestContext, cfg.Delivery.SQLitePath)
		metrics := map[string]any{"available": snapshotErr == nil}
		if snapshotErr == nil {
			metrics["databaseBytes"] = snapshot.DatabaseBytes
			metrics["deliveries"] = snapshot.Deliveries
			metrics["peopleJobs"] = snapshot.PeopleJobs
		}
		now := time.Now().UTC()
		if nextSLOSnapshotAt.IsZero() || !now.Before(nextSLOSnapshotAt) {
			if encoded, encodeErr := encodeConnectorSLOSnapshot(cfg, snapshot, snapshotErr == nil); encodeErr == nil {
				log.Printf("[connector-runtime] slo_snapshot %s", encoded)
			} else {
				log.Printf("[connector-runtime] slo_snapshot unavailable")
			}
			nextSLOSnapshotAt = now.Add(5 * time.Minute)
		}
		capabilityCodes := make([]string, 0, len(profile.Registry.Capabilities))
		for _, capability := range profile.Registry.Capabilities {
			capabilityCodes = append(capabilityCodes, capability.Code+"@"+capability.Version)
		}
		result, err := client.ConnectorHeartbeat(requestContext, consoleclient.ConnectorHeartbeat{
			ConnectorID:  cfg.RuntimeID,
			Version:      profile.Version,
			Capabilities: capabilityCodes,
			StartedAt:    startedAt,
			Metrics:      metrics,
		})
		cancel()
		if err != nil {
			var httpError *httperror.Error
			if errors.As(err, &httpError) && (httpError.Status == http.StatusUnauthorized || httpError.Status == http.StatusForbidden) {
				fatal <- fmt.Errorf("%w by Console: %v", errConnectorDeviceIdentityRejected, err)
				return
			}
			log.Printf("[connector-runtime] heartbeat failed: %v", err)
		} else {
			if result.Status == "revoked" || result.Status == "inactive" {
				fatal <- fmt.Errorf("%w: status is %s", errConnectorDeviceIdentityRejected, result.Status)
				return
			}
			if result.NextHeartbeatSeconds >= 30 && result.NextHeartbeatSeconds <= 300 {
				interval = time.Duration(result.NextHeartbeatSeconds) * time.Second
			}
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func connectorHeartbeatRequestTimeout(cfg config.Config) time.Duration {
	if cfg.Console.Timeout > 0 {
		return cfg.Console.Timeout
	}
	return 30 * time.Second
}

type connectorSLOSnapshot struct {
	Event         string         `json:"event"`
	Product       Product        `json:"product"`
	Version       string         `json:"version"`
	RuntimeID     string         `json:"runtimeId"`
	Tenant        string         `json:"tenant"`
	Deployment    string         `json:"deployment"`
	CollectedAt   string         `json:"collectedAt"`
	Available     bool           `json:"available"`
	DatabaseBytes int64          `json:"databaseBytes,omitempty"`
	Deliveries    map[string]int `json:"deliveries,omitempty"`
	PeopleJobs    map[string]int `json:"peopleJobs,omitempty"`
}

func encodeConnectorSLOSnapshot(cfg config.Config, snapshot diagnostics.Snapshot, available bool) (string, error) {
	result := connectorSLOSnapshot{
		Event:       "connector_runtime_slo_snapshot",
		Product:     ConnectorRuntime,
		Version:     version.Version,
		RuntimeID:   cfg.RuntimeID,
		Tenant:      cfg.Tenant,
		Deployment:  cfg.Deployment,
		CollectedAt: snapshot.CollectedAt,
		Available:   available,
	}
	if available {
		result.DatabaseBytes = snapshot.DatabaseBytes
		result.Deliveries = snapshot.Deliveries
		result.PeopleJobs = snapshot.PeopleJobs
	}
	encoded, err := json.Marshal(result)
	return string(encoded), err
}

type serverNotificationProvider interface {
	Send(context.Context, providers.SendRequest) (providers.SendResult, error)
}
