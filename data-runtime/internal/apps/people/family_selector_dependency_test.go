package people

import (
	"os"
	"strings"
	"testing"
)

// family 选择器与 claim 必须使用同一套"可领取"条件。
//
// 2026-08-24 生产事故：nextPeopleOperationKeyForFamily 只按 created_at 挑最旧一条
// 且不校验依赖，而 ClaimByOperationKey 要求依赖 status='succeeded'。
// 最旧那条的依赖已进 dead_letter（永远不可能 succeeded）时，每轮都选中它、
// 每轮都被 claim 拒绝，且不会尝试下一条 —— 整个 family 队列被队头卡死。
// 5 条健康的离职停用操作因此被卡了一个月，无重试、无告警。
func TestFamilySelectorAppliesSameDependencyGateAsClaim(t *testing.T) {
	raw, err := os.ReadFile("assets_offboarding_projection.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	source := string(raw)

	start := strings.Index(source, "func (a *Adapter) nextPeopleOperationKeyForFamily")
	if start < 0 {
		t.Fatal("nextPeopleOperationKeyForFamily not found")
	}
	body := source[start:]
	if next := strings.Index(body[1:], "\nfunc "); next > 0 {
		body = body[:next+1]
	}

	if !strings.Contains(body, "depends_on_operation_key IS NULL") {
		t.Error("选择器必须允许无依赖的操作")
	}
	if !strings.Contains(body, "dependency.status='succeeded'") {
		t.Error("选择器必须要求依赖已 succeeded，否则会选中永远领不走的队头")
	}
	// 依赖存在性判定必须限定在同一 tenant/deployment/source_app 内。
	for _, scope := range []string{
		"dependency.tenant_code=o.tenant_code",
		"dependency.deployment_code=o.deployment_code",
		"dependency.source_app=o.source_app",
	} {
		if !strings.Contains(body, scope) {
			t.Errorf("依赖判定缺少范围限定: %s", scope)
		}
	}
}
