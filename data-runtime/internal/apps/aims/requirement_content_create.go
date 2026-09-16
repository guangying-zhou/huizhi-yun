package aims

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type requirementContentCreateInput struct {
	projectID    int64
	uid          string
	kind         string
	title        string
	contentMd    string
	headingDepth int64
	parentID     sql.NullInt64
}

type requirementContentCreateResult struct {
	id              int64
	title           string
	childContentIDs []int64
}

type requirementContentRow struct {
	id           int64
	parentID     sql.NullInt64
	headingDepth int64
	title        string
	sortOrder    int64
}

type requirementContentTitlePrefix struct {
	style    string
	value    int64
	segments []int64
}

type requirementContentMarkdownSection struct {
	title    string
	markdown string
}

var (
	requirementContentChinesePrefixRegexp = regexp.MustCompile(`^[一二三四五六七八九十百千万零〇两]+、\s*`)
	requirementContentDecimalPrefixRegexp = regexp.MustCompile(`^\d+(?:\.\d+)*(?:[、.]\s*|\s+)`)
	requirementContentHeadingRegexp       = regexp.MustCompile(`^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$`)
	requirementContentHeadingCloseRegexp  = regexp.MustCompile(`[ \t]+#+$`)
	requirementContentParseChineseRegexp  = regexp.MustCompile(`^([一二三四五六七八九十百千万零〇两]+)、`)
	requirementContentParseDecimalRegexp  = regexp.MustCompile(`^(\d+(?:\.\d+)*)(?:[、.]\s*|\s+)`)
)

