// Local-only initial enrollment. No HTTP surface, secret output or credential rotation.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "ENTERPRISE_CREDENTIAL_FAILED (details suppressed; no secret output)")
		os.Exit(1)
	}
}
func run() error {
	mode := "--plan"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	scope := "aims:products:view"
	audience := "data-runtime"
	external := mode == "--verify-codocs-token"
	if external {
		// codocs 侧现在有多条能力（产品文档、项目文档），默认保留原来的产品文档，
		// 但允许显式指定，否则新增能力永远验不到。
		scope, audience = "codocs:product-document:read", "codocs"
	}
	scoped := len(os.Args) == 4 && os.Args[2] == "--scope" && (mode == "--verify-token" || external)
	if scoped {
		scope = os.Args[3]
	}
	// 外部能力不在 enterpriseProbeScopes（那是 Runtime operations 的清单），
	// 但仍必须是已声明的精确能力：这里按 audience 前缀约束，不接受通配。
	if external && scoped && !strings.HasPrefix(scope, audience+":") {
		return errors.New("invalid external scope")
	}
	if (len(os.Args) > 2 && !scoped) || (!external && !enterpriseProbeScopes[scope]) || (mode != "--plan" && mode != "--apply" && mode != "--verify" && mode != "--verify-token" && !external) {
		return errors.New("invalid mode")
	}
	if mode == "--plan" {
		fmt.Println(`{"tenant":"C000001","environment":"test","deployment":"C000001-test-enterprise","client":"enterprise.runtime","database":"hzy_console_test_local_20260910","action":"initial enrollment only; existing invalid credentials refuse; AES-256-GCM customer Vault; no Worker secret export","applyFlag":"--apply","tokenIssuanceVerified":false}`)
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, "Library/Application Support/HuizhiYun/test-runtime")
	raw, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		return err
	}
	var cfg config.Config
	if err = json.Unmarshal(raw, &cfg); err != nil {
		return err
	}
	d := cfg.Apps.Console.DB
	if cfg.Tenant != "C000001" || cfg.Deployment != "c000001-test-tenant-runtime" || cfg.DeploymentBindings["console"] != "wiztek-test-console" || d.Host != "127.0.0.1" || d.Port != 3306 || d.Database != "hzy_console_test_local_20260910" {
		return errors.New("target mismatch")
	}
	key, err := os.ReadFile(filepath.Join(dir, "vault-key"))
	if err != nil {
		return err
	}
	cfg.Apps.Console.VaultMasterKey = strings.TrimSpace(string(key))
	if cfg.Apps.Console.VaultMasterKey == "" {
		return errors.New("vault key missing")
	}
	conn, err := db.Open(d)
	if err != nil {
		return err
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var name, uuid string
	if err = conn.QueryRowContext(ctx, `SELECT DATABASE(),@@server_uuid`).Scan(&name, &uuid); err != nil {
		return err
	}
	if name != d.Database || uuid != "37d8994e-4c12-11ee-afad-8cb2da2e572b" {
		return errors.New("instance mismatch")
	}
	var grants int
	if err = conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_client_grants g JOIN service_clients s ON s.id=g.service_client_id WHERE s.client_code='enterprise.runtime' AND g.status='active' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))='C000001' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))='C000001-test-enterprise'`).Scan(&grants); err != nil {
		return err
	}
	if grants == 0 {
		return errors.New("test deployment grant missing")
	}
	var drift int
	if err = conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_client_grants g JOIN service_clients s ON s.id=g.service_client_id WHERE s.client_code='enterprise.runtime' AND g.status='active' AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')),'')<>'C000001' OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')),'')<>'C000001-test-enterprise')`).Scan(&drift); err != nil {
		return err
	}
	if drift != 0 {
		return errors.New("grant binding drift")
	}
	adapter := console.NewWithDB(cfg.Apps.Console, cfg.Tenant, conn)
	in := console.InitialServiceCredential{ClientCode: "enterprise.runtime", AppCode: "enterprise", ActorID: "local-enterprise-test-enrollment"}
	if mode == "--verify-token" || external {
		raw, err := io.ReadAll(io.LimitReader(os.Stdin, 32769))
		if err != nil {
			return err
		}
		if len(raw) > 32768 {
			return errors.New("token too large")
		}
		err = adapter.VerifyInitialServiceToken(ctx, strings.TrimSpace(string(raw)), console.InitialServiceTokenExpectation{Issuer: "https://hzy-test.huizhi.yun", Audience: audience, Tenant: "C000001", Deployment: "C000001-test-enterprise", ClientCode: "enterprise.runtime", AppCode: "enterprise", Scope: scope})
		if err != nil {
			return err
		}
		json.NewEncoder(os.Stdout).Encode(map[string]any{"tokenVerified": true, "scope": scope, "audience": audience, "stateVerified": true})
		return nil
	}
	var out console.InitialServiceCredentialResult
	if mode == "--apply" {
		out, err = adapter.EnsureInitialServiceCredential(ctx, in)
	} else {
		out, err = adapter.VerifyInitialServiceCredential(ctx, in)
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(out)
}
