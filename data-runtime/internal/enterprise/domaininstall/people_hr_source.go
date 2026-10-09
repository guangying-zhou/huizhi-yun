package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed people_hr_source.json
var peopleHRSourceManifest []byte

func PeopleHRSourceTables() []Table {
	var t []Table
	json.Unmarshal(peopleHRSourceManifest, &t)
	return t
}
func WithPeopleHRSource(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["people"]
	if !ok || !IsPeopleFactsDomain(d) {
		return b, ErrBoundary
	}
	if _, exists := d.Tables["people_hr_source_state"]; exists {
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
	d.Tables["people_hr_source_state"] = "people_hr_source_state"
	out.Domains["people"] = d
	return out, nil
}
func ForPeopleHRSource(e Expectation) Installer {
	return Installer{installer{domain: "people-hr-source", manifest: peopleHRSourceManifest, expect: e, apf: true}}
}
func (x *installer) validatePeopleHRSource(b enterprise.Binding) error {
	d, ok := b.Domains["people"]
	if !ok || !IsPeopleFactsDomain(d) || d.Tables["people_hr_source_state"] != "people_hr_source_state" || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name == "people" {
			continue
		}
		for l, p := range other.Tables {
			if l == "people_hr_source_state" || p == "people_hr_source_state" {
				return ErrBoundary
			}
		}
	}
	return nil
}
