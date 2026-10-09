package assets

import (
	"context"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"time"
)

// Host signature binds this private authorization; it is never taken from a
// browser query. Both target families retain their owning scope compiler.
func (a *Adapter) EnterpriseCustomerKnowledgeRead(ctx context.Context, customer, asset, environment, actor, raw, action string) (map[string]any, error) {
	q, e := knowledgeScopes(raw, actor, action)
	if e != nil {
		return nil, e
	}
	if a.enterpriseReads == nil {
		return nil, httperror.New(503, "assets_summary_unavailable", "资产读取未安装")
	}
	tx, _, e := a.enterpriseReads.registry.BeginSnapshotReadTransaction(ctx, a.enterpriseReads.request)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	v, e := readCustomerKnowledge(ctx, tx, customer, asset, environment, q[0], q[1], false)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return v, nil
}
func knowledgeScopes(raw, actor, action string) ([]url.Values, error) {
	deny := func() ([]url.Values, error) {
		return nil, httperror.New(403, "assets_knowledge_scope_denied", "无权查看或关联目标资产")
	}
	var p struct {
		Actor       string            `json:"actorUid"`
		Action      string            `json:"action"`
		Expires     int64             `json:"expiresAt"`
		Delivery    map[string]string `json:"delivery"`
		Environment map[string]string `json:"environment"`
	}
	if json.Unmarshal([]byte(raw), &p) != nil || p.Actor != actor || p.Action != action || p.Expires <= time.Now().UnixMilli() || p.Expires > time.Now().Add(15*time.Second).UnixMilli() {
		return deny()
	}
	out := []url.Values{}
	for _, fields := range []map[string]string{p.Delivery, p.Environment} {
		q := url.Values{}
		for k, v := range fields {
			if k != "current_user_assets_object_access" && k != "current_user_assets_scope_units" {
				return deny()
			}
			q.Set(k, v)
		}
		q.Set("current_user", actor)
		out = append(out, q)
	}
	return out, nil
}
func readCustomerKnowledge(ctx context.Context, db adoptionRunner, customer, asset, environment string, delivery, env url.Values, lock bool) (map[string]any, error) {
	where, args, e := productAdoptionScopeWhere(delivery, env)
	if e != nil {
		return nil, e
	}
	sql := `SELECT delivery.delivery_asset_code,environment.environment_code,delivery.customer_code,COALESCE(delivery.contract_code,''),COALESCE(delivery.project_code,'') FROM customer_delivery_asset_environment_rel relation JOIN customer_delivery_assets delivery ON delivery.id=relation.delivery_asset_id JOIN asset_environments environment ON environment.id=relation.environment_id WHERE BINARY delivery.customer_code=BINARY ? AND delivery.deleted_at IS NULL AND relation.deleted_at IS NULL AND relation.status='active' AND (relation.effective_from IS NULL OR relation.effective_from<=CURRENT_TIMESTAMP) AND (relation.effective_to IS NULL OR relation.effective_to>CURRENT_TIMESTAMP) AND ` + where
	params := append([]any{customer}, args...)
	if asset != "" {
		sql += " AND BINARY delivery.delivery_asset_code=BINARY ? AND BINARY environment.environment_code=BINARY ?"
		params = append(params, asset, environment)
	}
	sql += " ORDER BY delivery.id,environment.id"
	if lock {
		sql += " FOR UPDATE"
	}
	rows, e := db.QueryContext(ctx, sql, params...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var ac, ec, c, contract, p string
		if e = rows.Scan(&ac, &ec, &c, &contract, &p); e != nil {
			return nil, e
		}
		items = append(items, map[string]any{"deliveryAssetCode": ac, "environmentCode": ec, "customerCode": c, "contractCode": contract, "projectCode": p})
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if asset != "" && len(items) != 1 {
		return nil, httperror.New(403, "assets_knowledge_target_denied", "无权关联目标资产与环境")
	}
	return map[string]any{"items": items}, nil
}
