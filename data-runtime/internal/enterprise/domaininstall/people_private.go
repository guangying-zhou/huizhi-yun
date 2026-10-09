package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed people_private.json
var peoplePrivateManifest []byte

func PeoplePrivateTables() []Table {
	var t []Table
	json.Unmarshal(peoplePrivateManifest, &t)
	return t
}

// Pure candidate mapping. No DB, generation change or enabling write/scheduler.
func WithPeoplePrivateFacts(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["people"]
	if !ok || !IsAPFDomain("people", d) || len(d.Tables) != 10 {
		return b, ErrBoundary
	}
	out := b
	out.Domains = map[string]enterprise.DomainBinding{}
	for k, v := range b.Domains {
		out.Domains[k] = v
	}
	d.Tables = map[string]string{}
	for k, v := range b.Domains["people"].Tables {
		d.Tables[k] = v
	}
	d.Tables["people_employee_private_facts"] = "people_employee_private_facts"
	out.Domains["people"] = d
	return out, nil
}
func ForPeoplePrivateFacts(e Expectation) Installer {
	return Installer{installer{domain: "people-private", manifest: peoplePrivateManifest, expect: e, apf: true}}
}
func (x *installer) validatePeoplePrivate(b enterprise.Binding) error {
	d, ok := b.Domains["people"]
	if !ok || !IsAPFDomain("people", d) || len(d.Tables) != 11 || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for domain, other := range b.Domains {
		if domain == "people" {
			continue
		}
		for logical, physical := range other.Tables {
			if logical == "people_employee_private_facts" || physical == "people_employee_private_facts" {
				return ErrBoundary
			}
		}
	}
	return nil
}
