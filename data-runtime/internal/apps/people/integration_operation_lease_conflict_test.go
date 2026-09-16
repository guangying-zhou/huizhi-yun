package people

import (
	"os"
	"strings"
	"testing"
)

// People 的 claim / succeed / fail 必须把 ErrPersistenceRace 映射成 409。
//
// 2026-08-23 生产事故：这三个入口（assets_offboarding_projection.go）没有做该映射，
// 而 aims / altoc 的同名入口都有。租约过期后 reaper 会把 processing 翻成 partial_unknown，
// RecordFailure 的 `WHERE status='processing'` 匹配 0 行 -> ErrPersistenceRace ->
// 未分类错误漏成 500 -> BFF 按可重试处理 -> 无限重试。
// 结果：93 条 operation 卡死，单条 attempt_count 达 5261（max_attempts 只有 8），
// 重试上限完全失效。必须返回 409，调用方才能正确 checkpoint。
func TestPeopleCompletionEntrypointsMapPersistenceRaceToConflict(t *testing.T) {
	raw, err := os.ReadFile("assets_offboarding_projection.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	source := string(raw)

	for _, entrypoint := range []string{
		"claimPeopleIntegrationOperation",
		"succeedPeopleIntegrationOperation",
		"failPeopleIntegrationOperation",
	} {
		start := strings.Index(source, "func (a *Adapter) "+entrypoint)
		if start < 0 {
			t.Fatalf("%s not found", entrypoint)
		}
		body := source[start:]
		if next := strings.Index(body[1:], "\nfunc "); next > 0 {
			body = body[:next+1]
		}
		if !strings.Contains(body, "ErrPersistenceRace") {
			t.Errorf("%s 必须映射 ErrPersistenceRace，否则会漏成 500 并导致调用方无限重试", entrypoint)
		}
		if !strings.Contains(body, "StatusConflict") {
			t.Errorf("%s 必须对陈旧租约返回 409", entrypoint)
		}
	}
}
