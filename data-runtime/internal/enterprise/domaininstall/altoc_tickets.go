package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed altoc_tickets.json
var altocTicketsManifest []byte

func AltocTicketsTables() []Table {
	var t []Table
	if json.Unmarshal(altocTicketsManifest, &t) != nil || len(t) != 1 {
		panic("invalid Altoc service manifest")
	}
	return t
}
func IsAltocTicketsDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("altoc", d)
	if !validDue {
		return false
	}

	if hasAltocFeedback(d) {
		base, ok := withoutAltocFeedback(d)
		return ok && IsAltocTicketsDomain(base) && IsAltocTicketsDomain(base)
	}
	if d.Tables["altoc_renewal_opportunity"] == "altoc_renewal_opportunity" {
		return d.Tables["altoc_service_ticket"] == "altoc_service_ticket" && IsAltocRenewalsDomain(d)
	}
	base, _ := APFTables("altoc")
	all := append(append(append(base, AltocSalesTables()...), AltocServicesTables()...), AltocTicketsTables()...)
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
func WithAltocTickets(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocServicesDomain(d) || IsAltocTicketsDomain(d) {
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
	for _, t := range AltocTicketsTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["altoc"] = d
	return out, nil
}
func ForAltocTickets(e Expectation) Installer {
	return Installer{installer{domain: "altoc-tickets", manifest: altocTicketsManifest, expect: e, apf: true}}
}
func (x *installer) validateAltocTickets(b enterprise.Binding) error {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocTicketsDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for n, other := range b.Domains {
		if n == "altoc" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range AltocTicketsTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
