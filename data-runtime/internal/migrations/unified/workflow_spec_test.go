package unified

import (
	"context"
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func workflowPlanFixture() Plan {
	p := Plan{Config: Config{Target: "shadow"}}
	for _, name := range append(append([]string{}, workflowSourceTables...), "system_parameters") {
		p.Tables = append(p.Tables, Table{Domain: "workflow", Name: name, Target: "workflow_" + name})
	}
	return p
}
func TestWorkflowClosedMigrationMappingAndForeignKeys(t *testing.T) {
	p := workflowPlanFixture()
	mapping, err := WorkflowMapping(p)
	if err != nil {
		t.Fatal(err)
	}
	if mapping["workflow_system_parameters"] != "workflow_system_parameters" || mapping["system_parameters"] != "" || mapping["service_command_receipt"] != "workflow_service_command_receipt" {
		t.Fatal(mapping)
	}
	table := Table{Domain: "workflow", Source: "source", Name: "flow_tasks", Target: "workflow_flow_tasks", DDL: "CREATE TABLE `flow_tasks` (`id` BIGINT PRIMARY KEY, CONSTRAINT `fk_instance` FOREIGN KEY (`id`) REFERENCES `flow_instances` (`id`)) ENGINE=InnoDB"}
	ddl, err := rewriteDDL(table, p)
	if err != nil || !strings.Contains(ddl, "REFERENCES `shadow`.`workflow_flow_instances`") {
		t.Fatal(ddl, err)
	}
	old := ReviewHash(p)
	p.Tables[0].DDL = "changed"
	if old == ReviewHash(p) {
		t.Fatal("DDL not review bound")
	}
	for _, bad := range []Plan{{Tables: p.Tables[1:]}, {Tables: append(p.Tables, Table{Domain: "workflow", Name: "unreviewed"})}} {
		if _, err := WorkflowMapping(bad); err == nil {
			t.Fatal("unreviewed closure accepted")
		}
	}
	p = workflowPlanFixture()
	p.Tables = p.Tables[:len(p.Tables)-1]
	if _, err := WorkflowMapping(p); err != nil {
		t.Fatal("template parameters optional", err)
	}
}

func TestWorkflowFrozenJSONFamiliesDoNotEnableUnknownFields(t *testing.T) {
	for identity, valid := range valueOnlyJSONFields {
		if !strings.HasPrefix(identity, "workflow.") {
			continue
		}
		for _, bad := range [][]byte{[]byte(`"identity"`), []byte(`12`), []byte(`{broken`)} {
			if valid(bad) {
				t.Fatal(identity, "accepted invalid family")
			}
		}
	}
	if registeredJSONFields["workflow.flow_instances.unknown"] {
		t.Fatal("unreviewed JSON auto accepted")
	}
	if !valueOnlyJSONFields["workflow.flow_instances.flow_snapshot"]([]byte(`{"name":"中文","nodes":[]}`)) {
		t.Fatal("frozen object rejected")
	}
}

func TestWorkflowUnifiedCopyMySQL(t *testing.T) {
	socket := os.Getenv("HZY_AIMS_WORKFLOW_UNIFIED_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.MultiStatements = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	c := Config{Tenant: "isolated", Environment: "test", RuntimeDeployment: "runtime", SchemaVersion: "v1", Generation: 1, SourceAims: "wf_a_" + tag, SourceAssets: "wf_b_" + tag, SourceWorkflow: "wf_w_" + tag, Target: "wf_t_" + tag}
	if err = root.QueryRow("SELECT @@server_uuid").Scan(&c.InstanceID); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{c.SourceAims, c.SourceAssets, c.SourceWorkflow} {
		if _, err = root.Exec("CREATE DATABASE " + quoted(name)); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, name := range []string{c.Target, c.SourceWorkflow, c.SourceAssets, c.SourceAims} {
			root.Exec("DROP DATABASE IF EXISTS " + quoted(name))
		}
	}()
	for _, name := range []string{c.SourceAims, c.SourceAssets} {
		if _, err = root.Exec("CREATE TABLE " + qualified(name, "baseline") + "(id BIGINT PRIMARY KEY,note VARCHAR(30)) ENGINE=InnoDB"); err != nil {
			t.Fatal(err)
		}
		if _, err = root.Exec("INSERT INTO " + qualified(name, "baseline") + " VALUES(1,'unchanged')"); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile("../../../../workflow/docs/workflow_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	// Canonical current schema is a disposable fixture, never a live migration.
	if _, err = root.Exec(strings.ReplaceAll(string(raw), "`hzy_workflow`", quoted(c.SourceWorkflow))); err != nil {
		t.Fatal(err)
	}
	param, err := os.ReadFile("../../../../workflow/docs/template_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = root.Exec("USE " + quoted(c.SourceWorkflow) + ";" + string(param)); err != nil {
		t.Fatal(err)
	}

	// Use a source-specific pool: each statement is executed separately. No USE
	// plus DDL plus INSERT multi-command Exec in the fixture.
	assetsConfig := *mc
	assetsConfig.DBName = c.SourceAssets
	assetsDB, err := sql.Open("mysql", assetsConfig.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer assetsDB.Close()
	if _, err = assetsDB.Exec(string(param)); err != nil {
		t.Fatal(err)
	}
	if _, err = assetsDB.Exec("INSERT INTO system_parameters(param_key,param_value) VALUES('asset-preserved','original-assets')"); err != nil {
		t.Fatal(err)
	}
	if _, err = root.Exec("INSERT INTO " + qualified(c.SourceWorkflow, "system_parameters") + "(param_key,param_value) VALUES('workflow-only','original-workflow')"); err != nil {
		t.Fatal(err)
	}
	p, err := Prepare(context.Background(), root, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.BlockingConflicts) != 0 {
		t.Fatalf("unexpected copy conflicts: %+v", p.BlockingConflicts)
	}
	if err = Apply(context.Background(), root, p, p.ReviewHash); err != nil {
		t.Fatal(err)
	}
	if err = Apply(context.Background(), root, p, p.ReviewHash); err != nil {
		t.Fatal("same-key verified copy", err)
	}
	mapping, err := WorkflowMapping(p)
	if err != nil || mapping["system_parameters"] != "" {
		t.Fatal(mapping, err)
	}
	var count int
	if err = root.QueryRow("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='workflow_system_parameters' AND INDEX_NAME='uk_param_key'", c.Target).Scan(&count); err != nil || count == 0 {
		t.Fatal("parameter unique index lost", err)
	}

	for _, want := range []struct{ schema, table, key, value string }{{c.SourceAssets, "system_parameters", "asset-preserved", "original-assets"}, {c.Target, "assets_system_parameters", "asset-preserved", "original-assets"}, {c.Target, "workflow_system_parameters", "workflow-only", "original-workflow"}} {
		var got string
		if err = root.QueryRow("SELECT param_value FROM "+qualified(want.schema, want.table)+" WHERE param_key=?", want.key).Scan(&got); err != nil || got != want.value {
			t.Fatal("parameter ownership/data changed", err)
		}
	}
	// All table row hashes and FK endpoints were checked by Apply. Existing domains
	// and source are unchanged; wrong hash and activated targets fail closed.
	if err = Apply(context.Background(), root, p, "wrong"); err == nil {
		t.Fatal("wrong review accepted")
	}
	if _, err = root.Exec("UPDATE " + qualified(c.Target, "enterprise_schema_registry") + " SET generation=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if err = Apply(context.Background(), root, p, p.ReviewHash); err == nil {
		t.Fatal("activated target overwritten")
	}
	if _, err = root.Exec("UPDATE " + qualified(c.Target, "enterprise_schema_registry") + " SET generation=0 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err = root.Exec("DROP TABLE " + qualified(c.Target, "workflow_flow_delivery_audit")); err != nil {
		t.Fatal(err)
	}
	if err = Apply(context.Background(), root, p, p.ReviewHash); err == nil {
		t.Fatal("verified target missing table silently repaired")
	}
}

func TestWorkflowDeliverySchemaRejectsPre013014Source(t *testing.T) {
	p := Plan{Tables: []Table{{Domain: "workflow", Name: "flow_callback_logs", Columns: []string{"id", "attempts"}}}}
	if err := validateWorkflowDeliverySchema(p); err == nil {
		t.Fatal("pre-013/014 source accepted")
	}
	p.Tables[0].Columns = append(p.Tables[0].Columns, "version_no", "abandoned_at")
	if err := validateWorkflowDeliverySchema(p); err != nil {
		t.Fatal(err)
	}
}
