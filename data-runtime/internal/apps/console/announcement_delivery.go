package console

import (
	"context"
	"database/sql"
	"errors"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"time"
)

type AnnouncementDelivery struct {
	ID       string `json:"id"`
	Revision uint64 `json:"revision"`
	UID      string `json:"uid"`
	Channel  string `json:"channel"`
	Lease    string `json:"lease"`
	Key      string `json:"key"`
}

// Prepare recipients once, at activation. New members see the announcement in
// Host without retroactively receiving a broadcast. Claim rechecks eligibility.
func (a *Adapter) ClaimAnnouncementDelivery(ctx context.Context) (map[string]any, error) {
	return a.claimAnnouncementDelivery(ctx, "")
}

func (a *Adapter) ClaimImmediateAnnouncementDelivery(ctx context.Context, id string) (map[string]any, error) {
	if _, e := uuid.Parse(id); e != nil {
		return nil, announcementBad()
	}
	return a.claimAnnouncementDelivery(ctx, id)
}

func (a *Adapter) claimAnnouncementDelivery(ctx context.Context, requestedID string) (map[string]any, error) {
	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	tenant, _, e := lockCurrentProfile(ctx, tx)
	if e != nil {
		return nil, e
	}
	if tenant != a.tenant {
		return nil, httperror.New(403, "console_tenant_binding_mismatch", "Tenant mismatch")
	}
	var id, audience string
	var revision uint64
	var bell, wecom bool
	e = tx.QueryRowContext(ctx, `SELECT announcement_id,revision,audience,push_bell,push_wecom FROM console_announcements WHERE tenant_code=? AND status='published' AND delivery_prepared=0 AND (?='' OR announcement_id=?) AND starts_at<=UTC_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at>UTC_TIMESTAMP(3)) ORDER BY starts_at,announcement_id LIMIT 1 FOR UPDATE SKIP LOCKED`, a.tenant, requestedID, requestedID).Scan(&id, &revision, &audience, &bell, &wecom)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	if e == nil {
		if bell || wecom {
			where := `u.status='active' AND u.user_type='employee' AND u.uid NOT LIKE 'system:%'`
			extra := []any{}
			if audience == "departments" {
				where += ` AND EXISTS(SELECT 1 FROM directory_user_departments ud JOIN directory_departments d ON d.dept_code=ud.dept_code AND d.status='active' JOIN console_announcement_departments ad ON ad.dept_code=d.dept_code WHERE ud.uid=u.uid AND ud.status='active' AND ud.relation_type='member' AND ad.tenant_code=? AND ad.announcement_id=?)`
				extra = []any{a.tenant, id}
			}
			channels := []string{}
			if bell {
				channels = append(channels, "in_app")
			}
			if wecom {
				channels = append(channels, "wecom")
			}
			for _, channel := range channels {
				args := append([]any{a.tenant, id, revision, channel}, extra...)
				// The claim clock is UTC; a DATETIME session-local default can
				// postpone immediate delivery on a non-UTC Console pool.
				if _, e = tx.ExecContext(ctx, `INSERT IGNORE INTO console_announcement_outbox(tenant_code,announcement_id,revision,uid,channel,next_attempt_at) SELECT ?,?,?,u.uid,?,UTC_TIMESTAMP(3) FROM directory_users u WHERE `+where, args...); e != nil {
					return nil, e
				}
			}

		}
		if _, e = tx.ExecContext(ctx, `UPDATE console_announcements SET delivery_prepared=1 WHERE tenant_code=? AND announcement_id=? AND revision=?`, a.tenant, id, revision); e != nil {
			return nil, e
		}
	}
	var out AnnouncementDelivery
	e = tx.QueryRowContext(ctx, `SELECT announcement_id,revision,uid,channel FROM console_announcement_outbox WHERE tenant_code=? AND (?='' OR announcement_id=?) AND state='pending' AND next_attempt_at<=UTC_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3)) ORDER BY next_attempt_at,announcement_id,uid,channel LIMIT 1 FOR UPDATE SKIP LOCKED`, a.tenant, requestedID, requestedID).Scan(&out.ID, &out.Revision, &out.UID, &out.Channel)
	if errors.Is(e, sql.ErrNoRows) {
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"code": 0, "data": nil}, nil
	}
	if e != nil {
		return nil, e
	}
	var eligible int
	e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM console_announcements a JOIN directory_users u ON u.uid=? AND u.status='active' AND u.user_type='employee' WHERE a.tenant_code=? AND a.announcement_id=? AND a.revision=? AND `+announcementVisible, out.UID, a.tenant, out.ID, out.Revision, out.UID).Scan(&eligible)
	if e != nil {
		return nil, e
	}
	if eligible != 1 {
		_, e = tx.ExecContext(ctx, `UPDATE console_announcement_outbox SET state='cancelled' WHERE tenant_code=? AND announcement_id=? AND revision=? AND uid=? AND channel=?`, a.tenant, out.ID, out.Revision, out.UID, out.Channel)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"code": 0, "data": nil}, nil
	}
	out.Lease = uuid.NewString()
	out.Key = announcementDeliveryKey(out.ID, out.Revision, out.UID, out.Channel)
	_, e = tx.ExecContext(ctx, `UPDATE console_announcement_outbox SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE tenant_code=? AND announcement_id=? AND revision=? AND uid=? AND channel=?`, out.Lease, time.Now().UTC().Add(60*time.Second), a.tenant, out.ID, out.Revision, out.UID, out.Channel)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"code": 0, "data": out}, nil
}
func (a *Adapter) AckAnnouncementDelivery(ctx context.Context, in AnnouncementDelivery, success bool) (map[string]any, error) {
	if _, e := uuid.Parse(in.ID); e != nil {
		return nil, announcementBad()
	}
	if _, e := uuid.Parse(in.Lease); e != nil {
		return nil, announcementBad()
	}
	q := `UPDATE console_announcement_outbox SET lease_token=NULL,lease_until=NULL,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND)`
	if success {
		q = `UPDATE console_announcement_outbox SET state='delivered',delivered_at=UTC_TIMESTAMP(3),lease_until=NULL`
	}
	res, e := a.db.ExecContext(ctx, q+` WHERE tenant_code=? AND announcement_id=? AND revision=? AND uid=? AND channel=? AND lease_token=? AND state='pending' AND lease_until>UTC_TIMESTAMP(3)`, a.tenant, in.ID, in.Revision, in.UID, in.Channel, in.Lease)
	if e != nil {
		return nil, e
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return nil, httperror.New(409, "announcement_lease_lost", "Delivery lease expired or replaced")
	}
	return map[string]any{"code": 0, "data": map[string]any{"ok": true}}, nil
}
