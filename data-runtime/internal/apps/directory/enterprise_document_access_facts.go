package directory

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"sort"
	"strings"
)

// Internal Runtime projection for the existing Aims document policy: primary
// department plus descendants of departments this actor leads/manages. It is
// not an HTTP route and accepts only the transport-verified actor from Server.
type EnterpriseDocumentAccessDirectoryFacts struct {
	DeptCodes           []string
	ManagementDeptCodes []string
}

func (a *Adapter) EnterpriseDocumentAccessDepartments(ctx context.Context, actor string) (*EnterpriseDocumentAccessDirectoryFacts, error) {
	if strings.TrimSpace(actor) == "" {
		return nil, httperror.New(403, "directory_actor_required", "Signed actor required")
	}
	user, err := a.ConsoleUserDepartments(ctx, actor)
	if err != nil {
		return nil, err
	}
	u, ok := user.(map[string]any)
	if !ok {
		return nil, httperror.New(503, "directory_projection_invalid", "Invalid directory projection")
	}
	primary, _ := u["primaryDeptCode"].(string)
	rows, err := a.consoleDepartments(ctx, "active")
	if err != nil {
		return nil, err
	}
	return &EnterpriseDocumentAccessDirectoryFacts{DeptCodes: enterpriseDocumentAccessDepartmentCodes(rows, actor, primary), ManagementDeptCodes: enterpriseDocumentAccessDepartmentCodes(rows, actor, "")}, nil
}
func enterpriseDocumentAccessDepartmentCodes(rows []consoleDirectoryDepartmentRow, actor, primary string) []string {
	managed := map[string]bool{}
	children := map[string][]string{}
	for _, r := range rows {
		if r.ManagerUID.String == actor || r.LeaderUID.String == actor {
			managed[r.Code] = true
		}
		if r.ParentCode.Valid {
			children[r.ParentCode.String] = append(children[r.ParentCode.String], r.Code)
		}
	}
	var include func(string)
	include = func(code string) {
		for _, child := range children[code] {
			if !managed[child] {
				managed[child] = true
				include(child)
			}
		}
	}
	for code := range managed {
		include(code)
	}
	if primary != "" {
		managed[primary] = true
	}
	out := []string{}
	for code := range managed {
		out = append(out, code)
	}
	sort.Strings(out)
	return out
}
