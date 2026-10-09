package server

import (
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestLegacyAimsDueNotificationsRefusedOnlyWhenUnifiedOwnsScheduler(t *testing.T) {
	for path := range legacyAimsDueNotificationPaths {
		if !legacyAimsDueNotificationOwnedByUnified(path, true, enterprise.PathUnified) {
			t.Fatalf("%s not refused under unified scheduler", path)
		}
		for _, mode := range []enterprise.PathMode{enterprise.PathLegacy, enterprise.PathDisabled} {
			if legacyAimsDueNotificationOwnedByUnified(path, true, mode) {
				t.Fatalf("%s refused under %s", path, mode)
			}
		}
		if legacyAimsDueNotificationOwnedByUnified(path, false, enterprise.PathUnified) {
			t.Fatalf("%s refused with enterprise disabled", path)
		}
	}
	// Other apps keep their own due-notification workers.
	for _, path := range []string{"/v1/assets/service/notifications:scan-due", "/v1/altoc/service/notifications:acknowledge", "/v1/people/service/notifications:acknowledge-closure"} {
		if legacyAimsDueNotificationOwnedByUnified(path, true, enterprise.PathUnified) {
			t.Fatalf("%s refused by the Aims owner rule", path)
		}
	}
}

func TestEnterpriseDueNotificationRoutesAreClosedAndDistinct(t *testing.T) {
	if len(enterpriseDueNotificationActions) != 3 {
		t.Fatal("unexpected unified due notification routes")
	}
	for path, action := range enterpriseDueNotificationActions {
		if legacyAimsDueNotificationPaths[path] {
			t.Fatalf("unified route %s collides with legacy path", path)
		}
		body := map[string]any{"forged_actor": "admin"}
		if err := validateDueNotificationWorkerBody("/v1/aims/service/notifications:"+action, body); err == nil {
			t.Fatalf("%s accepted an unsupported field", action)
		}
	}
	for _, capability := range []string{enterpriseSchedulerCapability, enterpriseMilestoneRolloverCapability} {
		if capability == enterpriseDueNotificationCapability {
			t.Fatal("due notification capability reuses another scheduler grant")
		}
	}
}
