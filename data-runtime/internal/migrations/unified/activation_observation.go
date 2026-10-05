package unified

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// ObserveCommittedActivation reads only the locally registered target. It does
// not accept a database address or an activation receipt from the HTTP caller.
func ObserveCommittedActivation(ctx context.Context, db *sql.DB, binding enterprise.Binding, key string) (CutoverReceipt, error) {
	var receipt CutoverReceipt
	if key == "" || len(key) > 191 || enterprise.ValidateBinding(binding) != nil {
		return receipt, errors.New("invalid activation identity")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return receipt, err
	}
	defer tx.Rollback()
	if err := verifyInstance(ctx, tx, binding.Storage.InstanceID); err != nil {
		return receipt, err
	}
	var tenant, environment, deployment, schemaVersion string
	var generation uint64
	if err := tx.QueryRowContext(ctx, "SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1").Scan(&tenant, &environment, &deployment, &schemaVersion, &generation); err != nil {
		return receipt, err
	}
	if tenant != binding.Key.Tenant || environment != binding.Key.Environment || deployment != binding.Key.RuntimeDeployment || schemaVersion != binding.SchemaVersion || generation != binding.Generation {
		return receipt, errors.New("active registry mismatch")
	}
	if err := tx.QueryRowContext(ctx, "SELECT operation_key,review_hash,evidence_hash,generation FROM enterprise_cutover_receipt WHERE operation_key=?", key).Scan(&receipt.OperationKey, &receipt.ReviewHash, &receipt.EvidenceHash, &receipt.Generation); err != nil {
		return receipt, err
	}
	if receipt.Generation != generation {
		return receipt, errors.New("activation generation mismatch")
	}
	var review, status string
	if err := tx.QueryRowContext(ctx, "SELECT review_hash,status FROM enterprise_migration_ledger WHERE id=1").Scan(&review, &status); err != nil || review != receipt.ReviewHash || status != "active" {
		return receipt, errors.New("activation ledger mismatch")
	}
	contract := ""
	for _, domain := range []string{"aims", "assets"} {
		var state, hash, transition string
		if err := tx.QueryRowContext(ctx, "SELECT state,contract_hash,transition_key FROM `"+domain+"_enterprise_source_fence` WHERE id=1").Scan(&state, &hash, &transition); err != nil {
			return receipt, err
		}
		if state != "active" || transition != key || len(hash) != 64 || (contract != "" && contract != hash) {
			return receipt, errors.New("activation fence mismatch")
		}
		contract = hash
	}
	return receipt, tx.Commit()
}
