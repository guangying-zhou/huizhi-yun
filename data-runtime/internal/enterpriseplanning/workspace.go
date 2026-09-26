package enterpriseplanning

import (
	"context"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"time"
)

func (s *CatalogService) ReadWorkspace(ctx context.Context, code, actorUID string, permit pc.AuthorizationPermit, authorizer AssetsCatalogAuthorizer) (pc.WorkspaceDetail, error) {
	if s == nil || s.registry == nil || authorizer == nil {
		return pc.WorkspaceDetail{}, e.ErrDirectoryAccess
	}
	tx, _, err := s.registry.BeginSnapshotReadTransaction(ctx, s.aims, s.assets)
	if err != nil {
		return pc.WorkspaceDetail{}, err
	}
	defer tx.Rollback()
	// Lock/recheck the Aims workspace before the first Assets scope snapshot.
	// The domain repeats the same owning check when loading its response.
	if err = pc.AuthorizeWorkspaceTransaction(ctx, tx, code, actorUID, "products", "view", permit); err != nil {
		return pc.WorkspaceDetail{}, err
	}
	identity := e.DirectoryIdentity{SourceDomain: "aims", Key: s.aims.Key, ActorUID: actorUID, SchemaVersion: s.aims.SchemaVersion, Generation: s.aims.Generation, AssetsOwnerDeployment: s.assets.OwnerDeployment, AimsOwnerDeployment: s.aims.OwnerDeployment}
	grant, err := authorizer.AssetsProductsView(ctx, tx, identity)
	if err != nil {
		return pc.WorkspaceDetail{}, err
	}
	if grant.Key != identity.Key || grant.ActorUID != actorUID || grant.SchemaVersion != identity.SchemaVersion || grant.Generation != identity.Generation || !time.Now().Before(grant.ExpiresAt) {
		return pc.WorkspaceDetail{}, e.ErrDirectoryAccess
	}
	source, err := pc.NewCurrentCatalogSource(s.products, s.groups, actorUID, grant.ExpiresAt.UnixMilli(), grant.AllProducts, grant.ProductCodes)
	if err != nil {
		return pc.WorkspaceDetail{}, err
	}
	detail, err := pc.ReadWorkspaceInTransaction(ctx, tx, code, actorUID, permit, source)
	if err != nil {
		return pc.WorkspaceDetail{}, err
	}
	if err = tx.Commit(); err != nil {
		return pc.WorkspaceDetail{}, err
	}
	return detail, nil
}
