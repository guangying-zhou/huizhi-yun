package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"strings"
	"testing"
)

func TestServicesManifestClosed(t *testing.T) {
	base, _ := APFTables("altoc")
	all := append(base, AltocSalesTables()...)
	b := enterprise.Binding{Domains: map[string]enterprise.DomainBinding{"altoc": {Tables: map[string]string{}}}}
	for _, v := range all {
		b.Domains["altoc"].Tables[v.Logical] = v.Physical
	}
	next, e := WithAltocServices(b)
	if e != nil {
		t.Fatal(e)
	}
	if !IsAltocServicesDomain(next.Domains["altoc"]) || !IsAltocSalesDomain(next.Domains["altoc"]) {
		t.Fatal("old routes broken")
	}
	if len(b.Domains["altoc"].Tables) != len(all) {
		t.Fatal("mutated")
	}
	for _, v := range AltocServicesTables() {
		if v.Logical != v.Physical || !strings.Contains(v.DDL, "row_version") || strings.Contains(v.DDL, "FOREIGN KEY") || strings.Contains(v.DDL, "DROP TABLE") {
			t.Fatal(v.Logical)
		}
	}
	if _, e = WithAltocServices(next); e == nil {
		t.Fatal("duplicate")
	}
	tender, e := WithAltocTenders(b)
	if e != nil {
		t.Fatal(e)
	}
	combined, e := WithAltocServices(tender)
	if e != nil || !IsAltocTendersDomain(combined.Domains["altoc"]) {
		t.Fatal("tender not preserved", e)
	}
}
