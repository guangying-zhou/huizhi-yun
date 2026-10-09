package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
)

// ExecuteVerify is SELECT-only. The result is a protected external receipt;
// verification never updates mig_batch or repairs domain/ledger data.
func ExecuteVerify(ctx context.Context, source *SourceSnapshot, target, directory *sql.DB, p Profile, pHash string, m SnapshotManifest, mHash string, c map[string]IdentityConfirmation, iHash string, plan Plan, reviewHash string, baselineRuntimeConfig ...string) (independentverify.Result, error) {
	if ReviewPlan(plan, reviewHash) != nil {
		return independentverify.Result{}, ErrInput
	}
	e := newEngine(source, target, directory, p, pHash, m, mHash, c, iHash, plan)
	if len(baselineRuntimeConfig) == 1 {
		e.baselineRuntimeConfig = baselineRuntimeConfig[0]
	}
	vault, err := openRuntimeVault(p)
	if err != nil {
		return independentverify.Result{}, err
	}
	defer vault.Close()
	e.vault = vault
	result, err := e.verify(ctx, vault.Check)
	if err != nil {
		return result, err
	}
	codes, err := vault.BatchCodes(ctx, p)
	if err != nil {
		return result, err
	}
	for _, code := range codes {
		var n int
		if target.QueryRowContext(ctx, "SELECT COUNT(*) FROM finance_bank_account WHERE BINARY code=BINARY ?", code).Scan(&n) != nil {
			return result, ErrTarget
		}
		if n == 0 {
			result.OrphanVaultCount++
		}
	}
	if result.OrphanVaultCount != 0 {
		return result, ErrVault
	}
	return result, nil
}
func (e *engine) verify(ctx context.Context, vault func(context.Context, string, string, string) error) (independentverify.Result, error) {
	// This validation intentionally does not call BuildPrepared or any apply
	// transformation. The independent verifier reconstructs every domain row.
	if e.profile.Validate() != nil || ReviewPlan(e.plan, e.plan.ReviewHash) != nil || e.profileHash != e.plan.ProfileSHA256 || e.identityHash != e.plan.IdentitySHA256 {
		return independentverify.Result{}, ErrInput
	}
	binding, cfgHash, err := e.profile.RuntimeBinding()
	if err != nil || e.checkMainRuntimeConfig(cfgHash) != nil {
		return independentverify.Result{}, ErrTarget
	}
	if err = CheckTarget(ctx, e.target, e.profile, binding); err != nil {
		return independentverify.Result{}, err
	}
	stage, err := e.source.VerifyStage(ctx, e.manifest, e.manifestHash)
	if err != nil || CheckStageReceipt(e.plan.Source, stage) != nil {
		return independentverify.Result{}, ErrSourceBinding
	}
	vaultMode := e.profile.VaultWrite
	_, upgradeScope, scopeErr := e.loadMainScope(ctx, e.target, false)
	if scopeErr != nil {
		return independentverify.Result{}, scopeErr
	}
	if u := upgradeScope.VaultUpgrade; u != nil {
		if ReviewVaultUpgradePlan(u.Plan, u.Plan.ReviewHash) != nil || e.checkVaultUpgradeApproval(u.Plan) != nil || u.Plan.RuntimeConfigSHA256 != cfgHash {
			return independentverify.Result{}, ErrStep
		}
		switch u.Status {
		case "applied":
			vaultMode = "real"
		case "rolled_back":
		case "applying", "rolling_back":
			return independentverify.Result{}, ErrStep
		default:
			return independentverify.Result{}, ErrStep
		}
	}
	data, _, err := e.source.ReadCovered(ctx, e.manifest, vaultMode)
	if err != nil {
		return independentverify.Result{}, err
	}
	if u := upgradeScope.VaultUpgrade; u != nil && u.Status == "applied" {
		v, ok := e.vault.(*runtimeVault)
		if !ok {
			return independentverify.Result{}, ErrVault
		}
		trimCount := 0
		for _, row := range u.Plan.Rows {
			source := sourceBankAccount(data, row.SourcePK)
			raw := sourceText(source, "account_number")
			if v.upgradeMaterialMAC(u.Plan.MainReviewHash, row.Code, raw) != row.RealMAC || row.TrimApplied != (raw != strings.TrimSpace(raw)) {
				return independentverify.Result{}, ErrSourceBinding
			}
			if row.TrimApplied {
				trimCount++
				source["account_number"] = strings.TrimSpace(raw)
			}
		}
		if trimCount != u.Plan.TrimCount || trimCount > 1 {
			return independentverify.Result{}, ErrSourceBinding
		}
	}
	directory, err := ReadDirectory(ctx, e.directory, e.profile, e.confirmations)
	if err != nil {
		return independentverify.Result{}, err
	}
	states, err := identityStates(data, e.confirmations, directory)
	if err != nil {
		return independentverify.Result{}, err
	}
	input := independentverify.Input{Data: data, Keys: map[string]string{}, Declarations: map[string][]independentverify.Field{}, Identities: map[string]independentverify.Identity{}, SnapshotID: e.manifest.SnapshotID, BatchCode: e.profile.BatchCode, VaultMode: vaultMode, Baseline: map[string][]independentverify.Baseline{}, Vault: vault}
	for table, decl := range Declarations() {
		input.Keys[table] = decl.PrimaryKey[0]
		for _, field := range decl.Columns {
			input.Declarations[table] = append(input.Declarations[table], independentverify.Field{Name: field.Name, Disposition: field.Disposition, Target: field.Target})
		}
	}
	for key, state := range states {
		input.Identities[key] = independentverify.Identity{UID: state.UID, Status: state.Status, Department: state.Department}
	}
	for table, rows := range e.plan.Baseline {
		input.Baseline[table] = []independentverify.Baseline{}
		for _, row := range rows {
			input.Baseline[table] = append(input.Baseline[table], independentverify.Baseline{Key: row.Key, SHA256: row.SHA256, PrimaryKey: row.PrimaryKey})
		}
	}
	tx, err := e.target.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return independentverify.Result{}, ErrTarget
	}
	defer tx.Rollback()
	var hash, status, raw string
	if tx.QueryRowContext(ctx, "SELECT id,plan_sha256,status,scope_json FROM mig_batch WHERE BINARY batch_code=BINARY ?", e.profile.BatchCode).Scan(&input.BatchID, &hash, &status, &raw) != nil || hash != e.plan.ReviewHash || status != "applied" {
		return independentverify.Result{}, ErrStep
	}
	var scope batchScope
	if json.Unmarshal([]byte(raw), &scope) != nil || scope.Plan.ReviewHash != hash {
		return independentverify.Result{}, ErrStep
	}
	if err = checkIDAllocationSnapshot(ctx, tx, e.profile, e.plan, scope.Seals); err != nil {
		return independentverify.Result{}, err
	}
	populateVerifierIDAllocations(&input, e.plan)
	return independentverify.Verify(ctx, tx, input)
}

