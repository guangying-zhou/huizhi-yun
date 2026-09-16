package integrationoperation

import (
	"os"
	"strings"
	"testing"
)

// 终态完成时绝不能把 next_attempt_at 写成 NULL。
//
// 2026-08-24 生产事故：`integration_operation.next_attempt_at` 在所有应用 schema 中
// 都是 `DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`，但 RecordFailure 在
// 终态（Retry=false）时传 nil，触发
// `Error 1048 (23000): Column 'next_attempt_at' cannot be null`，
// 事务回滚 -> `:fail` 返回可重试的 500 -> 调用方无限重试 ->
// **任何 operation 都无法进入 dead_letter/failed_permanent**，max_attempts 完全失效。
func TestRecordFailureNeverWritesNullNextAttemptAt(t *testing.T) {
	raw, err := os.ReadFile("repository_complete.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	source := string(raw)

	// 旧写法：先声明为 any 再仅在 Retry 时赋值，未赋值即为 nil -> NULL。
	if strings.Contains(source, "var nextAttemptAt any") {
		t.Error("nextAttemptAt 不得声明为可为 nil 的 any；终态会写入 NULL 违反 NOT NULL 约束")
	}
	// 新写法：必须有一个非 nil 的默认值。
	if !strings.Contains(source, "nextAttemptAt := input.Now") {
		t.Error("终态必须写入一个合法的非空时间（完成时间），以满足 NOT NULL 约束")
	}
}

// 终态行不会被重新领取，所以给 next_attempt_at 赋完成时间不会影响调度。
func TestClaimOnlySelectsNonTerminalStatuses(t *testing.T) {
	raw, err := os.ReadFile("repository_claim.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	claim := string(raw)
	if !strings.Contains(claim, "'pending', 'retry_wait', 'partial_unknown'") {
		t.Fatal("claim 的状态过滤条件已变化；需重新确认终态行不会被重新领取")
	}
	for _, terminal := range []string{"'dead_letter'", "'failed_permanent'", "'succeeded'"} {
		if strings.Contains(claim, "status IN ("+terminal) {
			t.Fatalf("终态 %s 不应可被领取", terminal)
		}
	}
}
