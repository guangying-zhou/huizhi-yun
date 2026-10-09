package independentverify

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Query interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type Identity struct {
	UID, Status string
	Department  *string
}
type Field struct{ Name, Disposition, Target string }
type Baseline struct {
	Key, SHA256 string
	PrimaryKey  map[string]string
}
type Input struct {
	IDAssignments                    []IDAssignment
	IDBoundaries                     map[string]IDBoundary
	Data                             map[string][]map[string]any
	Keys                             map[string]string
	Declarations                     map[string][]Field
	Identities                       map[string]Identity
	SnapshotID, BatchCode, VaultMode string
	BatchID                          int64
	Baseline                         map[string][]Baseline
	Vault                            func(context.Context, string, string, string) error
}
type Difference struct {
	Table    string `json:"table"`
	SourcePK string `json:"sourcePk"`
	Check    string `json:"check"`
}
type Result struct {
	Checked          int          `json:"checked"`
	Differences      []Difference `json:"differences"`
	OrphanVaultCount int          `json:"orphanVaultCount"`
}
type verifier struct {
	ctx              context.Context
	q                Query
	input            Input
	result           Result
	expectedMappings map[string]bool
}

func Verify(ctx context.Context, q Query, input Input) (Result, error) {
	v := verifier{ctx: ctx, q: q, input: input, result: Result{Differences: []Difference{}}, expectedMappings: map[string]bool{}}
	if input.BatchID < 1 || len(input.Data) == 0 || len(input.Keys) != len(input.Data) {
		return v.result, ErrVerify
	}
	for _, table := range sourceTables(input.Data) {
		for _, source := range input.Data[table] {
			pk := text(source, input.Keys[table])
			v.ledger(table, pk, source)
			switch table {
			case "wb_organization":
				v.organization(pk, source)
			case "wb_contactman":
				v.contact(pk, source)
			case "wb_bank_account":
				v.account(pk, source)
			case "wb_contract":
				v.contract(pk, source)
			case "wb_account_balance":
				v.balanceEntry(pk, source)
			case "wb_employee", "sys_user":
				v.identity(table, pk, source)
			default:
				v.preserved(table, pk)
			}
		}
	}
	v.exceptions()
	v.balanceGroups()
	v.counts()
	v.baselines()
	v.allocatedIDs()
	if len(v.result.Differences) > 0 {
		return v.result, ErrVerify
	}
	return v.result, nil
}
func (v *verifier) fail(table, pk, check string) {
	v.result.Differences = append(v.result.Differences, Difference{table, pk, check})
}
func (v *verifier) ledger(table, pk string, source map[string]any) {
	expected := map[string]any{}
	for key, value := range source {
		expected[key] = value
	}
	if table == "wb_bank_account" {
		code := code("BA", pk)
		expected["account_number"] = map[string]any{"$redacted": "vault", "secretRef": "hzybase://vault/finance.bank-account." + code + ".account-no"}
		if text(source, "ba_type") == "3" {
			expected["account_number"] = nil
		}
	}
	raw, err := CanonicalSource(expected)
	if err != nil {
		v.fail(table, pk, "source_canonical")
		return
	}
	var actual, hash string
	var firstBatch int64
	err = v.q.QueryRowContext(v.ctx, "SELECT row_json,row_sha256,first_batch_id FROM mig_source_row WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND source_snapshot=?", table, pk, v.input.SnapshotID).Scan(&actual, &hash, &firstBatch)
	if err != nil || hash != SHA(raw) {
		v.fail(table, pk, "ledger_hash")
		return
	}
	var decoded map[string]any
	canonicalErr := json.Unmarshal([]byte(actual), &decoded)
	canonical, x := CanonicalSource(decoded)
	if canonicalErr != nil || x != nil || string(canonical) != string(raw) {
		v.fail(table, pk, "ledger_content")
	}
	v.result.Checked++
}
func (v *verifier) mapping(table, pk, target, role string) (string, bool) {
	var key, disposition string
	err := v.q.QueryRowContext(v.ctx, "SELECT target_key,disposition FROM mig_object_map WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND target_table=? AND map_role=?", table, pk, target, role).Scan(&key, &disposition)
	if err != nil || (disposition != "created" && disposition != "matched_existing") {
		v.fail(table, pk, "mapping")
		return "", false
	}
	v.expectedMappings[table+"/"+pk+"/"+target+"/"+role] = true
	return key, true
}
func (v *verifier) primary(table, pk, target, prefix string) (map[string]any, bool) {
	key, ok := v.mapping(table, pk, target, "primary")
	if !ok {
		return nil, false
	}
	if key != code(prefix, pk) {
		v.fail(table, pk, "deterministic_code")
		return nil, false
	}
	row, err := readRow(v.ctx, v.q, target, "code", key)
	if err != nil {
		v.fail(table, pk, "target_missing")
		return nil, false
	}
	return row, true
}
func (v *verifier) fields(table, pk string, row, expected map[string]any) {
	for field, value := range expected {
		actual, ok := row[field]
		if !ok || !same(actual, value) {
			v.fail(table, pk, "field:"+field)
		}
	}
	v.result.Checked++
}
func (v *verifier) id(target, sourceTable, sourcePK, prefix string) any {
	row, ok := v.primary(sourceTable, sourcePK, target, prefix)
	if !ok {
		return nil
	}
	return row["id"]
}
func (v *verifier) owner(source map[string]any) (string, any) {
	state := v.input.Identities["employee:"+text(source, "employee_id")]
	if state.UID != "" && state.Status == "active" {
		if state.Department != nil {
			return state.UID, *state.Department
		}
		return state.UID, nil
	}
	return "system:unassigned", nil
}
func (v *verifier) audit(source map[string]any) any {
	state := v.input.Identities["user:"+text(source, "operator_id")]
	if state.UID != "" {
		return state.UID
	}
	return nil
}
func (v *verifier) source(table, key string) map[string]any {
	for _, row := range v.input.Data[table] {
		if text(row, v.input.Keys[table]) == key {
			return row
		}
	}
	return nil
}
func (v *verifier) preserved(table, pk string) {
	var count int
	if v.q.QueryRowContext(v.ctx, "SELECT COUNT(*) FROM mig_object_map WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND disposition='preserved_only' AND target_domain='migration'", table, pk).Scan(&count) != nil || count != 1 {
		v.fail(table, pk, "preserved_mapping")
	}
	var domains int
	if v.q.QueryRowContext(v.ctx, "SELECT COUNT(*) FROM mig_object_map WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND target_domain<>'migration'", table, pk).Scan(&domains) != nil || domains != 0 {
		v.fail(table, pk, "preserved_domain_write")
	}
}
func (v *verifier) identity(table, pk string, source map[string]any) {
	namespace := "employee:"
	name := "name"
	status := "emp_status"
	if table == "sys_user" {
		namespace = "user:"
		name = "nick_name"
		status = "status"
	}
	row, err := readRow(v.ctx, v.q, "mig_identity_map", "source_user_id", namespace+pk)
	if err != nil {
		v.fail(table, pk, "identity_mapping")
		return
	}
	state := v.input.Identities[namespace+pk]
	match := "unmatched"
	var uid, directoryStatus any
	if state.UID != "" {
		match = "confirmed"
		uid = state.UID
		directoryStatus = state.Status
	}
	display := source[name]
	if display == nil {
		display = ""
	}
	v.fields(table, pk, row, map[string]any{"directory_uid": uid, "match_status": match, "directory_status": directoryStatus, "display_name": display, "source_status": source[status]})
}
func sourceTables(data map[string][]map[string]any) []string {
	names := []string{}
	for table := range data {
		names = append(names, table)
	}
	sort.Strings(names)
	return names
}
func code(prefix, pk string) string {
	if len(pk) < 6 {
		return prefix + "-W" + strings.Repeat("0", 6-len(pk)) + pk
	}
	return prefix + "-W" + pk
}
func text(row map[string]any, key string) string { value, _ := row[key].(string); return value }
func same(actual, expected any) bool {
	if expected == nil {
		return actual == nil
	}
	if actual == nil {
		return false
	}
	if raw, ok := actual.([]byte); ok {
		actual = string(raw)
	}
	return fmt.Sprint(actual) == fmt.Sprint(expected)
}
func instant(value any) any {
	if value == nil {
		return nil
	}
	raw, ok := value.(string)
	if !ok {
		return "!invalid"
	}
	local, err := time.ParseInLocation("2006-01-02 15:04:05", raw, time.FixedZone("source", 28800))
	if err != nil {
		return "!invalid"
	}
	return local.UTC().Format("2006-01-02 15:04:05.000")
}
func money(value any) (*big.Rat, bool) {
	raw, ok := value.(string)
	if !ok || !regexp.MustCompile(`^-?[0-9]{1,16}\.[0-9]{2}$`).MatchString(raw) {
		return nil, false
	}
	r, ok := new(big.Rat).SetString(raw)
	return r, ok
}
func readRow(ctx context.Context, q Query, table, column string, key any) (map[string]any, error) {
	valid := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	if !valid.MatchString(table) || !valid.MatchString(column) {
		return nil, ErrVerify
	}
	rows, err := q.QueryContext(ctx, "SELECT * FROM `"+table+"` WHERE BINARY `"+column+"`=BINARY ?", key)
	if err != nil {
		return nil, ErrVerify
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil || !rows.Next() {
		return nil, ErrVerify
	}
	raw := make([]sql.RawBytes, len(columns))
	args := make([]any, len(columns))
	for i := range args {
		args[i] = &raw[i]
	}
	if rows.Scan(args...) != nil {
		return nil, ErrVerify
	}
	result := map[string]any{}
	for i, column := range columns {
		if raw[i] == nil {
			result[column] = nil
		} else {
			result[column] = string(raw[i])
		}
	}
	if rows.Next() || rows.Err() != nil {
		return nil, ErrVerify
	}
	return result, nil
}

func readBaseline(ctx context.Context, q Query, table string, keys map[string]string) (map[string]any, error) {
	valid := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	if !valid.MatchString(table) || len(keys) == 0 {
		return nil, ErrVerify
	}
	columns := []string{}
	for key := range keys {
		if !valid.MatchString(key) {
			return nil, ErrVerify
		}
		columns = append(columns, key)
	}
	sort.Strings(columns)
	where, args := []string{}, []any{}
	for _, key := range columns {
		where = append(where, "BINARY `"+key+"`=BINARY ?")
		args = append(args, keys[key])
	}
	rows, err := q.QueryContext(ctx, "SELECT * FROM `"+table+"` WHERE "+strings.Join(where, " AND "), args...)
	if err != nil {
		return nil, ErrVerify
	}
	defer rows.Close()
	names, err := rows.Columns()
	if err != nil || !rows.Next() {
		return nil, ErrVerify
	}
	values := make([]sql.RawBytes, len(names))
	pointers := make([]any, len(values))
	for i := range values {
		pointers[i] = &values[i]
	}
	if rows.Scan(pointers...) != nil {
		return nil, ErrVerify
	}
	out := map[string]any{}
	for i, name := range names {
		if values[i] == nil {
			out[name] = nil
		} else {
			out[name] = string(values[i])
		}
	}
	if rows.Next() || rows.Err() != nil {
		return nil, ErrVerify
	}
	return out, nil
}
