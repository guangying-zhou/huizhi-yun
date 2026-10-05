package cutoverprofile_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/enterprisecandidate"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

// Isolated harness only: node data-runtime/scripts/test-enterprise-cutover-profile-mysql.mjs
type harness struct {
	t       *testing.T
	root    *sql.DB
	port    int
	tools   map[string]string
	work    string
	secrets []string
	outputs []string
}

func isolatedHarness(t *testing.T) *harness {
	socket := os.Getenv("HZY_CUTOVER_PROFILE_SOCKET")
	if socket == "" {
		t.Skip("requires the dedicated temporary MySQL harness")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
	}
	port, err := strconv.Atoi(os.Getenv("HZY_CUTOVER_PROFILE_PORT"))
	if err != nil || port < 1 {
		t.Fatal("isolated TCP port required")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr = "root", "unix", socket
	mc.Params = map[string]string{"time_zone": "'+00:00'"}
	mc.Timeout = 5 * time.Second
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	h := &harness{t: t, root: root, port: port, work: t.TempDir(), tools: map[string]string{}}
	module, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	for _, name := range []string{"hzy-enterprise-migrate", "hzy-enterprise-test-cutover", "hzy-enterprise-compatibility-rehearsal", "hzy-enterprise-drain", "hzy-enterprise-add-altoc", "hzy-enterprise-verify-views"} {
		out := filepath.Join(bin, name)
		cmd := exec.Command("go", "build", "-o", out, "./cmd/"+name)
		cmd.Dir = module
		if raw, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("build %s: %v\n%s", name, err, raw)
		}
		h.tools[name] = out
	}
	return h
}

func (h *harness) exec(query string, args ...any) {
	h.t.Helper()
	if _, err := h.root.Exec(query, args...); err != nil {
		h.t.Fatalf("%s: %v", query, err)
	}
}

func (h *harness) path(name string) string { return filepath.Join(h.work, name) }

func (h *harness) writeJSON(name string, value any) string {
	h.t.Helper()
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		h.t.Fatal(err)
	}
	path := h.path(name)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		h.t.Fatal(err)
	}
	if err := os.Chmod(path, 0600); err != nil {
		h.t.Fatal(err)
	}
	return path
}

func (h *harness) run(tool string, args ...string) (string, error) {
	h.t.Helper()
	cmd := exec.Command(h.tools[tool], args...)
	cmd.Dir = h.work
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + h.work}
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	h.outputs = append(h.outputs, out.String())
	return out.String(), err
}

func (h *harness) ok(tool string, args ...string) string {
	h.t.Helper()
	out, err := h.run(tool, args...)
	if err != nil {
		h.t.Fatalf("%s %v failed: %v\n%s", tool, args, err, out)
	}
	return out
}

func (h *harness) refused(want, tool string, args ...string) {
	h.t.Helper()
	out, err := h.run(tool, args...)
	if err == nil {
		h.t.Fatalf("%s %v unexpectedly succeeded\n%s", tool, args, out)
	}
	if want != "" && !strings.Contains(out, want) {
		h.t.Fatalf("%s %v refused for another reason (want %q):\n%s", tool, args, want, out)
	}
}

func (h *harness) noSecretsInOutput() {
	h.t.Helper()
	for _, out := range h.outputs {
		for _, secret := range h.secrets {
			if secret != "" && strings.Contains(out, secret) {
				h.t.Fatal("tool output contained a credential")
			}
		}
	}
}

func (h *harness) instance() string {
	var id string
	if err := h.root.QueryRow("SELECT @@server_uuid").Scan(&id); err != nil {
		h.t.Fatal(err)
	}
	return id
}

func (h *harness) readPlan(path string) unified.Plan {
	h.t.Helper()
	var p unified.Plan
	raw, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(raw, &p) != nil {
		h.t.Fatal("plan unreadable", err)
	}
	return p
}

// Synthetic tables carry every column the migration semantic audits reference
// for these table names (discovered against the real audit queries). TEXT
// stands in for JSON so no unregistered JSON contract applies; the tables stay
// mostly empty, so the audits report no conflict.
var auditColumns = []string{"biz_id", "revision", "scope_revision", "plan_revision", "source_revision", "action", "status", "request_hash", "result_json", "object_type", "object_id", "changes", "line_code", "actor_uid", "idempotency_key", "request_id", "version_id", "release_record_id", "event_type", "accepted_by", "content_hash", "acceptance_snapshot", "cycle_id", "planning_item_id", "selection_status", "decision_snapshot"}

