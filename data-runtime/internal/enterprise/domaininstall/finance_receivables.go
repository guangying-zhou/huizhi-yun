package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed finance_receivables.json
var financeReceivablesManifest []byte

func FinanceReceivablesTables() []Table {
	var t []Table
	if json.Unmarshal(financeReceivablesManifest, &t) != nil || len(t) != 3 {
		panic("invalid finance receivables manifest")
	}
	return t
}
func withoutFinanceReceivables(domain string, d enterprise.DomainBinding) (enterprise.DomainBinding, bool) {
	n := 0
	for _, t := range FinanceReceivablesTables() {
		if p, ok := d.Tables[t.Logical]; ok {
			if domain != "finance" || p != t.Physical {
				return d, false
			}
			n++
		}
	}
	if n == 0 {
		return d, true
	}
	if n != 3 {
		return d, false
	}
	out := d
	out.Tables = map[string]string{}
	for k, v := range d.Tables {
		out.Tables[k] = v
	}
	for _, t := range FinanceReceivablesTables() {
		delete(out.Tables, t.Logical)
	}
	return out, true
}
func IsFinanceReceivablesDomain(d enterprise.DomainBinding) bool {
	_, ok := withoutFinanceReceivables("finance", d)
	return ok && d.Tables["finance_historical_readiness"] == "finance_historical_readiness" && IsFinanceB3Domain(d)
}
func WithFinanceReceivables(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinanceB3Domain(d) || d.Tables["finance_historical_readiness"] != "" {
		return b, ErrBoundary
	}
	m, ok := b.Domains["migration"]
	if !ok || m.Tables["mig_batch"] != "mig_batch" {
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
	for _, t := range FinanceReceivablesTables() {
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["finance"] = d
	return out, nil
}
func ForFinanceReceivables(e Expectation) Installer {
	return Installer{installer{domain: "finance-receivables", manifest: financeReceivablesManifest, expect: e, apf: true}}
}
func (x *installer) validateFinanceReceivables(b enterprise.Binding) error {
	d, ok := b.Domains["finance"]
	if !ok || !IsFinanceReceivablesDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, o := range b.Domains {
		if name == "finance" {
			continue
		}
		for k, v := range o.Tables {
			for _, t := range FinanceReceivablesTables() {
				if k == t.Logical || v == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
