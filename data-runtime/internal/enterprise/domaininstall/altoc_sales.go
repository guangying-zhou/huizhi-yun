package domaininstall

import (
	_ "embed"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed altoc_sales.json
var altocSalesManifest []byte

func AltocSalesTables() []Table {
	var t []Table
	if json.Unmarshal(altocSalesManifest, &t) != nil || len(t) != 8 {
		panic("invalid Altoc B2 fixed manifest")
	}
	return t
}
func IsAltocSalesDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("altoc", d)
	if !validDue {
		return false
	}

	if hasAltocFeedback(d) {
		base, ok := withoutAltocFeedback(d)
		return ok && IsAltocTicketsDomain(base) && IsAltocSalesDomain(base)
	}
	base, _ := APFTables("altoc")
	all := append(base, AltocSalesTables()...)
	if IsAltocServicesDomain(d) || IsAltocTendersDomain(d) {
		return true
	}
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

// WithAltocSales is pure mapping preparation, not installation or enabling.
func WithAltocSales(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAPFDomain("altoc", d) || IsAltocSalesDomain(d) {
		return b, ErrBoundary
	}
	out := b
	out.Domains = map[string]enterprise.DomainBinding{}
	for k, v := range b.Domains {
		out.Domains[k] = v
	}
	d.Tables = map[string]string{}
	for k, v := range b.Domains["altoc"].Tables {
		d.Tables[k] = v
	}
	for _, t := range AltocSalesTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["altoc"] = d
	return out, nil
}
func ForAltocSales(e Expectation) Installer {
	return Installer{installer{domain: "altoc-sales", manifest: altocSalesManifest, expect: e, apf: true}}
}
func (x *installer) validateAltocSales(b enterprise.Binding) error {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocSalesDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "altoc" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range AltocSalesTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
