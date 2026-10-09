package knowledgecommand

import (
	"encoding/json"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"os"
	"testing"
)

func knowledgeFixture(t *testing.T, target string) (url.Values, map[string]any) {
	t.Helper()
	cap := target + ":knowledge-link:create"
	if target == "assets" {
		cap = "assets:asset-link:create"
	}
	cmd := map[string]any{"actorUid": "person", "action": "link", "ticketCode": "TK-1", "documentUuid": uuid.NewString(), "customerCode": "CU-1", "contractCode": "CT-1", "projectCode": "P-1", "deliveryCode": "D-1", "deliveryAssetCode": "DA-1", "environmentCode": "ENV-1", "targetDeployment": target + "-test"}
	digest, e := integrationoperation.ValidateAndDigestCommand(cmd)
	if e != nil {
		t.Fatal(e)
	}
	body := map[string]any{"serviceCommand": map[string]any{"targetApp": target, "operationId": uuid.NewString(), "operationCode": "enterprise." + target + ".knowledge-link.v1", "requiredCapability": cap, "idempotencyKey": "knowledge:1", "commandSchemaVersion": "v1", "commandSha256": digest, "command": cmd}, integrationoperation.TrustedServiceCommandTenantKey: "C000001", integrationoperation.TrustedServiceCommandSourceDeploymentKey: "enterprise-test", integrationoperation.TrustedServiceCommandTargetDeploymentKey: target + "-test", integrationoperation.TrustedServiceCommandSourceAppKey: "enterprise", integrationoperation.TrustedServiceCommandTargetAppKey: target, integrationoperation.TrustedServiceCommandSourceClientKey: "enterprise.runtime"}
	q := url.Values{"hzy_runtime_source_app": {target}, "hzy_runtime_tenant_code": {"C000001"}, "hzy_runtime_deployment_code": {target + "-test"}, "current_user": {"person"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_actor_purpose": {"service-command"}, "current_user_scopes": {cap}}
	return q, body
}
func TestKnowledgeCommandTargetMatrix(t *testing.T) {
	for _, target := range []string{"assets", "codocs"} {
		t.Run(target, func(t *testing.T) {
			q, b := knowledgeFixture(t, target)
			if _, _, e := Validate(target, q, b); e != nil {
				t.Fatal(e)
			}
			for _, key := range []string{"hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "current_user", "hzy_runtime_actor_delegated", "hzy_runtime_actor_purpose", "current_user_scopes"} {
				t.Run(key, func(t *testing.T) {
					q, b := knowledgeFixture(t, target)
					q.Set(key, "wrong")
					if _, _, e := Validate(target, q, b); e == nil {
						t.Fatal("untrusted delegation accepted")
					}
				})
			}
			for _, key := range []string{integrationoperation.TrustedServiceCommandSourceAppKey, integrationoperation.TrustedServiceCommandSourceClientKey, integrationoperation.TrustedServiceCommandTenantKey, integrationoperation.TrustedServiceCommandTargetDeploymentKey, integrationoperation.TrustedServiceCommandTargetAppKey} {
				t.Run(key, func(t *testing.T) {
					q, b := knowledgeFixture(t, target)
					b[key] = "wrong"
					if _, _, e := Validate(target, q, b); e == nil {
						t.Fatal("source binding accepted")
					}
				})
			}
			for _, key := range []string{"requiredCapability", "commandSha256", "operationCode"} {
				t.Run(key, func(t *testing.T) {
					q, b := knowledgeFixture(t, target)
					b["serviceCommand"].(map[string]any)[key] = "wrong"
					if _, _, e := Validate(target, q, b); e == nil {
						t.Fatal("tampered envelope accepted")
					}
				})
			}
		})
	}
}

func TestKnowledgeSharedGolden(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/knowledge-link-command.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Command   map[string]any `json:"command"`
		Canonical string         `json:"canonical"`
		SHA256    string         `json:"sha256"`
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	encoded, e := json.Marshal(f.Command)
	if e != nil || string(encoded) != f.Canonical {
		t.Fatal("Go canonical drift", string(encoded), e)
	}
	digest, e := integrationoperation.ValidateAndDigestCommand(f.Command)
	if e != nil || digest != f.SHA256 {
		t.Fatal("Go digest drift", digest, e)
	}
}
