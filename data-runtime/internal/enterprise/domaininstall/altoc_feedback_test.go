package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestFeedbackManifestClosed(t *testing.T) {
	base, _ := APFTables("altoc")
	all := append(append(base, AltocSalesTables()...), AltocServicesTables()...)
	b := enterprise.Binding{Domains: map[string]enterprise.DomainBinding{"altoc": {Tables: map[string]string{}}}}
	for _, v := range all {
		b.Domains["altoc"].Tables[v.Logical] = v.Physical
	}
	if _, e := WithAltocFeedback(b); e == nil {
		t.Fatal("missing tickets allowed")
	}
	tickets, e := WithAltocTickets(b)
	if e != nil {
		t.Fatal(e)
	}
	next, e := WithAltocFeedback(tickets)
	if e != nil {
		t.Fatal(e)
	}
	if !IsAltocFeedbackDomain(next.Domains["altoc"]) || !IsAltocTicketsDomain(next.Domains["altoc"]) || !IsAltocSalesDomain(next.Domains["altoc"]) {
		t.Fatal("extension broke existing domains")
	}
	if len(tickets.Domains["altoc"].Tables) != len(all)+len(AltocTicketsTables()) {
		t.Fatal("input mutated")
	}
	if _, e := WithAltocFeedback(next); e == nil {
		t.Fatal("duplicate allowed")
	}
	for _, table := range AltocFeedbackTables() {
		d := next.Domains["altoc"]
		d.Tables = map[string]string{}
		for k, v := range next.Domains["altoc"].Tables {
			d.Tables[k] = v
		}
		delete(d.Tables, table.Logical)
		if IsAltocFeedbackDomain(d) || IsAltocSalesDomain(d) {
			t.Fatal("partial accepted", table.Logical)
		}
		d.Tables[table.Logical] = "arbitrary"
		if IsAltocFeedbackDomain(d) {
			t.Fatal("mapping changed")
		}
	}
}
