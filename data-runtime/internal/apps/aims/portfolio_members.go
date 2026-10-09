package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Portfolio members and the registered document repository (document asset
// design DOC-05a). The two tables are installed separately from the migrated
// Aims tables: they are addressed through the Registry mapping and are not part
// of the compatibility view family. A deployment that has not installed them
// answers these entry points with a fixed 503; every other Aims function keeps
// working.
const (
	portfolioMembersTable  = "aims_portfolio_members"
	portfolioDocReposTable = "aims_portfolio_doc_repos"
	// The member list is returned whole (no paging) up to this many rows.
	portfolioMemberListLimit = 500
)

var (
	portfolioMemberRelations = map[string]bool{"manager": true, "contributor": true, "viewer": true}
	portfolioRepoPathPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+$`)
)

func portfolioMembersUnavailable() error {
	return httperror.New(http.StatusServiceUnavailable, "aims_portfolio_members_unavailable", "Portfolio members are not installed")
}

type portfolioMemberTables struct{ members, repos string }

// beginPortfolioMemberTx opens the transaction that owns a member operation.
// With unified Enterprise writes it holds the Registry generation fence and
// takes the physical names from the registered mapping; a mapping without the
// tables fails closed. Standalone Aims uses its own database directly.
func (a *Adapter) beginPortfolioMemberTx(ctx context.Context) (*sql.Tx, portfolioMemberTables, error) {
	if a.enterpriseWrites == nil {
		tx, err := a.DB().BeginTx(ctx, nil)
		return tx, portfolioMemberTables{"`" + portfolioMembersTable + "`", "`" + portfolioDocReposTable + "`"}, err
	}
	b := a.enterpriseWrites
	tx, resolved, err := b.registry.BeginWriteTransaction(ctx, b.writer)
	if err != nil {
		return nil, portfolioMemberTables{}, err
	}
	members, memberErr := resolved[0].Table(portfolioMembersTable)
	repos, repoErr := resolved[0].Table(portfolioDocReposTable)
	if memberErr != nil || repoErr != nil {
		_ = tx.Rollback()
		return nil, portfolioMemberTables{}, portfolioMembersUnavailable()
	}
	return tx, portfolioMemberTables{members, repos}, nil
}

// PortfolioOwnerStatus reports whether a portfolio owner is still an active
// employee. Runtime construction injects a Directory-backed implementation for
// the Enterprise Host routes; it is called before any business transaction and
// only for the owner of the addressed portfolio.
type PortfolioOwnerStatus func(ctx context.Context, ownerUID string) (active bool, err error)

type portfolioOwnerStatusKey struct{}

func WithPortfolioOwnerStatus(ctx context.Context, check PortfolioOwnerStatus) context.Context {
	return context.WithValue(ctx, portfolioOwnerStatusKey{}, check)
}

// portfolioOwnerFacts is the Directory pre-read of one portfolio's owner.
type portfolioOwnerFacts struct {
	checked  bool
	uid      string
	inactive bool
}

// matches rejects a pre-read that no longer describes the locked row.
func (f portfolioOwnerFacts) matches(lockedOwner string) error {
	if f.checked && f.uid != lockedOwner {
		return httperror.New(http.StatusConflict, "portfolio_owner_changed", "项目集负责人已变化，请刷新后重试")
	}
	return nil
}

// portfolioOwnerPreRead resolves whether the current owner is still an active
// employee. An owner who is not is treated as "no owner": he is no implicit
// manager, the bootstrap rule applies and the last-manager guard counts
// effective managers only. Without an injected check (standalone Aims) the
// owner is taken as recorded. A Directory failure is returned as is (503).
func (a *Adapter) portfolioOwnerPreRead(ctx context.Context, portfolioID int64) (portfolioOwnerFacts, error) {
	check, _ := ctx.Value(portfolioOwnerStatusKey{}).(PortfolioOwnerStatus)
	if check == nil {
		return portfolioOwnerFacts{}, nil
	}
	var owner sql.NullString
	if err := a.DB().QueryRowContext(ctx, "SELECT owner_uid FROM project_portfolios WHERE id=?", portfolioID).Scan(&owner); err != nil {
		if err == sql.ErrNoRows {
			return portfolioOwnerFacts{}, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
		}
		return portfolioOwnerFacts{}, err
	}
	facts := portfolioOwnerFacts{checked: true, uid: strings.TrimSpace(owner.String)}
	if facts.uid == "" {
		return facts, nil
	}
	active, err := check(ctx, facts.uid)
	if err != nil {
		return portfolioOwnerFacts{}, err
	}
	facts.inactive = !active
	return facts, nil
}

type portfolioMemberActor struct {
	uid           string
	canAdminister bool // personnel permission portfolios:admin, injected by the verified Host only
	owner         string
	ownerInactive bool // Directory: the recorded owner is no longer an active employee
	isOwner       bool
	isManager     bool
	managers      int // effective managers, the actor included
}

// canManage requires both the personnel permission and the current relation.
func (p portfolioMemberActor) canManage() bool {
	return p.canAdminister && (p.isOwner || p.isManager)
}

// effectiveOwner is the owner who still counts: empty when there is none or
// when Directory says the recorded owner is no longer an active employee.
func (p portfolioMemberActor) effectiveOwner() string {
	if p.ownerInactive {
		return ""
	}
	return p.owner
}

// bootstrap is the only case in which the permission alone is enough: a
// portfolio that has neither an effective owner nor any effective manager.
func (p portfolioMemberActor) bootstrap() bool {
	return p.canAdminister && p.effectiveOwner() == "" && p.managers == 0
}

const portfolioMemberEffective = `status='active' AND valid_from<=UTC_TIMESTAMP(3) AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP(3))`

// lockPortfolioForMembers locks the portfolio row and reads the actor's current
// relation inside the caller's transaction. The actor comes from the signed
// delegation (current_user is overwritten by the server), never from the body.
func lockPortfolioForMembers(ctx context.Context, tx *sql.Tx, tables portfolioMemberTables, portfolioID int64, query url.Values, forUpdate bool, facts portfolioOwnerFacts) (portfolioMemberActor, error) {
	actor := portfolioMemberActor{uid: strings.TrimSpace(query.Get("current_user"))}
	if actor.uid == "" {
		return actor, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	actor.canAdminister = strings.TrimSpace(firstQueryText(query, "current_user_can_manage_portfolios")) == "1"
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE"
	}
	var owner sql.NullString
	if err := tx.QueryRowContext(ctx, "SELECT owner_uid FROM project_portfolios WHERE id=?"+lock, portfolioID).Scan(&owner); err != nil {
		if err == sql.ErrNoRows {
			return actor, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
		}
		return actor, err
	}
	actor.owner = strings.TrimSpace(owner.String)
	if err := facts.matches(actor.owner); err != nil {
		return actor, err
	}
	actor.ownerInactive = facts.inactive
	actor.isOwner = actor.effectiveOwner() != "" && actor.owner == actor.uid
	rows, err := tx.QueryContext(ctx, "SELECT uid FROM "+tables.members+" WHERE portfolio_id=? AND relation_type='manager' AND "+portfolioMemberEffective+lock, portfolioID)
	if err != nil {
		return actor, err
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		if err = rows.Scan(&uid); err != nil {
			return actor, err
		}
		actor.managers++
		if uid == actor.uid {
			actor.isManager = true
		}
	}
	return actor, rows.Err()
}

func (a *Adapter) listPortfolioMembers(ctx context.Context, rawID string, query url.Values) (map[string]any, error) {
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	facts, err := a.portfolioOwnerPreRead(ctx, id)
	if err != nil {
		return nil, err
	}
	tx, tables, err := a.beginPortfolioMemberTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	actor, err := lockPortfolioForMembers(ctx, tx, tables, id, query, false, facts)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT uid,relation_type,status,DATE_FORMAT(valid_from,'%Y-%m-%dT%H:%i:%sZ'),DATE_FORMAT(valid_until,'%Y-%m-%dT%H:%i:%sZ'),revision,("+portfolioMemberEffective+") FROM "+tables.members+" WHERE portfolio_id=? ORDER BY relation_type,uid LIMIT ?", id, portfolioMemberListLimit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := make([]map[string]any, 0)
	for rows.Next() {
		var uid, relation, status, from string
		var until sql.NullString
		var revision int64
		var effective bool
		if err = rows.Scan(&uid, &relation, &status, &from, &until, &revision, &effective); err != nil {
			return nil, err
		}
		item := map[string]any{"uid": uid, "relationType": relation, "status": status, "validFrom": from, "validUntil": nil, "revision": revision, "effective": effective}
		if until.Valid {
			item["validUntil"] = until.String
		}
		members = append(members, item)
	}
	// Never an unbounded response: the page shows the cut-off.
	truncated := len(members) > portfolioMemberListLimit
	if truncated {
		members = members[:portfolioMemberListLimit]
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	var repo any
	var integration, path string
	var version int64
	switch err = tx.QueryRowContext(ctx, "SELECT integration_code,repo_path,row_version FROM "+tables.repos+" WHERE portfolio_id=?", id).Scan(&integration, &path, &version); err {
	case nil:
		repo = map[string]any{"integrationCode": integration, "repoPath": path, "rowVersion": version}
	case sql.ErrNoRows:
	default:
		return nil, err
	}
	var owner any
	if actor.owner != "" {
		owner = actor.owner
	}
	// Header facts for the Host page; the caller already holds portfolios:view.
	var code, name string
	if err = tx.QueryRowContext(ctx, "SELECT code,name FROM project_portfolios WHERE id=?", id).Scan(&code, &name); err != nil {
		return nil, err
	}
	return map[string]any{"portfolioId": id, "portfolio": map[string]any{"id": id, "code": code, "name": name}, "ownerUid": owner, "members": members, "truncated": truncated, "ownerInactive": actor.ownerInactive, "docRepo": repo, "canManage": actor.canManage(), "canBootstrap": actor.bootstrap()}, nil
}

func (a *Adapter) savePortfolioMember(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	for key := range body {
		switch key {
		case "action", "uid", "relationType", "validUntil", "expectedRevision":
		default:
			return nil, httperror.New(http.StatusBadRequest, "portfolio_member_input_invalid", "Unsupported member field")
		}
	}
	action := firstBodyText(body, "action")
	uid := firstBodyText(body, "uid")
	relation := firstBodyText(body, "relationType")
	if (action != "upsert" && action != "remove") || uid == "" || len(uid) > 64 || strings.HasPrefix(uid, "system:") || strings.HasPrefix(uid, "client:") || strings.ContainsAny(uid, " \t\r\n") {
		return nil, httperror.New(http.StatusBadRequest, "portfolio_member_input_invalid", "Invalid member command")
	}
	if action == "upsert" && !portfolioMemberRelations[relation] {
		return nil, httperror.New(http.StatusBadRequest, "portfolio_member_input_invalid", "Invalid member relation")
	}
	var validUntil any
	if raw := firstBodyText(body, "validUntil"); raw != "" {
		parsed, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil || action != "upsert" || !parsed.After(time.Now()) {
			return nil, httperror.New(http.StatusBadRequest, "portfolio_member_input_invalid", "Invalid member expiry")
		}
		validUntil = parsed.UTC()
	}
	expected := portfolioBodyInt(body, "expectedRevision")

	facts, err := a.portfolioOwnerPreRead(ctx, id)
	if err != nil {
		return nil, err
	}
	tx, tables, err := a.beginPortfolioMemberTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	actor, err := lockPortfolioForMembers(ctx, tx, tables, id, query, true, facts)
	if err != nil {
		return nil, err
	}
	if !actor.canManage() {
		// The bootstrap can only add a first manager; it never edits other members.
		if !(actor.bootstrap() && action == "upsert" && relation == "manager") {
			return nil, httperror.New(http.StatusForbidden, "portfolio_member_manager_required", "需要项目集管理权限，且为该项目集的负责人或管理者")
		}
	}
	var current struct {
		relation, status string
		revision         int64
		effective        bool
	}
	err = tx.QueryRowContext(ctx, "SELECT relation_type,status,revision,("+portfolioMemberEffective+") FROM "+tables.members+" WHERE portfolio_id=? AND uid=? FOR UPDATE", id, uid).Scan(&current.relation, &current.status, &current.revision, &current.effective)
	exists := err == nil
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if !actor.canManage() && exists {
		return nil, httperror.New(http.StatusForbidden, "portfolio_member_manager_required", "引导规则只能添加第一名管理者")
	}
	if exists && expected != current.revision {
		return nil, httperror.New(http.StatusConflict, "portfolio_member_revision_conflict", "成员信息已变化，请刷新后重试")
	}
	if !exists && (action == "remove" || expected != 0) {
		return nil, httperror.New(http.StatusConflict, "portfolio_member_revision_conflict", "成员不存在或已变化，请刷新后重试")
	}
	// A portfolio must keep an owner or at least one effective manager.
	losesManager := exists && current.effective && current.relation == "manager" && (action == "remove" || relation != "manager")
	if losesManager && actor.effectiveOwner() == "" && actor.managers <= 1 {
		return nil, httperror.New(http.StatusConflict, "portfolio_last_manager_required", "项目集至少保留一名负责人或管理者")
	}
	revision := current.revision + 1
	switch {
	case action == "remove":
		if !current.effective {
			return map[string]any{"portfolioId": id, "uid": uid, "status": "inactive", "revision": current.revision, "changed": false}, tx.Commit()
		}
		if _, err = tx.ExecContext(ctx, "UPDATE "+tables.members+" SET status='inactive',valid_until=UTC_TIMESTAMP(3),revision=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE portfolio_id=? AND uid=? AND revision=?", revision, actor.uid, id, uid, current.revision); err != nil {
			return nil, err
		}
	case exists:
		if _, err = tx.ExecContext(ctx, "UPDATE "+tables.members+" SET relation_type=?,status='active',valid_from=IF("+portfolioMemberEffective+",valid_from,UTC_TIMESTAMP(3)),valid_until=?,revision=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE portfolio_id=? AND uid=? AND revision=?", relation, validUntil, revision, actor.uid, id, uid, current.revision); err != nil {
			return nil, err
		}
	default:
		revision = 1
		if _, err = tx.ExecContext(ctx, "INSERT INTO "+tables.members+"(portfolio_id,uid,relation_type,status,valid_from,valid_until,revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,'active',UTC_TIMESTAMP(3),?,1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", id, uid, relation, validUntil, actor.uid, actor.uid); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	status := "active"
	if action == "remove" {
		status = "inactive"
	}
	return map[string]any{"portfolioId": id, "uid": uid, "relationType": relation, "status": status, "revision": revision, "changed": true}, nil
}

func (a *Adapter) savePortfolioDocRepo(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	for key := range body {
		if key != "repoPath" && key != "expectedRowVersion" {
			return nil, httperror.New(http.StatusBadRequest, "portfolio_doc_repo_input_invalid", "Unsupported repository field")
		}
	}
	path := firstBodyText(body, "repoPath")
	if path != "" && (len(path) > 255 || !portfolioRepoPathPattern.MatchString(path) || strings.Contains(path, "..")) {
		return nil, httperror.New(http.StatusBadRequest, "portfolio_doc_repo_input_invalid", "Invalid repository path")
	}
	expected := portfolioBodyInt(body, "expectedRowVersion")
	facts, err := a.portfolioOwnerPreRead(ctx, id)
	if err != nil {
		return nil, err
	}
	tx, tables, err := a.beginPortfolioMemberTx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	actor, err := lockPortfolioForMembers(ctx, tx, tables, id, query, true, facts)
	if err != nil {
		return nil, err
	}
	if !actor.canManage() {
		return nil, httperror.New(http.StatusForbidden, "portfolio_member_manager_required", "需要项目集管理权限，且为该项目集的负责人或管理者")
	}
	var version int64
	err = tx.QueryRowContext(ctx, "SELECT row_version FROM "+tables.repos+" WHERE portfolio_id=? FOR UPDATE", id).Scan(&version)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	exists := err == nil
	if expected != version {
		return nil, httperror.New(http.StatusConflict, "portfolio_doc_repo_version_conflict", "文档仓库登记已变化，请刷新后重试")
	}
	switch {
	case path == "" && exists:
		if _, err = tx.ExecContext(ctx, "DELETE FROM "+tables.repos+" WHERE portfolio_id=? AND row_version=?", id, version); err != nil {
			return nil, err
		}
		version = 0
	case path == "":
	case exists:
		version++
		if _, err = tx.ExecContext(ctx, "UPDATE "+tables.repos+" SET repo_path=?,row_version=?,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE portfolio_id=?", path, version, actor.uid, id); err != nil {
			return nil, err
		}
	default:
		version = 1
		if _, err = tx.ExecContext(ctx, "INSERT INTO "+tables.repos+"(portfolio_id,integration_code,repo_path,row_version,created_by,updated_by,created_at,updated_at) VALUES(?,'gitlab.default',?,1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", id, path, actor.uid, actor.uid); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	var repo any
	if path != "" {
		repo = map[string]any{"integrationCode": "gitlab.default", "repoPath": path, "rowVersion": version}
	}
	return map[string]any{"portfolioId": id, "docRepo": repo}, nil
}
