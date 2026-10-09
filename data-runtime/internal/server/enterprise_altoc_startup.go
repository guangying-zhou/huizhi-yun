package server

import (
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

// APF's closed base/subset mappings belong to enterpriseapf, even when B2 adds
// altoc_lead. Unknown/partial mappings still enter the existing validation paths;
// a table prefix alone must never bypass legacy or APF validation.
func usesLegacyEnterpriseAltocReads(cfg config.Config) bool {
	d := cfg.Enterprise.Domains["altoc"]
	if !cfg.Enterprise.Enabled || d.Read != enterprise.PathUnified || (d.Tables["customer"] == "" && d.Tables["altoc_lead"] == "") {
		return false
	}
	return !domaininstall.IsAPFDomain("altoc", enterprise.DomainBinding{
		OwnerDeployment: d.OwnerDeployment, Tables: d.Tables, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler,
	})
}

// The B2-aware sales service intentionally supports the APF subset. Basic APF
// installs must not initialize it; legacy G1/G2 completeness checks stay intact.
func usesEnterpriseAltocSalesReads(cfg config.Config) bool {
	d := cfg.Enterprise.Domains["altoc"]
	if !cfg.Enterprise.Enabled || d.Read != enterprise.PathUnified {
		return false
	}
	if domaininstall.IsAltocSalesDomain(enterprise.DomainBinding{OwnerDeployment: d.OwnerDeployment, Tables: d.Tables, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler}) {
		return true
	}
	return usesLegacyEnterpriseAltocReads(cfg)
}
