package wizbiztool

import (
	"context"
	"math/big"
	"reflect"
	"sort"
	"time"
)

const OpeningSourceFinance = "finance_confirmation"
const OpeningSourceUserSnapshot = "user_ruling_snapshot"
const OpeningRulesVersion = "w1-opening-receivable.v1"

// The source type is an operator approval record, not an identity boundary.
// Legacy files without sourceType retain manual finance-confirmation semantics.
func validateOpeningSource(data SourceData, m SnapshotManifest, c OpeningConfirmation) error {
	switch c.SourceType {
	case "", OpeningSourceFinance:
		if c.SourceSQLSHA256 != "" || c.RulesVersion != "" || c.AsOfDate != "" || len(c.Customers) != 0 {
			return ErrInput
		}
		return nil
	case OpeningSourceUserSnapshot:
		if c.Approver == "" || c.Date == "" || c.SourceSQLSHA256 != m.SQLSHA256 || c.RulesVersion != OpeningRulesVersion || len(m.SnapshotID) < 8 {
			return ErrInput
		}
		date, err := time.Parse("20060102", m.SnapshotID[:8])
		if err != nil || c.AsOfDate != date.Format("2006-01-02") {
			return ErrInput
		}
		expected, err := deriveOpeningRows(data)
		if err != nil {
			return err
		}
		// Complete deterministic candidate coverage, exact cents, no inferred due dates.
		customers, err := openingCustomerSummaries(data, expected)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(c.Contracts, expected) || !reflect.DeepEqual(c.Customers, customers) {
			return ErrInput
		}
		return nil
	default:
		return ErrInput
	}
}
func deriveOpeningRows(data SourceData) ([]OpeningConfirmedRow, error) {
	result := []OpeningConfirmedRow{}
	seen := map[string]bool{}
	for _, row := range data["wb_contract"] {
		pk := sourceText(row, "contract_id")
		if seen[pk] {
			return nil, ErrInput
		}
		seen[pk] = true
		typ := sourceText(row, "contract_type")
		if typ == "0" {
			continue
		}
		if _, ok := sourceContractTypes[typ]; !ok {
			return nil, ErrValue
		}
		signed, err := decimal(row["total_amount"])
		if err != nil {
			return nil, err
		}
		cache, err := decimal(row["exec_amount"])
		if err != nil {
			return nil, err
		}
		received := new(big.Rat)
		for _, income := range data["wb_project_income"] {
			if sourceText(income, "contract_id") == pk {
				amount, err := decimal(income["amount"])
				if err != nil {
					return nil, err
				}
				received.Add(received, amount)
			}
		}
		candidate := new(big.Rat).Sub(signed, received)
		if candidate.Cmp(cache) != 0 {
			candidate = cache
		}
		if candidate.Sign() <= 0 {
			continue
		}
		result = append(result, OpeningConfirmedRow{SourcePK: pk, Amount: candidate.FloatString(2)})
	}
	sort.Slice(result, func(i, j int) bool {
		a, _ := ObjectCode("contract", result[i].SourcePK)
		b, _ := ObjectCode("contract", result[j].SourcePK)
		return a < b
	})
	return result, nil
}

// DeriveOpeningConfirmation never writes to a database, reads plaintext bank
// material, or accepts a caller-provided amount. Output is a protected artifact.
func DeriveOpeningConfirmation(ctx context.Context, source *SourceSnapshot, m SnapshotManifest, mHash string, main Plan, header OpeningConfirmation) (OpeningConfirmation, error) {
	if header.SourceType != OpeningSourceUserSnapshot || len(header.Contracts) != 0 || header.MainReviewHash != main.ReviewHash || header.SnapshotSHA256 != mHash || header.BatchCode == main.BatchCode || header.Approver == "" {
		return OpeningConfirmation{}, ErrInput
	}
	if _, err := time.Parse("2006-01-02", header.Date); err != nil {
		return OpeningConfirmation{}, ErrInput
	}
	if ReviewPlan(main, main.ReviewHash) != nil {
		return OpeningConfirmation{}, ErrInput
	}
	stage, err := source.VerifyStage(ctx, m, mHash)
	if err != nil || CheckStageReceipt(main.Source, stage) != nil {
		return OpeningConfirmation{}, ErrSourceBinding
	}
	data, _, err := source.ReadCovered(ctx, m, "forbidden")
	if err != nil {
		return OpeningConfirmation{}, err
	}
	header.Contracts, err = deriveOpeningRows(data)
	if err != nil {
		return OpeningConfirmation{}, err
	}
	header.Customers, err = openingCustomerSummaries(data, header.Contracts)
	if err != nil {
		return OpeningConfirmation{}, err
	}
	if err = validateOpeningSource(data, m, header); err != nil {
		return OpeningConfirmation{}, err
	}
	return header, nil
}

func openingCustomerSummaries(data SourceData, rows []OpeningConfirmedRow) ([]OpeningCustomerSummary, error) {
	contractCustomers := map[string]string{}
	for _, row := range data["wb_contract"] {
		contractCustomers[sourceText(row, "contract_id")] = sourceText(row, "customer_id")
	}
	totals := map[string]*big.Rat{}
	counts := map[string]int{}
	for _, row := range rows {
		customer := contractCustomers[row.SourcePK]
		amount, err := decimal(row.Amount)
		if err != nil {
			return nil, err
		}
		if totals[customer] == nil {
			totals[customer] = new(big.Rat)
		}
		totals[customer].Add(totals[customer], amount)
		counts[customer]++
	}
	result := []OpeningCustomerSummary{}
	for key, total := range totals {
		result = append(result, OpeningCustomerSummary{key, counts[key], total.FloatString(2)})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].SourcePK < result[j].SourcePK })
	return result, nil
}
