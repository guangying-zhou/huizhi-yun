package domaininstall

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestFinanceReceivablesOptionalMappingIsExact(t *testing.T) {
	d := enterprise.DomainBinding{Tables: map[string]string{"base": "base"}}
	if _, ok := withoutFinanceReceivables("finance", d); !ok {
		t.Fatal("base rejected")
	}
	d.Tables["finance_historical_readiness"] = "finance_historical_readiness"
	if _, ok := withoutFinanceReceivables("finance", d); ok {
		t.Fatal("partial accepted")
	}
	for _, v := range FinanceReceivablesTables() {
		d.Tables[v.Logical] = v.Physical
	}
	out, ok := withoutFinanceReceivables("finance", d)
	if !ok || len(out.Tables) != 1 {
		t.Fatal("exact subset not stripped")
	}
	if _, ok := withoutFinanceReceivables("altoc", d); ok {
		t.Fatal("wrong owner")
	}
	d.Tables["finance_allocation_batch"] = "wrong"
	if _, ok := withoutFinanceReceivables("finance", d); ok {
		t.Fatal("wrong mapping")
	}
}
