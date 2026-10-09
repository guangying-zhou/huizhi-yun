package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// AnnouncementCommand contains business facts only. Identity/authority is supplied by the verified route.
type AnnouncementCommand struct {
	ID          string                `json:"id"`
	Title       string                `json:"title"`
	Body        string                `json:"body"`
	Level       string                `json:"level"`
	StartsAt    string                `json:"startsAt"`
	EndsAt      string                `json:"endsAt"`
	Audience    string                `json:"audience"`
	Departments []string              `json:"departments"`
	Popup       bool                  `json:"popup"`
	Banner      bool                  `json:"banner"`
	Bell        bool                  `json:"bell"`
	Wecom       bool                  `json:"wecom"`
	Revision    uint64                `json:"revision"`
	Page        int                   `json:"page"`
	Delivery    *AnnouncementDelivery `json:"delivery,omitempty"`
	Success     bool                  `json:"success,omitempty"`
}

type AnnouncementDeliveryStats struct {
	Prepared  bool `json:"prepared"`
	Pending   int  `json:"pending"`
	Delivered int  `json:"delivered"`
	Retrying  int  `json:"retrying"`
}

type Announcement struct {
	Delivery    *AnnouncementDeliveryStats `json:"delivery,omitempty"`
	ID          string                     `json:"id"`
	Title       string                     `json:"title"`
	Body        string                     `json:"body"`
	Level       string                     `json:"level"`
	StartsAt    string                     `json:"startsAt"`
	EndsAt      string                     `json:"endsAt"`
	Audience    string                     `json:"audience"`
	Departments []string                   `json:"departments"`
	Popup       bool                       `json:"popup"`
	Banner      bool                       `json:"banner"`
	Bell        bool                       `json:"bell"`
	Wecom       bool                       `json:"wecom"`
	Status      string                     `json:"status"`
	Revision    uint64                     `json:"revision"`
	Read        bool                       `json:"read"`
}

func announcementBad() error {
	return httperror.New(400, "announcement_input_invalid", "Invalid announcement input")
}
func ValidateAnnouncementCommand(op string, c AnnouncementCommand) error {
	if op == "departments" || op == "surfaces" {
		return nil
	}
	if op == "list" || op == "admin-list" {
		if c.Page < 1 || c.Page > 10000 {
			return announcementBad()
		}
		return nil
	}
	if _, e := uuid.Parse(c.ID); e != nil {
		return announcementBad()
	}
	if op == "delivery-claim" || op == "delivery-ack" {
		if op == "delivery-ack" && (c.Delivery == nil || c.Delivery.ID != c.ID) {
			return announcementBad()
		}
		return nil
	}
	if op == "read" || op == "detail" || op == "deliver" {
		return nil
	}
	if op == "withdraw" {
		if c.Revision == 0 {
			return announcementBad()
		}
		return nil
	}
	if op != "save" {
		return announcementBad()
	}
	start, e := time.Parse(time.RFC3339, c.StartsAt)
	if e != nil {
		return announcementBad()
	}
	if (c.Bell || c.Wecom) && start.After(time.Now().UTC()) {
		return httperror.New(400, "announcement_scheduled_push_unsupported", "Scheduled notification delivery is not supported")
	}
	if c.EndsAt != "" {
		end, e := time.Parse(time.RFC3339, c.EndsAt)
		if e != nil || !end.After(start) {
			return announcementBad()
		}
	}
	if strings.TrimSpace(c.Title) == "" || utf8.RuneCountInString(c.Title) > 160 || strings.TrimSpace(c.Body) == "" || len(c.Body) > 100000 {
		return announcementBad()
	}
	if c.Level != "info" && c.Level != "warning" {
		return announcementBad()
	}
	if c.Audience != "all" && c.Audience != "departments" {
		return announcementBad()
	}
	if len(c.Departments) > 100 || (c.Audience == "all" && len(c.Departments) != 0) || (c.Audience == "departments" && len(c.Departments) == 0) {
		return announcementBad()
	}
	seen := map[string]bool{}
	for _, d := range c.Departments {
		if d == "" || len(d) > 64 || seen[d] {
			return announcementBad()
		}
		seen[d] = true
	}
	return nil
}

