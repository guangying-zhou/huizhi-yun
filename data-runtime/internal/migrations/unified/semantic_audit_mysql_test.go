package unified

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestProductMasterConflictReportMySQL(t *testing.T) {
	socket := os.Getenv("HZY_INT202_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires the dedicated INT-202 temporary MySQL harness")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.Timeout = 5 * time.Second
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	c := Config{SourceAims: "int202_aims", SourceAssets: "int202_assets"}
	for _, query := range []string{
		"CREATE DATABASE `int202_aims` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
		"CREATE DATABASE `int202_assets` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
		"CREATE TABLE `int202_aims`.`product_workspaces` (`product_code` varchar(64) COLLATE utf8mb4_bin PRIMARY KEY) ENGINE=InnoDB",
		"CREATE TABLE `int202_assets`.`product_assets` (`id` bigint PRIMARY KEY,`product_code` varchar(64) COLLATE utf8mb4_bin NOT NULL UNIQUE) ENGINE=InnoDB",
		"INSERT INTO `int202_assets`.`product_assets` VALUES (1,'P-001'),(2,'p-001')",
		"INSERT INTO `int202_aims`.`product_workspaces` VALUES ('P-001'),('ORPHAN-RAW-VALUE')",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	issues, err := inspectProductMasterConflicts(ctx, db, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 2 {
		t.Fatalf("issues=%+v", issues)
	}
	for _, issue := range issues {
		if len(issue.KeySHA256) != 64 || strings.Contains(issue.KeySHA256, "ORPHAN") || issue.RowCount == 0 {
			t.Fatalf("unsafe report: %+v", issue)
		}
	}
	for _, query := range []string{
		"CREATE TABLE `int202_aims`.`product_requests` (`biz_id` char(36) COLLATE ascii_bin PRIMARY KEY) ENGINE=InnoDB",
		"CREATE TABLE `int202_aims`.`product_document_creation_requests` (`biz_id` char(36) COLLATE ascii_bin PRIMARY KEY) ENGINE=InnoDB",
		"CREATE TABLE `int202_aims`.`product_activity_logs` (`id` bigint PRIMARY KEY,`object_type` varchar(64),`object_id` varchar(191),`revision` bigint unsigned) ENGINE=InnoDB",
		"CREATE TABLE `int202_aims`.`integration_operation` (`operation_id` varchar(36) PRIMARY KEY,`operation_key` varchar(191),`correlation_key` varchar(191),`depends_on_operation_key` varchar(191),`tenant_code` varchar(100),`deployment_code` varchar(100),`source_app` varchar(50),`source_biz_type` varchar(100),`source_biz_code` varchar(191),`operation_code` varchar(191),`command_schema_version` varchar(30),`command_json` text,`attempt_count` int unsigned DEFAULT 0,`fencing_token` bigint unsigned DEFAULT 0,`version_no` bigint unsigned DEFAULT 1) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`product_requests` VALUES ('11111111-1111-1111-1111-111111111111')",
		"INSERT INTO `int202_aims`.`integration_operation` (operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,source_biz_type,source_biz_code,operation_code,command_schema_version,command_json,attempt_count,fencing_token,version_no) VALUES ('op-invalid','k1','c1','t','d','aims','product_request','11111111-1111-1111-1111-111111111111','aims.altoc.product-feedback.update-status.v1','product-feedback-status.v1','{',1,1,1),('op-schema','k2','c2','t','d','aims','product_request','11111111-1111-1111-1111-111111111111','aims.altoc.product-feedback.update-status.v1','future.v9','{}',1,1,1),('op-source','k3','c3','t','d','aims','product_request','22222222-2222-2222-2222-222222222222','aims.altoc.product-feedback.update-status.v1','product-feedback-status.v1',JSON_OBJECT('requestBizId','22222222-2222-2222-2222-222222222222'),1,1,1),('op-json-ref','k4','c4','t','d','aims','product_request','11111111-1111-1111-1111-111111111111','aims.altoc.product-feedback.update-progress.v1','product-feedback-progress.v1',JSON_OBJECT('requestBizId','33333333-3333-3333-3333-333333333333'),1,1,1)",
		"INSERT INTO `int202_aims`.`product_activity_logs` VALUES (1,'request','R-PRIVATE',4),(2,'request','R-PRIVATE',3)",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	issues, err = inspectProductMasterConflicts(ctx, db, c)
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) != 7 {
		t.Fatalf("all semantic conflicts not reported: %+v", issues)
	}
	wantKinds := map[string]bool{"planning_command_invalid_json": false, "planning_command_unknown_schema": false, "planning_command_missing_source_reference": false, "planning_command_missing_json_reference": false, "product_activity_revision_regression": false}
	for _, issue := range issues {
		if _, ok := wantKinds[issue.Kind]; ok {
			wantKinds[issue.Kind] = true
		}
	}
	for kind, seen := range wantKinds {
		if !seen {
			t.Fatalf("missing %s: %+v", kind, issues)
		}
	}
	for _, query := range []string{
		"CREATE TABLE `int202_aims`.`product_versions` (`id` bigint PRIMARY KEY,`revision` bigint unsigned,`scope_revision` bigint unsigned) ENGINE=InnoDB",
		"CREATE TABLE `int202_aims`.`product_version_plan_confirmations` (`id` bigint PRIMARY KEY,`version_id` bigint,`plan_revision` bigint unsigned,`scope_revision` bigint unsigned) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`product_versions` VALUES (1,2,2)",
		"INSERT INTO `int202_aims`.`product_version_plan_confirmations` VALUES (9,1,3,2)",
		"CREATE TABLE `int202_aims`.`product_planning_items` (`id` bigint PRIMARY KEY,`revision` bigint unsigned) ENGINE=InnoDB",
		"CREATE TABLE `int202_aims`.`product_request_delivery_links` (`id` bigint PRIMARY KEY,`planning_item_id` bigint,`source_revision` bigint unsigned) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`product_planning_items` VALUES (1,3)",
		"INSERT INTO `int202_aims`.`product_request_delivery_links` VALUES (1,1,4)",
		"CREATE TABLE `int202_aims`.`service_command_receipt` (`receipt_id` varchar(36) PRIMARY KEY,`tenant_code` varchar(100) DEFAULT 't',`deployment_code` varchar(100) DEFAULT 'd',`source_app` varchar(50) DEFAULT 'source',`target_app` varchar(50) DEFAULT 'aims',`source_deployment_code` varchar(100),`operation_code` varchar(191),`idempotency_key` varchar(191),`original_actor_uid` varchar(64),`command_sha256` char(64),`status` varchar(32),`target_biz_type` varchar(100),`target_biz_code` varchar(191),`response_summary_sha256` char(64)) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`service_command_receipt` (receipt_id,source_deployment_code,operation_code,idempotency_key,command_sha256,status,target_biz_type,target_biz_code,response_summary_sha256) VALUES ('r1','d','op','same',REPEAT('a',64),'succeeded','product',NULL,REPEAT('a',64)),('r2','d','op','same',REPEAT('b',64),'failed',NULL,NULL,NULL)",
		"CREATE TABLE `int202_aims`.`integration_operation_attempt` (`attempt_id` varchar(36) PRIMARY KEY,`operation_id` varchar(36),`attempt_no` int unsigned,`fencing_token` bigint unsigned,`result_status` varchar(32),`finished_at` datetime(3)) ENGINE=InnoDB",
		"CREATE TABLE `int202_aims`.`integration_operation_dead_letter_actionable` (`operation_id` varchar(36),`generation_no` int,`source_operation_version` bigint unsigned,`attempt_count` int unsigned,PRIMARY KEY(operation_id,generation_no)) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`integration_operation_attempt` VALUES ('attempt-orphan','missing',2,2,'future-state',NULL)",
		"INSERT INTO `int202_aims`.`integration_operation_attempt` VALUES ('sequence-success','op-invalid',1,1,'succeeded',UTC_TIMESTAMP(3)),('sequence-after-success','op-invalid',2,1,'processing',UTC_TIMESTAMP(3)),('sequence-processing-before-last','op-source',1,1,'processing',NULL),('sequence-terminal-unfinished','op-source',2,2,'retry_wait',NULL)",
		"INSERT INTO `int202_aims`.`integration_operation_dead_letter_actionable` VALUES ('missing',1,2,2)",
		"UPDATE `int202_aims`.`integration_operation` SET depends_on_operation_key='missing-parent' WHERE operation_id='op-schema'",
		"INSERT INTO `int202_aims`.`service_command_receipt` (receipt_id,operation_code,status,target_biz_type,target_biz_code,response_summary_sha256) VALUES ('r3','altoc.aims.product-request.create-from-feedback.v1','succeeded','product_request','44444444-4444-4444-4444-444444444444',REPEAT('a',64))",
		"CREATE TABLE `int202_aims`.`product_catalog_refreshes` (`id` bigint PRIMARY KEY,`source_watermark` varchar(191)) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`product_catalog_refreshes` VALUES (1,'future-opaque-watermark')",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	issues, err = inspectProductMasterConflicts(ctx, db, c)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"planning_snapshot_revision_ahead", "delivery_consumed_watermark_ahead", "receipt_identity_hash_conflict", "receipt_target_evidence_incomplete", "outbox_parent_reference_invalid", "outbox_attempt_sequence_invalid", "outbox_dead_letter_reference_invalid", "receipt_target_contract_unknown", "receipt_target_object_missing", "outbox_attempt_state_sequence_unknown", "catalog_watermark_contract_unknown"} {
		seen := false
		for _, issue := range issues {
			if issue.Kind == kind {
				seen = true
			}
		}
		if !seen {
			t.Fatalf("missing %s: %+v", kind, issues)
		}
	}
	p := Plan{Version: "enterprise-shadow-copy.v1", Config: Config{Tenant: "t", Environment: "test", RuntimeDeployment: "r", InstanceID: "i", SchemaVersion: "v1", Generation: 1, SourceAims: c.SourceAims, SourceAssets: c.SourceAssets, Target: "int202_target"}, BlockingConflicts: issues}
	for _, query := range []string{
		"CREATE TABLE `int202_aims`.`aims_projects` (id bigint PRIMARY KEY,project_code varchar(64)) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`aims_projects` VALUES (1,'PROJECT-1'),(2,'PROJECT-2')",
		"CREATE TABLE `int202_aims`.`project_activity_logs` (id bigint PRIMARY KEY,project_id bigint,object_type varchar(32),object_code varchar(128),action varchar(32),actor_uid varchar(64),changes JSON,request_id varchar(191)) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`service_command_receipt` (receipt_id,operation_code,idempotency_key,original_actor_uid,status,target_biz_type,target_biz_code,response_summary_sha256) VALUES ('remove-good','enterprise.aims.project-members.remove.v1','key-good','manager','succeeded','project_member','1:u1',REPEAT('a',64)),('remove-no-audit','enterprise.aims.project-members.remove.v1','key-missing','manager','succeeded','project_member','1:u2',REPEAT('a',64)),('remove-wrong-project','enterprise.aims.project-members.remove.v1','key-project','manager','succeeded','project_member','1:u3',REPEAT('a',64)),('remove-wrong-actor','enterprise.aims.project-members.remove.v1','key-actor','manager','succeeded','project_member','1:u4',REPEAT('a',64))",
		"INSERT INTO `int202_aims`.`project_activity_logs` VALUES (1,1,'member','u1','remove','manager',JSON_OBJECT('projectId',1,'uid','u1','action','remove'),'key-good'),(2,2,'member','u3','remove','manager',JSON_OBJECT('projectId',2,'uid','u3','action','remove'),'key-project'),(3,1,'member','u4','remove','other-manager',JSON_OBJECT('projectId',1,'uid','u4','action','remove'),'key-actor')",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	removals, err := inspectReceiptTargets(ctx, db, "aims", c.SourceAims)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"remove-good", "remove-no-audit", "remove-wrong-project", "remove-wrong-actor"} {
		found := false
		for _, issue := range removals {
			if issue.KeySHA256 == redactedBusinessKey(issue.Kind, id) {
				found = true
			}
		}
		if found == (id == "remove-good") {
			t.Fatalf("incorrect deletion audit acceptance for %s: %+v", id, removals)
		}
	}
	issues, err = inspectProductMasterConflicts(ctx, db, c)
	if err != nil {
		t.Fatal(err)
	}
	auditConflict := false
	for _, issue := range issues {
		if issue.Kind == "project_audit_event_invalid" {
			auditConflict = true
		}
	}
	if !auditConflict {
		t.Fatal("wrong audit references accepted")
	}
	p.BlockingConflicts = issues
	if _, err = db.ExecContext(ctx, "CREATE TABLE `int202_aims`.`unregistered_snapshot` (id bigint PRIMARY KEY,snapshot JSON) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO `int202_aims`.`unregistered_snapshot` VALUES (1,JSON_OBJECT('privateReference','DO-NOT-REPORT'))"); err != nil {
		t.Fatal(err)
	}
	unknown, err := inspectUnregisteredJSON(ctx, db, []Table{{Domain: "aims", Source: c.SourceAims, Name: "unregistered_snapshot"}, {Domain: "aims", Source: c.SourceAims, Name: "project_activity_logs"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(unknown) != 1 || unknown[0].Kind != "json_field_contract_unregistered" || unknown[0].RowCount != 1 {
		t.Fatalf("unregistered JSON not blocked: %+v", unknown)
	}
	p.BlockingConflicts = append(p.BlockingConflicts, unknown...)
	if _, err = db.ExecContext(ctx, "INSERT INTO `int202_aims`.`integration_operation` (operation_id,source_app,source_biz_type,command_json) VALUES ('unknown-family','aims','unregistered-family','{}')"); err != nil {
		t.Fatal(err)
	}
	families, err := inspectPlanningJSONAndRevisions(ctx, db, c)
	if err != nil {
		t.Fatal(err)
	}
	foundUnknown := false
	for _, issue := range families {
		if issue.Kind == "planning_command_family_unregistered" {
			foundUnknown = true
		}
	}
	if !foundUnknown {
		t.Fatal("unknown planning command family ignored")
	}
	for _, query := range []string{
		"ALTER TABLE `int202_aims`.`product_workspaces` ADD revision bigint unsigned DEFAULT 3",
		"ALTER TABLE `int202_aims`.`product_versions` ADD product_code varchar(64),ADD version_code varchar(64)",
		"INSERT INTO `int202_aims`.`product_versions` VALUES (2,1,1,'P-001','v1')",
		"ALTER TABLE `int202_aims`.`product_activity_logs` ADD product_code varchar(64),ADD action varchar(64),ADD actor_uid varchar(64),ADD request_id varchar(191),ADD changes JSON",
		"CREATE TABLE `int202_aims`.`product_command_receipts` (id bigint PRIMARY KEY,product_code varchar(64),action varchar(64),actor_uid varchar(64),idempotency_key varchar(191),request_hash char(64),status varchar(32),result_json JSON) ENGINE=InnoDB",
		"INSERT INTO `int202_aims`.`product_command_receipts` VALUES (1,'P-001','product_versions:create','pm','v-create',REPEAT('a',64),'succeeded',JSON_OBJECT('id',2,'product_code','P-001','version_code','v1','name',NULL,'description',NULL,'planned_release_date',NULL,'planning_mode','simple','status','planning','revision',1,'scope_revision',1,'workspace_revision',3,'owner_project_id',NULL))",
		"INSERT INTO `int202_aims`.`product_command_receipts` SELECT 2,product_code,action,actor_uid,'bad-schema',request_hash,status,JSON_SET(result_json,'$.schemaVersion','future.v9') FROM `int202_aims`.`product_command_receipts` WHERE id=1",
		"INSERT INTO `int202_aims`.`product_command_receipts` SELECT 3,product_code,action,actor_uid,'bad-reference',request_hash,status,JSON_SET(result_json,'$.id',99) FROM `int202_aims`.`product_command_receipts` WHERE id=1",
		"INSERT INTO `int202_aims`.`product_activity_logs` (id,object_type,object_id,revision,product_code,action,actor_uid,request_id,changes) SELECT 10,'version','2',1,product_code,'create',actor_uid,idempotency_key,result_json FROM `int202_aims`.`product_command_receipts` WHERE id=1",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	versionContracts, err := inspectVersionCreateJSON(ctx, db, c.SourceAims)
	if err != nil {
		t.Fatal(err)
	}
	if len(versionContracts) != 2 {
		t.Fatalf("valid version create result/audit blocked or bad schema/reference accepted: %+v", versionContracts)
	}
	for _, issue := range versionContracts {
		if issue.Source != "aims.product_command_receipts" {
			t.Fatalf("valid audit blocked: %+v", issue)
		}
	}
	registered, err := inspectUnregisteredJSON(ctx, db, []Table{{Domain: "aims", Source: c.SourceAims, Name: "product_command_receipts"}, {Domain: "aims", Source: c.SourceAims, Name: "product_activity_logs"}})
	if err != nil || len(registered) != 0 {
		t.Fatalf("specific contract still blocked as unregistered: %+v %v", registered, err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE `int202_aims`.`product_activity_logs` SET changes=JSON_SET(changes,'$.id',99) WHERE id=10"); err != nil {
		t.Fatal(err)
	}
	versionContracts, err = inspectVersionCreateJSON(ctx, db, c.SourceAims)
	if err != nil || len(versionContracts) != 3 {
		t.Fatalf("audit snapshot mismatch not blocked: %+v %v", versionContracts, err)
	}
	verifyVersionMutationContracts(t, db, c.SourceAims)
	verifyVersionLifecycleContracts(t, db, c.SourceAims)
	verifyAcceptancePublishSnapshots(t, db, c.SourceAims)
	verifyPlanConfirmationSnapshots(t, db, c.SourceAims)
	verifyPlanCommandContracts(t, db, c.SourceAims)
	verifyScopeCommandContracts(t, db, c.SourceAims)
	verifyFrozenAcceptanceHistory(t, db, c.SourceAims)
	verifyConsumptionWriterContracts(t, db)
	p.ReviewHash = ReviewHash(p)
	if err = Apply(ctx, db, p, p.ReviewHash); err == nil || !strings.Contains(err.Error(), "unresolved blocking conflicts") {
		t.Fatalf("apply did not fail closed: %v", err)
	}
}