func (a *Adapter) createProjectRequirementContent(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+rawProjectID+"/requirement-contents", query, body, rawProjectID); err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByID(ctx, projectID); err != nil {
		return nil, err
	}

	input, err := parseRequirementContentCreateInput(projectID, uid, body)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if input.parentID.Valid {
		var parentProjectID int64
		err = tx.QueryRowContext(ctx, `
			SELECT project_id
			FROM requirement_contents
			WHERE id = ?
			LIMIT 1
		`, input.parentID.Int64).Scan(&parentProjectID)
		if err == sql.ErrNoRows || parentProjectID != projectID {
			return nil, httperror.New(http.StatusBadRequest, "invalid_parent_content", "所属章节无效")
		}
		if err != nil {
			return nil, err
		}
	}

	result, err := a.createRequirementContentInTx(ctx, tx, input)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE project_documents
		SET import_status = 'imported_dirty'
		WHERE project_id = ?
		  AND doc_category = 'requirement_spec'
		  AND import_status = 'imported_clean'
	`, projectID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	childIDs := make([]any, 0, len(result.childContentIDs))
	for _, id := range result.childContentIDs {
		childIDs = append(childIDs, id)
	}
	return map[string]any{
		"id":              result.id,
		"title":           result.title,
		"childContentIds": childIDs,
	}, nil
}

func parseRequirementContentCreateInput(projectID int64, uid string, body map[string]any) (requirementContentCreateInput, error) {
	kind := "item"
	if firstBodyText(body, "kind") == "module" {
		kind = "module"
	}

	title := strings.TrimSpace(firstBodyText(body, "title"))
	if title == "" {
		return requirementContentCreateInput{}, httperror.New(http.StatusBadRequest, "invalid_title", "标题不能为空")
	}

	headingDepth, err := requiredRequirementContentBodyInt(body, "headingDepth", "heading_depth")
	if err != nil || headingDepth < 2 || headingDepth > 6 {
		return requirementContentCreateInput{}, httperror.New(http.StatusBadRequest, "invalid_heading_depth", "无效的标题层级")
	}

	parentID := sql.NullInt64{}
	if rawParentID, ok, err := optionalRequirementContentBodyInt(body, "parentId", "parent_id"); err != nil {
		return requirementContentCreateInput{}, httperror.New(http.StatusBadRequest, "invalid_parent_id", "所属章节无效")
	} else if ok && rawParentID > 0 {
		parentID = sql.NullInt64{Int64: rawParentID, Valid: true}
	}
	if kind == "item" && !parentID.Valid {
		return requirementContentCreateInput{}, httperror.New(http.StatusBadRequest, "missing_parent_content", "新增功能项必须指定所属功能模块")
	}

	return requirementContentCreateInput{
		projectID:    projectID,
		uid:          uid,
		kind:         kind,
		title:        title,
		contentMd:    rawRequirementContentBodyString(body, "contentMd", "content_md"),
		headingDepth: headingDepth,
		parentID:     parentID,
	}, nil
}

func (a *Adapter) createRequirementContentInTx(ctx context.Context, tx *sql.Tx, input requirementContentCreateInput) (requirementContentCreateResult, error) {
	style, prefix, err := a.resolveRequirementContentTitlePrefix(ctx, tx, input.projectID, input.parentID, input.headingDepth)
	if err != nil {
		return requirementContentCreateResult{}, err
	}
	prefixedTitle := buildRequirementContentPrefixedTitle(prefix, input.title, style)
	sortOrder, err := a.nextRequirementContentSortOrder(ctx, tx, input.projectID, input.parentID)
	if err != nil {
		return requirementContentCreateResult{}, err
	}

	if input.kind == "item" {
		id, err := a.insertRequirementContent(ctx, tx, input.projectID, input.uid, input.parentID, input.headingDepth, prefixedTitle, nullableText(strings.TrimSpace(input.contentMd)), sortOrder)
		if err != nil {
			return requirementContentCreateResult{}, err
		}
		return requirementContentCreateResult{id: id, title: prefixedTitle, childContentIDs: []int64{}}, nil
	}

	childHeadingDepth := input.headingDepth + 1
	introMarkdown, sections := splitRequirementContentMarkdownByHeadingDepth(input.contentMd, childHeadingDepth)
	moduleID, err := a.insertRequirementContent(ctx, tx, input.projectID, input.uid, input.parentID, input.headingDepth, prefixedTitle, nullableText(introMarkdown), sortOrder)
	if err != nil {
		return requirementContentCreateResult{}, err
	}

	childIDs := make([]int64, 0, len(sections))
	for index, section := range sections {
		childStyle, childPrefix, err := a.resolveRequirementContentTitlePrefix(ctx, tx, input.projectID, sql.NullInt64{Int64: moduleID, Valid: true}, childHeadingDepth)
		if err != nil {
			return requirementContentCreateResult{}, err
		}
		childTitle := buildRequirementContentPrefixedTitle(childPrefix, section.title, childStyle)
		childID, err := a.insertRequirementContent(ctx, tx, input.projectID, input.uid, sql.NullInt64{Int64: moduleID, Valid: true}, childHeadingDepth, childTitle, nullableText(section.markdown), int64(index))
		if err != nil {
			return requirementContentCreateResult{}, err
		}
		childIDs = append(childIDs, childID)
	}

	return requirementContentCreateResult{id: moduleID, title: prefixedTitle, childContentIDs: childIDs}, nil
}

func (a *Adapter) resolveRequirementContentTitlePrefix(ctx context.Context, tx *sql.Tx, projectID int64, parentID sql.NullInt64, headingDepth int64) (string, string, error) {
	siblings, err := a.requirementContentSiblingRows(ctx, tx, projectID, parentID, headingDepth)
	if err != nil {
		return "", "", err
	}

	parsedSiblings := make([]requirementContentTitlePrefix, 0, len(siblings))
	for _, sibling := range siblings {
		if parsed, ok := parseRequirementContentTitlePrefix(sibling.title); ok {
			parsedSiblings = append(parsedSiblings, parsed)
		}
	}

	if len(parsedSiblings) > 0 {
		style := parsedSiblings[0].style
		if style == "chinese" {
			maxValue := int64(0)
			for _, parsed := range parsedSiblings {
				if parsed.style == "chinese" && parsed.value > maxValue {
					maxValue = parsed.value
				}
			}
			return style, toRequirementContentChineseNumeral(maxValue+1) + "、", nil
		}

		decimalSiblings := make([]requirementContentTitlePrefix, 0, len(parsedSiblings))
		for _, parsed := range parsedSiblings {
			if parsed.style == "decimal" && len(parsed.segments) > 0 {
				decimalSiblings = append(decimalSiblings, parsed)
			}
		}
		if len(decimalSiblings) > 0 {
			baseSegments := append([]int64{}, decimalSiblings[0].segments[:len(decimalSiblings[0].segments)-1]...)
			maxLast := int64(0)
			for _, parsed := range decimalSiblings {
				last := parsed.segments[len(parsed.segments)-1]
				if last > maxLast {
					maxLast = last
				}
			}
			return style, joinRequirementContentDecimalSegments(append(baseSegments, maxLast+1)), nil
		}
	}

	if parentID.Valid {
		var parentTitle string
		err := tx.QueryRowContext(ctx, "SELECT title FROM requirement_contents WHERE id = ? LIMIT 1", parentID.Int64).Scan(&parentTitle)
		if err != nil && err != sql.ErrNoRows {
			return "", "", err
		}
		if baseSegments := deriveRequirementContentDecimalBaseFromParent(parentTitle); len(baseSegments) > 0 {
			return "decimal", joinRequirementContentDecimalSegments(append(baseSegments, 1)), nil
		}
	}

	return "chinese", "一、", nil
}

func (a *Adapter) requirementContentSiblingRows(ctx context.Context, tx *sql.Tx, projectID int64, parentID sql.NullInt64, headingDepth int64) ([]requirementContentRow, error) {
	args := []any{projectID, headingDepth}
	sqlText := `
		SELECT id, parent_id, heading_depth, title, sort_order
		FROM requirement_contents
		WHERE project_id = ? AND heading_depth = ?`
	if parentID.Valid {
		sqlText += " AND parent_id = ?"
		args = append(args, parentID.Int64)
	} else {
		sqlText += " AND parent_id IS NULL"
	}
	sqlText += " ORDER BY sort_order, id"

	rows, err := tx.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]requirementContentRow, 0)
	for rows.Next() {
		var item requirementContentRow
		if err := rows.Scan(&item.id, &item.parentID, &item.headingDepth, &item.title, &item.sortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) nextRequirementContentSortOrder(ctx context.Context, tx *sql.Tx, projectID int64, parentID sql.NullInt64) (int64, error) {
	args := []any{projectID}
	sqlText := "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM requirement_contents WHERE project_id = ?"
	if parentID.Valid {
		sqlText += " AND parent_id = ?"
		args = append(args, parentID.Int64)
	} else {
		sqlText += " AND parent_id IS NULL"
	}
	var maxSort int64
	if err := tx.QueryRowContext(ctx, sqlText, args...).Scan(&maxSort); err != nil {
		return 0, err
	}
	return maxSort + 1, nil
}

func (a *Adapter) insertRequirementContent(ctx context.Context, tx *sql.Tx, projectID int64, uid string, parentID sql.NullInt64, headingDepth int64, title string, contentMd any, sortOrder int64) (int64, error) {
	parentValue := any(nil)
	if parentID.Valid {
		parentValue = parentID.Int64
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO requirement_contents
		 (content_original_id, version_no, version_status, project_id, parent_id, heading_depth,
		  title, content_md, sort_order, status, created_by, updated_by)
		VALUES (NULL, 1, 'draft', ?, ?, ?, ?, ?, ?, 'modified', ?, ?)
	`, projectID, parentValue, headingDepth, title, contentMd, sortOrder, uid, uid)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE requirement_contents SET content_original_id = ? WHERE id = ?", id, id); err != nil {
		return 0, err
	}
	return id, nil
}