const announcementVisible = `a.status='published' AND a.starts_at<=UTC_TIMESTAMP(3) AND (a.ends_at IS NULL OR a.ends_at>UTC_TIMESTAMP(3)) AND (a.audience='all' OR EXISTS (SELECT 1 FROM console_announcement_departments ad JOIN directory_user_departments ud ON ud.dept_code=ad.dept_code AND ud.status='active' JOIN directory_departments d ON d.dept_code=ud.dept_code AND d.status='active' WHERE ad.tenant_code=a.tenant_code AND ad.announcement_id=a.announcement_id AND BINARY ud.uid=BINARY ? AND ud.relation_type='member'))`

func (a *Adapter) announcementActor(ctx context.Context, uid string) error {
	var active int
	if uid == "" || strings.HasPrefix(uid, "system:") {
		return httperror.New(403, "announcement_actor_invalid", "Active employee required")
	}
	e := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users WHERE BINARY uid=BINARY ? AND status='active' AND user_type='employee'`, uid).Scan(&active)
	if e != nil {
		return e
	}
	if active != 1 {
		return httperror.New(403, "announcement_actor_invalid", "Active employee required")
	}
	return nil
}

func (a *Adapter) Announcements(ctx context.Context, op string, c AnnouncementCommand, meta MutationMeta) (map[string]any, error) {
	if e := ValidateAnnouncementCommand(op, c); e != nil {
		return nil, e
	}
	if e := a.announcementActor(ctx, meta.ActorID); e != nil {
		return nil, e
	}
	if op == "delivery-claim" {
		return a.ClaimImmediateAnnouncementDelivery(ctx, c.ID)
	}
	if op == "delivery-ack" {
		return a.AckAnnouncementDelivery(ctx, *c.Delivery, c.Success)
	}
	if op == "departments" {
		rows, e := a.db.QueryContext(ctx, `SELECT dept_code,dept_name FROM directory_departments WHERE status='active' AND org_type='department' ORDER BY dept_code LIMIT 1001`)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		items := []map[string]string{}
		for rows.Next() {
			var code, name string
			if e = rows.Scan(&code, &name); e != nil {
				return nil, e
			}
			items = append(items, map[string]string{"value": code, "label": name + " (" + code + ")"})
		}
		if len(items) > 1000 {
			return nil, httperror.New(409, "department_selector_limit", "Department selector limit exceeded")
		}
		return map[string]any{"code": 0, "data": items}, rows.Err()
	}
	if op == "read" {
		// Reauthorize before receipt replay as well as before a fresh write.
		var visible int
		err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM console_announcements a WHERE a.tenant_code=? AND a.announcement_id=? AND `+announcementVisible, a.tenant, c.ID, meta.ActorID).Scan(&visible)
		if err != nil {
			return nil, err
		}
		if visible != 1 {
			return nil, httperror.New(403, "announcement_not_visible", "Announcement is not available")
		}
	}
	if op == "save" || op == "withdraw" || op == "read" {
		return a.mutateAnnouncement(ctx, op, c, meta)
	}
	admin := op == "admin-list" || op == "deliver"
	where := `a.tenant_code=?`
	args := []any{meta.ActorID, a.tenant}
	if !admin {
		where += " AND " + announcementVisible
		args = append(args, meta.ActorID)
	}
	if op == "detail" || op == "deliver" {
		where += " AND a.announcement_id=?"
		args = append(args, c.ID)
	}
	page := c.Page
	if page < 1 {
		page = 1
	}
	order := ` ORDER BY a.starts_at DESC,a.announcement_id`
	if op == "surfaces" {
		where += ` AND (a.show_banner=1 OR (a.show_popup=1 AND rd.uid IS NULL))`
		order = ` ORDER BY (a.show_popup=1 AND rd.uid IS NULL) DESC,a.starts_at ASC,a.announcement_id`
	}
	rows, e := a.db.QueryContext(ctx, `SELECT a.announcement_id,a.title,a.body_markdown,a.level,a.starts_at,a.ends_at,a.audience,a.show_popup,a.show_banner,a.push_bell,a.push_wecom,a.status,a.revision,(rd.uid IS NOT NULL) FROM console_announcements a LEFT JOIN console_announcement_reads rd ON rd.tenant_code=a.tenant_code AND rd.announcement_id=a.announcement_id AND BINARY rd.uid=BINARY ? WHERE `+where+order+` LIMIT 51 OFFSET ?`, append(args, (page-1)*50)...)
	if e != nil {
		return nil, e
	}
	items := []Announcement{}
	for rows.Next() {
		var n Announcement
		var start time.Time
		var end sql.NullTime
		if e = rows.Scan(&n.ID, &n.Title, &n.Body, &n.Level, &start, &end, &n.Audience, &n.Popup, &n.Banner, &n.Bell, &n.Wecom, &n.Status, &n.Revision, &n.Read); e != nil {
			rows.Close()
			return nil, e
		}
		n.StartsAt = start.UTC().Format(time.RFC3339)
		if end.Valid {
			n.EndsAt = end.Time.UTC().Format(time.RFC3339)
		}
		n.Departments = []string{}
		items = append(items, n)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	more := len(items) > 50
	if more {
		items = items[:50]
	}
	for i := range items {
		if !admin {
			continue
		}
		stats := &AnnouncementDeliveryStats{}
		e = a.db.QueryRowContext(ctx, `SELECT (SELECT delivery_prepared FROM console_announcements WHERE tenant_code=? AND announcement_id=?),COALESCE(SUM(state='pending'),0),COALESCE(SUM(state='delivered'),0),COALESCE(SUM(state='pending' AND attempts>1),0) FROM console_announcement_outbox WHERE tenant_code=? AND announcement_id=? AND revision=?`, a.tenant, items[i].ID, a.tenant, items[i].ID, items[i].Revision).Scan(&stats.Prepared, &stats.Pending, &stats.Delivered, &stats.Retrying)
		if e != nil {
			return nil, e
		}
		items[i].Delivery = stats
		ds, e := a.db.QueryContext(ctx, `SELECT dept_code FROM console_announcement_departments WHERE tenant_code=? AND announcement_id=? ORDER BY dept_code`, a.tenant, items[i].ID)
		if e != nil {
			return nil, e
		}
		for ds.Next() {
			var d string
			if e = ds.Scan(&d); e != nil {
				ds.Close()
				return nil, e
			}
			items[i].Departments = append(items[i].Departments, d)
		}
		e = ds.Err()
		ds.Close()
		if e != nil {
			return nil, e
		}
	}
	if (op == "detail" || op == "deliver") && len(items) == 0 {
		return nil, httperror.New(403, "announcement_not_visible", "Announcement is not available")
	}
	return map[string]any{"code": 0, "data": map[string]any{"items": items, "hasMore": more}}, nil
}

