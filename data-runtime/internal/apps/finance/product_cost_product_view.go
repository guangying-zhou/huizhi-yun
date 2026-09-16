package finance

import "fmt"

type productCostCurrencyView struct {
	CurrencyCode string `json:"currencyCode"`
	Amount       string `json:"amount"`
}

type productProjectCostView struct {
	ProductCode    string                    `json:"productCode"`
	ProjectCode    string                    `json:"projectCode"`
	PeriodMonth    string                    `json:"periodMonth"`
	Ready          bool                      `json:"ready"`
	Reasons        []string                  `json:"reasons"`
	RuleRevision   int64                     `json:"ruleRevision"`
	SourceRevision string                    `json:"sourceRevision"`
	BasisPoints    *int                      `json:"basisPoints"`
	Costs          []productCostCurrencyView `json:"costs"`
	CostBasis      string                    `json:"costBasis"`
	RevenueReady   bool                      `json:"revenueReady"`
	RevenueReason  string                    `json:"revenueReason"`
}

// Call only after authorizing both requested product and project. This is a
// projection, not an authorization helper. Keep the complete project rules for
// calculation, then expose only the requested product; never renormalize shares.
func projectProductCostView(snapshot productCostSnapshot, productCode, projectCode, periodMonth string) (productProjectCostView, error) {
	view := productProjectCostView{ProductCode: productCode, ProjectCode: projectCode, PeriodMonth: periodMonth,
		Reasons: []string{}, Costs: []productCostCurrencyView{}, CostBasis: "finance_non_canceled_expense_and_active_allocations_v1",
		RevenueReason: "revenue_attribution_not_configured"}
	if !validProductAttributionKey(productCode, 64) {
		return view, fmt.Errorf("invalid product code")
	}
	validation := productCostAttributionRules{ProjectCode: projectCode, PeriodMonth: periodMonth, Revision: 1, EvidenceRef: "view-validation"}
	if _, err := distributeProductCost("0.00", "CNY", validation); err != nil {
		return view, err
	}
	if snapshot.Rules != nil {
		if snapshot.Rules.ProjectCode != projectCode || snapshot.Rules.PeriodMonth != periodMonth {
			return view, fmt.Errorf("product cost snapshot scope mismatch")
		}
		for _, share := range snapshot.Rules.Shares {
			if share.ProductCode == productCode {
				value := share.BasisPoints
				view.BasisPoints = &value
				break
			}
		}
	}
	result := aggregateProductProjectCost(snapshot)
	view.RuleRevision, view.SourceRevision = result.RuleRevision, result.SourceRevision
	view.Reasons = append(view.Reasons, result.Reasons...)
	if view.BasisPoints == nil {
		view.Reasons = append(view.Reasons, "product_not_attributed")
		return view, nil
	}
	if !result.Ready {
		return view, nil
	}
	for _, distribution := range result.Distributions {
		for _, product := range distribution.Products {
			if product.ProductCode == productCode {
				view.Costs = append(view.Costs, productCostCurrencyView{CurrencyCode: distribution.CurrencyCode, Amount: product.Amount})
				break
			}
		}
	}
	view.Ready = true
	return view, nil
}
