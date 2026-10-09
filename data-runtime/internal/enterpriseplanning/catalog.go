package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"time"
)

// AssetsCatalogAuthorizer adapts the authenticated Assets BFF decision and
// rechecks its object scope in the supplied transaction. Aims scope is enforced
// independently by ProductListPermit and live membership in the owning query.
type AssetsCatalogAuthorizer interface {
	AssetsProductsView(context.Context, *sql.Tx, e.DirectoryIdentity) (e.DirectoryGrant, error)
}

type CatalogService struct {
	registry         *e.Registry
	aims, assets     e.ResolveRequest
	products, groups string
}

func NewCatalogService(ctx context.Context, registry *e.Registry, binding e.Binding) (*CatalogService, error) {
	if registry == nil {
		return nil, e.ErrBindingNotFound
	}
	s := &CatalogService{registry: registry}
	for _, domain := range []string{"aims", "assets"} {
		d, ok := binding.Domains[domain]
		if !ok {
			return nil, e.ErrBindingNotFound
		}
		request := e.ResolveRequest{Key: binding.Key, Domain: domain, OwnerDeployment: d.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Read}
		if domain == "aims" {
			s.aims = request
		} else {
			s.assets = request
		}
	}
	a, err := registry.Resolve(s.aims)
	if err != nil {
		return nil, err
	}
	assets, err := registry.Resolve(s.assets)
	if err != nil {
		return nil, err
	}
	if a.DB != assets.DB {
		return nil, e.ErrBindingMismatch
	}
	if err = e.VerifyCompatibilityViews(ctx, a.DB, binding, "aims", CatalogViewNames()); err != nil {
		return nil, err
	}
	s.products, err = assets.Table("product_assets")
	if err != nil {
		return nil, err
	}
	s.groups, err = assets.Table("asset_category_groups")
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (s *CatalogService) List(ctx context.Context, actorUID string, permit pc.ProductListPermit, input pc.ProductListQuery, authorizer AssetsCatalogAuthorizer) (pc.ProductListPage, error) {
	if s == nil || s.registry == nil || authorizer == nil {
		return pc.ProductListPage{}, e.ErrDirectoryAccess
	}
	tx, _, err := s.registry.BeginSnapshotReadTransaction(ctx, s.aims, s.assets)
	if err != nil {
		return pc.ProductListPage{}, err
	}
	defer tx.Rollback()
	identity := e.DirectoryIdentity{SourceDomain: "aims", Key: s.aims.Key, ActorUID: actorUID, SchemaVersion: s.aims.SchemaVersion, Generation: s.aims.Generation, AssetsOwnerDeployment: s.assets.OwnerDeployment, AimsOwnerDeployment: s.aims.OwnerDeployment}
	grant, err := authorizer.AssetsProductsView(ctx, tx, identity)
	if err != nil {
		return pc.ProductListPage{}, err
	}
	if grant.Key != identity.Key || grant.ActorUID != actorUID || grant.SchemaVersion != identity.SchemaVersion || grant.Generation != identity.Generation || !time.Now().Before(grant.ExpiresAt) {
		return pc.ProductListPage{}, e.ErrDirectoryAccess
	}
	source, err := pc.NewCurrentCatalogSource(s.products, s.groups, actorUID, grant.ExpiresAt.UnixMilli(), grant.AllProducts, grant.ProductCodes)
	if err != nil {
		return pc.ProductListPage{}, err
	}
	page, err := pc.ListProductsInTransaction(ctx, tx, actorUID, permit, input, source)
	if err != nil {
		return pc.ProductListPage{}, err
	}
	if err = tx.Commit(); err != nil {
		return pc.ProductListPage{}, err
	}
	return page, nil
}

// CatalogViewNames is shared by service verification and migration candidate generation.
func CatalogViewNames() []string {
	return []string{"product_workspaces", "product_members", "product_component_sources", "product_line_workspaces"}
}
