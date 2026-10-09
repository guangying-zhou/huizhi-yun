package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed altoc_feedback.json
var altocFeedbackManifest []byte

func AltocFeedbackTables() []Table {
	var t []Table
	if json.Unmarshal(altocFeedbackManifest, &t) != nil || len(t) != 3 {
		panic("invalid Altoc feedback manifest")
	}
	return t
}
func hasAltocFeedback(d enterprise.DomainBinding) bool {
	for _, t := range AltocFeedbackTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return true
		}
	}
	return false
}
func withoutAltocFeedback(d enterprise.DomainBinding) (enterprise.DomainBinding, bool) {
	out := d
	out.Tables = map[string]string{}
	for k, v := range d.Tables {
		out.Tables[k] = v
	}
	for _, t := range AltocFeedbackTables() {
		if out.Tables[t.Logical] != t.Physical {
			return out, false
		}
		delete(out.Tables, t.Logical)
	}
	return out, true
}
func IsAltocFeedbackDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("altoc", d)
	if !validDue {
		return false
	}

	if !hasAltocFeedback(d) {
		return false
	}
	base, ok := withoutAltocFeedback(d)
	return ok && IsAltocTicketsDomain(base)
}
func WithAltocFeedback(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocTicketsDomain(d) || hasAltocFeedback(d) {
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
	for _, t := range AltocFeedbackTables() {
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["altoc"] = d
	return out, nil
}
func ForAltocFeedback(e Expectation) Installer {
	return Installer{installer{domain: "altoc-feedback", manifest: altocFeedbackManifest, expect: e, apf: true}}
}
func (x *installer) validateAltocFeedback(b enterprise.Binding) error {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAltocFeedbackDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for n, other := range b.Domains {
		if n == "altoc" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range AltocFeedbackTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
