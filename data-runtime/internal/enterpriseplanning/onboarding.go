package enterpriseplanning

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/assets"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"strings"
	"time"
	"unicode/utf8"
)

type OnboardingService struct {
	catalog *CatalogService
	writer  e.ResolveRequest
}
type ProductOnboardCandidate struct {
	Item      pc.CatalogSourceItem `json:"item"`
	Watermark string               `json:"watermark"`
}
type LineOnboardCandidates struct {
	LineCode  string                 `json:"line_code"`
	Label     string                 `json:"label"`
	Watermark string                 `json:"watermark"`
	Items     []pc.CatalogSourceItem `json:"items"`
	Total     int                    `json:"total"`
}

func NewOnboardingService(ctx context.Context, registry *e.Registry, binding e.Binding) (*OnboardingService, error) {
	catalog, err := NewCatalogService(ctx, registry, binding)
	if err != nil {
		return nil, err
	}
	writer := catalog.aims
	writer.Operation = e.Write
	resolved, err := registry.Resolve(writer)
	if err != nil {
		return nil, err
	}
	if err = e.VerifyCompatibilityViews(ctx, resolved.DB, binding, "aims", OnboardingViewNames()); err != nil {
		return nil, err
	}
	return &OnboardingService{catalog, writer}, nil
}
func onboardAccess(actor, code string, p pc.OnboardPermit) error {
	if actor == "" || code == "" || strings.TrimSpace(code) != code || !utf8.ValidString(code) || utf8.RuneCountInString(code) > 64 || strings.ContainsAny(code, "\x00\r\n") || p.ActorUID != actor || p.ProductCode != code || p.Resource != "products" || p.Action != "onboard" || p.ExpiresAt <= time.Now().UnixMilli() || p.ExpiresAt > time.Now().Add(30*time.Second).UnixMilli() {
		return e.ErrDirectoryAccess
	}
	return nil
}
func (s *OnboardingService) begin(ctx context.Context, write bool) (*sql.Tx, error) {
	if s == nil || s.catalog == nil {
		return nil, e.ErrBindingNotFound
	}
	if !write {
		tx, _, err := s.catalog.registry.BeginSnapshotReadTransaction(ctx, s.catalog.aims, s.catalog.assets)
		return tx, err
	}
	a, err := s.catalog.registry.Resolve(s.writer)
	if err != nil {
		return nil, err
	}
	b, err := s.catalog.registry.Resolve(s.catalog.assets)
	if err != nil {
		return nil, err
	}
	if a.DB != b.DB || a.Key != b.Key || a.SchemaVersion != b.SchemaVersion || a.Generation != b.Generation {
		return nil, e.ErrBindingMismatch
	}
	tx, _, err := s.catalog.registry.BeginWriteTransaction(ctx, s.writer)
	if err != nil {
		return nil, err
	}
	var singleton int
	if err = tx.QueryRowContext(ctx, "SELECT id FROM product_catalog_control WHERE id=1 FOR UPDATE").Scan(&singleton); err != nil {
		tx.Rollback()
		return nil, err
	}
	return tx, nil
}
func (s *OnboardingService) evidence(ctx context.Context, tx *sql.Tx, actor, code string, line, write bool, authorizer AssetsCatalogAuthorizer) ([]pc.CatalogSourceItem, string, pc.CurrentCatalogSource, error) {
	var empty pc.CurrentCatalogSource
	if authorizer == nil {
		return nil, "", empty, e.ErrDirectoryAccess
	}
	c := s.catalog
	identity := e.DirectoryIdentity{SourceDomain: "aims", Key: c.aims.Key, ActorUID: actor, SchemaVersion: c.aims.SchemaVersion, Generation: c.aims.Generation, AssetsOwnerDeployment: c.assets.OwnerDeployment, AimsOwnerDeployment: c.aims.OwnerDeployment}
	grant, err := authorizer.AssetsProductsView(ctx, tx, identity)
	if err != nil {
		return nil, "", empty, err
	}
	if grant.Key != identity.Key || grant.ActorUID != actor || grant.SchemaVersion != identity.SchemaVersion || grant.Generation != identity.Generation || !time.Now().Before(grant.ExpiresAt) || grant.ExpiresAt.After(time.Now().Add(30*time.Second)) || (line && !grant.AllProducts) {
		return nil, "", empty, e.ErrDirectoryAccess
	}
	current, err := pc.NewCurrentCatalogSource(c.products, c.groups, actor, grant.ExpiresAt.UnixMilli(), grant.AllProducts, grant.ProductCodes)
	if err != nil {
		return nil, "", empty, err
	}
	field := "p.product_code"
	if line {
		field = "p.product_line"
	}
	predicate := "BINARY " + field + "=BINARY ?"
	args := []any{code}
	if !grant.AllProducts {
		codes, _ := json.Marshal(grant.ProductCodes)
		predicate += " AND EXISTS(SELECT 1 FROM JSON_TABLE(?, '$[*]' COLUMNS(code VARCHAR(64) PATH '$')) visible WHERE BINARY visible.code=BINARY p.product_code)"
		args = append(args, string(codes))
	}
	query := "SELECT p.product_code,p.product_name,p.product_line,g.category_label,g.sort_order,p.status,p.business_owner_uid,p.technical_owner_uid,CONCAT(LEFT(DATE_FORMAT(GREATEST(p.updated_at,COALESCE(g.updated_at,p.updated_at)),'%Y-%m-%dT%H:%i:%s.%f'),23),'Z') FROM " + c.products + " p LEFT JOIN " + c.groups + " g ON g.category_scope='product' AND BINARY g.category_value=BINARY p.product_line WHERE " + predicate + " ORDER BY BINARY p.product_code LIMIT 1001"
	if write {
		query += " FOR SHARE"
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, "", empty, err
	}
	items := []pc.CatalogSourceItem{}
	for rows.Next() {
		var item pc.CatalogSourceItem
		if err = rows.Scan(&item.ProductCode, &item.ProductName, &item.ProductLine, &item.ProductLineLabel, &item.ProductLineSortOrder, &item.SourceStatus, &item.BusinessOwnerUID, &item.TechnicalOwnerUID, &item.SourceUpdatedAt); err != nil {
			rows.Close()
			return nil, "", empty, err
		}
		item.Onboardable = assets.ProductStatusOnboardable(item.SourceStatus)
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, "", empty, err
	}
	if len(items) == 0 || len(items) > 1000 || (!line && len(items) != 1) {
		return nil, "", empty, e.ErrDirectoryAccess
	}
	payload, _ := json.Marshal(struct {
		Identity e.DirectoryIdentity
		Items    []pc.CatalogSourceItem
	}{identity, items})
	hash := sha256.Sum256(payload)
	return items, "current-assets:v1:" + hex.EncodeToString(hash[:]), current, nil
}
func (s *OnboardingService) ProductCandidate(ctx context.Context, actor string, permit pc.OnboardPermit, code string, authorizer AssetsCatalogAuthorizer) (ProductOnboardCandidate, error) {
	if err := onboardAccess(actor, code, permit); err != nil {
		return ProductOnboardCandidate{}, err
	}
	tx, err := s.begin(ctx, false)
	if err != nil {
		return ProductOnboardCandidate{}, err
	}
	defer tx.Rollback()
	items, hash, _, err := s.evidence(ctx, tx, actor, code, false, false, authorizer)
	if err != nil {
		return ProductOnboardCandidate{}, err
	}
	if err = tx.Commit(); err != nil {
		return ProductOnboardCandidate{}, err
	}
	return ProductOnboardCandidate{items[0], hash}, nil
}
func (s *OnboardingService) LineCandidates(ctx context.Context, actor string, permit pc.OnboardPermit, line string, authorizer AssetsCatalogAuthorizer) (LineOnboardCandidates, error) {
	if err := onboardAccess(actor, pc.LineWorkspaceCode(line), permit); err != nil {
		return LineOnboardCandidates{}, err
	}
	tx, err := s.begin(ctx, false)
	if err != nil {
		return LineOnboardCandidates{}, err
	}
	defer tx.Rollback()
	items, hash, _, err := s.evidence(ctx, tx, actor, line, true, false, authorizer)
	if err != nil {
		return LineOnboardCandidates{}, err
	}
	label := line
	if items[0].ProductLineLabel != nil {
		label = *items[0].ProductLineLabel
	}
	if err = tx.Commit(); err != nil {
		return LineOnboardCandidates{}, err
	}
	return LineOnboardCandidates{line, label, hash, items, len(items)}, nil
}
func (s *OnboardingService) Onboard(ctx context.Context, id pc.CommandIdentity, permit pc.OnboardPermit, directory pc.MemberDirectoryEvidence, input pc.OnboardInput, authorizer AssetsCatalogAuthorizer) (pc.CommandResult, error) {
	if err := onboardAccess(id.ActorUID, id.ProductCode, permit); err != nil {
		return pc.CommandResult{}, err
	}
	tx, err := s.begin(ctx, true)
	if err != nil {
		return pc.CommandResult{}, err
	}
	defer tx.Rollback()
	items, hash, current, err := s.evidence(ctx, tx, id.ActorUID, id.ProductCode, false, true, authorizer)
	if err != nil {
		return pc.CommandResult{}, err
	}
	source := pc.OnboardSourceEvidence{ProductCode: items[0].ProductCode, ProductLine: items[0].ProductLine, Watermark: hash, Onboardable: items[0].Onboardable, ExpiresAt: min(permit.ExpiresAt, current.ExpiresAtMillis())}
	result, err := pc.OnboardWorkspaceInTransaction(ctx, tx, id, permit, source, directory, input)
	if err != nil {
		return pc.CommandResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return pc.CommandResult{}, err
	}
	return result, nil
}
func (s *OnboardingService) OnboardLine(ctx context.Context, id pc.CommandIdentity, permit pc.OnboardPermit, directory pc.MemberDirectoryEvidence, input pc.LineOnboardInput, authorizer AssetsCatalogAuthorizer) (pc.CommandResult, error) {
	if id.ProductCode != pc.LineWorkspaceCode(input.LineCode) {
		return pc.CommandResult{}, e.ErrDirectoryAccess
	}
	if err := onboardAccess(id.ActorUID, id.ProductCode, permit); err != nil {
		return pc.CommandResult{}, err
	}
	tx, err := s.begin(ctx, true)
	if err != nil {
		return pc.CommandResult{}, err
	}
	defer tx.Rollback()
	items, hash, current, err := s.evidence(ctx, tx, id.ActorUID, input.LineCode, true, true, authorizer)
	if err != nil {
		return pc.CommandResult{}, err
	}
	source := pc.LineSourceEvidence{LineCode: input.LineCode, Watermark: hash, Items: items, Total: len(items), ExpiresAt: min(permit.ExpiresAt, current.ExpiresAtMillis())}
	result, err := pc.OnboardProductLineInTransaction(ctx, tx, id, permit, source, directory, input, &current)
	if err != nil {
		return pc.CommandResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return pc.CommandResult{}, err
	}
	return result, nil
}

// OnboardingViewNames is shared by service verification and migration candidate generation.
func OnboardingViewNames() []string {
	return []string{"product_catalog_control", "product_workspaces", "product_members", "product_command_receipts", "product_activity_logs", "product_components", "product_component_sources", "product_line_workspaces"}
}
