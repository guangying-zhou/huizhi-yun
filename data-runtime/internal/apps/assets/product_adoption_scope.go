package assets

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Both queries must be independently derived from current scoped authorization
// for deliveries:view and environments:view. They are never browser input.
func productAdoptionScopeWhere(deliveryQuery, environmentQuery url.Values) (string, []any, error) {
	deliveryAccess, actor, err := assetsObjectAccess(deliveryQuery)
	if err != nil {
		return "", nil, err
	}
	environmentAccess, environmentActor, err := assetsObjectAccess(environmentQuery)
	if err != nil {
		return "", nil, err
	}
	if actor != environmentActor {
		return "", nil, httperror.New(http.StatusForbidden, "product_adoption_actor_mismatch", "Adoption scopes must belong to the same current user")
	}
	parts, args := []string{}, []any{}
	for _, input := range []struct {
		query                              url.Values
		access, owner, department, project string
	}{
		{deliveryQuery, deliveryAccess, "delivery.responsible_uid", "delivery.responsible_dept_code", "delivery.project_code"},
		{environmentQuery, environmentAccess, "environment.owner_uid", "environment.dept_code", "environment.project_code"},
	} {
		if input.access == "all" {
			continue
		}
		units, unitErr := assetsScopeUnits(input.query)
		if unitErr != nil {
			return "", nil, unitErr
		}
		where, values := productAdoptionOwnerScopeWhere(actor, input.owner, input.department, input.project, units)
		parts = append(parts, where)
		args = append(args, values...)
	}
	if len(parts) == 0 {
		return "(1=1)", args, nil
	}
	return "(" + strings.Join(parts, " AND ") + ")", args, nil
}

// Column names are fixed above. A relation unsupported by this object cannot
// disappear and leave a broader department/project-only grant behind.
func productAdoptionOwnerScopeWhere(actor, owner, department, project string, units []assetsScopeUnit) (string, []any) {
	branches, args := []string{}, []any{}
	for _, unit := range units {
		parts, values := []string{}, []any{}
		if unit.DirectRelation {
			matchesOwner := false
			for _, predicate := range normalizedAssetRelationPredicates(unit.RelationPredicates) {
				if predicate == "self" || predicate == "owner" || predicate == "assigned" {
					matchesOwner = true
				}
			}
			if !matchesOwner {
				continue
			}
			parts = append(parts, owner+"=?")
			values = append(values, actor)
		}
		for _, dimension := range []struct {
			column string
			codes  []string
		}{{department, unit.DepartmentCodes}, {project, unit.ProjectCodes}} {
			if len(dimension.codes) == 0 {
				continue
			}
			parts = append(parts, dimension.column+" IN ("+placeholders(dimension.codes)+")")
			for _, code := range dimension.codes {
				values = append(values, code)
			}
		}
		if len(parts) == 0 {
			continue
		}
		branches = append(branches, "("+strings.Join(parts, " AND ")+")")
		args = append(args, values...)
	}
	if len(branches) == 0 {
		return "(1=0)", nil
	}
	return "(" + strings.Join(branches, " OR ") + ")", args
}
