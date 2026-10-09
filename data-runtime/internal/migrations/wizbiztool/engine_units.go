package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type writeUnit struct {
	table, pk, digest string
	row               map[string]any
	object            *PreparedObject
	exception         *Exception
}

func buildUnits(step string, p Prepared, data SourceData) []writeUnit {
	units := []writeUnit{}
	declarations := Declarations()
	if step == "ledger-preserve" || step == "identity" {
		for _, table := range SortedTableNamesFromData(data) {
			if (step == "ledger-preserve" && !preserveSourceTables[table]) || (step == "identity" && table != "wb_employee" && table != "sys_user") {
				continue
			}
			for _, row := range data[table] {
				raw, _ := CanonicalRow(row)
				units = append(units, writeUnit{table: table, pk: sourceText(row, declarations[table].PrimaryKey[0]), row: row, digest: Digest(raw)})
			}
		}
	}
	for i := range p.Objects {
		obj := &p.Objects[i]
		if obj.Step == step {
			units = append(units, writeUnit{table: obj.SourceTable, pk: obj.SourcePK, digest: preparedDigest(*obj), object: obj})
		}
	}
	if step == "exceptions" {
		for i := range p.Exceptions {
			exception := &p.Exceptions[i]
			units = append(units, writeUnit{table: exception.Table, pk: exception.PK, digest: preparedDigest(*exception), exception: exception})
		}
	}
	if step == "exceptions" {
		for _, table := range SortedTableNamesFromData(data) {
			if preserveSourceTables[table] || table == "wb_employee" || table == "sys_user" {
				continue
			}
			for _, row := range data[table] {
				pk := sourceText(row, declarations[table].PrimaryKey[0])
				represented := false
				for _, obj := range p.Objects {
					if obj.SourceTable == table && obj.SourcePK == pk {
						represented = true
						break
					}
				}
				if !represented {
					raw, _ := CanonicalRow(row)
					units = append(units, writeUnit{table: table, pk: pk, row: row, digest: Digest(raw)})
				}
			}
		}
	}

	return units
}
func (e *engine) writeUnit(ctx context.Context, tx *sql.Tx, batchID int64, step string, unit writeUnit, data SourceData, prepared Prepared, scope *batchScope) error {
	if unit.row != nil {
		if err := e.ledger(ctx, tx, batchID, unit.table, unit.pk, unit.row, prepared); err != nil {
			return err
		}
		if step == "identity" {
			if err := e.identityRow(ctx, tx, unit, prepared); err != nil {
				return err
			}
			return e.mapRow(ctx, tx, batchID, unit.table, unit.pk, "migration", "mig_identity_map", identityKey(unit.table, unit.pk), "identity", "created")
		}
		return e.mapRow(ctx, tx, batchID, unit.table, unit.pk, "migration", unit.table, unit.pk, "preserve", "preserved_only")
	}
	if unit.exception != nil {
		raw, _ := json.Marshal(unit.exception.Detail)
		var existing string
		err := tx.QueryRowContext(ctx, "SELECT detail_json FROM mig_exception WHERE batch_id=? AND kind=? AND source_table=? AND source_pk=?", batchID, unit.exception.Kind, unit.table, unit.pk).Scan(&existing)
		if err == nil {
			var actual map[string]any
			if json.Unmarshal([]byte(existing), &actual) != nil || factsHash(actual) != factsHash(unit.exception.Detail) {
				return ErrStep
			}
			return nil
		}
		if err != sql.ErrNoRows {
			return ErrWrite
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO mig_exception(batch_id,owning_domain,kind,source_table,source_pk,target_table,target_key,detail_json) VALUES(?,?,?,?,?,?,?,?)", batchID, unit.exception.Domain, unit.exception.Kind, unit.table, unit.pk, unit.exception.TargetTable, unit.exception.TargetKey, string(raw))

		if err != nil {
			return ErrWrite
		}
		// Exceptions that preserve a row without creating a domain object still
		// need a ledger/map. Date-group exceptions are recorded independently.
		if row := e.sourceRows[unit.table][unit.pk]; row != nil {
			if err := e.ledger(ctx, tx, batchID, unit.table, unit.pk, row, prepared); err != nil {
				return err
			}
		}
		return nil
	}
	obj := *unit.object
	if obj.Table == "finance_bank_account" && obj.Role == "primary" {
		if e.vault == nil {
			return ErrVault
		}
		if err := e.vault.Ensure(ctx, obj, sourceBankAccount(data, obj.SourcePK), e.profile); err != nil {
			return err
		}
	}
	row := e.sourceRows[obj.SourceTable][obj.SourcePK]
	if row == nil {
		return ErrSourceBinding
	}
	if err := e.ledger(ctx, tx, batchID, obj.SourceTable, obj.SourcePK, row, prepared); err != nil {
		return err
	}

	key, err := resolveValue(ctx, tx, obj.Key)
	if err != nil {
		return err
	}
	var mapped string
	err = tx.QueryRowContext(ctx, "SELECT target_key FROM mig_object_map WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND target_table=? AND map_role=? AND disposition IN ('created','matched_existing') FOR UPDATE", obj.SourceTable, obj.SourcePK, obj.Table, obj.Role).Scan(&mapped)
	if err == nil {
		if mapped != fmt.Sprint(key) && obj.KeyColumn == "code" {
			return ErrStep
		}
		if err = assertObject(ctx, tx, obj, key); err != nil {
			return err
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return ErrWrite
	}
	values, err := resolveValues(ctx, tx, obj.Values)
	if err != nil {
		return err
	}
	var targetKey string
	disposition := "created"
	if obj.Role == "hierarchy" || obj.Role == "primary-contact" {
		columns := sortedKeys(values)
		assignments := []string{}
		args := []any{}
		for _, column := range columns {
			assignments = append(assignments, "`"+column+"`=?")
			args = append(args, values[column])
		}
		args = append(args, key)
		result, x := tx.ExecContext(ctx, "UPDATE `"+obj.Table+"` SET "+strings.Join(assignments, ",")+" WHERE BINARY `"+obj.KeyColumn+"`=BINARY ?", args...)
		if x != nil {
			return ErrWrite
		}
		count, _ := result.RowsAffected()
		if count > 1 {
			return ErrWrite
		}
		targetKey = fmt.Sprint(key)
		disposition = "matched_existing"
	} else {
		columns := sortedKeys(values)
		names := []string{}
		marks := []string{}
		args := []any{}
		for _, column := range columns {
			if !identifier.MatchString(column) {
				return ErrWrite
			}
			names = append(names, "`"+column+"`")
			marks = append(marks, "?")
			args = append(args, values[column])
		}
		result, x := tx.ExecContext(ctx, "INSERT INTO `"+obj.Table+"` ("+strings.Join(names, ",")+") VALUES ("+strings.Join(marks, ",")+")", args...)
		if x != nil {
			return writeFailure(x, "object_insert", gateObject(obj.Table))
		}
		if obj.KeyColumn == "code" || obj.KeyColumn == "customer_id" || obj.KeyColumn == "contract_id" {
			targetKey = fmt.Sprint(key)
		} else {
			id, x := result.LastInsertId()
			if x != nil {
				return ErrWrite
			}
			targetKey = strconv.FormatInt(id, 10)
		}
	}
	if err = e.mapRow(ctx, tx, batchID, obj.SourceTable, obj.SourcePK, strings.SplitN(obj.Table, "_", 2)[0], obj.Table, targetKey, obj.Role, disposition); err != nil {
		return err
	}
	if err = assertObject(ctx, tx, obj, key); err != nil {
		return err
	}
	sealColumn := obj.KeyColumn
	sealKey := fmt.Sprint(key)
	if obj.KeyColumn == "composite" {
		sealColumn = "id"
		sealKey = targetKey
	}
	seal, err := readSeal(ctx, tx, obj.Table, sealColumn, sealKey)
	if err != nil {
		return err
	}
	scope.Seals[obj.Table+"/"+sealKey] = seal
	return nil
}
func exceptionDomain(table string) string {
	if table == "wb_bank_account" || table == "wb_account_balance" {
		return "finance"
	}
	return "altoc"
}
func sourceBankAccount(data SourceData, pk string) map[string]any {
	for _, row := range data["wb_bank_account"] {
		if sourceText(row, "ba_id") == pk {
			return row
		}
	}
	return nil
}
func (e *engine) ledger(ctx context.Context, tx *sql.Tx, batchID int64, table, pk string, row map[string]any, p Prepared) error {
	ledger := map[string]any{}
	for field, value := range row {
		ledger[field] = value
	}
	var redacted any
	if table == "wb_bank_account" {
		code := p.Codes[table+"/"+pk]
		ref, _ := SecretRef(code)
		// Synthetic rehearsal intentionally does not preserve source account bytes.
		// A typed redaction, never a synthetic value, is stored in the source ledger.
		ledger["account_number"] = VaultRedaction{ref}
		if sourceText(row, "ba_type") == "3" {
			ledger["account_number"] = nil
		}
		redacted = `["account_number"]`
	}
	raw, err := CanonicalRow(ledger)
	if err != nil {
		return err
	}
	digest := Digest(raw)
	var actual, existingJSON string
	err = tx.QueryRowContext(ctx, "SELECT row_sha256,row_json FROM mig_source_row WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND source_snapshot=? FOR UPDATE", table, pk, e.manifest.SnapshotID).Scan(&actual, &existingJSON)
	if err == nil {
		var decoded map[string]any
		if json.Unmarshal([]byte(existingJSON), &decoded) != nil {
			return ErrSourceBinding
		}
		if item, ok := decoded["account_number"].(map[string]any); ok {
			ref, valid := item["secretRef"].(string)
			if len(item) != 2 || item["$redacted"] != "vault" || !valid {
				return ErrSourceBinding
			}
			decoded["account_number"] = VaultRedaction{ref}
		}
		existingRaw, x := CanonicalRow(decoded)
		if x != nil || actual != digest || Digest(existingRaw) != digest {
			return ErrSourceBinding
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return ErrWrite
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO mig_source_row(source_system,source_table,source_pk,source_snapshot,first_batch_id,row_json,row_sha256,redacted_fields,captured_at) VALUES('wizbiz',?,?,?,?,?,?,?,?)", table, pk, e.manifest.SnapshotID, batchID, string(raw), digest, redacted, e.profile.snapshotAt)
	if err != nil {
		return ErrWrite
	}
	return nil
}
func (e *engine) identityRow(ctx context.Context, tx *sql.Tx, unit writeUnit, p Prepared) error {
	namespace := "employee:"
	name, status := "name", "emp_status"
	if unit.table == "sys_user" {
		namespace = "user:"
		name, status = "nick_name", "status"
	}
	state := p.Identity[namespace+unit.pk]
	match := "unmatched"
	var uid, basis, directoryStatus, by, at any
	if state.UID != "" {
		match = "confirmed"
		uid = state.UID
		basis = "user_confirmation"
		directoryStatus = state.Status
		by = state.ConfirmedBy
		instant, x := time.Parse(time.RFC3339, state.ConfirmedAt)
		if x != nil {
			return ErrValue
		}
		at = instant.UTC().Format("2006-01-02 15:04:05.000")
	}
	display := unit.row[name]
	if display == nil {
		display = ""
	}
	var currentUID sql.NullString
	var currentStatus string
	err := tx.QueryRowContext(ctx, "SELECT directory_uid,match_status FROM mig_identity_map WHERE source_system='wizbiz' AND source_user_id=? FOR UPDATE", namespace+unit.pk).Scan(&currentUID, &currentStatus)
	if err == nil {
		if currentStatus != match || (uid == nil && currentUID.Valid) || (uid != nil && currentUID.String != uid) {
			return ErrStep
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return ErrWrite
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO mig_identity_map(source_system,source_user_id,display_name,source_status,directory_uid,match_status,match_basis,directory_status,matched_by,matched_at) VALUES('wizbiz',?,?,?,?,?,?,?,?,?)", namespace+unit.pk, display, unit.row[status], uid, match, basis, directoryStatus, by, at)
	if err != nil {
		return ErrWrite
	}
	return nil
}
func (e *engine) mapRow(ctx context.Context, tx *sql.Tx, batchID int64, table, pk, domain, target, key, role, disposition string) error {
	var existingKey, existingDisposition string
	err := tx.QueryRowContext(ctx, "SELECT target_key,disposition FROM mig_object_map WHERE source_system='wizbiz' AND source_table=? AND source_pk=? AND target_domain=? AND target_table=? AND map_role=? FOR UPDATE", table, pk, domain, target, role).Scan(&existingKey, &existingDisposition)
	if err == nil {
		if existingKey != key || existingDisposition != disposition {
			return ErrStep
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return ErrWrite
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO mig_object_map(source_system,source_table,source_pk,target_domain,target_table,target_key,map_role,disposition,batch_id) VALUES('wizbiz',?,?,?,?,?,?,?,?)", table, pk, domain, target, key, role, disposition, batchID)
	if err != nil {
		return ErrWrite
	}
	return nil
}
func resolveValue(ctx context.Context, q targetQuery, value any) (any, error) {
	ref, ok := value.(Reference)
	if !ok {
		return value, nil
	}
	if !migrationTargets[ref.Table] && ref.Table != "finance_legal_entity" {
		return nil, ErrWrite
	}
	var id uint64
	if q.QueryRowContext(ctx, "SELECT id FROM `"+ref.Table+"` WHERE BINARY code=BINARY ?", ref.Code).Scan(&id) != nil {
		return nil, ErrStep
	}
	return id, nil
}
func resolveValues(ctx context.Context, q targetQuery, values map[string]any) (map[string]any, error) {
	result := map[string]any{}
	for field, value := range values {
		resolved, err := resolveValue(ctx, q, value)
		if err != nil {
			return nil, err
		}
		result[field] = resolved
	}
	return result, nil
}
func sortedKeys(values map[string]any) []string {
	keys := []string{}
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
func assertObject(ctx context.Context, q targetQuery, obj PreparedObject, key any) error {
	values, err := resolveValues(ctx, q, obj.Values)
	if err != nil {
		return err
	}
	predicates := []string{}
	args := []any{}
	for _, field := range sortedKeys(values) {
		if !identifier.MatchString(field) {
			return ErrWrite
		}
		predicates = append(predicates, "BINARY `"+field+"` <=> BINARY ?")
		args = append(args, values[field])
	}
	// Non-code objects may share parent ids: all declared fields must match one
	// and only one row; a duplicate or missing projection is a hard mismatch.
	if obj.KeyColumn != "composite" {
		predicates = append(predicates, "BINARY `"+obj.KeyColumn+"`=BINARY ?")
		args = append(args, key)
	}
	var count int
	if q.QueryRowContext(ctx, "SELECT COUNT(*) FROM `"+obj.Table+"` WHERE "+strings.Join(predicates, " AND "), args...).Scan(&count) != nil || count != 1 {
		return ErrStep
	}

	return nil
}
func readSeal(ctx context.Context, q targetQuery, table, keyColumn, key string) (rowSeal, error) {
	if !targetTableSet()[table] || !identifier.MatchString(keyColumn) {
		return rowSeal{}, ErrWrite
	}
	rows, err := q.QueryContext(ctx, "SELECT * FROM `"+table+"` WHERE BINARY `"+keyColumn+"`=BINARY ?", key)
	if err != nil {
		return rowSeal{}, ErrWrite
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil || !rows.Next() {
		return rowSeal{}, ErrStep
	}
	bytes := make([]sql.RawBytes, len(columns))
	ptr := make([]any, len(columns))
	for i := range ptr {
		ptr[i] = &bytes[i]
	}
	if rows.Scan(ptr...) != nil {
		return rowSeal{}, ErrStep
	}
	row := map[string]any{}
	for i, column := range columns {
		if bytes[i] == nil {
			row[column] = nil
		} else {
			row[column] = string(bytes[i])
		}
	}
	if rows.Next() || rows.Err() != nil {
		return rowSeal{}, ErrStep
	}
	raw, err := CanonicalRow(row)
	if err != nil {
		return rowSeal{}, err
	}
	return rowSeal{table, keyColumn, key, Digest(raw)}, nil
}
func fixedExecutionError(err error) string {
	for _, candidate := range []error{ErrInput, ErrProfile, ErrTarget, ErrSourceBinding, ErrCoverage, ErrConflict, ErrDependency, ErrHistoricalGuard, ErrStep, ErrVault, ErrUsed, ErrWrite} {
		if errors.Is(err, candidate) {
			return candidate.Error()
		}
	}
	return "migration_execution_failed"
}

func identityKey(table, pk string) string {
	if table == "wb_employee" {
		return "employee:" + pk
	}
	return "user:" + pk
}

// Index only the immutable, already verified snapshot. Do not infer identities
// from target rows; duplicate or empty source keys fail closed.
func indexSourceRows(data SourceData) (map[string]map[string]map[string]any, error) {
	declarations := Declarations()
	out := map[string]map[string]map[string]any{}
	for table, rows := range data {
		definition, ok := declarations[table]
		if !ok || len(definition.PrimaryKey) != 1 {
			return nil, ErrSourceBinding
		}
		index := map[string]map[string]any{}
		for _, row := range rows {
			key := sourceText(row, definition.PrimaryKey[0])
			if key == "" || index[key] != nil {
				return nil, ErrSourceBinding
			}
			index[key] = row
		}
		out[table] = index
	}
	return out, nil
}