var externalSourceColumns = []string{"operation_id", "operation_key", "tenant_code", "deployment_code", "source_app", "target_app", "operation_code", "required_capability", "idempotency_key", "command_schema_version", "command_sha256", "status", "attempt_count", "locked_by", "locked_until", "target_receipt_id", "target_biz_type", "target_biz_code", "response_summary_sha256"}

func (h *harness) syntheticSources(aims, assets string) {
	h.t.Helper()
	required := enterprisecandidate.RequiredViews()
	for domain, schema := range map[string]string{"aims": aims, "assets": assets} {
		h.exec("CREATE DATABASE " + quote(schema) + " CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
		for _, name := range required[domain] {
			columns := ""
			for _, c := range auditColumns {
				columns += "," + quote(c) + " TEXT NULL"
			}
			h.exec("CREATE TABLE " + quote(schema) + "." + quote(name) + "(`id` BIGINT NOT NULL PRIMARY KEY,`product_code` VARCHAR(64) NULL,`label` VARCHAR(64) NULL" + columns + ") ENGINE=InnoDB")
		}
	}
	cols := []string{"`operation_id` VARCHAR(64) NOT NULL PRIMARY KEY"}
	for _, c := range append(externalSourceColumns[1:], "source_biz_type", "source_biz_code", "correlation_key", "depends_on_operation_key", "command_json", "fencing_token", "version_no") {
		cols = append(cols, quote(c)+" VARCHAR(191) NULL")
	}
	h.exec("CREATE TABLE " + quote(aims) + ".`integration_operation`(" + strings.Join(cols, ",") + ") ENGINE=InnoDB")
	h.exec("CREATE TABLE " + quote(aims) + ".`time_entry_audit`(`id` BIGINT NOT NULL PRIMARY KEY) ENGINE=InnoDB")
	h.exec("CREATE TRIGGER " + quote(aims) + ".`time_entry_audit_insert` AFTER INSERT ON " + quote(aims) + ".`time_entries` FOR EACH ROW INSERT INTO `time_entry_audit` VALUES(NEW.id)")
	h.exec("INSERT INTO " + quote(aims) + ".`time_entries`(id,label) VALUES(1,'restored-1'),(2,'restored-2')")
	h.exec("INSERT INTO " + quote(assets) + ".`asset_items`(id,label) VALUES(1,'asset-1')")
}

func quote(s string) string { return "`" + s + "`" }

// grantCutoverAccount creates the schema-scoped least-privilege account the
// profile names; it has no global privilege or GRANT OPTION.
func (h *harness) grantCutoverAccount(user, password, aims, assets, target string) {
	h.exec("CREATE USER '" + user + "'@'127.0.0.1' IDENTIFIED BY '" + password + "'")
	h.t.Cleanup(func() { h.root.Exec("DROP USER IF EXISTS '" + user + "'@'127.0.0.1'") })
	for _, schema := range []string{aims, assets} {
		h.exec("GRANT SELECT,INSERT,UPDATE,CREATE,TRIGGER ON " + quote(strings.ReplaceAll(schema, "_", `\_`)) + ".* TO '" + user + "'@'127.0.0.1'")
	}
	h.exec("GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,INDEX,REFERENCES,TRIGGER,CREATE VIEW,SHOW VIEW ON " + quote(strings.ReplaceAll(target, "_", `\_`)) + ".* TO '" + user + "'@'127.0.0.1'")
}

func (h *harness) grantRuntimeAccount(user, password, target string) {
	h.exec("CREATE USER '" + user + "'@'127.0.0.1' IDENTIFIED BY '" + password + "'")
	h.t.Cleanup(func() { h.root.Exec("DROP USER IF EXISTS '" + user + "'@'127.0.0.1'") })
	h.exec("GRANT SELECT,SHOW VIEW ON " + quote(strings.ReplaceAll(target, "_", `\_`)) + ".* TO '" + user + "'@'127.0.0.1'")
}

func domainTables(final unified.Plan) map[string]map[string]string {
	out := map[string]map[string]string{"aims": {}, "assets": {}}
	for _, t := range final.Tables {
		if t.Name == "enterprise_source_fence" {
			continue
		}
		out[t.Domain][t.Name] = t.Target
	}
	out["aims"]["work_item_deletion_evidence"] = "aims_work_item_deletion_evidence"
	return out
}

func runtimeConfig(p cutoverprofile.Profile, user, password string, enabled bool, tables map[string]map[string]string) map[string]any {
	domains := map[string]any{}
	for domain, mapping := range tables {
		domains[domain] = map[string]any{"ownerDeployment": p.EnterpriseDeployment, "tables": mapping, "read": "unified", "write": "unified", "scheduler": "unified"}
	}
	return map[string]any{
		"tenant": p.Tenant, "deployment": p.RuntimeDeployment,
		"deploymentBindings": map[string]string{"aims": p.SourceDeployments["aims"], "assets": p.SourceDeployments["assets"], "enterprise": p.EnterpriseDeployment},
		"enterprise": map[string]any{"enabled": enabled, "environment": p.Environment, "schemaVersion": p.SchemaVersion, "generation": p.Generation, "instanceId": p.InstanceID,
			"db":      map[string]any{"host": p.Connection.Host, "port": p.Connection.Port, "user": user, "password": password, "database": p.Target, "connectionLimit": 2},
			"domains": domains},
	}
}

func approvalPayload(p cutoverprofile.Profile) map[string]any {
	empty := sha256.Sum256(nil)
	hex64 := func(seed string) string { s := sha256.Sum256([]byte(seed)); return hex.EncodeToString(s[:]) }
	src := p.SourceDeployments
	entries := []map[string]string{}
	for _, id := range []string{"coverage:source:assets", "coverage:receipt:aims", "coverage:receipt:assets", "coverage:unconfigured-provider:finance", "coverage:unconfigured-provider:altoc", "coverage:unconfigured-provider:codocs", "coverage:unconfigured-provider:people", "coverage:unconfigured-provider:console", "coverage:deployed-worker-versions-and-direct-bindings", "coverage:pre-wrapper-inflight-history", "coverage:runtime-direct-callers", "coverage:external-notification-providers", "coverage:scheduled-consumers-and-other-app-outboxes"} {
		entries = append(entries, map[string]string{"id": id, "classification": "automatic"})
	}
	return map[string]any{
		"type": "enterprise-external-drain-approval.v1", "tenant": p.Tenant, "environment": p.Environment, "cutoverKey": p.CutoverKey, "generation": strconv.FormatUint(p.Generation, 10),
		"sealRevision": 1, "sealPayloadSha256": hex64("seal"), "actorUid": "u-approver", "approvalReference": "CHG-SYNTHETIC-1", "requestId": "req-1",
		"actors": []map[string]string{{"app": "aims", "deployment": src["aims"], "artifactSha256": hex64("aims")}, {"app": "assets", "deployment": src["assets"], "artifactSha256": hex64("assets")}},
		"report": map[string]any{
			"binding": map[string]any{"tenant": p.Tenant, "environment": p.Environment, "runtimeDeployment": p.RuntimeDeployment, "instanceId": p.InstanceID,
				"sources":               []map[string]string{{"app": "aims", "schema": p.SourceAims, "deployment": src["aims"]}, {"app": "assets", "schema": p.SourceAssets, "deployment": src["assets"]}},
				"providers":             []map[string]string{{"app": "aims", "schema": p.SourceAims, "deployment": src["aims"]}, {"app": "assets", "schema": p.SourceAssets, "deployment": src["assets"]}},
				"unconfiguredProviders": []string{"finance", "altoc", "codocs", "people", "console"}},
			"probes": []map[string]any{
				{"kind": "source", "app": "aims", "schema": p.SourceAims, "deployment": src["aims"], "count": 0, "hash": hex.EncodeToString(empty[:]), "rows": []any{}},
				{"kind": "source", "app": "assets", "schema": p.SourceAssets, "deployment": src["assets"], "unavailable": "ER_NO_SUCH_TABLE"},
				{"kind": "receipt", "app": "aims", "schema": p.SourceAims, "deployment": src["aims"], "unavailable": "ER_NO_SUCH_TABLE"},
				{"kind": "receipt", "app": "assets", "schema": p.SourceAssets, "deployment": src["assets"], "unavailable": "ER_NO_SUCH_TABLE"},
			},
			"entries": entries,
		},
		"decisions": []any{},
	}
}

func envelope(p cutoverprofile.Profile, key ed25519.PrivateKey, payload map[string]any) cutoverprofile.Envelope {
	raw, _ := json.Marshal(payload)
	return cutoverprofile.Envelope{Payload: string(raw), Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, raw)), Alg: "Ed25519", Kid: p.Platform.KeyID, PublicKey: p.Platform.PublicKey}
}

