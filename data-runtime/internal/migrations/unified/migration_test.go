package unified

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestReviewAndMappingCannotBeSilentlyChanged(t *testing.T) {
	c := Config{Tenant: "t", Environment: "test", RuntimeDeployment: "r", InstanceID: "i", SchemaVersion: "v1", Generation: 1, SourceAims: "source_aims", SourceAssets: "source_assets", Target: "target"}
	p := Plan{Config: c, Tables: []Table{{Domain: "aims", Name: "parent", Target: "aims_parent"}, {Domain: "aims", Source: c.SourceAims, Name: "child", Target: "aims_child", DDL: "CREATE TABLE `child` (`id` int,CONSTRAINT `fk_parent` FOREIGN KEY (`id`) REFERENCES `parent` (`id`)) ENGINE=InnoDB"}}}
	ddl, err := rewriteDDL(p.Tables[1], p)
	if err != nil || !strings.Contains(ddl, "REFERENCES `target`.`aims_parent`") {
		t.Fatal(ddl, err)
	}
	hash := ReviewHash(p)
	p.Tables[0].Target = "different"
	if ReviewHash(p) == hash {
		t.Fatal("changed plan kept review hash")
	}
	if err := Apply(context.Background(), nil, p, "wrong"); err == nil {
		t.Fatal("invalid review accepted")
	}
	bad := p.Tables[1]
	bad.DDL = strings.ReplaceAll(bad.DDL, "`parent`", "`missing`")
	if _, err := rewriteDDL(bad, p); err == nil {
		t.Fatal("unmapped dependency accepted")
	}
}

func TestFullProductChainShadowMigrationMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_TEST_SOCKET")
	sourcePlan := os.Getenv("HZY_ENTERPRISE_SCHEMA_PLAN")
	if socket == "" || sourcePlan == "" {
		t.Skip("requires isolated socket and a reviewed full Aims/Assets schema plan")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-product-center.") {
		t.Fatal("refusing non-isolated socket")
	}
	raw, err := os.ReadFile(sourcePlan)
	if err != nil {
		t.Fatal(err)
	}
	var schema Plan
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatal(err)
	}
	if len(schema.Tables) < 147 {
		t.Fatal("full product chain fixture must include the current 113+34 source table closure")
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
	db.SetMaxOpenConns(4)
	t.Cleanup(func() { db.Close() })
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	c := Config{Tenant: "isolated", Environment: "test", RuntimeDeployment: "isolated-runtime", SchemaVersion: "v1", Generation: 1, SourceAims: "hzy_em_aims_" + tag, SourceAssets: "hzy_em_assets_" + tag, Target: "hzy_em_target_" + tag}
	if err := db.QueryRow("SELECT @@server_uuid").Scan(&c.InstanceID); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, name := range []string{c.SourceAims, c.SourceAssets} {
		if _, err := db.Exec("CREATE DATABASE " + quoted(name)); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, name := range []string{c.Target, "hzy_em_final_" + tag, c.SourceAims, c.SourceAssets} {
			if _, err := db.Exec("DROP DATABASE IF EXISTS " + quoted(name)); err != nil {
				t.Error(err)
			}
		}
	})
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.ExecContext(ctx, "SET foreign_key_checks=0"); err != nil {
		t.Fatal(err)
	}
	for _, domain := range []string{"aims", "assets"} {
		dest := c.SourceAims
		if domain == "assets" {
			dest = c.SourceAssets
		}
		if _, err := conn.ExecContext(ctx, "USE "+quoted(dest)); err != nil {
			t.Fatal(err)
		}
		for _, table := range schema.Tables {
			if table.Domain == domain {
				if _, err := conn.ExecContext(ctx, table.DDL); err != nil {
					t.Fatalf("load %s.%s: %v", domain, table.Name, err)
				}
			}
		}
		for _, table := range schema.Tables {
			if table.Domain == domain {
				for _, tr := range table.Triggers {
					if _, err := conn.ExecContext(ctx, "CREATE TRIGGER "+quoted(tr.Name)+" "+tr.Timing+" "+tr.Event+" ON "+quoted(table.Name)+" FOR EACH ROW "+tr.Statement); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
	}
	if _, err := conn.ExecContext(ctx, "SET foreign_key_checks=1"); err != nil {
		t.Fatal(err)
	}
	conn.Close()
	// Synthetic stable IDs, receipt identity and JSON references, never business rows.
	for _, query := range []string{
		"INSERT INTO " + qualified(c.SourceAssets, "assets_product_catalog_state") + "(id,epoch,revision,ready) VALUES(1,'11111111-1111-1111-1111-111111111111',1,1)",
		"INSERT INTO " + qualified(c.SourceAssets, "product_assets") + "(id,product_code,product_name,product_line,customer_domain,business_domain) VALUES(501,'P1','Synthetic product','L1','test','test')",
		"INSERT INTO " + qualified(c.SourceAims, "product_workspaces") + "(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P1','11111111-1111-1111-1111-111111111111','actor','actor',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
		"INSERT INTO " + qualified(c.SourceAims, "product_command_receipts") + "(id,product_code,action,actor_uid,idempotency_key,execution_id,request_hash,status,result_json,created_at) VALUES(701,'P1','create','actor','stable-command','22222222-2222-2222-2222-222222222222',REPEAT('a',64),'succeeded',JSON_OBJECT('productId',501,'productCode','P1'),UTC_TIMESTAMP(3))",
	} {
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 280; i++ {
		if _, err := db.Exec("INSERT INTO "+qualified(c.SourceAssets, "product_assets")+"(id,product_code,product_name,product_line,customer_domain,business_domain) VALUES(?,?,?,?,?,?)", 2000+i, fmt.Sprintf("P-%03d", i), "Synthetic batch", "L1", "test", "test"); err != nil {
			t.Fatal(err)
		}
	}
	p, err := Prepare(ctx, db, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Tables) != len(schema.Tables) {
		t.Fatal("table closure shrank")
	}
	var targetExists int
	if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", c.Target).Scan(&targetExists); err != nil || targetExists != 0 {
		t.Fatal("dry-run created target", err)
	}
	if err := Apply(ctx, db, p, "not-approved"); err == nil {
		t.Fatal("apply without exact review accepted")
	}
	if _, err := db.Exec("CREATE DATABASE " + quoted(c.Target)); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db, p, p.ReviewHash); err == nil || !strings.Contains(err.Error(), "not owned") {
		t.Fatal("unowned existing target accepted", err)
	}
	if _, err := db.Exec("DROP DATABASE " + quoted(c.Target)); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db, p, p.ReviewHash); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db, p, p.ReviewHash); err != nil {
		t.Fatal("verified replay failed", err)
	}
	// Reconstruct the durable state of an interrupted copy: committed prefix,
	// copying checkpoint, no post-copy triggers. Resume restarts only that table.
	for _, table := range p.Tables {
		for _, tr := range table.Triggers {
			if _, err := db.Exec("DROP TRIGGER " + qualified(c.Target, stableName(table.Domain, tr.Name))); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := db.Exec("DELETE FROM " + qualified(c.Target, "assets_product_assets") + " WHERE id>=2100"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE " + qualified(c.Target, "enterprise_migration_checkpoint") + " SET status='copying',copied_rows=101 WHERE target_table='assets_product_assets'"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE " + qualified(c.Target, "enterprise_migration_ledger") + " SET status='copying' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db, p, p.ReviewHash); err != nil {
		t.Fatal("interrupted checkpoint recovery failed", err)
	}
	var generation int
	if err := db.QueryRow("SELECT generation FROM " + qualified(c.Target, "enterprise_schema_registry")).Scan(&generation); err != nil || generation != 0 {
		t.Fatal("shadow became writable", err)
	}
	var id int
	var receipt string
	if err := db.QueryRow("SELECT id,idempotency_key FROM "+qualified(c.Target, "aims_product_command_receipts")).Scan(&id, &receipt); err != nil || id != 701 || receipt != "stable-command" {
		t.Fatal("receipt identity lost", err)
	}
	// Reinstalled triggers must touch only the target watermark.
	var before, after uint64
	if err := db.QueryRow("SELECT revision FROM " + qualified(c.SourceAssets, "assets_product_catalog_state")).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE " + qualified(c.Target, "assets_product_assets") + " SET product_name='target only' WHERE id=501"); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT revision FROM " + qualified(c.SourceAssets, "assets_product_catalog_state")).Scan(&after); err != nil || before != after {
		t.Fatal("target trigger modified source", err)
	}
	if err := Apply(ctx, db, p, p.ReviewHash); err == nil || !strings.Contains(err.Error(), "target count/hash mismatch") {
		t.Fatal("target drift was ignored", err)
	}
	if _, err := db.Exec("UPDATE " + qualified(c.Target, "enterprise_schema_registry") + " SET generation=1"); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db, p, p.ReviewHash); err == nil || !strings.Contains(err.Error(), "target is active") {
		t.Fatal("active target accepted", err)
	}
	if _, err := db.Exec("UPDATE " + qualified(c.SourceAssets, "product_assets") + " SET product_name='source moved' WHERE id=501"); err != nil {
		t.Fatal(err)
	}
	if err := Apply(ctx, db, p, p.ReviewHash); err == nil || !strings.Contains(err.Error(), "source schema/content changed") {
		t.Fatal("source drift ignored", err)
	}

	// Extend the actual 147-table closure through guarded final recopy and
	// activation, not just the small concurrency fixture.
	finalConfig := c
	finalConfig.Target = "hzy_em_final_" + tag
	beforeFence, err := Prepare(ctx, db, finalConfig)
	if err != nil {
		t.Fatal(err)
	}
	fence, err := BuildFenceSpec(beforeFence)
	if err != nil {
		t.Fatal(err)
	}
	if err := InstallSourceFence(ctx, db, fence); err != nil {
		t.Fatal("full closure guard installation", err)
	}
	if err := FenceSources(ctx, db, fence, "full-cutover"); err != nil {
		t.Fatal(err)
	}
	finalPlan, err := PrepareFinalCopy(ctx, db, fence, "full-cutover")
	if err != nil {
		t.Fatal(err)
	}
	if len(finalPlan.Tables) != len(p.Tables)+2 {
		t.Fatal("final copy omitted source fence ledgers")
	}
	if err := Apply(ctx, db, finalPlan, finalPlan.ReviewHash); err != nil {
		t.Fatal("full guarded final copy", err)
	}
	if _, err := ActivateFinalCopy(ctx, db, fence, "full-cutover", finalPlan, isolatedDrains{}); err != nil {
		t.Fatal("full closure activation", err)
	}
	if _, err := db.Exec("UPDATE " + qualified(finalConfig.Target, "assets_product_assets") + " SET product_name='final new fact' WHERE id=501"); err != nil {
		t.Fatal("final target cannot write", err)
	}
	if _, err := db.Exec("UPDATE " + qualified(c.SourceAssets, "product_assets") + " SET product_name='old writer' WHERE id=501"); err == nil {
		t.Fatal("full closure source reopened")
	}
	t.Logf("full closure: %d business tables plus two fence ledgers; initial shadow generation=0, guarded final copy activated", len(p.Tables))
}
