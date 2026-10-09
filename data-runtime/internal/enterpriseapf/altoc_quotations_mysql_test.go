package enterpriseapf

import (
	"context"
	"fmt"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
)

func TestAPFQuotationChainMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "q-customer", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	c, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "标记客户", "owner_uid": "person"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	cid := fmt.Sprint(c.(map[string]any)["data"].(map[string]any)["id"])
	who.Key = "q-create"
	i := QuotationInput{CustomerID: cid, Payload: map[string]any{"currency_code": "CNY"}}
	o, e := s.Quotation(ctx, "quotations-create", i, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(o.(map[string]any)["data"].(map[string]any)["id"])
	if _, e = s.Quotation(ctx, "quotations-create", i, who, scope); e != nil {
		t.Fatal(e)
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM altoc_quotation").Scan(&count)
	if count != 1 {
		t.Fatal("duplicate quote")
	}
	who.Key = "q-update"
	if _, e = s.Quotation(ctx, "quotations-update", QuotationInput{ID: id, Payload: map[string]any{"quotation_no": "MARKED", "expectedVersion": float64(1)}}, who, scope); e != nil {
		t.Fatal(e)
	}
	who.Key = "q-items"
	item := QuotationItem{Name: "标记明细", Quantity: "1.2500", Price: "100.00", Discount: "5.00", Tax: "6.00"}
	i = QuotationInput{ID: id, Payload: map[string]any{"expectedVersion": float64(2)}, Items: []QuotationItem{item, item}}
	o, e = s.Quotation(ctx, "quotation-items-replace", i, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	row := o.(map[string]any)["data"].(map[string]any)
	if row["amount_tax_inclusive"] != "237.50" || row["amount_tax_exclusive"] != "224.06" {
		t.Fatal("amounts", row)
	}
	if _, e = s.Quotation(ctx, "quotation-items-replace", i, who, scope); e != nil {
		t.Fatal(e)
	}
	db.QueryRow("SELECT COUNT(*) FROM altoc_quotation_item").Scan(&count)
	if count != 2 {
		t.Fatal("duplicate lines")
	}
	who.Key = "q-submit"
	if _, e = s.Quotation(ctx, "quotations-transition", QuotationInput{ID: id, Payload: map[string]any{"expectedVersion": float64(3), "action": "submit"}}, who, scope); e == nil {
		t.Fatal("unconnected approval submitted")
	}
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_command_receipt WHERE idempotency_key='q-submit'").Scan(&count)
	if count != 0 {
		t.Fatal("failed receipt")
	}
	// Synthetic authoritative approval fixture only; not a browser write path.
	if _, e = db.Exec("UPDATE altoc_quotation SET status='approved',workflow_instance_id='isolated-approved' WHERE id=?", id); e != nil {
		t.Fatal(e)
	}
	who.Key = "q-send"
	i = QuotationInput{ID: id, Payload: map[string]any{"expectedVersion": float64(3), "action": "send"}}
	if _, e = s.Quotation(ctx, "quotations-transition", i, who, scope); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Quotation(ctx, "quotations-transition", i, who, scope); e != nil {
		t.Fatal(e)
	}
	who.Key = "q-accept"
	if _, e = s.Quotation(ctx, "quotations-transition", QuotationInput{ID: id, Payload: map[string]any{"expectedVersion": float64(4), "action": "accept"}}, who, scope); e != nil {
		t.Fatal(e)
	}
	history, e := s.Quotation(ctx, "quotation-versions-list", QuotationInput{ID: id, Page: 1, PageSize: 1}, who, scope)
	if e != nil || history.(map[string]any)["total"] != 1 {
		t.Fatal(history, e)
	}
	version, e := s.Quotation(ctx, "quotation-versions-view", QuotationInput{ID: id, Version: 1}, who, scope)
	if e != nil || version.(map[string]any)["data"].(map[string]any)["status"] != "sent" {
		t.Fatal(version, e)
	}
	if _, e = s.Quotation(ctx, "quotations-update", QuotationInput{ID: id, Payload: map[string]any{"remark": "edit frozen", "expectedVersion": float64(5)}}, who, scope); e == nil {
		t.Fatal("approved content changed")
	}
	if _, e = s.QuotationRead(ctx, id, "other", scope, altoc.SalesReadQuery{Page: 1, PageSize: 20}); e == nil {
		t.Fatal("other actor read")
	}
	if _, e = s.QuotationRead(ctx, id, "person", scope, altoc.SalesReadQuery{Page: 1, PageSize: 20}); e != nil {
		t.Fatal(e)
	}
	db.Exec("UPDATE altoc_quotation SET owner_uid='other' WHERE id=?", id)
	who.Key = "q-send"
	if _, e = s.Quotation(ctx, "quotations-transition", i, who, scope); e == nil {
		t.Fatal("revoked replay")
	}
}

func TestAPFQuotationConcurrentVersionAndRollbackMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "r-customer", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	c, e := s.Customer(ctx, "customers-create", CustomerInput{Payload: map[string]any{"name": "rollback", "owner_uid": "person"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	who.Key = "r-create"
	out, e := s.Quotation(ctx, "quotations-create", QuotationInput{CustomerID: fmt.Sprint(c.(map[string]any)["data"].(map[string]any)["id"]), Payload: map[string]any{"currency_code": "CNY"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(out.(map[string]any)["data"].(map[string]any)["id"])
	results := make(chan error, 2)
	for _, key := range []string{"parallel-a", "parallel-b"} {
		go func(key string) {
			actor := who
			actor.Key = key
			_, err := s.Quotation(ctx, "quotations-update", QuotationInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "remark": key}}, actor, scope)
			results <- err
		}(key)
	}
	success := 0
	for n := 0; n < 2; n++ {
		if <-results == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("concurrent version successes=%d", success)
	}
	who.Key = "r-lines"
	good := QuotationItem{Name: "first", Quantity: "1.0000", Price: "1.00", Discount: "0.00", Tax: "0.00"}
	if _, e = s.Quotation(ctx, "quotation-items-replace", QuotationInput{ID: id, Payload: map[string]any{"expectedVersion": float64(2)}, Items: []QuotationItem{good}}, who, scope); e != nil {
		t.Fatal(e)
	}
	who.Key = "overflow"
	huge := good
	huge.Quantity = "99999999999999.9999"
	huge.Price = "9999999999999999.99"
	if _, e = s.Quotation(ctx, "quotation-items-replace", QuotationInput{ID: id, Payload: map[string]any{"expectedVersion": float64(3)}, Items: []QuotationItem{good, huge}}, who, scope); e == nil {
		t.Fatal("overflow accepted")
	}
	var count, version int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_quotation_item WHERE quotation_id=?", id).Scan(&count); e != nil || count != 1 {
		t.Fatal("partial line mutation", count, e)
	}
	if e = db.QueryRow("SELECT row_version FROM altoc_quotation WHERE id=?", id).Scan(&version); e != nil || version != 3 {
		t.Fatal("failed batch version changed", version, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_service_command_receipt WHERE idempotency_key='overflow'").Scan(&count); e != nil || count != 0 {
		t.Fatal("failed batch left receipt", count, e)
	}
}
