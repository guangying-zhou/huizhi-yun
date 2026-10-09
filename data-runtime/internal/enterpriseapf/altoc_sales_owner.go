package enterpriseapf

import (
	"context"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Directory is read before the business transaction. Only an actual new
// assignment consumes the result: historical owners remain readable, and an
// unrelated update or an existing task does not fail because its owner left.
// A concurrent owner change must retry rather than consume another uid's check.
type salesOwnerCheck func(string) error

func (s *Service) prepareSalesOwnerCheck(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (salesOwnerCheck, error) {
	uid := salesText(i.Payload, "owner_uid")
	needed := salesText(i.Payload, "next_action") != "" || op == "leads-convert" || strings.Contains(op, "-activities-create")
	if op != "leads-create" && op != "opportunities-create" {
		req, err := s.request("altoc", enterprise.Read)
		if err != nil {
			return nil, err
		}
		tx, resolved, err := s.registry.BeginSnapshotReadTransaction(ctx, req)
		if err != nil {
			return nil, err
		}
		resource, _, _ := SalesPermission(op)
		table, err := resolved[0].Table("altoc_" + resource)
		if err != nil {
			tx.Rollback()
			return nil, err
		}
		row, err := salesRow(ctx, tx, table, "id=? AND deleted_at IS NULL", i.ID)
		tx.Rollback()
		if err != nil {
			return nil, err
		}
		if err = salesScope(scope, who.Actor, row); err != nil {
			return nil, err
		}
		if uid == "" {
			uid = salesText(row, "owner_uid")
		}
		if _, supplied := i.Payload["next_action"]; !supplied {
			needed = needed || salesText(row, "next_action") != ""
		}
	}
	var checked error
	if needed {
		checked = s.verifyOwnerTarget(ctx, uid)
	}
	return func(actual string) error {
		if !needed || actual != uid {
			return httperror.New(409, "altoc_sales_owner_changed", "负责人已变化，请刷新后重试")
		}
		return checked
	}, nil
}
