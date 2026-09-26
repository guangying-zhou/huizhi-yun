package assets

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAssetCategoryCommandsMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ASSET_CATEGORY_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated temporary MySQL required")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") {
		t.Fatal("not isolated")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.ParseTime = true
	admin, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_category_%d", time.Now().UnixNano())
	if _, err = admin.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE `" + name + "`")
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	raw, err := os.ReadFile("../../../../assets/docs/assets_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"asset_category_groups", "asset_category_items", "assets_product_catalog_state"} {
		re := regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `?" + table + "`? \\(.*?ENGINE=InnoDB[^;]*;")
		ddl := re.FindString(string(raw))
		if ddl == "" {
			t.Fatal(table)
		}
		if _, err = db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"asset_category_groups", "asset_category_items", "assets_product_catalog_state"} {
		if _, err = db.Exec("RENAME TABLE `" + table + "` TO `assets_" + table + "`"); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec("CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `" + table + "` AS SELECT * FROM `assets_" + table + "`"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(`INSERT INTO assets_product_catalog_state(id,epoch,revision,ready) VALUES(1,UUID(),1,1)`); err != nil {
		t.Fatal(err)
	}
	for _, ddl := range regexp.MustCompile(`(?s)CREATE TRIGGER assets_pc_line_a[iud].*?END\$\$`).FindAllString(string(raw), -1) {
		ddl = strings.TrimSuffix(ddl, "$$")
		ddl = strings.ReplaceAll(ddl, "asset_category_groups", "assets_asset_category_groups")
		ddl = strings.ReplaceAll(ddl, "assets_product_catalog_state", "assets_assets_product_catalog_state")
		if _, err = db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	body := func(label, value string) map[string]any {
		return map[string]any{"label": label, "value": value, "shortCode": "a-b1中文", "enabled": true}
	}
	tx, _ := db.BeginTx(ctx, nil)
	created, err := SaveAssetCategoryInTransaction(ctx, tx, "product", 0, body("Current line", "LINE"), "manager")
	if err != nil {
		t.Fatal(err)
	}
	if created["label"] != "Current line" || created["shortCode"] != "AB1" {
		t.Fatal(created)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var n, rev int
	db.QueryRow(`SELECT COUNT(*) FROM asset_category_groups`).Scan(&n)
	db.QueryRow(`SELECT revision FROM assets_product_catalog_state WHERE id=1`).Scan(&rev)
	if n != 0 || rev != 1 {
		t.Fatal("outer rollback lost", n, rev)
	}
	var port int
	db.QueryRow(`SELECT @@port`).Scan(&port)
	if _, err = admin.Exec("CREATE USER 'category_fixture'@'127.0.0.1' IDENTIFIED BY 'isolated-category-fixture'"); err != nil {
		t.Fatal(err)
	}
	if _, err = admin.Exec("GRANT ALL ON `" + name + "`.* TO 'category_fixture'@'127.0.0.1'"); err != nil {
		t.Fatal(err)
	}
	base, err := compat.New(compat.Config{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "category_fixture", Password: "isolated-category-fixture", Database: name, ConnectionLimit: 2}})
	if err != nil {
		t.Fatal(err)
	}
	defer base.DB().Close()
	adapter := &Adapter{Adapter: base}
	created, err = adapter.saveAssetCategory(ctx, "product", 0, body("Current line", "LINE"), "manager")
	if err != nil {
		t.Fatal(err)
	}
	id := asInt(created["id"])
	tx, _ = db.BeginTx(ctx, nil)
	edited, err := SaveAssetCategoryInTransaction(ctx, tx, "product", id, body("Renamed line", "LINE"), "manager")
	if err != nil {
		t.Fatal(err)
	}
	if edited["label"] != "Renamed line" {
		t.Fatal(edited)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	list, err := adapter.listAssetCategories(ctx, "product", true)
	if err != nil || list[0]["label"] != "Renamed line" {
		t.Fatal(list, err)
	}
	// Original category API has no receipt/key; repeated create must reject, not claim replay.
	if _, err = adapter.saveAssetCategory(ctx, "product", 0, body("Duplicate", "LINE"), "manager"); err == nil {
		t.Fatal("duplicate accepted")
	}
	// Late item insert failure rolls back the preceding group rename and catalog trigger.
	db.QueryRow(`SELECT revision FROM assets_product_catalog_state WHERE id=1`).Scan(&rev)
	if _, err = db.Exec(`CREATE TRIGGER reject_category_item BEFORE INSERT ON assets_asset_category_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late fixture failure'`); err != nil {
		t.Fatal(err)
	}
	bad := body("Should rollback", "LINE")
	bad["items"] = []any{map[string]any{"label": "child", "value": "child"}}
	tx, _ = db.BeginTx(ctx, nil)
	if _, err = SaveAssetCategoryInTransaction(ctx, tx, "product", id, bad, "manager"); err == nil {
		t.Fatal("late failure accepted")
	}
	if err = tx.Commit(); err != sql.ErrTxDone {
		t.Fatal("failed supplied tx stayed active", err)
	}
	var label string
	db.QueryRow(`SELECT category_label FROM asset_category_groups WHERE id=?`, id).Scan(&label)
	db.QueryRow(`SELECT revision FROM assets_product_catalog_state WHERE id=1`).Scan(&n)
	if label != "Renamed line" || n != rev {
		t.Fatal("late failure persisted", label, n, rev)
	}
	db.Exec("DROP TRIGGER reject_category_item")
	for _, scope := range []string{"unknown", "physical"} {
		tx, _ = db.BeginTx(ctx, nil)
		if _, err = SaveAssetCategoryInTransaction(ctx, tx, scope, 0, body("Invalid", "INVALID"), "manager"); err == nil {
			t.Fatal("validation lost", scope)
		}
	}
	tx, _ = db.BeginTx(ctx, nil)
	if _, err = SaveAssetCategoryInTransaction(ctx, tx, "resource", id, body("Wrong scope", "LINE"), "manager"); err == nil {
		t.Fatal("scope mismatch accepted")
	}
	var wg sync.WaitGroup
	success := make(chan bool, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tx, e := db.BeginTx(ctx, nil)
			if e != nil {
				success <- false
				return
			}
			_, e = SaveAssetCategoryInTransaction(ctx, tx, "product", 0, body("Concurrent", "RACE"), "manager")
			if e == nil {
				e = tx.Commit()
			}
			success <- e == nil
		}()
	}
	wg.Wait()
	close(success)
	wins := 0
	for ok := range success {
		if ok {
			wins++
		}
	}
	if wins != 1 {
		t.Fatal("unique scope/value violated", wins)
	}
}
