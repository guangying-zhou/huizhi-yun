package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed finance_cost.json
var financeCostManifest []byte

func FinanceCostTables() []Table {
	var t []Table
	if json.Unmarshal(financeCostManifest, &t) != nil || len(t) != 6 {
		panic("invalid FinanceCost manifest")
	}
	return t
}
func IsFinanceCostDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("finance", d)
	if !validDue {
		return false
	}

	base, _ := APFTables("finance")
	all := append(append(append(append(base, FinanceB3Tables()...), Finance13aTables()...), Finance13bTables()...), FinanceCostTables()...)
	if len(d.Tables) != len(all) {
		return false
	}
	for _, t := range all {
		if d.Tables[t.Logical] != t.Physical {
			return false
		}
	}
	return true
}
func WithFinanceCost(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinance13bDomain(d) || IsFinanceCostDomain(d) {
		return b, ErrBoundary
	}
	out := b
	out.Domains = map[string]enterprise.DomainBinding{}
	for k, v := range b.Domains {
		out.Domains[k] = v
	}
	d.Tables = map[string]string{}
	for k, v := range b.Domains["finance"].Tables {
		d.Tables[k] = v
	}
	for _, t := range FinanceCostTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["finance"] = d
	return out, nil
}
func ForFinanceCost(e Expectation) Installer {
	return Installer{installer{domain: "finance-cost", manifest: financeCostManifest, expect: e, apf: true}}
}
func (x *installer) validateFinanceCost(b enterprise.Binding) error {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinanceCostDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "finance" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range FinanceCostTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
