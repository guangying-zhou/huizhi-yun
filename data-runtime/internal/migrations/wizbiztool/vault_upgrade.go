package wizbiztool

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
	"reflect"
	"sort"
	"strings"
	"time"
)

type VaultUpgradeRow struct {
	TargetID        string  `json:"targetId"`
	SourcePK        string  `json:"sourcePk"`
	Code            string  `json:"code"`
	BeforeSeal      rowSeal `json:"beforeSeal"`
	BeforeMask      string  `json:"beforeMask"`
	RealMask        string  `json:"realMask"`
	TrimApplied     bool    `json:"trim_applied"`
	RealMAC         string  `json:"realMac"`
	SyntheticSHA256 string  `json:"syntheticSha256"`
	BeforeVersionID int64   `json:"beforeVersionId"`
	BeforeVersionNo int     `json:"beforeVersionNo"`
}
type VaultUpgradePlan struct {
	Audit               *FollowupAudit           `json:"audit,omitempty"`
	Baseline            map[string][]BaselineRow `json:"baseline"`
	Version             string                   `json:"version"`
	MainReviewHash      string                   `json:"mainReviewHash"`
	ProfileSHA256       string                   `json:"profileSha256"`
	RuntimeConfigSHA256 string                   `json:"runtimeConfigSha256"`
	SnapshotSHA256      string                   `json:"snapshotSha256"`
	SourceSQLSHA256     string                   `json:"sourceSqlSha256"`
	Approval            Approval                 `json:"approval"`
	TrimCount           int                      `json:"trim_count"`
	Rows                []VaultUpgradeRow        `json:"rows"`
	ReviewHash          string                   `json:"reviewHash"`
}
type VaultUpgradeRecord struct {
	Plan         VaultUpgradePlan   `json:"plan"`
	Status       string             `json:"status"`
	Done         map[string]rowSeal `json:"done"`
	RollbackDone map[string]rowSeal `json:"rollbackDone,omitempty"`
}

func VaultUpgradePlanHash(p VaultUpgradePlan) string { p.ReviewHash = ""; return factsHash(p) }
func ReviewVaultUpgradePlan(p VaultUpgradePlan, hash string) error {
	if p.Version != "wizbiz-vault-upgrade-plan.v1" || !validHash(hash) || p.ReviewHash != hash || VaultUpgradePlanHash(p) != hash {
		return ErrInput
	}
	return nil
}
func (e *engine) checkVaultUpgradeApproval(p VaultUpgradePlan) error {
	if e.profile.VaultWrite != "synthetic" || e.profile.Tenant != "C000001" || e.profile.Environment != "test" || p.MainReviewHash != e.plan.ReviewHash || p.ProfileSHA256 != e.profileHash || p.SnapshotSHA256 != e.manifestHash || p.SourceSQLSHA256 != e.manifest.SQLSHA256 || p.Approval.Approver == "" || p.Approval.Scope != "test/"+e.profile.BatchCode+"/vault-real" || p.Approval.Note == "" {
		return ErrInput
	}
	if _, err := time.Parse("2006-01-02", p.Approval.Date); err != nil {
		return ErrInput
	}
	return nil
}
func (e *engine) loadMainScope(ctx context.Context, q targetQuery, locked bool) (int64, batchScope, error) {
	var id int64
	var hash, status, raw string
	suffix := ""
	if locked {
		suffix = " FOR UPDATE"
	}
	err := q.QueryRowContext(ctx, "SELECT id,plan_sha256,status,scope_json FROM mig_batch WHERE BINARY batch_code=BINARY ?"+suffix, e.profile.BatchCode).Scan(&id, &hash, &status, &raw)
	var s batchScope
	if err != nil || hash != e.plan.ReviewHash || status != "applied" || json.Unmarshal([]byte(raw), &s) != nil || ReviewPlan(s.Plan, hash) != nil {
		return 0, s, ErrStep
	}
	return id, s, nil
}
func vaultSecretCode(code string) string { return "finance.bank-account." + code + ".account-no" }

