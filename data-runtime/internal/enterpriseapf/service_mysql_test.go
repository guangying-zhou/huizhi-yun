package enterpriseapf

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

func TestAPFSamplesMySQL(t *testing.T) {
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
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
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	name := "hzy_apf_sample_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP DATABASE " + name) })
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	exec := func(q string) {
		t.Helper()
		if _, err = db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','runtime-test','v1',7)")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: "C000001", Environment: "test", RuntimeDeployment: "runtime-test"}, Storage: enterprise.Storage{Database: name, InstanceID: instance, Address: "127.0.0.1:3306"}, SchemaVersion: "v1", Generation: 7, Domains: map[string]enterprise.DomainBinding{}}
	b, err = domaininstall.WithAPF(b, "host-test")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, domain := range []string{"altoc", "finance", "people"} {
		tables, _ := domaininstall.APFTables(domain)
		for _, table := range tables {
			exec(table.DDL)
		}
		d := b.Domains[domain]
		if domain != "people" {
			d.Write = enterprise.PathUnified
		}
		d.Scheduler = enterprise.PathUnified
		b.Domains[domain] = d
	}
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	s, err := New(registry, b)
	if err != nil {
		t.Fatal(err)
	}
	all := altoc.BasicReadScope{Access: "all", DepartmentCodes: []string{}}
	for _, domain := range []string{"altoc", "finance"} {
		t.Run(domain, func(t *testing.T) {
			input := Input{Code: "MARKED-" + domain, Name: "isolated"}
			identity := Identity{Actor: "person-a", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", RequestID: "apf-test", Key: "apf-" + domain}
			out, e := s.Save(ctx, domain, input, identity, all)
			if e != nil {
				t.Fatal(e)
			}
			id := out.(map[string]any)["id"].(string)
			replay, e := s.Save(ctx, domain, input, identity, all)
			if e != nil || !replay.(map[string]any)["replayed"].(bool) {
				t.Fatal("not replayed", e)
			}
			input.Name = "changed"
			if _, e = s.Save(ctx, domain, input, identity, all); e == nil {
				t.Fatal("changed intent reused key")
			}
			input.Name = "isolated"
			data, e := s.Read(ctx, domain, "list", Input{Page: 1, PageSize: 1}, identity.Actor, all)
			if e != nil || data.(map[string]any)["total"] != int64(1) {
				t.Fatal("page count", data, e)
			}
			if _, e = s.Read(ctx, domain, "view", Input{ID: id}, identity.Actor, all); e != nil {
				t.Fatal(e)
			}
			if _, e = s.Save(ctx, domain, input, identity, altoc.BasicReadScope{Access: "none"}); e == nil {
				t.Fatal("revoked scope replayed")
			}
			input.ID = id
			input.RowVersion = 1
			input.Name = "edited"
			identity.Key += "-update"
			if _, e = s.Save(ctx, domain, input, identity, all); e != nil {
				t.Fatal(e)
			}
			identity.Key += "-stale"
			if _, e = s.Save(ctx, domain, input, identity, all); e == nil {
				t.Fatal("stale rowVersion accepted")
			}
			audit := domain + "_audit_log"
			var n int
			if e = db.QueryRow("SELECT COUNT(*) FROM " + audit).Scan(&n); e != nil || n != 2 {
				t.Fatal("audit duplicated", n, e)
			}
			if domain == "altoc" {
				if _, e = s.Read(ctx, domain, "view", Input{ID: id}, "other", altoc.BasicReadScope{Access: "self"}); e == nil {
					t.Fatal("other owner visible")
				}
				denied, e := s.Authorize(ctx, domain, Input{ID: id}, "other", altoc.BasicReadScope{Access: "self"})
				if e != nil || denied.(map[string]any)["allowed"] != false {
					t.Fatal("purpose widened", denied, e)
				}
			}
			if _, e = s.Inspect(ctx, domain); e != nil {
				t.Fatal(e)
			}
		})
	}
	exec("INSERT INTO people_positions(position_code,position_name) VALUES('MARKED','isolated')")
	if _, err = s.Read(ctx, "people", "list", Input{Page: 1, PageSize: 1}, "person-a", all); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Save(ctx, "people", Input{Code: "MARKED", Name: "x"}, Identity{}, all); err == nil {
		t.Fatal("People write enabled")
	}
	if _, err = s.Inspect(ctx, "people"); err != nil {
		t.Fatal(err)
	}
	// Generation changes fence all three channels without changing mappings.
	exec("UPDATE enterprise_schema_registry SET generation=8 WHERE id=1")
	if _, err = s.Read(ctx, "people", "list", Input{Page: 1, PageSize: 1}, "person-a", all); err == nil {
		t.Fatal("stale generation read")
	}
	if _, err = s.Inspect(ctx, "finance"); err == nil {
		t.Fatal("stale generation scheduler")
	}
}
