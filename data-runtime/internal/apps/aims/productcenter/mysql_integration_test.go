package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func mysqlTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("set HZY_PRODUCT_CENTER_TEST_SOCKET to an isolated local MySQL socket")
	}
	// This suite never accepts a network address, ambient DSN, or a business DB.
	cleanSocket := filepath.Clean(socket)
	if !strings.HasPrefix(cleanSocket, "/tmp/hzy-product-center.") && !strings.HasPrefix(cleanSocket, "/tmp/hzy-test-mysql-") {
		t.Fatal("test socket must be inside a dedicated temporary MySQL directory")
	}
	config := mysql.NewConfig()
	config.User, config.Net, config.Addr = "root", "unix", socket
	config.Timeout, config.ReadTimeout, config.WriteTimeout = 5*time.Second, 10*time.Second, 10*time.Second
	root, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_pc_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	config.DBName = name
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("DROP DATABASE `" + name + "`"); _ = db.Close() })
	fixture, err := os.ReadFile("testdata/legacy_product_versions.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(fixture))
	canonical, err := os.ReadFile("../../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	operationDDL := regexp.MustCompile(`(?s)CREATE TABLE IF NOT EXISTS integration_operation \(.*?ENGINE=InnoDB.*?;`).FindString(string(canonical))
	if operationDDL == "" {
		t.Fatal("missing integration operation prerequisite")
	}
	executeSQLScript(t, db, operationDDL)
	return db
}

func executeSQLScript(t *testing.T, db *sql.DB, script string) {
	t.Helper()
	delimiter := ";"
	var buffer strings.Builder
	for _, line := range strings.Split(script, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		if strings.HasPrefix(trimmed, "DELIMITER ") {
			delimiter = strings.TrimSpace(strings.TrimPrefix(trimmed, "DELIMITER "))
			continue
		}
		buffer.WriteString(line)
		buffer.WriteByte('\n')
		if strings.HasSuffix(trimmed, delimiter) {
			statement := strings.TrimSuffix(strings.TrimSpace(buffer.String()), delimiter)
			if _, err := db.Exec(statement); err != nil {
				t.Fatalf("SQL failed: %v\n%s", err, statement)
			}
			buffer.Reset()
		}
	}
	if rest := strings.TrimSpace(buffer.String()); rest != "" && !strings.HasPrefix(rest, "--") {
		t.Fatalf("unterminated SQL: %s", rest)
	}
}

func migrateProductCenterBeforeComponents(t *testing.T, db *sql.DB) {
	t.Helper()
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.19_product_center.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	script, err = os.ReadFile("../../../../../aims/docs/migration_v5.20_product_comment_cycles.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
}

func workspaceFixture(t *testing.T, db *sql.DB, code string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at)
		VALUES (?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
}

func planningFixture(t *testing.T, db *sql.DB, code string) int64 {
	t.Helper()
	result, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at)
		VALUES (?,?,'OIDC','OIDC scope','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, uuid.NewString(), code)
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestMySQLMigrationRepeatPreservesLegacyVersions(t *testing.T) {
	db := mysqlTestDatabase(t)
	if _, err := db.Exec(`INSERT INTO product_versions(id,product_code,version_code,status) VALUES (42,'Demo','V1.0','released')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_version_features(id,version_id,title) VALUES (73,42,'历史特性')`); err != nil {
		t.Fatal(err)
	}
	migrateProductCenter(t, db)
	migrateProductCenter(t, db)
	var versionCode, status, title string
	var mapped sql.NullInt64
	if err := db.QueryRow(`SELECT v.version_code,v.status,f.title,f.planning_item_id FROM product_versions v JOIN product_version_features f ON f.version_id=v.id WHERE v.id=42 AND f.id=73`).Scan(&versionCode, &status, &title, &mapped); err != nil {
		t.Fatal(err)
	}
	if versionCode != "V1.0" || status != "released" || title != "历史特性" || mapped.Valid {
		t.Fatalf("legacy identity changed: %s %s %s %+v", versionCode, status, title, mapped)
	}
	workspaceFixture(t, db, "Demo")
	workspaceFixture(t, db, "demo")
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM product_workspaces").Scan(&count); err != nil || count != 2 {
		t.Fatalf("case-sensitive codes: %d %v", count, err)
	}
}

func TestMySQLProductScopeAndUniqueOpenCycle(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "A")
	workspaceFixture(t, db, "B")
	a, b := planningFixture(t, db, "A"), planningFixture(t, db, "B")
	if _, err := db.Exec(`INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES ('A',?,?,'pm',UTC_TIMESTAMP(3))`, a, b); err == nil {
		t.Fatal("cross-product dependency accepted by DB")
	}
	createCycle := func() error {
		_, err := db.Exec(`INSERT INTO product_planning_cycles
		(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,status,total_person_days,reserve_person_days,reliability_person_days,usability_person_days,growth_person_days,created_by,updated_by,created_at,updated_at)
		VALUES (?,'A','季度','2026-09-01','2026-09-30','目标','{}','open',20,2,6,6,6,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, uuid.NewString())
		return err
	}
	if err := createCycle(); err != nil {
		t.Fatal(err)
	}
	if err := createCycle(); err == nil {
		t.Fatal("two simultaneous open cycles accepted")
	}
	if _, err := db.Exec(`UPDATE product_planning_cycles SET growth_person_days=7 WHERE product_code='A'`); err == nil {
		t.Fatal("overallocated capacity accepted")
	}
}

func allowCommand(context.Context, *sql.Tx) error { return nil }

func TestMySQLCommandRollbackReplayAndPayloadConflict(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "A")
	identity := CommandIdentity{"A", "workspace.edit", "pm", "same-command"}
	payload := map[string]any{"positioning": "new"}
	injected := errors.New("injected after mutation")
	_, err := ExecuteCommand(context.Background(), db, identity, payload, allowCommand, func(ctx context.Context, tx *sql.Tx) (any, error) {
		_, err := tx.ExecContext(ctx, "UPDATE product_workspaces SET positioning='new' WHERE product_code='A'")
		if err != nil {
			return nil, err
		}
		return nil, injected
	})
	if !errors.Is(err, injected) {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM product_command_receipts").Scan(&count); err != nil || count != 0 {
		t.Fatalf("receipt survived rollback %d %v", count, err)
	}
	var positioning sql.NullString
	if err := db.QueryRow("SELECT positioning FROM product_workspaces WHERE product_code='A'").Scan(&positioning); err != nil || positioning.Valid {
		t.Fatalf("mutation survived rollback %+v %v", positioning, err)
	}
	var calls int
	apply := func(ctx context.Context, tx *sql.Tx) (any, error) {
		calls++
		_, err := tx.ExecContext(ctx, "UPDATE product_workspaces SET revision=revision+1 WHERE product_code='A'")
		return map[string]any{"product_code": "A"}, err
	}
	first, err := ExecuteCommand(context.Background(), db, identity, payload, allowCommand, apply)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := ExecuteCommand(context.Background(), db, identity, payload, allowCommand, apply)
	if err != nil {
		t.Fatal(err)
	}
	if first.Replayed || !replay.Replayed || first.ReceiptID != replay.ReceiptID || calls != 1 {
		t.Fatalf("replayed mutation: %+v %+v calls=%d", first, replay, calls)
	}
	if _, err := ExecuteCommand(context.Background(), db, identity, map[string]any{"positioning": "other"}, allowCommand, apply); err == nil {
		t.Fatal("different payload accepted")
	}
	denied := errors.New("membership revoked")
	if _, err := ExecuteCommand(context.Background(), db, identity, payload, func(context.Context, *sql.Tx) error { return denied }, apply); !errors.Is(err, denied) {
		t.Fatalf("replay ignored revocation: %v", err)
	}
}

func TestMySQLConcurrentCommandExecutesOnce(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "A")
	identity := CommandIdentity{"A", "workspace.edit", "pm", "concurrent"}
	var calls atomic.Int32
	start := make(chan struct{})
	results := make(chan error, 8)
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			_, err := ExecuteCommand(context.Background(), db, identity, map[string]string{"value": "same"}, allowCommand, func(ctx context.Context, tx *sql.Tx) (any, error) {
				calls.Add(1)
				_, err := tx.ExecContext(ctx, "UPDATE product_workspaces SET revision=revision+1 WHERE product_code='A'")
				return map[string]string{"result": "ok"}, err
			})
			results <- err
		}()
	}
	close(start)
	group.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("concurrent effect executed %d times", calls.Load())
	}
	var revision int
	if err := db.QueryRow("SELECT revision FROM product_workspaces WHERE product_code='A'").Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("revision=%d %v", revision, err)
	}
}

func TestMySQLReleaseEvidenceCannotBeRewrittenOrDeleted(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	if _, err := db.Exec(`INSERT INTO product_versions(id,product_code,version_code,status) VALUES (42,'A','V1.0','released')`); err != nil {
		t.Fatal(err)
	}
	_, err := db.Exec(`INSERT INTO product_release_records
		(biz_id,version_id,release_seq,scope_revision,scope_snapshot,acceptance_snapshot,content_hash,evidence_level,recorded_at)
		VALUES (?,42,1,1,'{}','{}',?,'legacy_import',UTC_TIMESTAMP(3))`, uuid.NewString(), strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`UPDATE product_release_records SET scope_snapshot='{"tampered":true}' WHERE version_id=42`,
		`DELETE FROM product_release_records WHERE version_id=42`,
	} {
		if _, err := db.Exec(statement); err == nil {
			t.Fatalf("immutable evidence allowed: %s", statement)
		}
	}
	// Installing the migration again must neither erase evidence nor disable guards.
	migrateProductCenter(t, db)
	if _, err := db.Exec(`DELETE FROM product_release_records WHERE version_id=42`); err == nil {
		t.Fatal("repeat migration removed evidence guard")
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_release_records WHERE version_id=42`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("history count=%d, err=%v", count, err)
	}
}

func TestMySQLInvalidResultRollsBackMutationAndReceipt(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "A")
	_, err := ExecuteCommand(context.Background(), db, CommandIdentity{"A", "workspace.edit", "pm", "invalid-result"}, map[string]string{"value": "new"}, allowCommand,
		func(ctx context.Context, tx *sql.Tx) (any, error) {
			if _, err := tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1 WHERE product_code='A'`); err != nil {
				return nil, err
			}
			return make(chan int), nil
		})
	if err == nil {
		t.Fatal("unpersistable command result accepted")
	}
	var revision, count int
	if err := db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='A'`).Scan(&revision); err != nil || revision != 1 {
		t.Fatalf("mutation survived invalid result: %d %v", revision, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("receipt survived invalid result: %d %v", count, err)
	}
}

func TestMySQLCanonicalProductSchemaMatchesIncrementalMigration(t *testing.T) {
	migrated := mysqlTestDatabase(t)
	migrateProductCenter(t, migrated)
	for _, name := range []string{"migration_v5.22_product_objectives.sql", "migration_v5.23_objective_observation_corrections.sql", "migration_v5.24_objective_cycle_mappings.sql", "migration_v5.25_planning_roadmap_windows.sql", "migration_v5.26_roadmap_commitments.sql", "migration_v5.27_cross_product_dependencies.sql", "migration_v5.28_roadmap_cross_dependency_snapshots.sql", "migration_v5.29_priority_model_versions.sql", "migration_v5.30_rice_reach_observations.sql", "migration_v5.31_rice_assessments.sql", "migration_v5.32_roadmap_saved_views.sql", "migration_v5.33_roadmap_saved_view_deletion.sql", "migration_v5.34_product_documents.sql", "migration_v5.35_product_document_creation_requests.sql", "migration_v5.36_product_feedback_bindings.sql", "migration_v5.37_product_line_management.sql", "migration_v5.38_lightweight_product_planning.sql"} {
		script, err := os.ReadFile("../../../../../aims/docs/" + name)
		if err != nil {
			t.Fatal(err)
		}
		executeSQLScript(t, migrated, string(script))
	}
	fresh := mysqlTestDatabase(t)
	if _, err := fresh.Exec("DROP TABLE product_version_features"); err != nil {
		t.Fatal(err)
	}
	if _, err := fresh.Exec("DROP TABLE product_versions"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile("../../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := string(content)
	for _, table := range []string{"product_versions", "product_version_features"} {
		pattern := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `" + table + "` \\(.*?;\\n")
		statement := pattern.FindString(schema)
		if statement == "" {
			t.Fatalf("missing canonical table %s", table)
		}
		executeSQLScript(t, fresh, statement)
	}
	index := strings.Index(schema, "-- Product Center (v5.19)")
	if index < 0 {
		t.Fatal("missing canonical product-center section")
	}
	executeSQLScript(t, fresh, schema[index:])
	signature := func(db *sql.DB) []string {
		var values []string
		for _, query := range []string{
			`SELECT CONCAT_WS('|',TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<null>'),EXTRA,COALESCE(COLLATION_NAME,''))
			FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,COLUMN_NAME`,
			`SELECT CONCAT_WS('|',TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME)
			FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,
			`SELECT CONCAT_WS('|',TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,COALESCE(REFERENCED_TABLE_NAME,''),COALESCE(REFERENCED_COLUMN_NAME,''))
			FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`,
			`SELECT CONCAT_WS('|',CONSTRAINT_NAME,CHECK_CLAUSE)
			FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY CONSTRAINT_NAME`,
			`SELECT CONCAT_WS('|',TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_TIMING,ACTION_STATEMENT)
			FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME`,
		} {
			rows, err := db.Query(query)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var value string
				if err := rows.Scan(&value); err != nil {
					rows.Close()
					t.Fatal(err)
				}
				values = append(values, value)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				t.Fatal(err)
			}
		}
		return values
	}
	if a, b := signature(migrated), signature(fresh); !reflect.DeepEqual(a, b) {
		t.Fatalf("canonical/incremental product schema drift:\n%v\n%v", a, b)
	}
}

func migrateProductCenter(t *testing.T, db *sql.DB) {
	t.Helper()
	migrateProductCenterBeforeComponents(t, db)
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.21_product_components.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	script, err = os.ReadFile("../../../../../aims/docs/migration_v5.27_cross_product_dependencies.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	for _, name := range []string{"migration_v5.29_priority_model_versions.sql", "migration_v5.30_rice_reach_observations.sql", "migration_v5.31_rice_assessments.sql", "migration_v5.32_roadmap_saved_views.sql", "migration_v5.33_roadmap_saved_view_deletion.sql", "migration_v5.34_product_documents.sql", "migration_v5.35_product_document_creation_requests.sql", "migration_v5.36_product_feedback_bindings.sql", "migration_v5.37_product_line_management.sql", "migration_v5.38_lightweight_product_planning.sql"} {
		modelScript, e := os.ReadFile("../../../../../aims/docs/" + name)
		if e != nil {
			t.Fatal(e)
		}
		executeSQLScript(t, db, string(modelScript))
	}

}