type upgradeVaultState struct {
	ID         int64
	No         int
	Hash, Mask string
}

func (v *runtimeVault) upgradeState(ctx context.Context, code string) (upgradeVaultState, error) {
	var s upgradeVaultState
	var owner, ownerKey, kind, usage, status, backend, ref string
	err := v.database.QueryRowContext(ctx, "SELECT v.id,v.version_no,v.content_hash,s.masked_preview,s.owner_type,s.owner_key,s.secret_type,s.usage_type,s.status,s.storage_backend,s.secret_ref FROM vault_secrets s JOIN vault_secret_versions v ON v.id=s.current_version_id WHERE BINARY s.secret_code=BINARY ?", vaultSecretCode(code)).Scan(&s.ID, &s.No, &s.Hash, &s.Mask, &owner, &ownerKey, &kind, &usage, &status, &backend, &ref)
	expected, _ := SecretRef(code)
	if err != nil || owner != "finance_bank_account" || ownerKey != code || kind != "bank_account_number" || usage != "custody" || status != "active" || backend != "db_encrypted" || ref != expected {
		return s, ErrVault
	}
	return s, nil
}
func (v *runtimeVault) upgradeReceipt(ctx context.Context, p VaultUpgradePlan, code, action string) (bool, error) {
	var count int
	err := v.database.QueryRowContext(ctx, "SELECT COUNT(*) FROM console_mutation_receipts WHERE tenant_code='C000001' AND operation_code='console.vault.secret.rotate' AND idempotency_key=? AND status='succeeded'", "wizbiz-vault/"+p.ReviewHash+"/"+action+"/"+code).Scan(&count)
	if err != nil || count > 1 {
		return false, ErrVault
	}
	return count == 1, nil
}
func (e *engine) vaultUpgradePlan(ctx context.Context, approval Approval, v *runtimeVault) (VaultUpgradePlan, error) {
	_, currentConfigHash, err := e.profile.RuntimeBinding()
	if err != nil || e.checkMainRuntimeConfig(currentConfigHash) != nil {
		return VaultUpgradePlan{}, ErrTarget
	}
	p := VaultUpgradePlan{Audit: e.followupAudit, Version: "wizbiz-vault-upgrade-plan.v1", MainReviewHash: e.plan.ReviewHash, ProfileSHA256: e.profileHash, RuntimeConfigSHA256: currentConfigHash, SnapshotSHA256: e.manifestHash, SourceSQLSHA256: e.manifest.SQLSHA256, Approval: approval, Rows: []VaultUpgradeRow{}}
	if err := e.checkVaultUpgradeApproval(p); err != nil {
		return p, err
	}
	if err := e.verifyForFollowup(ctx, v.Check); err != nil {
		return p, err
	}
	_, scope, err := e.loadMainScope(ctx, e.target, false)
	if err != nil {
		return p, err
	}
	if scope.VaultUpgrade != nil {
		return p, ErrConflict
	}
	data, _, err := e.source.ReadCovered(ctx, e.manifest, "real")
	if err != nil {
		return p, err
	}
	for _, obj := range e.plan.Objects {
		if obj.Table != "finance_bank_account" || sourceText(sourceBankAccount(data, obj.SourcePK), "ba_type") == "3" {
			continue
		}
		code := obj.Code
		source := sourceBankAccount(data, obj.SourcePK)
		account := sourceText(source, "account_number")
		if account == "" {
			return p, ErrVault
		}
		seal, err := readSeal(ctx, e.target, "finance_bank_account", "code", code)
		if err != nil {
			return p, err
		}
		if e.followupAudit == nil && scope.Seals["finance_bank_account/"+code].SHA256 != seal.SHA256 {
			return p, ErrConflict
		}
		s, err := v.upgradeState(ctx, code)
		synthetic := Digest([]byte("WIZBIZ-TEST-" + obj.SourcePK))
		if err != nil || s.No != 1 || !vaultHashEquals(s.Hash, synthetic) || s.Mask != maskAccount("WIZBIZ-TEST-"+obj.SourcePK) {
			return p, ErrVault
		}
		var created int
		if v.database.QueryRowContext(ctx, "SELECT COUNT(*) FROM console_mutation_receipts WHERE tenant_code=? AND operation_code='console.vault.secret.create' AND idempotency_key=? AND status='succeeded'", e.profile.Tenant, "wizbiz/"+e.profile.BatchCode+"/"+code).Scan(&created) != nil || created != 1 {
			return p, ErrVault
		}
		var targetID string
		if e.target.QueryRowContext(ctx, "SELECT id FROM finance_bank_account WHERE BINARY code=BINARY ?", code).Scan(&targetID) != nil {
			return p, ErrTarget
		}
		p.Rows = append(p.Rows, VaultUpgradeRow{TargetID: targetID, SourcePK: obj.SourcePK, Code: code, BeforeSeal: seal, BeforeMask: s.Mask, TrimApplied: account != strings.TrimSpace(account), RealMask: maskAccount(strings.TrimSpace(account)), RealMAC: v.upgradeMaterialMAC(p.MainReviewHash, code, account), SyntheticSHA256: synthetic, BeforeVersionID: s.ID, BeforeVersionNo: s.No})
	}
	for _, row := range p.Rows {
		if row.TrimApplied {
			p.TrimCount++
		}
	}
	if p.TrimCount > 1 {
		return p, ErrSourceBinding
	}
	sort.Slice(p.Rows, func(i, j int) bool { return p.Rows[i].Code < p.Rows[j].Code })
	p.Baseline, err = ReadBaselines(ctx, e.target)
	if err != nil {
		return p, err
	}
	p.ReviewHash = VaultUpgradePlanHash(p)
	return p, nil
}
func (e *engine) checkVaultUpgrade(ctx context.Context, p VaultUpgradePlan, v *runtimeVault) (SourceData, error) {
	if ReviewVaultUpgradePlan(p, p.ReviewHash) != nil || e.checkVaultUpgradeApproval(p) != nil {
		return nil, ErrInput
	}
	cfg, cfgHash, err := e.profile.RuntimeBinding()
	if err != nil || cfgHash != p.RuntimeConfigSHA256 || e.checkMainRuntimeConfig(cfgHash) != nil {
		return nil, ErrTarget
	}
	if err = CheckTarget(ctx, e.target, e.profile, cfg); err != nil {
		return nil, err
	}
	dep, err := CheckDependencies(ctx, e.target, e.profile, cfg)
	if err != nil || !reflect.DeepEqual(dep, e.plan.Dependencies) {
		return nil, ErrDependency
	}
	stage, err := e.source.VerifyStage(ctx, e.manifest, e.manifestHash)
	if err != nil || CheckStageReceipt(e.plan.Source, stage) != nil {
		return nil, gateFailure(ErrSourceBinding, "upgrade_stage", "source")
	}
	build, err := e.build()
	if err != nil {
		return nil, ErrRuntimeBuild
	}
	if err = CheckHistoricalContractApply(e.plan.RuntimeBuild, build); err != nil {
		return nil, err
	}
	data, _, err := e.source.ReadCovered(ctx, e.manifest, "real")
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	objects := map[string]ObjectPlan{}
	for _, obj := range e.plan.Objects {
		if obj.Table == "finance_bank_account" && sourceText(sourceBankAccount(data, obj.SourcePK), "ba_type") != "3" {
			objects[obj.Code] = obj
		}
	}
	count := 0
	for _, obj := range e.plan.Objects {
		if obj.Table == "finance_bank_account" && sourceText(sourceBankAccount(data, obj.SourcePK), "ba_type") != "3" {
			count++
		}
	}
	if count != len(p.Rows) {
		return nil, ErrInput
	}
	trimCount := 0
	for _, row := range p.Rows {
		obj, exists := objects[row.Code]
		if !exists || obj.SourcePK != row.SourcePK || e.plan.IDAllocations["finance_bank_account"].IDs[obj.SourceTable+"/"+obj.SourcePK+"/"+obj.Role] != row.TargetID || row.BeforeSeal.Table != "finance_bank_account" || row.BeforeSeal.KeyColumn != "code" || row.BeforeSeal.Key != row.Code || !validHash(row.BeforeSeal.SHA256) || seen[row.Code] || row.BeforeVersionNo != 1 || row.BeforeVersionID < 1 {
			return nil, ErrInput
		}
		seen[row.Code] = true
		code, err := ObjectCode("bank-account", row.SourcePK)
		if err != nil || code != row.Code {
			return nil, ErrInput
		}
		account := sourceText(sourceBankAccount(data, row.SourcePK), "account_number")
		if strings.TrimSpace(account) == "" || row.TrimApplied != (account != strings.TrimSpace(account)) || v.upgradeMaterialMAC(p.MainReviewHash, row.Code, account) != row.RealMAC || maskAccount(strings.TrimSpace(account)) != row.RealMask || Digest([]byte("WIZBIZ-TEST-"+row.SourcePK)) != row.SyntheticSHA256 {
			return nil, gateFailure(ErrSourceBinding, "upgrade_account_digest", "source")
		}
		if row.TrimApplied {
			trimCount++
		}
	}
	if trimCount != p.TrimCount || trimCount > 1 {
		return nil, ErrSourceBinding
	}
	return data, nil
}

