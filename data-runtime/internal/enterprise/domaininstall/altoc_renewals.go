package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed altoc_renewals.json
var altocRenewalsManifest []byte

func AltocRenewalsTables() []Table {
	var t []Table
	if json.Unmarshal(altocRenewalsManifest, &t) != nil || len(t) != 1 {
		panic("invalid Altoc service manifest")
	}
	return t
}
func IsAltocRenewalsDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("altoc", d)
	if !validDue {
		return false
	}

	if hasAltocFeedback(d) {
		base, ok := withoutAltocFeedback(d)
		return ok && IsAltocTicketsDomain(base) && IsAltocRenewalsDomain(base)
	}
	base, _ := APFTables("altoc")
	all := append(append(append(base, AltocSalesTables()...), AltocServicesTables()...), AltocRenewalsTables()...)
	if d.Tables["altoc_service_ticket"] == "altoc_service_ticket" {
		all = append(all, AltocTicketsTables()...)
	}
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
func WithAltocRenewals(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocServicesDomain(d) || IsAltocRenewalsDomain(d) {
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
	for _, t := range AltocRenewalsTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["altoc"] = d
	return out, nil
}
func ForAltocRenewals(e Expectation) Installer {
	return Installer{installer{domain: "altoc-renewals", manifest: altocRenewalsManifest, expect: e, apf: true}}
}
func (x *installer) validateAltocRenewals(b enterprise.Binding) error {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocRenewalsDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for n, other := range b.Domains {
		if n == "altoc" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range AltocRenewalsTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
