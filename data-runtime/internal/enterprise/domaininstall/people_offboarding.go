package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed people_offboarding.json
var peopleOffboardingManifest []byte

func PeopleOffboardingTables() []Table {
	var t []Table
	if json.Unmarshal(peopleOffboardingManifest, &t) != nil {
		panic("invalid offboarding manifest")
	}
	return t
}
func IsPeopleOffboardingDomain(d enterprise.DomainBinding) bool {
	if !IsPeopleFactsDomain(d) {
		return false
	}
	for _, t := range PeopleOffboardingTables() {
		if d.Tables[t.Logical] != t.Physical {
			return false
		}
	}
	return true
}
func WithPeopleOffboarding(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["people"]
	if !ok || !IsPeopleFactsDomain(d) {
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
	for _, t := range PeopleOffboardingTables() {
		if _, ok := d.Tables[t.Logical]; ok {
			return b, ErrBoundary
		}
		d.Tables[t.Logical] = t.Physical
	}
	out.Domains["people"] = d
	return out, nil
}
func ForPeopleOffboarding(e Expectation) Installer {
	return Installer{installer{domain: "people-offboarding", manifest: peopleOffboardingManifest, expect: e, apf: true}}
}
func (x *installer) validatePeopleOffboarding(b enterprise.Binding) error {
	d, ok := b.Domains["people"]
	if !ok || !IsPeopleOffboardingDomain(d) || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for n, o := range b.Domains {
		if n == "people" {
			continue
		}
		for l, p := range o.Tables {
			for _, t := range PeopleOffboardingTables() {
				if l == t.Logical || p == t.Physical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