// Rotation uses Console's existing encrypted, audited mutation/receipt path.
// It is a resumable second transaction: the target ledger freezes the exact
// intent first; a crash after rotation resumes from its successful receipt.
func (e *engine) vaultUpgradeApply(ctx context.Context, p VaultUpgradePlan, v *runtimeVault, rollback bool) (ExecutionReceipt, error) {
	receipt := ExecutionReceipt{BatchCode: e.profile.BatchCode, Mode: "vault-upgrade-apply", Status: "failed"}
	if rollback {
		receipt.Mode = "vault-upgrade-rollback"
	}
	if err := e.stopped(ctx); err != nil {
		return receipt, err
	}
	data, err := e.checkVaultUpgrade(ctx, p, v)
	if err != nil {
		return receipt, err
	}
	conn, err := e.target.Conn(ctx)
	if err != nil {
		return receipt, ErrTarget
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, e.profile.InstanceID, e.profile.Database)
	if err != nil {
		return receipt, err
	}
	defer release()
	id, scope, err := e.loadMainScope(ctx, conn, false)
	if err != nil {
		return receipt, err
	}
	if scope.VaultUpgrade == nil {
		if rollback {
			return receipt, ErrStep
		}
		if err = e.verifyForFollowup(ctx, v.Check); err != nil {
			return receipt, err
		}
		scope.VaultUpgrade = &VaultUpgradeRecord{Plan: p, Status: "applying", Done: map[string]rowSeal{}}
		raw, _ := json.Marshal(scope)
		if _, err = conn.ExecContext(ctx, "UPDATE mig_batch SET scope_json=? WHERE id=? AND plan_sha256=?", string(raw), id, e.plan.ReviewHash); err != nil {
			return receipt, ErrWrite
		}
	} else if ReviewVaultUpgradePlan(scope.VaultUpgrade.Plan, p.ReviewHash) != nil {
		return receipt, ErrConflict
	}
	if err = e.checkVaultUpgradeBaseline(ctx, conn, p, scope.VaultUpgrade); err != nil {
		return receipt, err
	}
	record := scope.VaultUpgrade
	if record.Status == "rolled_back" {
		if !rollback {
			return receipt, ErrStep
		}
		receipt.Status = "rolled_back"
		return receipt, nil
	}
	if rollback {
		if record.Status != "applied" && record.Status != "rolling_back" {
			return receipt, ErrStep
		}
		record.Status = "rolling_back"
		if record.RollbackDone == nil {
			record.RollbackDone = map[string]rowSeal{}
		}
	}
	for _, row := range p.Rows {
		if err = e.stopped(ctx); err != nil {
			return receipt, err
		}
		current, err := readSeal(ctx, conn, "finance_bank_account", "code", row.Code)
		if err != nil {
			return receipt, err
		}
		done := record.Done
		if rollback {
			done = record.RollbackDone
		}
		if saved, ok := done[row.Code]; ok {
			if saved.SHA256 != current.SHA256 {
				return receipt, ErrConflict
			}
			continue
		}
		wantBefore := row.BeforeSeal
		if rollback {
			var ok bool
			wantBefore, ok = record.Done[row.Code]
			if !ok {
				return receipt, ErrStep
			}
		}
		if current.SHA256 != wantBefore.SHA256 {
			return receipt, ErrConflict
		}
		action := "real"
		material := strings.TrimSpace(sourceText(sourceBankAccount(data, row.SourcePK), "account_number"))
		realHash := Digest([]byte(material))
		hash, mask := realHash, row.RealMask
		oldHash, oldMask := row.SyntheticSHA256, row.BeforeMask
		versionNo := row.BeforeVersionNo
		if rollback {
			action = "rollback"
			material = "WIZBIZ-TEST-" + row.SourcePK
			hash, mask = row.SyntheticSHA256, row.BeforeMask
			oldHash, oldMask = realHash, row.RealMask
			versionNo++
		}
		state, err := v.upgradeState(ctx, row.Code)
		if err != nil {
			return receipt, err
		}
		exists, err := v.upgradeReceipt(ctx, p, row.Code, action)
		if err != nil {
			return receipt, err
		}
		if !exists {
			if state.No != versionNo || (!rollback && state.ID != row.BeforeVersionID) || !vaultHashEquals(state.Hash, oldHash) || state.Mask != oldMask {
				return receipt, ErrVault
			}
			_, err = v.adapter.AddVaultSecretVersion(ctx, vaultSecretCode(row.Code), map[string]any{"storageBackend": "db_encrypted", "material": map[string]any{"plaintext": material}}, true, consoleapp.MutationMeta{IdempotencyKey: "wizbiz-vault/" + p.ReviewHash + "/" + action + "/" + row.Code, RequestID: p.ReviewHash, ActorID: p.Approval.Approver})
			if err != nil {
				return receipt, vaultCreateFailure(err)
			}
		}
		state, err = v.upgradeState(ctx, row.Code)
		if err != nil || state.No != versionNo+1 || !vaultHashEquals(state.Hash, hash) || state.Mask != mask {
			return receipt, ErrVault
		}
		if e.vaultUpgradeAfterRotate != nil {
			if err = e.vaultUpgradeAfterRotate(); err != nil {
				return receipt, err
			}
		}
		tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
		if err != nil {
			return receipt, ErrWrite
		}
		_, fresh, err := e.loadMainScope(ctx, tx, true)
		if err != nil {
			tx.Rollback()
			return receipt, err
		}
		if fresh.VaultUpgrade == nil || fresh.VaultUpgrade.Plan.ReviewHash != p.ReviewHash {
			tx.Rollback()
			return receipt, ErrStep
		}
		var locked string
		if tx.QueryRowContext(ctx, "SELECT code FROM finance_bank_account WHERE BINARY code=BINARY ? FOR UPDATE", row.Code).Scan(&locked) != nil {
			tx.Rollback()
			return receipt, ErrTarget
		}
		check, err := readSeal(ctx, tx, "finance_bank_account", "code", row.Code)
		if err != nil || check.SHA256 != wantBefore.SHA256 {
			tx.Rollback()
			return receipt, ErrConflict
		}
		r, err := tx.ExecContext(ctx, "UPDATE finance_bank_account SET account_no_masked=?,row_version=row_version+1,updated_at=UTC_TIMESTAMP(3) WHERE BINARY code=BINARY ? AND BINARY account_no_masked=BINARY ?", mask, row.Code, oldMask)
		if err != nil {
			tx.Rollback()
			return receipt, ErrWrite
		}
		n, _ := r.RowsAffected()
		if n != 1 {
			tx.Rollback()
			return receipt, ErrConflict
		}
		seal, err := readSeal(ctx, tx, "finance_bank_account", "code", row.Code)
		if err != nil {
			tx.Rollback()
			return receipt, err
		}
		done[row.Code] = seal
		scope.Seals["finance_bank_account/"+row.Code] = seal
		raw, _ := json.Marshal(scope)
		if _, err = tx.ExecContext(ctx, "UPDATE mig_batch SET scope_json=? WHERE id=? AND plan_sha256=?", string(raw), id, e.plan.ReviewHash); err != nil {
			tx.Rollback()
			return receipt, ErrWrite
		}
		if tx.Commit() != nil {
			return receipt, ErrWrite
		}
	}
	record.Status = "applied"
	if rollback {
		record.Status = "rolled_back"
	}
	raw, _ := json.Marshal(scope)
	if _, err = conn.ExecContext(ctx, "UPDATE mig_batch SET scope_json=? WHERE id=? AND plan_sha256=?", string(raw), id, e.plan.ReviewHash); err != nil {
		return receipt, ErrWrite
	}
	receipt.Status = record.Status
	return receipt, nil
}

