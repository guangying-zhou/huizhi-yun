package enterpriseassets

import (
	"context"
	"database/sql"
	assets "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
)

// ProductService retains Assets ownership and binds every read/write to the
// Registry generation. Logical views are verified against registered tables.
type ProductService struct {
	registry          *e.Registry
	reader, writer    e.ResolveRequest
	dictionaryTable   string
	commandDeployment string
}

func ProductViewNames() []string {
	return []string{"product_assets", "asset_category_groups", "asset_category_items", "product_asset_resources", "product_asset_bases", "technology_bases", "asset_items", "asset_documents", "asset_delivery_products", "asset_delivery_views", "asset_events"}
}
func NewProductService(ctx context.Context, registry *e.Registry, binding e.Binding, commandDeployment string) (*ProductService, error) {
	if registry == nil {
		return nil, e.ErrBindingNotFound
	}
	d, ok := binding.Domains["assets"]
	if !ok {
		return nil, e.ErrBindingNotFound
	}
	reader := e.ResolveRequest{Key: binding.Key, Domain: "assets", OwnerDeployment: d.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Read}
	resolved, err := registry.Resolve(reader)
	if err != nil {
		return nil, err
	}
	if err = e.VerifyCompatibilityViews(ctx, resolved.DB, binding, "assets", ProductViewNames()); err != nil {
		return nil, err
	}
	if d.Write == e.PathUnified {
		if commandDeployment == "" {
			return nil, e.ErrBindingMismatch
		}
		receipt, err := resolved.Table("service_command_receipt")
		if err != nil {
			return nil, err
		}
		if err := assets.VerifyOwnedProductReceiptSchema(ctx, resolved.DB, receipt); err != nil {
			return nil, err
		}
	}
	writer := reader
	writer.Operation = e.Write
	dictionaryTable, err := resolved.Table("system_parameters")
	if err != nil {
		return nil, err
	}
	return &ProductService{registry: registry, reader: reader, writer: writer, dictionaryTable: dictionaryTable, commandDeployment: commandDeployment}, nil
}
func (s *ProductService) read(ctx context.Context, apply func(*sql.Tx) (any, error)) (any, error) {
	if s == nil || s.registry == nil {
		return nil, e.ErrBindingNotFound
	}
	tx, _, err := s.registry.BeginSnapshotReadTransaction(ctx, s.reader)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := apply(tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
func (s *ProductService) List(ctx context.Context, q url.Values) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) { return assets.ListProductsInTransaction(ctx, tx, q) })
}
func (s *ProductService) View(ctx context.Context, id int64, q url.Values) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) { return assets.ReadProductInTransaction(ctx, tx, id, q) })
}
func (s *ProductService) Categories(ctx context.Context, scope string, disabled bool) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) {
		items, err := assets.ListAssetCategoriesInTransaction(ctx, tx, scope, disabled)
		return map[string]any{"items": items}, err
	})
}
func (s *ProductService) Dictionaries(ctx context.Context) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) {
		items, err := assets.ListProductDictionariesInTransaction(ctx, tx, s.dictionaryTable)
		return map[string]any{"items": items}, err
	})
}

func (s *ProductService) command(ctx context.Context, identity assets.ProductMasterCommandIdentity, apply func(*sql.Tx, *io.ReceiptRepository) (any, error)) (any, error) {
	if s == nil || s.registry == nil {
		return nil, e.ErrBindingNotFound
	}
	if identity.Tenant != s.writer.Key.Tenant || identity.CommandDeployment == "" || identity.CommandDeployment != s.commandDeployment {
		return nil, e.ErrBindingMismatch
	}
	tx, resolved, err := s.registry.BeginWriteTransaction(ctx, s.writer)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	receipt, err := resolved[0].Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	if err := assets.VerifyOwnedProductReceiptSchema(ctx, tx, receipt); err != nil {
		return nil, err
	}
	repo, err := io.NewReceiptRepository(resolved[0].DB, io.WithReceiptTable(receipt))
	if err != nil {
		return nil, err
	}
	target, err := apply(tx, repo)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return target, nil
}

func (s *ProductService) Command(ctx context.Context, identity assets.ProductMasterCommandIdentity, action string, id int64, body map[string]any, q url.Values) (int64, error) {
	out, err := s.command(ctx, identity, func(tx *sql.Tx, repo *io.ReceiptRepository) (any, error) {
		return assets.ExecuteProductMasterInTransaction(ctx, tx, repo, identity, action, id, body, q)
	})
	if err != nil {
		return 0, err
	}
	return out.(int64), nil
}
func (s *ProductService) SaveProductCategory(ctx context.Context, identity assets.ProductMasterCommandIdentity, id int64, body map[string]any) (any, error) {
	return s.command(ctx, identity, func(tx *sql.Tx, repo *io.ReceiptRepository) (any, error) {
		return assets.ExecuteProductCategoryInTransaction(ctx, tx, repo, identity, id, body)
	})
}

func (s *ProductService) Link(ctx context.Context, identity assets.ProductMasterCommandIdentity, action string, id int64, body map[string]any, q url.Values) (int64, error) {
	out, err := s.command(ctx, identity, func(tx *sql.Tx, repo *io.ReceiptRepository) (any, error) {
		resolved, err := s.registry.Resolve(s.writer)
		if err != nil {
			return nil, err
		}
		table, err := resolved.Table("service_command_receipt")
		if err != nil {
			return nil, err
		}
		if err = assets.VerifyOwnedProductLinkReceiptSchema(ctx, tx, table); err != nil {
			return nil, err
		}
		return assets.ExecuteProductLinkInTransaction(ctx, tx, repo, identity, action, id, body, q)
	})
	if err != nil {
		return 0, err
	}
	return out.(int64), nil
}

func (s *ProductService) LinkCandidates(ctx context.Context, kind string, q url.Values) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) { return assets.ListProductLinkCandidatesInTransaction(ctx, tx, kind, q) })
}
