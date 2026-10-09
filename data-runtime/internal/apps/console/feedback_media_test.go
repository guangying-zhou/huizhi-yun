package console

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func feedbackTestPNG() []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 8, 8)))
	return b.Bytes()
}
func TestFeedbackMediaValidationAndGate(t *testing.T) {
	raw := feedbackTestPNG()
	if _, e := normalizeFeedbackImage(raw, "image/png"); e != nil {
		t.Fatal(e)
	}
	for _, c := range []struct {
		raw  []byte
		mime string
	}{{raw, "image/jpeg"}, {[]byte("<svg/>"), "image/png"}, {append(raw, []byte("acTL")...), "image/png"}, {make([]byte, feedbackImageLimit+1), "image/png"}} {
		if _, e := normalizeFeedbackImage(c.raw, c.mime); e == nil {
			t.Fatal("invalid accepted")
		}
	}
	t.Setenv("HZY_CONSOLE_FEEDBACK_MEDIA_ENABLED", "false")
	if feedbackMediaEnabled() {
		t.Fatal("default open")
	}
	t.Setenv("HZY_CONSOLE_FEEDBACK_MEDIA_ENABLED", "true")
	t.Setenv("HZY_CONSOLE_FEEDBACK_MEDIA_VERIFIED_AT", time.Now().Add(-8*24*time.Hour).Format(time.RFC3339))
	if feedbackMediaEnabled() {
		t.Fatal("stale verification")
	}
}
func testFeedbackImagesMySQL(t *testing.T, a *Adapter, db *sql.DB, s FeedbackSettings) {
	t.Helper()
	ctx := context.Background()
	t.Setenv("HZY_CONSOLE_FEEDBACK_MEDIA_ENABLED", "true")
	t.Setenv("HZY_CONSOLE_FEEDBACK_MEDIA_VERIFIED_AT", time.Now().Add(-time.Minute).Format(time.RFC3339))
	id := "11111111-1111-4111-8111-111111111111"
	text := FeedbackText{Kind: "bug", Title: "media", Description: "fixture", Priority: "mid", AttachmentIDs: []string{id}}
	result, e := a.Feedback(ctx, "draft", FeedbackCommand{Text: &text}, MutationMeta{ActorID: "alice", IdempotencyKey: "media-draft"}, false)
	if e != nil {
		t.Fatal(e)
	}
	fid := result["data"].(map[string]any)["id"].(string)
	c := FeedbackCommand{ID: fid, AttachmentID: id, Image: base64.StdEncoding.EncodeToString(feedbackTestPNG()), SHA256: feedbackDigest(feedbackTestPNG()), ContentType: "image/png"}
	m := MutationMeta{ActorID: "alice", IdempotencyKey: "media-upload"}
	if _, e = a.Feedback(ctx, "submit", FeedbackCommand{ID: fid}, MutationMeta{ActorID: "alice", IdempotencyKey: "media-submit"}, false); e == nil {
		t.Fatal("missing accepted")
	}
	if _, e = a.Feedback(ctx, "attachment-put", c, MutationMeta{ActorID: "bob", IdempotencyKey: "media-upload"}, true); e == nil {
		t.Fatal("cross owner upload")
	}
	for i := 0; i < 2; i++ {
		if _, e = a.Feedback(ctx, "attachment-put", c, m, false); e != nil {
			t.Fatal(e)
		}
	}
	var sessionZone string
	var utcCreated, sameClock bool
	if err := db.QueryRow(`SELECT @@session.time_zone,ABS(TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(3)))<5,created_at=updated_at FROM console_feedback_attachments WHERE feedback_id=?`, fid).Scan(&sessionZone, &utcCreated, &sameClock); err != nil || sessionZone != "+08:00" || !utcCreated || !sameClock {
		t.Fatalf("attachment UTC clocks under +08:00: zone=%s created=%t equal=%t err=%v", sessionZone, utcCreated, sameClock, err)
	}
	bad := c
	bad.SHA256 = strings.Repeat("0", 64)
	if _, e = a.Feedback(ctx, "attachment-put", bad, m, false); e == nil {
		t.Fatal("digest")
	}
	if _, e = a.Feedback(ctx, "attachment-read", c, MutationMeta{ActorID: "bob"}, false); e == nil {
		t.Fatal("cross owner read")
	}
	if _, e = a.Feedback(ctx, "attachment-read", c, m, false); e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(`UPDATE console_feedback SET status='dispatching',attempt=1 WHERE feedback_id=?`, fid)
	if e != nil {
		t.Fatal(e)
	}
	uploads := 0
	private := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			_ = json.NewEncoder(w).Encode(map[string]any{"path_with_namespace": FeedbackProject, "visibility": "private", "enforce_auth_checks_on_uploads": private})
			return
		}
		uploads++
		if e := r.ParseMultipartForm(8 << 20); e != nil {
			t.Error(e)
			return
		}
		defer r.MultipartForm.RemoveAll()
		f, h, e := r.FormFile("file")
		if e != nil {
			t.Error(e)
			return
		}
		f.Close()
		if h.Filename != "feedback-"+feedbackMediaKey(a.tenant, fid, id)+".png" {
			t.Error(h.Filename)
		}
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 9, "url": "/uploads/" + strings.Repeat("a", 32) + "/feedback-" + feedbackMediaKey(a.tenant, fid, id) + ".png"})
	}))
	defer server.Close()
	g := gitLabOperationRuntime{BaseURL: server.URL, Token: "fixture"}
	r, e := a.feedbackRecord(ctx, fid)
	if e != nil {
		t.Fatal(e)
	}
	state, e := a.deliverFeedbackImages(ctx, g, &r, 1)
	if e != nil || state != "failed" || uploads != 0 {
		t.Fatal(state, e, uploads)
	}
	private = true
	state, e = a.deliverFeedbackImages(ctx, g, &r, 1)
	if e != nil || state != "ready" || uploads != 1 {
		t.Fatal(state, e, uploads)
	}
	r.AttachmentMarkdown = ""
	state, e = a.deliverFeedbackImages(ctx, g, &r, 1)
	if e != nil || state != "ready" || uploads != 1 {
		t.Fatal("duplicate", state, e, uploads)
	}
	_, _ = db.Exec(`UPDATE console_feedback_attachments SET status='uploading' WHERE feedback_id=?`, fid)
	state, e = a.deliverFeedbackImages(ctx, g, &r, 1)
	if e != nil || state != "unknown" || uploads != 1 {
		t.Fatal("unknown resend", state, e, uploads)
	}
	_, _ = db.Exec(`UPDATE console_feedback SET status='unknown' WHERE feedback_id=?`, fid)
	if _, e = a.Feedback(ctx, "cancel", FeedbackCommand{ID: fid}, MutationMeta{ActorID: "admin", IdempotencyKey: "cancel-unknown-image"}, true); e != nil {
		t.Fatal(e)
	}
	// Exercise both sides of every retention cutoff in the production-like +08 session.
	for _, tc := range []struct {
		status string
		hours  int
	}{{"draft", 24}, {"cancelled", 24}, {"submitted", 168}, {"failed", 720}, {"unknown", 720}} {
		for _, expired := range []bool{false, true} {
			age := tc.hours - 1
			if expired {
				age = tc.hours + 1
			}
			if _, err := db.Exec(`UPDATE console_feedback SET status=?,updated_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? HOUR) WHERE feedback_id=?`, tc.status, age, fid); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`UPDATE console_feedback_attachments SET image_bytes=?,created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? HOUR) WHERE feedback_id=?`, feedbackTestPNG(), age, fid); err != nil {
				t.Fatal(err)
			}
			if err := a.purgeFeedbackMedia(ctx); err != nil {
				t.Fatal(err)
			}
			var purged bool
			if err := db.QueryRow(`SELECT image_bytes IS NULL FROM console_feedback_attachments WHERE feedback_id=?`, fid).Scan(&purged); err != nil || purged != expired {
				t.Fatalf("retention %s age=%d purged=%t err=%v", tc.status, age, purged, err)
			}
		}
	}
	_, _ = db.Exec(`DELETE FROM console_feedback_attachments WHERE feedback_id=?`, fid)
	_, _ = db.Exec(`DELETE FROM console_feedback WHERE feedback_id=?`, fid)
}