// ExecuteVaultUpgrade is a supplemental ledger operation. It never changes the
// reviewed main plan, source row hashes, Registry or secret reference.
func ExecuteVaultUpgrade(ctx context.Context, input OpeningInputs, mode string, p VaultUpgradePlan, hash string, approval Approval) (any, error) {
	if input.Profile.Validate() != nil || ReviewPlan(input.MainPlan, input.MainPlan.ReviewHash) != nil {
		return nil, ErrInput
	}
	e := newEngine(input.Source, input.Target, input.Directory, input.Profile, input.ProfileHash, input.Manifest, input.ManifestHash, input.Identities, input.IdentityHash, input.MainPlan)
	e.baselineRuntimeConfig = input.BaselineRuntimeConfig
	e.followupAudit = input.FollowupAudit
	if mode != "vault-upgrade-plan" {
		e.followupAudit = p.Audit
	}
	v, err := openRuntimeVault(input.Profile)
	if err != nil {
		return nil, err
	}
	defer v.Close()
	e.vault = v
	if mode == "vault-upgrade-plan" {
		return e.vaultUpgradePlan(ctx, approval, v)
	}
	if ReviewVaultUpgradePlan(p, hash) != nil {
		return nil, ErrInput
	}
	switch mode {
	case "vault-upgrade-apply":
		return e.vaultUpgradeApply(ctx, p, v, false)
	case "vault-upgrade-rollback":
		return e.vaultUpgradeApply(ctx, p, v, true)
	case "vault-upgrade-verify":
		return e.vaultUpgradeVerify(ctx, p, v)
	default:
		return nil, ErrInput
	}
}
func (e *engine) vaultUpgradeVerify(ctx context.Context, p VaultUpgradePlan, v *runtimeVault) (ExecutionReceipt, error) {
	r := ExecutionReceipt{BatchCode: e.profile.BatchCode, Mode: "vault-upgrade-verify", Status: "failed"}
	data, err := e.checkVaultUpgrade(ctx, p, v)
	if err != nil {
		return r, err
	}
	_, s, err := e.loadMainScope(ctx, e.target, false)
	if err != nil {
		return r, err
	}
	if s.VaultUpgrade == nil || s.VaultUpgrade.Plan.ReviewHash != p.ReviewHash {
		return r, ErrStep
	}
	rec := s.VaultUpgrade
	if rec.Status != "applied" && rec.Status != "rolled_back" {
		return r, ErrStep
	}
	for _, row := range p.Rows {
		realHash := Digest([]byte(strings.TrimSpace(sourceText(sourceBankAccount(data, row.SourcePK), "account_number"))))
		expectedHash, expectedMask, no, action := realHash, row.RealMask, 2, "real"
		done := rec.Done
		if rec.Status == "rolled_back" {
			expectedHash, expectedMask, no, action = row.SyntheticSHA256, row.BeforeMask, 3, "rollback"
			done = rec.RollbackDone
		}
		seal, err := readSeal(ctx, e.target, "finance_bank_account", "code", row.Code)
		if err != nil || done[row.Code].SHA256 != seal.SHA256 || s.Seals["finance_bank_account/"+row.Code].SHA256 != seal.SHA256 {
			return r, ErrConflict
		}
		st, err := v.upgradeState(ctx, row.Code)
		if err != nil || st.No != no || !vaultHashEquals(st.Hash, expectedHash) || st.Mask != expectedMask {
			return r, ErrVault
		}
		receipt, err := v.upgradeReceipt(ctx, p, row.Code, action)
		if err != nil || !receipt {
			return r, ErrVault
		}
		var previousID int64
		var previousHash string
		if v.database.QueryRowContext(ctx, "SELECT rotated_from_id FROM vault_secret_versions WHERE id=?", st.ID).Scan(&previousID) != nil {
			return r, ErrVault
		}
		if rec.Status == "applied" && previousID != row.BeforeVersionID {
			return r, ErrVault
		}
		if v.database.QueryRowContext(ctx, "SELECT content_hash FROM vault_secret_versions WHERE id=?", previousID).Scan(&previousHash) != nil {
			return r, ErrVault
		}
		want := row.SyntheticSHA256
		if rec.Status == "rolled_back" {
			want = realHash
		}
		if !vaultHashEquals(previousHash, want) {
			return r, ErrVault
		}
	}
	if err = e.verifyForFollowup(ctx, v.Check); err != nil {
		return r, err
	}
	if err = e.checkVaultUpgradeBaseline(ctx, e.target, p, rec); err != nil {
		return r, err
	}
	r.Status = "verified"
	r.Steps = []StepProgress{{Step: "vault-upgrade", Planned: len(p.Rows), Done: len(p.Rows), Status: rec.Status}}
	return r, nil
}

