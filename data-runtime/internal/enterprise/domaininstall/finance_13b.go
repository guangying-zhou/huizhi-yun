package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed finance_13b.json
var finance13bManifest []byte

func Finance13bTables() []Table {
	var t []Table
	if json.Unmarshal(finance13bManifest, &t) != nil || len(t) != 1 {
		panic("invalid Finance13b manifest")
	}
	return t
}
func IsFinance13bDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("finance", d)
	if !validDue {
		return false
	}

	if IsFinanceCostDomain(d) {
		return true
	}
	base, _ := APFTables("finance")
	all := append(append(append(base, FinanceB3Tables()...), Finance13aTables()...), Finance13bTables()...)
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
func WithFinance13b(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinance13aDomain(d) || IsFinance13bDomain(d) {
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
	for _, t := range Finance13bTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["finance"] = d
	return out, nil
}
func ForFinance13b(e Expectation) Installer {
	return Installer{installer{domain: "finance-13b", manifest: finance13bManifest, expect: e, apf: true}}
}
func (x *installer) validateFinance13b(b enterprise.Binding) error {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinance13bDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "finance" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range Finance13bTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
