package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrDirectoryAccess  = errors.New("enterprise: product directory access denied")
	ErrDirectoryQuery   = errors.New("enterprise: invalid product directory query")
	ErrDirectoryChanged = errors.New("enterprise: product directory changed; restart pagination")
)

// DirectoryIdentity comes from the verified Runtime context, never decoded from
// browser query/body. Owner deployments are from the local path registration.
type DirectoryIdentity struct {
	SourceDomain                               string
	Key                                        BindingKey
	ActorUID, SchemaVersion                    string
	Generation                                 uint64
	AssetsOwnerDeployment, AimsOwnerDeployment string
}
type DirectoryQuery struct {
	Page, PageSize                               int
	Keyword, ProductCode, ProductLine, Watermark string
	WorkspaceRevision                            *uint64
}
type DirectoryGrant struct {
	Key                     BindingKey
	ActorUID, SchemaVersion string
	Generation              uint64
	ExpiresAt               time.Time
	AllProducts             bool
	ProductCodes            []string
}

// DirectoryAuthorizer must adapt the existing Foundation/Console authorization
// contract, not infer access from workspace existence. Implementations evaluate
// current action and object facts in this transaction. Empty workspace means
// collection products:view and its applicable data scope, not automatic access.
// A service-token scope
// alone is insufficient. The grant is produced only for Assets products:view.
type DirectoryAuthorizer interface {
	AssetsProductsView(context.Context, *sql.Tx, DirectoryIdentity) (DirectoryGrant, error)
	AimsProductsView(context.Context, *sql.Tx, DirectoryIdentity, string) error
}
type DirectoryProduct struct {
	ProductLineCode  string  `json:"product_line_code"`
	Status           string  `json:"status"`
	ProductCode      string  `json:"product_code"`
	ProductName      string  `json:"product_name"`
	ProductLine      string  `json:"product_line"`
	ProductLineLabel *string `json:"product_line_label"`
	SourceStatus     string  `json:"source_status"`
}
type DirectoryLine struct {
	Code  string  `json:"code"`
	Label *string `json:"label"`
}
type DirectoryPage struct {
	Items             []DirectoryProduct `json:"items"`
	ProductLines      []DirectoryLine    `json:"product_lines"`
	Total             int64              `json:"total"`
	Page              int                `json:"page"`
	PageSize          int                `json:"pageSize"`
	Watermark         string             `json:"watermark"`
	WorkspaceRevision *uint64            `json:"workspace_revision,omitempty"`
}
type ProductDirectoryService struct {
	Registry   *Registry
	Authorizer DirectoryAuthorizer
}

func (s ProductDirectoryService) List(ctx context.Context, id DirectoryIdentity, q DirectoryQuery) (DirectoryPage, error) {
	return s.list(ctx, id, q, "")
}

// ListForAimsWorkspace combines *independent* workspace and Assets visibility.
// A line workspace resolves only explicitly onboarded sources, not every product
// in the line. It never modifies a historical label or source name snapshot.
func (s ProductDirectoryService) ListForAimsWorkspace(ctx context.Context, id DirectoryIdentity, q DirectoryQuery, workspace string) (DirectoryPage, error) {
	if id.SourceDomain != "aims" || !validDirectoryCode(workspace) {
		return DirectoryPage{}, ErrDirectoryQuery
	}
	return s.list(ctx, id, q, workspace)
}
func validDirectoryCode(v string) bool {
	return nonempty(v) && utf8.ValidString(v) && utf8.RuneCountInString(v) <= 64
}
func grantWhere(id DirectoryIdentity, g DirectoryGrant) (string, []any, error) {
	if g.Key != id.Key || g.ActorUID != id.ActorUID || g.SchemaVersion != id.SchemaVersion || g.Generation != id.Generation || g.ExpiresAt.IsZero() || !time.Now().Before(g.ExpiresAt) {
		return "", nil, ErrDirectoryAccess
	}
	if g.AllProducts {
		if len(g.ProductCodes) > 0 {
			return "", nil, ErrDirectoryAccess
		}
		return "1=1", nil, nil
	}
	if len(g.ProductCodes) == 0 {
		return "1=0", nil, nil
	}
	if len(g.ProductCodes) > 10000 {
		return "", nil, ErrDirectoryAccess
	}
	slots := make([]string, len(g.ProductCodes))
	args := make([]any, len(g.ProductCodes))
	for i, code := range g.ProductCodes {
		if !validDirectoryCode(code) {
			return "", nil, ErrDirectoryAccess
		}
		slots[i] = "?"
		args[i] = code
	}
	return "BINARY p.product_code IN (" + strings.Join(slots, ",") + ")", args, nil
}

