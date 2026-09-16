package integrationoperation

import (
	"errors"
	"testing"
)

func TestTrustedContextFromMapUsesOnlyReservedValues(t *testing.T) {
	context, err := TrustedContextFromMap(map[string]any{
		TrustedTenantCodeKey:      "tenant-1",
		TrustedDeploymentCodeKey:  "deployment-1",
		TrustedSourceAppKey:       "altoc",
		TrustedServiceClientIDKey: "service-client-1",
		TrustedRequestIDKey:       "request-1",
		"tenantCode":              "evil-tenant",
		"deploymentCode":          "evil-deployment",
		"sourceApp":               "evil-app",
	}, "altoc")
	if err != nil {
		t.Fatalf("TrustedContextFromMap() error = %v", err)
	}
	if context.TenantCode != "tenant-1" || context.DeploymentCode != "deployment-1" || context.SourceApp != "altoc" {
		t.Fatalf("unexpected trusted context: %+v", context)
	}
}

func TestTrustedContextFromMapFailsClosed(t *testing.T) {
	base := map[string]any{
		TrustedTenantCodeKey:     "tenant-1",
		TrustedDeploymentCodeKey: "deployment-1",
		TrustedSourceAppKey:      "altoc",
	}
	for name, mutate := range map[string]func(map[string]any){
		"missing tenant": func(values map[string]any) { delete(values, TrustedTenantCodeKey) },
		"wrong source":   func(values map[string]any) { values[TrustedSourceAppKey] = "aims" },
		"unsafe request": func(values map[string]any) { values[TrustedRequestIDKey] = "bad request" },
	} {
		t.Run(name, func(t *testing.T) {
			values := make(map[string]any, len(base))
			for key, value := range base {
				values[key] = value
			}
			mutate(values)
			if _, err := TrustedContextFromMap(values, "altoc"); !errors.Is(err, ErrInvalidIdentity) {
				t.Fatalf("error = %v, want ErrInvalidIdentity", err)
			}
		})
	}
}