func (e *engine) checkVaultUpgradeBaseline(ctx context.Context, q targetQuery, p VaultUpgradePlan, r *VaultUpgradeRecord) error {
	current, err := ReadBaselines(ctx, q)
	if err != nil {
		return err
	}
	expected := map[string][]BaselineRow{}
	for table, rows := range p.Baseline {
		expected[table] = append([]BaselineRow{}, rows...)
	}
	for _, row := range p.Rows {
		hash := row.BeforeSeal.SHA256
		if r != nil {
			if done, ok := r.Done[row.Code]; ok {
				hash = done.SHA256
			}
			if done, ok := r.RollbackDone[row.Code]; ok {
				hash = done.SHA256
			}
		}
		// Row seals use CanonicalRow; baseline hashes use CanonicalBaseline.
		// Validate our exact owned row seal before accepting its baseline hash.
		seal, sealErr := readSeal(ctx, q, "finance_bank_account", "code", row.Code)
		if sealErr != nil || seal.SHA256 != hash {
			return ErrConflict
		}
		found := false
		for i, b := range expected["finance_bank_account"] {
			if b.PrimaryKey["id"] == row.TargetID {
				for _, actual := range current["finance_bank_account"] {
					if actual.PrimaryKey["id"] == row.TargetID {
						expected["finance_bank_account"][i].SHA256 = actual.SHA256
						found = true
					}
				}
			}
		}
		if !found {
			return ErrInput
		}
	}
	if !reflect.DeepEqual(expected, current) {
		return ErrConflict
	}
	return nil
}

// The plan never contains an unsalted real account digest. Runtime's existing
// protected Vault key binds source material to this reviewed batch and object.
func (v *runtimeVault) upgradeMaterialMAC(mainHash, code, account string) string {
	if len(v.upgradeKey) == 0 {
		return ""
	}
	m := hmac.New(sha256.New, v.upgradeKey)
	m.Write([]byte("wizbiz-vault-material.v1\x00" + mainHash + "\x00" + code + "\x00" + account))
	return hex.EncodeToString(m.Sum(nil))
}
