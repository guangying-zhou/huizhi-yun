package unified

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/jsoncontract"
)

// The eleven columns reported by the S3 rehearsal (docs/Enterprise-JSON-Contract-Gap-Inventory.md).
var jsonContractGapIdentities = []string{
	"aims.aims_projects.access_whitelist",
	"aims.aims_projects.module_config",
	"aims.approval_records.snapshot_json",
	"aims.deliverable_quality_reviews.checklist_result_json",
	"aims.deliverable_submissions.evidence_snapshot_json",
	"aims.project_template_versions.definition_json",
	"aims.qa_checklist_versions.items_json",
	"assets.asset_events.event_data",
	"assets.asset_items.tags",
	"assets.product_assets.customer_domain",
	"assets.purchase_orders.attachments",
}

func TestJSONContractGapColumnsAreRegisteredWithExecutableValidators(t *testing.T) {
	for _, identity := range jsonContractGapIdentities {
		if !registeredJSONFields[identity] {
			t.Errorf("%s is not registered", identity)
		}
		if valid := valueOnlyJSONFields[identity]; valid == nil {
			t.Errorf("%s has no executable validator", identity)
		} else if valid(json.RawMessage(`{"unexpected":"shape"}`)) && valid(json.RawMessage(`[{"unexpected":"shape"}]`)) && valid(json.RawMessage(`"x"`)) {
			t.Errorf("%s validator accepts arbitrary payloads", identity)
		}
	}
	// No allowlist: every registered value-only field must have a validator and
	// every validator must be registered, otherwise the gate would be weaker
	// than the registry claims.
	for identity := range valueOnlyJSONFields {
		if !registeredJSONFields[identity] {
			t.Errorf("validator %s is not registered", identity)
		}
	}
}

