package aims

import (
	"context"
	"database/sql"
	"net/url"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func validProjectRepositoryPath(value string) bool {
	return len(value) <= 255 && !strings.Contains(value, "..") && regexp.MustCompile(`^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`).MatchString(value)
}

// ReadEnterpriseProjectOutput is a read-only projection, not a new deliverable
// type restriction on the shared list API. Source bodies retain their own ACL.
func (a *Adapter) ReadEnterpriseProjectOutput(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	q := url.Values{}
	for k, v := range query {
		q[k] = append([]string(nil), v...)
	}
	q.Set("project_id", projectID)
	q.Set("deliverable_type", "document")
	if q.Get("page") == "" {
		q.Set("page", "1")
	}
	if q.Get("pageSize") == "" {
		q.Set("pageSize", "20")
	}
	if _, err := parseOptionalProjectListPage(q); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	readCtx := context.WithValue(ctx, enterpriseDocumentTxKey{}, tx)
	readCtx = context.WithValue(readCtx, enterpriseDocumentReadKey{}, true)
	list, err := a.listDeliverablesFrom(readCtx, q, tx, true)
	if err != nil {
		return nil, err
	}
	docs, err := a.listDirectDocuments(readCtx, url.Values{"project_id": {projectID}, "current_user": {q.Get("current_user")}})
	if err != nil {
		return nil, err
	}
	cards := map[string]any{"project_proposal": nil, "requirement_spec": nil}
	var visit func([]*directDocumentListItem)
	visit = func(items []*directDocumentListItem) {
		for _, d := range items {
			if !d.IsFolder && d.DocCategory != nil && (*d.DocCategory == "project_proposal" || *d.DocCategory == "requirement_spec") && cards[*d.DocCategory] == nil {
				cards[*d.DocCategory] = d
			}
			visit(d.Children)
		}
	}
	visit(docs)
	repos, err := a.listProjectReposFrom(readCtx, projectID, q, tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	out := list.(map[string]any)
	out["documents"] = cards
	out["repos"] = repos
	return map[string]any{"code": 0, "data": out}, nil
}

// Only the registered project portfolio's GitLab group can be resolved. The
// Host does not supply the group; edit scope + current manager are rechecked.
func (a *Adapter) enterpriseProjectRepoCandidates(ctx context.Context, projectID string, q url.Values) (map[string]any, error) {
	identity, ok := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !ok || identity.ActorUID == "" || identity.ActorUID != q.Get("current_user") || identity.CommandScope == nil {
		return nil, httperror.New(403, "enterprise_project_command_scope_invalid", "Scoped edit authorization required")
	}
	pid, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = requireEnterpriseDeliverableProjectScopeTx(ctx, tx, identity.ActorUID, pid, true); err != nil {
		return nil, err
	}
	var group sql.NullString
	if err = tx.QueryRowContext(ctx, "SELECT pf.git_group FROM aims_projects p LEFT JOIN project_portfolios pf ON pf.id=p.portfolio_id WHERE p.id=?", pid).Scan(&group); err != nil {
		return nil, err
	}
	value := strings.TrimSpace(group.String)
	if value != "" && !validProjectRepositoryPath(value) {
		return nil, httperror.New(503, "project_repository_directory_invalid", "Registered repository group invalid")
	}
	// No writes, receipts or outbound IO occur in this transaction.
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": map[string]any{"projectId": projectID, "gitGroup": value}}, nil
}
