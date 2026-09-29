package aims

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Legacy per-application calls keep reading the reserved keys injected by the
// authenticated data-runtime server; an Enterprise delegated call never does,
// and fails closed without a registered Aims writer/worker binding.
func TestCompanySummaryTrustedContextSeparatesEnterpriseFromLegacy(t *testing.T) {
	body := map[string]any{
		integrationoperation.TrustedTenantCodeKey:      "tenant-from-body",
		integrationoperation.TrustedDeploymentCodeKey:  "deployment-from-body",
		integrationoperation.TrustedSourceAppKey:       "aims",
		integrationoperation.TrustedServiceClientIDKey: "aims.runtime",
	}
	legacy, err := (&Adapter{}).companySummaryTrustedContext(context.Background(), body)
	if err != nil || legacy.TenantCode != "tenant-from-body" || legacy.DeploymentCode != "deployment-from-body" || legacy.OutboxTables != nil {
		t.Fatalf("legacy trusted context changed: %+v %v", legacy, err)
	}

	delegated := WithEnterpriseCompanyWeeklySummaryOutbox(context.Background(), "req-1")
	trusted, err := (&Adapter{}).companySummaryTrustedContext(delegated, body)
	var domain httperror.Error
	if err == nil || !errors.As(err, &domain) || domain.Status != 503 || trusted.TenantCode != "" {
		t.Fatalf("delegated call without Enterprise writer must fail closed, got %+v %v", trusted, err)
	}
	adapter := &Adapter{enterpriseWrites: &enterpriseWriteBinding{}}
	if _, err := adapter.companySummaryTrustedContext(delegated, body); err == nil || !strings.Contains(err.Error(), "worker") {
		t.Fatalf("delegated call without worker deployment must fail closed, got %v", err)
	}
}

// The unified content read accepts only its closed body and a registered
// outbox context; malformed input is refused before any database access.
func TestCompanyWeeklySummaryPublishContentRejectsMalformedInput(t *testing.T) {
	tables, err := integrationoperation.NewOutboxTables("`u_op`", "`u_attempt`", "`u_receipt`", "`u_dead`")
	if err != nil {
		t.Fatal(err)
	}
	trusted := integrationoperation.TrustedContext{TenantCode: "t", DeploymentCode: "d", SourceApp: "aims", OutboxTables: &tables}
	hash := strings.Repeat("a", 64)
	valid := map[string]any{"operationKey": "k", "summaryVersionId": float64(2), "markdownSha256": hash}
	for name, input := range map[string]struct {
		trusted integrationoperation.TrustedContext
		worker  string
		body    map[string]any
	}{
		"extra key":      {trusted, "w", map[string]any{"operationKey": "k", "summaryVersionId": float64(2), "markdownSha256": hash, "tenant": "x"}},
		"missing key":    {trusted, "w", map[string]any{"summaryVersionId": float64(2), "markdownSha256": hash}},
		"padded key":     {trusted, "w", map[string]any{"operationKey": " k", "summaryVersionId": float64(2), "markdownSha256": hash}},
		"zero version":   {trusted, "w", map[string]any{"operationKey": "k", "summaryVersionId": float64(0), "markdownSha256": hash}},
		"missing hash":   {trusted, "w", map[string]any{"operationKey": "k", "summaryVersionId": float64(2)}},
		"no worker":      {trusted, "", valid},
		"legacy context": {integrationoperation.TrustedContext{TenantCode: "t", DeploymentCode: "d", SourceApp: "aims"}, "w", valid},
	} {
		_, err := CompanyWeeklySummaryPublishContentInTransaction(context.Background(), nil, input.trusted, input.worker, input.body, time.Now())
		var domain httperror.Error
		if err == nil || !errors.As(err, &domain) || domain.Status != 400 {
			t.Fatalf("%s: expected 400, got %v", name, err)
		}
	}
}
