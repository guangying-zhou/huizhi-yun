package codocs

import "github.com/huizhi-yun/data-runtime/internal/documentcatalog"

// DocumentCatalogStore exposes the catalog tables of this Codocs database to
// the Runtime wiring and the reconcile command only (document asset design
// DOC-07). No Codocs route, list, search or write path uses it.
func (a *Adapter) DocumentCatalogStore() *documentcatalog.Store {
	if a == nil {
		return documentcatalog.NewStore(nil)
	}
	return documentcatalog.NewStore(a.db)
}
