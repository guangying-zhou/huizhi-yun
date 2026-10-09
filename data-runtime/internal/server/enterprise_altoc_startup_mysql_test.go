package server

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	altocapp "github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

// Exercises Server.New against installed schemas on a disposable /tmp server,
// including the exact seven approved subsets. Never reads deployed config/DBs.
func TestAPFAltocStartupInstalledBindingsMySQL(t *testing.T) {
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
	if socket == "" {
		t.Skip("dedicated temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	var instance, datadir string
	var port int
	if err = root.QueryRow("SELECT @@server_uuid,@@datadir,@@port").Scan(&instance, &datadir, &port); err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(datadir) != filepath.Join(filepath.Dir(socket), "data") {
		t.Fatal("not disposable")
	}
	exec := func(db *sql.DB, q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	fixture := func(t *testing.T) (*sql.DB, enterprise.Binding, config.DBConfig) {
		t.Helper()
		suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
		name := "hzy_startup_" + suffix
		user := "startup_" + suffix[:16]
		exec(root, "CREATE DATABASE "+name)
		t.Cleanup(func() { root.Exec("DROP DATABASE " + name) })
		exec(root, "CREATE USER '"+user+"'@'127.0.0.1' IDENTIFIED BY 'isolated-startup-only'")
		t.Cleanup(func() { root.Exec("DROP USER '" + user + "'@'127.0.0.1'") })
		exec(root, "GRANT SELECT ON "+name+".* TO '"+user+"'@'127.0.0.1'")
		local := *mc
		local.DBName = name
		db, err := sql.Open("mysql", local.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		exec(db, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(30),runtime_deployment VARCHAR(100),schema_version VARCHAR(30),generation BIGINT) ENGINE=InnoDB")
		exec(db, "INSERT INTO enterprise_schema_registry VALUES(1,'fixture','test','runtime-test','v1',1)")
		b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: "fixture", Environment: "test", RuntimeDeployment: "runtime-test"}, Storage: enterprise.Storage{InstanceID: instance, Address: fmt.Sprintf("127.0.0.1:%d", port), Database: name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]enterprise.DomainBinding{}}
		return db, b, config.DBConfig{Host: "127.0.0.1", Port: port, Database: name, User: user, Password: "isolated-startup-only", ConnectionLimit: 4}
	}
	cfgFor := func(b enterprise.Binding, dbc config.DBConfig) config.Config {
		cfg := config.Config{Tenant: b.Key.Tenant, Deployment: b.Key.RuntimeDeployment, DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "altoc": "enterprise-test", "people": "enterprise-test", "finance": "enterprise-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: b.Key.Environment, InstanceID: b.Storage.InstanceID, SchemaVersion: b.SchemaVersion, Generation: b.Generation, DB: dbc, Domains: map[string]config.EnterpriseDomainConfig{}}}
		for name, d := range b.Domains {
			cfg.Enterprise.Domains[name] = config.EnterpriseDomainConfig{OwnerDeployment: d.OwnerDeployment, Tables: d.Tables, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler}
		}
		return cfg
	}
	for _, full := range []bool{false, true} {
		t.Run(fmt.Sprintf("APF-seven-subsets-%v", full), func(t *testing.T) {
			db, b, dbc := fixture(t)
			b, err = domaininstall.WithAPF(b, "enterprise-test")
			if err != nil {
				t.Fatal(err)
			}
			expectation := domaininstall.Expectation{Tenant: b.Key.Tenant, Environment: b.Key.Environment, Address: b.Storage.Address, OwnerDeployment: "enterprise-test"}
			install := func(i domaininstall.Installer) {
				t.Helper()
				p, err := i.PlanInstall(context.Background(), db, b)
				if err != nil {
					t.Fatal(err)
				}
				var receipt domaininstall.Receipt
				if err = i.Apply(context.Background(), db, p, func(context.Context) error { return nil }, func(r domaininstall.Receipt) error { receipt = r; return nil }); err != nil {
					t.Fatal(err)
				}
				if err = i.Verify(context.Background(), db, p); err != nil {
					t.Fatal(err)
				}
				if err = i.VerifyReceipt(context.Background(), db, receipt); err != nil {
					t.Fatal(err)
				}
			}
			install(domaininstall.ForAPF(expectation))
			if full {
				steps := []struct {
					extend    func(enterprise.Binding) (enterprise.Binding, error)
					installer func(domaininstall.Expectation) domaininstall.Installer
				}{
					{domaininstall.WithPeoplePrivateFacts, domaininstall.ForPeoplePrivateFacts}, {domaininstall.WithPeopleFacts, domaininstall.ForPeopleFacts}, {domaininstall.WithFinanceB3, domaininstall.ForFinanceB3}, {domaininstall.WithFinance13a, domaininstall.ForFinance13a}, {domaininstall.WithFinance13b, domaininstall.ForFinance13b}, {domaininstall.WithAltocSales, domaininstall.ForAltocSales}, {domaininstall.WithFinanceCost, domaininstall.ForFinanceCost},
				}
				for _, step := range steps {
					b, err = step.extend(b)
					if err != nil {
						t.Fatal(err)
					}
					install(step.installer(expectation))
				}
			}
			for name, d := range b.Domains {
				d.Write = enterprise.PathUnified
				b.Domains[name] = d
			}
			cfg := cfgFor(b, dbc)
			s, err := New(cfg)
			if err != nil {
				t.Fatalf("installed APF startup: %v", err)
			}
			defer s.Close()
			if s.enterpriseAPF == nil || s.enterpriseAltocReads != nil || (s.enterpriseAltocSalesReads != nil) != full {
				t.Fatal("APF must use owning APF service and enable B2 reads only when installed")
			}
			if full {
				broken := cfg.Enterprise.Domains["altoc"]
				broken.Tables = map[string]string{}
				for k, v := range b.Domains["altoc"].Tables {
					broken.Tables[k] = v
				}
				delete(broken.Tables, "altoc_contract")
				cfg.Enterprise.Domains["altoc"] = broken
				if bad, e := New(cfg); e == nil {
					bad.Close()
					t.Fatal("partial APF must fail closed")
				}
			}
		})
	}
	for _, sales := range []bool{false, true} {
		t.Run(fmt.Sprintf("legacy-sales-%v", sales), func(t *testing.T) {
			db, b, dbc := fixture(t)
			tables := map[string]string{}
			for _, logical := range altocapp.BasicReadTables {
				tables[logical] = "legacy_" + logical
			}
			if sales {
				for _, logical := range altocapp.SalesReadTables {
					tables[logical] = "legacy_" + logical
				}
			}
			for _, physical := range tables {
				exec(db, "CREATE TABLE `"+physical+"`(id BIGINT PRIMARY KEY) ENGINE=InnoDB")
			}
			b.Domains["altoc"] = enterprise.DomainBinding{OwnerDeployment: "enterprise-test", Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled, Tables: tables}
			cfg := cfgFor(b, dbc)
			s, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if s.enterpriseAPF != nil || s.enterpriseAltocReads == nil || (s.enterpriseAltocSalesReads != nil) != sales {
				t.Fatal("legacy reader behavior changed")
			}
			delete(tables, "contract")
			cfg = cfgFor(b, dbc)
			if bad, e := New(cfg); e == nil {
				bad.Close()
				t.Fatal("missing legacy contract mapping must fail closed")
			}
		})
	}
}