func stripRequirementContentTitlePrefix(title string) string {
	title = requirementContentChinesePrefixRegexp.ReplaceAllString(title, "")
	title = requirementContentDecimalPrefixRegexp.ReplaceAllString(title, "")
	return strings.TrimSpace(title)
}

func parseRequirementContentTitlePrefix(title string) (requirementContentTitlePrefix, bool) {
	title = strings.TrimSpace(title)
	if match := requirementContentParseChineseRegexp.FindStringSubmatch(title); len(match) == 2 {
		return requirementContentTitlePrefix{style: "chinese", value: parseRequirementContentChineseNumeral(match[1])}, true
	}
	if match := requirementContentParseDecimalRegexp.FindStringSubmatch(title); len(match) == 2 {
		segmentTexts := strings.Split(match[1], ".")
		segments := make([]int64, 0, len(segmentTexts))
		for _, segmentText := range segmentTexts {
			value, err := strconv.ParseInt(segmentText, 10, 64)
			if err != nil {
				return requirementContentTitlePrefix{}, false
			}
			segments = append(segments, value)
		}
		value := int64(1)
		if len(segments) > 0 {
			value = segments[len(segments)-1]
		}
		return requirementContentTitlePrefix{style: "decimal", value: value, segments: segments}, true
	}
	return requirementContentTitlePrefix{}, false
}

func buildRequirementContentPrefixedTitle(prefix string, title string, style string) string {
	plainTitle := stripRequirementContentTitlePrefix(title)
	if style == "chinese" {
		return prefix + plainTitle
	}
	return prefix + " " + plainTitle
}

