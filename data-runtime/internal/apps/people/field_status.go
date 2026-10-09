package people

import "sort"

// HR 事实源的字段级来源统计。
//
// 钉钉 `topapi/v2/user/list` 在应用缺少对应权限时会整体省略 `hired_date`、
// `mobile` 等字段，而接口仍返回 errcode=0。链路下游把「provider 没下发」和
// 「provider 下发了空值」都折叠成「保留旧值」，字段永不写入而同步仍报成功。
// 这里按字段区分四种来源状态，让 HR 能在同步结果里直接看出是哪一种。
const (
	fieldStatusProvided = "provided" // 下发了可用值
	fieldStatusEmpty    = "empty"    // 下发了该字段，但值为空
	fieldStatusAbsent   = "absent"   // 完全没有下发该字段
	fieldStatusInvalid  = "invalid"  // 下发了非空值，但无法规范化
)

type directoryFieldStatusCounter struct {
	counts map[string]map[string]int
}

func newDirectoryFieldStatusCounter() *directoryFieldStatusCounter {
	return &directoryFieldStatusCounter{counts: make(map[string]map[string]int)}
}

func (c *directoryFieldStatusCounter) record(field, status string) {
	if c == nil {
		return
	}
	if _, ok := c.counts[field]; !ok {
		c.counts[field] = make(map[string]int, 4)
	}
	c.counts[field][status]++
}

// present 判断 provider 是否下发了该字段本身，与值是否为空无关。
func present(item map[string]any, keys []string) bool {
	for _, key := range keys {
		if value, ok := item[key]; ok && value != nil {
			return true
		}
	}
	return false
}

func sourceTextFieldWritable(item map[string]any, keys []string) bool {
	return present(item, keys)
}

func sourceDateFieldWritable(item map[string]any, raw, normalized string, keys []string) bool {
	return present(item, keys) && (raw == "" || normalized != "")
}

// observe 统计一个普通文本字段。value 是已经清洗过的结果。
func (c *directoryFieldStatusCounter) observe(field string, item map[string]any, value string, keys []string) {
	switch {
	case value != "":
		c.record(field, fieldStatusProvided)
	case present(item, keys):
		c.record(field, fieldStatusEmpty)
	default:
		c.record(field, fieldStatusAbsent)
	}
}

// observeDate 统计需要规范化的日期字段：原值非空但规范化后为空，说明 provider
// 下发了我们无法识别的格式，这与「没下发」是两回事，必须单独暴露。
func (c *directoryFieldStatusCounter) observeDate(field string, item map[string]any, raw, normalized string, keys []string) {
	switch {
	case normalized != "":
		c.record(field, fieldStatusProvided)
	case raw != "":
		c.record(field, fieldStatusInvalid)
	case present(item, keys):
		c.record(field, fieldStatusEmpty)
	default:
		c.record(field, fieldStatusAbsent)
	}
}

// summary 输出稳定排序的字段级计数，供同步回执和 HR 页面直接展示。
// missingAll 标记本批次该字段一条都没有下发，是权限缺失最直接的信号。
func (c *directoryFieldStatusCounter) summary() []map[string]any {
	if c == nil || len(c.counts) == 0 {
		return []map[string]any{}
	}
	fields := make([]string, 0, len(c.counts))
	for field := range c.counts {
		fields = append(fields, field)
	}
	sort.Strings(fields)

	summary := make([]map[string]any, 0, len(fields))
	for _, field := range fields {
		counts := c.counts[field]
		observed := 0
		for _, count := range counts {
			observed += count
		}
		summary = append(summary, map[string]any{
			"field":      field,
			"provided":   counts[fieldStatusProvided],
			"empty":      counts[fieldStatusEmpty],
			"absent":     counts[fieldStatusAbsent],
			"invalid":    counts[fieldStatusInvalid],
			"observed":   observed,
			"missingAll": observed > 0 && counts[fieldStatusProvided] == 0,
		})
	}
	return summary
}
