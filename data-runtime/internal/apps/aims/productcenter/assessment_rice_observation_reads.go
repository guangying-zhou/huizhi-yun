package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type RICEObservationView struct {
	Observation       RICEReachObservation `json:"observation"`
	Stale             bool                 `json:"stale"`
	WorkspaceRevision uint64               `json:"workspace_revision"`
	ItemRevision      uint64               `json:"item_revision"`
}

// Caller holds the authorized product root lock. Columns independently bind
// snapshot identity so a malformed stored document cannot escape item scope.
func loadRICEReachObservation(ctx context.Context, tx *sql.Tx, code, itemBizID, observationBizID string) (RICEReachObservation, error) {
	var out RICEReachObservation
	var snapshot json.RawMessage
	var version, recorder string
	var scopeRevision, evidenceRevision uint64
	var reach int64
	err := tx.QueryRowContext(ctx, `SELECT o.snapshot,o.model_version,o.scope_revision,o.evidence_revision,o.reach_count,o.recorded_by FROM product_rice_reach_observations o JOIN product_planning_items i ON i.id=o.planning_item_id AND BINARY i.product_code=BINARY o.product_code WHERE BINARY o.product_code=BINARY ? AND BINARY i.biz_id=BINARY ? AND BINARY o.biz_id=BINARY ?`, code, itemBizID, observationBizID).Scan(&snapshot, &version, &scopeRevision, &evidenceRevision, &reach, &recorder)
	if err != nil {
		return out, err
	}
	if json.Unmarshal(snapshot, &out) != nil || out.BizID != observationBizID || out.ProductCode != code || out.ItemBizID != itemBizID || out.ModelVersion != version || out.ScopeRevision != scopeRevision || out.EvidenceRevision != evidenceRevision || out.Reach != reach || out.RecordedBy != recorder {
		return RICEReachObservation{}, invalid("rice_observation_invalid", "Reach 观测快照与存储身份不一致")
	}
	var config json.RawMessage
	if err = tx.QueryRowContext(ctx, `SELECT configuration FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? AND BINARY version=BINARY ?`, code, version).Scan(&config); err != nil {
		return out, err
	}
	model, err := loadFrozenRICEModel(ctx, tx, code, version, config)
	if err != nil {
		return out, err
	}
	if err = ValidateRICEReachObservation(model, out, code, itemBizID, scopeRevision, evidenceRevision); err != nil {
		return out, err
	}
	return out, nil
}

func ReadRICEReachObservation(ctx context.Context, db *sql.DB, code, uid, itemBizID, observationBizID string, permit AuthorizationPermit) (RICEObservationView, error) {
	var out RICEObservationView
	for _, value := range []string{itemBizID, observationBizID} {
		parsed, err := uuid.Parse(value)
		if err != nil || parsed.String() != value {
			return out, invalid("rice_observation_invalid", "Reach 观测或事项标识无效")
		}
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	item, err := loadPlanningItemDetail(ctx, tx, code, itemBizID)
	if err != nil {
		return out, err
	}
	observation, err := loadRICEReachObservation(ctx, tx, code, itemBizID, observationBizID)
	if err != nil {
		return out, err
	}
	out = RICEObservationView{Observation: observation, Stale: observation.ScopeRevision != item.ScopeRevision || observation.EvidenceRevision != item.EvidenceRevision, WorkspaceRevision: permit.Facts.Revision, ItemRevision: item.Revision}
	return out, tx.Commit()
}

type RICEObservationPage struct {
	Items             []RICEObservationView `json:"items"`
	Total             int                   `json:"total"`
	Page              int                   `json:"page"`
	PageSize          int                   `json:"pageSize"`
	ProductCode       string                `json:"product_code"`
	ItemBizID         string                `json:"item_biz_id"`
	WorkspaceRevision uint64                `json:"workspace_revision"`
	ItemRevision      uint64                `json:"item_revision"`
}

func ListRICEReachObservations(ctx context.Context, db *sql.DB, code, uid, itemBizID string, permit AuthorizationPermit, page, pageSize int) (RICEObservationPage, error) {
	out := RICEObservationPage{Items: []RICEObservationView{}, ProductCode: code, ItemBizID: itemBizID, Page: page, PageSize: pageSize}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: page, PageSize: pageSize}); err != nil {
		return out, err
	}
	parsed, err := uuid.Parse(itemBizID)
	if err != nil || parsed.String() != itemBizID {
		return out, invalid("rice_observation_invalid", "事项标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	item, err := loadPlanningItemDetail(ctx, tx, code, itemBizID)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	out.ItemRevision = item.Revision
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_rice_reach_observations WHERE BINARY product_code=BINARY ? AND planning_item_id=?`, code, item.ID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT biz_id FROM product_rice_reach_observations WHERE BINARY product_code=BINARY ? AND planning_item_id=? ORDER BY id DESC LIMIT ? OFFSET ?`, code, item.ID, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	// Close rows before loading snapshots on this transaction's connection.
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return out, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	for _, id := range ids {
		observation, e := loadRICEReachObservation(ctx, tx, code, itemBizID, id)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, RICEObservationView{Observation: observation, Stale: observation.ScopeRevision != item.ScopeRevision || observation.EvidenceRevision != item.EvidenceRevision, WorkspaceRevision: out.WorkspaceRevision, ItemRevision: item.Revision})
	}
	return out, tx.Commit()
}
