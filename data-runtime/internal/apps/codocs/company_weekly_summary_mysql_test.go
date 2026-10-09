package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// schemaStatements extracts the named CREATE TABLE blocks from the real Codocs
// schema so the publish transaction is exercised against production column widths.
func schemaStatements(t *testing.T, tables ...string) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "codocs", "docs", "codocs_schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	statements := make([]string, 0, len(tables))
	for _, table := range tables {
		start := strings.Index(text, "CREATE TABLE `"+table+"` (")
		if start < 0 {
			start = strings.Index(text, "CREATE TABLE IF NOT EXISTS `"+table+"` (")
		}
		if start < 0 {
			t.Fatalf("table %s not found in Codocs schema", table)
		}
		end := strings.Index(text[start:], ";\n")
		if end < 0 {
			t.Fatalf("table %s has no terminator", table)
		}
		statements = append(statements, text[start:start+end])
	}
	return statements
}

func TestCompanyWeeklySummaryPublishIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_COMPANY_SUMMARY_SOCKET")
	if socket == "" {
		t.Skip("temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "company_summary_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, statement := range schemaStatements(t, "folders", "documents", "document_shares", "document_relations", "document_versions") {
		if _, err = db.Exec(statement); err != nil {
			t.Fatalf("real schema: %v", err)
		}
	}

	markdown := "# W40\n公司项目周报汇总"
	hash := companySummarySHA256([]byte(markdown))
	adapter := &Adapter{db: db}
	publish := func(period string, revision int, versionID string, recipients []any) (map[string]any, error) {
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		result, err := adapter.publishCompanyWeeklySummaryTx(context.Background(), tx, map[string]any{
			"periodKey": period, "title": period + " 公司项目周报汇总", "operatorUid": "operator-1",
			"markdownContent": markdown, "markdownSha256": hash, "revisionNo": revision,
			"ossPath": "codocs/publish/company/" + period + "/company-weekly-summary.md", "ossVersionId": versionID,
			"documentUrl": "https://oss.example/x.md", "recipientUids": recipients,
		})
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		return result, nil
	}

	cases := map[string]struct {
		period, versionID string
		recipients        []any
	}{
		"unversioned bucket fallback (71 chars)":   {"2026-W40", "sha256-" + hash, []any{}},
		"real 64-char Aliyun-style version id":     {"2026-W41", "CAEQNhiBgIDe" + strings.Repeat("x", 52), []any{"user-a", "user-b"}},
		"real version id at the 100-char boundary": {"2026-W42", strings.Repeat("v", 100), []any{"user-a"}},
	}
	for label, tc := range cases {
		result, err := publish(tc.period, 1, tc.versionID, tc.recipients)
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		if result["recipientCount"] != len(tc.recipients) {
			t.Fatalf("%s: %v", label, result)
		}
		var commit, storedVersion string
		var status, readonly int
		err = db.QueryRow(`SELECT COALESCE(d.oss_commit_id,''), v.oss_version_id, d.status, d.readonly_flag
			FROM documents d JOIN document_versions v ON v.document_id = d.id WHERE d.uuid = ?`, result["documentUuid"]).
			Scan(&commit, &storedVersion, &status, &readonly)
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		if commit != hash || storedVersion != tc.versionID || status != 2 || readonly != 1 {
			t.Fatalf("%s: commit=%q version=%q status=%d readonly=%d", label, commit, storedVersion, status, readonly)
		}
		var shares int
		if err = db.QueryRow(`SELECT COUNT(*) FROM document_shares s JOIN documents d ON d.id = s.document_id WHERE d.uuid = ?`, result["documentUuid"]).Scan(&shares); err != nil || shares != len(tc.recipients) {
			t.Fatalf("%s: shares=%d err=%v", label, shares, err)
		}
	}

	// An idempotent receipt hit has no stored business value; the evidence must be
	// rebuilt from the committed rows and match what the first publish returned.
	first, err := publish("2026-W44", 2, "sha256-"+hash, []any{"user-a"})
	if err != nil {
		t.Fatal(err)
	}
	rebuilt, err := adapter.existingCompanyWeeklySummaryResult(context.Background(), "2026-W44", 2, hash, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"documentUuid", "documentVersionId", "documentVersionNum", "markdownSha256", "recipientCount"} {
		if rebuilt[key] != first[key] {
			t.Fatalf("rebuilt %s = %v, first publish returned %v", key, rebuilt[key], first[key])
		}
	}
	for label, call := range map[string]func() (map[string]any, error){
		"another content hash": func() (map[string]any, error) {
			return adapter.existingCompanyWeeklySummaryResult(context.Background(), "2026-W44", 2, strings.Repeat("f", 64), 0)
		},
		"another revision": func() (map[string]any, error) {
			return adapter.existingCompanyWeeklySummaryResult(context.Background(), "2026-W44", 3, hash, 0)
		},
		"another period": func() (map[string]any, error) {
			return adapter.existingCompanyWeeklySummaryResult(context.Background(), "2026-W45", 2, hash, 0)
		},
	} {
		if _, err := call(); err == nil {
			t.Fatalf("%s: expected a conflict", label)
		} else if he, ok := err.(httperror.Error); !ok || he.Status != http.StatusConflict {
			t.Fatalf("%s: %#v", label, err)
		}
	}
	// The unsigned request URL is never trusted: the rebuilt evidence always uses the server default.
	if rebuilt["documentUrl"] != "/documents/"+first["documentUuid"].(string) {
		t.Fatalf("rebuilt document url = %v", rebuilt["documentUrl"])
	}

	// Same revision published again must be idempotent (no second document).
	if _, err = publish("2026-W40", 1, "sha256-"+hash, []any{}); err != nil {
		t.Fatal(err)
	}
	var documents int
	if err = db.QueryRow(`SELECT COUNT(*) FROM documents WHERE oss_path LIKE 'codocs/publish/company/2026-W40/%'`).Scan(&documents); err != nil || documents != 1 {
		t.Fatalf("documents=%d err=%v", documents, err)
	}

	// An oversized id fails with the stable contract error and writes nothing.
	_, err = publish("2026-W43", 1, strings.Repeat("v", 101), []any{})
	if he, ok := err.(httperror.Error); !ok || he.Status != http.StatusConflict {
		t.Fatalf("oversized version id: %#v", err)
	}
	var stray int
	if err = db.QueryRow(`SELECT COUNT(*) FROM documents WHERE oss_path LIKE 'codocs/publish/company/2026-W43/%'`).Scan(&stray); err != nil || stray != 0 {
		t.Fatalf("stray=%d err=%v", stray, err)
	}
}
