package domaininstall

import (
	_ "embed"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed altoc_tenders.json
var altocTendersManifest []byte

func AltocTendersTables() []Table {
	var t []Table
	if json.Unmarshal(altocTendersManifest, &t) != nil || len(t) != 4 {
		panic("invalid Altoc B5 fixed manifest")
	}
	return t
}
func IsAltocTendersDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("altoc", d)
	if !validDue {
		return false
	}

	if hasAltocFeedback(d) {
		base, ok := withoutAltocFeedback(d)
		return ok && IsAltocTicketsDomain(base) && IsAltocTendersDomain(base)
	}
	if IsAltocServicesDomain(d) {
		return d.Tables["altoc_tender"] == "altoc_tender"
	}
	base, _ := APFTables("altoc")
	all := append(append(base, AltocSalesTables()...), AltocTendersTables()...)
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

// WithAltocTenders is pure mapping preparation, not installation or enabling.
func WithAltocTenders(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocSalesDomain(d) || IsAltocTendersDomain(d) {
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
	for _, t := range AltocTendersTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["altoc"] = d
	return out, nil
}
func ForAltocTenders(e Expectation) Installer {
	return Installer{installer{domain: "altoc-tenders", manifest: altocTendersManifest, expect: e, apf: true}}
}
func (x *installer) validateAltocTenders(b enterprise.Binding) error {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocTendersDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "altoc" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range AltocTendersTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
