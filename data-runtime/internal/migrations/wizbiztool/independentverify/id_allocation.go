package independentverify

import (
	"math/big"
	"sort"
)

type IDAssignment struct{ SourceTable, SourcePK, Table, Role, ID string }
type IDBoundary struct {
	Start, TargetMaximum string
	ReferenceValues      []string
}

func (v *verifier) allocatedIDs() {
	groups := map[string][]IDAssignment{}
	for _, a := range v.input.IDAssignments {
		groups[a.Table] = append(groups[a.Table], a)
	}
	for table, assignments := range groups {
		boundary, ok := v.input.IDBoundaries[table]
		start, valid := new(big.Int).SetString(boundary.Start, 10)
		if !ok || !valid || start.Sign() < 1 {
			v.fail(table, "", "id_boundary")
			continue
		}
		top, valid := new(big.Int).SetString(boundary.TargetMaximum, 10)
		if !valid || top.Sign() < 0 {
			v.fail(table, "", "id_boundary")
			continue
		}
		refs := map[string]bool{}
		for _, ref := range boundary.ReferenceValues {
			n, valid := new(big.Int).SetString(ref, 10)
			if !valid {
				v.fail(table, "", "id_reference")
				continue
			}
			refs[n.String()] = true
			if n.Cmp(top) > 0 {
				top = n
			}
		}
		if new(big.Int).Add(top, big.NewInt(1)).Cmp(start) != 0 {
			v.fail(table, "", "id_start")
		}
		sort.Slice(assignments, func(i, j int) bool {
			a, b := assignments[i], assignments[j]
			return a.SourceTable+"/"+a.SourcePK+"/"+a.Role < b.SourceTable+"/"+b.SourcePK+"/"+b.Role
		})
		seen := map[string]bool{}
		for i, a := range assignments {
			expected := new(big.Int).Add(start, big.NewInt(int64(i))).String()
			if a.ID != expected || seen[a.ID] || refs[a.ID] {
				v.fail(a.SourceTable, a.SourcePK, "id_assignment")
			}
			seen[a.ID] = true
			key, ok := v.mapping(a.SourceTable, a.SourcePK, a.Table, a.Role)
			if !ok {
				continue
			}
			col := "id"
			switch a.Table {
			case "altoc_customer", "altoc_contact", "altoc_contract", "finance_bank_account", "finance_legal_entity":
				col = "code"
			case "altoc_contract_party", "finance_account_balance_entry", "finance_account_balance_snapshot":
			default:
				v.fail(a.SourceTable, a.SourcePK, "id_table")
				continue
			}
			row, err := readRow(v.ctx, v.q, a.Table, col, key)
			if err != nil || text(row, "id") != a.ID {
				v.fail(a.SourceTable, a.SourcePK, "id_explicit")
			}
			v.result.Checked++
		}
	}
}
