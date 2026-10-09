package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"math/big"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
)

type OpeningCustomerSummary struct {
	SourcePK  string `json:"sourcePk"`
	Contracts int    `json:"contracts"`
	Amount    string `json:"amount"`
}
type OpeningConfirmation struct {
	Customers       []OpeningCustomerSummary `json:"customers,omitempty"`
	SourceType      string                   `json:"sourceType,omitempty"`
	SourceSQLSHA256 string                   `json:"sourceSqlSha256,omitempty"`
	RulesVersion    string                   `json:"rulesVersion,omitempty"`
	AsOfDate        string                   `json:"asOfDate,omitempty"`
	BatchCode       string                   `json:"batchCode"`
	MainReviewHash  string                   `json:"mainReviewHash"`
	SnapshotSHA256  string                   `json:"snapshotSha256"`
	Approver        string                   `json:"approver"`
	Date            string                   `json:"date"`
	Contracts       []OpeningConfirmedRow    `json:"contracts"`
}
type OpeningConfirmedRow struct {
	SourcePK string  `json:"sourcePk"`
	Amount   string  `json:"amount"`
	DueDate  *string `json:"dueDate"`
}
type OpeningRow struct {
	SourcePK     string  `json:"sourcePk"`
	ContractCode string  `json:"contractCode"`
	Code         string  `json:"code"`
	Candidate    string  `json:"candidate"`
	Amount       string  `json:"amount"`
	DueDate      *string `json:"dueDate"`
	Differs      bool    `json:"differs"`
}
type OpeningPlan struct {
	Audit               *FollowupAudit           `json:"audit,omitempty"`
	Version             string                   `json:"version"`
	BatchCode           string                   `json:"batchCode"`
	MainReviewHash      string                   `json:"mainReviewHash"`
	ProfileSHA256       string                   `json:"profileSha256"`
	RuntimeConfigSHA256 string                   `json:"runtimeConfigSha256"`
	SnapshotSHA256      string                   `json:"snapshotSha256"`
	ConfirmationSHA256  string                   `json:"confirmationSha256"`
	Rows                []OpeningRow             `json:"rows"`
	Total               string                   `json:"total"`
	Baseline            map[string][]BaselineRow `json:"baseline"`
	ReviewHash          string                   `json:"reviewHash"`
}
type openingScope struct {
	Plan         OpeningPlan         `json:"plan"`
	Confirmation OpeningConfirmation `json:"confirmation"`
	Seals        map[string]rowSeal  `json:"seals"`
	Deleted      map[string]bool     `json:"deleted"`
}