func TestJSONContractGapMySQL(t *testing.T) {
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
	const aimsSchema, assetsSchema = "jcgap_aims", "jcgap_assets"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v: %.160s", err, query)
		}
	}
	for _, schema := range []string{aimsSchema, assetsSchema} {
		exec("DROP DATABASE IF EXISTS `" + schema + "`")
		exec("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
	}
	tables := map[string][]string{
		aimsSchema + ".aims_projects":               {"id bigint PRIMARY KEY", "access_whitelist json NULL", "module_config json NULL"},
		aimsSchema + ".approval_records":            {"id bigint PRIMARY KEY", "snapshot_json json NULL", "snapshot_sha256 char(64) NULL"},
		aimsSchema + ".deliverable_quality_reviews": {"id bigint PRIMARY KEY", "checklist_result_json json NOT NULL"},
		aimsSchema + ".deliverable_submissions":     {"id bigint PRIMARY KEY", "evidence_snapshot_json json NOT NULL"},
		aimsSchema + ".project_template_versions":   {"id bigint PRIMARY KEY", "definition_json json NOT NULL"},
		aimsSchema + ".qa_checklist_versions":       {"id bigint PRIMARY KEY", "items_json json NOT NULL"},
		assetsSchema + ".asset_events":              {"id bigint PRIMARY KEY", "event_data json NULL"},
		assetsSchema + ".asset_items":               {"id bigint PRIMARY KEY", "tags json NULL"},
		assetsSchema + ".product_assets":            {"id bigint PRIMARY KEY", "customer_domain json NOT NULL", "supported_terminals json NULL"},
		assetsSchema + ".purchase_orders":           {"id bigint PRIMARY KEY", "attachments json NULL"},
	}
	planTables := []Table{}
	for name, columns := range tables {
		exec("CREATE TABLE " + "`" + strings.Replace(name, ".", "`.`", 1) + "` (" + strings.Join(columns, ",") + ") ENGINE=InnoDB")
		schema, table, _ := strings.Cut(name, ".")
		names := []string{}
		for _, column := range columns {
			names = append(names, strings.Fields(column)[0])
		}
		domain := "aims"
		if schema == assetsSchema {
			domain = "assets"
		}
		planTables = append(planTables, Table{Domain: domain, Source: schema, Name: table, Columns: names, PrimaryKey: []string{"id"}})
	}

	snapshot := `{"schema":"aims.milestone-completion-request.v1","project":{"id":1,"code":"P1"},"milestone":{"id":2,"name":"M","sortOrder":1,"status":"active"},"deliverables":[{"id":3,"name":"D","deliverable_type":"document","required":1,"status":"approved","quality_status":"passed","current_submission_id":9,"document_uuid":null,"effective_milestone_id":2,"active_waiver_id":null}],"workItems":[{"id":4,"item_key":"K","tier":"target","type":"task","title":"T","status":"completed","assignee_uid":"U1"}]}`
	var decoded map[string]any
	if err = json.Unmarshal([]byte(snapshot), &decoded); err != nil {
		t.Fatal(err)
	}
	canonical, _ := json.Marshal(decoded)
	digest, _ := jsoncontract.CanonicalSHA256(canonical)
	sha := strings.Repeat("a", 64)
	template := `{"milestones":[{"key":"M1","name":"N","mode":"once","pivrStage":"P","sortOrder":1,"description":null,"workItems":[{"key":"W1","title":"T","type":"task","tier":"target","priority":"P2","description":"d","required":true,"reviewLevel":1,"sortOrder":1,"deliverables":[{"key":"D1","name":"Doc","deliverableType":"document","acceptanceCriteria":"ok","required":true,"sortOrder":1,"description":null}]}]},{"key":"M2","name":"N2","mode":"once","pivrStage":"I","sortOrder":2,"description":null,"workItems":null}]}`
	seed := func() {
		for name := range tables {
			exec("DELETE FROM `" + strings.Replace(name, ".", "`.`", 1) + "`")
		}
		exec("INSERT INTO `"+aimsSchema+"`.aims_projects VALUES(1,'[]',?),(2,NULL,?),(3,'[\"U1\",\"U2\"]',NULL)", `{"legacyProjectType":"custom","legacySource":"import"}`, `{"decomposition":true,"environments":false,"milestones":true,"releases":false,"requirements":true,"service_desk":false,"workflows":true}`)
		exec("INSERT INTO `"+aimsSchema+"`.approval_records VALUES(1,?,?),(2,NULL,NULL)", snapshot, digest)
		exec("INSERT INTO `"+aimsSchema+"`.deliverable_quality_reviews VALUES(1,?)", `{"schema":"aims.deliverable-quality-review.v1","stage":"pm_completeness","checklistVersionId":3,"checklistItemsSha256":"`+sha+`","results":[{"code":"C1","label":"L","passed":true}]}`)
		exec("INSERT INTO `"+aimsSchema+"`.deliverable_submissions VALUES(1,?)", `{"schema":"aims.deliverable-submission.evidence.v2","deliverableId":1,"documentSource":"repo","contentSha256":"`+sha+`","checklistVersionId":2,"checklistItemsSha256":"`+sha+`","repoProjectCode":"P","repoFilePath":"a.md","repoCommitId":"abc"}`)
		exec("INSERT INTO `"+aimsSchema+"`.project_template_versions VALUES(1,?),(2,?)", template, strings.Replace(template, `"description":null,`, ``, 1))
		// id=2: legacy version whose milestone has no description key (S3 copy shape); must not block.
		exec("INSERT INTO `"+aimsSchema+"`.qa_checklist_versions VALUES(1,?)", `[{"code":"C1","label":"L","required":true}]`)
		exec("INSERT INTO `"+assetsSchema+"`.asset_events VALUES(1,?),(2,?),(3,NULL)", `{"summary":"created"}`, `{"summary":"x","excelRow":12,"productCode":"P","source":"file"}`)
		exec("INSERT INTO `" + assetsSchema + "`.asset_items VALUES(1,'[\"a\",\"b\"]')")
		exec("INSERT INTO `" + assetsSchema + "`.product_assets VALUES(1,'[\"G\",\"B\"]','[\"web\"]')")
		exec("INSERT INTO `" + assetsSchema + "`.purchase_orders VALUES(1,'[{\"name\":\"a.pdf\",\"url\":\"https://example.test/a.pdf\"}]')")
	}
	blocking := func() []MigrationConflict {
		t.Helper()
		var all []MigrationConflict
		for _, inspect := range []func(context.Context, querier, []Table) ([]MigrationConflict, error){inspectUnregisteredJSON, inspectValueOnlyJSON, inspectSnapshotHashes} {
			issues, err := inspect(ctx, db, planTables)
			if err != nil {
				t.Fatal(err)
			}
			all = append(all, issues...)
		}
		return all
	}

	seed()
	if issues := blocking(); len(issues) != 0 {
		t.Fatalf("observed shapes must plan with 0 blocking conflicts: %+v", issues)
	}

	// Each mutation breaks exactly one column and must produce a blocking conflict.
	for _, tc := range []struct {
		label, statement string
		args             []any
	}{
		{"whitelist duplicate", "UPDATE `" + aimsSchema + "`.aims_projects SET access_whitelist='[\"U1\",\"U1\"]' WHERE id=1", nil},
		{"module_config unknown key", "UPDATE `" + aimsSchema + "`.aims_projects SET module_config='{\"milestones_enabled\":true}' WHERE id=1", nil},
		{"snapshot hash drift", "UPDATE `" + aimsSchema + "`.approval_records SET snapshot_sha256=? WHERE id=1", []any{strings.Repeat("0", 64)}},
		{"snapshot wrong schema (invalid and hash drift)", "UPDATE `" + aimsSchema + "`.approval_records SET snapshot_json=JSON_SET(snapshot_json,'$.schema','x') WHERE id=1", nil},
		{"review stage", "UPDATE `" + aimsSchema + "`.deliverable_quality_reviews SET checklist_result_json=JSON_SET(checklist_result_json,'$.stage','qa') WHERE id=1", nil},
		{"evidence source", "UPDATE `" + aimsSchema + "`.deliverable_submissions SET evidence_snapshot_json=JSON_SET(evidence_snapshot_json,'$.documentSource','git') WHERE id=1", nil},
		{"template unknown key", "UPDATE `" + aimsSchema + "`.project_template_versions SET definition_json=JSON_SET(definition_json,'$.extra',1) WHERE id=1", nil},
		{"template milestone description number", "UPDATE `" + aimsSchema + "`.project_template_versions SET definition_json=JSON_SET(definition_json,'$.milestones[0].description',5) WHERE id=2", nil},
		{"qa items empty", "UPDATE `" + aimsSchema + "`.qa_checklist_versions SET items_json='[]' WHERE id=1", nil},
		{"event data array", "UPDATE `" + assetsSchema + "`.asset_events SET event_data='[1]' WHERE id=1", nil},
		{"tags numbers", "UPDATE `" + assetsSchema + "`.asset_items SET tags='[1]' WHERE id=1", nil},
		{"customer_domain object", "UPDATE `" + assetsSchema + "`.product_assets SET customer_domain='{}' WHERE id=1", nil},
		{"attachments missing url", "UPDATE `" + assetsSchema + "`.purchase_orders SET attachments='[{\"name\":\"a\"}]' WHERE id=1", nil},
	} {
		seed()
		exec(tc.statement, tc.args...)
		want := 1
		if strings.HasPrefix(tc.label, "snapshot wrong schema") {
			want = 2 // structurally invalid and its stored digest no longer matches
		}
		if issues := blocking(); len(issues) != want || issues[0].RowCount != 1 {
			t.Errorf("%s: want %d blocking conflict(s), got %+v", tc.label, want, issues)
		}
	}
	for _, schema := range []string{aimsSchema, assetsSchema} {
		exec("DROP DATABASE `" + schema + "`")
	}
}
