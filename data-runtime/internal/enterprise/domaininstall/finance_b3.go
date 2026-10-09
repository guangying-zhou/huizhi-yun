package domaininstall

import (
	_ "embed"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed finance_b3.json
var financeB3Manifest []byte

func FinanceB3Tables() []Table {
	var t []Table
	if json.Unmarshal(financeB3Manifest, &t) != nil || len(t) != 7 {
		panic("invalid Finance B3 fixed manifest")
	}
	return t
}
func IsFinanceB3Domain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("finance", d)
	if !validDue {
		return false
	}

	if IsFinance13aDomain(d) {
		return true
	}
	base, _ := APFTables("finance")
	all := append(base, FinanceB3Tables()...)
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

// WithFinanceB3 is pure mapping preparation, not installation or enabling.
func WithFinanceB3(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["finance"]
	if !ok || !IsAPFDomain("finance", d) || IsFinanceB3Domain(d) {
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
	for _, t := range FinanceB3Tables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["finance"] = d
	return out, nil
}
func ForFinanceB3(e Expectation) Installer {
	return Installer{installer{domain: "finance-b3", manifest: financeB3Manifest, expect: e, apf: true}}
}
func (x *installer) validateFinanceB3(b enterprise.Binding) error {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinanceB3Domain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "finance" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range FinanceB3Tables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
