package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_TEST_SOCKET")
	if socket == "" {
		t.Skip("set HZY_ENTERPRISE_TEST_SOCKET to dedicated /tmp/hzy-product-center.* socket")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-product-center.") {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.Timeout = 5 * time.Second
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	var instance string
	var port int
	if err := root.QueryRow(`SELECT @@server_uuid,@@port`).Scan(&instance, &port); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	bindings := map[string]enterprise.Binding{}
	factories := map[string]enterprise.ConnectionFactory{}
	for _, tenant := range []string{"one", "two"} {
		name := "hzy_enterprise_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if _, err := root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
			t.Fatal(err)
		}

		t.Cleanup(func() {
			if _, err := root.Exec("DROP DATABASE `" + name + "`"); err != nil {
				t.Error(err)
			}
		})
		b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: tenant, Environment: "isolated", RuntimeDeployment: tenant + "-runtime"}, Storage: enterprise.Storage{InstanceID: instance, Address: fmt.Sprintf("127.0.0.1:%d", port), Database: name}, SchemaVersion: "enterprise.v1", Generation: 1, Domains: map[string]enterprise.DomainBinding{"aims": {OwnerDeployment: tenant + "-aims", Tables: map[string]string{"facts": "aims_facts"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled}, "assets": {OwnerDeployment: tenant + "-assets", Tables: map[string]string{"facts": "assets_facts"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled}}}
		ddl := []string{"CREATE TABLE `" + name + "`.enterprise_schema_registry (id TINYINT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB", "CREATE TABLE `" + name + "`.aims_facts (id INT PRIMARY KEY,value VARCHAR(64)) ENGINE=InnoDB", "CREATE TABLE `" + name + "`.assets_facts (id INT PRIMARY KEY,value VARCHAR(64)) ENGINE=InnoDB"}
		for _, sql := range ddl {
			if _, err := root.Exec(sql); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := root.Exec("INSERT INTO `"+name+"`.enterprise_schema_registry VALUES(1,?,?,?,?,1)", tenant, b.Key.Environment, b.Key.RuntimeDeployment, b.SchemaVersion); err != nil {
			t.Fatal(err)
		}
		if _, err := root.Exec("INSERT INTO `"+name+"`.aims_facts VALUES(1,?)", tenant); err != nil {
			t.Fatal(err)
		}
		bindings[tenant] = b
		factories[name] = EnterpriseFactory(config.DBConfig{Host: "127.0.0.1", Port: port, User: "root", Database: name, ConnectionLimit: 3}, b)
	}
	registry := enterprise.NewRegistry(func(ctx context.Context, s enterprise.Storage) (*sql.DB, error) {
		f, ok := factories[s.Database]
		if !ok {
			return nil, ErrEnterpriseStorage
		}
		return f(ctx, s)
	})
	t.Cleanup(func() {
		if err := registry.Close(); err != nil {
			t.Error(err)
		}
	})
	for _, b := range bindings {
		if err := registry.Register(ctx, b); err != nil {
			t.Fatal(err)
		}
	}
	request := func(b enterprise.Binding, domain string) enterprise.ResolveRequest {
		return enterprise.ResolveRequest{Key: b.Key, Domain: domain, OwnerDeployment: b.Domains[domain].OwnerDeployment, SchemaVersion: b.SchemaVersion, Generation: b.Generation, Operation: enterprise.Read}
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		for tenant, b := range bindings {
			wg.Add(1)
			go func(tenant string, b enterprise.Binding) {
				defer wg.Done()
				r, err := registry.Resolve(request(b, "aims"))
				if err != nil {
					t.Error(err)
					return
				}
				table, _ := r.Table("facts")
				var value string
				if err := r.DB.QueryRow("SELECT value FROM " + table + " WHERE id=1").Scan(&value); err != nil || value != tenant {
					t.Errorf("tenant isolation failed: %v", err)
				}
			}(tenant, b)
		}
	}
	wg.Wait()
	b := bindings["one"]
	a, err := registry.Resolve(request(b, "aims"))
	if err != nil {
		t.Fatal(err)
	}
	other, err := registry.Resolve(request(b, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	if a.DB != other.DB {
		t.Fatal("domain pools are not shared")
	}
	tx, err := a.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"aims_facts", "assets_facts"} {
		if _, err := tx.Exec("INSERT INTO " + table + " VALUES(2,'rollback')"); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"aims_facts", "assets_facts"} {
		var count int
		if err := a.DB.QueryRow("SELECT COUNT(*) FROM " + table + " WHERE id=2").Scan(&count); err != nil || count != 0 {
			t.Fatal("partial transaction", err)
		}
	}
	// Hold multiple physical connections simultaneously to verify DSN initialization,
	// not just the startup connection's time zone.
	var conns []*sql.Conn
	for i := 0; i < 3; i++ {
		c, err := a.DB.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		conns = append(conns, c)
		var zone string
		if err := c.QueryRowContext(ctx, "SELECT @@session.time_zone").Scan(&zone); err != nil || zone != "+00:00" {
			t.Fatal("non UTC pool connection", err)
		}
	}
	for _, c := range conns {
		c.Close()
	}
	t.Run("wrong instance", func(t *testing.T) {
		bad := b
		bad.Storage.InstanceID = "different-instance"
		f := EnterpriseFactory(config.DBConfig{Host: "127.0.0.1", Port: port, User: "root", Database: b.Storage.Database, ConnectionLimit: 1}, bad)
		if db, err := f(ctx, bad.Storage); err == nil {
			db.Close()
			t.Fatal("wrong server accepted")
		}
	})
	t.Run("wrong schema", func(t *testing.T) {
		bad := b
		bad.SchemaVersion = "v0"
		f := EnterpriseFactory(config.DBConfig{Host: "127.0.0.1", Port: port, User: "root", Database: b.Storage.Database, ConnectionLimit: 1}, bad)
		if db, err := f(ctx, bad.Storage); err == nil {
			db.Close()
			t.Fatal("wrong schema accepted")
		}
	})
	t.Run("wrong tenant ledger", func(t *testing.T) {
		bad := b
		bad.Key.Tenant = "another-tenant"
		f := EnterpriseFactory(config.DBConfig{Host: "127.0.0.1", Port: port, User: "root", Database: b.Storage.Database, ConnectionLimit: 1}, bad)
		if db, err := f(ctx, bad.Storage); err == nil {
			db.Close()
			t.Fatal("wrong tenant ledger accepted")
		}
	})
	t.Run("wrong database", func(t *testing.T) {
		f := EnterpriseFactory(config.DBConfig{Host: "127.0.0.1", Port: port, User: "root", Database: bindings["two"].Storage.Database, ConnectionLimit: 1}, b)
		if db, err := f(ctx, b.Storage); err == nil {
			db.Close()
			t.Fatal("wrong physical database accepted")
		}
	})
	t.Run("non transactional table", func(t *testing.T) {
		if _, err := root.Exec("ALTER TABLE `" + b.Storage.Database + "`.assets_facts ENGINE=MyISAM"); err != nil {
			t.Fatal(err)
		}
		f := factories[b.Storage.Database]
		if db, err := f(ctx, b.Storage); err == nil {
			db.Close()
			t.Fatal("MyISAM accepted")
		}
	})
}
