package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"os"
	"strings"
	"testing"
)

func TestTenderManifestClosedAndPure(t *testing.T) {
	tables := AltocTendersTables()
	for _, file := range []string{"../../../../altoc/docs/altoc_enterprise_tenders_schema.sql", "../../../../docs/Enterprise-APF-Domain-Design.sql"} {
		raw, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		for _, v := range tables {
			if !strings.Contains(string(raw), v.DDL) {
				t.Fatal("canonical schema drift", file, v.Logical)
			}
		}
	}

	if len(tables) != 4 {
		t.Fatal(len(tables))
	}
	base, _ := APFTables("altoc")
	base = append(base, AltocSalesTables()...)
	d := enterprise.DomainBinding{Tables: map[string]string{}}
	for _, v := range base {
		d.Tables[v.Logical] = v.Physical
	}
	b := enterprise.Binding{Domains: map[string]enterprise.DomainBinding{"altoc": d}}
	out, e := WithAltocTenders(b)
	if e != nil {
		t.Fatal(e)
	}
	if !IsAltocTendersDomain(out.Domains["altoc"]) || !IsAltocSalesDomain(out.Domains["altoc"]) || len(b.Domains["altoc"].Tables) != len(base) {
		t.Fatal("mapping mutated or old routes broken")
	}
	for _, v := range tables {
		if v.Logical != v.Physical || !strings.HasPrefix(v.Logical, "altoc_tender") || !strings.Contains(v.DDL, "row_version") || strings.Contains(v.DDL, "FOREIGN KEY") || strings.Contains(v.DDL, "DROP TABLE") {
			t.Fatal(v.Logical)
		}
	}
	extra := out.Domains["altoc"]
	extra.Tables["unreviewed"] = "unreviewed"
	if IsAltocTendersDomain(extra) {
		t.Fatal("extra table accepted")
	}
}
