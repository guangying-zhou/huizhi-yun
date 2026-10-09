package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"reflect"
	"regexp"
	"strings"
	"time"
)

var ErrConflict = errors.New("migration_target_conflict")

type ObjectPlan struct {
	Step           string `json:"step"`
	SourceTable    string `json:"sourceTable"`
	SourcePK       string `json:"sourcePk"`
	Table          string `json:"table"`
	Role           string `json:"role"`
	Code           string `json:"code,omitempty"`
	ExpectedSHA256 string `json:"expectedSha256"`
}
type StepPlan struct {
	Step           string `json:"step"`
	Rows           int    `json:"rows"`
	ExpectedSHA256 string `json:"expectedSha256"`
}
type BaselineRow struct {
	Key        string            `json:"key"`
	SHA256     string            `json:"sha256"`
	PrimaryKey map[string]string `json:"primaryKey"`
}
type Plan struct {
	IDAllocations       map[string]IDAllocation  `json:"idAllocations"`
	Version             string                   `json:"version"`
	BatchCode           string                   `json:"batchCode"`
	ProfileSHA256       string                   `json:"profileSha256"`
	RuntimeConfigSHA256 string                   `json:"runtimeConfigSha256"`
	IdentitySHA256      string                   `json:"identitySha256"`
	RuntimeBuild        RuntimeBuildEvidence     `json:"runtimeBuild"`
	Source              StageReceipt             `json:"source"`
	Dependencies        map[string]string        `json:"dependencies"`
	Currency            CurrencyConfirmation     `json:"currency"`
	Coverage            []CoverageField          `json:"coverage"`
	Objects             []ObjectPlan             `json:"objects"`
	Steps               []StepPlan               `json:"steps"`
	ExceptionCounts     map[string]int           `json:"exceptionCounts"`
	Baseline            map[string][]BaselineRow `json:"baseline"`
	ReviewHash          string                   `json:"reviewHash"`
}

func PlanHash(plan Plan) string {
	plan.ReviewHash = ""
	raw, _ := json.Marshal(plan)
	return Digest(raw)
}
func ReadDirectory(ctx context.Context, db *sql.DB, p Profile, confirmations map[string]IdentityConfirmation) (map[string]IdentityState, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, gateFailure(ErrTarget, "transaction", "directory")
	}
	defer tx.Rollback()
	var database, instance string
	if tx.QueryRowContext(ctx, "SELECT DATABASE(),@@server_uuid").Scan(&database, &instance) != nil || database != p.ConsoleDatabase || instance != p.InstanceID {
		return nil, gateFailure(ErrTarget, "server_identity", "directory")
	}
	grants, err := tx.QueryContext(ctx, "SHOW GRANTS FOR CURRENT_USER")
	if err != nil {
		return nil, gateFailure(ErrTarget, "grant_query", "directory")
	}
	var grantRows []string
	for grants.Next() {
		var grant string
		if grants.Scan(&grant) != nil {
			grants.Close()
			return nil, gateFailure(ErrTarget, "grant_scan", "directory")
		}
		grantRows = append(grantRows, grant)
	}
	err = grants.Err()
	grants.Close()
	if err != nil || ValidateSourceGrants(grantRows, p.ConsoleDatabase) != nil {
		return nil, gateFailure(ErrTarget, "grant_scope", "directory")
	}
	result := map[string]IdentityState{}
	for _, confirmation := range confirmations {
		if _, done := result[confirmation.DirectoryUID]; done {
			continue
		}
		var status string
		err := tx.QueryRowContext(ctx, "SELECT status FROM directory_users WHERE BINARY uid=BINARY ?", confirmation.DirectoryUID).Scan(&status)
		if err != nil {
			return nil, gateFailure(ErrTarget, "user_query", "directory")
		}
		state := IdentityState{UID: confirmation.DirectoryUID, Status: status}
		rows, err := tx.QueryContext(ctx, "SELECT dept_code FROM directory_user_departments WHERE BINARY uid=BINARY ? AND is_primary=1 AND status='active'", confirmation.DirectoryUID)
		if err != nil {
			return nil, gateFailure(ErrTarget, "department_query", "directory")
		}
		count := 0
		for rows.Next() {
			var department string
			if rows.Scan(&department) != nil {
				rows.Close()
				return nil, gateFailure(ErrTarget, "department_scan", "directory")
			}
			state.Department = &department
			count++
		}
		err = rows.Err()
		rows.Close()
		if err != nil || count > 1 {
			return nil, gateFailure(ErrTarget, "department_cardinality", "directory")
		}
		result[state.UID] = state
	}
	return result, nil
}

