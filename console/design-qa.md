# Design QA

**Comparison target**

- Source visual truth: `/tmp/codex-hzy-ui-design/汇智云-登录退出404.dc.html`
- Source assets: `/tmp/codex-hzy-ui-design/assets/logo.png`
- Implementation: local Nuxt Console rendered through `http://localhost:3100`
- Viewports: desktop `1440 × 900`; mobile `390 × 844`
- States: login provider selection, provider redirect loading, logout success, and 404

**Evidence**

- Desktop implementation:
  - `/tmp/hzy-ui-impl-login-desktop.png`
  - `/tmp/hzy-ui-impl-login-loading-desktop.png`
  - `/tmp/hzy-ui-impl-logout-desktop.png`
  - `/tmp/hzy-ui-impl-404-desktop.png`
- Mobile implementation:
  - `/tmp/hzy-ui-impl-login-mobile.png`
  - `/tmp/hzy-ui-impl-logout-mobile.png`
  - `/tmp/hzy-ui-impl-404-mobile.png`
- Full-view comparisons:
  - `/tmp/hzy-ui-compare-login-desktop.jpg`
  - `/tmp/hzy-ui-compare-logout-desktop.jpg`
  - `/tmp/hzy-ui-compare-404-desktop.jpg`
  - `/tmp/hzy-ui-compare-login-mobile.jpg`
  - `/tmp/hzy-ui-compare-logout-mobile.jpg`
  - `/tmp/hzy-ui-compare-404-mobile.jpg`
- Focused-region comparison: no additional crop was required. The full-resolution desktop and mobile comparisons keep the headings, controls, logos, illustration, and button labels legible. The loading-state screenshot separately verifies the status copy and selected-provider spinner at control scale.

**Findings**

- No actionable P0, P1, or P2 mismatches remain.
- Fonts and typography: the implementation uses the design's Chinese system-font stack (`PingFang SC`, `Microsoft YaHei`, `Helvetica Neue`, sans-serif) with matching hierarchy, weights, sizes, line heights, letter spacing, and wrapping at both target viewports.
- Spacing and layout rhythm: desktop cards, 404 columns, mobile single-column layouts, action spacing, radii, shadows, and footer placement match the source composition. The tested mobile pages have no horizontal or vertical overflow.
- Colors and visual tokens: the neutral gradient canvas, orange primary action, green success state, muted copy, borders, and elevations align with the source palette and preserve readable contrast.
- Image quality and asset fidelity: the supplied 300 × 300 transparent logo is used directly. The supplied 404 artwork geometry is preserved as a reusable external SVG and remains sharp at desktop and mobile sizes.
- Copy and content: login, logout, and 404 copy matches the design. After selecting a provider, the status changes to `正在跳转登录...`; `请选择登录方式` is not retained during loading.
- Icons and controls: controls use consistent project icon components and retain 48–52 px practical tap targets. The DingTalk icon remains the project's existing Lucide-compatible icon because the Console test contract disallows the Simple Icons DingTalk glyph; this is an intentional, acceptable P3-level deviation.
- Accessibility and behavior: landmarks, headings, alt text, labels, disabled/loading states, reduced-motion handling, and agreement-gated login actions are present.

**Comparison history**

1. Initial pass — P2 desktop alignment and button-surface drift.
   - Earlier evidence: desktop cards were shifted upward by asymmetric page padding, scoped button selectors did not reach Nuxt UI roots, and secondary actions rendered with an overly dark outline.
   - Fix: centered the viewport with symmetric padding, moved component-root styles to `:deep(...)`, and applied explicit light borders and zero secondary shadow.
   - Post-fix evidence: `/tmp/hzy-ui-compare-login-desktop.jpg`, `/tmp/hzy-ui-compare-logout-desktop.jpg`, `/tmp/hzy-ui-compare-404-desktop.jpg`.

2. Initial mobile pass — P2 logout footer collision.
   - Earlier evidence: the mobile logout brand row overlapped the secondary action area.
   - Fix: anchored the brand row at the bottom safe area and hid the duplicate copyright footer in the mobile logout state.
   - Post-fix evidence: `/tmp/hzy-ui-compare-logout-mobile.jpg`.

3. Asset pass — P2 logo fidelity.
   - Earlier evidence: the implementation used an approximation instead of the supplied product mark.
   - Fix: imported `/tmp/codex-hzy-ui-design/assets/logo.png` unchanged as `public/brand/hzy-logo.png`.
   - Post-fix evidence: all six full-view comparison images listed above.

4. 404 polish pass — P2 secondary-action border.
   - Earlier evidence: the 404 secondary action had a dark component-default outline absent from the design.
   - Fix: added the source-aligned `#e5e9ee` border and removed the default shadow.
   - Post-fix evidence: `/tmp/hzy-ui-compare-404-desktop.jpg`, `/tmp/hzy-ui-compare-404-mobile.jpg`.

**Primary interactions tested**

- Logout success → `重新登录` returns to the provider-selection view.
- Agreement checkbox disables provider actions when unchecked and restores them when checked.
- Selecting the OIDC provider changes the live status to `正在跳转登录...`, disables all provider choices, and shows loading only on the selected provider.
- Browser console checked on a fresh final route: no error-level entries.

**Implementation checklist**

- [x] Desktop and mobile login match the source structure and styling.
- [x] Desktop and mobile logout success match the source structure and styling.
- [x] Desktop and mobile 404 match the source structure and styling.
- [x] Supplied logo and 404 illustration are represented by external assets.
- [x] Loading-state copy regression is fixed and interaction-tested.
- [x] Responsive overflow, accessibility affordances, and console output are checked.

**Follow-up polish**

- Optional P3: replace the DingTalk glyph only if the project icon contract is intentionally relaxed in a separate change.

final result: passed
