package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestAPFReceivablesSubsetClosed(t *testing.T) {
	b := apfFixture("isolated", "instance")
	before := len(b.Domains["altoc"].Tables)
	next, e := WithReceivables(b)
	if e != nil {
		t.Fatal(e)
	}
	if len(b.Domains["altoc"].Tables) != before || len(next.Domains["altoc"].Tables) != before+1 {
		t.Fatal("mapping mutation")
	}
	if !IsAPFDomain("altoc", next.Domains["altoc"]) {
		t.Fatal("startup gate")
	}
	if _, e = WithReceivables(next); e == nil {
		t.Fatal("duplicate")
	}
	next.Domains["altoc"].Tables["altoc_collection_event"] = "wrong"
	if IsAPFDomain("altoc", next.Domains["altoc"]) {
		t.Fatal("wrong table tolerated")
	}
	legacy := enterprise.DomainBinding{Tables: map[string]string{"customer": "customer", "altoc_collection_event": "altoc_collection_event"}}
	if IsAPFDomain("altoc", legacy) {
		t.Fatal("legacy gate loosened")
	}
}
