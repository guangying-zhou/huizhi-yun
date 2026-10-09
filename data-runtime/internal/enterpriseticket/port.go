// Package enterpriseticket is the narrow owning result port wired at Runtime
// construction. It has no transport decoder, authority fields or SQL selector.
package enterpriseticket

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

type Prepared interface {
	Apply(context.Context, *sql.Tx, string, map[string]any) (bool, error)
}
type Prepare func(context.Context, *sql.Tx, enterprise.Resolved, enterprise.Resolved, []int64) (Prepared, error)
type key struct{}

func With(ctx context.Context, p Prepared) context.Context { return context.WithValue(ctx, key{}, p) }
func Has(ctx context.Context) bool                         { p, _ := ctx.Value(key{}).(Prepared); return p != nil }
func Apply(ctx context.Context, tx *sql.Tx, id string, facts map[string]any) (bool, error) {
	p, _ := ctx.Value(key{}).(Prepared)
	if p == nil {
		return false, nil
	}
	return p.Apply(ctx, tx, id, facts)
}
