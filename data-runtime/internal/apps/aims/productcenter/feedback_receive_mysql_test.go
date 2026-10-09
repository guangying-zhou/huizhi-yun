package productcenter

import (
	"context"
	"testing"
)

func TestMySQLFeedbackReceiveAtomic(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-FEEDBACK")
	input := FeedbackRequest{ActorUID: "pm", ProductCode: "P-FEEDBACK", TicketCode: "ST-1", RequestBizID: "00000000-0000-4000-8000-000000000001", Title: "需求", Description: "客户说明", Action: "create"}
	apply := func() error {
		permit := workspacePermit(t, db, "P-FEEDBACK", "pm", "create")
		permit.Resource = "product_requests"
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err = ReceiveFeedbackRequestTx(context.Background(), tx, input, permit, "test-operation"); err != nil {
			return err
		}
		return tx.Commit()
	}
	if _, err := db.Exec(`CREATE TRIGGER fail_feedback BEFORE INSERT ON product_feedback_bindings FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'`); err != nil {
		t.Fatal(err)
	}
	if err := apply(); err == nil {
		t.Fatal("injected failure ignored")
	}
	for _, table := range []string{"product_requests", "product_request_sources", "product_feedback_bindings"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("rollback %s %d %v", table, count, err)
		}
	}
	if _, err := db.Exec(`DROP TRIGGER fail_feedback`); err != nil {
		t.Fatal(err)
	}
	if err := apply(); err != nil {
		t.Fatal(err)
	}
	if err := apply(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_requests r JOIN product_request_sources s ON s.request_id=r.id JOIN product_feedback_bindings b ON b.source_id=s.id AND b.request_id=r.id WHERE r.urgency_level='P2' AND r.decision_status='submitted' AND s.verification_status='verified' AND s.direction='neutral'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("received source %d %v", count, err)
	}
	input.RequestBizID = "00000000-0000-4000-8000-000000000002"
	if err := apply(); err == nil {
		t.Fatal("same source created second request")
	}
}
