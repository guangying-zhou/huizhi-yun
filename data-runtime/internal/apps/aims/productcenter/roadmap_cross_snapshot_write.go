package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

// Read before writing: INSERT ... SELECT may use locking/current reads under
// MySQL RR and would not preserve the snapshot used by commitment validation.
func saveRoadmapCrossSnapshots(ctx context.Context, tx *sql.Tx, code string, itemID, commitmentID int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT d.biz_id,d.revision,p.product_code,p.biz_id,p.revision,
 JSON_OBJECT('dependency_biz_id',d.biz_id,'dependency_revision',d.revision,'reason',d.reason,
 'product_code',p.product_code,'product_status',w.status,'workspace_revision',w.revision,
 'biz_id',p.biz_id,'revision',p.revision,'title',p.title,'scope_summary',p.scope_summary,
 'scope_revision',p.scope_revision,'evidence_revision',p.evidence_revision,'lifecycle',p.lifecycle,
 'investment_category',p.investment_category,'urgency_level',p.urgency_level,'deadline',p.deadline,
 'roadmap_starts_on',p.roadmap_starts_on,'roadmap_ends_on',p.roadmap_ends_on)
 FROM product_cross_dependencies d JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.predecessor_product_code
 JOIN product_workspaces w ON w.product_code=p.product_code
 WHERE d.planning_item_id=? AND BINARY d.product_code=BINARY ? ORDER BY d.biz_id LIMIT 10001`, itemID, code)
	if err != nil {
		return err
	}
	type record struct {
		edge, product, item        string
		edgeRevision, itemRevision uint64
		snapshot                   json.RawMessage
	}
	records := []record{}
	for rows.Next() {
		var r record
		if err = rows.Scan(&r.edge, &r.edgeRevision, &r.product, &r.item, &r.itemRevision, &r.snapshot); err != nil {
			rows.Close()
			return err
		}
		records = append(records, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(records) > 10000 {
		return invalid("planning_dependency_limit", "依赖记录超过支持上限")
	}
	for _, r := range records {
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_roadmap_cross_dependency_snapshots(commitment_id,dependency_biz_id,dependency_revision,predecessor_product_code,predecessor_biz_id,predecessor_revision,snapshot,created_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, commitmentID, r.edge, r.edgeRevision, r.product, r.item, r.itemRevision, []byte(r.snapshot)); err != nil {
			return err
		}
	}
	return nil
}
