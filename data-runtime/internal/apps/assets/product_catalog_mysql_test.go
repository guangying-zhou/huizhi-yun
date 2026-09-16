package assets

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func catalogMySQLFixture(t *testing.T) (*Adapter, *sql.DB) {
	t.Helper()
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires isolated product center MySQL socket")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-product-center.") {
		t.Fatal("isolated socket required")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 10 * time.Second
	cfg.WriteTimeout = 10 * time.Second
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_pc_catalog_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("DROP DATABASE `" + name + "`"); _ = db.Close() })
	for _, ddl := range []string{
		`CREATE TABLE product_assets(id BIGINT AUTO_INCREMENT PRIMARY KEY,product_code VARCHAR(64) NOT NULL UNIQUE,product_name VARCHAR(255) NOT NULL,product_line VARCHAR(64) NOT NULL,status VARCHAR(32) NOT NULL,business_owner_uid VARCHAR(64),technical_owner_uid VARCHAR(64),updated_at DATETIME(3) NOT NULL) ENGINE=InnoDB`,
		`CREATE TABLE asset_category_groups(id BIGINT AUTO_INCREMENT PRIMARY KEY,category_scope VARCHAR(32),category_value VARCHAR(64),category_label VARCHAR(128),sort_order INT,UNIQUE(category_scope,category_value)) ENGINE=InnoDB`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	// Same DB injection as the existing SQL mock adapters; no application bootstrap
	// or business database configuration is used by this isolated integration test.
	c := &compat.Adapter{}
	field := reflect.ValueOf(c).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	return &Adapter{Adapter: c}, db
}

func applyCatalogMigration(t *testing.T, db *sql.DB) {
	t.Helper()
	raw, err := os.ReadFile("../../../../assets/docs/migrations/20260907_product_catalog_watermark.sql")
	if err != nil {
		t.Fatal(err)
	}
	delimiter := ";"
	var b strings.Builder
	for _, line := range strings.Split(string(raw), "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "--") {
			continue
		}
		if strings.HasPrefix(trim, "DELIMITER ") {
			delimiter = strings.TrimPrefix(trim, "DELIMITER ")
			continue
		}
		b.WriteString(line + "\n")
		if strings.HasSuffix(trim, delimiter) {
			statement := strings.TrimSuffix(strings.TrimSpace(b.String()), delimiter)
			if _, err := db.Exec(statement); err != nil {
				t.Fatalf("migration: %v\n%s", err, statement)
			}
			b.Reset()
		}
	}
	if strings.TrimSpace(b.String()) != "" {
		t.Fatal("unterminated migration")
	}
}

func TestMySQLProductCatalogWatermarkAndPaging(t *testing.T) {
	a, db := catalogMySQLFixture(t)
	ctx := context.Background()
	if _, err := a.productCatalog(ctx, url.Values{}); err == nil {
		t.Fatal("missing migration accepted")
	}
	applyCatalogMigration(t, db)
	for n := 1; n <= 101; n++ {
		if _, err := db.Exec(`INSERT INTO product_assets(product_code,product_name,product_line,status,updated_at) VALUES (?,?,'software','mvp',UTC_TIMESTAMP(3))`, fmt.Sprintf("P-%03d", n), fmt.Sprintf("Product %d", n)); err != nil {
			t.Fatal(err)
		}
	}
	first, err := a.productCatalog(ctx, url.Values{})
	if err != nil || len(first.Items) != 100 || first.Total != 101 || first.NextPage == nil {
		t.Fatalf("first page %#v: %v", first, err)
	}
	second, err := a.productCatalog(ctx, url.Values{"page": {"2"}, "watermark": {first.Watermark}})
	if err != nil || len(second.Items) != 1 || second.Items[0].ProductCode != "P-101" || second.NextPage != nil {
		t.Fatalf("second %#v: %v", second, err)
	}
	exact, err := a.productCatalog(ctx, url.Values{"code": {"p-001"}})
	if err != nil || exact.Total != 0 {
		t.Fatal("code matching must preserve case", err)
	}
	mutations := []string{
		`UPDATE product_assets SET product_name='Changed' WHERE product_code='P-001'`,
		`INSERT INTO asset_category_groups(category_scope,category_value,category_label,sort_order) VALUES ('product','software','Software',10)`,
		`UPDATE asset_category_groups SET category_label='Renamed' WHERE category_scope='product'`,
		`DELETE FROM asset_category_groups WHERE category_scope='product'`,
		`DELETE FROM product_assets WHERE product_code='P-101'`,
	}
	for _, mutation := range mutations {
		old, err := a.productCatalog(ctx, url.Values{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(mutation); err != nil {
			t.Fatal(err)
		}
		if _, err := a.productCatalog(ctx, url.Values{"page": {"2"}, "watermark": {old.Watermark}}); err == nil {
			t.Fatalf("stale watermark accepted: %s", mutation)
		}
	}
	before, err := a.productCatalog(ctx, url.Values{})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE product_assets SET product_name='Rolled back' WHERE product_code='P-001'`); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	after, err := a.productCatalog(ctx, url.Values{})
	if err != nil || before.Watermark != after.Watermark {
		t.Fatal("rollback changed watermark", err)
	}
	applyCatalogMigration(t, db)
	if _, err := a.productCatalog(ctx, url.Values{"watermark": {before.Watermark}}); err == nil {
		t.Fatal("migration replay did not invalidate watermark")
	}
	if _, err := db.Exec(`UPDATE assets_product_catalog_state SET ready=0 WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.productCatalog(ctx, url.Values{}); err == nil {
		t.Fatal("partial migration served")
	}
}
