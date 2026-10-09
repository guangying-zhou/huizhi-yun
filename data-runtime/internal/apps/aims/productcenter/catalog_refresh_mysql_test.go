package productcenter

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"
)

func catalogPermit(uid string) CatalogPermit {
	return CatalogPermit{ActorUID: uid, Resource: "products", Action: "onboard", ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
}
func catalogPage(page, total int, watermark string) CatalogSourcePage {
	p := CatalogSourcePage{Page: page, PageSize: 100, Total: int64(total), Watermark: watermark, Items: []CatalogSourceItem{}}
	end := page * 100
	if end > total {
		end = total
	}
	for n := (page-1)*100 + 1; n <= end; n++ {
		p.Items = append(p.Items, CatalogSourceItem{ProductCode: fmt.Sprintf("P-%03d", n), ProductName: fmt.Sprintf("Product %d", n), ProductLine: "software", SourceStatus: "mvp", SourceUpdatedAt: "2026-09-07T12:00:00.000Z", Onboardable: true})
	}
	if end < total {
		next := page + 1
		p.NextPage = &next
	}
	return p
}
func TestMySQLCatalogRefreshAtomicActivationAndReplay(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	permit := catalogPermit("pm")
	r, err := StartCatalogRefresh(ctx, db, "pm", "key", permit)
	if err != nil {
		t.Fatal(err)
	}
	again, err := StartCatalogRefresh(ctx, db, "pm", "key", permit)
	if err != nil || again.BizID != r.BizID {
		t.Fatal("start not idempotent", err)
	}
	page := catalogPage(1, 101, "epoch:1")
	first, err := AppendCatalogPage(ctx, db, "pm", r.BizID, permit, 1, page)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != "staging" || first.RowCount != 100 || first.NextPage != 2 {
		t.Fatalf("first %#v", first)
	}
	replay, err := AppendCatalogPage(ctx, db, "pm", r.BizID, permit, 1, page)
	if err != nil || replay.Revision != first.Revision || replay.RowCount != 100 {
		t.Fatal("page replay", err)
	}
	var active int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_catalog_refreshes WHERE status='active'`).Scan(&active); err != nil || active != 0 {
		t.Fatal("partial generation active", err)
	}
	page.Items[0].ProductName = "changed"
	if _, err := AppendCatalogPage(ctx, db, "pm", r.BizID, permit, 1, page); err == nil {
		t.Fatal("changed replay accepted")
	}
	final, err := AppendCatalogPage(ctx, db, "pm", r.BizID, permit, 2, catalogPage(2, 101, "epoch:1"))
	if err != nil || final.Status != "active" || final.RowCount != 101 {
		t.Fatalf("final %#v %v", final, err)
	}
	if _, err := ReadCatalogRefresh(ctx, db, "other", r.BizID, catalogPermit("other")); err == nil {
		t.Fatal("other actor read refresh")
	}
	failed, err := StartCatalogRefresh(ctx, db, "pm", "failed", permit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", failed.BizID, permit, 1, catalogPage(1, 101, "epoch:2")); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", failed.BizID, permit, 2, catalogPage(2, 101, "epoch:3")); err == nil {
		t.Fatal("changed watermark accepted")
	}
	if _, err := FailCatalogRefresh(ctx, db, "pm", failed.BizID, permit); err != nil {
		t.Fatal(err)
	}
	var activeID string
	if err := db.QueryRow(`SELECT biz_id FROM product_catalog_refreshes WHERE status='active'`).Scan(&activeID); err != nil || activeID != r.BizID {
		t.Fatal("failed refresh replaced active", err)
	}
	empty, err := StartCatalogRefresh(ctx, db, "pm", "empty", permit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", empty.BizID, permit, 1, catalogPage(1, 0, "epoch:4")); err != nil {
		t.Fatal(err)
	}
	old, err := ReadCatalogRefresh(ctx, db, "pm", r.BizID, permit)
	if err != nil || old.Status != "superseded" {
		t.Fatal("old generation not superseded", err)
	}
}
func TestMySQLCatalogOlderGenerationCannotReplaceNewer(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	p := catalogPermit("pm")
	old, err := StartCatalogRefresh(ctx, db, "pm", "old", p)
	if err != nil {
		t.Fatal(err)
	}
	newer, err := StartCatalogRefresh(ctx, db, "pm", "new", p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", newer.BizID, p, 1, catalogPage(1, 1, "epoch:2")); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", old.BizID, p, 1, catalogPage(1, 1, "epoch:1")); err == nil {
		t.Fatal("old replaced new")
	}
	var rows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_catalog_projection WHERE generation=?`, old.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("rejected batch leaked", err)
	}
}
func TestMySQLCatalogReceiptFailureRollsBackActivation(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	p := catalogPermit("pm")
	r, err := StartCatalogRefresh(ctx, db, "pm", "new", p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER reject_catalog_receipt BEFORE INSERT ON product_catalog_page_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='receipt unavailable'`); err != nil {
		t.Fatal(err)
	}
	if _, err := AppendCatalogPage(ctx, db, "pm", r.BizID, p, 1, catalogPage(1, 1, "epoch:1")); err == nil {
		t.Fatal("receipt failure ignored")
	}
	after, err := ReadCatalogRefresh(ctx, db, "pm", r.BizID, p)
	if err != nil || !reflect.DeepEqual(after, r) {
		t.Fatalf("refresh changed %#v %v", after, err)
	}
	var rows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_catalog_projection`).Scan(&rows); err != nil || rows != 0 {
		t.Fatal("projection leaked", err)
	}
}
func TestCatalogPageValidation(t *testing.T) {
	for _, patch := range []func(*CatalogSourcePage){func(p *CatalogSourcePage) { p.PageSize = 101 }, func(p *CatalogSourcePage) { p.Items = p.Items[:0] }, func(p *CatalogSourcePage) { p.NextPage = nil }, func(p *CatalogSourcePage) { p.Items[1].ProductCode = p.Items[0].ProductCode }, func(p *CatalogSourcePage) { p.Items[0].SourceUpdatedAt = "yesterday" }} {
		p := catalogPage(1, 101, "epoch:1")
		patch(&p)
		if err := validateCatalogPage(p); err == nil {
			t.Fatal("invalid page accepted")
		}
	}
}

func TestMySQLCatalogConcurrentPageCommitsOnlyOnce(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	p := catalogPermit("pm")
	r, err := StartCatalogRefresh(ctx, db, "pm", "concurrent", p)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := AppendCatalogPage(ctx, db, "pm", r.BizID, p, 1, catalogPage(1, 101, "epoch:1"))
			errs <- e
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	after, err := ReadCatalogRefresh(ctx, db, "pm", r.BizID, p)
	if err != nil || after.RowCount != 100 || after.Revision != 2 {
		t.Fatalf("duplicated page %#v %v", after, err)
	}
	var receipts int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_catalog_page_receipts WHERE generation=?`, r.ID).Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("receipts=%d %v", receipts, err)
	}
	p.ExpiresAt = 1
	if _, err := AppendCatalogPage(ctx, db, "pm", r.BizID, p, 1, catalogPage(1, 101, "epoch:1")); err == nil {
		t.Fatal("expired authorization replayed")
	}
}
