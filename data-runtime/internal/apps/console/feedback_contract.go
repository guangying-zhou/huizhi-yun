package console

import (
	"bytes"
	"encoding/json"
	"io"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const FeedbackProject = "huizhi-yun/huizhiyun"

type FeedbackSettings struct {
	Enabled              bool                `json:"enabled"`
	IntegrationCode      string              `json:"integrationCode"`
	Project              string              `json:"project"`
	PublicURL            string              `json:"publicUrl"`
	Labels               map[string][]string `json:"labels"`
	RecipientUIDs        []string            `json:"recipientUids"`
	RecipientRoles       []string            `json:"recipientRoleCodes"`
	WecomIntegrationCode string              `json:"wecomIntegrationCode"`
	Revision             int64               `json:"revision"`
}

type FeedbackText struct {
	AttachmentIDs []string `json:"attachmentIds,omitempty"`
	Kind          string   `json:"kind"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Priority      string   `json:"priority"`
	PageURL       string   `json:"pageUrl"`
	Browser       string   `json:"browser,omitempty"`
	Errors        []string `json:"errors,omitempty"`
}

type FeedbackCommand struct {
	PageSize     int               `json:"pageSize,omitempty"`
	Status       string            `json:"status,omitempty"`
	Kind         string            `json:"kind,omitempty"`
	ID           string            `json:"id,omitempty"`
	Page         int               `json:"page,omitempty"`
	Text         *FeedbackText     `json:"text,omitempty"`
	Settings     *FeedbackSettings `json:"settings,omitempty"`
	AttachmentID string            `json:"attachmentId,omitempty"`
	Image        string            `json:"image,omitempty"`
	SHA256       string            `json:"sha256,omitempty"`
	ContentType  string            `json:"contentType,omitempty"`
}

type FeedbackRecord struct {
	Attachments         []map[string]any `json:"attachments,omitempty"`
	AttachmentMarkdown  string           `json:"-"`
	NotificationPending int              `json:"notificationPending"`
	ID                  string           `json:"id"`
	ReporterUID         string           `json:"reporterUid"`
	ReporterName        string           `json:"reporterName"`
	Text                FeedbackText     `json:"text"`
	Status              string           `json:"status"`
	IssueIID            int64            `json:"issueIid"`
	IssueURL            string           `json:"issueUrl"`
	CreatedAt           string           `json:"createdAt"`
	Settings            FeedbackSettings `json:"-"`
}

func feedbackError(status int, code string) error {
	return httperror.New(status, "feedback_"+code, "Feedback request could not be completed")
}

func DecodeFeedbackCommand(payload string) (FeedbackCommand, error) {
	var c FeedbackCommand
	d := json.NewDecoder(strings.NewReader(payload))
	d.DisallowUnknownFields()
	if len(payload) > 8<<20 || d.Decode(&c) != nil {
		return c, feedbackError(400, "input_invalid")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return c, feedbackError(400, "input_invalid")
	}
	return c, nil
}

var feedbackCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`)
var feedbackSecret = regexp.MustCompile(`(?i)(bearer\s+\S+|(?:password|token|secret|authorization|cookie|api[_-]?key)\s*[:=]\s*\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}|\b1[3-9][0-9]{9}\b|\b[0-9]{17}[0-9X]\b)`)

func feedbackRedact(s string) string {
	s = regexp.MustCompile(`(?i)(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/\S+`).ReplaceAllString(s, "[连接信息已隐藏]")
	s = regexp.MustCompile(`https?://[^\s<>"']+`).ReplaceAllStringFunc(s, func(raw string) string {
		u, e := url.Parse(raw)
		if e != nil {
			return "[链接已隐藏]"
		}
		u.RawQuery = ""
		u.Fragment = ""
		u.User = nil
		return u.String()
	})
	return feedbackSecret.ReplaceAllString(s, "[已隐藏]")
}

func validateFeedbackSettings(s FeedbackSettings) error {
	u, e := url.Parse(s.PublicURL)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || s.Project != FeedbackProject || !feedbackCode.MatchString(s.IntegrationCode) || !feedbackCode.MatchString(s.WecomIntegrationCode) || s.Revision < 0 {
		return feedbackError(400, "settings_invalid")
	}
	if len(s.RecipientUIDs)+len(s.RecipientRoles) > 100 || len(s.RecipientUIDs)+len(s.RecipientRoles) == 0 {
		return feedbackError(400, "recipients_invalid")
	}
	for _, v := range append(append([]string{}, s.RecipientUIDs...), s.RecipientRoles...) {
		if !feedbackCode.MatchString(v) || strings.Contains(v, ":") {
			return feedbackError(400, "recipients_invalid")
		}
	}
	for kind, labels := range s.Labels {
		if kind != "bug" && kind != "feature" && kind != "suggestion" {
			return feedbackError(400, "labels_invalid")
		}
		if len(labels) > 10 {
			return feedbackError(400, "labels_invalid")
		}
		for _, l := range labels {
			if !regexp.MustCompile(`^[\p{L}\p{N} _.:/-]{1,80}$`).MatchString(l) {
				return feedbackError(400, "labels_invalid")
			}
		}
	}
	return nil
}

func normalizeFeedbackText(t FeedbackText, s FeedbackSettings) (FeedbackText, error) {
	if len(t.AttachmentIDs) > 5 {
		return t, feedbackError(400, "attachments_limit")
	}
	seen := map[string]bool{}
	for _, id := range t.AttachmentIDs {
		if !feedbackAttachmentID.MatchString(id) || seen[id] {
			return t, feedbackError(400, "attachment_invalid")
		}
		seen[id] = true
	}
	t.Title = strings.TrimSpace(t.Title)
	t.Description = strings.TrimSpace(t.Description)
	if (t.Kind != "bug" && t.Kind != "feature" && t.Kind != "suggestion") || t.Title == "" || utf8.RuneCountInString(t.Title) > 160 || t.Description == "" || utf8.RuneCountInString(t.Description) > 10000 || strings.ContainsAny(t.Title, "\r\n\x00") {
		return t, feedbackError(400, "text_invalid")
	}
	if t.Priority != "low" && t.Priority != "mid" && t.Priority != "high" && !(t.Kind == "bug" && t.Priority == "blocking") {
		return t, feedbackError(400, "priority_invalid")
	}
	if t.PageURL != "" {
		base, e := url.Parse(s.PublicURL)
		if e != nil {
			return t, feedbackError(503, "settings_invalid")
		}
		u, e := url.Parse(t.PageURL)
		if e != nil || u.User != nil || strings.HasPrefix(t.PageURL, "//") || strings.ContainsAny(t.PageURL, "\\\r\n\x00") {
			return t, feedbackError(400, "page_invalid")
		}
		if !u.IsAbs() {
			if !strings.HasPrefix(u.Path, "/") {
				return t, feedbackError(400, "page_invalid")
			}
			u = base.ResolveReference(u)
		}
		if u.Scheme != base.Scheme || u.Host != base.Host {
			return t, feedbackError(400, "page_invalid")
		}
		u.RawQuery = ""
		u.Fragment = ""
		t.PageURL = u.String()
		if len(t.PageURL) > 2048 {
			return t, feedbackError(400, "page_invalid")
		}
	}
	if len(t.Errors) > 10 || len(t.Browser) > 500 {
		return t, feedbackError(400, "diagnostics_invalid")
	}
	t.Browser = feedbackRedact(t.Browser)
	for i, e := range t.Errors {
		if utf8.RuneCountInString(e) > 500 {
			return t, feedbackError(400, "diagnostics_invalid")
		}
		t.Errors[i] = feedbackRedact(e)
	}
	b, _ := json.Marshal(t.Errors)
	if len(b) > 8192 {
		return t, feedbackError(400, "diagnostics_invalid")
	}
	return t, nil
}

// Literal Markdown prevents quick actions, mentions, links and forged markers.
func feedbackLiteral(s string) string {
	var b bytes.Buffer
	for _, line := range strings.Split(s, "\n") {
		b.WriteString("    ")
		b.WriteString(strings.ReplaceAll(strings.ReplaceAll(line, "@", "＠"), "\r", ""))
		b.WriteByte('\n')
	}
	return b.String()
}
func feedbackIssueBody(r FeedbackRecord, marker string) string {
	body := "汇智云反馈\n\n类型：" + r.Text.Kind + " · 优先级：" + r.Text.Priority + "\n\n提交人：\n" + feedbackLiteral(r.ReporterName) + "\n页面：\n" + feedbackLiteral(r.Text.PageURL) + "\n描述：\n" + feedbackLiteral(r.Text.Description)
	if r.Text.Browser != "" {
		body += "\n浏览器：\n" + feedbackLiteral(r.Text.Browser)
	}
	if len(r.Text.Errors) > 0 {
		body += "\n已确认的错误摘要：\n" + feedbackLiteral(strings.Join(r.Text.Errors, "\n"))
	}
	return body + r.AttachmentMarkdown + "\n汇智云记录：" + r.Settings.PublicURL + "/enterprise/feedback/" + r.ID + "\n\n" + marker
}
