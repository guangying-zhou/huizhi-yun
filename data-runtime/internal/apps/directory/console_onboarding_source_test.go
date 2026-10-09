package directory

import (
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func TestConsoleOnboardingVerifiedSourceMatrix(t *testing.T) {
	for _, source := range []string{"people", "enterprise"} {
		body := map[string]any{
			integrationoperation.TrustedServiceCommandTenantKey:           "C000001",
			integrationoperation.TrustedServiceCommandSourceDeploymentKey: "C000001-" + source,
			integrationoperation.TrustedServiceCommandTargetDeploymentKey: "C000001-console",
			integrationoperation.TrustedServiceCommandSourceAppKey:        source,
			integrationoperation.TrustedServiceCommandTargetAppKey:        "console",
			integrationoperation.TrustedServiceCommandSourceClientKey:     source + ".runtime",
			"serviceCommand": map[string]any{"command": map[string]any{"sourceApp": source}},
		}
		if got, e := ConsoleOnboardingCommandSource(body); e != nil || got != source {
			t.Fatalf("verified source %s: %s %v", source, got, e)
		}
		for _, key := range []string{integrationoperation.TrustedServiceCommandSourceClientKey, integrationoperation.TrustedServiceCommandSourceAppKey, integrationoperation.TrustedServiceCommandTargetAppKey, integrationoperation.TrustedServiceCommandSourceDeploymentKey, integrationoperation.TrustedServiceCommandTenantKey} {
			old := body[key]
			body[key] = ""
			if _, e := ConsoleOnboardingCommandSource(body); e == nil {
				t.Fatalf("unverified %s accepted", key)
			}
			body[key] = old
		}
		body[integrationoperation.TrustedServiceCommandSourceClientKey] = "foreign.runtime"
		if _, e := ConsoleOnboardingCommandSource(body); e == nil {
			t.Fatal("other client accepted")
		}
	}
	if _, e := ConsoleOnboardingCommandSource(map[string]any{"sourceApp": "enterprise", "client": "enterprise.runtime"}); e == nil {
		t.Fatal("body self-reported source accepted")
	}
}
