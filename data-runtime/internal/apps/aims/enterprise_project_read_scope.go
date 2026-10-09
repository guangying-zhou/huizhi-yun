package aims

import (
	"context"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

type enterpriseProjectReadScopeKey struct{}
type enterpriseProjectReadScope struct {
	Projection  projectscope.Projection
	Descendants map[string][]string
}

// Only Server calls this after authenticating the entire signed command. No
// query/body flag can select or bypass this context, including standalone Aims.
func WithEnterpriseProjectReadScope(ctx context.Context, projection projectscope.Projection, descendants map[string][]string) context.Context {
	return context.WithValue(ctx, enterpriseProjectReadScopeKey{}, enterpriseProjectReadScope{projection, descendants})
}

func enterpriseProjectReadScopeWhere(ctx context.Context, actor string) (string, []any, error) {
	return enterpriseProjectReadScopeWherePolicy(ctx, actor, true)
}

// Sensitive action scopes must not inherit projects:view public visibility.
func enterpriseProjectReadScopeWherePolicy(ctx context.Context, actor string, allowPublic bool) (string, []any, error) {
	scope, enabled := ctx.Value(enterpriseProjectReadScopeKey{}).(enterpriseProjectReadScope)
	if !enabled {
		return "1=1", nil, nil
	}
	p := scope.Projection
	if err := p.Validate(); err != nil {
		return "", nil, err
	}
	args := []any{}
	var mask string
	same := true
	for _, m := range p.Masks {
		if m != p.Masks[0] {
			same = false
			break
		}
	}
	if same {
		mask = fmt.Sprint(p.Masks[0])
	} else {
		indexFor := func(column string, codes []string) string {
			if len(codes) == 0 {
				return "0"
			}
			s := "CASE BINARY TRIM(" + column + ")"
			for i, code := range codes {
				s += fmt.Sprintf(" WHEN BINARY ? THEN %d", i+1)
				args = append(args, code)
			}
			return s + " ELSE 0 END"
		}
		project := indexFor("p.project_code", p.ProjectCodes)
		dept := indexFor("COALESCE(p.dept_code,'')", p.DepartmentCodes)
		treeParts := []string{"0"}
		for i, root := range p.DepartmentTreeRoots {
			codes, ok := scope.Descendants[root]
			if !ok {
				return "", nil, fmt.Errorf("project department tree facts unavailable")
			}
			if len(codes) == 0 {
				return "", nil, fmt.Errorf("project department root facts unavailable")
			}
			treeParts = append(treeParts, fmt.Sprintf("CASE WHEN BINARY TRIM(p.dept_code) IN (%s) THEN %d ELSE 0 END", strings.TrimRight(strings.Repeat("?,", len(codes)), ","), 1<<i))
			for _, code := range codes {
				args = append(args, code)
			}
		}
		index := fmt.Sprintf("(((%s)*%d+(%s))*%d+(%s))", project, len(p.DepartmentCodes)+1, dept, 1<<len(p.DepartmentTreeRoots), strings.Join(treeParts, "+"))
		mask = "CASE " + index
		for i, m := range p.Masks {
			if m != 0 {
				mask += fmt.Sprintf(" WHEN %d THEN %d", i, m)
			}
		}
		mask += " ELSE 0 END"
	}
	// All relationship facts come from current authoritative rows. participant
	// is active member OR leader OR creator, never company/public visibility.
	member := "EXISTS(SELECT 1 FROM aims_project_members scope_pm WHERE scope_pm.project_id=p.id AND BINARY TRIM(scope_pm.uid)=BINARY ? AND scope_pm.status='active')"
	owner := "BINARY TRIM(p.leader_uid)=BINARY ?"
	creator := "BINARY TRIM(COALESCE(NULLIF(TRIM(p.created_by),''),p.leader_uid))=BINARY ?"
	state := "(CASE WHEN " + member + " THEN 1 ELSE 0 END+CASE WHEN " + owner + " THEN 2 ELSE 0 END+CASE WHEN " + creator + " THEN 4 ELSE 0 END+CASE WHEN (" + member + " OR " + owner + " OR " + creator + ") THEN 8 ELSE 0 END)"
	for i := 0; i < 6; i++ {
		args = append(args, actor)
	}
	// Deliberate public-project contract: ANY valid projects:view grant allows
	// company L0/L1, regardless of its scope. This exemption is read-only.
	if !allowPublic {
		return "((" + mask + ") & (1 << " + state + "))<>0", args, nil
	}
	return "((COALESCE(p.security_level,'company')='company' AND COALESCE(p.confidentiality_level,'L1') IN ('L0','L1')) OR ((" + mask + ") & (1 << " + state + "))<>0)", args, nil
}
