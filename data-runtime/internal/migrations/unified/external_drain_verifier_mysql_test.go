package unified

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"github.com/go-sql-driver/mysql"
	runtimeconfig "github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestApprovedExternalEvidenceMySQL(t *testing.T) {
	socket := os.Getenv("HZY_EXTERNAL_EVIDENCE_SOCKET")
	if socket == "" {
		t.Skip("dedicated fixture required")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") {
		t.Fatal("isolated socket required")
	}
	raw, err := os.ReadFile(os.Getenv("HZY_EXTERNAL_EVIDENCE_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct{ Payload, Signature, PublicKey string }
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Report struct {
			Binding struct{ Tenant, Environment, RuntimeDeployment, InstanceID string }
		}
	}
	if err := json.Unmarshal([]byte(envelope.Payload), &wire); err != nil {
		t.Fatal(err)
	}
	signature, err := base64.RawURLEncoding.DecodeString(envelope.Signature)
	if err != nil {
		t.Fatal(err)
	}
	key, err := base64.RawURLEncoding.DecodeString(envelope.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	b := wire.Report.Binding
	spec := FenceSpec{Config: Config{Tenant: b.Tenant, Environment: b.Environment, RuntimeDeployment: b.RuntimeDeployment, InstanceID: b.InstanceID, Generation: 7, SourceAims: "hzy_aims", SourceAssets: "hzy_altoc"}}
	verifier := SQLApprovedExternalDrains{Payload: []byte(envelope.Payload), Signature: signature, PlatformPublicKey: ed25519.PublicKey(key), SourceDeployments: map[string]string{"aims": "C000001-test-aims", "assets": "C000001-test-assets"}}
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.VerifyExternalDrain(ctx, tx, spec, "cutover-1"); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	tx.Rollback()
	forged := verifier
	forged.Payload = append(append([]byte{}, verifier.Payload...), byte(' '))
	tx, _ = db.BeginTx(ctx, nil)
	if _, err := forged.VerifyExternalDrain(ctx, tx, spec, "cutover-1"); err == nil {
		t.Fatal("tampered signed report accepted")
	}
	tx.Rollback()
	tx, _ = db.BeginTx(ctx, nil)
	if _, err := verifier.VerifyExternalDrain(ctx, tx, spec, "other-cutover"); err == nil {
		t.Fatal("wrong cutover accepted")
	}
	tx.Rollback()
	for _, schema := range []string{"hzy_aims", "hzy_altoc"} {
		if _, err := db.Exec("ALTER TABLE " + schema + ".integration_operation ADD PRIMARY KEY(operation_id)"); err != nil {
			t.Fatal(err)
		}
	}
	plan, err := Prepare(ctx, db, Config{Tenant: b.Tenant, Environment: b.Environment, RuntimeDeployment: b.RuntimeDeployment, InstanceID: b.InstanceID, Generation: 7, SchemaVersion: "v1", SourceAims: "hzy_aims", SourceAssets: "hzy_altoc", Target: "hzy_external_cli_target"})
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	writeJSON := func(name string, value any) string {
		path := filepath.Join(directory, name)
		bytes, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, bytes, 0600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	runtime := runtimeconfig.Config{Tenant: b.Tenant, Deployment: b.RuntimeDeployment, DeploymentBindings: verifier.SourceDeployments}
	runtime.Apps.Aims.DB.Database = "hzy_aims"
	runtime.Apps.Assets.DB.Database = "hzy_altoc"
	runtimePath := writeJSON("runtime.json", runtime)
	planPath := writeJSON("plan.json", plan)
	approvalPath := writeJSON("approval.json", map[string]string{"payload": envelope.Payload, "signature": envelope.Signature, "alg": "Ed25519"})
	configPath := writeJSON("config.json", map[string]any{"RuntimeConfigPath": runtimePath, "FencePlanPath": planPath, "FinalPlanPath": planPath, "ApprovalPath": approvalPath, "CutoverKey": "cutover-1", "PinnedPlatformPublicKey": envelope.PublicKey, "Database": map[string]any{"User": "root", "Net": "unix", "Addr": socket}})
	command := exec.CommandContext(ctx, "go", "run", "../../../cmd/hzy-enterprise-drain", "--config", configPath)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatal("actual drain CLI", string(output), err)
	}
	var cliResult struct{ Applied, ExternalEvidenceVerified bool }
	if json.Unmarshal(output, &cliResult) != nil || cliResult.Applied || !cliResult.ExternalEvidenceVerified {
		t.Fatal("CLI default is not verified read-only", string(output))
	}
	block, _ := pem.Decode([]byte(os.Getenv("CUTOVER_TEST_KEY")))
	if block == nil {
		t.Fatal("fixture signing key missing")
	}
	private, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	reseal := func(mutate func(map[string]any)) SQLApprovedExternalDrains {
		var body map[string]any
		if err := json.Unmarshal(verifier.Payload, &body); err != nil {
			t.Fatal(err)
		}
		report := body["report"].(map[string]any)
		entryHashes := map[string]string{}
		for _, raw := range report["entries"].([]any) {
			entry := raw.(map[string]any)
			bytes, _ := json.Marshal(entry)
			sum := sha256.Sum256(bytes)
			entryHashes[entry["id"].(string)] = hex.EncodeToString(sum[:])
		}
		for _, raw := range body["decisions"].([]any) {
			decision := raw.(map[string]any)
			decision["entrySha256"] = entryHashes[decision["entryId"].(string)]
		}
		mutate(body)
		payload, _ := json.Marshal(body)
		copy := verifier
		copy.Payload = payload
		copy.Signature = ed25519.Sign(private.(ed25519.PrivateKey), payload)
		return copy
	}
	validResigned := reseal(func(map[string]any) {})
	tx, _ = db.BeginTx(ctx, nil)
	if _, err := validResigned.VerifyExternalDrain(ctx, tx, spec, "cutover-1"); err != nil {
		tx.Rollback()
		t.Fatal("valid re-encoded signature", err)
	}
	tx.Rollback()
	mutations := map[string]func(map[string]any){
		"empty probes": func(body map[string]any) { body["report"].(map[string]any)["probes"] = []any{} },
		"wrong binding tenant": func(body map[string]any) {
			body["report"].(map[string]any)["binding"].(map[string]any)["tenant"] = "other"
		},
		"wrong source schema": func(body map[string]any) {
			body["report"].(map[string]any)["binding"].(map[string]any)["sources"].([]any)[0].(map[string]any)["schema"] = "other_schema"
		},
		"wrong source deployment": func(body map[string]any) {
			body["report"].(map[string]any)["binding"].(map[string]any)["sources"].([]any)[0].(map[string]any)["deployment"] = "other_deployment"
		},
		"unknown classification": func(body map[string]any) {
			body["report"].(map[string]any)["entries"].([]any)[0].(map[string]any)["classification"] = "trust-me"
		},
		"extra decision": func(body map[string]any) {
			body["decisions"] = append(body["decisions"].([]any), body["decisions"].([]any)[0])
		},
		"wrong entry hash": func(body map[string]any) {
			body["decisions"].([]any)[0].(map[string]any)["entrySha256"] = strings.Repeat("f", 64)
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			bad := reseal(mutate)
			tx, _ := db.BeginTx(ctx, nil)
			defer tx.Rollback()
			if _, err := bad.VerifyExternalDrain(ctx, tx, spec, "cutover-1"); err == nil {
				t.Fatal("signed invalid closure accepted")
			}
		})
	}
	if _, err := db.Exec("UPDATE hzy_people.service_command_receipt SET command_sha256=REPEAT('f',64)"); err != nil {
		t.Fatal(err)
	}
	tx, _ = db.BeginTx(ctx, nil)
	if _, err := verifier.VerifyExternalDrain(ctx, tx, spec, "cutover-1"); err == nil {
		t.Fatal("provider drift accepted")
	}
	tx.Rollback()
	t.Log("actual Platform-signed report rechecked against real source/provider SQL; tamper, wrong cutover and changed receipt rejected")
}
