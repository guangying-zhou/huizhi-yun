package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// References are numeric object IDs, never display names or business codes.
// Declared foreign keys supplement these legacy non-FK column names.
var migrationIDReferenceNames = map[string][]string{
	"altoc_customer":                   {"customer_id", "parent_customer_id", "third_party_customer_id", "converted_customer_id"},
	"altoc_contact":                    {"contact_id", "primary_contact_id"},
	"altoc_contract":                   {"contract_id", "source_contract_id", "parent_contract_id"},
	"altoc_contract_party":             {"contract_party_id"},
	"finance_bank_account":             {"bank_account_id", "receiving_bank_account_id", "paying_bank_account_id", "account_id"},
	"finance_legal_entity":             {"legal_entity_id"},
	"finance_account_balance_entry":    {"account_balance_entry_id", "balance_entry_id"},
	"finance_account_balance_snapshot": {"account_balance_snapshot_id", "balance_snapshot_id"},
}

type IDReferenceRow struct {
	KeySHA256 string  `json:"keySha256"`
	Value     *string `json:"value"`
}
type IDReferenceSnapshot struct {
	Table      string           `json:"table"`
	Column     string           `json:"column"`
	PrimaryKey []string         `json:"primaryKey"`
	Rows       []IDReferenceRow `json:"rows"`
	SHA256     string           `json:"sha256"`
	Maximum    string           `json:"maximum"`
}
type IDAllocation struct {
	IDType        string                `json:"idType"`
	TargetMaximum string                `json:"targetMaximum"`
	Start         string                `json:"start"`
	References    []IDReferenceSnapshot `json:"references"`
	IDs           map[string]string     `json:"ids"`
}

func objectIDKey(o PreparedObject) string { return o.SourceTable + "/" + o.SourcePK + "/" + o.Role }
func integerIDType(t string) bool {
	switch t {
	case "tinyint", "smallint", "mediumint", "int", "bigint":
		return true
	}
	return false
}
func maxIDValue(a, b string) string {
	x, _ := new(big.Int).SetString(a, 10)
	y, _ := new(big.Int).SetString(b, 10)
	if x == nil || y == nil {
		return ""
	}
	if x.Cmp(y) < 0 {
		return b
	}
	return a
}
func numericID(v string) (string, error) {
	n, ok := new(big.Int).SetString(v, 10)
	if !ok || n.Sign() < 0 || n.BitLen() > 63 {
		return "", ErrConflict
	}
	return n.String(), nil
}
func allocationKey(table, column string) string { return table + "/" + column }
func registeredIDTables(b enterprise.Binding) map[string]bool {
	out := map[string]bool{}
	for _, d := range b.Domains {
		for _, table := range d.Tables {
			out[table] = true
		}
	}
	return out
}

