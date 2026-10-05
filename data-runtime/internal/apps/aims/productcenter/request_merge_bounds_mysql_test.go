package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"testing"
)

func TestMySQLMergeTrailBoundsAndCrossProductIsolation(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-TRAIL")
	workspaceFixture(t, db, "P-OTHER")
	ctx := context.Background()
	permit := func(code, action string) AuthorizationPermit {
		p := workspacePermit(t, db, code, "pm", action)
		p.Resource = "product_requests"
		return p
	}
	create := func(code string, revision uint64) RequestRecord {
		result, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: fmt.Sprint(revision)}, permit(code, "create"), RequestDraft{ExpectedRevision: revision, Title: fmt.Sprintf("需求 %d", revision), ProblemStatement: "边界测试", SourceType: "internal", UrgencyLevel: "P2"})
		if err != nil {
			t.Fatal(err)
		}
		var value struct {
			BizID string `json:"biz_id"`
		}
		if err := json.Unmarshal(result.Value, &value); err != nil {
			t.Fatal(err)
		}
		record, err := ReadProductRequest(ctx, db, code, "pm", value.BizID, permit(code, "view"))
		if err != nil {
			t.Fatal(err)
		}
		return record
	}
	records := []RequestRecord{}
	for i := 1; i <= 66; i++ {
		records = append(records, create("P-TRAIL", uint64(i)))
	}
	foreign := create("P-OTHER", 1)
	// Isolated fixtures model a long valid historical chain without performing
	// dozens of unrelated UI commands. Reads must neither truncate silently nor write.
	for i := 0; i < 65; i++ {
		if _, err := db.Exec(`UPDATE product_requests SET decision_status='merged',merged_into_id=? WHERE id=?`, records[i+1].ID, records[i].ID); err != nil {
			t.Fatal(err)
		}
	}
	read := func(index int) (RequestRecord, error) {
		return ReadProductRequest(ctx, db, "P-TRAIL", "pm", records[index].BizID, permit("P-TRAIL", "view"))
	}
	long, err := read(0)
	if err != nil || len(long.MergeTrail) != 64 || !long.MergeTrailTruncated {
		t.Fatalf("long trail %+v %v", long, err)
	}
	exact, err := read(1)
	if err != nil || len(exact.MergeTrail) != 64 || exact.MergeTrailTruncated || exact.MergeTrail[63].BizID != records[65].BizID {
		t.Fatalf("exact bound %+v %v", exact, err)
	}
	_, err = ListProductRequests(ctx, db, "P-TRAIL", "pm", permit("P-TRAIL", "view"), RequestPageQuery{Page: 1, PageSize: 10, MergedIntoBizID: foreign.BizID})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign target query: %v", err)
	}
	// The composite foreign key is an independent cross-product write barrier.
	_, err = db.Exec(`UPDATE product_requests SET merged_into_id=? WHERE id=?`, foreign.ID, records[0].ID)
	var mysqlError *mysql.MySQLError
	if !errors.As(err, &mysqlError) || mysqlError.Number != 1452 {
		t.Fatalf("foreign merge edge was not rejected: %v", err)
	}
	unchanged, err := read(0)
	if err != nil || len(unchanged.MergeTrail) != 64 || unchanged.MergeTrail[0].BizID != records[1].BizID {
		t.Fatalf("foreign edge changed original trail %+v %v", unchanged, err)
	}
}
