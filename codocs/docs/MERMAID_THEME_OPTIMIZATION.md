# Mermaid 主题优化说明

## 优化目标

参考 beautiful-mermaid 的设计理念，简化并优化 Codocs 中 Mermaid 图表的主题配置，使其更加清晰、一致和易维护。

## 设计理念（来自 beautiful-mermaid）

### 1. Two-Color Foundation（双色基础）
- **bg (background)**: 背景色
- **fg (foreground)**: 前景色/文字色
- 这两个颜色是必需的，其他颜色都可以从这两个颜色派生

### 2. Optional Enrichment（可选强调色）
- **accent**: 高亮/箭头颜色
- **line**: 线条/边框颜色
- **muted**: 次要文字颜色
- **surface**: 节点填充颜色

### 3. 优势
- **简洁**: 最少只需要 2 个颜色，避免过度设计
- **一致**: 统一的颜色体系，避免图表中出现过多颜色
- **灵活**: 可以根据需要逐步添加强调色
- **易维护**: 减少需要管理的颜色变量

## 优化内容

### 1. 简化配色方案

#### 优化前
```typescript
// 复杂的调色板，包含 10+ 种颜色
const palette = {
    sand: '#d6ce93',
    cream: '#efebce',
    peach: '#d8a48f',
    teaGreen: '#c8d5b9',
    mutedTeal: '#8fc0a9',
    sage: '#3aa159',
    tropicalTeal: '#6096ba',
    surf: '#00B4D8',
    tigerOrange: '#ed8e3c',
    bronze: '#FF7D00',
    // ...
}
```

#### 优化后
```typescript
// 基础色 - 遵循 beautiful-mermaid 的理念
const bg = isDark ? '#1a1b26' : '#ffffff'
const fg = isDark ? '#a9b1d6' : '#27272A'

// 强调色 - 可选的 enrichment colors
const accent = isDark ? '#7aa2f7' : '#0969da'  // 高亮/箭头
const line = isDark ? '#565f89' : '#d1d9e0'    // 线条/边框
const muted = isDark ? '#565f89' : '#6e7781'   // 次要文字
const surface = isDark ? '#24283b' : '#f6f8fa' // 节点填充
```

**改进点**:
- 从 10+ 种颜色简化为 6 种（2 基础 + 4 强调）
- 使用业界认可的配色（Tokyo Night Dark / GitHub Light）
- 颜色命名更加语义化

### 2. 统一字体系统

#### 优化前
```typescript
fontFamily: 'trebuchet ms, verdana, arial, sans-serif'
```

#### 优化后
```typescript
fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
```

**改进点**:
- 使用现代无衬线字体 Inter（与 Nuxt UI 一致）
- 更好的跨平台表现
- 更清晰的字体渲染

### 3. 统一颜色应用

#### 优化前
- 不同元素使用不同的颜色变量
- 缺乏一致性，难以维护

#### 优化后
- 所有文字统一使用 `fg` 颜色
- 所有线条统一使用 `line` 颜色
- 所有边框统一使用 `line` 颜色
- 所有节点填充统一使用 `surface` 颜色
- 所有箭头和高亮使用 `accent` 颜色

### 4. 完善图表类型支持

新增或优化了以下图表类型的主题配置：

- ✅ Flowchart（流程图）
- ✅ Sequence（序列图）
- ✅ Gantt（甘特图）- **新增完整支持**
- ✅ Class Diagram（类图）
- ✅ ER Diagram（实体关系图）
- ✅ State Diagram（状态图）
- ✅ Git Graph（Git 图）- **新增配色**

### 5. 优化 CSS 样式

#### 背景和边框
```css
/* Light 模式 */
background: #ffffff;
border: 1px solid #e5e7eb;

/* Dark 模式 */
background: #1a1b26;
border-color: #565f89;
```

#### 字体和文字颜色
```css
/* 统一使用 Inter 字体 */
font-family: Inter, system-ui, -apple-system, sans-serif;

/* Light 模式文字 */
color: #27272A;

/* Dark 模式文字 */
color: #a9b1d6;
```

## 配色参考

### Light 模式（GitHub Light 风格）
- **Background**: `#ffffff` - 纯白背景
- **Foreground**: `#27272A` - 深灰文字
- **Accent**: `#0969da` - GitHub 蓝
- **Line**: `#d1d9e0` - 浅灰线条
- **Muted**: `#6e7781` - 次要文字
- **Surface**: `#f6f8fa` - 浅灰表面

### Dark 模式（Tokyo Night 风格）
- **Background**: `#1a1b26` - 深蓝背景
- **Foreground**: `#a9b1d6` - 浅蓝文字
- **Accent**: `#7aa2f7` - 亮蓝高亮
- **Line**: `#565f89` - 深灰线条
- **Muted**: `#565f89` - 次要文字
- **Surface**: `#24283b` - 深灰表面

## 使用效果

### 优点
1. **视觉一致性**: 图表配色与整体 UI 风格统一
2. **可读性提升**: 使用现代字体和优化的颜色对比
3. **易于维护**: 减少了需要管理的颜色变量
4. **完整支持**: 覆盖所有常用图表类型

### 对比 Beautiful-Mermaid
| 特性 | Beautiful-Mermaid | 优化后的 Codocs |
|------|-------------------|----------------|
| 配色理念 | Two-color + enrichment | ✅ 采用相同理念 |
| 支持图表 | 5 种（无 Gantt） | 12+ 种（含 Gantt）✅ |
| 主题切换 | CSS 变量 | JavaScript 初始化 |
| 性能 | 极快（无 DOM） | 依赖 mermaid.js |

## 后续优化建议

### 短期
- [x] 简化配色方案
- [x] 统一字体系统
- [x] 完善图表类型支持
- [ ] 测试所有图表类型的渲染效果
- [ ] 收集用户反馈

### 中期
- [ ] 考虑使用 CSS 变量实现主题切换（避免重新初始化）
- [ ] 添加更多预设主题（Catppuccin、Nord 等）
- [ ] 优化渲染性能（缓存机制）

### 长期
- [ ] 关注 beautiful-mermaid 项目进展
- [ ] 如果其支持 Gantt 图，考虑迁移
- [ ] 实现图表导出/分享时使用 beautiful-mermaid 优化

## 参考资源

- Beautiful-Mermaid: https://github.com/lukilabs/beautiful-mermaid
- Beautiful-Mermaid Theme System: https://github.com/lukilabs/beautiful-mermaid/blob/main/src/theme.ts
- Mermaid Official: https://mermaid.js.org/
- Tokyo Night Theme: https://github.com/enkia/tokyo-night-vscode-theme
- GitHub Primer Colors: https://primer.style/foundations/color
