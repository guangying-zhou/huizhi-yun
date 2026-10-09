package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed altoc_services.json
var altocServicesManifest []byte

func AltocServicesTables() []Table {
	var t []Table
	if json.Unmarshal(altocServicesManifest, &t) != nil || len(t) != 6 {
		panic("invalid Altoc service manifest")
	}
	return t
}
func IsAltocServicesDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("altoc", d)
	if !validDue {
		return false
	}

	if hasAltocFeedback(d) {
		base, ok := withoutAltocFeedback(d)
		return ok && IsAltocTicketsDomain(base) && IsAltocServicesDomain(base)
	}
	if d.Tables["altoc_renewal_opportunity"] == "altoc_renewal_opportunity" {
		return IsAltocRenewalsDomain(d)
	}
	if IsAltocTicketsDomain(d) {
		return true
	}
	base, _ := APFTables("altoc")
	all := append(append(base, AltocSalesTables()...), AltocServicesTables()...)
	if d.Tables["altoc_tender"] == "altoc_tender" {
		all = append(all, AltocTendersTables()...)
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
func WithAltocServices(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocSalesDomain(d) || IsAltocServicesDomain(d) {
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
	for _, t := range AltocServicesTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["altoc"] = d
	return out, nil
}
func ForAltocServices(e Expectation) Installer {
	return Installer{installer{domain: "altoc-services", manifest: altocServicesManifest, expect: e, apf: true}}
}
func (x *installer) validateAltocServices(b enterprise.Binding) error {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocServicesDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for n, other := range b.Domains {
		if n == "altoc" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range AltocServicesTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