func OpeningPlanHash(p OpeningPlan) string {
	p.ReviewHash = ""
	raw, _ := json.Marshal(p)
	return Digest(raw)
}
func ReviewOpeningPlan(p OpeningPlan, hash string) error {
	if p.Version != "wizbiz-opening-plan.v1" || !validHash(hash) || p.ReviewHash != hash || OpeningPlanHash(p) != hash {
		return ErrInput
	}
	return nil
}
func openingRows(data SourceData, c OpeningConfirmation) ([]OpeningRow, string, error) {
	source := map[string]map[string]any{}
	for _, row := range data["wb_contract"] {
		source[sourceText(row, "contract_id")] = row
	}
	rows := []OpeningRow{}
	seen := map[string]bool{}
	total := new(big.Rat)
	for _, confirmed := range c.Contracts {
		row, ok := source[confirmed.SourcePK]
		if !ok || seen[confirmed.SourcePK] || sourceText(row, "contract_type") == "0" {
			return nil, "", ErrInput
		}
		seen[confirmed.SourcePK] = true
		amount, err := decimal(confirmed.Amount)
		if err != nil || amount.Sign() <= 0 {
			return nil, "", ErrInput
		}
		if confirmed.DueDate != nil {
			d, err := time.Parse("2006-01-02", *confirmed.DueDate)
			if err != nil || d.Format("2006-01-02") != *confirmed.DueDate {
				return nil, "", ErrInput
			}
		}
		signed, err := decimal(row["total_amount"])
		if err != nil {
			return nil, "", err
		}
		received := new(big.Rat)
		for _, income := range data["wb_project_income"] {
			if sourceText(income, "contract_id") == confirmed.SourcePK {
				v, err := decimal(income["amount"])
				if err != nil {
					return nil, "", err
				}
				received.Add(received, v)
			}
		}
		recomputed := new(big.Rat).Sub(signed, received)
		cache, err := decimal(row["exec_amount"])
		if err != nil {
			return nil, "", ErrInput
		}
		candidate := recomputed
		if cache.Cmp(recomputed) != 0 {
			candidate = cache
		}
		if candidate.Sign() <= 0 {
			return nil, "", ErrInput
		}
		code, err := ObjectCode("contract", confirmed.SourcePK)
		if err != nil {
			return nil, "", err
		}
		rows = append(rows, OpeningRow{confirmed.SourcePK, code, "BS-W" + code[4:], candidate.FloatString(2), amount.FloatString(2), confirmed.DueDate, amount.Cmp(candidate) != 0})
		total.Add(total, amount)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ContractCode < rows[j].ContractCode })
	return rows, total.FloatString(2), nil
}
func (e *engine) openingPlan(ctx context.Context, c OpeningConfirmation, cHash string, vault func(context.Context, string, string, string) error) (OpeningPlan, error) {
	if c.MainReviewHash != e.plan.ReviewHash || c.SnapshotSHA256 != e.manifestHash || !validHash(cHash) || c.Approver == "" || c.Date == "" || c.BatchCode == e.profile.BatchCode || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`).MatchString(c.BatchCode) {
		return OpeningPlan{}, ErrInput
	}
	if _, err := time.Parse("2006-01-02", c.Date); err != nil {
		return OpeningPlan{}, ErrInput
	}
	// A fresh independent verification, not a caller assertion of verified state.
	if err := e.verifyForFollowup(ctx, vault); err != nil {
		return OpeningPlan{}, err
	}
	data, _, err := e.source.ReadCovered(ctx, e.manifest, e.profile.VaultWrite)
	if err != nil {
		return OpeningPlan{}, err
	}
	if err := validateOpeningSource(data, e.manifest, c); err != nil {
		return OpeningPlan{}, err
	}
	rows, total, err := openingRows(data, c)
	if err != nil {
		return OpeningPlan{}, err
	}
	_, currentConfigHash, err := e.profile.RuntimeBinding()
	if err != nil || e.checkMainRuntimeConfig(currentConfigHash) != nil {
		return OpeningPlan{}, ErrTarget
	}
	p := OpeningPlan{Audit: e.followupAudit, Version: "wizbiz-opening-plan.v1", BatchCode: c.BatchCode, MainReviewHash: e.plan.ReviewHash, ProfileSHA256: e.profileHash, RuntimeConfigSHA256: currentConfigHash, SnapshotSHA256: e.manifestHash, ConfirmationSHA256: cHash, Rows: rows, Total: total}
	p.Baseline, err = ReadBaselines(ctx, e.target)
	if err != nil {
		return OpeningPlan{}, err
	}
	p.ReviewHash = OpeningPlanHash(p)
	var existing int
	for _, row := range rows {
		if e.target.QueryRowContext(ctx, "SELECT COUNT(*) FROM altoc_billing_schedule s JOIN altoc_contract c ON c.id=s.contract_id WHERE BINARY s.code=BINARY ? OR (BINARY c.code=BINARY ? AND s.plan_type='opening_balance')", row.Code, row.ContractCode).Scan(&existing) != nil || existing != 0 {
			return OpeningPlan{}, ErrConflict
		}
	}
	return p, nil
}
func (e *engine) checkOpening(ctx context.Context, p OpeningPlan, c OpeningConfirmation, cHash string) error {
	if ReviewOpeningPlan(p, p.ReviewHash) != nil || p.ProfileSHA256 != e.profileHash || p.MainReviewHash != e.plan.ReviewHash || p.SnapshotSHA256 != e.manifestHash || p.ConfirmationSHA256 != cHash || c.MainReviewHash != p.MainReviewHash || c.BatchCode != p.BatchCode || c.SnapshotSHA256 != p.SnapshotSHA256 {
		return ErrInput
	}
	binding, hash, err := e.profile.RuntimeBinding()
	if err != nil || hash != p.RuntimeConfigSHA256 || e.checkMainRuntimeConfig(hash) != nil {
		return ErrTarget
	}
	if err = CheckTarget(ctx, e.target, e.profile, binding); err != nil {
		return err
	}
	dependencies, err := CheckDependencies(ctx, e.target, e.profile, binding)
	if err != nil || !reflect.DeepEqual(dependencies, e.plan.Dependencies) {
		return ErrDependency
	}
	var mainStatus, mainHash, mainRaw string
	if e.target.QueryRowContext(ctx, "SELECT status,plan_sha256,scope_json FROM mig_batch WHERE BINARY batch_code=BINARY ?", e.profile.BatchCode).Scan(&mainStatus, &mainHash, &mainRaw) != nil || mainStatus != "applied" || mainHash != e.plan.ReviewHash {
		return ErrStep
	}
	var mainScope batchScope
	if json.Unmarshal([]byte(mainRaw), &mainScope) != nil || mainScope.Plan.ReviewHash != mainHash {
		return ErrStep
	}
	allowedBaselines := map[string]bool{}
	for _, table := range baselineTables() {
		if !strings.HasPrefix(table.Physical, "mig_") {
			present, err := baselineTablePresent(ctx, e.target, table.Physical)
			if err != nil {
				return err
			}
			if !present {
				continue
			}
			allowedBaselines[table.Physical] = true
		}
	}
	if len(p.Baseline) != len(allowedBaselines) {
		return ErrInput
	}
	for table := range p.Baseline {
		if !allowedBaselines[table] {
			return ErrInput
		}
	}
	for _, row := range p.Rows {
		seal, ok := mainScope.Seals["altoc_contract/"+row.ContractCode]
		if !ok {
			return ErrStep
		}
		current, err := readSeal(ctx, e.target, seal.Table, seal.KeyColumn, seal.Key)
		if err != nil || current.SHA256 != seal.SHA256 {
			return ErrStep
		}
	}
	stage, err := e.source.VerifyStage(ctx, e.manifest, e.manifestHash)
	if err != nil || CheckStageReceipt(e.plan.Source, stage) != nil {
		return ErrSourceBinding
	}
	data, _, err := e.source.ReadCovered(ctx, e.manifest, e.profile.VaultWrite)
	if err != nil {
		return err
	}
	if err := validateOpeningSource(data, e.manifest, c); err != nil {
		return err
	}
	rows, total, err := openingRows(data, c)
	if err != nil || factsHash(rows) != factsHash(p.Rows) || total != p.Total {
		return ErrStep
	}
	build, err := e.build()
	if err != nil {
		return ErrRuntimeBuild
	}
	return CheckHistoricalContractApply(e.plan.RuntimeBuild, build)
}
func (e *engine) openingApply(ctx context.Context, p OpeningPlan, c OpeningConfirmation, cHash string, vault func(context.Context, string, string, string) error) (ExecutionReceipt, error) {
	receipt := ExecutionReceipt{BatchCode: p.BatchCode, Mode: "opening-apply", Status: "failed"}
	if err := e.stopped(ctx); err != nil {
		return receipt, err
	}
	if err := e.checkOpening(ctx, p, c, cHash); err != nil {
		return receipt, err
	}
	conn, err := e.target.Conn(ctx)
	if err != nil {
		return receipt, ErrTarget
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, e.profile.InstanceID, e.profile.Database)
	if err != nil {
		return receipt, ErrWrite
	}
	defer release()
	var existing int
	if conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM mig_batch WHERE BINARY batch_code=BINARY ?", p.BatchCode).Scan(&existing) != nil {
		return receipt, ErrTarget
	}
	if existing == 0 {
		baseline, err := ReadBaselines(ctx, e.target)
		if err != nil || !reflect.DeepEqual(baseline, p.Baseline) {
			return receipt, ErrConflict
		}
		if err := e.verifyForFollowup(ctx, vault); err != nil {
			return receipt, err
		}
	}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return receipt, ErrWrite
	}
	defer func() { _ = tx.Rollback() }()
	scope := openingScope{Plan: p, Confirmation: c, Seals: map[string]rowSeal{}, Deleted: map[string]bool{}}
	var batchID int64
	var hash, status, raw string
	err = tx.QueryRowContext(ctx, "SELECT id,plan_sha256,status,scope_json FROM mig_batch WHERE BINARY batch_code=BINARY ? FOR UPDATE", p.BatchCode).Scan(&batchID, &hash, &status, &raw)
	if err == sql.ErrNoRows {
		bytes, _ := json.Marshal(scope)
		r, err := tx.ExecContext(ctx, "INSERT INTO mig_batch(batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,started_at,operator) VALUES(?,'wizbiz',?,?,?,'applying',UTC_TIMESTAMP(3),?)", p.BatchCode, e.manifest.SnapshotID, string(bytes), p.ReviewHash, e.profile.Operator)
		if err != nil {
			return receipt, ErrWrite
		}
		batchID, err = r.LastInsertId()
		if err != nil {
			return receipt, ErrWrite
		}
	} else if err != nil || hash != p.ReviewHash || (status != "applied" && status != "applying") || json.Unmarshal([]byte(raw), &scope) != nil || scope.Plan.ReviewHash != p.ReviewHash {
		return receipt, ErrStep
	}
	var priorDone, priorRows int
	var priorStatus string
	var priorDigest sql.NullString
	priorErr := tx.QueryRowContext(ctx, "SELECT done_rows,planned_rows,status,result_sha256 FROM mig_batch_step WHERE batch_id=? AND step='opening-balance'", batchID).Scan(&priorDone, &priorRows, &priorStatus, &priorDigest)
	if priorErr != sql.ErrNoRows && (priorErr != nil || priorRows != len(p.Rows) || priorDone < 0 || priorDone > len(p.Rows) || (priorStatus != "running" && priorStatus != "completed") || (priorStatus == "completed" && (priorDone != len(p.Rows) || priorDigest.String != factsHash(p.Rows)))) {
		return receipt, ErrStep
	}
	for index, row := range p.Rows {
		if err := e.stopped(ctx); err != nil {
			return receipt, err
		}
		var contractID int64
		var direction, origin, source string
		if tx.QueryRowContext(ctx, "SELECT id,direction,origin_type,source_type FROM altoc_contract WHERE BINARY code=BINARY ? FOR UPDATE", row.ContractCode).Scan(&contractID, &direction, &origin, &source) != nil || direction != "sales" || origin != "historical_import" || source != "historical_import" {
			return receipt, ErrTarget
		}
		var id int64
		var amount, received, kind, trigger, sourceType, code string
		var due, collector sql.NullString
		err := tx.QueryRowContext(ctx, "SELECT id,code,amount,received_amount,plan_type,trigger_type,source_type,due_date,collection_responsible_uid FROM altoc_billing_schedule WHERE contract_id=? AND plan_type='opening_balance' FOR UPDATE", contractID).Scan(&id, &code, &amount, &received, &kind, &trigger, &sourceType, &due, &collector)
		if err == sql.ErrNoRows {
			r, err := tx.ExecContext(ctx, "INSERT INTO altoc_billing_schedule(code,contract_id,direction,name,plan_type,trigger_type,amount,currency_code,due_date,received_amount,collection_responsible_uid,source_type,source_ref_code,owner_uid,created_by) VALUES(?,?,'receivable','历史合同期初应收','opening_balance','manual',?,'CNY',?,0,NULL,'historical_import',?,NULL,?)", row.Code, contractID, row.Amount, row.DueDate, row.ContractCode, e.profile.Operator)
			if err != nil {
				return receipt, ErrWrite
			}
			id, err = r.LastInsertId()
			if err != nil {
				return receipt, ErrWrite
			}
			if err = e.mapRow(ctx, tx, batchID, "wb_contract", row.SourcePK, "altoc", "altoc_billing_schedule", row.Code, "opening", "created"); err != nil {
				return receipt, err
			}
			seal, err := readSeal(ctx, tx, "altoc_billing_schedule", "code", row.Code)
			if err != nil {
				return receipt, err
			}
			scope.Seals[row.Code] = seal
		} else if err != nil || code != row.Code || amount != row.Amount || received != "0.00" || kind != "opening_balance" || trigger != "manual" || sourceType != "historical_import" || collector.Valid || !sameOptionalDate(due, row.DueDate) {
			return receipt, ErrConflict
		}
		seal, ok := scope.Seals[row.Code]
		if !ok {
			return receipt, ErrConflict
		}
		current, err := readSeal(ctx, tx, seal.Table, seal.KeyColumn, seal.Key)
		if err != nil || current.SHA256 != seal.SHA256 {
			return receipt, ErrStep
		}
		if (index+1)%200 == 0 && index+1 < len(p.Rows) {
			if err = recordOpeningStep(ctx, tx, batchID, p, index+1, false); err != nil {
				return receipt, err
			}
			bytes, _ := json.Marshal(scope)
			if _, err = tx.ExecContext(ctx, "UPDATE mig_batch SET scope_json=? WHERE id=? AND plan_sha256=?", string(bytes), batchID, p.ReviewHash); err != nil {
				return receipt, ErrWrite
			}
			if err = tx.Commit(); err != nil {
				return receipt, ErrWrite
			}
			tx, err = conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
			if err != nil {
				return receipt, ErrWrite
			}
			var lockedHash string
			if tx.QueryRowContext(ctx, "SELECT plan_sha256 FROM mig_batch WHERE id=? FOR UPDATE", batchID).Scan(&lockedHash) != nil || lockedHash != p.ReviewHash {
				return receipt, ErrStep
			}
			binding, cfgHash, err := e.profile.RuntimeBinding()
			if err != nil || cfgHash != p.RuntimeConfigSHA256 {
				return receipt, ErrTarget
			}
			if err = CheckTarget(ctx, tx, e.profile, binding); err != nil {
				return receipt, err
			}
		}
	}
	if err = recordOpeningStep(ctx, tx, batchID, p, len(p.Rows), true); err != nil {
		return receipt, err
	}
	bytes, _ := json.Marshal(scope)
	if _, err = tx.ExecContext(ctx, "UPDATE mig_batch SET status='applied',scope_json=?,finished_at=COALESCE(finished_at,UTC_TIMESTAMP(3)) WHERE id=? AND plan_sha256=?", string(bytes), batchID, p.ReviewHash); err != nil {
		return receipt, ErrWrite
	}
	if err = tx.Commit(); err != nil {
		return receipt, ErrWrite
	}
	receipt.Status = "applied"
	return receipt, nil
}
func sameOptionalDate(value sql.NullString, want *string) bool {
	if want == nil {
		return !value.Valid
	}
	return value.Valid && value.String == *want
}

func (e *engine) openingVerify(ctx context.Context, p OpeningPlan, c OpeningConfirmation, cHash string) (independentverify.Result, error) {
	if err := e.checkOpening(ctx, p, c, cHash); err != nil {
		return independentverify.Result{}, err
	}
	tx, err := e.target.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return independentverify.Result{}, ErrTarget
	}
	defer tx.Rollback()
	var batchID int64
	var hash, status string
	if tx.QueryRowContext(ctx, "SELECT id,plan_sha256,status FROM mig_batch WHERE BINARY batch_code=BINARY ?", p.BatchCode).Scan(&batchID, &hash, &status) != nil || hash != p.ReviewHash || status != "applied" {
		return independentverify.Result{}, ErrStep
	}
	data, _, err := e.source.ReadCovered(ctx, e.manifest, e.profile.VaultWrite)
	if err != nil {
		return independentverify.Result{}, err
	}
	input := independentverify.OpeningInput{BatchID: batchID, BatchCode: p.BatchCode, Data: data, Baseline: map[string][]independentverify.Baseline{}}
	for _, row := range c.Contracts {
		input.Confirmed = append(input.Confirmed, independentverify.OpeningConfirmed{SourcePK: row.SourcePK, Amount: row.Amount, DueDate: row.DueDate})
	}
	for table, rows := range p.Baseline {
		input.Baseline[table] = []independentverify.Baseline{}
		for _, row := range rows {
			input.Baseline[table] = append(input.Baseline[table], independentverify.Baseline{Key: row.Key, SHA256: row.SHA256, PrimaryKey: row.PrimaryKey})
		}
	}
	return independentverify.VerifyOpening(ctx, tx, input)
}

func (e *engine) openingRollback(ctx context.Context, p OpeningPlan) (ExecutionReceipt, error) {
	receipt := ExecutionReceipt{BatchCode: p.BatchCode, Mode: "opening-rollback", Status: "failed"}
	if ReviewOpeningPlan(p, p.ReviewHash) != nil || p.MainReviewHash != e.plan.ReviewHash || p.ProfileSHA256 != e.profileHash {
		return receipt, ErrInput
	}
	if err := e.stopped(ctx); err != nil {
		return receipt, err
	}
	binding, hash, err := e.profile.RuntimeBinding()
	if err != nil || hash != p.RuntimeConfigSHA256 || e.checkMainRuntimeConfig(hash) != nil {
		return receipt, ErrTarget
	}
	conn, err := e.target.Conn(ctx)
	if err != nil {
		return receipt, ErrTarget
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, e.profile.InstanceID, e.profile.Database)
	if err != nil {
		return receipt, ErrWrite
	}
	defer release()
	if err = CheckTarget(ctx, conn, e.profile, binding); err != nil {
		return receipt, err
	}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return receipt, ErrWrite
	}
	defer tx.Rollback()
	var batchID int64
	var status, hashStored, raw string
	if tx.QueryRowContext(ctx, "SELECT id,status,plan_sha256,scope_json FROM mig_batch WHERE BINARY batch_code=BINARY ? FOR UPDATE", p.BatchCode).Scan(&batchID, &status, &hashStored, &raw) != nil || hashStored != p.ReviewHash {
		return receipt, ErrStep
	}
	if status == "rolled_back" {
		receipt.Status = status
		return receipt, nil
	}
	var scope openingScope
	if json.Unmarshal([]byte(raw), &scope) != nil || scope.Plan.ReviewHash != p.ReviewHash {
		return receipt, ErrStep
	}
	objects := map[string]*rollbackRow{}
	for code, seal := range scope.Seals {
		if scope.Deleted[code] {
			continue
		}
		current, err := readSeal(ctx, tx, seal.Table, seal.KeyColumn, seal.Key)
		if err != nil {
			return receipt, ErrStep
		}
		var id string
		if tx.QueryRowContext(ctx, "SELECT CAST(id AS CHAR) FROM altoc_billing_schedule WHERE BINARY code=BINARY ? FOR UPDATE", code).Scan(&id) != nil {
			return receipt, ErrTarget
		}
		objects[code] = &rollbackRow{seal: seal, id: id, code: code, safe: current.SHA256 == seal.SHA256}
	}
	for code, o := range objects {
		used, err := rollbackUsed(ctx, tx, o, objects)
		if err != nil {
			return receipt, err
		}
		if used || !o.safe {
			receipt.Retained++
			receipt.RetainedObjects = append(receipt.RetainedObjects, o.seal)
			continue
		}
		if err = e.stopped(ctx); err != nil {
			return receipt, err
		}
		r, err := tx.ExecContext(ctx, "DELETE FROM altoc_billing_schedule WHERE BINARY code=BINARY ?", code)
		if err != nil {
			return receipt, ErrWrite
		}
		n, err := r.RowsAffected()
		if err != nil || n != 1 {
			return receipt, ErrStep
		}
		scope.Deleted[code] = true
	}
	receipt.Status = "rolled_back"
	if receipt.Retained > 0 {
		receipt.Status = "rollback_partial"
	}
	bytes, _ := json.Marshal(scope)
	if _, err = tx.ExecContext(ctx, "UPDATE mig_batch SET status=?,scope_json=?,finished_at=UTC_TIMESTAMP(3) WHERE id=? AND plan_sha256=?", receipt.Status, string(bytes), batchID, p.ReviewHash); err != nil {
		return receipt, ErrWrite
	}
	if tx.Commit() != nil {
		return receipt, ErrWrite
	}
	return receipt, nil
}

type OpeningInputs struct {
	FollowupAudit                           *FollowupAudit
	BaselineRuntimeConfig                   string
	Source                                  *SourceSnapshot
	Target, Directory                       *sql.DB
	Profile                                 Profile
	ProfileHash, ManifestHash, IdentityHash string
	Manifest                                SnapshotManifest
	Identities                              map[string]IdentityConfirmation
	MainPlan                                Plan
	Confirmation                            OpeningConfirmation
	ConfirmationHash                        string
}

func ExecuteOpening(ctx context.Context, input OpeningInputs, mode string, p OpeningPlan, hash string) (any, error) {
	if input.Profile.Validate() != nil || ReviewPlan(input.MainPlan, input.MainPlan.ReviewHash) != nil {
		return nil, ErrInput
	}
	e := newEngine(input.Source, input.Target, input.Directory, input.Profile, input.ProfileHash, input.Manifest, input.ManifestHash, input.Identities, input.IdentityHash, input.MainPlan)
	e.baselineRuntimeConfig = input.BaselineRuntimeConfig
	e.followupAudit = input.FollowupAudit
	if mode != "opening-plan" {
		e.followupAudit = p.Audit
	}
	if mode == "opening-rollback" {
		if ReviewOpeningPlan(p, hash) != nil {
			return nil, ErrInput
		}
		return e.openingRollback(ctx, p)
	}
	if mode != "opening-plan" && mode != "opening-apply" && mode != "opening-verify" {
		return nil, ErrInput
	}
	if mode != "opening-plan" && ReviewOpeningPlan(p, hash) != nil {
		return nil, ErrInput
	}
	vault, err := openRuntimeVault(input.Profile)
	if err != nil {
		return nil, err
	}
	defer vault.Close()
	e.vault = vault
	switch mode {
	case "opening-plan":
		return e.openingPlan(ctx, input.Confirmation, input.ConfirmationHash, vault.Check)
	case "opening-apply":
		return e.openingApply(ctx, p, input.Confirmation, input.ConfirmationHash, vault.Check)
	default:
		return e.openingVerify(ctx, p, input.Confirmation, input.ConfirmationHash)
	}
}

func recordOpeningStep(ctx context.Context, tx *sql.Tx, batchID int64, p OpeningPlan, done int, completed bool) error {
	state := "running"
	var hash any
	if completed {
		state = "completed"
		hash = factsHash(p.Rows)
	}
	_, err := tx.ExecContext(ctx, "INSERT INTO mig_batch_step(batch_id,step,status,planned_rows,done_rows,result_sha256,started_at,finished_at) VALUES(?,'opening-balance',?,?,?,?,UTC_TIMESTAMP(3),IF(?='completed',UTC_TIMESTAMP(3),NULL)) ON DUPLICATE KEY UPDATE status=IF(status='completed',status,VALUES(status)),done_rows=GREATEST(done_rows,VALUES(done_rows)),result_sha256=COALESCE(VALUES(result_sha256),result_sha256),finished_at=COALESCE(finished_at,VALUES(finished_at))", batchID, state, len(p.Rows), done, hash, state)
	if err != nil {
		return ErrWrite
	}
	return nil
}
