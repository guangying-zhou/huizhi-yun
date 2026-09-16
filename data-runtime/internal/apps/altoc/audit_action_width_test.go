package altoc

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// 走查 ISSUE-B-022：audit_log.action 是 VARCHAR(20)，而代码里陆续引入了更长的
// 语义动作名。STRICT_TRANS_TABLES 下超长写入抛 MySQL 1406，该错误没有映射，
// 经 writeError 兜底成 500，BFF 再包成 503，用户只看到 "Internal server error"。
//
// 生产实测受影响的三条流程：
//   'aims_work_item_dispatch'  23  服务工单派发到 Aims
//   'invoice_request_freeze'   22  回款计划发起开票申请（主线）
//   'create_from_quotation'    21  报价转合同（主线）
//
// 迁移 045 已把列加宽到 64。这个测试直接从 altoc_schema.sql 读出声明宽度，
// 再扫描所有审计写入点的动作名字面量，保证二者不再脱节。

var auditCallPattern = regexp.MustCompile(
	`insertAltoc(?:Notification)?Audit(?:Record)?Tx\(\s*ctx,\s*tx,\s*"[^"]*"\s*,\s*[^,]+,\s*"([^"]+)"`,
)

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	// internal/apps/altoc -> data-runtime -> repo root
	return filepath.Clean(filepath.Join(dir, "..", "..", "..", ".."))
}

func declaredAuditActionWidth(t *testing.T) int {
	t.Helper()
	path := filepath.Join(repoRoot(t), "altoc", "docs", "altoc_schema.sql")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read altoc_schema.sql: %v", err)
	}
	block := string(content)
	start := strings.Index(block, "CREATE TABLE audit_log")
	if start < 0 {
		t.Fatal("audit_log table not found in altoc_schema.sql")
	}
	block = block[start:]
	if end := strings.Index(block, "ENGINE"); end > 0 {
		block = block[:end]
	}
	m := regexp.MustCompile(`action\s+VARCHAR\((\d+)\)`).FindStringSubmatch(block)
	if m == nil {
		t.Fatal("audit_log.action column declaration not found")
	}
	width, err := strconv.Atoi(m[1])
	if err != nil {
		t.Fatal(err)
	}
	return width
}

func TestAuditActionNamesFitDeclaredColumnWidth(t *testing.T) {
	width := declaredAuditActionWidth(t)
	if width < 20 {
		t.Fatalf("unexpected audit_log.action width %d", width)
	}

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
		for _, match := range auditCallPattern.FindAllStringSubmatch(string(content), -1) {
			action := match[1]
			checked++
			if len(action) > width {
				t.Errorf(
					"%s: audit action %q is %d chars but audit_log.action is VARCHAR(%d); "+
						"writing it raises MySQL 1406, which is unmapped and surfaces as an opaque 500",
					name, action, len(action), width,
				)
			}
		}
	}

	if checked == 0 {
		t.Fatal("no audit action literals found; the scan pattern probably drifted")
	}
}

// 锁住那三个曾经溢出的动作名，避免列宽被改回去时无声复发。
func TestPreviouslyOverflowingAuditActionsStillFit(t *testing.T) {
	width := declaredAuditActionWidth(t)
	for _, action := range []string{
		"aims_work_item_dispatch",
		"invoice_request_freeze",
		"create_from_quotation",
	} {
		if len(action) > width {
			t.Errorf("audit action %q (%d chars) no longer fits VARCHAR(%d)", action, len(action), width)
		}
	}
}
