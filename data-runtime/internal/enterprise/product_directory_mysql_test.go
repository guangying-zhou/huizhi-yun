package enterprise_test

import (
	"context"
	"database/sql"
	"errors"
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
	runtimeDB "github.com/huizhi-yun/data-runtime/internal/db"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// The fixture replaces policy evaluation only. SQL queries, transactions,
// connection identity validation, tables and cross-domain reads are real MySQL.
type directoryFixtureAuthorizer struct {
	all      bool
	codes    []string
	denyAims bool
}

func (a directoryFixtureAuthorizer) AssetsProductsView(_ context.Context, _ *sql.Tx, id e.DirectoryIdentity) (e.DirectoryGrant, error) {
	return e.DirectoryGrant{Key: id.Key, ActorUID: id.ActorUID, SchemaVersion: id.SchemaVersion, Generation: id.Generation, ExpiresAt: time.Now().Add(time.Minute), AllProducts: a.all, ProductCodes: a.codes}, nil
}
func (a directoryFixtureAuthorizer) AimsProductsView(context.Context, *sql.Tx, e.DirectoryIdentity, string) error {
	if a.denyAims {
		return errors.New("denied")
	}
	return nil
}
func TestDirectoryIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated /tmp/hzy-product-center.* MySQL socket")
	}
	if clean := filepath.Clean(socket); !strings.HasPrefix(clean, "/tmp/hzy-product-center.") && !strings.HasPrefix(clean, "/tmp/hzy-test-mysql-") {
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
	t.Cleanup(func() { root.Close() })
	var instance string
	var port int
	if err := root.QueryRow("SELECT @@server_uuid,@@port").Scan(&instance, &port); err != nil {
		t.Fatal(err)
	}
	// The fixture reaches its own storage over TCP, while an isolated harness
	// only grants root on the local socket. Provision a throwaway TCP account
	// scoped to the schemas this test creates rather than widening root.
	tcpUser := "hzy_dir_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	tcpPassword := strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.Exec("CREATE USER '" + tcpUser + "'@'127.0.0.1' IDENTIFIED BY '" + tcpPassword + "'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec("DROP USER '" + tcpUser + "'@'127.0.0.1'"); err != nil {
			t.Error(err)
		}
	})
	bindings := map[string]e.Binding{}
	factories := map[string]e.ConnectionFactory{}
	for _, tenant := range []string{"one", "two"} {
		schema := "hzy_enterprise_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if _, err := root.Exec("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if _, err := root.Exec("DROP DATABASE `" + schema + "`"); err != nil {
				t.Error(err)
			}
		})
		exec := func(query string, args ...any) {
			t.Helper()
			c, err := root.Conn(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			if _, err := c.ExecContext(context.Background(), "USE `"+schema+"`"); err != nil {
				t.Fatal(err)
			}
			if _, err := c.ExecContext(context.Background(), query, args...); err != nil {
				t.Fatal(err)
			}
		}
		for _, ddl := range []string{
			"CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(100),environment_code VARCHAR(100),runtime_deployment VARCHAR(100),schema_version VARCHAR(100),generation BIGINT) ENGINE=InnoDB",
			"CREATE TABLE assets_product_assets(product_code VARCHAR(64) PRIMARY KEY,product_name VARCHAR(255),product_line VARCHAR(64),status VARCHAR(64)) ENGINE=InnoDB",
			"CREATE TABLE assets_asset_category_groups(category_scope VARCHAR(64),category_value VARCHAR(64),category_label VARCHAR(255),UNIQUE KEY scope_value(category_scope,category_value)) ENGINE=InnoDB",
			"CREATE TABLE assets_product_catalog_state(id INT PRIMARY KEY,epoch VARCHAR(64),revision BIGINT,ready INT) ENGINE=InnoDB",
			"CREATE TABLE aims_product_workspaces(product_code VARCHAR(64) PRIMARY KEY,revision BIGINT) ENGINE=InnoDB",
			"CREATE TABLE aims_product_component_sources(source_product_code VARCHAR(64) PRIMARY KEY,product_code VARCHAR(64),source_product_name VARCHAR(255)) ENGINE=InnoDB",
		} {
			exec(ddl)
		}
		if _, err := root.Exec("GRANT ALL PRIVILEGES ON `" + schema + "`.* TO '" + tcpUser + "'@'127.0.0.1'"); err != nil {
			t.Fatal(err)
		}
		exec("INSERT INTO enterprise_schema_registry VALUES(1,?,'isolated',?,'v1',1)", tenant, tenant+"-runtime")
		exec("INSERT INTO assets_product_assets VALUES('A',?,'visible','iterating'),('B',?,'hidden','poc')", tenant+" current", tenant+" hidden")
		exec("INSERT INTO assets_asset_category_groups VALUES('product','visible',?),('product','hidden','Secret line')", tenant+" line")
		exec("INSERT INTO assets_product_catalog_state VALUES(1,'epoch',1,1)")
		exec("INSERT INTO aims_product_workspaces VALUES('~line-one',7)")
		exec("INSERT INTO aims_product_component_sources VALUES('A','~line-one','historical source')")
		b := e.Binding{Key: e.BindingKey{Tenant: tenant, Environment: "isolated", RuntimeDeployment: tenant + "-runtime"}, Storage: e.Storage{InstanceID: instance, Address: fmt.Sprintf("127.0.0.1:%d", port), Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"assets": {OwnerDeployment: tenant + "-assets", Tables: map[string]string{"product_assets": "assets_product_assets", "asset_category_groups": "assets_asset_category_groups", "assets_product_catalog_state": "assets_product_catalog_state"}, Read: e.PathUnified, Write: e.PathDisabled, Scheduler: e.PathDisabled}, "aims": {OwnerDeployment: tenant + "-aims", Tables: map[string]string{"product_workspaces": "aims_product_workspaces", "product_component_sources": "aims_product_component_sources"}, Read: e.PathUnified, Write: e.PathDisabled, Scheduler: e.PathDisabled}}}
		bindings[tenant] = b
		factories[schema] = runtimeDB.EnterpriseFactory(config.DBConfig{Host: "127.0.0.1", Port: port, User: tcpUser, Password: tcpPassword, Database: schema, ConnectionLimit: 3}, b)
	}
	registry := e.NewRegistry(func(ctx context.Context, s e.Storage) (*sql.DB, error) { return factories[s.Database](ctx, s) })
	t.Cleanup(func() { registry.Close() })
	for _, b := range bindings {
		if err := registry.Register(context.Background(), b); err != nil {
			t.Fatal(err)
		}
	}
	identity := func(tenant string) e.DirectoryIdentity {
		b := bindings[tenant]
		return e.DirectoryIdentity{SourceDomain: "aims", Key: b.Key, ActorUID: "user", SchemaVersion: b.SchemaVersion, Generation: b.Generation, AssetsOwnerDeployment: tenant + "-assets", AimsOwnerDeployment: tenant + "-aims"}
	}
	service := e.ProductDirectoryService{Registry: registry, Authorizer: directoryFixtureAuthorizer{codes: []string{"A"}}}
	q := e.DirectoryQuery{Page: 1, PageSize: 10}
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		for _, tenant := range []string{"one", "two"} {
			wg.Add(1)
			go func(tenant string) {
				defer wg.Done()
				page, err := service.List(ctx, identity(tenant), q)
				if err != nil {
					t.Error(err)
					return
				}
				if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ProductName != tenant+" current" || len(page.ProductLines) != 1 || page.ProductLines[0].Code != "visible" {
					t.Error("cross tenant or out-of-scope disclosure")
				}
			}(tenant)
		}
	}
	wg.Wait()
	b := bindings["one"]
	if _, err := root.Exec("UPDATE `" + b.Storage.Database + "`.assets_product_assets SET product_name='renamed now' WHERE product_code='A'"); err != nil {
		t.Fatal(err)
	}
	if _, err := root.Exec("UPDATE `" + b.Storage.Database + "`.assets_asset_category_groups SET category_label='renamed line' WHERE category_value='visible'"); err != nil {
		t.Fatal(err)
	}
	page, err := service.ListForAimsWorkspace(ctx, identity("one"), q, "~line-one")
	if err != nil {
		t.Fatal(err)
	}
	if page.Items[0].ProductName != "renamed now" || page.Items[0].ProductLineLabel == nil || *page.Items[0].ProductLineLabel != "renamed line" || page.WorkspaceRevision == nil || *page.WorkspaceRevision != 7 {
		t.Fatal("authoritative rename not reflected")
	}
	var snapshot string
	if err := root.QueryRow("SELECT source_product_name FROM `" + b.Storage.Database + "`.aims_product_component_sources WHERE source_product_code='A'").Scan(&snapshot); err != nil || snapshot != "historical source" {
		t.Fatal("history changed", err)
	}
	service.Authorizer = directoryFixtureAuthorizer{all: true}
	page, err = service.ListForAimsWorkspace(ctx, identity("one"), q, "~line-one")
	if err != nil || page.Total != 1 {
		t.Fatal("unonboarded source included", err)
	}
	service.Authorizer = directoryFixtureAuthorizer{codes: []string{"B"}}
	page, err = service.ListForAimsWorkspace(ctx, identity("one"), q, "~line-one")
	if err != nil || page.Total != 0 || len(page.ProductLines) != 0 {
		t.Fatal("workspace broadened Assets permissions", err)
	}
	service.Authorizer = directoryFixtureAuthorizer{all: true, denyAims: true}
	if _, err := service.ListForAimsWorkspace(ctx, identity("one"), q, "~line-one"); !errors.Is(err, e.ErrDirectoryAccess) {
		t.Fatal("Aims authorization bypass", err)
	}
	service.Authorizer = directoryFixtureAuthorizer{all: true}
	q.Watermark = "stale"
	if _, err := service.List(ctx, identity("one"), q); !errors.Is(err, e.ErrDirectoryChanged) {
		t.Fatal("stale watermark accepted", err)
	}

	// Batch names and aggregates stay inside the same grant: an unreadable code
	// is reported exactly like a missing one, and counts never include it.
	service.Authorizer = directoryFixtureAuthorizer{codes: []string{"A"}}
	resolved, err := service.Resolve(ctx, identity("one"), []string{"A", "B", "MISSING"})
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved.Items) != 1 || resolved.Items[0].ProductCode != "A" || resolved.Items[0].ProductName != "renamed now" {
		t.Fatalf("batch names outside grant: %#v", resolved.Items)
	}
	if len(resolved.Unresolved) != 2 || resolved.Unresolved[0] != "B" || resolved.Unresolved[1] != "MISSING" {
		t.Fatalf("invisible and absent codes must be indistinguishable: %#v", resolved.Unresolved)
	}
	if resolved.Summary.Total != 1 || resolved.Summary.ByStatus["iterating"] != 1 || len(resolved.Summary.ByLine) != 1 || resolved.Summary.ByLine[0].Count != 1 {
		t.Fatalf("aggregate leaked unauthorized products: %#v", resolved.Summary)
	}
	if _, ok := resolved.Summary.ByStatus["poc"]; ok {
		t.Fatal("hidden product status leaked into aggregate")
	}
	for _, line := range resolved.Summary.ByLine {
		if line.Code == "hidden" || (line.Label != nil && *line.Label == "Secret line") {
			t.Fatal("hidden product line leaked into aggregate")
		}
	}
	// Cross-tenant codes resolve to nothing even with an all-products grant.
	service.Authorizer = directoryFixtureAuthorizer{all: true}
	crossed, err := service.Resolve(ctx, identity("two"), []string{"A"})
	if err != nil {
		t.Fatal(err)
	}
	if len(crossed.Items) != 1 || crossed.Items[0].ProductName != "two current" {
		t.Fatalf("tenant two resolved another tenant's fact: %#v", crossed.Items)
	}
	service.Authorizer = directoryFixtureAuthorizer{all: true, denyAims: true}
	if _, err := service.Resolve(ctx, identity("one"), []string{"A"}); !errors.Is(err, e.ErrDirectoryAccess) {
		t.Fatal("Aims authorization bypass in resolve", err)
	}
	if _, err := root.Exec("UPDATE `" + b.Storage.Database + "`.assets_product_catalog_state SET ready=0 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	service.Authorizer = directoryFixtureAuthorizer{all: true}
	if _, err := service.Resolve(ctx, identity("one"), []string{"A"}); !errors.Is(err, e.ErrDirectoryChanged) {
		t.Fatal("resolve ignored catalog readiness", err)
	}

	// The frozen in-process binding is not proof that this instance still owns
	// the current generation. Once an operator or a recovery switches the
	// persistent registry forward, directory reads must stop rather than keep
	// serving a superseded generation, and the fence must be held for the whole
	// read instead of being sampled before the transaction starts.
	if _, err := root.Exec("UPDATE `" + b.Storage.Database + "`.assets_product_catalog_state SET ready=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := root.Exec("UPDATE `" + b.Storage.Database + "`.enterprise_schema_registry SET generation=2 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	fresh := e.DirectoryQuery{Page: 1, PageSize: 10}
	if _, err := service.List(ctx, identity("one"), fresh); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("list served a superseded generation", err)
	}
	if _, err := service.ListForAimsWorkspace(ctx, identity("one"), fresh, "~line-one"); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("workspace list served a superseded generation", err)
	}
	if _, err := service.Resolve(ctx, identity("one"), []string{"A"}); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("resolve served a superseded generation", err)
	}
	// Fencing one tenant must not fence an unrelated tenant sharing the instance.
	if _, err := service.List(ctx, identity("two"), fresh); err != nil {
		t.Fatal("unrelated tenant fenced by another tenant's generation change", err)
	}
	if _, err := service.Resolve(ctx, identity("two"), []string{"A"}); err != nil {
		t.Fatal("unrelated tenant resolve fenced by another tenant's generation change", err)
	}
}
