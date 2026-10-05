package identityhandoff

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestWeComHandoffIsStateBoundTenantBoundAndSingleUse(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "operations.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	authorization, err := store.Issue(context.Background(), "C000001", "C000001-console", "hzy_es_state-value-with-enough-entropy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.BeginCallback(context.Background(), authorization.ID, "hzy_es_wrong-state-with-enough-entropy"); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("wrong state error = %v", err)
	}
	if _, err := store.BeginCallback(context.Background(), authorization.ID, "hzy_es_state-value-with-enough-entropy"); err != nil {
		t.Fatal(err)
	}
	ticket, err := store.Complete(context.Background(), authorization.ID, "liukai")
	if err != nil {
		t.Fatal(err)
	}
	if ticket == "" {
		t.Fatal("handoff ticket is empty")
	}
	if _, err := store.Redeem(context.Background(), "C000002", "C000001-console", ticket); !errors.Is(err, ErrBindingMismatch) {
		t.Fatalf("cross-tenant redeem error = %v", err)
	}
	subject, err := store.Redeem(context.Background(), "C000001", "C000001-console", ticket)
	if err != nil || subject != "liukai" {
		t.Fatalf("redeem subject=%q err=%v", subject, err)
	}
	if _, err := store.Redeem(context.Background(), "C000001", "C000001-console", ticket); !errors.Is(err, ErrAlreadyUsed) {
		t.Fatalf("second redeem error = %v", err)
	}
}

func TestWeComHandoffExpiresWithoutPersistingRawStateOrTicket(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "operations.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	authorization, err := store.Issue(context.Background(), "C000001", "C000001-console", "hzy_es_state-value-with-enough-entropy")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(6 * time.Minute)
	if _, err := store.BeginCallback(context.Background(), authorization.ID, "hzy_es_state-value-with-enough-entropy"); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired callback error = %v", err)
	}

	var stateHash string
	if err := store.db.QueryRow(`SELECT state_sha256 FROM connector_wecom_login_handoffs WHERE authorization_id=?`, authorization.ID).Scan(&stateHash); err != nil {
		t.Fatal(err)
	}
	if stateHash == "hzy_es_state-value-with-enough-entropy" || len(stateHash) != 64 {
		t.Fatalf("state was not stored as SHA-256: %q", stateHash)
	}
}

func TestIssuingAuthorizationExpiresAbandonedRows(t *testing.T) {
	store, err := Open(context.Background(), filepath.Join(t.TempDir(), "operations.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	abandoned, err := store.Issue(context.Background(), "C000001", "C000001-console", "hzy_es_abandoned-state-with-enough-entropy")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(6 * time.Minute)
	if _, err := store.Issue(context.Background(), "C000001", "C000001-console", "hzy_es_new-state-value-with-enough-entropy"); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := store.db.QueryRow(`SELECT status FROM connector_wecom_login_handoffs WHERE authorization_id=?`, abandoned.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "expired" {
		t.Fatalf("abandoned status=%q, want expired", status)
	}
}
