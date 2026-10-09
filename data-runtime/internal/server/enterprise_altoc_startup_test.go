package server

import (
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"testing"
)

func TestAPFAltocStartupReaderSelection(t *testing.T) {
	b, err := domaininstall.WithAPF(enterprise.Binding{Generation: 1, Domains: map[string]enterprise.DomainBinding{}}, "enterprise-test")
	if err != nil {
		t.Fatal(err)
	}
	sales, err := domaininstall.WithAltocSales(b)
	if err != nil {
		t.Fatal(err)
	}
	malformed := sales.Domains["altoc"]
	malformed.Tables = map[string]string{}
	for k, v := range sales.Domains["altoc"].Tables {
		malformed.Tables[k] = v
	}
	malformed.Tables["altoc_lead"] = "wrong_lead"
	for _, tc := range []struct {
		name                   string
		d                      enterprise.DomainBinding
		enabled, legacy, sales bool
	}{
		{"base APF", b.Domains["altoc"], true, false, false},
		{"installed B2", sales.Domains["altoc"], true, false, true},
		{"disabled host", sales.Domains["altoc"], false, false, false},
		{"legacy G1", enterprise.DomainBinding{Read: enterprise.PathUnified, Tables: map[string]string{"customer": "customer"}}, true, true, true},
		// A prefix/hybrid mapping alone cannot suppress existing validation.
		{"wrong B2 physical mapping", malformed, true, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := config.Config{Enterprise: config.EnterpriseConfig{Enabled: tc.enabled, Domains: map[string]config.EnterpriseDomainConfig{"altoc": {OwnerDeployment: tc.d.OwnerDeployment, Tables: tc.d.Tables, Read: tc.d.Read, Write: tc.d.Write, Scheduler: tc.d.Scheduler}}}}
			if usesLegacyEnterpriseAltocReads(cfg) != tc.legacy || usesEnterpriseAltocSalesReads(cfg) != tc.sales {
				t.Fatal("reader selection does not match closed installation mapping")
			}
			d := cfg.Enterprise.Domains["altoc"]
			d.Read = enterprise.PathDisabled
			cfg.Enterprise.Domains["altoc"] = d
			if usesLegacyEnterpriseAltocReads(cfg) || usesEnterpriseAltocSalesReads(cfg) {
				t.Fatal("disabled read selected a service")
			}
		})
	}
}
