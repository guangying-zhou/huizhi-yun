package domaininstall

import (
	"testing"
)

func TestAPFHRSourceFrozenCandidate(t *testing.T) {
	b, e := WithPeopleFacts(apfFixture("isolated", "instance"))
	if e != nil {
		t.Fatal(e)
	}
	ext, e := WithPeopleHRSource(b)
	if e != nil {
		t.Fatal(e)
	}
	if b.Generation != ext.Generation || b.SchemaVersion != ext.SchemaVersion || len(ext.Domains["people"].Tables) != len(b.Domains["people"].Tables)+1 {
		t.Fatal("existing generation/schema changed")
	}
	x := ForPeopleHRSource(c000001Expectation).x
	if x.validate(ext) != nil || len(x.tables()) != 1 || len(x.expected(ext).Views) != 0 {
		t.Fatal("candidate mismatch")
	}
	if _, e = WithPeopleHRSource(ext); e == nil {
		t.Fatal("overwrite allowed")
	}
	d := ext.Domains["people"]
	d.Tables["people_hr_source_state"] = "other"
	ext.Domains["people"] = d
	if x.validate(ext) == nil {
		t.Fatal("arbitrary map")
	}
}
