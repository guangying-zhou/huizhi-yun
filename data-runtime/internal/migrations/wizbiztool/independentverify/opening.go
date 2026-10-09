package independentverify

import (
	"context"
	"math/big"
	"regexp"
)

type OpeningConfirmed struct {
	SourcePK, Amount string
	DueDate          *string
}
type OpeningInput struct {
	BatchID   int64
	BatchCode string
	Data      map[string][]map[string]any
	Confirmed []OpeningConfirmed
	Baseline  map[string][]Baseline
}

// VerifyOpening reconstructs the expected settlement rows from source and the
// finance confirmation, without the planner's rows, money or code functions.
func VerifyOpening(ctx context.Context, q Query, input OpeningInput) (Result, error) {
	result := Result{Differences: []Difference{}}
	fail := func(pk, check string) {
		result.Differences = append(result.Differences, Difference{"wb_contract", pk, check})
	}
	seen := map[string]bool{}
	totalExpected, totalActual := new(big.Rat), new(big.Rat)
	var count int
	if input.BatchID < 1 || q.QueryRowContext(ctx, "SELECT COUNT(*) FROM mig_object_map WHERE batch_id=? AND target_table='altoc_billing_schedule' AND map_role='opening' AND disposition='created'", input.BatchID).Scan(&count) != nil || count != len(input.Confirmed) {
		fail("", "opening_count")
	}
	for _, confirmed := range input.Confirmed {
		pk := confirmed.SourcePK
		result.Checked++
		var source map[string]any
		for _, row := range input.Data["wb_contract"] {
			if text(row, "contract_id") == pk {
				source = row
				break
			}
		}
		expected, ok := money(confirmed.Amount)
		if source == nil || !ok || expected.Sign() <= 0 || seen[pk] || text(source, "contract_type") == "0" {
			fail(pk, "opening_confirmation")
			continue
		}
		seen[pk] = true
		signed, valid := money(source["total_amount"])
		cache, cacheValid := money(source["exec_amount"])
		if !valid || !cacheValid {
			fail(pk, "opening_source_amount")
			continue
		}
		received := new(big.Rat)
		for _, income := range input.Data["wb_project_income"] {
			if text(income, "contract_id") == pk {
				amount, ok := money(income["amount"])
				if !ok {
					fail(pk, "opening_income_amount")
					continue
				}
				received.Add(received, amount)
			}
		}
		remaining := new(big.Rat).Sub(signed, received)
		if cache.Cmp(remaining) != 0 {
			remaining = cache
		}
		if remaining.Sign() <= 0 {
			fail(pk, "opening_source_nonpositive")
			continue
		}
		var mapped string
		if q.QueryRowContext(ctx, "SELECT target_key FROM mig_object_map WHERE source_system='wizbiz' AND source_table='wb_contract' AND source_pk=? AND target_table='altoc_billing_schedule' AND map_role='opening' AND disposition='created' AND batch_id=?", pk, input.BatchID).Scan(&mapped) != nil || mapped != code("BS", pk) {
			fail(pk, "opening_mapping")
			continue
		}
		row, err := readRow(ctx, q, "altoc_billing_schedule", "code", mapped)
		if err != nil {
			fail(pk, "opening_missing")
			continue
		}
		var actualContract string
		if q.QueryRowContext(ctx, "SELECT code FROM altoc_contract WHERE id=?", row["contract_id"]).Scan(&actualContract) != nil || actualContract != code("CT", pk) {
			fail(pk, "opening_contract")
		}
		expectedValues := map[string]any{"direction": "receivable", "plan_type": "opening_balance", "trigger_type": "manual", "source_type": "historical_import", "source_ref_code": code("CT", pk), "amount": confirmed.Amount, "received_amount": "0.00", "invoiced_amount": "0.00", "currency_code": "CNY", "collection_responsible_uid": nil, "collection_due_at": nil, "payment_term_id": nil, "obligation_id": nil, "contract_line_id": nil, "status": "planned", "workflow_instance_id": nil}
		delete(expectedValues, "workflow_instance_id") // This table deliberately has no Workflow field.
		if confirmed.DueDate == nil {
			expectedValues["due_date"] = nil
		} else {
			expectedValues["due_date"] = *confirmed.DueDate
		}
		for column, want := range expectedValues {
			if row[column] != want {
				fail(pk, "opening_field_"+column)
			}
		}
		actual, ok := money(row["amount"])
		if !ok {
			fail(pk, "opening_amount")
		} else {
			totalActual.Add(totalActual, actual)
		}
		totalExpected.Add(totalExpected, expected)
	}
	if totalActual.Cmp(totalExpected) != 0 {
		fail("", "opening_total")
	}
	for table, baseline := range input.Baseline {
		if !regexp.MustCompile(`^[a-z][a-z0-9_]*$`).MatchString(table) {
			fail("", "opening_baseline_table")
			continue
		}
		var actual int
		added := 0
		if table == "altoc_billing_schedule" {
			added = len(input.Confirmed)
		}
		if q.QueryRowContext(ctx, "SELECT COUNT(*) FROM `"+table+"`").Scan(&actual) != nil || actual != len(baseline)+added {
			fail("", "opening_baseline_count")
		}
		for _, entry := range baseline {
			row, err := readBaseline(ctx, q, table, entry.PrimaryKey)
			if err != nil {
				fail(entry.Key, "opening_baseline_missing")
				continue
			}
			raw, err := CanonicalBaseline(row)
			if err != nil || SHA(raw) != entry.SHA256 {
				fail(entry.Key, "opening_baseline_changed")
			}
		}
	}
	if len(result.Differences) > 0 {
		return result, ErrVerify
	}
	return result, nil
}
