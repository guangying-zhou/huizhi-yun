package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestAPFPeoplePrivateFrozenCandidate(t *testing.T) {
	b := apfFixture("isolated", "instance")
	base := b.Domains["people"]
	extended, e := WithPeoplePrivateFacts(b)
	if e != nil {
		t.Fatal(e)
	}
	if len(base.Tables) != 10 || b.Generation != extended.Generation || b.SchemaVersion != extended.SchemaVersion {
		t.Fatal("base mutated")
	}
	d := extended.Domains["people"]
	if d.Read != base.Read || d.Write != base.Write || d.Scheduler != base.Scheduler {
		t.Fatal("lane enabled")
	}
	x := ForPeoplePrivateFacts(c000001Expectation).x
	if x.validate(extended) != nil {
		t.Fatal("candidate rejected")
	}
	if len(x.tables()) != 1 || len(x.expected(extended).Views) != 0 {
		t.Fatal("arbitrary ddl/view")
	}
	if _, e = WithPeoplePrivateFacts(extended); e == nil {
		t.Fatal("overwrote existing map")
	}
	d.Tables["people_employee_private_facts"] = "wrong"
	extended.Domains["people"] = d
	if IsAPFDomain("people", d) || x.validate(extended) == nil {
		t.Fatal("wrong private table accepted")
	}
	d.Tables["people_employee_private_facts"] = "people_employee_private_facts"
	extended.Domains["people"] = d
	extended.Domains["other"] = enterprise.DomainBinding{Tables: map[string]string{"private": "people_employee_private_facts"}}
	if x.validate(extended) == nil {
		t.Fatal("other domain conflict")
	}
}
