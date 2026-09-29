package assets

import (
	"strings"
	"testing"
)

func TestDigitalAssetScopeWhereUsesOnlyStoredRelationsAndProjects(t *testing.T) {
	where, args := digitalAssetScopeWhere("da", "person-a", []assetsScopeUnit{{
		DirectRelation: true, RelationPredicates: []string{"owner", "custodian"}, ProjectCodes: []string{"P-1"},
	}})
	if !strings.Contains(where, "da.owner_uid=?") || !strings.Contains(where, "da.project_code IN (?)") {
		t.Fatalf("digital scope omitted supported fields: %s", where)
	}
	if strings.Contains(where, "custodian_uid") || len(args) != 2 || args[0] != "person-a" || args[1] != "P-1" {
		t.Fatalf("digital scope widened an unsupported relation: %s %#v", where, args)
	}
}

func TestDigitalAssetScopeWhereFailsClosedForDepartmentAndUnsupportedRelation(t *testing.T) {
	where, args := digitalAssetScopeWhere("da", "person-a", []assetsScopeUnit{{DepartmentCodes: []string{"D-1"}}, {DirectRelation: true, RelationPredicates: []string{"custodian"}}})
	if where != "(1=0)" || len(args) != 0 {
		t.Fatalf("unrepresentable digital scope must deny: %s %#v", where, args)
	}
}

func TestDigitalAssetUnsupportedRelationCannotBecomeProjectOnlyAccess(t *testing.T) {
	where, args := digitalAssetScopeWhere("da", "person-a", []assetsScopeUnit{
		{DirectRelation: true, RelationPredicates: []string{"custodian"}, ProjectCodes: []string{"P-denied"}},
		{ProjectCodes: []string{"P-allowed"}},
	})
	if strings.Contains(where, "owner_uid") || len(args) != 1 || args[0] != "P-allowed" {
		t.Fatalf("unsupported relation widened a conjunctive unit: %s %#v", where, args)
	}
	where, args = digitalAssetScopeWhere("da", "person-a", []assetsScopeUnit{
		{DirectRelation: true, RelationPredicates: []string{"custodian"}, ProjectCodes: []string{"P-denied"}},
	})
	if where != "(1=0)" || len(args) != 0 {
		t.Fatalf("unsupported relation and project must deny: %s %#v", where, args)
	}
}
