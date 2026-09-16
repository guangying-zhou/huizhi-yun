package finance

import (
	"math/big"
	"sort"
	"strings"
	"time"
)

type productProjectCostResult struct {
	Ready           bool
	Reasons         []string
	RuleRevision    int64
	SourceInputHash string
	SourceRevision  string
	Distributions   []productCostDistribution
}

// Produces costs only. Revenue and margin require independent attribution.
// No raw salary snapshots or employee identifiers cross this result boundary.
func aggregateProductProjectCost(snapshot productCostSnapshot) productProjectCostResult {
	result := productProjectCostResult{Reasons: []string{}, Distributions: []productCostDistribution{}}
	reasons := map[string]bool{}
	add := func(reason string) { reasons[reason] = true }
	if revision, err := productCostSourceRevision(snapshot); err != nil {
		add("invalid_cost_source_evidence")
	} else {
		result.SourceRevision = revision
	}
	if snapshot.Rules == nil {
		add("missing_attribution_rules")
	} else {
		result.RuleRevision = snapshot.Rules.Revision
	}
	if !snapshot.SummaryExists || snapshot.ReadinessStatus != "ready" {
		add("project_cost_not_ready")
	}
	if len(snapshot.InputHash) != 64 || !isLowerHex(snapshot.InputHash) {
		add("missing_cost_source_revision")
	} else {
		result.SourceInputHash = snapshot.InputHash
	}
	if _, err := time.Parse(time.RFC3339Nano, snapshot.CheckedAt); err != nil {
		add("missing_cost_readiness_check")
	}
	minor := func(amount string) *big.Int {
		if !productCostAmountPattern.MatchString(amount) {
			return nil
		}
		n, _ := new(big.Int).SetString(strings.ReplaceAll(amount, ".", ""), 10)
		return n
	}
	direct, labor, allocated := minor(snapshot.DirectExpenseAmount), minor(snapshot.LaborCostAmount), minor(snapshot.AllocatedCostAmount)
	if direct == nil || labor == nil || allocated == nil {
		add("missing_cost_summary_amount")
	}
	totals := map[string]*big.Int{}
	directTotal := new(big.Int)
	expenseCodes := map[string]bool{}
	for _, expense := range snapshot.DirectExpenses {
		if !validProductAttributionKey(expense.Code, 50) || expenseCodes[expense.Code] {
			add("invalid_or_duplicate_direct_expense")
			continue
		}
		expenseCodes[expense.Code] = true
		if snapshot.Rules != nil && (expense.ProjectCode != snapshot.Rules.ProjectCode || expense.PeriodMonth != snapshot.Rules.PeriodMonth) {
			add("direct_expense_scope_mismatch")
			continue
		}
		switch expense.Status {
		case "draft", "pending_payment", "paid", "confirmed":
		default:
			add("invalid_direct_expense_status")
			continue
		}
		amount := minor(expense.Amount)
		if amount == nil {
			add("invalid_direct_expense_amount")
			continue
		}
		directTotal.Add(directTotal, amount)
		if !productCostCurrencyPattern.MatchString(expense.Currency) {
			add("missing_direct_expense_currency")
			continue
		}
		if totals[expense.Currency] == nil {
			totals[expense.Currency] = new(big.Int)
		}
		totals[expense.Currency].Add(totals[expense.Currency], amount)
	}
	if direct != nil && direct.Cmp(directTotal) != 0 {
		add("direct_expense_summary_mismatch")
	}
	laborTotal, otherTotal := new(big.Int), new(big.Int)
	seen := map[string]bool{}
	for _, fact := range snapshot.Allocations {
		if fact.Status == "reversed" {
			continue
		}
		if seen[fact.Code] {
			add("duplicate_cost_allocation")
			continue
		}
		seen[fact.Code] = true
		if snapshot.Rules != nil && (fact.ProjectCode != snapshot.Rules.ProjectCode || fact.PeriodMonth != snapshot.Rules.PeriodMonth) {
			add("cost_allocation_scope_mismatch")
			continue
		}
		amount := minor(fact.Amount)
		if amount == nil {
			add("invalid_allocation_fact")
			continue
		}
		if fact.AllocationType == "labor" {
			laborTotal.Add(laborTotal, amount)
		} else {
			otherTotal.Add(otherTotal, amount)
		}
		currency, reason := productCostAllocationCurrency(fact)
		if reason != "" {
			add(reason)
			continue
		}
		if totals[currency] == nil {
			totals[currency] = new(big.Int)
		}
		totals[currency].Add(totals[currency], amount)
	}
	if labor != nil && labor.Cmp(laborTotal) != 0 || allocated != nil && allocated.Cmp(otherTotal) != 0 {
		add("cost_summary_allocation_mismatch")
	}
	if len(totals) == 0 {
		add("missing_cost_currency")
	}
	if len(reasons) == 0 {
		currencies := make([]string, 0, len(totals))
		for currency := range totals {
			currencies = append(currencies, currency)
		}
		sort.Strings(currencies)
		for _, currency := range currencies {
			distribution, err := distributeProductCost(productCostDecimal(totals[currency]), currency, *snapshot.Rules)
			if err != nil {
				add("invalid_cost_attribution_or_amount")
				break
			}
			result.Distributions = append(result.Distributions, distribution)
		}
	}
	for reason := range reasons {
		result.Reasons = append(result.Reasons, reason)
	}
	sort.Strings(result.Reasons)
	result.Ready = len(result.Reasons) == 0
	if !result.Ready {
		result.Distributions = []productCostDistribution{}
	}
	return result
}
