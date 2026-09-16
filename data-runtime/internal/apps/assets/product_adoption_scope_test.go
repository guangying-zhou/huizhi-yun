package assets

import (
	"encoding/json"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func adoptionScopeQuery(actor, access string, units ...assetsScopeUnit) url.Values {
	encoded, _ := json.Marshal(units)
	return url.Values{"current_user": {actor}, assetsObjectAccessQueryKey: {access}, assetsScopeUnitsQueryKey: {string(encoded)}}
}

func TestProductAdoptionRequiresBothObjectScopes(t *testing.T) {
	all := adoptionScopeQuery("U1", "all")
	for _, invalid := range []url.Values{
		adoptionScopeQuery("", "all"), adoptionScopeQuery("U2", "all"),
		adoptionScopeQuery("U1", "none"), adoptionScopeQuery("U1", "relation"), {},
	} {
		if _, _, err := productAdoptionScopeWhere(all, invalid); err == nil {
			t.Fatal("invalid environment scope accepted")
		}
		if _, _, err := productAdoptionScopeWhere(invalid, all); err == nil {
			t.Fatal("invalid delivery scope accepted")
		}
	}
	where, args, err := productAdoptionScopeWhere(all, all)
	if err != nil || where != "(1=1)" || len(args) != 0 {
		t.Fatalf("global scopes: %s %v %v", where, args, err)
	}
}

func TestProductAdoptionPreservesScopeConjunctions(t *testing.T) {
	delivery := adoptionScopeQuery("U1", "relation",
		assetsScopeUnit{DirectRelation: true, RelationPredicates: []string{"owner"}, DepartmentCodes: []string{"D1"}, ProjectCodes: []string{"P1"}},
		assetsScopeUnit{ProjectCodes: []string{"P2"}},
	)
	environment := adoptionScopeQuery("U1", "relation", assetsScopeUnit{DirectRelation: true, RelationPredicates: []string{"owner"}})
	where, args, err := productAdoptionScopeWhere(delivery, environment)
	want := "(((delivery.responsible_uid=? AND delivery.responsible_dept_code IN (?) AND delivery.project_code IN (?)) OR (delivery.project_code IN (?))) AND ((environment.owner_uid=?)))"
	if err != nil || where != want || !reflect.DeepEqual(args, []any{"U1", "D1", "P1", "P2", "U1"}) {
		t.Fatalf("scope = %s %v %v", where, args, err)
	}
	unsupported := adoptionScopeQuery("U1", "relation", assetsScopeUnit{DirectRelation: true, RelationPredicates: []string{"user"}, DepartmentCodes: []string{"D1"}})
	where, args, err = productAdoptionScopeWhere(unsupported, environment)
	if err != nil || !strings.Contains(where, "(1=0)") || !reflect.DeepEqual(args, []any{"U1"}) {
		t.Fatalf("unsupported relation broadened to department: %s %v %v", where, args, err)
	}
}
