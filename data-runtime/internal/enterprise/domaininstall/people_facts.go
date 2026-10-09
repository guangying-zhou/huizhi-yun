package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed people_facts.json
var peopleFactsManifest []byte

func PeopleFactsTables() []Table { var t []Table; json.Unmarshal(peopleFactsManifest, &t); return t }
func IsPeopleFactsDomain(d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue("people", d)
	if !validDue {
		return false
	}

	base, _ := APFTables("people")
	expected := map[string]string{}
	for _, t := range base {
		expected[t.Logical] = t.Physical
	}
	for _, t := range PeopleFactsTables() {
		expected[t.Logical] = t.Physical
	}
	if _, ok := d.Tables["people_employee_private_facts"]; ok {
		expected["people_employee_private_facts"] = "people_employee_private_facts"
	}
	if _, ok := d.Tables["people_hr_source_state"]; ok {
		expected["people_hr_source_state"] = "people_hr_source_state"
	}
	_, offboardingCases := d.Tables["people_offboarding_cases"]
	_, offboardingTasks := d.Tables["people_offboarding_tasks"]
	if offboardingCases || offboardingTasks {
		for _, t := range PeopleOffboardingTables() {
			expected[t.Logical] = t.Physical
		}
	}
	if len(d.Tables) != len(expected) {
		return false
	}
	for k, v := range expected {
		if d.Tables[k] != v {
			return false
		}
	}
	return true
}
func WithPeopleFacts(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["people"]
	if !ok || !IsAPFDomain("people", d) {
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
	for _, t := range PeopleFactsTables() {
		if _, exists := d.Tables[t.Logical]; exists {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["people"] = d
	return out, nil
}
func ForPeopleFacts(e Expectation) Installer {
	return Installer{installer{domain: "people-facts", manifest: peopleFactsManifest, expect: e, apf: true}}
}
func (x *installer) validatePeopleFacts(b enterprise.Binding) error {
	d, ok := b.Domains["people"]
	if !ok || !IsPeopleFactsDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "people" {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range PeopleFactsTables() {
				if logical == t.Logical || physical == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
