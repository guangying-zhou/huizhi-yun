package policyenvelope

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/go-sql-driver/mysql"
)

var ErrConflict = errors.New("policy_snapshot_conflict")
var ErrUnavailable = errors.New("policy_snapshot_unavailable")
var ErrNotFound = errors.New("policy_snapshot_missing")
var ErrRenewalNotMigrated = errors.New("policy_renewal_not_migrated")

// Store is used only after service authentication and live grant validation.
// Binding and trust anchors come from local Runtime configuration, not callers.
type Store struct {
	DB             *sql.DB
	Binding        Context
	KID, PublicKey string
}

func (s Store) current(raw string, now int64) (Snapshot, error) {
	var snapshot Snapshot
	if strict([]byte(raw), &snapshot) != nil {
		return snapshot, ErrUnavailable
	}
	c := s.Binding
	// GET exposes current durable state, including expired/revoked envelopes,
	// so an authorized synchronizer can recover using its ETag. Validate that
	// it was authentic and valid at acceptance; consumers MUST check today's
	// lifecycle themselves (the Host verifier does). No timestamp is renewed.
	c.Now = snapshot.AcceptedAt
	verified, err := Prepare(snapshot.Envelope, nil, s.KID, s.PublicKey, c)
	if err != nil || snapshot.Tenant != c.Tenant || snapshot.Environment != c.Environment || snapshot.Deployment != c.Deployment || snapshot.ETag != verified.ETag || snapshot.PolicyRevision != verified.PolicyRevision || snapshot.IssuedAt != verified.IssuedAt || snapshot.PayloadHash != verified.PayloadHash || snapshot.AcceptedAt < snapshot.IssuedAt || snapshot.AcceptedAt > now {
		return Snapshot{}, ErrUnavailable
	}
	return snapshot, nil
}

// Read is not an authorization/readiness verdict. It never refreshes freshness
// and never falls back to the legacy HMAC table.
func (s Store) Read(ctx context.Context) (Snapshot, error) {
	snapshot, _, err := s.ReadWithRenewal(ctx)
	return snapshot, err
}

// ReadWithRenewal also returns the syncer's last renewal outcome for the
// current snapshot. A table without the renewal columns (migration not yet
// applied) still serves the snapshot with no renewal, which grants no grace.
func (s Store) ReadWithRenewal(ctx context.Context) (Snapshot, *Renewal, error) {
	var raw, state sql.NullString
	var attempted sql.NullInt64
	err := s.DB.QueryRowContext(ctx, `SELECT snapshot, renewal_state, renewal_attempted_at FROM verified_policy_snapshots WHERE tenant_code=? AND environment=? AND deployment_code=?`, s.Binding.Tenant, s.Binding.Environment, s.Binding.Deployment).Scan(&raw, &state, &attempted)
	if missingRenewalColumns(err) {
		err = s.DB.QueryRowContext(ctx, `SELECT snapshot FROM verified_policy_snapshots WHERE tenant_code=? AND environment=? AND deployment_code=?`, s.Binding.Tenant, s.Binding.Environment, s.Binding.Deployment).Scan(&raw)
		state, attempted = sql.NullString{}, sql.NullInt64{}
	}
	if errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, nil, ErrNotFound
	}
	if err != nil || !raw.Valid {
		return Snapshot{}, nil, ErrUnavailable
	}
	snapshot, err := s.current(raw.String, time.Now().UnixMilli())
	if err != nil {
		return Snapshot{}, nil, err
	}
	return snapshot, storedRenewal(state, attempted), nil
}

