package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"strings"
)

//go:embed altoc_due.json
var altocDue []byte

//go:embed finance_due.json
var financeDue []byte

//go:embed people_due.json
var peopleDue []byte

func dueManifest(domain string) []byte {
	switch domain {
	case "altoc":
		return altocDue
	case "finance":
		return financeDue
	case "people":
		return peopleDue
	}
	return nil
}
func DueTables(domain string) []Table {
	var t []Table
	json.Unmarshal(dueManifest(domain), &t)
	return t
}

// Strip only the exact optional owned triple. A partial/wrong mapping is never hidden.
func withoutDue(domain string, d enterprise.DomainBinding) (enterprise.DomainBinding, bool) {
	var valid bool
	d, valid = withoutFinanceReceivables(domain, d)
	if !valid {
		return d, false
	}
	d, valid = withoutReceivables(domain, d)
	if !valid {
		return d, false
	}
	d, valid = withoutW1(domain, d)
	if !valid {
		return d, false
	}
	if _, ok := d.Tables[domain+"_due_checkpoint"]; !ok {
		if _, other := d.Tables[domain+"_due_audit"]; other {
			return d, false
		}
		if _, other := d.Tables[domain+"_due_cursor"]; other {
			return d, false
		}
		return d, true
	}
	if d.Tables[domain+"_due_checkpoint"] != domain+"_due_checkpoint" || d.Tables[domain+"_due_cursor"] != domain+"_due_cursor" || d.Tables[domain+"_due_audit"] != domain+"_due_audit" {
		return d, false
	}
	out := d
	out.Tables = map[string]string{}
	for k, v := range d.Tables {
		if k != domain+"_due_checkpoint" && k != domain+"_due_cursor" && k != domain+"_due_audit" {
			out.Tables[k] = v
		}
	}
	return out, true
}
func WithDue(b enterprise.Binding, domain string) (enterprise.Binding, error) {
	d, ok := b.Domains[domain]
	if !ok || dueManifest(domain) == nil || !IsAPFDomain(domain, d) {
		return b, ErrBoundary
	}
	if _, ok = d.Tables[domain+"_due_checkpoint"]; ok {
		return b, ErrBoundary
	}
	out := b
	out.Domains = map[string]enterprise.DomainBinding{}
	for k, v := range b.Domains {
		out.Domains[k] = v
	}
	d.Tables = map[string]string{}
	for k, v := range b.Domains[domain].Tables {
		d.Tables[k] = v
	}
	for _, t := range DueTables(domain) {
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains[domain] = d
	return out, nil
}
func ForDue(e Expectation, domain string) Installer {
	return Installer{installer{domain: domain + "-due", manifest: dueManifest(domain), expect: e, apf: true}}
}
func (x *installer) validateDue(b enterprise.Binding) error {
	domain := strings.TrimSuffix(x.domain, "-due")
	d, ok := b.Domains[domain]
	if !ok || dueManifest(domain) == nil || !IsAPFDomain(domain, d) || d.Tables[domain+"_due_checkpoint"] != domain+"_due_checkpoint" || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for other, bd := range b.Domains {
		if other != domain {
			for _, p := range bd.Tables {
				for _, t := range DueTables(domain) {
					if p == t.Physical {
						return ErrBoundary
					}
				}
			}
		}
	}
	return nil
}