func (e *engine) status(ctx context.Context) (ExecutionReceipt, error) {
	receipt := ExecutionReceipt{BatchCode: e.profile.BatchCode, Mode: "status", Steps: []StepProgress{}}
	var batchID int64
	var hash string
	if e.target.QueryRowContext(ctx, "SELECT id,status,plan_sha256 FROM mig_batch WHERE BINARY batch_code=BINARY ?", e.profile.BatchCode).Scan(&batchID, &receipt.Status, &hash) != nil || hash != e.plan.ReviewHash {
		return receipt, ErrStep
	}
	rows, err := e.target.QueryContext(ctx, "SELECT step,planned_rows,done_rows,status FROM mig_batch_step WHERE batch_id=? ORDER BY step", batchID)
	if err != nil {
		return receipt, ErrTarget
	}
	defer rows.Close()
	for rows.Next() {
		var p StepProgress
		if rows.Scan(&p.Step, &p.Planned, &p.Done, &p.Status) != nil {
			return receipt, ErrTarget
		}
		receipt.Steps = append(receipt.Steps, p)
	}
	return receipt, rows.Err()
}

func ExecuteStatus(ctx context.Context, target *sql.DB, p Profile, plan Plan, reviewHash string) (ExecutionReceipt, error) {
	if p.Validate() != nil || ReviewPlan(plan, reviewHash) != nil {
		return ExecutionReceipt{}, ErrInput
	}
	binding, hash, err := p.RuntimeBinding()
	if err != nil || hash != plan.RuntimeConfigSHA256 {
		return ExecutionReceipt{}, ErrTarget
	}
	if err = CheckTarget(ctx, target, p, binding); err != nil {
		return ExecutionReceipt{}, err
	}
	return newEngine(nil, target, nil, p, plan.ProfileSHA256, SnapshotManifest{}, "", nil, plan.IdentitySHA256, plan).status(ctx)
}

func populateVerifierIDAllocations(input *independentverify.Input, plan Plan) {
	input.IDAssignments = []independentverify.IDAssignment{}
	input.IDBoundaries = map[string]independentverify.IDBoundary{}
	for table, a := range plan.IDAllocations {
		b := independentverify.IDBoundary{Start: a.Start, TargetMaximum: a.TargetMaximum, ReferenceValues: []string{}}
		for _, ref := range a.References {
			for _, row := range ref.Rows {
				if row.Value != nil {
					b.ReferenceValues = append(b.ReferenceValues, *row.Value)
				}
			}
		}
		input.IDBoundaries[table] = b
	}
	for _, obj := range plan.Objects {
		if id := plan.IDAllocations[obj.Table].IDs[obj.SourceTable+"/"+obj.SourcePK+"/"+obj.Role]; id != "" {
			input.IDAssignments = append(input.IDAssignments, independentverify.IDAssignment{SourceTable: obj.SourceTable, SourcePK: obj.SourcePK, Table: obj.Table, Role: obj.Role, ID: id})
		}
	}
}