// Exclude only rows already frozen in this exact batch's committed seals.
// New external references and non-batch rows remain in the snapshot.
func sealedRowFilter(table string, seals map[string]rowSeal) (string, []any, error) {
	groups := map[string][]string{}
	for _, s := range seals {
		if s.Table != table {
			continue
		}
		if !identifier.MatchString(s.KeyColumn) {
			return "", nil, ErrStep
		}
		groups[s.KeyColumn] = append(groups[s.KeyColumn], s.Key)
	}
	cols := allocationKeys(groups)
	parts := []string{}
	args := []any{}
	for _, col := range cols {
		keys := groups[col]
		sort.Strings(keys)
		marks := []string{}
		for _, key := range keys {
			marks = append(marks, "?")
			args = append(args, key)
		}
		parts = append(parts, "BINARY `"+col+"` NOT IN ("+strings.Join(marks, ",")+")")
	}
	if len(parts) == 0 {
		return "", args, nil
	}
	return " WHERE " + strings.Join(parts, " AND "), args, nil
}
func readIDReferences(ctx context.Context, q targetQuery, b enterprise.Binding, target string, seals map[string]rowSeal) ([]IDReferenceSnapshot, error) {
	registered := registeredIDTables(b)
	names := map[string]bool{}
	for _, name := range migrationIDReferenceNames[target] {
		names[name] = true
	}
	refs := map[string][2]string{}
	rows, e := q.QueryContext(ctx, "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION")
	if e != nil {
		return nil, gateFailure(ErrTarget, "id_reference_metadata", "registered_table")
	}
	for rows.Next() {
		var table, col, typ string
		if rows.Scan(&table, &col, &typ) != nil {
			rows.Close()
			return nil, ErrTarget
		}
		if registered[table] && names[col] && integerIDType(typ) {
			if !identifier.MatchString(table) || !identifier.MatchString(col) {
				rows.Close()
				return nil, ErrTarget
			}
			refs[allocationKey(table, col)] = [2]string{table, col}
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, ErrTarget
	}
	rows, e = q.QueryContext(ctx, "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME='id' ORDER BY TABLE_NAME,COLUMN_NAME", target)
	if e != nil {
		return nil, ErrTarget
	}
	for rows.Next() {
		var table, col string
		if rows.Scan(&table, &col) != nil {
			rows.Close()
			return nil, ErrTarget
		}
		if registered[table] {
			if !identifier.MatchString(table) || !identifier.MatchString(col) {
				rows.Close()
				return nil, ErrTarget
			}
			refs[allocationKey(table, col)] = [2]string{table, col}
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, ErrTarget
	}
	out := []IDReferenceSnapshot{}
	for _, key := range allocationKeys(refs) {
		ref := refs[key]
		s := IDReferenceSnapshot{Table: ref[0], Column: ref[1], PrimaryKey: []string{}, Rows: []IDReferenceRow{}, Maximum: "0"}
		pk, e := q.QueryContext(ctx, "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION", s.Table)
		if e != nil {
			return nil, ErrTarget
		}
		cols := []string{}
		for pk.Next() {
			var col string
			if pk.Scan(&col) != nil || !identifier.MatchString(col) {
				pk.Close()
				return nil, ErrTarget
			}
			s.PrimaryKey = append(s.PrimaryKey, col)
			cols = append(cols, "`"+col+"`")
		}
		e = pk.Err()
		pk.Close()
		if e != nil || len(cols) == 0 {
			return nil, gateFailure(ErrTarget, "id_reference_primary_key", "registered_table")
		}
		filter, args, e := sealedRowFilter(s.Table, seals)
		if e != nil {
			return nil, e
		}
		query := "SELECT " + strings.Join(cols, ",") + ",`" + s.Column + "` FROM `" + s.Table + "`" + filter + " ORDER BY " + strings.Join(cols, ",")
		rr, e := q.QueryContext(ctx, query, args...)
		if e != nil {
			return nil, gateFailure(ErrTarget, "id_reference_query", "registered_table")
		}
		for rr.Next() {
			raw := make([]sql.NullString, len(cols)+1)
			ptr := make([]any, len(raw))
			for i := range raw {
				ptr[i] = &raw[i]
			}
			if rr.Scan(ptr...) != nil {
				rr.Close()
				return nil, ErrTarget
			}
			keys := map[string]any{}
			for i, col := range s.PrimaryKey {
				if !raw[i].Valid {
					rr.Close()
					return nil, ErrTarget
				}
				keys[col] = raw[i].String
			}
			canonical, e := CanonicalRow(keys)
			if e != nil {
				rr.Close()
				return nil, e
			}
			r := IDReferenceRow{KeySHA256: Digest(canonical)}
			if raw[len(cols)].Valid {
				v, e := referenceIDValue(raw[len(cols)].String)
				if e != nil {
					rr.Close()
					return nil, e
				}
				r.Value = &v
				s.Maximum = maxIDValue(s.Maximum, v)
			}
			s.Rows = append(s.Rows, r)
		}
		e = rr.Err()
		rr.Close()
		if e != nil {
			return nil, ErrTarget
		}
		sort.Slice(s.Rows, func(i, j int) bool { return s.Rows[i].KeySHA256 < s.Rows[j].KeySHA256 })
		r, _ := json.Marshal(s.Rows)
		s.SHA256 = Digest(r)
		out = append(out, s)
	}
	return out, nil
}
func readIDAllocations(ctx context.Context, q targetQuery, b enterprise.Binding, tables []string, seals map[string]rowSeal) (map[string]IDAllocation, error) {
	out := map[string]IDAllocation{}
	sort.Strings(tables)
	for _, table := range tables {
		if !identifier.MatchString(table) {
			return nil, ErrInput
		}
		var typ string
		e := q.QueryRowContext(ctx, "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='id' AND COLUMN_KEY='PRI' AND EXTRA LIKE '%auto_increment%'", table).Scan(&typ)
		if e == sql.ErrNoRows {
			continue
		}
		if e != nil {
			return nil, ErrTarget
		}
		if !integerIDType(baseIDType(typ)) {
			return nil, ErrTarget
		}
		filter, args, e := sealedRowFilter(table, seals)
		if e != nil {
			return nil, e
		}
		var max string
		if q.QueryRowContext(ctx, "SELECT CAST(COALESCE(MAX(id),0) AS CHAR) FROM `"+table+"`"+filter, args...).Scan(&max) != nil {
			return nil, ErrTarget
		}
		max, e = numericID(max)
		if e != nil {
			return nil, e
		}
		refs, e := readIDReferences(ctx, q, b, table, seals)
		if e != nil {
			return nil, e
		}
		top := max
		for _, r := range refs {
			top = maxIDValue(top, r.Maximum)
		}
		start, _ := new(big.Int).SetString(top, 10)
		start.Add(start, big.NewInt(1))
		if !start.IsInt64() {
			return nil, ErrConflict
		}
		out[table] = IDAllocation{IDType: typ, TargetMaximum: max, Start: start.String(), References: refs, IDs: map[string]string{}}
	}
	return out, nil
}
func allocateObjectIDs(prepared *Prepared, allocations map[string]IDAllocation, assign bool) error {
	byTable := map[string][]int{}
	for i, o := range prepared.Objects {
		if _, ok := allocations[o.Table]; ok && o.Role != "hierarchy" && o.Role != "primary-contact" {
			byTable[o.Table] = append(byTable[o.Table], i)
		}
	}
	for table, indexes := range byTable {
		a := allocations[table]
		sort.Slice(indexes, func(i, j int) bool {
			return objectIDKey(prepared.Objects[indexes[i]]) < objectIDKey(prepared.Objects[indexes[j]])
		})
		n, e := strconv.ParseInt(a.Start, 10, 64)
		if e != nil || n < 1 {
			return ErrConflict
		}
		for i, index := range indexes {
			if int64(i) > int64(^uint64(0)>>1)-n {
				return ErrConflict
			}
			id := strconv.FormatInt(n+int64(i), 10)
			limit := idTypeLimit(a.IDType)
			value, _ := new(big.Int).SetString(id, 10)
			if limit == nil || value.Cmp(limit) > 0 {
				return ErrConflict
			}
			key := objectIDKey(prepared.Objects[index])
			if assign {
				a.IDs[key] = id
			} else if a.IDs[key] != id {
				return ErrStep
			}
			prepared.Objects[index].Values["id"] = id
		}
		if len(a.IDs) != len(indexes) {
			return ErrStep
		}
		allocations[table] = a
	}
	return nil
}

func allocationKeys[T any](values map[string]T) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func checkIDAllocationSnapshot(ctx context.Context, q targetQuery, p Profile, plan Plan, seals map[string]rowSeal) error {
	binding, _, err := p.RuntimeBinding()
	if err != nil {
		return err
	}
	if len(plan.IDAllocations) == 0 {
		return gateFailure(ErrStep, "id_allocation_missing", "registered_table")
	}
	current, err := readIDAllocations(ctx, q, binding, allocationKeys(plan.IDAllocations), seals)
	if err != nil {
		return err
	}
	for table, expected := range plan.IDAllocations {
		actual, ok := current[table]
		if !ok {
			return ErrConflict
		}
		actual.IDs = expected.IDs
		if factsHash(actual) != factsHash(expected) {
			return gateFailure(ErrConflict, "id_reference_snapshot_changed", gateObject(table))
		}
	}
	return nil
}

func referenceIDValue(raw string) (string, error) {
	n, ok := new(big.Int).SetString(raw, 10)
	if !ok || n.BitLen() > 63 {
		return "", ErrConflict
	}
	return n.String(), nil
}
func idTypeLimit(typ string) *big.Int {
	bits := map[string]uint{"tinyint": 8, "smallint": 16, "mediumint": 24, "int": 32, "bigint": 64}[baseIDType(typ)]
	if bits == 0 {
		return nil
	}
	if !strings.Contains(typ, "unsigned") || bits == 64 {
		bits--
	}
	n := new(big.Int).Lsh(big.NewInt(1), bits)
	return n.Sub(n, big.NewInt(1))
}

func baseIDType(typ string) string {
	parts := strings.FieldsFunc(typ, func(r rune) bool { return r == ' ' || r == '(' })
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}
