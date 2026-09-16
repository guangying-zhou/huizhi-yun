package altoc

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// 走查 ISSUE-B-023（P0）：integration_operation.next_attempt_at 的列默认值是
// CURRENT_TIMESTAMP(3)，MySQL 按**会话时区**求值。生产 session_tz=SYSTEM=CST(UTC+8)，
// 于是新冻结的 operation 拿到的是本地墙钟值。
//
// 而 claim 的判据是 `next_attempt_at <= ?`，参数来自 Go 的 time.Now().UTC()。
// 两者差 8 小时，条件恒为假：
//
//	next_attempt_at            = 2026-08-28 06:32:35   (CST 值)
//	Go now.UTC()               = 2026-08-27 22:32:35
//	claimable_with_utc_clock   = 0
//
// 后果：每条新建的 integration_operation 在 8 小时内都领不到，即时投递永远不发生；
// 而 scheduled drain 默认关闭。生产实测：开票申请 operation 冻结后 status 一直是
// pending、attempt_count=0、version_no=1，Finance 侧零记录，前端却显示绿色成功。
//
// 代码其余位置写 next_attempt_at 一律用 UTC_TIMESTAMP(6)，UTC 才是约定域，
// 列默认值是那个异类。因此所有 INSERT 必须显式写 UTC 值，不能依赖列默认。

var insertOperationPattern = regexp.MustCompile(`(?s)INSERT INTO integration_operation \((.*?)\) VALUES \((.*?)\)`)

func TestIntegrationOperationInsertsPinNextAttemptToUTC(t *testing.T) {
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	checked := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range insertOperationPattern.FindAllStringSubmatch(string(content), -1) {
			columns, values := match[1], match[2]
			checked++
			if !strings.Contains(columns, "next_attempt_at") {
				t.Errorf(
					"%s: INSERT INTO integration_operation must set next_attempt_at explicitly; "+
						"the column default CURRENT_TIMESTAMP is evaluated in the session time zone "+
						"and becomes unclaimable against the UTC clock the claim query uses",
					name,
				)
				continue
			}
			if !strings.Contains(values, "UTC_TIMESTAMP") {
				t.Errorf(
					"%s: next_attempt_at must be written with UTC_TIMESTAMP to match time.Now().UTC() "+
						"used by the claim predicate",
					name,
				)
			}
		}
	}

	if checked == 0 {
		t.Fatal("no integration_operation INSERT found; the scan pattern probably drifted")
	}
}

// 其余写 next_attempt_at 的地方本来就用 UTC_TIMESTAMP；这里防止有人改回本地时钟。
func TestIntegrationOperationNeverWritesLocalClockToNextAttempt(t *testing.T) {
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	localClock := regexp.MustCompile(`next_attempt_at\s*=\s*(?:CURRENT_TIMESTAMP|NOW\()`)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if localClock.MatchString(string(content)) {
			t.Errorf("%s: next_attempt_at must not be written with the session-local clock", name)
		}
	}
}
