package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed finance_13a.json
var finance13aManifest []byte

func Finance13aTables() []Table {
	var t []Table
	if json.Unmarshal(finance13aManifest, &t) != nil || len(t) != 5 {
		panic("invalid Finance13a manifest")
	}
	return t
}
func IsFinance13aDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("finance", d)
	if !validDue {
		return false
	}

	if IsFinance13bDomain(d) {
		return true
	}
	base, _ := APFTables("finance")
	all := append(append(base, FinanceB3Tables()...), Finance13aTables()...)
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
func WithFinance13a(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinanceB3Domain(d) || IsFinance13aDomain(d) {
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
	for _, t := range Finance13aTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["finance"] = d
	return out, nil
}
func ForFinance13a(e Expectation) Installer {
	return Installer{installer{domain: "finance-13a", manifest: finance13aManifest, expect: e, apf: true}}
}
func (x *installer) validateFinance13a(b enterprise.Binding) error {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinance13aDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "finance" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range Finance13aTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
