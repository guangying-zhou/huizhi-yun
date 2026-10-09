package console

import (
	"github.com/google/uuid"
	"strings"
	"testing"
	"time"
)

func TestAnnouncementValidation(t *testing.T) {
	c := AnnouncementCommand{ID: uuid.NewString(), Title: "迁移通知", Body: "# 使用说明", Level: "info", StartsAt: time.Now().UTC().Format(time.RFC3339), Audience: "all"}
	if e := ValidateAnnouncementCommand("save", c); e != nil {
		t.Fatal(e)
	}
	for name, mutate := range map[string]func(*AnnouncementCommand){"blank title": func(c *AnnouncementCommand) { c.Title = " " }, "oversize": func(c *AnnouncementCommand) { c.Body = strings.Repeat("x", 100001) }, "level": func(c *AnnouncementCommand) { c.Level = "error" }, "scope": func(c *AnnouncementCommand) { c.Audience = "departments" }, "date": func(c *AnnouncementCommand) { c.EndsAt = "2000-01-01T00:00:00Z" }, "duplicate": func(c *AnnouncementCommand) { c.Audience = "departments"; c.Departments = []string{"D1", "D1"} }} {
		t.Run(name, func(t *testing.T) {
			bad := c
			mutate(&bad)
			if ValidateAnnouncementCommand("save", bad) == nil {
				t.Fatal("accepted invalid announcement")
			}
		})
	}
	for _, raw := range []string{`{"uid":"other"}`, `{} {}`, `{}garbage`, `{"page":"1"}`} {
		if _, e := DecodeAnnouncementCommand(raw); e == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestAnnouncementFuturePushFailsClosed(t *testing.T) {
	c := AnnouncementCommand{ID: "a0000000-0000-4000-8000-000000000003", Title: "notice", Body: "body", Level: "info", Audience: "all", StartsAt: time.Now().Add(time.Hour).Format(time.RFC3339), Bell: true}
	if ValidateAnnouncementCommand("save", c) == nil {
		t.Fatal("scheduled push accepted")
	}
	c.Bell = false
	if e := ValidateAnnouncementCommand("save", c); e != nil {
		t.Fatal(e)
	}
}