var reviewPattern = regexp.MustCompile(`review_hash=([0-9a-f]{64})`)

func reviewHash(t *testing.T, out string) string {
	t.Helper()
	m := reviewPattern.FindStringSubmatch(out)
	if m == nil {
		t.Fatalf("no review hash in output:\n%s", out)
	}
	return m[1]
}

// TestProductionProfileCutoverMySQL runs the reviewed protocol for a synthetic
// production tenant through the real CLIs: migrate dry-run -> install-fence ->
// fence -> prepare-final -> final apply -> compatibility views -> signed drain
// activation -> deletion-evidence domain install -> verify-views, with the
// refusals required for production mode.
func TestProductionProfileCutoverMySQL(t *testing.T) {
	h := isolatedHarness(t)
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	aims, assets, target := "hzy_pf_aims_"+tag, "hzy_pf_assets_"+tag, "hzy_pf_target_"+tag
	t.Cleanup(func() {
		for _, schema := range []string{aims, assets, target} {
			h.root.Exec("DROP DATABASE IF EXISTS " + quote(schema))
		}
	})
	h.syntheticSources(aims, assets)
	migUser, rtUser := "hzy_pf_mig_"+tag, "hzy_pf_rt_"+tag
	migPassword, rtPassword := "mig-"+strings.ReplaceAll(uuid.NewString(), "-", ""), "rt-"+strings.ReplaceAll(uuid.NewString(), "-", "")
	h.secrets = []string{migPassword, rtPassword}
	h.grantCutoverAccount(migUser, migPassword, aims, assets, target)
	h.grantRuntimeAccount(rtUser, rtPassword, target)
	platformPublic, platformKey, _ := ed25519.GenerateKey(rand.Reader)
	prof := cutoverprofile.Profile{
		Version: cutoverprofile.Version, Tenant: "T900001", Environment: "prod", RuntimeDeployment: "t900001-prod-tenant-runtime", EnterpriseDeployment: "T900001-prod-enterprise",
		SourceDeployments: map[string]string{"aims": "T900001-prod-aims", "assets": "T900001-prod-assets"},
		InstanceID:        h.instance(), SchemaVersion: "enterprise-prod-v1", Generation: 1, SourceAims: aims, SourceAssets: assets, Target: target, CutoverKey: "t900001-prod-cutover-" + tag,
		Connection: cutoverprofile.Connection{Host: "127.0.0.1", Port: h.port, User: migUser, Password: migPassword},
		Platform:   cutoverprofile.Platform{KeyID: "platform-prod-synthetic", PublicKey: base64.RawURLEncoding.EncodeToString(platformPublic)},
		Runtime:    cutoverprofile.RuntimeService{Listen: "127.0.0.1:9", SystemdUnit: "hzy-tenant-runtime.service", LaunchdLabel: "cn.example.hzy-synthetic-runtime-" + tag},
	}
	profile := h.writeJSON("profile.json", prof)
	source, spec, final := h.path("source-plan.json"), h.path("fence-spec.json"), h.path("final-plan.json")

	// Refusals before any write: unknown environment, root, shared-readable profile.
	bad := prof
	bad.Environment = "staging"
	h.refused("environment must be prod, test or dev", "hzy-enterprise-migrate", "--profile", h.writeJSON("bad-env.json", bad), "--plan", source)
	bad = prof
	bad.Connection.User = "root"
	h.refused("root is refused", "hzy-enterprise-migrate", "--profile", h.writeJSON("bad-root.json", bad), "--plan", source)
	shared := h.writeJSON("shared.json", prof)
	os.Chmod(shared, 0644)
	h.refused("cutover profile rejected", "hzy-enterprise-migrate", "--profile", shared, "--plan", source)

	// 1. Reviewed source plan (dry-run by default).
	out := h.ok("hzy-enterprise-migrate", "--profile", profile, "--plan", source)
	sourceHash := reviewHash(t, out)
	if !strings.Contains(out, "mode=dry-run") || h.readPlan(source).ReviewHash != sourceHash {
		t.Fatal("dry-run did not produce the reviewed source plan", out)
	}
	// 2. install-fence: plan -> refusals -> apply.
	h.ok("hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec)
	h.refused("--apply required", "hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", "install-fence")
	h.refused("exact approved source review hash required", "hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--output", spec, "--phase", "install-fence", "--apply")
	h.refused("exact approved source review hash required", "hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", strings.Repeat("0", 64), "--output", spec, "--phase", "install-fence", "--apply")
	h.refused("differs from the reviewed profile cutover key", "hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", "install-fence", "--apply", "--cutover-key", "other")
	other := prof
	other.Tenant = "T900002"
	h.refused("plan identity differs from profile", "hzy-enterprise-test-cutover", "--profile", h.writeJSON("other-tenant.json", other), "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", "install-fence", "--apply")
	h.ok("hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", "install-fence", "--apply")
	// 3. fence. The restored sources have no live writer; the fence is still
	// installed and committed as protocol evidence.
	h.ok("hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", "fence", "--apply")
	if _, err := h.root.Exec("INSERT INTO " + quote(aims) + ".`time_entries`(id,label) VALUES(9,'late writer')"); err == nil {
		t.Fatal("fenced source accepted a write")
	}
	// 4. prepare-final.
	out = h.ok("hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", sourceHash, "--output", final, "--phase", "prepare-final", "--apply")
	finalHash := reviewHash(t, out)
	finalPlan := h.readPlan(final)
	if finalPlan.ReviewHash != finalHash || finalHash == sourceHash || len(finalPlan.BlockingConflicts) != 0 {
		t.Fatal("final plan not freshly reviewed", out)
	}
	// 5. Final apply: missing/incorrect review refused; exact review copies.
	h.refused("exact reviewed hash required", "hzy-enterprise-migrate", "--profile", profile, "--plan", final, "--apply")
	h.refused("exact reviewed hash required", "hzy-enterprise-migrate", "--profile", profile, "--plan", final, "--apply", "--review-hash", sourceHash)
	h.refused("plan identity differs from profile", "hzy-enterprise-migrate", "--profile", h.writeJSON("other-tenant-2.json", other), "--plan", final, "--apply", "--review-hash", finalHash)
	out = h.ok("hzy-enterprise-migrate", "--profile", profile, "--plan", final, "--apply", "--review-hash", finalHash)
	if !strings.Contains(out, "mode=verified-shadow") {
		t.Fatal(out)
	}
	// Registry cross-tenant: the target now belongs to T900001.
	sameTarget := prof
	sameTarget.Tenant, sameTarget.RuntimeDeployment = "T900002", "t900002-prod-tenant-runtime"
	h.refused("target registry belongs to another tenant", "hzy-enterprise-migrate", "--profile", h.writeJSON("other-registry.json", sameTarget), "--plan", h.path("other-plan.json"))

	// 6. Compatibility views: plan by default, exact combined review to apply.
	tables := domainTables(finalPlan)
	candidate := h.writeJSON("candidate.json", runtimeConfig(prof, rtUser, rtPassword, false, tables))
	artifact := h.path("views-artifact.json")
	out = h.ok("hzy-enterprise-compatibility-rehearsal", "--profile", profile, "--binding-candidate", candidate, "--migration-plan", final, "--artifact", artifact)
	viewsHash := reviewHash(t, out)
	var views int
	if _, err := fmt.Sscanf(out[strings.Index(out, "views="):], "views=%d", &views); err != nil || views == 0 {
		t.Fatal("no compatibility views planned", out)
	}
	h.refused("exact reviewed hash required", "hzy-enterprise-compatibility-rehearsal", "--profile", profile, "--binding-candidate", candidate, "--migration-plan", final, "--artifact", artifact, "--apply")
	h.refused("exact reviewed hash required", "hzy-enterprise-compatibility-rehearsal", "--profile", profile, "--binding-candidate", candidate, "--migration-plan", final, "--artifact", artifact, "--apply", "--review-hash", finalHash)
	h.refused("target ledger is not the verified", "hzy-enterprise-compatibility-rehearsal", "--profile", profile, "--binding-candidate", candidate, "--migration-plan", source, "--artifact", artifact, "--apply", "--review-hash", viewsHash)
	h.ok("hzy-enterprise-compatibility-rehearsal", "--profile", profile, "--binding-candidate", candidate, "--migration-plan", final, "--artifact", artifact, "--apply", "--review-hash", viewsHash)

	// 7. Drain activation requires the pinned Platform issuer signature.
	good := envelope(prof, platformKey, approvalPayload(prof))
	approval := h.writeJSON("approval.json", good)
	drain := func(file string, extra ...string) []string {
		return append([]string{"--profile", profile, "--fence-plan", source, "--final-plan", final, "--approval", file}, extra...)
	}
	unsigned := good
	unsigned.Signature = ""
	h.refused("signature missing or malformed", "hzy-enterprise-drain", drain(h.writeJSON("unsigned.json", unsigned), "--mode", "activate", "--apply", "--review-hash", finalHash)...)
	_, rogueKey, _ := ed25519.GenerateKey(rand.Reader)
	h.refused("signature invalid for pinned issuer", "hzy-enterprise-drain", drain(h.writeJSON("mis-signed.json", envelope(prof, rogueKey, approvalPayload(prof))), "--mode", "activate", "--apply", "--review-hash", finalHash)...)
	selfSigned := envelope(prof, rogueKey, approvalPayload(prof))
	selfSigned.PublicKey = base64.RawURLEncoding.EncodeToString(rogueKey.Public().(ed25519.PublicKey))
	h.refused("embedded public key differs", "hzy-enterprise-drain", drain(h.writeJSON("self-signed.json", selfSigned), "--mode", "activate", "--apply", "--review-hash", finalHash)...)
	wrongKid := good
	wrongKid.Kid = "platform-test"
	h.refused("issuer key id", "hzy-enterprise-drain", drain(h.writeJSON("wrong-kid.json", wrongKid))...)
	crossTenant := approvalPayload(prof)
	crossTenant["tenant"] = "C000001"
	h.refused("tenant/environment/runtime differs from profile", "hzy-enterprise-drain", drain(h.writeJSON("cross-tenant.json", envelope(prof, platformKey, crossTenant)), "--mode", "activate", "--apply", "--review-hash", finalHash)...)
	crossBinding := approvalPayload(prof)
	crossBinding["report"].(map[string]any)["binding"].(map[string]any)["runtimeDeployment"] = "c000001-test-tenant-runtime"
	h.refused("tenant/environment/runtime differs from profile", "hzy-enterprise-drain", drain(h.writeJSON("cross-binding.json", envelope(prof, platformKey, crossBinding)))...)
	out = h.ok("hzy-enterprise-drain", drain(approval)...)
	if !strings.Contains(out, `"externalEvidenceVerified":true`) || !strings.Contains(out, `"applied":false`) {
		t.Fatal(out)
	}
	h.refused("exact reviewed hash required", "hzy-enterprise-drain", drain(approval, "--mode", "activate", "--apply", "--review-hash", sourceHash)...)
	out = h.ok("hzy-enterprise-drain", drain(approval, "--mode", "activate", "--apply", "--review-hash", finalHash)...)
	if !strings.Contains(out, `"applied":true`) || !strings.Contains(out, finalHash) {
		t.Fatal(out)
	}
	replayed := h.ok("hzy-enterprise-drain", drain(approval, "--mode", "activate", "--apply", "--review-hash", finalHash)...)
	if !strings.Contains(replayed, `"replayed":true`) {
		t.Fatal("activation response-loss replay not idempotent", replayed)
	}
	var generation uint64
	if err := h.root.QueryRow("SELECT generation FROM " + quote(target) + ".`enterprise_schema_registry` WHERE id=1").Scan(&generation); err != nil || generation != 1 {
		t.Fatal("target generation not activated", err)
	}

	// 8. Active generation: every forward write is refused.
	h.refused("active generation", "hzy-enterprise-test-cutover", "--profile", profile, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", "install-fence", "--apply")
	h.refused("active generation", "hzy-enterprise-migrate", "--profile", profile, "--plan", final, "--apply", "--review-hash", finalHash)
	h.refused("active generation", "hzy-enterprise-compatibility-rehearsal", "--profile", profile, "--binding-candidate", candidate, "--migration-plan", final, "--artifact", artifact, "--apply", "--review-hash", viewsHash)
	regenerated := prof
	regenerated.Generation = 2
	h.refused("plan identity differs from profile", "hzy-enterprise-drain", "--profile", h.writeJSON("gen2.json", regenerated), "--fence-plan", source, "--final-plan", final, "--approval", approval, "--mode", "activate", "--apply", "--review-hash", finalHash)

	// 9. Aims deletion-evidence domain install: CLI plan, CLI refusals, then the
	// same installer with a test-only stopped proof (this host cannot disable a
	// real Runtime service unit).
	runtimeCfg := runtimeConfig(prof, rtUser, rtPassword, true, tables)
	runtimePath := h.writeJSON("runtime.json", runtimeCfg)
	crossRuntime := runtimeConfig(prof, rtUser, rtPassword, true, tables)
	crossRuntime["tenant"] = "C000001"
	h.refused("Runtime config tenant/deployment/environment differs from profile", "hzy-enterprise-add-altoc", "--profile", profile, "--config", h.writeJSON("runtime-cross.json", crossRuntime), "--plan", h.path("evidence-x.json"), "--work-item-deletion-evidence")
	evidencePlanPath := h.path("evidence-plan.json")
	out = h.ok("hzy-enterprise-add-altoc", "--profile", profile, "--config", runtimePath, "--plan", evidencePlanPath, "--work-item-deletion-evidence")
	evidenceHash := reviewHash(t, strings.Replace(out, "reviewHash=", "review_hash=", 1))
	h.refused("Runtime must be disabled, stopped and not listening", "hzy-enterprise-add-altoc", "--profile", profile, "--config", runtimePath, "--plan", evidencePlanPath, "--work-item-deletion-evidence", "--mode", "apply", "--review-hash", evidenceHash, "--receipt", h.path("evidence-receipt.json"))
	var cfg config.Config
	raw, _ := json.Marshal(runtimeCfg)
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	b, err := cfg.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	var evidencePlan domaininstall.Plan
	raw, _ = os.ReadFile(evidencePlanPath)
	if err := json.Unmarshal(raw, &evidencePlan); err != nil || evidencePlan.ReviewHash != evidenceHash {
		t.Fatal("evidence plan unreadable", err)
	}
	migDB, err := sql.Open("mysql", prof.MySQL(target).FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer migDB.Close()
	installer := domaininstall.ForDeletionEvidence(domaininstall.Expectation{Tenant: prof.Tenant, Environment: prof.Environment, OwnerDeployment: prof.EnterpriseDeployment, Address: prof.Address()})
	if _, err := domaininstall.PlanDeletionEvidence(context.Background(), migDB, b); !errors.Is(err, domaininstall.ErrBoundary) {
		t.Fatal("legacy C000001 installer accepted a production tenant", err)
	}
	fixtureStopped := func(context.Context) error { return nil } // test-only stopped proof
	var receipt domaininstall.Receipt
	if err := installer.Apply(context.Background(), migDB, evidencePlan, fixtureStopped, func(r domaininstall.Receipt) error { receipt = r; return nil }); err != nil {
		t.Fatal("deletion evidence install", err)
	}
	if err := installer.VerifyReceipt(context.Background(), migDB, receipt); err != nil {
		t.Fatal(err)
	}

	// 10. Read-only verification through the Runtime account.
	out = h.ok("hzy-enterprise-verify-views", "--profile", profile, "--config", runtimePath)
	if !strings.Contains(out, fmt.Sprintf("%d/%d views verified", views+1, views+1)) || !strings.Contains(out, ", 0 failed") {
		t.Fatal("verify-views did not cover every installed view", out)
	}
	staleRuntime := runtimeConfig(regenerated, rtUser, rtPassword, true, tables)
	h.refused("Runtime binding identity differs from profile", "hzy-enterprise-verify-views", "--profile", profile, "--config", h.writeJSON("runtime-gen2.json", staleRuntime))

	// Protocol evidence: sources stay fenced, target accepts the new owner's
	// writes and preserves the business trigger.
	var state string
	for _, schema := range []string{aims, assets} {
		if err := h.root.QueryRow("SELECT state FROM " + quote(schema) + ".`enterprise_source_fence` WHERE id=1").Scan(&state); err != nil || state != "fenced" {
			t.Fatal("source fence reopened", schema, state, err)
		}
	}
	h.exec("INSERT INTO " + quote(target) + ".`aims_time_entries`(id,label) VALUES(10,'first unified write')")
	var audit int
	if err := h.root.QueryRow("SELECT COUNT(*) FROM " + quote(target) + ".`aims_time_entry_audit` WHERE id=10").Scan(&audit); err != nil || audit != 1 {
		t.Fatal("business trigger not preserved on the activated target", err)
	}
	h.noSecretsInOutput()
	t.Logf("synthetic prod tenant: source=%s final=%s views=%d+1 generation=1", sourceHash[:12], finalHash[:12], views)
}

// TestLegacyC000001CutoverCLIMySQL proves the fixed C000001/test invocation is
// unchanged: same config shape, same fixed schema names, same phases and the
// same silent success output, and the fixed final-test gate still refuses a
// hash other than the reviewed C000001 constant.
func TestLegacyC000001CutoverCLIMySQL(t *testing.T) {
	h := isolatedHarness(t)
	aims, assets, target := "hzy_aims_test_local_20260910", "hzy_assets_test_local_20260910", "hzy_enterprise_shadow_review_20260913"
	for _, schema := range []string{aims, assets, target} {
		var n int
		if err := h.root.QueryRow("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", schema).Scan(&n); err != nil || n != 0 {
			t.Fatal("isolated instance unexpectedly holds a fixed C000001 schema")
		}
	}
	t.Cleanup(func() {
		for _, schema := range []string{aims, assets, target} {
			h.root.Exec("DROP DATABASE IF EXISTS " + quote(schema))
		}
	})
	for _, schema := range []string{aims, assets} {
		h.exec("CREATE DATABASE " + quote(schema) + " CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
		h.exec("CREATE TABLE " + quote(schema) + ".`facts`(`id` INT PRIMARY KEY,`value` VARCHAR(64)) ENGINE=InnoDB")
		h.exec("INSERT INTO " + quote(schema) + ".`facts` VALUES(1,'legacy')")
	}
	user, password := "hzy_legacy_"+strings.ReplaceAll(uuid.NewString(), "-", "")[:12], strings.ReplaceAll(uuid.NewString(), "-", "")
	h.secrets = []string{password}
	h.exec("CREATE USER '" + user + "'@'127.0.0.1' IDENTIFIED BY '" + password + "'")
	t.Cleanup(func() { h.root.Exec("DROP USER IF EXISTS '" + user + "'@'127.0.0.1'") })
	for _, schema := range []string{aims, assets, target} {
		h.exec("GRANT ALL PRIVILEGES ON " + quote(strings.ReplaceAll(schema, "_", `\_`)) + ".* TO '" + user + "'@'127.0.0.1'")
	}
	legacy := map[string]any{
		"Migration":  unified.Config{Tenant: "C000001", Environment: "test", RuntimeDeployment: "c000001-test-tenant-runtime", InstanceID: h.instance(), SchemaVersion: "v1", Generation: 1, SourceAims: aims, SourceAssets: assets, Target: target},
		"Connection": map[string]any{"Host": "127.0.0.1", "Port": h.port, "User": user, "Password": password},
	}
	cfg := h.writeJSON("legacy.json", legacy)
	source, spec, final := h.path("source.json"), h.path("spec.json"), h.path("final.json")
	h.ok("hzy-enterprise-migrate", "--config", cfg, "--plan", source)
	sourceHash := h.readPlan(source).ReviewHash
	for _, phase := range []string{"plan", "install-fence", "fence"} {
		args := []string{"--config", cfg, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", phase}
		if phase != "plan" {
			args = append(args, "--apply", "--cutover-key", "c000001-cutover-1")
		}
		if out := h.ok("hzy-enterprise-test-cutover", args...); out != "" {
			t.Fatalf("legacy %s output changed: %q", phase, out)
		}
	}
	h.refused("--apply and stable --cutover-key required for write phase", "hzy-enterprise-test-cutover", "--config", cfg, "--source-plan", source, "--source-review-hash", sourceHash, "--output", spec, "--phase", "fence")
	if out := h.ok("hzy-enterprise-test-cutover", "--config", cfg, "--source-plan", source, "--source-review-hash", sourceHash, "--output", final, "--phase", "prepare-final", "--apply", "--cutover-key", "c000001-cutover-1"); out != "" {
		t.Fatalf("legacy prepare-final output changed: %q", out)
	}
	finalPlan := h.readPlan(final)
	out := h.ok("hzy-enterprise-migrate", "--config", cfg, "--plan", final, "--apply", "--review-hash", finalPlan.ReviewHash)
	if !strings.Contains(out, "mode=verified-shadow") || !strings.Contains(out, "Source remains the sole writer.") {
		t.Fatalf("legacy migrate output changed: %q", out)
	}
	// Legacy C000001 fixed final-test gate still refuses any other hash.
	rehearsal := map[string]any{"Migration": legacy["Migration"], "Connection": map[string]any{"Host": "127.0.0.1", "Port": h.port, "User": user, "Password": password}}
	tables := map[string]map[string]string{"aims": {"facts": "aims_facts"}, "assets": {"facts": "assets_facts"}}
	domains := map[string]any{}
	for domain, mapping := range tables {
		domains[domain] = map[string]any{"ownerDeployment": "C000001-test-enterprise", "tables": mapping, "read": "unified", "write": "unified", "scheduler": "unified"}
	}
	candidate := h.writeJSON("legacy-candidate.json", map[string]any{"enterprise": map[string]any{"enabled": false, "schemaVersion": "v1", "generation": 1, "instanceId": h.instance(), "db": map[string]any{"database": target}, "domains": domains}})
	h.refused("approved C000001 final test target, exact migration hash and --apply required", "hzy-enterprise-compatibility-rehearsal", "--config", h.writeJSON("legacy-rehearsal.json", rehearsal), "--binding-candidate", candidate, "--migration-plan", final, "--artifact", h.path("legacy-artifact.json"), "--final-test-target", "--apply")
	// The legacy form still rejects profile-only flags rather than ignoring them.
	h.refused("--review-hash is only used with --profile", "hzy-enterprise-compatibility-rehearsal", "--config", h.writeJSON("legacy-rehearsal-2.json", rehearsal), "--binding-candidate", candidate, "--migration-plan", final, "--artifact", h.path("legacy-artifact-2.json"), "--review-hash", "x")
	var states []string
	for _, schema := range []string{aims, assets} {
		var state string
		if err := h.root.QueryRow("SELECT state FROM " + quote(schema) + ".`enterprise_source_fence` WHERE id=1").Scan(&state); err != nil {
			t.Fatal(err)
		}
		states = append(states, state)
	}
	sort.Strings(states)
	if strings.Join(states, ",") != "fenced,fenced" {
		t.Fatal("legacy fence state", states)
	}
	h.noSecretsInOutput()
}
