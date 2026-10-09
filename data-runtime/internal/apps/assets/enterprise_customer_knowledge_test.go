package assets

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
	"time"
)

func TestKnowledgeTargetScopeExpiryAndConjunction(t *testing.T) {
	fields := map[string]string{assetsObjectAccessQueryKey: "all"}
	valid := map[string]any{"actorUid": "person", "action": "edit", "expiresAt": time.Now().Add(10 * time.Second).UnixMilli(), "delivery": fields, "environment": fields}
	raw, _ := json.Marshal(valid)
	scopes, e := knowledgeScopes(string(raw), "person", "edit")
	if e != nil {
		t.Fatal(e)
	}
	if _, _, e = productAdoptionScopeWhere(scopes[0], scopes[1]); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []map[string]any{{"actorUid": "other"}, {"action": "view"}, {"expiresAt": time.Now().Add(-time.Second).UnixMilli()}, {"expiresAt": time.Now().Add(time.Hour).UnixMilli()}, {"environment": map[string]string{"forged": "yes"}}, {"delivery": map[string]string{assetsObjectAccessQueryKey: "none"}}} {
		copy := map[string]any{}
		for k, v := range valid {
			copy[k] = v
		}
		for k, v := range bad {
			copy[k] = v
		}
		raw, _ := json.Marshal(copy)
		s, e := knowledgeScopes(string(raw), "person", "edit")
		if e == nil {
			_, _, e = productAdoptionScopeWhere(s[0], s[1])
		}
		if e == nil {
			t.Fatal("invalid target scope passed", bad)
		}
	}
}
func TestKnowledgeSummaryCannotUseCustomerScopeToBroadenAssets(t *testing.T) {
	db, m, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	allowed := adoptionScopeQuery("person", "all")
	denied := adoptionScopeQuery("person", "none")
	if _, e := readCustomerKnowledge(context.Background(), db, "CUSTOMER", "", "", allowed, denied, false); e == nil {
		t.Fatal("denied environment became a count")
	}
	m.ExpectQuery("SELECT .* FROM customer_delivery_asset_environment_rel").WillReturnRows(sqlmock.NewRows([]string{"asset", "environment", "customer", "contract", "project"}))
	v, e := readCustomerKnowledge(context.Background(), db, "CUSTOMER", "", "", allowed, allowed, false)
	if e != nil || len(v["items"].([]map[string]any)) != 0 {
		t.Fatal(v, e)
	}
	m.ExpectQuery("SELECT .* FROM customer_delivery_asset_environment_rel").WillReturnError(sql.ErrConnDone)
	if _, e := readCustomerKnowledge(context.Background(), db, "CUSTOMER", "", "", allowed, allowed, false); e == nil {
		t.Fatal("dependency failure became empty")
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
