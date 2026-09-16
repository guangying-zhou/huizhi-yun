package deliveryledger

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
)

func newSQLiteStore(t *testing.T) (*SQLStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "state", "delivery.db")
	store, err := OpenSQLite(context.Background(), config.DeliveryStoreConfig{
		Type:       "sqlite",
		SQLitePath: path,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, path
}

func TestSQLiteStoreInitializesSchemaAndSecuresFiles(t *testing.T) {
	store, path := newSQLiteStore(t)
	if err := store.Ready(context.Background()); err != nil {
		t.Fatal(err)
	}

	var migrations int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM notification_schema_migrations`).Scan(&migrations); err != nil {
		t.Fatal(err)
	}
	if migrations != 2 {
		t.Fatalf("migration count = %d, want 2", migrations)
	}
	fileInfo, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fileInfo.Mode().Perm() != 0o600 {
		t.Fatalf("sqlite mode = %o, want 600", fileInfo.Mode().Perm())
	}
	dirInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if dirInfo.Mode().Perm() != 0o700 {
		t.Fatalf("sqlite directory mode = %o, want 700", dirInfo.Mode().Perm())
	}
}

func TestSQLiteStoreDoesNotTightenAnExistingCustomParentDirectory(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "shared-parent")
	if err := os.Mkdir(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := OpenSQLite(context.Background(), config.DeliveryStoreConfig{
		Type:       "sqlite",
		SQLitePath: filepath.Join(directory, "delivery.db"),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	info, err := os.Stat(directory)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("existing parent mode = %o, want 755", info.Mode().Perm())
	}
}

func TestSQLiteStorePersistsIdempotentDeliveryLifecycle(t *testing.T) {
	store, path := newSQLiteStore(t)
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	input := claimInput()

	first, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Decision != DecisionExecute || first.Fencing != 1 {
		t.Fatalf("first claim = %+v", first)
	}
	active, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if active.Decision != DecisionInProgress {
		t.Fatalf("active claim = %+v", active)
	}

	result := []byte(`{"provider":"wecom","providerResult":{"errcode":0}}`)
	if err := store.Succeed(context.Background(), Completion{
		DeliveryID: first.DeliveryID,
		LeaseOwner: input.LeaseOwner,
		Fencing:    first.Fencing,
		ResultJSON: result,
	}); err != nil {
		t.Fatal(err)
	}
	replay, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Decision != DecisionReplaySucceeded || string(replay.ResultJSON) != string(result) {
		t.Fatalf("replay = %+v", replay)
	}

	mismatch := input
	mismatch.RequestHash = strings.Repeat("b", 64)
	if _, err := store.Claim(context.Background(), mismatch); !errors.Is(err, ErrPayloadMismatch) {
		t.Fatalf("mismatch error = %v", err)
	}

	items, err := store.List(context.Background(), ListInput{Tenant: input.Identity.Tenant, Deployment: input.Identity.Deployment, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(items.Deliveries) != 1 || items.Deliveries[0].State != StateSucceeded {
		t.Fatalf("deliveries = %+v", items)
	}

	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(context.Background(), config.DeliveryStoreConfig{Type: "sqlite", SQLitePath: path})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	replay, err = reopened.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Decision != DecisionReplaySucceeded {
		t.Fatalf("reopened replay = %+v", replay)
	}
}

func TestSQLiteStoreExpiresUnknownDeliveryAndAppendsReconciliationAudit(t *testing.T) {
	store, _ := newSQLiteStore(t)
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	input := claimInput()
	claim, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Minute)
	expired, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if expired.Decision != DecisionPartialUnknown {
		t.Fatalf("expired claim = %+v", expired)
	}

	reconciled, err := store.Reconcile(context.Background(), ReconcileInput{
		Tenant: input.Identity.Tenant, Deployment: input.Identity.Deployment, DeliveryID: claim.DeliveryID,
		ExpectedState: StatePartialUnknown, Result: StateSucceeded,
		ActorSourceApp: "console", ActorClientID: "console-admin-client", ActorSubject: "operator-1",
		Reason: "Provider admin confirmed the message was accepted", EvidenceType: "provider_admin_confirmation", EvidenceReference: "INC-1042", ProviderMessageID: "msg-1042",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reconciled.AuditID < 1 || reconciled.Delivery.State != StateSucceeded {
		t.Fatalf("reconciled = %+v", reconciled)
	}
	if _, err := store.db.Exec(`UPDATE notification_delivery_reconciliations SET reason='tampered evidence' WHERE id=?`, reconciled.AuditID); err == nil {
		t.Fatal("append-only reconciliation audit accepted an update")
	}
}

func TestSQLiteStoreSerializesConcurrentDuplicateClaims(t *testing.T) {
	store, _ := newSQLiteStore(t)
	input := claimInput()
	const workers = 12
	decisions := make([]Decision, 0, workers)
	errorsSeen := make([]error, 0)
	var mutex sync.Mutex
	var wait sync.WaitGroup
	start := make(chan struct{})
	for range workers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			claim, err := store.Claim(context.Background(), input)
			mutex.Lock()
			defer mutex.Unlock()
			if err != nil {
				errorsSeen = append(errorsSeen, err)
				return
			}
			decisions = append(decisions, claim.Decision)
		}()
	}
	close(start)
	wait.Wait()
	if len(errorsSeen) > 0 {
		t.Fatalf("concurrent claim errors = %v", errorsSeen)
	}
	sort.Slice(decisions, func(i, j int) bool { return decisions[i] < decisions[j] })
	execute, inProgress := 0, 0
	for _, decision := range decisions {
		switch decision {
		case DecisionExecute:
			execute++
		case DecisionInProgress:
			inProgress++
		}
	}
	if execute != 1 || inProgress != workers-1 {
		t.Fatalf("decisions = %v", decisions)
	}
}
