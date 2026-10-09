package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

var ErrWrite = errors.New("migration_write_failed")
var ErrStep = errors.New("migration_step_digest_mismatch")
var ErrUsed = errors.New("migration_rollback_object_used")

type ExecutionReceipt struct {
	BatchCode       string         `json:"batchCode"`
	Mode            string         `json:"mode"`
	Status          string         `json:"status"`
	Steps           []StepProgress `json:"steps"`
	Retained        int            `json:"retained"`
	RetainedObjects []rowSeal      `json:"retainedObjects,omitempty"`
	ErrorCode       string         `json:"errorCode,omitempty"`
}
type StepProgress struct {
	Step    string `json:"step"`
	Planned int    `json:"planned"`
	Done    int    `json:"done"`
	Status  string `json:"status"`
}
type rowSeal struct {
	Table     string `json:"table"`
	KeyColumn string `json:"keyColumn"`
	Key       string `json:"key"`
	SHA256    string `json:"sha256"`
}
type batchScope struct {
	VaultUpgrade *VaultUpgradeRecord `json:"vaultUpgrade,omitempty"`
	Plan         Plan                `json:"plan"`
	Seals        map[string]rowSeal  `json:"seals"`
	RolledBack   map[string]bool     `json:"rolledBack,omitempty"`
	Approval     *Approval           `json:"approval,omitempty"`
}

type engine struct {
	followupAudit                           *FollowupAudit
	vaultUpgradeAfterRotate                 func() error
	baselineRuntimeConfig                   string
	source                                  *SourceSnapshot
	target, directory                       *sql.DB
	profile                                 Profile
	profileHash, manifestHash, identityHash string
	manifest                                SnapshotManifest
	plan                                    Plan
	confirmations                           map[string]IdentityConfirmation
	stopped                                 func(context.Context) error
	build                                   func() (RuntimeBuildEvidence, error)
	vault                                   vaultWriter
	sourceRows                              map[string]map[string]map[string]any
}

