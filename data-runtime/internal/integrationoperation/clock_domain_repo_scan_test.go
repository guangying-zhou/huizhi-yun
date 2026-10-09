package integrationoperation

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// 走查 ISSUE-B-023 的仓库级护栏。
//
// integration_operation.next_attempt_at 的列默认值是 CURRENT_TIMESTAMP(3)，
// MySQL 按**会话时区**求值；生产 session_tz=SYSTEM=CST(UTC+8)。而 claim 的判据
// `next_attempt_at <= ?` 用的是 Go 的 time.Now().UTC()。两者差 8 小时，
// 漏写该列的 INSERT 建出来的 operation 在 8 小时内一律领不到。
//
// 已有的 apps/altoc/integration_operation_clock_domain_test.go 只扫 altoc 目录，
// 而且正则只匹配 `INSERT INTO`，匹配不到 finance 用的 `INSERT IGNORE INTO`——
// 所以 finance 的两处漏写一直没被发现，直到 B-025 端到端复验时
// finance -> workflow 第二跳卡住 7 小时才暴露。本测试改为扫描整个
// data-runtime/internal 并同时覆盖两种 INSERT 写法。

// 已知欠账：这两个文件属于其它 Stream 的范围，不在本次改动内。
// 修复后必须从本清单删除；清单只允许变短，不允许变长。
var knownClockDomainDebt = map[string]string{
	"apps/assets/delivery_asset_status_operation.go": "Assets 范围",
}

var insertIntoOperation = regexp.MustCompile(`INSERT\s+(?:IGNORE\s+)?INTO\s+integration_operation\s*\(`)

// balancedParen 返回 source[start] 处 '(' 配平后的内容与结束下标。
func balancedParen(source string, start int) (string, int) {
	depth := 0
	for i := start; i < len(source); i++ {
		switch source[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return source[start+1 : i], i
			}
		}
	}
	return "", -1
}

func TestEveryIntegrationOperationInsertPinsNextAttemptToUTC(t *testing.T) {
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}

	checked := 0
	seenDebt := map[string]bool{}

	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		source := string(content)
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)

		for _, loc := range insertIntoOperation.FindAllStringIndex(source, -1) {
			columns, end := balancedParen(source, loc[1]-1)
			if end < 0 {
				t.Fatalf("%s: unbalanced INSERT column list; the scan pattern drifted", rel)
			}
			checked++

			if reason, known := knownClockDomainDebt[rel]; known {
				seenDebt[rel] = true
				if strings.Contains(columns, "next_attempt_at") {
					t.Errorf("%s is fixed (%s); remove it from knownClockDomainDebt", rel, reason)
				}
				continue
			}

			if !strings.Contains(columns, "next_attempt_at") {
				t.Errorf(
					"%s: INSERT INTO integration_operation must set next_attempt_at explicitly; "+
						"the column default CURRENT_TIMESTAMP is evaluated in the session time zone and "+
						"becomes unclaimable against the UTC clock used by the claim predicate",
					rel,
				)
				continue
			}

			valuesAt := strings.Index(source[end:], "VALUES")
			if valuesAt < 0 {
				continue
			}
			open := strings.Index(source[end+valuesAt:], "(")
			values, _ := balancedParen(source, end+valuesAt+open)
			if !strings.Contains(values, "UTC_TIMESTAMP") {
				t.Errorf(
					"%s: next_attempt_at must be written with UTC_TIMESTAMP to match time.Now().UTC() "+
						"used by the claim predicate",
					rel,
				)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	if checked == 0 {
		t.Fatal("no integration_operation INSERT found; the scan pattern probably drifted")
	}
	for rel := range knownClockDomainDebt {
		if !seenDebt[rel] {
			t.Errorf("knownClockDomainDebt lists %s but no INSERT was found there; the entry is stale", rel)
		}
	}
}

func TestPeopleIntegrationOperationInsertPinsRetryWindowToUTC(t *testing.T) {
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}

	files := []string{
		"apps/people/directory_lifecycle_operation.go",
		"apps/people/assets_offboarding_projection.go",
	}
	for _, rel := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatal(readErr)
		}
		source := string(content)
		locations := insertIntoOperation.FindAllStringIndex(source, -1)
		if len(locations) == 0 {
			t.Fatalf("%s: no integration_operation INSERT found", rel)
		}

		for _, loc := range locations {
			columns, end := balancedParen(source, loc[1]-1)
			if end < 0 {
				t.Fatalf("%s: unbalanced INSERT column list", rel)
			}
			for _, column := range []string{"next_attempt_at", "created_at", "updated_at"} {
				if !strings.Contains(columns, column) {
					t.Errorf(
						"%s: People integration_operation INSERT must set %s explicitly; "+
							"retry policy compares created_at with time.Now().UTC()",
						rel,
						column,
					)
				}
			}

			valuesAt := strings.Index(source[end:], "VALUES")
			if valuesAt < 0 {
				t.Fatalf("%s: INSERT has no VALUES clause", rel)
			}
			open := strings.Index(source[end+valuesAt:], "(")
			values, valuesEnd := balancedParen(source, end+valuesAt+open)
			if valuesEnd < 0 {
				t.Fatalf("%s: unbalanced INSERT values list", rel)
			}
			if strings.Count(values, "UTC_TIMESTAMP(3)") < 3 {
				t.Errorf(
					"%s: next_attempt_at, created_at and updated_at must all use UTC_TIMESTAMP(3)",
					rel,
				)
			}
		}
	}
}