// BuildPlan is read-only on source, target and Directory. Values and names stay
// in memory; only hashes, source keys, deterministic codes and counts leave it.
func BuildPlan(ctx context.Context, source *SourceSnapshot, target, directory *sql.DB, p Profile, profileHash string, m SnapshotManifest, manifestHash string, receipt StageReceipt, confirmations map[string]IdentityConfirmation, identityHash string, build RuntimeBuildEvidence) (Plan, error) {
	if p.Validate() != nil || !validHash(profileHash) || !validHash(identityHash) {
		return Plan{}, ErrProfile
	}
	captured, captureErr := time.Parse("20060102T150405Z", m.SnapshotID)
	if captureErr != nil {
		return Plan{}, ErrSourceBinding
	}
	p.snapshotAt = captured.UTC().Format("2006-01-02 15:04:05.000")
	if !validHash(build.BinarySHA256) || !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(build.Commit) || build.Version == "" {
		return Plan{}, ErrRuntimeBuild
	}
	binding, configHash, err := p.RuntimeBinding()
	if err != nil {
		return Plan{}, planGateFailure(err, "runtime_binding")
	}
	current, err := source.VerifyStage(ctx, m, manifestHash)
	if err != nil {
		return Plan{}, planGateFailure(err, "source_stage")
	}
	if CheckStageReceipt(receipt, current) != nil {
		return Plan{}, ErrSourceBinding
	}
	tx, err := target.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return Plan{}, gateFailure(ErrTarget, "transaction", "target_database")
	}
	defer tx.Rollback()
	if err = CheckTarget(ctx, tx, p, binding); err != nil {
		return Plan{}, planGateFailure(err, "target_identity")
	}
	dependencies, err := CheckDependencies(ctx, tx, p, binding)
	if err != nil {
		return Plan{}, planGateFailure(err, "dependencies")
	}
	data, coverage, err := source.ReadCovered(ctx, m, p.VaultWrite)
	if err != nil {
		return Plan{}, planGateFailure(err, "source_coverage")
	}
	directoryStates, err := ReadDirectory(ctx, directory, p, confirmations)
	if err != nil {
		return Plan{}, planGateFailure(err, "directory_identity")
	}
	identities, err := identityStates(data, confirmations, directoryStates)
	if err != nil {
		return Plan{}, planGateFailure(err, "identity_confirmation")
	}
	prepared, err := BuildPrepared(data, p, identities)
	if err != nil {
		return Plan{}, planGateFailure(err, "transform")
	}
	if err = CheckConflicts(ctx, tx, prepared); err != nil {
		return Plan{}, planGateFailure(err, "conflicts")
	}
	allocationTables := map[string]bool{}
	for _, obj := range prepared.Objects {
		allocationTables[obj.Table] = true
	}
	allocations, err := readIDAllocations(ctx, tx, binding, allocationKeys(allocationTables), nil)
	if err != nil {
		return Plan{}, planGateFailure(err, "id_allocation")
	}
	if err = allocateObjectIDs(&prepared, allocations, true); err != nil {
		return Plan{}, err
	}
	baseline, err := ReadBaselines(ctx, tx)
	if err != nil {
		return Plan{}, planGateFailure(err, "baselines")
	}
	plan := Plan{Version: "wizbiz-migration-plan.v1", BatchCode: p.BatchCode, ProfileSHA256: profileHash, RuntimeConfigSHA256: configHash, IdentitySHA256: identityHash, RuntimeBuild: build, Source: receipt, Dependencies: dependencies, Currency: p.Currency, Coverage: coverage, Objects: []ObjectPlan{}, Steps: []StepPlan{}, ExceptionCounts: map[string]int{}, Baseline: baseline, IDAllocations: allocations}
	for _, obj := range prepared.Objects {
		code, _ := obj.Key.(string)
		plan.Objects = append(plan.Objects, ObjectPlan{obj.Step, obj.SourceTable, obj.SourcePK, obj.Table, obj.Role, code, preparedDigest(obj)})
	}
	for _, exception := range prepared.Exceptions {
		plan.ExceptionCounts[exception.Kind]++
	}
	for _, step := range steps {
		units := buildUnits(step, prepared, data)
		hashes := []string{}
		for _, unit := range units {
			hashes = append(hashes, unit.digest)
		}
		plan.Steps = append(plan.Steps, StepPlan{step, len(units), Digest([]byte(strings.Join(hashes, "\n")))})
	}

	plan.ReviewHash = PlanHash(plan)
	return plan, nil
}
func CheckConflicts(ctx context.Context, q targetQuery, prepared Prepared) error {
	for _, obj := range prepared.Objects {
		if obj.Role != "primary" || obj.KeyColumn != "code" {
			continue
		}
		code, _ := obj.Key.(string)
		var count int
		// No matching by display name. A source-key map must independently bind an
		// existing object before any same-code or same-name row may be reused.
		var target string
		err := q.QueryRowContext(ctx, "SELECT target_key FROM mig_object_map WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND target_table=? AND map_role='primary' AND disposition IN ('created','matched_existing')", obj.SourceTable, obj.SourcePK, obj.Table).Scan(&target)
		existing := err == nil
		if err != nil && err != sql.ErrNoRows {
			return gateFailure(ErrTarget, "identity_map_query", gateObject(obj.Table))
		}
		if existing && target != code {
			return ErrConflict
		}
		if q.QueryRowContext(ctx, "SELECT COUNT(*) FROM `"+obj.Table+"` WHERE BINARY code=BINARY ?", code).Scan(&count) != nil {
			return gateFailure(ErrTarget, "code_query", gateObject(obj.Table))
		}
		if existing {
			if count != 1 {
				return ErrConflict
			}
			continue
		}
		if count != 0 {
			return ErrConflict
		}
		fields := []string{}
		switch obj.Table {
		case "altoc_customer":
			fields = []string{"name", "short_name"}
		case "altoc_contract":
			fields = []string{"contract_no"}
		case "finance_legal_entity":
			fields = []string{"name"}
		case "finance_bank_account":
			fields = []string{"short_name", "account_name"}
		}
		for _, field := range fields {
			value := obj.Values[field]
			if value == nil || value == "" {
				continue
			}
			if q.QueryRowContext(ctx, "SELECT COUNT(*) FROM `"+obj.Table+"` WHERE `"+field+"`=?", value).Scan(&count) != nil {
				return gateFailure(ErrTarget, "unique_field_query", gateObject(obj.Table))
			}
			if count != 0 {
				return ErrConflict
			}
		}
		if obj.Table == "altoc_customer" {
			if q.QueryRowContext(ctx, "SELECT COUNT(*) FROM altoc_customer WHERE source_system='import:wizbiz' AND external_ref=?", obj.SourcePK).Scan(&count) != nil {
				return gateFailure(ErrTarget, "external_reference_query", gateObject(obj.Table))
			}
			if count != 0 {
				return ErrConflict
			}
		}
	}
	// Within-source duplicate unique keys also stop before any partial apply.
	keys := map[string]bool{}
	for _, obj := range prepared.Objects {
		if obj.Role != "primary" {
			continue
		}
		for _, field := range []string{"code", "short_name", "name"} {
			if field == "name" && obj.Table != "finance_legal_entity" {
				continue
			}
			if field == "short_name" && obj.Table != "finance_bank_account" {
				continue
			}
			value := obj.Values[field]
			if value == nil || value == "" {
				continue
			}
			key := obj.Table + "/" + field + "/" + strings.ToLower(value.(string))
			if keys[key] {
				return ErrConflict
			}
			keys[key] = true
		}
	}
	return nil
}
func ReadBaselines(ctx context.Context, q targetQuery) (map[string][]BaselineRow, error) {
	out := map[string][]BaselineRow{}
	for _, table := range baselineTables() {
		if strings.HasPrefix(table.Physical, "mig_") {
			continue
		}
		present, err := baselineTablePresent(ctx, q, table.Physical)
		if err != nil {
			return nil, err
		}
		if !present {
			continue
		}
		keys, err := q.QueryContext(ctx, "SELECT column_name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name=? AND constraint_name='PRIMARY' ORDER BY ordinal_position", table.Physical)
		if err != nil {
			return nil, gateFailure(ErrTarget, "primary_key_query", gateObject(table.Physical))
		}
		primary := []string{}
		order := []string{}
		for keys.Next() {
			var column string
			if keys.Scan(&column) != nil || !identifier.MatchString(column) {
				keys.Close()
				return nil, gateFailure(ErrTarget, "primary_key_scan", gateObject(table.Physical))
			}
			primary = append(primary, column)
			order = append(order, "`"+column+"`")
		}
		if keys.Err() != nil {
			keys.Close()
			return nil, gateFailure(ErrTarget, "primary_key_rows", gateObject(table.Physical))
		}
		keys.Close()
		if len(primary) == 0 {
			return nil, gateFailure(ErrTarget, "primary_key_missing", gateObject(table.Physical))
		}
		rows, err := q.QueryContext(ctx, "SELECT * FROM `"+table.Physical+"` ORDER BY "+strings.Join(order, ","))
		if err != nil {
			return nil, gateFailure(ErrTarget, "baseline_query", gateObject(table.Physical))
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			return nil, gateFailure(ErrTarget, "baseline_columns", gateObject(table.Physical))
		}
		list := []BaselineRow{}
		for rows.Next() {
			values := make([]sql.RawBytes, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if rows.Scan(pointers...) != nil {
				rows.Close()
				return nil, gateFailure(ErrTarget, "baseline_scan", gateObject(table.Physical))
			}
			record := map[string]any{}
			for i, value := range values {
				if value == nil {
					record[columns[i]] = nil
				} else {
					record[columns[i]] = string(value)
				}
			}
			raw, err := CanonicalBaseline(record)
			if err != nil {
				rows.Close()
				return nil, gateFailure(ErrTarget, "baseline_canonical", gateObject(table.Physical))
			}
			keyValues := map[string]string{}
			for _, column := range primary {
				value, ok := record[column].(string)
				if !ok {
					return nil, gateFailure(ErrTarget, "baseline_key", gateObject(table.Physical))
				}
				keyValues[column] = value
			}
			keyJSON, _ := json.Marshal(keyValues)
			list = append(list, BaselineRow{Key: string(keyJSON), SHA256: Digest(raw), PrimaryKey: keyValues})
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, gateFailure(ErrTarget, "baseline_rows", gateObject(table.Physical))
		}
		out[table.Physical] = list
	}
	return out, nil
}
func ReviewPlan(plan Plan, hash string) error {
	if !validHash(hash) || hash != plan.ReviewHash || PlanHash(plan) != hash {
		return ErrInput
	}
	return nil
}
func SamePlanExpectation(reviewed, current Plan) bool {
	current.Source.VerifiedAt = reviewed.Source.VerifiedAt
	return reflect.DeepEqual(reviewed, current)
}

func baselineTables() []domaininstall.Table {
	tables := []domaininstall.Table{}
	seen := map[string]bool{}
	for _, domain := range []string{"altoc", "finance"} {
		all, _ := domaininstall.APFTables(domain)
		for _, table := range all {
			if !seen[table.Physical] {
				seen[table.Physical] = true
				tables = append(tables, table)
			}
		}
	}
	for _, table := range additionalBaselineTables() {
		if !seen[table.Physical] {
			seen[table.Physical] = true
			tables = append(tables, table)
		}
	}
	for _, table := range DependencyTables() {
		if !seen[table.Physical] {
			seen[table.Physical] = true
			tables = append(tables, table)
		}
	}
	return tables
}

func additionalBaselineTables() []domaininstall.Table {
	out := []domaininstall.Table{}
	for _, tables := range [][]domaininstall.Table{domaininstall.FinanceB3Tables(), domaininstall.Finance13aTables(), domaininstall.Finance13bTables(), domaininstall.FinanceCostTables(), domaininstall.AltocSalesTables(), domaininstall.AltocTendersTables(), domaininstall.AltocServicesTables(), domaininstall.AltocTicketsTables(), domaininstall.AltocRenewalsTables(), domaininstall.AltocFeedbackTables(), domaininstall.DueTables("altoc"), domaininstall.DueTables("finance")} {
		out = append(out, tables...)
	}
	return out
}
func baselineTablePresent(ctx context.Context, q targetQuery, table string) (bool, error) {
	var count int
	if q.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'", table).Scan(&count) != nil {
		return false, gateFailure(ErrTarget, "baseline_presence_query", gateObject(table))
	}
	if count == 1 {
		return true, nil
	}
	for _, optional := range additionalBaselineTables() {
		if optional.Physical == table {
			return false, nil
		}
	}
	return false, gateFailure(ErrTarget, "baseline_required_missing", gateObject(table))
}
