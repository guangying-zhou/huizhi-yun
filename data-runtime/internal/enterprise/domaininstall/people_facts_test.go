package domaininstall

import "testing"

func TestPeopleFactsFrozenIncrementalInstall(t *testing.T) {
	b := apfFixture("isolated", "instance")
	original := b.Domains["people"]
	private, e := WithPeoplePrivateFacts(b)
	if e != nil {
		t.Fatal(e)
	}
	for _, base := range []struct {
		name       string
		bIsPrivate bool
	}{{"base", false}, {"private", true}} {
		t.Run(base.name, func(t *testing.T) {
			input := b
			if base.bIsPrivate {
				input = private
			}
			result, e := WithPeopleFacts(input)
			if e != nil {
				t.Fatal(e)
			}
			if !IsPeopleFactsDomain(result.Domains["people"]) || result.Generation != input.Generation || result.SchemaVersion != input.SchemaVersion {
				t.Fatal("changed generation/schema")
			}
			if len(original.Tables) != 10 || len(input.Domains["people"].Tables) != 10+map[bool]int{true: 1, false: 0}[base.bIsPrivate] {
				t.Fatal("mutated input")
			}
			x := ForPeopleFacts(c000001Expectation).x
			if e = x.validate(result); e != nil {
				t.Fatal(e)
			}
			if len(x.tables()) != 2 || len(x.expected(result).Views) != 0 {
				t.Fatal("unexpected install objects")
			}
			if _, e = WithPeopleFacts(result); e == nil {
				t.Fatal("overwrote installed mapping")
			}
			d := result.Domains["people"]
			d.Tables["people_onboarding_cases"] = "arbitrary"
			result.Domains["people"] = d
			if x.validate(result) == nil {
				t.Fatal("arbitrary mapping accepted")
			}
		})
	}
	cols := PeopleFactsTables()[1].Columns
	if len(cols) != 8 {
		t.Fatal("lifecycle columns incomplete", cols)
	}
}