// RecordRenewal stores the syncer's latest renewal outcome for the snapshot
// identified by expectedETag. Runtime supplies the attempt time; it never moves
// backwards, and a newer envelope write resets the state to ok.
func (s Store) RecordRenewal(ctx context.Context, state, expectedETag string) (Renewal, error) {
	if !validRenewalState(state) {
		return Renewal{}, ErrInvalid
	}
	c := s.Binding
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Renewal{}, err
	}
	defer tx.Rollback()
	var raw, stored sql.NullString
	var attempted sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT snapshot, renewal_state, renewal_attempted_at FROM verified_policy_snapshots WHERE tenant_code=? AND environment=? AND deployment_code=? FOR UPDATE`, c.Tenant, c.Environment, c.Deployment).Scan(&raw, &stored, &attempted)
	if missingRenewalColumns(err) {
		return Renewal{}, ErrRenewalNotMigrated
	}
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !raw.Valid) {
		return Renewal{}, ErrNotFound
	}
	if err != nil {
		return Renewal{}, err
	}
	var current Snapshot
	if strict([]byte(raw.String), &current) != nil {
		return Renewal{}, ErrUnavailable
	}
	if current.ETag != expectedETag {
		return Renewal{}, ErrConflict
	}
	now := max(time.Now().UnixMilli(), attempted.Int64)
	// A refusal or invalid response for this snapshot stays in force: only a
	// newer signed envelope (Write) clears it. The attempt time still advances.
	if stored.Valid && StickyRenewal(stored.String) && !StickyRenewal(state) {
		state = stored.String
	}
	if _, err = tx.ExecContext(ctx, `UPDATE verified_policy_snapshots SET renewal_state=?, renewal_attempted_at=? WHERE tenant_code=? AND environment=? AND deployment_code=?`, state, now, c.Tenant, c.Environment, c.Deployment); err != nil {
		return Renewal{}, err
	}
	if err := tx.Commit(); err != nil {
		return Renewal{}, err
	}
	return Renewal{State: state, AttemptedAt: now}, nil
}

func validRenewalState(state string) bool {
	return state == RenewalOK || state == RenewalPlatformUnavailable || state == RenewalRefused || state == RenewalInvalid
}

func storedRenewal(state sql.NullString, attempted sql.NullInt64) *Renewal {
	if !state.Valid || !attempted.Valid || !validRenewalState(state.String) {
		return nil
	}
	return &Renewal{State: state.String, AttemptedAt: attempted.Int64}
}

func missingRenewalColumns(err error) bool {
	var serverError *mysql.MySQLError
	return errors.As(err, &serverError) && serverError.Number == 1054
}

// Write serializes both first creation and updates. The row remains a watermark
// after expiry. A lost-response retry returns the original receipt, not a new age.
// expectedETag is empty only for first creation. Identical replay is allowed even
// with the original precondition; an intervening newer write causes conflict.
func (s Store) Write(ctx context.Context, envelope Envelope, expectedETag string) (Snapshot, error) {
	c := s.Binding
	c.Now = time.Now().UnixMilli()
	if _, err := Prepare(envelope, nil, s.KID, s.PublicKey, c); err != nil {
		return Snapshot{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Snapshot{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO verified_policy_snapshots (tenant_code,environment,deployment_code,snapshot) VALUES (?,?,?,NULL) ON DUPLICATE KEY UPDATE deployment_code=deployment_code`, c.Tenant, c.Environment, c.Deployment)
	if err != nil {
		return Snapshot{}, err
	}
	var raw sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT snapshot FROM verified_policy_snapshots WHERE tenant_code=? AND environment=? AND deployment_code=? FOR UPDATE`, c.Tenant, c.Environment, c.Deployment).Scan(&raw)
	if err != nil {
		return Snapshot{}, err
	}
	var previous *Snapshot
	if raw.Valid {
		previous = &Snapshot{}
		// Trusted durable state may have expired: preserve its watermark.
		if strict([]byte(raw.String), previous) != nil {
			return Snapshot{}, ErrUnavailable
		}
	}
	c.Now = time.Now().UnixMilli() // Time spent waiting for the row lock does not extend validity.
	next, err := Prepare(envelope, previous, s.KID, s.PublicKey, c)
	if err != nil {
		return Snapshot{}, err
	}
	if previous != nil && next.ETag == previous.ETag {
		// Replaying the stored envelope is not a renewal: it must not clear a
		// sticky refusal, so the renewal state is left untouched.
		if err := tx.Commit(); err != nil {
			return Snapshot{}, err
		}
		return next, nil
	}
	if (previous == nil && expectedETag != "") || (previous != nil && expectedETag != previous.ETag) {
		return Snapshot{}, ErrConflict
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return Snapshot{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE verified_policy_snapshots SET snapshot=? WHERE tenant_code=? AND environment=? AND deployment_code=?`, string(encoded), c.Tenant, c.Environment, c.Deployment)
	if err != nil {
		return Snapshot{}, err
	}
	if err := markRenewed(ctx, tx, c, next.AcceptedAt); err != nil {
		return Snapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return Snapshot{}, err
	}
	return next, nil
}

// A successful envelope write is a successful renewal. Tables without the
// renewal columns keep working; the write itself is never blocked by them.
func markRenewed(ctx context.Context, tx *sql.Tx, c Context, at int64) error {
	_, err := tx.ExecContext(ctx, `UPDATE verified_policy_snapshots SET renewal_state=?, renewal_attempted_at=GREATEST(COALESCE(renewal_attempted_at, 0), ?) WHERE tenant_code=? AND environment=? AND deployment_code=?`, RenewalOK, at, c.Tenant, c.Environment, c.Deployment)
	if missingRenewalColumns(err) {
		return nil
	}
	return err
}
