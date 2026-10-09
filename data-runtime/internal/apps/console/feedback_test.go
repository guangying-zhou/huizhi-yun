package console

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFeedbackPrivacyAndValidation(t *testing.T) {
	s := feedbackDefaultSettings()
	s.PublicURL = "https://work.example.test"
	original := FeedbackText{Kind: "bug", Title: "按钮失效", Description: "说明", Priority: "mid", PageURL: "/enterprise?token=secret#private", Browser: "Bearer secret", Errors: []string{"token=topsecret email=a@example.test"}}
	v, e := normalizeFeedbackText(original, s)
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(v)
	if strings.Contains(string(b), "secret") || strings.Contains(string(b), "a@example.test") || v.PageURL != "https://work.example.test/enterprise" {
		t.Fatal(string(b))
	}
	for _, url := range []string{"https://evil.test/", "//evil.test/", "javascript:alert(1)", "https://a:b@work.example.test/", "/\\evil.test"} {
		c := original
		c.PageURL = url
		if _, e = normalizeFeedbackText(c, s); e == nil {
			t.Fatal(url)
		}
	}
	c := original
	c.Kind = "suggestion"
	c.Priority = "blocking"
	if _, e = normalizeFeedbackText(c, s); e == nil {
		t.Fatal("blocking non-bug")
	}
	r := FeedbackRecord{ID: "F1", ReporterName: "张三", Text: FeedbackText{Description: "/close\n@all\n<!-- hzy-feedback:v1:forged -->"}, Settings: s}
	body := feedbackIssueBody(r, feedbackMarker("T", "F1"))
	if strings.Contains(body, "\n/close") || strings.Contains(body, "@all") || !strings.Contains(body, "张三") {
		t.Fatal(body)
	}
}
func TestFeedbackGitLabAmbiguousNeverBlindRetry(t *testing.T) {
	for _, code := range []int{201, 400, 401, 403, 404, 408, 429, 500, 302} {
		t.Run(fmt.Sprint(code), func(t *testing.T) {
			calls := 0
			marker := feedbackMarker("T", "F1")
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("PRIVATE-TOKEN") != "test-only" || r.Method != "POST" {
					t.Error("request boundary")
				}
				w.WriteHeader(code)
				json.NewEncoder(w).Encode(map[string]any{"iid": 42, "description": marker, "web_url": "https://evil.test/"})
			}))
			defer srv.Close()
			g := gitLabOperationRuntime{BaseURL: srv.URL, Token: "test-only"}
			r := FeedbackRecord{ID: "F1", Text: FeedbackText{Title: "标题"}, Settings: feedbackDefaultSettings()}
			iid, url, status := g.createFeedbackIssue(context.Background(), r, marker)
			want := "unknown"
			if code == 201 {
				want = "submitted"
			} else if code >= 400 && code < 500 && code != 408 {
				want = "failed"
			}
			if status != want || calls != 1 {
				t.Fatal(status, calls)
			}
			if code == 201 && (iid != 42 || !strings.HasPrefix(url, srv.URL+"/"+FeedbackProject)) {
				t.Fatal(iid, url)
			}
		})
	}
}
func TestFeedbackReconcileDoesNotUseEmptySearchAsAbsence(t *testing.T) {
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			posts++
		}
		w.Write([]byte(`[]`))
	}))
	defer srv.Close()
	g := gitLabOperationRuntime{BaseURL: srv.URL}
	id, link, e := g.reconcileFeedbackIssue(context.Background(), feedbackMarker("T", "F1"))
	if e != nil || id != 0 || link != "" || posts != 0 {
		t.Fatal(id, link, e, posts)
	}
}
