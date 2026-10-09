package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseticket"
	"strconv"
)

type ticketTransactionKey struct{}
type ticketTransactionState struct {
	ids      []int64
	prepared enterpriseticket.Prepared
}

func withTicketTransactionItems(ctx context.Context, ids ...int64) context.Context {
	return context.WithValue(ctx, ticketTransactionKey{}, &ticketTransactionState{ids: ids})
}
func ticketTransactionItem(ctx context.Context, id string) context.Context {
	n, e := strconv.ParseInt(id, 10, 64)
	if e != nil {
		return ctx
	}
	return withTicketTransactionItems(ctx, n)
}
func ticketResultContext(ctx context.Context) context.Context {
	if s, _ := ctx.Value(ticketTransactionKey{}).(*ticketTransactionState); s != nil && s.prepared != nil {
		return enterpriseticket.With(ctx, s.prepared)
	}
	return ctx
}
func (a *Adapter) unifiedTicketTransactions() bool {
	return a.enterpriseWrites != nil && domaininstall.IsAltocTicketsDomain(a.enterpriseWrites.binding.Domains["altoc"])
}

// Only Runtime construction wires the owning provider; no transport can select it.
func (a *Adapter) ConfigureTicketResults(p enterpriseticket.Prepare) { a.ticketResultPrepare = p }
