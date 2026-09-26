package assets

import (
	"net/url"
	"reflect"
	"testing"
)

func TestEnterpriseProductScopeReusesOwnerDomainConstraints(t *testing.T) {
	q := url.Values{"current_user": {"person-a"}, assetsObjectAccessQueryKey: {"relation"}, assetsPermissionActionQueryKey: {"view"}, assetsScopeUnitsQueryKey: {`[{"directRelation":true,"relationPredicates":["owner"],"projectCodes":["P1"]}]`}}
	where, args, err := EnterpriseProductReadPredicate(q, "person-a")
	if err != nil || where == "1=1" || !reflect.DeepEqual(args, []any{"person-a", "P1"}) {
		t.Fatalf("owner/project conjunction lost: %s %#v %v", where, args, err)
	}
	q.Set(assetsScopeUnitsQueryKey, `[{"departmentCodes":["D1"]}]`)
	where, _, err = EnterpriseProductReadPredicate(q, "person-a")
	if err != nil || where != "(1=0)" {
		t.Fatalf("product has no department dimension: %s %v", where, err)
	}
	for _, actor := range []string{"", "person-b"} {
		if _, _, err := EnterpriseProductReadPredicate(q, actor); err == nil {
			t.Fatal("unbound actor accepted")
		}
	}
	q.Set(assetsObjectAccessQueryKey, "all")
	q.Set(assetsPermissionActionQueryKey, "edit")
	if _, _, err := EnterpriseProductReadPredicate(q, "person-a"); err == nil {
		t.Fatal("incorrect action accepted")
	}
}
