package unified

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

type isolatedDrains struct{ deny bool }

func (d isolatedDrains) VerifyExternalDrain(context.Context, *sql.Tx, FenceSpec, string) (string, error) {
	if d.deny {
		return "", errors.New("external worker lease still live")
	}
	return strings.Repeat("a", 64), nil
}
func TestSourceFenceMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated local MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-product-center.") && !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.Params = map[string]string{"time_zone": "'+00:00'"}
	mc.Timeout = 5 * time.Second
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(8)
	t.Cleanup(func() { db.Close() })
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	c := Config{Tenant: "fixture", Environment: "test", RuntimeDeployment: "fixture-runtime", SchemaVersion: "v1", Generation: 1, SourceAims: "hzy_ef_aims_" + tag, SourceAssets: "hzy_ef_assets_" + tag, Target: "hzy_ef_target_" + tag}
	if err := db.QueryRow("SELECT @@server_uuid").Scan(&c.InstanceID); err != nil {
		t.Fatal(err)
	}
	for _, schema := range []string{c.SourceAims, c.SourceAssets} {
		if _, err := db.Exec("CREATE DATABASE " + quoted(schema)); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("CREATE TABLE " + qualified(schema, "facts") + "(id INT PRIMARY KEY,value VARCHAR(100)) ENGINE=InnoDB"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec("CREATE TABLE " + qualified(c.SourceAims, "fact_links") + "(id INT PRIMARY KEY,fact_id INT NOT NULL,payload JSON NOT NULL,CONSTRAINT fk_fact_link FOREIGN KEY(fact_id) REFERENCES " + qualified(c.SourceAims, "facts") + "(id)) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE " + qualified(c.SourceAims, "service_command_receipt") + "(id VARCHAR(64) PRIMARY KEY,payload JSON NOT NULL) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, schema := range []string{c.SourceAims, c.SourceAssets, c.Target} {
			if _, err := db.Exec("DROP DATABASE IF EXISTS " + quoted(schema)); err != nil {
				t.Error(err)
			}
		}
	})
	if _, err := db.Exec("CREATE TABLE " + qualified(c.SourceAims, "audit_facts") + "(id INT PRIMARY KEY) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TRIGGER " + qualified(c.SourceAims, "business_audit") + " AFTER INSERT ON " + qualified(c.SourceAims, "facts") + " FOR EACH ROW INSERT INTO " + qualified(c.SourceAims, "audit_facts") + " VALUES(NEW.id)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE " + qualified(c.SourceAims, "integration_operation") + "(id INT PRIMARY KEY,status VARCHAR(32)) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO " + qualified(c.SourceAims, "integration_operation") + " VALUES(1,'processing')"); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	plan, err := Prepare(ctx, db, c)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := BuildFenceSpec(plan)
	if err != nil {
		t.Fatal(err)
	}
	if err := InstallSourceFence(ctx, db, spec); err != nil {
		t.Fatal(err)
	}
	if err := InstallSourceFence(ctx, db, spec); err != nil {
		t.Fatal("install replay", err)
	}
	if err := FenceSources(ctx, db, spec, "cutover-1"); err == nil || !strings.Contains(err.Error(), "outbox not drained") {
		t.Fatal("pending external ACK was fenced", err)
	}
	if _, err := db.Exec("UPDATE " + qualified(c.SourceAims, "integration_operation") + " SET status='succeeded' WHERE id=1"); err != nil {
		t.Fatal("failed fence did not leave legacy drain writable", err)
	}
	missing := guardName("assets", "facts", "DELETE")
	if _, err := db.Exec("DROP TRIGGER " + qualified(c.SourceAssets, missing)); err != nil {
		t.Fatal(err)
	}
	if err := FenceSources(ctx, db, spec, "cutover-1"); err == nil || !strings.Contains(err.Error(), "coverage incomplete") {
		t.Fatal("incomplete guard installation accepted", err)
	}
	if err := InstallSourceFence(ctx, db, spec); err != nil {
		t.Fatal("interrupted guard install did not resume", err)
	}
	old, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	inflight, err := old.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := inflight.ExecContext(ctx, "INSERT INTO "+qualified(c.SourceAims, "facts")+" VALUES(1,'committing before fence')"); err != nil {
		t.Fatal(err)
	}
	// A cancelled coordinator cannot leave one source partially fenced.
	cancelCtx, cancel := context.WithTimeout(ctx, 60*time.Millisecond)
	if err := FenceSources(cancelCtx, db, spec, "cutover-1"); err == nil {
		cancel()
		t.Fatal("blocked fence unexpectedly committed")
	}
	cancel()
	for _, schema := range []string{c.SourceAims, c.SourceAssets} {
		var state string
		if err := db.QueryRow("SELECT state FROM " + qualified(schema, sourceFenceTable) + " WHERE id=1").Scan(&state); err != nil || state != "legacy" {
			t.Fatal("cancelled fence left partial state", err)
		}
	}
	stale, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer stale.Rollback()
	var snapshotCount int
	if err := stale.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qualified(c.SourceAssets, "facts")).Scan(&snapshotCount); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- FenceSources(ctx, db, spec, "cutover-1") }()
	// Verify an actual InnoDB wait, not merely a delay or goroutine intention.
	deadline := time.Now().Add(5 * time.Second)
	waiting := false
	for time.Now().Before(deadline) {
		var n int
		err := db.QueryRow("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON w.BLOCKING_ENGINE_LOCK_ID=l.ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='enterprise_source_fence'", c.SourceAims).Scan(&n)
		if err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			waiting = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !waiting {
		inflight.Rollback()
		select {
		case err := <-done:
			t.Fatal("cutover returned before expected fence wait", err)
		default:
		}
		t.Fatal("cutover did not wait on real in-flight writer")
	}
	if err := inflight.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := stale.ExecContext(ctx, "INSERT INTO "+qualified(c.SourceAssets, "facts")+" VALUES(99,'stale snapshot')"); err == nil {
		stale.Rollback()
		t.Fatal("pre-fence snapshot bypassed current locking read")
	}
	stale.Rollback()
	for _, schema := range []string{c.SourceAims, c.SourceAssets} {
		if _, err := old.ExecContext(ctx, "INSERT INTO "+qualified(schema, "facts")+" VALUES(2,'old pool must fail')"); err == nil {
			t.Fatal("old writer bypassed fence")
		}
	}
	if err := FenceSources(ctx, db, spec, "cutover-1"); err != nil {
		t.Fatal("fence response-loss retry", err)
	}
	if err := FenceSources(ctx, db, spec, "another-key"); err == nil {
		t.Fatal("conflicting cutover accepted")
	}
	final, err := PrepareFinalCopy(ctx, db, spec, "cutover-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db, final, final.ReviewHash); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO " + qualified(c.Target, "aims_facts") + " VALUES(3,'before activation')"); err == nil {
		t.Fatal("target accepted writes before activation")
	}
	if _, err := ActivateFinalCopy(ctx, db, spec, "cutover-1", final, nil); err == nil {
		t.Fatal("activation skipped external drain proof")
	}
	if _, err := ActivateFinalCopy(ctx, db, spec, "cutover-1", final, isolatedDrains{deny: true}); err == nil {
		t.Fatal("live external worker ignored")
	}
	receipt, err := ActivateFinalCopy(ctx, db, spec, "cutover-1", final, isolatedDrains{})
	if err != nil {
		t.Fatal(err)
	}
	targetConfig := mc.Clone()
	targetConfig.DBName = c.Target
	targetDB, err := sql.Open("mysql", targetConfig.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer targetDB.Close()
	observedBinding := enterprise.Binding{Key: enterprise.BindingKey{Tenant: c.Tenant, Environment: c.Environment, RuntimeDeployment: c.RuntimeDeployment}, Storage: enterprise.Storage{InstanceID: c.InstanceID, Address: "127.0.0.1:3306", Database: c.Target}, SchemaVersion: c.SchemaVersion, Generation: c.Generation, Domains: map[string]enterprise.DomainBinding{"aims": {OwnerDeployment: "fixture-worker", Tables: map[string]string{"facts": "aims_facts"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathUnified}}}
	if observed, err := ObserveCommittedActivation(ctx, targetDB, observedBinding, "cutover-1"); err != nil || observed != receipt {
		t.Fatal("committed observation", observed, err)
	}
	if _, err := ObserveCommittedActivation(ctx, targetDB, observedBinding, "forged-cutover"); err == nil {
		t.Fatal("forged activation accepted")
	}
	wrongBinding := observedBinding
	wrongBinding.Generation++
	if _, err := ObserveCommittedActivation(ctx, targetDB, wrongBinding, "cutover-1"); err == nil {
		t.Fatal("wrong generation accepted")
	}
	wrongBinding = observedBinding
	wrongBinding.Key.Tenant = "wrong"
	if _, err := ObserveCommittedActivation(ctx, targetDB, wrongBinding, "cutover-1"); err == nil {
		t.Fatal("wrong tenant accepted")
	}
	if _, err := db.Exec("INSERT INTO " + qualified(c.Target, "aims_facts") + " VALUES(3,'new target fact')"); err != nil {
		t.Fatal("active target write failed", err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM " + qualified(c.Target, "aims_audit_facts") + " WHERE id=3").Scan(&count); err != nil || count != 1 {
		t.Fatal("business trigger not preserved", err)
	}
	recovered, err := ActivateFinalCopy(ctx, db, spec, "cutover-1", final, isolatedDrains{})
	if err != nil || recovered != receipt {
		t.Fatal("committed activation receipt did not recover", err)
	}
	if _, err := old.ExecContext(ctx, "UPDATE "+qualified(c.SourceAims, "facts")+" SET value='stale rollback' WHERE id=1"); err == nil {
		t.Fatal("legacy writer reopened after target activation")
	}
	if _, err = db.Exec("INSERT INTO " + qualified(c.Target, "aims_fact_links") + " VALUES(7,3,JSON_OBJECT('factId',3))"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO " + qualified(c.Target, "aims_service_command_receipt") + " VALUES('external-once',JSON_OBJECT('factId',3))"); err != nil {
		t.Fatal(err)
	}
	recovery := RecoveryPlan{Version: "enterprise-recovery.v1", Final: final, Fence: spec, CutoverKey: "cutover-1", RecoveryKey: "recover-1", AimsTarget: "hzy_recover_aims_" + tag, AssetsTarget: "hzy_recover_assets_" + tag}
	defer db.Exec("DROP DATABASE IF EXISTS " + quoted(recovery.AimsTarget))
	defer db.Exec("DROP DATABASE IF EXISTS " + quoted(recovery.AssetsTarget))
	if _, err = PrepareRecovery(ctx, db, recovery); err == nil {
		t.Fatal("unfrozen recovery accepted")
	}
	if err = FreezeRecoverySource(ctx, db, recovery, nil); err == nil {
		t.Fatal("missing external drain accepted")
	}
	if err = FreezeRecoverySource(ctx, db, recovery, isolatedDrains{deny: true}); err == nil {
		t.Fatal("live external drain accepted")
	}
	if err = FreezeRecoverySource(ctx, db, recovery, isolatedDrains{}); err != nil {
		t.Fatal(err)
	}
	if err = FreezeRecoverySource(ctx, db, recovery, isolatedDrains{}); err != nil {
		t.Fatal("freeze replay", err)
	}
	if _, err = db.Exec("INSERT INTO " + qualified(c.Target, "aims_facts") + " VALUES(4,'must stop')"); err == nil {
		t.Fatal("unified writer did not stop")
	}
	recovery, err = PrepareRecovery(ctx, db, recovery)
	if err != nil {
		t.Fatal(err)
	}
	if err = ApplyRecovery(ctx, db, recovery, "wrong-review"); err == nil {
		t.Fatal("wrong review accepted")
	}
	if err = ApplyRecovery(ctx, db, recovery, recovery.ReviewHash); err != nil {
		t.Fatal(err)
	}
	if err = ApplyRecovery(ctx, db, recovery, recovery.ReviewHash); err != nil {
		t.Fatal("recovery replay", err)
	}
	if err = VerifyRecovery(ctx, db, recovery); err != nil {
		t.Fatal(err)
	}
	var factID int
	if err = db.QueryRow("SELECT fact_id FROM " + qualified(recovery.AimsTarget, "fact_links") + " WHERE id=7 AND JSON_EXTRACT(payload,'$.factId')=3").Scan(&factID); err != nil || factID != 3 {
		t.Fatal("new JSON/PK fact lost", err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM " + qualified(recovery.AimsTarget, "audit_facts") + " WHERE id=3").Scan(&count); err != nil || count != 1 {
		t.Fatal("trigger duplicated effects", err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM " + qualified(recovery.AimsTarget, "service_command_receipt") + " WHERE id='external-once'").Scan(&count); err != nil || count != 1 {
		t.Fatal("receipt lost", err)
	}
	if _, err = db.Exec("INSERT INTO " + qualified(recovery.AimsTarget, "facts") + " VALUES(5,'premature writer')"); err == nil {
		t.Fatal("recovery writer activated")
	}
	if _, err = db.Exec("CREATE TABLE " + qualified(recovery.AssetsTarget, "unreviewed") + "(id INT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	if err = VerifyRecovery(ctx, db, recovery); err == nil {
		t.Fatal("unreviewed recovery table accepted")
	}
	if _, err = db.Exec("DROP TABLE " + qualified(recovery.AssetsTarget, "unreviewed")); err != nil {
		t.Fatal(err)
	}
	activation := RecoveryActivation{Recovery: recovery, ActivationKey: "recover-owner-1", RuntimeDeployment: "recovered-runtime", WorkerClientID: "recovered-worker", WorkerDeployment: "fixture-worker", RouteRevision: "disabled-route-7", Generation: 2}
	ownerUser := "recover_" + tag
	if _, err = db.Exec("CREATE USER '" + ownerUser + "'@'localhost'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec("DROP USER IF EXISTS '" + ownerUser + "'@'localhost'") })
	for _, schema := range []string{recovery.AimsTarget, recovery.AssetsTarget} {
		if _, err = db.Exec("GRANT SELECT,INSERT,UPDATE,DELETE ON " + quoted(schema) + ".* TO '" + ownerUser + "'@'localhost'"); err != nil {
			t.Fatal(err)
		}
	}
	payload, _ := json.Marshal(map[string]any{"type": "enterprise-recovery-route.v1", "revision": 1, "input": map[string]any{"tenantCode": c.Tenant, "environment": c.Environment, "recoveryKey": recovery.RecoveryKey, "recoveryReviewHash": recovery.ReviewHash, "runtimeCode": activation.RuntimeDeployment, "workerClient": activation.WorkerClientID, "workerDeployment": activation.WorkerDeployment, "generation": "2", "aimsSchema": recovery.AimsTarget, "assetsSchema": recovery.AssetsTarget, "instanceId": c.InstanceID, "databaseUser": ownerUser, "databaseHost": "localhost"}})
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	preparationHash := sha256.Sum256(payload)
	activation.RouteRevision = hex.EncodeToString(preparationHash[:])
	ownerVerifier := SQLRecoveryOwnerVerifier{Payload: payload, Signature: ed25519.Sign(private, payload), PlatformPublicKey: public, DatabaseUser: ownerUser, DatabaseHost: "localhost"}
	activation.ReviewHash = RecoveryActivationHash(activation)
	if err = ActivateRecovery(ctx, db, activation, isolatedRecoveryOwner{deny: true}); err == nil {
		t.Fatal("unprepared owner accepted")
	}
	if _, err = db.Exec("INSERT INTO " + qualified(recovery.AimsTarget, "facts") + " VALUES(6,'denied owner')"); err == nil {
		t.Fatal("failed activation opened writer")
	}
	tamperedVerifier := ownerVerifier
	tamperedVerifier.Payload = append(append([]byte{}, payload...), byte(' '))
	if err = ActivateRecovery(ctx, db, activation, tamperedVerifier); err == nil {
		t.Fatal("tampered preparation signature accepted")
	}
	competingUser := "compete_" + tag
	if _, err = db.Exec("CREATE USER '" + competingUser + "'@'localhost'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec("DROP USER IF EXISTS '" + competingUser + "'@'localhost'") })
	if _, err = db.Exec("GRANT SELECT ON " + quoted(recovery.AimsTarget) + ".* TO '" + competingUser + "'@'localhost'"); err != nil {
		t.Fatal(err)
	}
	if err = ActivateRecovery(ctx, db, activation, ownerVerifier); err == nil {
		t.Fatal("competing principal accepted")
	}
	if _, err = db.Exec("DROP USER '" + competingUser + "'@'localhost'"); err != nil {
		t.Fatal(err)
	}
	if err = ActivateRecovery(ctx, db, activation, ownerVerifier); err != nil {
		t.Fatal("activate recovery", err)
	}
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) {
		copy := *mc
		copy.DBName = recovery.AimsTarget
		return sql.Open("mysql", copy.FormatDSN())
	})
	defer registry.Close()
	binding := enterprise.Binding{Key: enterprise.BindingKey{Tenant: c.Tenant, Environment: c.Environment, RuntimeDeployment: activation.RuntimeDeployment}, Storage: enterprise.Storage{InstanceID: c.InstanceID, Address: "127.0.0.1:3306", Database: recovery.AimsTarget}, SchemaVersion: c.SchemaVersion, Generation: activation.Generation, Domains: map[string]enterprise.DomainBinding{"aims": {OwnerDeployment: "fixture-worker", Tables: map[string]string{"facts": "facts"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathUnified}}}
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	request := enterprise.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: "fixture-worker", SchemaVersion: c.SchemaVersion, Generation: 2, Operation: enterprise.Scheduler}
	claimTx, _, err := registry.BeginSchedulerTransaction(ctx, request)
	if err != nil {
		t.Fatal("recovered scheduler guard", err)
	}
	claimTx.Rollback()
	request.Generation = 1
	if wrongTx, _, badErr := registry.BeginSchedulerTransaction(ctx, request); badErr == nil {
		wrongTx.Rollback()
		t.Fatal("old recovery scheduler generation accepted")
	}
	if _, err = db.Exec("INSERT INTO " + qualified(recovery.AimsTarget, "facts") + " VALUES(6,'recovered writer')"); err != nil {
		t.Fatal(err)
	}
	if err = ActivateRecovery(ctx, db, activation, ownerVerifier); err != nil {
		t.Fatal("activation replay", err)
	}
	conflict := activation
	conflict.WorkerClientID = "second-worker"
	conflict.ReviewHash = RecoveryActivationHash(conflict)
	if err = ActivateRecovery(ctx, db, conflict, isolatedRecoveryOwner{}); err == nil {
		t.Fatal("second owner accepted")
	}
	for _, table := range []string{qualified(c.SourceAims, "facts"), qualified(c.Target, "aims_facts")} {
		if _, err = db.Exec("INSERT INTO " + table + " VALUES(8,'old writer')"); err == nil {
			t.Fatal("old authority reopened")
		}
	}
	t.Log("real InnoDB writer wait, dual-schema fence, old pool rejection, final recopy, activation receipt replay and target new facts verified")
}

// Fixture only: production requires persisted grant/drain/route preparation proof.
type isolatedRecoveryOwner struct{ deny bool }

func (v isolatedRecoveryOwner) VerifyRecoveryOwner(context.Context, *sql.Tx, RecoveryActivation) (string, error) {
	if v.deny {
		return "", errors.New("owner preparation incomplete")
	}
	return strings.Repeat("b", 64), nil
}
