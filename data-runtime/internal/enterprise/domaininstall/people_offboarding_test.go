package domaininstall

import (
	"testing"
)

func TestAPFPeopleOffboardingFrozenSubset(t *testing.T) {
	b := apfFixture("isolated", "instance")
	var err error
	if _, err = WithPeopleOffboarding(b); err == nil {
		t.Fatal("missing facts dependency")
	}
	b, err = WithPeopleFacts(b)
	if err != nil {
		t.Fatal(err)
	}
	old := b.Domains["people"]
	next, err := WithPeopleOffboarding(b)
	if err != nil {
		t.Fatal(err)
	}
	if !IsPeopleOffboardingDomain(next.Domains["people"]) || len(next.Domains["people"].Tables) != len(old.Tables)+2 {
		t.Fatal("subset drift")
	}
	if _, err = WithPeopleOffboarding(next); err == nil {
		t.Fatal("duplicate subset")
	}
	if _, ok := old.Tables["people_offboarding_cases"]; ok {
		t.Fatal("original binding mutated")
	}
	d := next.Domains["people"]
	delete(d.Tables, "people_offboarding_tasks")
	if IsPeopleFactsDomain(d) || IsPeopleOffboardingDomain(d) {
		t.Fatal("half-installed mapping accepted")
	}
}