// directoryResolveRequests keeps Assets first so the returned slice indexes match
// the owning domain each read uses, and adds Aims only when it participates.
// BeginSnapshotReadTransaction rejects any mismatch in binding, schema version or
// generation across them.
func directoryResolveRequests(id DirectoryIdentity) []ResolveRequest {
	requests := []ResolveRequest{{Key: id.Key, Domain: "assets", OwnerDeployment: id.AssetsOwnerDeployment, SchemaVersion: id.SchemaVersion, Generation: id.Generation, Operation: Read}}
	if id.SourceDomain == "aims" {
		requests = append(requests, ResolveRequest{Key: id.Key, Domain: "aims", OwnerDeployment: id.AimsOwnerDeployment, SchemaVersion: id.SchemaVersion, Generation: id.Generation, Operation: Read})
	}
	return requests
}

func (s ProductDirectoryService) list(ctx context.Context, id DirectoryIdentity, q DirectoryQuery, workspace string) (DirectoryPage, error) {
	result := DirectoryPage{Items: []DirectoryProduct{}, ProductLines: []DirectoryLine{}, Page: q.Page, PageSize: q.PageSize}
	if s.Registry == nil || s.Authorizer == nil || !validDirectoryCode(id.ActorUID) || (id.SourceDomain != "aims" && id.SourceDomain != "assets") {
		return result, ErrDirectoryAccess
	}
	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 || !utf8.ValidString(q.Keyword) || utf8.RuneCountInString(q.Keyword) > 200 || len(q.Watermark) > 191 {
		return result, ErrDirectoryQuery
	}
	for _, code := range []string{q.ProductCode, q.ProductLine} {
		if code != "" && !validDirectoryCode(code) {
			return result, ErrDirectoryQuery
		}
	}
	if q.Page > 1 && (q.Watermark == "" || (workspace != "" && q.WorkspaceRevision == nil)) {
		return result, ErrDirectoryQuery
	}
	// The in-process binding alone cannot prove this instance still owns the
	// current generation, so the snapshot transaction holds the persistent
	// registry fence for the whole read. This path never mutates business facts.
	tx, resolved, err := s.Registry.BeginSnapshotReadTransaction(ctx, directoryResolveRequests(id)...)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	assets := resolved[0]
	products, err := assets.Table("product_assets")
	if err != nil {
		return result, err
	}
	groups, err := assets.Table("asset_category_groups")
	if err != nil {
		return result, err
	}
	state, err := assets.Table("assets_product_catalog_state")
	if err != nil {
		return result, err
	}
	var aims Resolved
	if id.SourceDomain == "aims" {
		aims = resolved[1]
	}
	// Both capabilities must be authorized before reading object names or counts.
	if id.SourceDomain == "aims" {
		if err := s.Authorizer.AimsProductsView(ctx, tx, id, workspace); err != nil {
			return result, ErrDirectoryAccess
		}
	}
	grant, err := s.Authorizer.AssetsProductsView(ctx, tx, id)
	if err != nil {
		return result, ErrDirectoryAccess
	}
	scope, args, err := grantWhere(id, grant)
	if err != nil {
		return result, err
	}
	where := " WHERE " + scope
	if workspace != "" {
		roots, err := aims.Table("product_workspaces")
		if err != nil {
			return result, err
		}
		sources, err := aims.Table("product_component_sources")
		if err != nil {
			return result, err
		}
		var revision uint64
		if err := tx.QueryRowContext(ctx, "SELECT revision FROM "+roots+" WHERE BINARY product_code=BINARY ?", workspace).Scan(&revision); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return result, ErrDirectoryAccess
			}
			return result, err
		}
		if q.WorkspaceRevision != nil && *q.WorkspaceRevision != revision {
			return result, ErrDirectoryChanged
		}
		result.WorkspaceRevision = &revision
		where += " AND (BINARY p.product_code=BINARY ? OR EXISTS(SELECT 1 FROM " + sources + " src WHERE BINARY src.product_code=BINARY ? AND BINARY src.source_product_code=BINARY p.product_code))"
		args = append(args, workspace, workspace)
	}
	var ready int
	if err := tx.QueryRowContext(ctx, "SELECT CONCAT(epoch,':',revision),ready FROM "+state+" WHERE id=1").Scan(&result.Watermark, &ready); err != nil {
		return result, err
	}
	if ready != 1 || q.Watermark != "" && q.Watermark != result.Watermark {
		return result, ErrDirectoryChanged
	}
	if q.ProductCode != "" {
		where += " AND BINARY p.product_code=BINARY ?"
		args = append(args, q.ProductCode)
	}
	if q.ProductLine != "" {
		where += " AND BINARY p.product_line=BINARY ?"
		args = append(args, q.ProductLine)
	}
	if q.Keyword != "" {
		where += " AND (LOCATE(?,p.product_code)>0 OR LOCATE(?,p.product_name)>0)"
		args = append(args, q.Keyword, q.Keyword)
	}
	from := " FROM " + products + " p" + where
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*)"+from, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	// Scalar dictionary lookups do not multiply products. A registered schema
	// must preserve the existing unique scope/value constraint.
	label := "(SELECT g.category_label FROM " + groups + " g WHERE g.category_scope='product' AND BINARY g.category_value=BINARY p.product_line LIMIT 1)"
	rows, err := tx.QueryContext(ctx, "SELECT p.product_code,p.product_name,p.product_line,"+label+",p.status"+from+" ORDER BY BINARY p.product_code LIMIT ? OFFSET ?", append(append([]any{}, args...), q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var p DirectoryProduct
		if err := rows.Scan(&p.ProductCode, &p.ProductName, &p.ProductLine, &p.ProductLineLabel, &p.SourceStatus); err != nil {
			rows.Close()
			return result, err
		}
		p.ProductLineCode = p.ProductLine
		p.Status = p.SourceStatus
		result.Items = append(result.Items, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	rows, err = tx.QueryContext(ctx, "SELECT p.product_line,MAX("+label+")"+from+" GROUP BY BINARY p.product_line,p.product_line ORDER BY BINARY p.product_line", args...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var line DirectoryLine
		if err := rows.Scan(&line.Code, &line.Label); err != nil {
			rows.Close()
			return result, err
		}
		result.ProductLines = append(result.ProductLines, line)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	if !time.Now().Before(grant.ExpiresAt) {
		return DirectoryPage{}, ErrDirectoryAccess
	}
	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("enterprise: directory snapshot commit failed: %w", err)
	}
	return result, nil
}

// DirectoryLineCount and DirectorySummary are grant-scoped aggregates. They are
// derived from the same predicate as the list, so an actor never sees counts of
// products it cannot read.
type DirectoryLineCount struct {
	Code  string  `json:"code"`
	Label *string `json:"label"`
	Count int64   `json:"count"`
}
type DirectorySummary struct {
	Total    int64                `json:"total"`
	ByStatus map[string]int64     `json:"by_status"`
	ByLine   []DirectoryLineCount `json:"by_line"`
}

// DirectoryResolution answers "what are these product codes called" for cross
// domain rendering. Codes the actor may not read are reported as unresolved
// exactly like codes that do not exist, so membership is not disclosed.
type DirectoryResolution struct {
	Items      []DirectoryProduct `json:"items"`
	Unresolved []string           `json:"unresolved"`
	Summary    DirectorySummary   `json:"summary"`
	Watermark  string             `json:"watermark"`
}

const directoryResolveLimit = 200

// Resolve returns authorized names for the requested codes plus grant-scoped
// aggregates. It reuses the list authorization, catalog readiness and grant
// predicate; no branch widens the predicate for the requested codes.
func (s ProductDirectoryService) Resolve(ctx context.Context, id DirectoryIdentity, codes []string) (DirectoryResolution, error) {
	result := DirectoryResolution{Items: []DirectoryProduct{}, Unresolved: []string{}, Summary: DirectorySummary{ByStatus: map[string]int64{}, ByLine: []DirectoryLineCount{}}}
	if s.Registry == nil || s.Authorizer == nil || !validDirectoryCode(id.ActorUID) || (id.SourceDomain != "aims" && id.SourceDomain != "assets") {
		return result, ErrDirectoryAccess
	}
	if len(codes) == 0 || len(codes) > directoryResolveLimit {
		return result, ErrDirectoryQuery
	}
	requested := make(map[string]bool, len(codes))
	for _, code := range codes {
		if !validDirectoryCode(code) || requested[code] {
			return result, ErrDirectoryQuery
		}
		requested[code] = true
	}
	// Same persistent generation fence as list: a stale instance must not keep
	// answering resolutions from a superseded generation.
	tx, resolved, err := s.Registry.BeginSnapshotReadTransaction(ctx, directoryResolveRequests(id)...)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	assets := resolved[0]
	products, err := assets.Table("product_assets")
	if err != nil {
		return result, err
	}
	groups, err := assets.Table("asset_category_groups")
	if err != nil {
		return result, err
	}
	state, err := assets.Table("assets_product_catalog_state")
	if err != nil {
		return result, err
	}
	if id.SourceDomain == "aims" {
		if err := s.Authorizer.AimsProductsView(ctx, tx, id, ""); err != nil {
			return result, ErrDirectoryAccess
		}
	}
	grant, err := s.Authorizer.AssetsProductsView(ctx, tx, id)
	if err != nil {
		return result, ErrDirectoryAccess
	}
	scope, scopeArgs, err := grantWhere(id, grant)
	if err != nil {
		return result, err
	}
	var ready int
	if err := tx.QueryRowContext(ctx, "SELECT CONCAT(epoch,':',revision),ready FROM "+state+" WHERE id=1").Scan(&result.Watermark, &ready); err != nil {
		return result, err
	}
	if ready != 1 {
		return result, ErrDirectoryChanged
	}
	label := "(SELECT g.category_label FROM " + groups + " g WHERE g.category_scope='product' AND BINARY g.category_value=BINARY p.product_line LIMIT 1)"
	slots := make([]string, 0, len(codes))
	args := append([]any{}, scopeArgs...)
	for code := range requested {
		slots = append(slots, "?")
		args = append(args, code)
	}
	rows, err := tx.QueryContext(ctx, "SELECT p.product_code,p.product_name,p.product_line,"+label+",p.status FROM "+products+" p WHERE "+scope+" AND BINARY p.product_code IN ("+strings.Join(slots, ",")+") ORDER BY BINARY p.product_code", args...)
	if err != nil {
		return result, err
	}
	found := map[string]bool{}
	for rows.Next() {
		var item DirectoryProduct
		if err := rows.Scan(&item.ProductCode, &item.ProductName, &item.ProductLine, &item.ProductLineLabel, &item.SourceStatus); err != nil {
			rows.Close()
			return result, err
		}
		found[item.ProductCode] = true
		result.Items = append(result.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	for _, code := range codes {
		if !found[code] {
			result.Unresolved = append(result.Unresolved, code)
		}
	}
	summaryFrom := " FROM " + products + " p WHERE " + scope
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*)"+summaryFrom, scopeArgs...).Scan(&result.Summary.Total); err != nil {
		return result, err
	}
	statusRows, err := tx.QueryContext(ctx, "SELECT p.status,COUNT(*)"+summaryFrom+" GROUP BY p.status ORDER BY p.status", scopeArgs...)
	if err != nil {
		return result, err
	}
	for statusRows.Next() {
		var status string
		var count int64
		if err := statusRows.Scan(&status, &count); err != nil {
			statusRows.Close()
			return result, err
		}
		result.Summary.ByStatus[status] = count
	}
	err = statusRows.Err()
	statusRows.Close()
	if err != nil {
		return result, err
	}
	lineRows, err := tx.QueryContext(ctx, "SELECT p.product_line,MAX("+label+"),COUNT(*)"+summaryFrom+" GROUP BY BINARY p.product_line,p.product_line ORDER BY BINARY p.product_line", scopeArgs...)
	if err != nil {
		return result, err
	}
	for lineRows.Next() {
		var line DirectoryLineCount
		if err := lineRows.Scan(&line.Code, &line.Label, &line.Count); err != nil {
			lineRows.Close()
			return result, err
		}
		result.Summary.ByLine = append(result.Summary.ByLine, line)
	}
	err = lineRows.Err()
	lineRows.Close()
	if err != nil {
		return result, err
	}
	if !time.Now().Before(grant.ExpiresAt) {
		return DirectoryResolution{}, ErrDirectoryAccess
	}
	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("enterprise: directory resolve commit failed: %w", err)
	}
	return result, nil
}
