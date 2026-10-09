package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestEnterpriseAimsRepositoryReadMySQL(t *testing.T) {
	socket := os.Getenv("HZY_AIMS_REPOSITORY_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated temporary MySQL required")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") {
		t.Fatal("not isolated")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.ParseTime = "root", "unix", socket, true
	admin, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_repository_%d", time.Now().UnixNano())
	if _, err = admin.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE `" + name + "`")
	mc.DBName = name
	conn, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	raw, err := os.ReadFile("../../../../console/docs/hzy_console_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `([^`]+)`.*?;").FindAllStringSubmatch(string(raw), -1) {
		if m[1] == "vault_secrets" || m[1] == "vault_secret_versions" || m[1] == "vault_access_logs" || m[1] == "integrations" || m[1] == "integration_credentials" {
			if _, err = conn.Exec(m[0]); err != nil {
				t.Fatal(m[1], err)
			}
		}
	}
	a := NewWithDB(config.ConsoleConfig{VaultMasterKey: "isolated-fixture-key"}, "fixture-tenant", conn)
	ctx := context.Background()

	const synthetic = "ISOLATED-GITLAB-TOKEN"
	const sha = "0123456789012345678901234567890123456789"
	calls := 0
	git := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet || r.Header.Get("PRIVATE-TOKEN") != synthetic || !strings.Contains(r.URL.Path, "/repository/files/") {
			t.Error("unexpected read request")
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"file_path": "docs/fixture.md", "file_name": "fixture.md", "content": "# fixture", "encoding": "text", "commit_id": sha, "last_commit_id": sha, "blob_id": sha})
	}))
	defer git.Close()
	oldClient := gitLabOperationClient
	gitLabOperationClient = git.Client()
	defer func() { gitLabOperationClient = oldClient }()
	material, err := a.encryptVaultPlaintext(synthetic)
	if err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO vault_secrets(id,secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,storage_backend,reveal_policy,status,created_by) VALUES (1,'git-fixture','hzybase://vault/git-fixture','fixture','api_key','integration','integration','gitlab.default','db_encrypted','single_actor','active','fixture')`)
	exec(`INSERT INTO vault_secret_versions(id,secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,status,activated_at,created_by) VALUES (1,1,1,?,?,?,?,'active',UTC_TIMESTAMP(),'fixture')`, material.CiphertextBlob, material.ContentHash, material.EncryptionScheme, material.KeyFingerprint)
	exec(`UPDATE vault_secrets SET current_version_id=1 WHERE id=1`)
	exec(`INSERT INTO integrations(id,integration_code,integration_type,integration_name,base_url,config_json,status,current_credential_id) VALUES (1,'gitlab.default','gitlab','fixture',?,'{"defaultBranch":"main"}','active',1)`, git.URL)
	exec(`INSERT INTO integration_credentials(id,integration_id,secret_id,secret_version_id,status) VALUES (1,1,1,1,'active')`)
	result, err := a.ReadEnterpriseAimsRepository(ctx, "file", "fixture/repo", "docs/fixture.md", "", sha, "fixture-member")
	if err != nil || result["content"] != "# fixture" || result["commitId"] != sha || calls != 1 {
		t.Fatalf("typed file read failed: %v", err)
	}
	var auditCount int
	if err = conn.QueryRow(`SELECT COUNT(*) FROM vault_access_logs WHERE actor_type='user' AND actor_id='fixture-member' AND app_code='aims' AND action='resolve' AND result_status='success'`).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatal("owning user audit missing", err)
	}
	for _, input := range [][6]string{
		{"issue-upsert", "fixture/repo", "docs/fixture.md", "", sha, "fixture-member"},
		{"file", "fixture/repo", "../secret", "", sha, "fixture-member"},
		{"file", "fixture/repo", "docs/fixture.md", "bad?ref", sha, "fixture-member"},
		{"file", "fixture/repo", "docs/fixture.md", "", "not-a-sha", "fixture-member"},
		{"file", "fixture/repo", "docs/fixture.md", "", sha, ""},
	} {
		if _, err = a.ReadEnterpriseAimsRepository(ctx, input[0], input[1], input[2], input[3], input[4], input[5]); err == nil {
			t.Fatal("invalid typed read accepted")
		}
	}
	if calls != 1 {
		t.Fatal("invalid input reached GitLab")
	}
	for _, change := range []string{
		`UPDATE integrations SET status='inactive'`,
		`UPDATE integrations SET status='active',integration_type='other'`,
		`UPDATE integrations SET integration_type='gitlab';`,
	} {
		exec(change)
		if strings.Contains(change, "other") || strings.Contains(change, "inactive") {
			if _, err = a.ReadEnterpriseAimsRepository(ctx, "file", "fixture/repo", "docs/fixture.md", "", sha, "fixture-member"); err == nil {
				t.Fatal("inactive/wrong integration accepted")
			}
		}
	}
	exec(`UPDATE vault_secrets SET owner_key='another-integration'`)
	if _, err = a.ReadEnterpriseAimsRepository(ctx, "file", "fixture/repo", "docs/fixture.md", "", sha, "fixture-member"); err == nil {
		t.Fatal("wrong credential owner accepted")
	}
	if calls != 1 {
		t.Fatal("invalid binding reached GitLab")
	}
}