// ExecuteApply has no bypass for stopped-state/build checks. Test seams are
// private to this package and never accepted through profile or CLI inputs.
func ExecuteApply(ctx context.Context, source *SourceSnapshot, target, directory *sql.DB, p Profile, pHash string, m SnapshotManifest, mHash string, confirmations map[string]IdentityConfirmation, iHash string, plan Plan, reviewHash string) (ExecutionReceipt, error) {
	e := newEngine(source, target, directory, p, pHash, m, mHash, confirmations, iHash, plan)
	if ReviewPlan(plan, reviewHash) != nil {
		return ExecutionReceipt{}, ErrInput
	}
	vault, err := openRuntimeVault(p)
	if err != nil {
		return ExecutionReceipt{}, err
	}
	defer vault.Close()
	e.vault = vault
	return e.apply(ctx)
}
func newEngine(source *SourceSnapshot, target, directory *sql.DB, p Profile, pHash string, m SnapshotManifest, mHash string, c map[string]IdentityConfirmation, iHash string, plan Plan) *engine {
	return &engine{source: source, target: target, directory: directory, profile: p, profileHash: pHash, manifest: m, manifestHash: mHash, confirmations: c, identityHash: iHash, plan: plan, stopped: func(ctx context.Context) error {
		return (cutoverprofile.Profile{Runtime: p.Runtime}).RuntimeStopped(ctx)
	}, build: func() (RuntimeBuildEvidence, error) {
		return ReadTargetRuntimeBuild(p.RuntimeBinary, p.SourceRepository)
	}}
}
func (e *engine) prepared(ctx context.Context) (Prepared, SourceData, error) {
	if e.profile.Validate() != nil || ReviewPlan(e.plan, e.plan.ReviewHash) != nil || e.profileHash != e.plan.ProfileSHA256 || e.identityHash != e.plan.IdentitySHA256 || e.profile.BatchCode != e.plan.BatchCode {
		return Prepared{}, nil, ErrInput
	}
	build, buildErr := e.build()
	if buildErr != nil || !reflect.DeepEqual(build, e.plan.RuntimeBuild) {
		return Prepared{}, nil, ErrTarget
	}
	binding, cfgHash, err := e.profile.RuntimeBinding()
	if err != nil || cfgHash != e.plan.RuntimeConfigSHA256 {
		return Prepared{}, nil, ErrTarget
	}
	if err = CheckTarget(ctx, e.target, e.profile, binding); err != nil {
		return Prepared{}, nil, err
	}
	dependencies, err := CheckDependencies(ctx, e.target, e.profile, binding)
	if err != nil || !reflect.DeepEqual(dependencies, e.plan.Dependencies) {
		return Prepared{}, nil, ErrDependency
	}
	current, err := e.source.VerifyStage(ctx, e.manifest, e.manifestHash)
	if err != nil || CheckStageReceipt(e.plan.Source, current) != nil {
		return Prepared{}, nil, ErrSourceBinding
	}
	data, coverage, err := e.source.ReadCovered(ctx, e.manifest, e.profile.VaultWrite)
	if err != nil || !reflect.DeepEqual(coverage, e.plan.Coverage) {
		return Prepared{}, nil, ErrCoverage
	}
	e.sourceRows, err = indexSourceRows(data)
	if err != nil {
		return Prepared{}, nil, err
	}
	states, err := ReadDirectory(ctx, e.directory, e.profile, e.confirmations)
	if err != nil {
		return Prepared{}, nil, err
	}
	identities, err := identityStates(data, e.confirmations, states)
	if err != nil {
		return Prepared{}, nil, err
	}
	captured, err := time.Parse("20060102T150405Z", e.manifest.SnapshotID)
	if err != nil {
		return Prepared{}, nil, ErrSourceBinding
	}
	e.profile.snapshotAt = captured.UTC().Format("2006-01-02 15:04:05.000")
	prepared, err := BuildPrepared(data, e.profile, identities)
	if err != nil {
		return Prepared{}, nil, err
	}
	if err = allocateObjectIDs(&prepared, e.plan.IDAllocations, false); err != nil {
		return Prepared{}, nil, err
	}
	if len(prepared.Objects) != len(e.plan.Objects) {
		return Prepared{}, nil, ErrStep
	}
	for i, obj := range prepared.Objects {
		if preparedDigest(obj) != e.plan.Objects[i].ExpectedSHA256 {
			return Prepared{}, nil, ErrStep
		}
	}
	return prepared, data, nil
}
func (e *engine) apply(ctx context.Context) (receipt ExecutionReceipt, err error) {
	receipt = ExecutionReceipt{BatchCode: e.profile.BatchCode, Mode: "apply", Status: "failed", Steps: []StepProgress{}}
	defer func() {
		if err != nil {
			receipt.ErrorCode = fixedExecutionError(err)
		}
	}()
	if err = e.stopped(ctx); err != nil {
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
	prepared, data, err := e.prepared(ctx)
	if err != nil {
		return receipt, err
	}
	if err = CheckConflicts(ctx, conn, prepared); err != nil {
		return receipt, err
	}
	var batchID int64
	var scope batchScope
	scope = batchScope{Plan: e.plan, Seals: map[string]rowSeal{}, Approval: e.profile.Approval}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return receipt, ErrWrite
	}
	var existingHash, status, scopeRaw string
	err = tx.QueryRowContext(ctx, "SELECT id,plan_sha256,status,scope_json FROM mig_batch WHERE BINARY batch_code=BINARY ? FOR UPDATE", e.profile.BatchCode).Scan(&batchID, &existingHash, &status, &scopeRaw)
	if err == sql.ErrNoRows {
		if x := checkIDAllocationSnapshot(ctx, tx, e.profile, e.plan, nil); x != nil {
			tx.Rollback()
			return receipt, x
		}
		baseline, x := ReadBaselines(ctx, tx)
		if x != nil || !reflect.DeepEqual(baseline, e.plan.Baseline) {
			tx.Rollback()
			return receipt, ErrConflict
		}
		raw, _ := json.Marshal(scope)
		result, x := tx.ExecContext(ctx, "INSERT INTO mig_batch(batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,started_at,operator) VALUES(?,'wizbiz',?,?,?,'applying',UTC_TIMESTAMP(3),?)", e.profile.BatchCode, e.manifest.SnapshotID, string(raw), e.plan.ReviewHash, e.profile.Operator)
		if x != nil {
			tx.Rollback()
			return receipt, ErrWrite
		}
		batchID, x = result.LastInsertId()
		if x != nil {
			tx.Rollback()
			return receipt, ErrWrite
		}
	} else if err != nil || existingHash != e.plan.ReviewHash || status == "rolled_back" || status == "rollback_partial" || json.Unmarshal([]byte(scopeRaw), &scope) != nil || scope.Plan.ReviewHash != e.plan.ReviewHash {
		tx.Rollback()
		return receipt, ErrStep
	}
	if scope.VaultUpgrade != nil {
		tx.Rollback()
		return receipt, ErrUsed
	}
	if err = checkIDAllocationSnapshot(ctx, tx, e.profile, e.plan, scope.Seals); err != nil {
		tx.Rollback()
		return receipt, err
	}
	if tx.Commit() != nil {
		return receipt, ErrWrite
	}
	for _, step := range e.plan.Steps {
		if step.Step == "contract" {
			current, x := e.build()
			if x != nil {
				return receipt, x
			}
			if x = CheckHistoricalContractApply(e.plan.RuntimeBuild, current); x != nil {
				return receipt, x
			}
		}
		units := buildUnits(step.Step, prepared, data)
		if len(units) != step.Rows {
			return receipt, ErrStep
		}
		var priorStatus string
		var priorRows, priorDone int
		var priorDigest sql.NullString
		priorErr := conn.QueryRowContext(ctx, "SELECT status,planned_rows,done_rows,result_sha256 FROM mig_batch_step WHERE batch_id=? AND step=?", batchID, step.Step).Scan(&priorStatus, &priorRows, &priorDone, &priorDigest)
		if priorErr != sql.ErrNoRows && (priorErr != nil || priorRows != step.Rows || priorDone < 0 || priorDone > step.Rows || (priorStatus != "running" && priorStatus != "completed") || (priorStatus == "completed" && (priorDone != step.Rows || priorDigest.String != step.ExpectedSHA256))) {
			return receipt, ErrStep
		}
		done := 0
		for offset := 0; offset < len(units) || offset == 0; offset += 200 {
			end := offset + 200
			if end > len(units) {
				end = len(units)
			}
			if err = e.stopped(ctx); err != nil {
				return receipt, err
			}
			tx, x := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
			if x != nil {
				return receipt, ErrWrite
			}
			abort := func(er error) (ExecutionReceipt, error) { tx.Rollback(); return receipt, er }
			binding, configHash, bindingErr := e.profile.RuntimeBinding()
			if bindingErr != nil || configHash != e.plan.RuntimeConfigSHA256 {
				return abort(ErrTarget)
			}
			if x = CheckTarget(ctx, tx, e.profile, binding); x != nil {
				return abort(x)
			}
			if _, x = tx.ExecContext(ctx, "INSERT INTO mig_batch_step(batch_id,step,status,planned_rows,done_rows,started_at) VALUES(?,?,'running',?,0,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE status=IF(status='completed',status,'running')", batchID, step.Step, step.Rows); x != nil {
				return abort(ErrWrite)
			}
			for _, unit := range units[offset:end] {
				if x = e.writeUnit(ctx, tx, batchID, step.Step, unit, data, prepared, &scope); x != nil {
					return abort(x)
				}
			}
			done = end
			state := "running"
			var digest any
			if end == len(units) {
				state = "completed"
				all := []string{}
				for _, unit := range units {
					all = append(all, unit.digest)
				}
				digest = Digest([]byte(strings.Join(all, "\n")))
				if digest != step.ExpectedSHA256 {
					return abort(ErrStep)
				}
			}
			if _, x = tx.ExecContext(ctx, "UPDATE mig_batch_step SET status=?,done_rows=?,result_sha256=?,finished_at=IF(?='completed',COALESCE(finished_at,UTC_TIMESTAMP(3)),NULL) WHERE batch_id=? AND step=? AND planned_rows=?", state, done, digest, state, batchID, step.Step, step.Rows); x != nil {
				return abort(ErrWrite)
			}
			raw, _ := json.Marshal(scope)
			if _, x = tx.ExecContext(ctx, "UPDATE mig_batch SET scope_json=? WHERE id=? AND plan_sha256=?", string(raw), batchID, e.plan.ReviewHash); x != nil {
				return abort(ErrWrite)
			}
			if tx.Commit() != nil {
				return receipt, ErrWrite
			}
			if len(units) == 0 {
				break
			}
		}
		receipt.Steps = append(receipt.Steps, StepProgress{step.Step, step.Rows, done, "completed"})
	}
	if _, err = conn.ExecContext(ctx, "UPDATE mig_batch SET status='applied',finished_at=UTC_TIMESTAMP(3) WHERE id=? AND plan_sha256=?", batchID, e.plan.ReviewHash); err != nil {
		return receipt, ErrWrite
	}
	receipt.Status = "applied"
	return receipt, nil
}
