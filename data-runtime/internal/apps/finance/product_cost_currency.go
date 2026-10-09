package finance

import (
	"encoding/json"
	"time"
)

type productCostAllocationFact struct {
	Code, ProjectCode, PeriodMonth, EmployeeUID   string
	AllocationType, SourceTable, RuleCode, Status string
	Amount, CurrencyCode                          string
	SourceRefs                                    json.RawMessage
}

// Non-labor allocations use their explicitly recorded Finance ledger currency.
// Managed labor still requires matching source snapshots; a ledger currency
// cannot bypass that evidence. A resolved currency is not
// a declaration that the whole project's costs or revenue are ready.
func productCostAllocationCurrency(fact productCostAllocationFact) (currency, reason string) {
	if fact.Status == "reversed" {
		return "", "allocation_reversed"
	}
	period, periodErr := time.Parse("2006-01", fact.PeriodMonth)
	if fact.Status != "active" || periodErr != nil || period.Year() < 1 || period.Format("2006-01") != fact.PeriodMonth || !productCostAmountPattern.MatchString(fact.Amount) ||
		!validProductAttributionKey(fact.Code, 50) {
		return "", "invalid_allocation_fact"
	}
	if fact.AllocationType != "labor" || fact.SourceTable != managedLaborSourceTable || fact.RuleCode != managedLaborRuleCode {
		if fact.SourceTable == managedLaborSourceTable || fact.RuleCode == managedLaborRuleCode {
			return "", "unsupported_cost_currency_source"
		}
		switch fact.AllocationType {
		case "asset", "shared_expense", "other":
			if !productCostCurrencyPattern.MatchString(fact.CurrencyCode) {
				return "", "missing_cost_currency"
			}
			return fact.CurrencyCode, ""
		}
		return "", "unsupported_cost_currency_source"
	}
	var refs struct {
		SourceApp       string `json:"sourceApp"`
		ProjectCode     string `json:"projectCode"`
		PeriodMonth     string `json:"periodMonth"`
		CostBasis       string `json:"costBasis"`
		CalculationRule string `json:"calculationRule"`
		People          struct {
			EmployeeUID      string `json:"employeeUid"`
			StandardRateCode string `json:"standardRateCode"`
			Currency         string `json:"standardRateCurrencyCode"`
		} `json:"people"`
		Parameters struct {
			Code          string `json:"code"`
			Currency      string `json:"currencyCode"`
			EffectiveDate string `json:"effectiveDate"`
		} `json:"financeCostParameters"`
	}
	if json.Unmarshal(fact.SourceRefs, &refs) != nil {
		return "", "invalid_cost_source_evidence"
	}
	if refs.SourceApp != "finance" || refs.CostBasis != "standard" ||
		refs.CalculationRule != "aims_workload_standard_cost_calendar_hours_v1" ||
		refs.ProjectCode != fact.ProjectCode || refs.PeriodMonth != fact.PeriodMonth ||
		!validProductAttributionKey(fact.ProjectCode, 50) ||
		!validProductAttributionKey(fact.EmployeeUID, 50) || refs.People.EmployeeUID != fact.EmployeeUID ||
		!validProductAttributionKey(refs.People.StandardRateCode, 64) ||
		!validProductAttributionKey(refs.Parameters.Code, 50) || refs.Parameters.EffectiveDate != fact.PeriodMonth+"-01" {
		return "", "cost_source_evidence_mismatch"
	}
	if !productCostCurrencyPattern.MatchString(refs.People.Currency) || !productCostCurrencyPattern.MatchString(refs.Parameters.Currency) {
		return "", "missing_cost_currency"
	}
	if refs.People.Currency != refs.Parameters.Currency {
		return "", "mixed_cost_source_currencies"
	}
	if fact.CurrencyCode != "" && fact.CurrencyCode != refs.Parameters.Currency {
		return "", "mixed_cost_source_currencies"
	}
	return refs.Parameters.Currency, ""
}
