package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

// RecoveryActivation identifies the sole replacement runtime/worker pair. Route
// publication is a separate CAS using this immutable activation receipt.
type RecoveryActivation struct {
	Recovery                                                                          RecoveryPlan
	ActivationKey, RuntimeDeployment, WorkerDeployment, WorkerClientID, RouteRevision string
	Generation                                                                        uint64
	ReviewHash                                                                        string
}

func RecoveryActivationHash(p RecoveryActivation) string {
	p.ReviewHash = ""
	raw, _ := json.Marshal(p)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

// VerifyRecoveryOwner must verify persisted, authenticated preparation evidence:
// old workers drained; only this runtime/worker can access fresh recovery schemas;
// the expected route revision is still disabled. It executes locally in tx, never
// performs network IO, and returns the SHA256 of its evidence. No default exists.
type RecoveryOwnerVerifier interface {
	VerifyRecoveryOwner(context.Context, *sql.Tx, RecoveryActivation) (string, error)
}

func ActivateRecovery(ctx context.Context, db *sql.DB, p RecoveryActivation, verifier RecoveryOwnerVerifier) error {
	if validateRecovery(p.Recovery) != nil || p.ReviewHash == "" || RecoveryActivationHash(p) != p.ReviewHash || p.ActivationKey == "" || len(p.ActivationKey) > 191 || p.RuntimeDeployment == "" || p.WorkerClientID == "" || p.WorkerDeployment == "" || p.RouteRevision == "" || p.Generation <= p.Recovery.Final.Config.Generation || verifier == nil {
		return errors.New("reviewed recovery owner contract and verifier required")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err = verifyInstance(ctx, conn, p.Recovery.Final.Config.InstanceID); err != nil {
		return err
	}
	release, err := migrationlock.Acquire(ctx, conn, p.Recovery.Final.Config.InstanceID, p.Recovery.Final.Config.Target)
	if err != nil {
		return err
	}
	defer release()
	receipt := qualified(p.Recovery.Final.Config.Target, "enterprise_recovery_activation")
	if _, err = conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS "+receipt+"(id TINYINT PRIMARY KEY,activation_key VARCHAR(191) NOT NULL,review_hash CHAR(64) NOT NULL,evidence_hash CHAR(64) NOT NULL,generation BIGINT UNSIGNED NOT NULL,runtime_deployment VARCHAR(191) NOT NULL,worker_client_id VARCHAR(191) NOT NULL,route_revision VARCHAR(191) NOT NULL,activated_at DATETIME(3) NOT NULL) ENGINE=InnoDB"); err != nil {
		return err
	}
	// Replay never recopies or compares mutable post-activation business data.
	var previous string
	err = conn.QueryRowContext(ctx, "SELECT review_hash FROM "+receipt+" WHERE id=1").Scan(&previous)
	if err == nil {
		if previous != p.ReviewHash {
			return errors.New("recovery activation owner conflict")
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err = VerifyRecovery(ctx, db, p.Recovery); err != nil {
		return err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = recoveryIdentity(ctx, tx, p.Recovery, true); err != nil {
		return err
	}
	for _, schema := range []string{p.Recovery.AimsTarget, p.Recovery.AssetsTarget} {
		var tenant, contract, state, key string
		if err = tx.QueryRowContext(ctx, "SELECT tenant_code,contract_hash,state,transition_key FROM "+qualified(schema, sourceFenceTable)+" WHERE id=1 FOR UPDATE").Scan(&tenant, &contract, &state, &key); err != nil {
			return err
		}
		if tenant != p.Recovery.Final.Config.Tenant || contract != p.Recovery.Fence.ContractHash || state != "fenced" || key != p.Recovery.CutoverKey {
			return errors.New("recovery writer fence mismatch")
		}
	}
	evidence, err := verifier.VerifyRecoveryOwner(ctx, tx, p)
	if err != nil {
		return err
	}
	if raw, decodeErr := hex.DecodeString(evidence); decodeErr != nil || len(raw) != 32 {
		return errors.New("invalid recovery owner evidence hash")
	}
	for _, schema := range []string{p.Recovery.AimsTarget, p.Recovery.AssetsTarget} {
		if _, err = tx.ExecContext(ctx, "UPDATE "+qualified(schema, "enterprise_schema_registry")+" SET runtime_deployment=?,generation=? WHERE id=1 AND generation=0", p.RuntimeDeployment, p.Generation); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE "+qualified(schema, sourceFenceTable)+" SET state='active',transition_key=?,changed_at=UTC_TIMESTAMP(3) WHERE id=1", p.ActivationKey); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO "+receipt+" VALUES(1,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))", p.ActivationKey, p.ReviewHash, evidence, p.Generation, p.RuntimeDeployment, p.WorkerClientID, p.RouteRevision); err != nil {
		return err
	}
	return tx.Commit()
}