func (a *Adapter) mutateAnnouncement(ctx context.Context, op string, c AnnouncementCommand, m MutationMeta) (map[string]any, error) {
	// Actor is part of the intent so an idempotency key cannot replay another user's receipt.
	payload := struct {
		Actor   string
		Command AnnouncementCommand
	}{m.ActorID, c}
	if !mutationIdempotencyKeyPattern.MatchString(m.IdempotencyKey) {
		return nil, announcementBad()
	}
	digest := sha256.Sum256([]byte(m.ActorID + "\n" + m.IdempotencyKey))
	m.IdempotencyKey = hex.EncodeToString(digest[:])
	session, replay, e := a.beginMutation(ctx, "console.announcements."+op, m.IdempotencyKey, m.RequestID, m.ActorID, payload)
	if e != nil || replay != nil {
		return replay, e
	}
	defer session.tx.Rollback()
	tx := session.tx
	tenant, _, e := lockCurrentProfile(ctx, tx)
	if e != nil {
		return nil, e
	}
	if tenant != a.tenant {
		return nil, httperror.New(403, "console_tenant_binding_mismatch", "Tenant mismatch")
	}
	if op == "read" {
		var id string
		e = tx.QueryRowContext(ctx, `SELECT a.announcement_id FROM console_announcements a WHERE a.tenant_code=? AND a.announcement_id=? AND `+announcementVisible+` FOR SHARE`, a.tenant, c.ID, m.ActorID).Scan(&id)
		if errors.Is(e, sql.ErrNoRows) {
			return nil, httperror.New(403, "announcement_not_visible", "Announcement is not available")
		}
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, `INSERT INTO console_announcement_reads(tenant_code,announcement_id,uid) VALUES(?,?,?) ON DUPLICATE KEY UPDATE uid=VALUES(uid)`, a.tenant, c.ID, m.ActorID)
	} else {
		var rev uint64
		e = tx.QueryRowContext(ctx, `SELECT revision FROM console_announcements WHERE tenant_code=? AND announcement_id=? FOR UPDATE`, a.tenant, c.ID).Scan(&rev)
		if errors.Is(e, sql.ErrNoRows) && op == "save" && c.Revision == 0 {
			e = nil
		} else if errors.Is(e, sql.ErrNoRows) {
			return nil, httperror.New(409, "announcement_revision_conflict", "Announcement no longer exists")
		} else if e != nil {
			return nil, e
		}
		if rev != c.Revision {
			return nil, httperror.New(409, "announcement_revision_conflict", "Reload announcement before saving")
		}
		if op == "withdraw" {
			_, e = tx.ExecContext(ctx, `UPDATE console_announcements SET status='withdrawn',revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_code=? AND announcement_id=?`, m.ActorID, a.tenant, c.ID)
		} else {
			for _, d := range c.Departments {
				var code string
				if e = tx.QueryRowContext(ctx, `SELECT dept_code FROM directory_departments WHERE dept_code=? AND status='active' AND org_type='department' FOR SHARE`, d).Scan(&code); e != nil {
					if !errors.Is(e, sql.ErrNoRows) {
						return nil, e
					}
					return nil, announcementBad()
				}
			}
			start, _ := time.Parse(time.RFC3339, c.StartsAt)
			var end any
			if c.EndsAt != "" {
				end, _ = time.Parse(time.RFC3339, c.EndsAt)
			}
			_, e = tx.ExecContext(ctx, `INSERT INTO console_announcements(tenant_code,announcement_id,title,body_markdown,level,starts_at,ends_at,audience,show_popup,show_banner,push_bell,push_wecom,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),body_markdown=VALUES(body_markdown),level=VALUES(level),starts_at=VALUES(starts_at),ends_at=VALUES(ends_at),audience=VALUES(audience),show_popup=VALUES(show_popup),show_banner=VALUES(show_banner),push_bell=VALUES(push_bell),push_wecom=VALUES(push_wecom),status='published',delivery_prepared=0,revision=revision+1,updated_by=VALUES(updated_by),updated_at=UTC_TIMESTAMP(3)`, a.tenant, c.ID, c.Title, c.Body, c.Level, start.UTC(), end, c.Audience, c.Popup, c.Banner, c.Bell, c.Wecom, m.ActorID, m.ActorID)
			if e != nil {
				return nil, e
			}
			if _, e = tx.ExecContext(ctx, `DELETE FROM console_announcement_departments WHERE tenant_code=? AND announcement_id=?`, a.tenant, c.ID); e != nil {
				return nil, e
			}
			for _, d := range c.Departments {
				if _, e = tx.ExecContext(ctx, `INSERT INTO console_announcement_departments VALUES(?,?,?)`, a.tenant, c.ID, d); e != nil {
					return nil, e
				}
			}
		}
		if e == nil {
			_, e = tx.ExecContext(ctx, `UPDATE console_announcement_outbox SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE tenant_code=? AND announcement_id=? AND state='pending'`, a.tenant, c.ID)
		}
	}
	if e != nil {
		return nil, e
	}
	out := map[string]any{"code": 0, "data": map[string]any{"id": c.ID, "revision": c.Revision + 1}}
	e = a.finishMutation(ctx, session, "console", "announcements."+op, "announcement", c.ID, map[string]any{"revision": c.Revision + 1}, out)
	return out, e
}

// DecodeAnnouncementCommand rejects browser-supplied authority and unknown fields.
func DecodeAnnouncementCommand(raw string) (AnnouncementCommand, error) {
	var c AnnouncementCommand
	d := json.NewDecoder(strings.NewReader(raw))
	d.DisallowUnknownFields()
	e := d.Decode(&c)
	if e != nil {
		return c, announcementBad()
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return c, announcementBad()
	}
	return c, nil
}

func announcementDeliveryKey(id string, revision uint64, uid, channel string) string {
	digest := sha256.Sum256([]byte(uid))
	return fmt.Sprintf("announcement:%s:%d:%s:%s", id, revision, hex.EncodeToString(digest[:]), channel)
}
