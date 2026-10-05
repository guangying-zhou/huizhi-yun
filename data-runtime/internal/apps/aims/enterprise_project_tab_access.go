package aims

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
)

type enterpriseProjectManagementKey struct{}
type EnterpriseProjectTabAccess struct {
	Member            bool `json:"member"`
	Manager           bool `json:"manager"`
	Management        bool `json:"management"`
	AnyProjectManager bool `json:"anyProjectManager"`
}

func WithEnterpriseProjectManagementScope(ctx context.Context, scope projectscope.Projection, descendants map[string][]string) context.Context {
	return context.WithValue(ctx, enterpriseProjectManagementKey{}, enterpriseProjectReadScope{scope, descendants})
}

// No browser/query facts. Every verdict is derived from current authoritative rows.
func (a *Adapter) EnterpriseProjectTabs(ctx context.Context, projectID, actor string) (EnterpriseProjectTabAccess, error) {
	var f EnterpriseProjectTabAccess
	scope, ok := ctx.Value(enterpriseProjectManagementKey{}).(enterpriseProjectReadScope)
	if !ok {
		return f, httperror.New(503, "project_tab_authorization_unavailable", "Project tab authorization unavailable")
	}
	managementCtx := WithEnterpriseProjectReadScope(ctx, scope.Projection, scope.Descendants)
	where, args, err := enterpriseProjectReadScopeWherePolicy(managementCtx, actor, false)
	if err != nil {
		return f, httperror.New(503, "project_tab_authorization_unavailable", "Project tab authorization unavailable")
	}
	q := `SELECT
 (BINARY p.leader_uid=BINARY ? OR EXISTS(SELECT 1 FROM aims_project_members m WHERE m.project_id=p.id AND BINARY m.uid=BINARY ? AND m.status='active')),
 (BINARY p.leader_uid=BINARY ? OR EXISTS(SELECT 1 FROM aims_project_members m WHERE m.project_id=p.id AND BINARY m.uid=BINARY ? AND m.status='active' AND m.role='manager')),
 (` + where + `),
 (EXISTS(SELECT 1 FROM aims_projects other WHERE BINARY other.leader_uid=BINARY ?) OR EXISTS(SELECT 1 FROM aims_project_members mm JOIN aims_projects other ON other.id=mm.project_id WHERE BINARY mm.uid=BINARY ? AND mm.status='active' AND mm.role='manager'))
 FROM aims_projects p WHERE p.id=?`
	params := []any{actor, actor, actor, actor}
	params = append(params, args...)
	params = append(params, actor, actor, projectID)
	err = a.DB().QueryRowContext(ctx, q, params...).Scan(&f.Member, &f.Manager, &f.Management, &f.AnyProjectManager)
	if errors.Is(err, sql.ErrNoRows) {
		return f, httperror.New(404, "project_not_found", "Project not found")
	}
	if err != nil {
		return f, httperror.New(503, "project_tab_authorization_unavailable", "Project tab facts unavailable")
	}
	return f, nil
}
func (a *Adapter) RequireEnterpriseProjectTab(ctx context.Context, projectID string, query url.Values, tab string) (EnterpriseProjectTabAccess, error) {
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return EnterpriseProjectTabAccess{}, err
	}
	f, err := a.EnterpriseProjectTabs(ctx, projectID, query.Get("current_user"))
	if err != nil {
		return f, err
	}
	switch tab {
	case "board", "goals", "requirements", "risks", "metrics", "timesheet", "weekly-reports", "settings":
	default:
		return f, httperror.New(400, "project_tab_invalid", "Project tab invalid")
	}
	allowed := f.Member || f.Management
	if tab == "weekly-reports" {
		allowed = allowed || f.AnyProjectManager
	}
	if tab == "settings" {
		allowed = f.Manager || f.Management
	}
	if !allowed {
		return f, httperror.New(403, "project_tab_forbidden", "No access to this project tab")
	}
	return f, nil
}

type enterpriseProjectTabReadKey struct{}

func WithEnterpriseProjectTabRead(ctx context.Context, projectID string) context.Context {
	return context.WithValue(ctx, enterpriseProjectTabReadKey{}, projectID)
}
