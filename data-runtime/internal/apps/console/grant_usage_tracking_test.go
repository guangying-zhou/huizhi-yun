package console

import (
	"os"
	"strings"
	"testing"
)

// scope 校验通过后必须记录 grant 使用时间。
//
// 授权清理长期没有可靠判据：grant 来源分散在 SQL seed / Go 自动 provision / env 三处，
// 且代码里大量 scope 是动态拼接的，静态分析无法判断某条 grant 是否仍在使用
// （2026-08-23 的三次静态审计分别误报 73 / 29 / 215 条）。
// last_used_at 是唯一可靠的孤儿判据。
func TestServiceTokenIssuanceTouchesGrantUsage(t *testing.T) {
	raw, err := os.ReadFile("auth_service_tokens.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	source := string(raw)

	if !strings.Contains(source, "func (a *Adapter) touchServiceClientGrantUsage") {
		t.Fatal("缺少 touchServiceClientGrantUsage")
	}
	if !strings.Contains(source, "SET last_used_at=UTC_TIMESTAMP()") {
		t.Error("必须更新 last_used_at")
	}

	// 必须在授权成功路径上被调用，而不是只定义不用。
	start := strings.Index(source, "func (a *Adapter) authorizeServiceClientScopes")
	if start < 0 {
		t.Fatal("authorizeServiceClientScopes not found")
	}
	body := source[start:]
	if next := strings.Index(body[1:], "\nfunc "); next > 0 {
		body = body[:next+1]
	}
	if !strings.Contains(body, "a.touchServiceClientGrantUsage(") {
		t.Error("authorizeServiceClientScopes 必须在校验通过后打点")
	}
}

// 打点失败不得阻断令牌签发：可观测性不能成为授权路径的故障点。
func TestGrantUsageTouchDoesNotBlockIssuance(t *testing.T) {
	raw, err := os.ReadFile("auth_service_tokens.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	start := strings.Index(string(raw), "func (a *Adapter) touchServiceClientGrantUsage")
	body := string(raw)[start:]
	if next := strings.Index(body[1:], "\nfunc "); next > 0 {
		body = body[:next+1]
	}
	// 该函数不返回 error，调用方无从阻断。
	sig := body[:strings.Index(body, "{")]
	if strings.Contains(sig, "error") {
		t.Error("touchServiceClientGrantUsage 不应返回 error —— 打点失败必须被吞掉，不影响签发")
	}
}
