package wizbiztool

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall/migrationnamespace"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

//go:embed testdata/source_schema.sql
var fixtureDDL string

type toolFixture struct {
	source, target, directory, root, metadata *sql.DB
	profile                                   Profile
	manifest                                  SnapshotManifest
	profileHash, manifestHash, identityHash   string
	binding                                   enterprise.Binding
	data                                      SourceData
	build                                     RuntimeBuildEvidence
}

func newToolFixture(t *testing.T) *toolFixture {
	t.Helper()
	socket := os.Getenv("HZY_W2_TEST_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe isolated socket")
	}
	tag := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	rootConfig := mysql.NewConfig()
	rootConfig.User = "root"
	rootConfig.Net = "unix"
	rootConfig.Addr = socket
	root, err := sql.Open("mysql", rootConfig.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	f := &toolFixture{root: root, data: SourceData{}, identityHash: Digest([]byte("{}")), build: RuntimeBuildEvidence{Version: "0.3.999", Commit: HistoricalContractGuardCommit, BinarySHA256: Digest([]byte("synthetic-runtime")), HistoricalGuardCommit: HistoricalContractGuardCommit}}
	databases := []string{"w2_source_" + tag, "w2_target_" + tag, "w2_directory_" + tag}
	for _, name := range databases {
		if _, err = root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); err != nil {
			t.Fatal(err)
		}
		name := name
		t.Cleanup(func() { root.Exec("DROP DATABASE `" + name + "`") })
	}
	openRoot := func(name string) *sql.DB {
		m := *rootConfig
		m.DBName = name
		db, err := sql.Open("mysql", m.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return db
	}
	sourceAdmin := openRoot(databases[0])
	targetAdmin := openRoot(databases[1])
	directoryAdmin := openRoot(databases[2])
	for _, statement := range strings.Split(fixtureDDL, ";\n") {
		statement = strings.TrimSpace(statement)
		if statement != "" {
			if _, err := sourceAdmin.Exec(statement); err != nil {
				t.Fatal("synthetic source DDL:", err)
			}
		}
	}
	declarations := Declarations()
	for table, decl := range declarations {
		rows := 1
		if preserveSourceTables[table] {
			rows = 2
		}
		for i := 1; i <= rows; i++ {
			row := map[string]any{}
			for _, field := range decl.Columns {
				var value any
				if !field.Nullable {
					switch {
					case strings.Contains(field.Type, "int"):
						value = "1"
					case field.Type == "date":
						value = "2024-01-31"
					case field.Type == "datetime":
						value = "2024-02-01 09:15:00"
					case strings.HasPrefix(field.Type, "decimal"):
						value = "0.00"
					default:
						value = "T" + stringNumber(i)
						if strings.HasPrefix(field.Type, "char(") {
							value = stringNumber(i)
						}
					}
				}
				row[field.Name] = value
			}
			row[decl.PrimaryKey[0]] = stringNumber(i)
			if table == "sys_user" {
				row["user_name"] = "test-source"
				row["nick_name"] = "TEST"
			}
			row["operator_id"] = "1"
			row["operate_time"] = "2024-02-01 09:15:00"
			f.data[table] = append(f.data[table], row)
		}
	}
	org := f.data["wb_organization"][0]
	org["org_type"] = "0"
	org["org_status"] = "0"
	org["org_name"] = "TEST Legal Entity"
	org["parent_id"] = "0"
	org["employee_id"] = "1"
	org["order_num"] = "0"
	customer := cloneRow(org)
	customer["org_id"] = "2"
	customer["org_type"] = "1"
	customer["org_name"] = "TEST Customer"
	customer["contactman_id"] = "1"
	customer["contactman"] = "TEST Contact"
	f.data["wb_organization"] = append(f.data["wb_organization"], customer)
	contact := f.data["wb_contactman"][0]
	contact["org_id"] = "2"
	contact["cm_name"] = "TEST Contact"
	contact["chief"] = "1"
	contact["stars"] = "3"
	contact["employee_id"] = "1"
	bank := f.data["wb_bank_account"][0]
	bank["org_id"] = "1"
	bank["account_name"] = "TEST Account"
	bank["short_name"] = "TEST"
	bank["account_number"] = "TEST-ACCOUNT-DO-NOT-READ"
	bank["bank_name"] = "TEST Bank"
	bank["ba_type"] = "0"
	bank["ba_status"] = "0"
	bank["balance"] = "1200.00"
	bank["check_date"] = "2024-01-31"
	bank["account_sn"] = "0"
	balance := f.data["wb_account_balance"][0]
	balance["ba_id"] = "1"
	balance["balance"] = "1200.00"
	balance["check_date"] = "2024-01-31"
	contract := f.data["wb_contract"][0]
	contract["parent_id"] = "0"
	contract["contract_code"] = "TEST-C001"
	contract["contract_name"] = "TEST Contract"
	contract["company_id"] = "1"
	contract["customer_id"] = "2"
	contract["contactman_id"] = "1"
	contract["employee_id"] = "1"
	contract["ba_id"] = "1"
	contract["contract_type"] = "1"
	contract["contract_status"] = "0"
	contract["is_third_party"] = "N"
	contract["total_amount"] = "100.00"
	contract["prime_amount"] = "80.00"
	contract["invoice_amount"] = "30.00"
	contract["exec_amount"] = "20.00"
	contract["sign_date"] = "2024-01-01 00:00:00"
	for _, income := range f.data["wb_project_income"] {
		income["amount"] = "40.00"
		income["contract_id"] = "1"
	}
	for table, list := range f.data {
		for _, row := range list {
			if _, ok := row["operate_time"]; ok {
				row["operate_time"] = "2024-02-01 09:15:00"
			}
			columns := []string{}
			args := []any{}
			marks := []string{}
			for _, field := range declarations[table].Columns {
				columns = append(columns, "`"+field.Name+"`")
				args = append(args, row[field.Name])
				marks = append(marks, "?")
			}
			if _, err := sourceAdmin.Exec("INSERT INTO `"+table+"` ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(marks, ",")+")", args...); err != nil {
				t.Fatal("synthetic source insert:", table, err)
			}
		}
	}
	var instance string
	if root.QueryRow("SELECT @@server_uuid").Scan(&instance) != nil {
		t.Fatal("isolated server identity")
	}
	f.binding = enterprise.Binding{Key: enterprise.BindingKey{Tenant: "C000001", Environment: "test", RuntimeDeployment: "C000001-test-data-runtime"}, Storage: enterprise.Storage{InstanceID: instance, Database: databases[1], Address: "127.0.0.1:3306"}, Generation: 7, SchemaVersion: "w2-fixture", Domains: map[string]enterprise.DomainBinding{}}
	for _, domain := range []string{"altoc", "finance"} {
		tables, _ := domaininstall.APFTables(domain)
		d := enterprise.DomainBinding{OwnerDeployment: "C000001-test-enterprise", Tables: map[string]string{}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled}
		for _, table := range tables {
			d.Tables[table.Logical] = table.Physical
			if _, err := targetAdmin.Exec(table.DDL); err != nil {
				t.Fatal("target base DDL:", table.Physical, err)
			}
		}
		f.binding.Domains[domain] = d
		for _, table := range tables {
			for _, fk := range table.ForeignKeys {
				raw, _ := json.Marshal(fk)
				_ = raw
				if _, err := targetAdmin.Exec("ALTER TABLE `" + table.Physical + "` ADD CONSTRAINT `" + fk.Name + "` FOREIGN KEY (`" + strings.Join(fk.Columns, "`,`") + "`) REFERENCES `" + fk.ReferencedTable + "` (`" + strings.Join(fk.ReferencedColumns, "`,`") + "`)"); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	for _, table := range domaininstall.FinanceB3Tables() {
		if _, err := targetAdmin.Exec(table.DDL); err != nil {
			t.Fatal("Finance B3 fixture", table.Physical, err)
		}
		d := f.binding.Domains["finance"]
		d.Tables[table.Logical] = table.Physical
		f.binding.Domains["finance"] = d
	}
	for _, table := range domaininstall.FinanceB3Tables() {
		for _, fk := range table.ForeignKeys {
			if _, err := targetAdmin.Exec("ALTER TABLE `" + table.Physical + "` ADD CONSTRAINT `" + fk.Name + "` FOREIGN KEY (`" + strings.Join(fk.Columns, "`,`") + "`) REFERENCES `" + fk.ReferencedTable + "` (`" + strings.Join(fk.ReferencedColumns, "`,`") + "`)"); err != nil {
				t.Fatal(err)
			}
		}
	}
	migration := enterprise.DomainBinding{OwnerDeployment: "C000001-test-enterprise", Tables: map[string]string{}, Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled}
	for _, subset := range w1TableSubsets {
		for _, table := range domaininstall.W1Tables(subset) {
			if _, err := targetAdmin.Exec(table.DDL); err != nil {
				t.Fatal("W1 target DDL:", err)
			}
			domain := domaininstall.W1Domain(subset)
			if domain == "migration" {
				migration.Tables[table.Logical] = table.Physical
			} else {
				d := f.binding.Domains[domain]
				d.Tables[table.Logical] = table.Physical
				f.binding.Domains[domain] = d
			}
		}
	}
	f.binding.Domains["migration"] = migration
	if _, err := targetAdmin.Exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(100),schema_version VARCHAR(100),generation BIGINT UNSIGNED)"); err != nil {
		t.Fatal(err)
	}
	if _, err := targetAdmin.Exec("INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','C000001-test-data-runtime','w2-fixture',7)"); err != nil {
		t.Fatal(err)
	}
	for _, ddl := range []string{"CREATE TABLE directory_users(uid VARCHAR(64) PRIMARY KEY,status VARCHAR(20))", "CREATE TABLE directory_user_departments(uid VARCHAR(64),dept_code VARCHAR(64),is_primary INT, status VARCHAR(32) DEFAULT 'active')"} {
		if _, err := directoryAdmin.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	users := []string{"w2_src_" + tag, "w2_dst_" + tag, "w2_dir_" + tag}
	for _, user := range users {
		if _, err := root.Exec("CREATE USER '" + user + "'@'localhost'"); err != nil {
			t.Fatal(err)
		}
		user := user
		t.Cleanup(func() { root.Exec("DROP USER '" + user + "'@'localhost'") })
	}
	for table, decl := range declarations {
		selection := "SELECT"
		if table == "wb_bank_account" {
			cols := []string{}
			for _, c := range decl.Columns {
				if c.Name != "account_number" {
					cols = append(cols, "`"+c.Name+"`")
				}
			}
			selection += " (" + strings.Join(cols, ",") + ")"
		}
		if _, err := root.Exec("GRANT " + selection + " ON `" + databases[0] + "`.`" + table + "` TO '" + users[0] + "'@'localhost'"); err != nil {
			t.Fatal(err)
		}
	}
	grantTargets := targetTableSet()
	for _, domain := range f.binding.Domains {
		for _, table := range domain.Tables {
			grantTargets[table] = true
		}
	}
	for table := range grantTargets {
		privileges := "SELECT"
		if targetTableSet()[table] && table != "enterprise_schema_registry" {
			privileges = "SELECT, INSERT, UPDATE, DELETE"
		}
		if _, err := root.Exec("GRANT " + privileges + " ON `" + databases[1] + "`.`" + table + "` TO '" + users[1] + "'@'localhost'"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := root.Exec("GRANT SELECT ON `" + databases[2] + "`.* TO '" + users[2] + "'@'localhost'"); err != nil {
		t.Fatal(err)
	}
	conn := func(i int) Connection { return Connection{Socket: socket, User: users[i], Database: databases[i]} }
	f.profile = Profile{Version: ProfileVersion, Tenant: "C000001", Environment: "test", RuntimeDeployment: "C000001-test-data-runtime", EnterpriseDeployment: "C000001-test-enterprise", InstanceID: instance, Database: databases[1], ConsoleDatabase: databases[2], Source: conn(0), Target: conn(1), Directory: conn(2), VaultWrite: "synthetic", Currency: CurrencyConfirmation{"CNY", "TEST", "2024-02-01"}, BatchCode: "w2-test", Operator: "TEST", RuntimeBinary: "/test/runtime", RuntimeConfig: filepath.Join(t.TempDir(), "runtime.json"), SourceRepository: "/test/source"}
	cfg := config.Config{Tenant: f.profile.Tenant, Deployment: f.profile.RuntimeDeployment, DeploymentBindings: map[string]string{"enterprise": f.profile.EnterpriseDeployment}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "test", SchemaVersion: "w2-fixture", Generation: 7, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: 3306, User: "runtime", Database: databases[1], ConnectionLimit: 2}, Domains: map[string]config.EnterpriseDomainConfig{}}}
	cfg.Apps.Console.DB.Database = databases[2]
	for domain, d := range f.binding.Domains {
		cfg.Enterprise.Domains[domain] = config.EnterpriseDomainConfig{OwnerDeployment: d.OwnerDeployment, Tables: d.Tables, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler}
	}
	if len(migrationnamespace.Tables()) != len(migration.Tables) {
		t.Fatal("closed namespace mismatch")
	}
	if WriteJSON(f.profile.RuntimeConfig, cfg) != nil {
		t.Fatal("write synthetic configuration")
	}
	metaUser := "w2_meta_" + tag
	root.Exec("CREATE USER '" + metaUser + "'@'localhost'")
	root.Exec("GRANT SELECT ON `" + databases[0] + "`.* TO '" + metaUser + "'@'localhost'")
	t.Cleanup(func() { root.Exec("DROP USER '" + metaUser + "'@'localhost'") })
	f.profile.SourceMetadata = Connection{Socket: socket, User: metaUser, Database: databases[0]}
	f.metadata, _ = f.profile.SourceMetadata.Open()
	t.Cleanup(func() { f.metadata.Close() })
	f.profileHash = factsHash(f.profile)
	f.source, _ = f.profile.Source.Open()
	f.target, _ = f.profile.Target.Open()
	f.directory, _ = f.profile.Directory.Open()
	t.Cleanup(func() { f.source.Close(); f.target.Close(); f.directory.Close() })
	f.manifest = SnapshotManifest{SnapshotID: "20240201T001500Z", SourceSystem: "wizbiz", SQLSHA256: Digest([]byte("synthetic-sql")), EncryptedSHA256: Digest([]byte("synthetic-encrypted")), MySQLVersion: "8.0.34", Timezone: "Asia/Shanghai", Tables: map[string]ManifestTable{}}
	for table, decl := range declarations {
		definition := ManifestTable{Rows: uint64(len(f.data[table])), PrimaryKey: decl.PrimaryKey, Columns: []SourceColumn{}, InsertSequenceSHA256: Digest([]byte(table))}
		for _, c := range decl.Columns {
			definition.Columns = append(definition.Columns, SourceColumn{c.Name, c.Type, c.Nullable})
		}
		f.manifest.Tables[table] = definition
	}
	f.manifestHash = factsHash(f.manifest)
	return f
}
func cloneRow(row map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range row {
		out[k] = v
	}
	return out
}
func stringNumber(n int) string {
	if n == 1 {
		return "1"
	}
	return "2"
}
func (f *toolFixture) sourceSnapshot(t *testing.T) *SourceSnapshot {
	t.Helper()
	snapshot, err := OpenSourceSnapshot(context.Background(), f.source, f.profile.Source.Database)
	if err != nil {
		t.Fatal(err)
	}
	if err := snapshot.AttachMetadata(context.Background(), f.metadata); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { snapshot.Close() })
	return snapshot
}
func TestToolPlanMySQL(t *testing.T) {
	f := newToolFixture(t)
	ctx := context.Background()
	source := f.sourceSnapshot(t)
	receipt, err := source.VerifyStage(ctx, f.manifest, f.manifestHash)
	if err != nil {
		t.Fatal("stage:", err)
	}
	plan, err := BuildPlan(ctx, source, f.target, f.directory, f.profile, f.profileHash, f.manifest, f.manifestHash, receipt, map[string]IdentityConfirmation{}, f.identityHash, f.build)
	if err != nil {
		t.Fatal("plan:", err)
	}
	if len(plan.Objects) == 0 || len(plan.Coverage) < 200 || ReviewPlan(plan, plan.ReviewHash) != nil {
		t.Fatal("incomplete plan")
	}
	var count int
	if f.target.QueryRow("SELECT COUNT(*) FROM mig_batch").Scan(&count) != nil || count != 0 {
		t.Fatal("plan wrote target")
	}
	if _, err := f.source.Exec("SELECT account_number FROM wb_bank_account"); err == nil {
		t.Fatal("source account can read secret")
	}
	raw, _ := json.Marshal(plan)
	for _, forbidden := range []string{"TEST Customer", "TEST Contact", "TEST-ACCOUNT-DO-NOT-READ"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatal("plan leaked source value")
		}
	}
	second, err := BuildPlan(ctx, source, f.target, f.directory, f.profile, f.profileHash, f.manifest, f.manifestHash, receipt, map[string]IdentityConfirmation{}, f.identityHash, f.build)
	if err != nil || second.ReviewHash != plan.ReviewHash {
		t.Fatal("read-only plan not deterministic")
	}
	_ = time.Second
}

func TestToolDependencyDefinitionsMySQL(t *testing.T) {
	f := newToolFixture(t)
	for _, table := range DependencyTables() {
		expected, err := expectedFacts(table)
		if err != nil {
			t.Fatal(table.Physical, err)
		}
		actual, err := actualFacts(context.Background(), f.target, f.profile.Database, table.Physical)
		if err != nil {
			t.Fatal(table.Physical, err)
		}
		if factsHash(expected) != factsHash(actual) {
			t.Errorf("schema mismatch %s\nexpected=%s\nactual=%s", table.Physical, jsonFacts(expected), jsonFacts(actual))
		}
	}
}
func jsonFacts(value any) string { raw, _ := json.Marshal(value); return string(raw) }