func TestFeedbackUploadFailuresAreNotBlindlyRetried(t *testing.T) {
	for _, code := range []int{401, 403, 408, 429, 500, 201} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "POST" || !strings.HasSuffix(r.URL.Path, "/uploads") {
					t.Error("unexpected operation")
				}
				w.WriteHeader(code)
				_, _ = w.Write([]byte(`{"id":1,"url":"https://evil.test/leak"}`))
			}))
			defer server.Close()
			_, _, status := (gitLabOperationRuntime{BaseURL: server.URL, Token: "fixture"}).uploadFeedbackImage(context.Background(), "11111111-1111-4111-8111-111111111111", feedbackTestPNG())
			expected := "unknown"
			if code == 401 || code == 403 || code == 429 {
				expected = "failed"
			}
			if status != expected || calls != 1 {
				t.Fatal(status, calls)
			}
		})
	}
}

func TestFeedbackUnknownUploadReconcilesByDigest(t *testing.T) {
	id := "11111111-1111-4111-8111-111111111111"
	raw := feedbackTestPNG()
	multiple := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Fatal("reconciliation wrote")
		}
		if strings.Contains(r.URL.RawQuery, "page=") {
			rows := []map[string]any{{"id": 9, "filename": "feedback-" + id + ".png", "size": len(raw)}}
			if multiple {
				rows = append(rows, map[string]any{"id": 10, "filename": "feedback-" + id + ".png", "size": len(raw)})
			}
			_ = json.NewEncoder(w).Encode(rows)
			return
		}
		_, _ = w.Write(raw)
	}))
	defer server.Close()
	g := gitLabOperationRuntime{BaseURL: server.URL, Token: "fixture"}
	found, e := g.findFeedbackUpload(context.Background(), id, feedbackDigest(raw))
	if e != nil || found != 9 {
		t.Fatal(found, e)
	}
	found, e = g.findFeedbackUpload(context.Background(), id, strings.Repeat("0", 64))
	if e != nil || found != 0 {
		t.Fatal("digest mismatch", found, e)
	}
	multiple = true
	if _, e = g.findFeedbackUpload(context.Background(), id, feedbackDigest(raw)); e == nil {
		t.Fatal("ambiguous accepted")
	}
}