func parseRequirementContentChineseNumeral(text string) int64 {
	normalized := strings.NewReplacer("两", "二", "〇", "零").Replace(text)
	digits := map[rune]int64{'零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	units := map[rune]int64{'十': 10, '百': 100, '千': 1000}
	total := int64(0)
	current := int64(0)
	for _, char := range normalized {
		if digit, ok := digits[char]; ok {
			current = digit
			continue
		}
		if unit, ok := units[char]; ok {
			if current == 0 {
				current = 1
			}
			total += current * unit
			current = 0
		}
	}
	return total + current
}

func toRequirementContentChineseNumeral(num int64) string {
	if num <= 0 {
		return strconv.FormatInt(num, 10)
	}
	digits := []string{"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"}
	if num < 10 {
		return digits[num]
	}
	if num < 100 {
		tens := num / 10
		ones := num % 10
		if tens == 1 {
			if ones == 0 {
				return "十"
			}
			return "十" + digits[ones]
		}
		if ones == 0 {
			return digits[tens] + "十"
		}
		return digits[tens] + "十" + digits[ones]
	}
	if num < 1000 {
		hundreds := num / 100
		remainder := num % 100
		if remainder == 0 {
			return digits[hundreds] + "百"
		}
		if remainder < 10 {
			return digits[hundreds] + "百零" + digits[remainder]
		}
		return digits[hundreds] + "百" + toRequirementContentChineseNumeral(remainder)
	}
	return strconv.FormatInt(num, 10)
}

func deriveRequirementContentDecimalBaseFromParent(title string) []int64 {
	parsed, ok := parseRequirementContentTitlePrefix(title)
	if !ok {
		return nil
	}
	if parsed.style == "decimal" && len(parsed.segments) > 0 {
		return parsed.segments
	}
	if parsed.style == "chinese" {
		return []int64{parsed.value}
	}
	return nil
}

func joinRequirementContentDecimalSegments(segments []int64) string {
	parts := make([]string, 0, len(segments))
	for _, segment := range segments {
		parts = append(parts, strconv.FormatInt(segment, 10))
	}
	return strings.Join(parts, ".")
}

func splitRequirementContentMarkdownByHeadingDepth(markdown string, headingDepth int64) (string, []requirementContentMarkdownSection) {
	text := strings.ReplaceAll(markdown, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")

	type heading struct {
		lineIndex int
		depth     int64
		title     string
	}
	headings := make([]heading, 0)
	for index, line := range lines {
		if parsed, ok := parseRequirementContentMarkdownHeading(line); ok && parsed.depth == headingDepth {
			headings = append(headings, heading{lineIndex: index, depth: parsed.depth, title: parsed.title})
		}
	}
	if len(headings) == 0 {
		return strings.TrimSpace(markdown), []requirementContentMarkdownSection{}
	}

	introMarkdown := strings.TrimSpace(strings.Join(lines[:headings[0].lineIndex], "\n"))
	sections := make([]requirementContentMarkdownSection, 0, len(headings))
	for index, target := range headings {
		endLine := len(lines)
		if index+1 < len(headings) {
			endLine = headings[index+1].lineIndex
		}
		for lineIndex := target.lineIndex + 1; lineIndex < endLine; lineIndex++ {
			if parsed, ok := parseRequirementContentMarkdownHeading(lines[lineIndex]); ok && parsed.depth <= headingDepth {
				endLine = lineIndex
				break
			}
		}
		sections = append(sections, requirementContentMarkdownSection{
			title:    strings.TrimSpace(target.title),
			markdown: strings.TrimSpace(strings.Join(lines[target.lineIndex+1:endLine], "\n")),
		})
	}
	return introMarkdown, sections
}

func parseRequirementContentMarkdownHeading(line string) (struct {
	depth int64
	title string
}, bool) {
	match := requirementContentHeadingRegexp.FindStringSubmatch(line)
	if len(match) != 3 {
		return struct {
			depth int64
			title string
		}{}, false
	}
	title := strings.TrimSpace(match[2])
	title = strings.TrimSpace(requirementContentHeadingCloseRegexp.ReplaceAllString(title, ""))
	return struct {
		depth int64
		title string
	}{depth: int64(len(match[1])), title: title}, true
}

func rawRequirementContentBodyString(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := body[key]
		if !ok {
			continue
		}
		text, ok := value.(string)
		if ok {
			return text
		}
	}
	return ""
}

func requiredRequirementContentBodyInt(body map[string]any, keys ...string) (int64, error) {
	value, ok := requirementContentBodyValue(body, keys...)
	if !ok {
		return 0, fmt.Errorf("missing integer")
	}
	return parseRequirementContentBodyInt(value)
}

func optionalRequirementContentBodyInt(body map[string]any, keys ...string) (int64, bool, error) {
	value, ok := requirementContentBodyValue(body, keys...)
	if !ok || value == nil {
		return 0, false, nil
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return 0, true, nil
	}
	id, err := parseRequirementContentBodyInt(value)
	return id, true, err
}

func requirementContentBodyValue(body map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		value, ok := body[key]
		if ok {
			return value, true
		}
	}
	return nil, false
}

func parseRequirementContentBodyInt(value any) (int64, error) {
	switch typed := value.(type) {
	case float64:
		if typed != math.Trunc(typed) {
			return 0, fmt.Errorf("not integer")
		}
		return int64(typed), nil
	case float32:
		value := float64(typed)
		if value != math.Trunc(value) {
			return 0, fmt.Errorf("not integer")
		}
		return int64(typed), nil
	case int:
		return int64(typed), nil
	case int64:
		return typed, nil
	case jsonNumber:
		return strconv.ParseInt(string(typed), 10, 64)
	default:
		return strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
	}
}
