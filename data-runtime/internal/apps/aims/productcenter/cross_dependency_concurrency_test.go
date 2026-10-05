package productcenter

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestMySQLConcurrentOppositeCrossDependencies(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	for _, code := range []string{"P-RACE-A", "P-RACE-B"} {
		workspaceFixture(t, db, code)
	}
	a := planningFixture(t, db, "P-RACE-A")
	b := planningFixture(t, db, "P-RACE-B")
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.27_cross_product_dependencies.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var aBiz, bBiz string
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, a).Scan(&aBiz); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, b).Scan(&bBiz); err != nil {
		t.Fatal(err)
	}
	type request struct {
		identity       CommandIdentity
		input          CrossDependencyCreate
		source, target AuthorizationPermit
	}
	requests := []request{}
	for i, code := range []string{"P-RACE-A", "P-RACE-B"} {
		target, item, pred := "P-RACE-B", aBiz, bBiz
		if i == 1 {
			target, item, pred = "P-RACE-A", bBiz, aBiz
		}
		p := workspacePermit(t, db, code, "pm", "edit")
		p.Resource = "product_priorities"
		q := workspacePermit(t, db, target, "pm", "view")
		q.Resource = "product_priorities"
		requests = append(requests, request{CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:cross-dependency-create", IdempotencyKey: "opposite"}, CrossDependencyCreate{ItemBizID: item, PredecessorProductCode: target, PredecessorBizID: pred, ExpectedRevision: 1, ExpectedItemRevision: 1, ExpectedPredecessorProductRevision: 1, ExpectedPredecessorRevision: 1, Reason: "并发前置"}, p, q})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	type result struct {
		index int
		err   error
	}
	results := make(chan result, 2)
	for i, r := range requests {
		go func(i int, r request) {
			<-start
			_, e := CreateCrossDependency(ctx, db, r.identity, r.source, r.target, r.input)
			results <- result{i, e}
		}(i, r)
	}
	close(start)
	success, loser := 0, -1
	for range requests {
		r := <-results
		if r.err == nil {
			success++
		} else {
			loser = r.index
			requireProductRule(t, r.err, "product_authorization_changed")
		}
	}
	if success != 1 || loser < 0 {
		t.Fatalf("success count %d", success)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_cross_dependencies`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("edges %d %v", count, err)
	}
	retry := requests[loser]
	retry.source = workspacePermit(t, db, retry.identity.ProductCode, "pm", "edit")
	retry.source.Resource = "product_priorities"
	retry.target = workspacePermit(t, db, retry.input.PredecessorProductCode, "pm", "view")
	retry.target.Resource = "product_priorities"
	retry.input.ExpectedRevision = retry.source.Facts.Revision
	retry.input.ExpectedPredecessorProductRevision = retry.target.Facts.Revision
	if err = db.QueryRow(`SELECT revision FROM product_planning_items WHERE biz_id=?`, retry.input.PredecessorBizID).Scan(&retry.input.ExpectedPredecessorRevision); err != nil {
		t.Fatal(err)
	}
	_, err = CreateCrossDependency(ctx, db, retry.identity, retry.source, retry.target, retry.input)
	requireProductRule(t, err, "planning_dependency_cycle")
}
