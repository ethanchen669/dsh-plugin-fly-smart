/* @dsh-fly/dsh-plugin-fly-smart — browser half, built by scripts/build-plugin-client.mjs.
 * src-hash: deb9ee427bbf82ab732bb0d8928a1dfebeae7c2a103b2d1d694a9a074ace480d
 * Factory-form CJS: the loader calls the factory with its platform `require`
 * and memoizes the returned exports. Keep the banner so the loader id and the
 * package that produced the bundle stay greppable in a live page. */
window.__ModuleLoader__.load({
  id: "@dsh-fly/dsh-plugin-fly-smart",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const jsxRuntime = require("react/jsx-runtime");
const react = require("react");
const WORKBENCH_CSS = `
.fly-panel  {
  --fly-rail: 8px;
  /* The desk, 12px, matching the gap the drawer already leaves above the panel -- and
     it is a structural part of the edge, not spacing taste. With min-height:100% the
     panel was welded to the drawer's bottom edge: measured 2026-10-04, its bottom edge
     sat at y=900 of a 900px viewport with 0px of room below it, so the slab's 3px rim
     was painted on the window's last rows with nothing under it. The top edge had 12px
     of darker surface above it and read as depth; the bottom one read as the window's
     own border (the user's report, verbatim). A lit rim is a relationship -- a bright
     line over something darker -- so the bottom half of the ladder needs a surface to
     land on. The subtraction is what keeps the page from gaining a 12px scroll:
     a (100% - 12px) box plus a 12px margin is exactly 100%. */
  --fly-desk: 12px;
  box-sizing: border-box;
  min-height: calc(100% - var(--fly-desk));
  margin-bottom: var(--fly-desk);
  padding: 22px 26px 34px;
  color: var(--dsw-alias-label-primary, #e8eef7);
  background:
    radial-gradient(1200px 420px at 12% -10%, rgba(255, 176, 32, 0.06), transparent 70%),
    var(--dsw-alias-bg-base, #070b12);
  font-variant-numeric: tabular-nums;
}

/* ── Elevation recipe ───────────────────────────────────────────────────────
   A surface only reads as a raised object when it carries *five* shadows at
   once: a 1px lit top edge, a 1px shaded bottom edge, a hairline ring, and
   three cast shadows that grow wider and softer with distance. That is the
   recipe measured off the autox prototype (automodel.html, .card/.kpi),
   and it is why its cards look lifted while ours looked like flat rectangles
   with a drop shadow.

   The ring is a box-shadow spread, never a border: a border grows the box by
   2px and shoves the layout around — the same rule the selection pill follows.
   Colours are tokens (--dsw-specific-fly-*), so the light half gets its own strengths.

   The upstream hooks are anchored to the END of the class attribute
   ([class$='_card'], [class*='_card ']) because a plain substring walked
   straight into the inner spans: upstream names the pieces of a thing
   <hash>_newSession, <hash>_newSessionLabel, <hash>_newSessionContent, so
   [class*='newSession'] painted a ring and a pane on the *label* too — measured
   live as five matches on one button, which is the little rectangle the user
   circled around the word 新会话. The same trap sits in _card/_cardBody.
   A tool call's own *layer* is never in this list. Upstream draws both shapes as
   flat lines -- ToolRow.row and the Bash sample's _card frame paint no border and no
   background -- so the recipe belongs to what really is a card: the _ioCard (or the
   Bash sample's _terminal) inside. First the 运行命令 layer, then every other tool:
   the user asked for upstream's flat line both times.

   Scope is the surfaces that both float *and* paint a background: upstream's
   dialog role, the stat panes inside the shortcut modal, the composer card, the
   rail's new-session button, upstream's _card-suffixed CSS-module cards (the
   attachment/deliverable cards in a message) and our own cards. Bare wrappers
   that merely contain a menu are deliberately left out — a wrapper has no
   background, so a shadow on one paints a rectangle around nothing. */
html[data-fly-palette] .fly-card {
  /* The pane gradient (prototype --glass-bg): a lit top, a flat middle and a
     shaded bottom, painted over whatever background-color the surface already
     carries. This is what separates "a pane" from "a rectangle". The 1px lit
     line is baked into the gradient rather than drawn with a ::before, because
     two of these surfaces belong to upstream and their pseudo-elements are not
     ours to take. */
  background-image: var(--dsw-specific-fly-pane, none);
  box-shadow:
    0 1px 0 var(--dsw-specific-fly-surface-hi, rgba(255, 255, 255, 0.2)) inset,
    0 -1px 0 var(--dsw-specific-fly-surface-lo, rgba(0, 0, 0, 0.3)) inset,
    0 0 0 1px var(--dsw-specific-fly-ring, rgba(232, 238, 247, 0.13)),
    var(--dsw-specific-fly-shadow-near, 0 1px 2px rgba(0, 0, 0, 0.22)),
    var(--dsw-specific-fly-shadow-mid, 0 6px 16px rgba(0, 0, 0, 0.24)),
    var(--dsw-specific-fly-shadow-far, 0 18px 44px rgba(0, 0, 0, 0.32));
}
/* The card's tech edge: a hairline that fades out at both ends along the top,
   plus one brand-hued bloom in the corner (prototype .card::before and
   .kpi::after). overflow: hidden keeps the bloom inside the card instead of
   haloing its neighbours. */
html[data-fly-palette] .fly-card  {
  position: relative;
  overflow: hidden;
}
html[data-fly-palette] .fly-card::before  {
  content: '';
  position: absolute;
  left: 5%;
  right: 5%;
  top: 0;
  height: 1px;
  background-image: linear-gradient(90deg, transparent, var(--dsw-specific-fly-sheen, rgba(255, 255, 255, 0.32)), transparent);
  pointer-events: none;
}
html[data-fly-palette] .fly-card::after  {
  content: '';
  position: absolute;
  top: -60%;
  right: -8%;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background-image: radial-gradient(circle, color-mix(in srgb, var(--dsw-alias-brand-primary, #00ff9c) 42%, transparent), transparent 62%);
  filter: blur(28px);
  opacity: 0.62;
  pointer-events: none;
}
html[data-fly-palette='solid'] body:not([data-ds-dark-theme]) .fly-panel  {
  background:
    radial-gradient(1200px 420px at 12% -10%, rgba(163, 74, 6, 0.10), transparent 70%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0) 38%),
    var(--dsw-alias-bg-base, #f0f4fb);
  /* The panel is a lifted surface like a card, so it carries the same edge: a lit
     top line (the rim that makes the pane's corner read as a corner), the matching
     bottom shade -- a lit edge with nothing shading the far side is a line, not an
     edge -- and the contact/ambient pair from the elevation tokens. */
  box-shadow:
    0 1px 0 var(--dsw-specific-fly-surface-hi, #ffffff) inset,
    0 -1px 0 var(--dsw-specific-fly-surface-lo, rgba(13, 20, 32, 0.12)) inset,
    var(--dsw-specific-fly-shadow-near, 0 1px 2px rgba(15, 23, 42, 0.09)),
    var(--dsw-specific-fly-shadow-mid, 0 14px 34px rgba(17, 19, 22, 0.12)),
    var(--dsw-specific-fly-shadow-far, 0 34px 80px rgba(17, 19, 22, 0.14));
}
html[data-fly-palette='glass'] body:not([data-ds-dark-theme]) .fly-panel,
html[data-fly-palette='volume'] body:not([data-ds-dark-theme]) .fly-panel,
html[data-fly-palette='neon'] body:not([data-ds-dark-theme]) .fly-panel  {
  background:
    radial-gradient(1200px 420px at 12% -10%, rgba(163, 74, 6, 0.11), transparent 70%),
    linear-gradient(170deg, rgba(255, 255, 255, 0.94), rgba(244, 249, 255, 0.58) 42%, rgba(234, 241, 252, 0.64)),
    color-mix(in srgb, var(--dsw-alias-bg-base, #f0f4fb) 62%, transparent);
  /* Same edge as the solid half, through the same tokens. It used to be a single
     blue-tinted negative-spread shadow (rgba(16, 44, 92, 0.45)) -- the last cool
     blue left in the light glass CSS, and not a contact/ambient pair at all. */
  box-shadow:
    0 1px 0 var(--dsw-specific-fly-surface-hi, #ffffff) inset,
    0 -1px 0 var(--dsw-specific-fly-surface-lo, rgba(13, 20, 32, 0.12)) inset,
    var(--dsw-specific-fly-shadow-near, 0 2px 4px rgba(17, 19, 22, 0.2)),
    var(--dsw-specific-fly-shadow-mid, 0 18px 44px rgba(17, 19, 22, 0.16)),
    var(--dsw-specific-fly-shadow-far, 0 34px 80px rgba(17, 19, 22, 0.14));
}
html[data-fly-palette='glass'] body:not([data-ds-dark-theme]) .fly-panel .fly-card,
html[data-fly-palette='volume'] body:not([data-ds-dark-theme]) .fly-panel .fly-card,
html[data-fly-palette='neon'] body:not([data-ds-dark-theme]) .fly-panel .fly-card  {
  box-shadow:
    0 1px 0 var(--dsw-specific-fly-surface-hi, #ffffff) inset,
    0 -1px 0 var(--dsw-specific-fly-surface-lo, rgba(13, 20, 32, 0.12)) inset,
    var(--dsw-specific-fly-shadow-near, 0 2px 4px rgba(17, 19, 22, 0.2)),
    var(--dsw-specific-fly-shadow-mid, 0 18px 44px rgba(17, 19, 22, 0.16));
}
/* The dark chip's neon halo is invisible on white; light needs its own halo or
   the accent reads as plain text in a pill. Same two states, same icons and
   border thicknesses as the dark half — only the halo strength changes. */
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-chip[data-tone='ok']  {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #0b7649) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #0b7649) 7%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-success-primary, #0b7649) 10%, transparent),
    0 0 16px -6px color-mix(in srgb, var(--dsw-alias-state-success-primary, #0b7649) 45%, transparent);
}
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-chip[data-tone='warn']  {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c22343) 45%, transparent);
  box-shadow: 0 0 16px -6px color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c22343) 40%, transparent);
}
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-chip[data-tone='error']  {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #bf1733) 55%, transparent);
  box-shadow: 0 0 16px -6px color-mix(in srgb, var(--dsw-alias-state-error-primary, #bf1733) 45%, transparent);
}
/* Item 4 of the reference-image pass: corners. The radius the cards float on was
   12px everywhere; the reference look wants a bigger, softer corner on the surfaces
   that are *lifted* and nothing else -- an inline control with a flat 14px corner
   reads as a button someone forgot to finish. So the lifted set moves to 14px in the
   light half (dark keeps 12px: this pass is the light half's, and dark's pixels are
   asserted unchanged), the Fly panel goes to 16px and the cards inside it to 14px.
   The rail and the drawer column are deliberately *not* rounded -- see the floating
   rail entry in DESIGN.md's TODO list: rounding them means detaching them from the
   frame, which is a layout change, not a radius change. The tool-call cards
   (_ioCard / the expanded body cards) are also left at 12px: an earlier round pinned
   their geometry and the live assertion says so out loud.
   NOTE: no backticks in this block -- the whole stylesheet is a template literal. */
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-card {
  border-radius: 14px;
}
html[data-fly-palette='glass'] body:not([data-ds-dark-theme]) .fly-panel,
html[data-fly-palette='volume'] body:not([data-ds-dark-theme]) .fly-panel,
html[data-fly-palette='neon'] body:not([data-ds-dark-theme]) .fly-panel  {
  border-radius: 16px;
}
html[data-fly-palette='glass'] body:not([data-ds-dark-theme]) .fly-panel .fly-card,
html[data-fly-palette='volume'] body:not([data-ds-dark-theme]) .fly-panel .fly-card,
html[data-fly-palette='neon'] body:not([data-ds-dark-theme]) .fly-panel .fly-card  {
  border-radius: 14px;
}
/* Trial: warm brand gold on the light panel edge and on the cards inside it.
   Measured on the real drawer (glass, light): the panel edge is the border upstream
   paints (1px solid rgba(13, 20, 32, 0.1) before this rule) and so is the card's --
   its box-shadow is the lit line, the bottom shade and two casts, no ring layer --
   so both take the colour on that border. The card sits 27px/136px inside the panel,
   i.e. two separate lines, never one edge drawn twice. The first cut of this trial put
   the colour on a box-shadow ring indirection; sampling the real drawer panel showed
   that indirection had NO consumer there -- the panel's edge is the 1px border
   upstream paints (measured live: 1px solid rgba(13, 20, 32, 0.1)) and its shadow
   carries only the lit line, the bottom shade and the projection. So the colour goes
   on the border that is actually painted. A border is one line by construction: the
   single-edge guard's "exactly one clean edge" cannot regress here, and the two gold
   cards (input card, new session) stay out of scope for the same reason as before --
   they already carry their own amber ring, and a second line on them is the bevel
   double-line class of bug. The neutral --dsw-specific-fly-ring token is untouched:
   it is not what this rule paints. Dark never loads this rule (light half only). */
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-panel:not([data-composer-card]):not([class*='newSession']),
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-panel:not([data-composer-card]):not([class*='newSession']) .fly-card,
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-card:not([data-composer-card]):not([class*='newSession'])  {
  border-color: var(--dsw-specific-fly-edge-brand, rgba(163, 74, 6, 0.22));
}
html[data-fly-palette='glass'] body:not([data-ds-dark-theme]) .fly-panel,
html[data-fly-palette='volume'] body:not([data-ds-dark-theme]) .fly-panel,
html[data-fly-palette='neon'] body:not([data-ds-dark-theme]) .fly-panel  {
  backdrop-filter: blur(30px) saturate(140%);
}
html[data-fly-palette='glass'] body:not([data-ds-dark-theme]) .fly-panel .fly-card,
html[data-fly-palette='volume'] body:not([data-ds-dark-theme]) .fly-panel .fly-card,
html[data-fly-palette='neon'] body:not([data-ds-dark-theme]) .fly-panel .fly-card  {
  backdrop-filter: blur(22px) saturate(135%);
}
/* ── Fly 面板的滚动可达性（fly.console 等内容够不着）─────────────────────────
   症状：Fly 控制台（fly.console 页签）里 token 列表下半截够不着、页面滚不动。
   实测（1040x900，浅/深 × 实心/玻璃四组合一致）：token 列表所在 .fly-panel 的
   clientHeight 860~862 而 scrollHeight 1225~1491（实心 1225/1281，玻璃 1477/1491），
   但面板自己没有声明过任何 overflow（computed = visible，即初始值），而它的父层
   P3OORG_tabBody（上游页签容器）是 overflow-y: hidden —— 溢出被父层裁掉，整条祖先链上
   没有任何滚动容器：所以这不是"滚动条不可见"，是"根本不能滚"（scrollTop 无处可设）。
   候选逐条排除：③ 滚动条被我们弄没 —— 全表没有任何 scrollbar-width / ::-webkit-scrollbar /
   scrollbar-color 规则，排除；① 我们的配方里 overflow:hidden —— 全表唯一一处 overflow:hidden
   在 .kpi::after 上，与面板无关，排除；④ position:fixed/absolute 无滚动上下文 —— 面板是
   普通流内定高块，排除；⑤ 上游页签容器自身不滚 —— 属实（tabBody overflow-y:hidden），
   但上游不动；② 高度算成内容高 —— 面板高度是定值（860），问题在不滚。
   修法：让面板自己成为滚动容器（皮肤的面板配方，一次性覆盖各 Fly 面板）。
   硬约束不变：不新增线、不加粗、不改金色身份；圆角/边线/对齐守卫不受影响。 */
html[data-fly-palette] .fly-panel  {
  overflow-y: auto;
  min-height: 0;
}

/* The glass palette: a filter is not a colour, so no alias token can carry the
   blur or the hairline edge — these live here, scoped by the attribute the
   client sets on <html> from the active palette, so every .fly-panel in the
   composition (shell, diagnostics, netops, plugins) gets the same treatment.
   The blur only shows where something sits behind the panel; in the drawer
   column that is the app background, which is why the edge and the wash carry
   most of the effect. */
html[data-fly-palette='glass'] .fly-panel,
html[data-fly-palette='volume'] .fly-panel,
html[data-fly-palette='neon'] .fly-panel  {
  background:
    radial-gradient(1200px 420px at 12% -10%, rgba(255, 176, 32, 0.10), transparent 70%),
    linear-gradient(165deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.015) 38%, transparent 70%),
    color-mix(in srgb, var(--dsw-alias-bg-base, #070b12) 74%, transparent);
  backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid var(--dsw-alias-border-l1, #1c2736);
  border-radius: 14px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 18px 50px -24px rgba(0, 0, 0, 0.55);
}
/* The slab ladder: the panel stops being a wall and becomes a lit slab. Dark half
   of the glass palette only, on purpose, and the scope is the whole decision:

   - The light half already carries this idea in its own dialect ("every lifted
     surface wears the same edge", a lit 1px top and a shaded bottom, DESIGN.md
     section 3) and it is asserted surface by surface. A second, differently shaped
     edge there would be two overlapping recipes, not a better one.
   - The solid palette is the battle-room look and its panel is a full-bleed page:
     flat by design. The reverse assertion in verify-shell pins that it stays flat.
   - What is left is the thinnest edge in the system -- the dark glass panel had a
     single 0.08 white inset -- and the reference sheet is a dark glass UI.

   The five layers are the measured anatomy, inside out: a 1px top hairline, the
   inner falloff under it, a slow brightening towards the bottom, a 3px bottom rim,
   and the 1px dark cut line painted *over* the rim's outer pixel. Order matters:
   the first listed shadow paints on top, so listing the cut before the rim is what
   puts the dark line at the very edge with the bright rim just inside it. In the
   reference that bottom rim is the brightest structural line on the page (luma 164
   against a body of 89 and a gap of 19) -- it is the lift, and it is why the slab
   reads as lit from below rather than merely outlined.

   Strengthened in two steps on 2026-10-04, both at the user's call. First the rim:
   the first cut was 2px at 0.42 white and too quiet to notice in a running window --
   a real one-pixel line at 1x, in one corner of one page. It is now 3px of visible
   light (a 4px band with the cut covering its outer pixel) at 0.62 white, which lands
   the rim near the reference's own luma instead of a third of it. Then the *rise*,
   after the user's second read: "your highlight is only on the top edge". They were
   right, and the number behind it is the body's own gradient -- the shipped 165 degree
   wash lights the top of the panel and is spent by the time it reaches the bottom, so
   the live panel measures 46 near its top edge and 8.4 down in its bottom padding.
   Against that, 0.10 white was +9 luma over the last 16px: a line standing on a dark
   board, which is why the bottom edge read as drawn on rather than lit. The reference
   sheet brightens its body towards the bottom (71 -> 89, +18), so the rise is now 0.22
   over a 20px band, and both halves of the claim are asserted live rather than in the
   fixture: the amplitude (>= 15 luma between the body 32px in and the body just above
   the rim) and that it has flattened out before the content starts (the panel's own
   34px bottom padding is what the band has to stay inside). The floors in verify-shell rose with it, and the
   rim's *width* is asserted too: a brighter edge that quietly narrows back is the
   same regression as a brighter edge that fades.

   The geometry lives here and nowhere else: inset shadows paint at the padding box
   edge, so the slab keeps its edge while a long page scrolls under it, and unlike
   an overlay they cannot swallow a click. The cast layer is repeated verbatim from
   the block above because box-shadow does not compose -- this rule replaces that
   stack rather than adding to it, in this palette and scheme only. */
html[data-fly-palette='glass'] body[data-ds-dark-theme] .fly-panel,
html[data-fly-palette='volume'] body[data-ds-dark-theme] .fly-panel  {
  box-shadow:
    inset 0 -1px 0 var(--dsw-specific-fly-slab-under, transparent),
    inset 0 -4px 0 var(--dsw-specific-fly-slab-bottom, transparent),
    inset 0 1px 0 var(--dsw-specific-fly-slab-top, transparent),
    inset 0 -20px 30px -18px var(--dsw-specific-fly-slab-rise, transparent),
    /* 8px band and 8px blur, not the 12px band this wanted to be: the padding
       invariant in verify-shell measures the worst case (offset + |spread| +
       blur/2 = 20px) against the panel's 22px top padding, and a wider band would
       have washed the first line of text to buy a curve nobody asked for. */
    inset 0 8px 8px -8px var(--dsw-specific-fly-slab-falloff, transparent),
    0 18px 50px -24px rgba(0, 0, 0, 0.55);
}
.fly-panel h1  {
  margin: 0 0 2px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.fly-sub  {
  margin: 0 0 20px;
  color: var(--dsw-alias-label-secondary, #8b9bb4);
  font-size: 12.5px;
}
.fly-chip-row  {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.fly-chip  {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l1, #1c2736);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, #0d131c);
  font-family: var(--fly-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #8b9bb4);
}
.fly-chip[data-tone='ok']  {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #00ff9c) 40%, transparent);
  color: var(--dsw-alias-state-success-primary, #00ff9c);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-success-primary, #00ff9c) 8%, transparent),
    0 0 18px -6px color-mix(in srgb, var(--dsw-alias-state-success-primary, #00ff9c) 35%, transparent);
}
/* 告警与失败：同一个红族的两级，靠**图标 + 边框厚度**分开 —— 色相只差一档，
   小字号 chip 上单看颜色分不出来。warn = ▲ + 1px（chip 的发丝线），
   error = ✕ + 2px。
   厚度只能走整像素：Chrome 把 border-width 的 resolved value 取整，1.5px
   在 deviceScaleFactor 2 下也算成 1px（实测），拿分数当区分通道会静默失效。 */
.fly-chip[data-tone='warn'],
.fly-chip[data-tone='error']  {
  font-weight: 600;
}
.fly-chip[data-tone='warn']  {
  border-width: 1px;
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ff6b85) 55%, transparent);
  color: var(--dsw-alias-state-warn-primary, #ff6b85);
}
.fly-chip[data-tone='error']  {
  border-width: 2px;
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff3b5c) 70%, transparent);
  color: var(--dsw-alias-state-error-primary, #ff3b5c);
}
.fly-chip[data-tone='warn']::before  {
  content: '▲';
  font-size: 8.5px;
  line-height: 1;
}
.fly-chip[data-tone='error']::before  {
  content: '✕';
  font-size: 10px;
  line-height: 1;
}
.fly-grid  {
  display: grid;
  /* 260px let two cards fit a ~600px drawer, which left each of them ~290px —
     too narrow for a two-column key/value list whose value can be rgba(...).
     At 340px they stack in the narrow drawer and pair up again when wide. */
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 12px;
}
.fly-card  {
  /* Grid children default to min-width:auto, so one long token (a profile path,
     a bundle id) can force the track wider than the drawer and push the right
     column out of the window — measured as values clipped at the viewport edge.
     Letting the card shrink makes the text wrap instead. */
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l1, #1c2736);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #0d131c);
}
/* A glass card carries its own blur, so it reads as a pane even when the panel
   behind it is only a flat colour. */
html[data-fly-palette='glass'] .fly-panel .fly-card,
html[data-fly-palette='volume'] .fly-panel .fly-card,
html[data-fly-palette='neon'] .fly-panel .fly-card  {
  border-radius: 12px;
  backdrop-filter: blur(14px) saturate(140%);
  box-shadow:
    0 1px 0 var(--dsw-specific-fly-surface-hi, rgba(255, 255, 255, 0.2)) inset,
    0 -1px 0 var(--dsw-specific-fly-surface-lo, rgba(0, 0, 0, 0.3)) inset,
    0 0 0 1px var(--dsw-specific-fly-ring, rgba(232, 238, 247, 0.13)),
    var(--dsw-specific-fly-shadow-near, 0 1px 2px rgba(0, 0, 0, 0.22)),
    0 8px 22px -12px rgba(0, 0, 0, 0.55);
}
.fly-card > h2  {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary, #8b9bb4);
}
.fly-kv  {
  display: grid;
  grid-template-columns: minmax(96px, max-content) 1fr;
  gap: 4px 14px;
  font-family: var(--fly-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 12px;
}
.fly-kv dt  {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary, #8b9bb4);
}
.fly-kv dd  {
  min-width: 0;
  overflow-wrap: anywhere;
}
.fly-note  {
  margin-top: 18px;
  color: var(--dsw-alias-label-secondary, #8b9bb4);
  font-size: 12px;
  line-height: 1.6;
}
.fly-mark  {
  display: block;
  color: currentColor;
}
.fly-mark[data-active='true']  {
  filter: drop-shadow(0 0 6px rgba(255, 176, 32, 0.5));
}

/* The Settings row (official settings.general.item slot): the owner draws no
   frame of its own, so the title, the control and the hint are all this row. */
.fly-skin-row  {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.fly-skin-title  {
  color: var(--dsw-alias-label-primary, #e8eef7);
  font-size: 13px;
  font-weight: 600;
}
.fly-skin-hint  {
  color: var(--dsw-alias-label-secondary, #8b9bb4);
  font-size: 12px;
  line-height: 1.5;
}

/* ---------------------------------------------------------------------------
 * Workbench primitives.
 *
 * Every Fly workbench renders: a header with a refresh control, a telemetry
 * table, severity tags, and a findings list. Those live here, in the skin, so a
 * workbench plugin only writes what is genuinely its own — which is why this
 * stylesheet is the shared surface and a workbench's own tag stays small.
 * ------------------------------------------------------------------------- */
.fly-actions  {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
/* 表单字段（或目录未就绪时的提示）后面紧跟动作行时要留间距：.fly-field 只给自己 margin-top、
   .fly-actions 只给自己 margin-bottom，中间原本是 0（实测 select 底边 == 按钮行顶边 438，
   整排按钮贴着选择框）。相邻选择器只作用于这两个组合，别的页面把动作行放在卡片顶部时不受影响。 */
.fly-field + .fly-actions,
.fly-note + .fly-actions  {
  margin-top: 10px;
}
.fly-btn  {
  flex: none;
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l1, #1c2736);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #131b28);
  color: var(--dsw-alias-label-primary, #e8eef7);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.fly-btn:hover:not(:disabled)  {
  border-color: var(--dsw-alias-brand-primary, #00ff9c);
  color: var(--dsw-alias-brand-primary, #00ff9c);
}
/* 选中态必须把 hover 的品牌边留住：鼠标移开就掉色的按钮，用户看不出"现在选的是哪个"
   （smart 面板的任务选择与产物 tab 都用 data-selected；2026-10-01 用户实测报的）。 */
.fly-btn[data-selected='true']:not(:disabled)  {
  border-color: var(--dsw-alias-brand-primary, #00ff9c);
  color: var(--dsw-alias-brand-primary, #00ff9c);
}
.fly-btn:disabled  {
  opacity: 0.55;
  cursor: progress;
}
.fly-table  {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--fly-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 12px;
}
.fly-table th  {
  padding: 0 8px 6px 0;
  text-align: left;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #8b9bb4);
  border-bottom: 1px solid var(--dsw-alias-border-l1, #1c2736);
}
.fly-table td  {
  padding: 4px 8px 4px 0;
  border-bottom: 1px solid rgba(28, 39, 54, 0.55);
  overflow-wrap: anywhere;
}
.fly-table tr:last-child td  {
  border-bottom: 0;
}
.fly-table td:first-child  {
  max-width: 220px;
}
.fly-num  {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.fly-tag  {
  /* 与 .fly-chip 同款：作为 flex item 时 display 会被块化成 block（实测 computed = block），
     inline-block 那套"盒子围住文字"的假设就没了 —— 行盒贴顶、盒子被拉高，字看起来偏高
     （实测：盒 907–933 / 行盒 910–922，墨迹中心比盒中心高 3.8px）。inline-flex + center
     让盒子仍可被拉高，但字恒在盒内居中，和芯片同一套语义。 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 间隔交给 gap：::before 的字形在 flex 布局里会丢掉 content 末尾的空格。 */
  gap: 0.3em;
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-border-l2, #2a3a50);
  border-radius: 999px;
  font-size: 10.5px;
  letter-spacing: 0.04em;
}
.fly-tag[data-severity='high']  {
  border-width: 2px;
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff3b5c) 60%, transparent);
  color: var(--dsw-alias-state-error-primary, #ff3b5c);
  font-weight: 600;
}
.fly-tag[data-severity='med'],
.fly-tag[data-severity='watch'],
.fly-tag[data-severity='warn']  {
  border-width: 1px;
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #ff6b85) 55%, transparent);
  color: var(--dsw-alias-state-warn-primary, #ff6b85);
}
/* Same second channel as the chips: the two red levels carry a glyph and a
   different border thickness, so 告警 and 失败 are distinguishable without
   trusting the eye to separate #ff6b85 from #ff3b5c at 10.5px. Integer widths
   only — Chrome's resolved border-width rounds (see the chip rule). */
.fly-tag[data-severity='high']::before  {
  content: '✕';
}
.fly-tag[data-severity='med']::before,
.fly-tag[data-severity='watch']::before,
.fly-tag[data-severity='warn']::before  {
  content: '▲';
}
.fly-tag[data-severity='info']  {
  color: var(--dsw-alias-state-idle-primary, #d4d4d4);
}
.fly-tag[data-severity='ok']  {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #00ff9c) 50%, transparent);
  color: var(--dsw-alias-state-success-primary, #00ff9c);
}
/* ── 相位板四态（smart 工作台） ─────────────────────────────────────────────
   The smart panel stamps the state machine's own word on both the gate chip and
   the status tag (data-phase-status), so the skin paints four *named* states
   instead of borrowing a severity word from another domain: 待做 = the official
   idle grey, 进行中 = the pending cyan, 已过门 = the done green plus the glow,
   已归档 = the same done green **without** the glow. The chip and the tag share
   each rule — they are one state shown in two voices. */
.fly-chip[data-phase-status='todo'],
.fly-tag[data-phase-status='todo']  {
  color: var(--dsw-alias-state-idle-primary, #d4d4d4);
}
.fly-chip[data-phase-status='active'],
.fly-tag[data-phase-status='active']  {
  border-color: color-mix(in srgb, var(--dsw-specific-fly-pending, #35d3e0) 55%, transparent);
  color: var(--dsw-specific-fly-pending, #35d3e0);
}
.fly-chip[data-phase-status='passed'],
.fly-tag[data-phase-status='passed']  {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #00ff9c) 50%, transparent);
  color: var(--dsw-alias-state-success-primary, #00ff9c);
  text-shadow: 0 0 8px color-mix(in srgb, var(--dsw-alias-state-success-primary, #00ff9c) 45%, transparent);
}
/* 已归档（2026-10-01 改）：绿字绿框，**不发光、不淡出**。旧的写法是 idle 灰 + opacity
   0.72，两条理由推翻了它：① 辉光的语义是"门刚过 / 还在这条流程里"，而归档恰恰是"已经
   收起来、不需要你看"—— 给页面上最不需要看的一格发光是反的；② 灰 + 淡出让**终态比尚未
   开始的「待做」还淡**（方向反了，用户对着截图问"为什么不是发光绿色"）。
   现在它与「已过门」同色，差别就是那层辉光（浅色半区本就关辉光，两态靠词与门芯片的
   — / G5 分）；也不再与「待做」的规则逐字相同（那条 0.72 原本就是拿来区分这两个灰的）。 */
.fly-chip[data-phase-status='archived'],
.fly-tag[data-phase-status='archived']  {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #00ff9c) 50%, transparent);
  color: var(--dsw-alias-state-success-primary, #00ff9c);
}
/* The glow is a dark-half device, and this is where it gets switched off: on
   white it does not read as light coming off the text, it reads as a smear
   behind it (dense CJK glyphs merge their shadows into one pale block — the
   first state-sheet render showed exactly that). The light half keeps the
   darker green ink and drops the halo, the same "no neon on white" rule the
   rest of the palette follows. Written after the rules it cancels, and gated
   on the same body marker as every other light-half override. */
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-chip[data-phase-status='passed'],
html[data-fly-palette] body:not([data-ds-dark-theme]) .fly-tag[data-phase-status='passed'] {
  text-shadow: none;
}
/* A wildcard bind is reachable from anywhere; a bound one is not. */
.fly-scope[data-scope='all']  {
  color: var(--dsw-alias-state-warn-primary, #ff6b85);
}
.fly-find  {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(28, 39, 54, 0.55);
  font-size: 12.5px;
}
.fly-find:last-child  {
  border-bottom: 0;
}
.fly-find code  {
  flex: none;
  font-family: var(--fly-mono, ui-monospace, SFMono-Regular, monospace);
  color: var(--dsw-alias-label-primary, #e8eef7);
}
.fly-empty  {
  margin: 0;
  color: var(--dsw-alias-label-secondary, #8b9bb4);
  font-size: 12px;
}
.fly-note-error  {
  margin: 0 0 12px;
  padding: 10px 12px;
  /* 失败 = 红族的 error 级：2px 边 + ✕，和 warn 的 1.5px 边 + ▲ 成对。 */
  border: 2px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff3b5c) 55%, transparent);
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary, #ff3b5c);
  font-size: 12px;
}
.fly-note-error::before  {
  content: '✕ ';
  font-weight: 700;
}
/* The 双模型路由 card in the fly.smart drawer page: the workbench pages' first
   editable control, so its frame is the skin's rather than the browser's. The hook
   is a data attribute the card owns, not a class, so a future workbench field can
   opt into the same frame without the panel shipping a stylesheet of its own. */
.fly-field  {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.fly-field > span  {
  color: var(--dsw-alias-label-secondary, #8b9bb4);
  font-size: 11px;
}
.fly-field input[data-fly-smart-field],
.fly-field select[data-fly-smart-field]  {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid rgba(13, 20, 32, 0.18);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e8eef7);
  font-family: var(--fly-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 12px;
}
.fly-field input[data-fly-smart-field]:focus-visible,
.fly-field select[data-fly-smart-field]:focus-visible  {
  outline: none;
  border-color: #ffb020;
  box-shadow: 0 0 0 2px rgba(255, 176, 32, 0.35);
}
html[data-ds-dark-theme] .fly-field input[data-fly-smart-field],
html[data-ds-dark-theme] .fly-field select[data-fly-smart-field]  {
  border-color: rgba(232, 238, 247, 0.22);
} .fly-panel {
  box-shadow:
    inset 0 -1px 0 var(--dsw-specific-fly-slab-under, transparent),
    inset 0 -4px 0 var(--dsw-specific-fly-slab-bottom, transparent),
    inset 0 1px 0 var(--dsw-specific-fly-slab-top, transparent),
    inset 0 -20px 30px -18px var(--dsw-specific-fly-slab-rise, transparent),
    inset 0 8px 8px -8px var(--dsw-specific-fly-slab-falloff, transparent),
    0 0 0 1px var(--dsw-specific-fly-ring, rgba(232, 238, 247, 0.13)),
    var(--dsw-specific-fly-shadow-near, 0 1px 2px rgba(0, 0, 0, 0.22)),
    var(--dsw-specific-fly-shadow-mid, 0 6px 16px rgba(0, 0, 0, 0.24)),
    var(--dsw-specific-fly-shadow-far, 0 18px 44px rgba(0, 0, 0, 0.32));
} .fly-card {
  box-shadow:
    inset 0 -1px 0 var(--dsw-specific-fly-slab-under, transparent),
    inset 0 -3px 0 var(--dsw-specific-fly-slab-bottom, transparent),
    inset 0 1px 0 var(--dsw-specific-fly-slab-top, transparent),
    inset 0 -12px 14px -11px var(--dsw-specific-fly-slab-rise, transparent),
    inset 0 5px 6px -5px var(--dsw-specific-fly-slab-falloff, transparent),
    0 0 0 1px var(--dsw-specific-fly-ring, rgba(232, 238, 247, 0.13)),
    var(--dsw-specific-fly-shadow-near, 0 1px 2px rgba(0, 0, 0, 0.22)),
    var(--dsw-specific-fly-shadow-mid, 0 6px 16px rgba(0, 0, 0, 0.24)),
    var(--dsw-specific-fly-shadow-far, 0 18px 44px rgba(0, 0, 0, 0.32));
}

/* 玻璃材质本体：目标图（01–08）的 .glass —— 163° 冷蓝渐变 + 0.46 暗基座 +
   118° 抛光带 + 两个顶角高光 —— 现在整套住在 pane token 里（强度也在
   token：spec-corner / spec-sheen 嵌在 pane 的层里），所以家族卡片 / 金卡 /
   工具琥珀栈 / 面板读的是同一块玻璃。第一轮只给 .fly-panel 上了收尾，用户
   看的卡片还是暗板 —— 那就是「玻璃2 没变化」的根因。面板自己只多一样东西：
   琥珀色场，画在玻璃层之下，从 0.46 的半透基座里透出来（目标图面板底下的
   光池语义；层序照 .glass 的解剖：色场在下、材质在上、收尾在最上）。 */
html[data-fly-palette='volume'] body[data-ds-dark-theme] .fly-panel  {
  background-image:
    var(--dsw-specific-fly-pane, none),
    radial-gradient(1200px 420px at 12% -10%, rgba(255, 176, 32, 0.06), transparent 70%),
    var(--dsw-alias-bg-base, #070b12);
} .fly-panel h1  {
  background-color: var(--dsw-specific-fly-plate-bg, rgba(8, 12, 20, 0.92));
  box-shadow: inset 0 0 0 1px var(--dsw-specific-fly-plate-line, rgba(150, 190, 230, 0.22));
  /* 面板标题不是这轮裁决的对象：它旁边没有选项框要协调，原样留在 8px。 */
  border-radius: 8px;
} .fly-panel h1 {
  text-shadow: none;
  filter: none;
} .fly-panel h1  {
  display: inline-block;
  padding: 4px 12px;
} .fly-panel  {
  box-shadow:
    inset 0 -1px 0 var(--dsw-specific-fly-slab-under, transparent),
    inset 0 -4px 0 var(--dsw-specific-fly-slab-bottom, transparent),
    inset 0 1px 0 var(--dsw-specific-fly-slab-top, transparent),
    inset 0 -20px 30px -18px var(--dsw-specific-fly-slab-rise, transparent),
    inset 0 8px 8px -8px var(--dsw-specific-fly-slab-falloff, transparent),
    0 30px 80px -20px rgba(53, 211, 224, 0.3),
    0 6px 28px -6px rgba(53, 211, 224, 0.2),
    0 18px 50px -24px rgba(0, 0, 0, 0.6);
}

/* T7：文字上板（两个半区都画，靠 plate token 翻方言：深色近黑，浅色白瓷）。
   只写 background-color，不碰 border-color —— 带 tone 的芯片（ok/warn/error）
   的描边与着色规则特异性更高，照旧生效；板只垫在没 tone 的芯片底下。 */
html[data-fly-palette='neon'] .fly-chip  {
  background-color: var(--dsw-specific-fly-plate-bg, rgba(4, 7, 12, 0.88));
} .fly-panel h1  {
  display: inline-block;
  padding: 4px 12px;
  background-color: var(--dsw-specific-fly-plate-bg, rgba(4, 7, 12, 0.88));
  box-shadow: inset 0 0 0 1px var(--dsw-specific-fly-plate-line, rgba(150, 190, 230, 0.26));
  border-radius: 8px;
}
`;
const name = "fly-smart-panel";
const inject = ["slots", "sidebarRightTabs"];
const KIND = "fly.smart";
const TAB_TITLE = "Smart 模型路由";
const TAB_DESCRIPTION = "hand / review 路由：派发子代理时按这里选模型";
const GUIDE_ORDER = 40;
const PACKAGE = "dsh-plugin-fly-smart-panel";
const BASE = "/fly/smart";
let browserContext = null;
class HostError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HostError";
    this.status = status;
  }
}
async function getJson(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const text = await response.text();
  let payload = null;
  try {
    payload = text === "" ? null : JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const explained = typeof payload === "object" && payload !== null && typeof payload.error === "string" ? payload.error : `${path} → HTTP ${response.status}`;
    throw new HostError(response.status, explained);
  }
  return payload;
}
function readSessionId(from) {
  if (typeof document === "undefined") return null;
  const owner = from?.closest("[data-sidebar-right-session]") ?? document.querySelector("[data-sidebar-right-session]");
  const value = owner?.getAttribute("data-sidebar-right-session") ?? "";
  return value === "" ? null : value;
}
function hostErrorText(payload, status) {
  if (typeof payload === "object" && payload !== null) {
    const message = payload.error;
    if (typeof message === "string" && message !== "") return message;
  }
  return `HTTP ${status}`;
}
const SOURCE_LABEL = {
  preset: "preset 行（压过本页）",
  session: "本会话",
  default: "所有会话默认",
  none: "没有任何一层设置 —— 调用工具时会大声报错"
};
function reviewEffectiveLabel(config) {
  const value = config?.effectiveReview?.review ?? "";
  const source = config?.effectiveReview?.source ?? null;
  if (value === "") return "（未配置 —— 评审与取证复用 hand 路由）";
  return `${value} · ${source === null ? "未知来源" : SOURCE_LABEL[source]}`;
}
function liteEffectiveLabel(config) {
  const value = config?.effectiveLite?.lite ?? "";
  const source = config?.effectiveLite?.source ?? null;
  if (value === "") return "（未配置 —— 派发 role:lite 会大声报错，不静默用贵模型）";
  return `${value} · ${source === null ? "未知来源" : SOURCE_LABEL[source]}`;
}
function RouteCard({ config, sessionId, onSaved }) {
  const [draft, setDraft] = react.useState("");
  const [saving, setSaving] = react.useState(false);
  const [status, setStatus] = react.useState(null);
  const [ladder, setLadder] = react.useState("unavailable");
  const [options, setOptions] = react.useState([]);
  const inputRef = react.useRef(null);
  const reviewInputRef = react.useRef(null);
  const liteInputRef = react.useRef(null);
  const roleRef = react.useRef("hand");
  const typed = react.useRef(false);
  react.useEffect(() => {
    const next = config?.session?.hand ?? config?.default?.hand ?? "";
    if (typed.current) return;
    if (inputRef.current !== null) inputRef.current.value = next;
    if (reviewInputRef.current !== null) reviewInputRef.current.value = config?.session?.review ?? config?.default?.review ?? "";
    if (liteInputRef.current !== null) liteInputRef.current.value = config?.session?.lite ?? config?.default?.lite ?? "";
    setDraft(next);
  }, [config]);
  react.useEffect(() => {
    if (sessionId === null) {
      setLadder("unavailable");
      setOptions([]);
      return;
    }
    const models = browserContext?.get?.("modelDirectories");
    if (models === void 0 || models === null || typeof models.directoryFor !== "function") {
      setLadder("unavailable");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await models.directoryFor?.(sessionId)?.load();
        if (cancelled) return;
        const next = [];
        for (const group of snapshot?.groups ?? []) {
          for (const model of group.models ?? []) {
            const base = `${group.id}/${model.id}`;
            next.push({ value: base, label: base });
            for (const effort of model.reasoning?.efforts ?? []) {
              next.push({ value: `${base}@${effort.id}`, label: `${base} · ${effort.name ?? effort.id}` });
            }
          }
        }
        setOptions(next);
        setLadder(next.length === 0 ? "pending" : "ready");
      } catch {
        if (!cancelled) {
          setOptions([]);
          setLadder("unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  const presetEffective = config?.presetRow.effective === true;
  const canSession = sessionId !== null && config?.sessionKnown !== false;
  const activeBox = () => roleRef.current === "review" ? reviewInputRef.current : roleRef.current === "lite" ? liteInputRef.current : inputRef.current;
  const boxValue = () => activeBox()?.value ?? draft;
  const save = async (scope, value = boxValue().trim()) => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch(`${BASE}/routes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scope === "session" ? { [roleRef.current]: value, role: roleRef.current, scope, sessionId } : { [roleRef.current]: value, role: roleRef.current, scope })
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text === "" ? null : JSON.parse(text);
      } catch {
        payload = null;
      }
      if (!response.ok) {
        setStatus({ tone: "error", text: hostErrorText(payload, response.status) });
        return;
      }
      const written = payload;
      typed.current = false;
      const where = scope === "session" ? "本会话" : "所有会话默认";
      setStatus({
        tone: written.effectiveFromPanel ? "ok" : "warn",
        text: written.changed ? `已保存到${where}（${written.at ?? "—"}）${written.effectiveFromPanel ? "" : " · 但 preset 行已有路由，工具面仍用它"}` : `值未变化 —— 磁盘上已经是 ${value === "" ? "（空）" : value}`
      });
      onSaved();
    } catch (error) {
      setStatus({ tone: "error", text: `请求失败：${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ jsxRuntime.jsxs("article", { className: "fly-card", "data-probe": "route-config", children: [
    /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "三模型路由" }),
    /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-sub", "data-probe": "route-path", children: `配置面 ${config?.path ?? "…"}（hand / review / lite 可写；brain 只读）` }),
    /* @__PURE__ */ jsxRuntime.jsxs("dl", { className: "fly-kv", children: [
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "brain（只读）" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "brain-route", children: config?.brain?.value ?? "（镜像里没有 brain 键 —— 本页只写 hand / review）" }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "hand 当前生效" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "effective-route", children: `${config?.effective?.hand === void 0 || config.effective.hand === "" ? "（未配置）" : config.effective.hand} · ${SOURCE_LABEL[config?.effective?.source ?? "none"]}` }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "review 当前生效" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "effective-review-route", children: reviewEffectiveLabel(config) }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "lite 当前生效" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "effective-lite-route", children: liteEffectiveLabel(config) }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "本会话 hand" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "session-route", children: config?.session?.hand === void 0 || config.session.hand === "" ? "（未单独设置）" : config.session.hand }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "本会话 review" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "session-review-route", children: config?.session?.review === void 0 || config.session.review === "" ? "（未单独设置）" : config.session.review }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "本会话 lite" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "session-lite-route", children: config?.session?.lite === void 0 || config.session.lite === "" ? "（未单独设置）" : config.session.lite }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "所有会话默认 hand" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "default-route", children: config?.default?.hand === void 0 || config.default.hand === "" ? "（未设置）" : config.default.hand }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "所有会话默认 review" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "default-review-route", children: config?.default?.review === void 0 || config.default.review === "" ? "（未设置）" : config.default.review })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "fly-field", children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { children: "hand 模型（provider/model，可选 @effort）" }),
      /* @__PURE__ */ jsxRuntime.jsx(
        "input",
        {
          type: "text",
          "data-fly-smart-field": "hand",
          ref: inputRef,
          defaultValue: config?.session?.hand ?? config?.default?.hand ?? "",
          placeholder: "deepseek/deepseek-flash",
          spellCheck: false,
          onFocus: () => {
            roleRef.current = "hand";
          },
          onChange: (event) => {
            roleRef.current = "hand";
            typed.current = true;
            setDraft(event.target.value);
          }
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "fly-field", children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { children: "review 模型（provider/model，可选 @effort）" }),
      /* @__PURE__ */ jsxRuntime.jsx(
        "input",
        {
          type: "text",
          "data-fly-smart-field": "review",
          ref: reviewInputRef,
          defaultValue: config?.session?.review ?? config?.default?.review ?? "",
          placeholder: "deepseek/deepseek-reasoner",
          spellCheck: false,
          onFocus: () => {
            roleRef.current = "review";
          },
          onChange: (event) => {
            roleRef.current = "review";
            typed.current = true;
            setDraft(event.target.value);
          }
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "fly-field", children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { children: "lite 模型（机械活的便宜模型，provider/model，可选 @effort）" }),
      /* @__PURE__ */ jsxRuntime.jsx(
        "input",
        {
          type: "text",
          "data-fly-smart-field": "lite",
          ref: liteInputRef,
          defaultValue: config?.session?.lite ?? config?.default?.lite ?? "",
          placeholder: "deepseek/deepseek-flash",
          spellCheck: false,
          onFocus: () => {
            roleRef.current = "lite";
          },
          onChange: (event) => {
            roleRef.current = "lite";
            typed.current = true;
            setDraft(event.target.value);
          }
        }
      )
    ] }),
    ladder === "ready" ? /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "fly-field", children: [
      /* @__PURE__ */ jsxRuntime.jsx("span", { children: "从模型目录选择（写入你正在编辑的那个输入框）" }),
      /* @__PURE__ */ jsxRuntime.jsxs(
        "select",
        {
          "data-fly-smart-field": "ladder",
          defaultValue: "",
          onChange: (event) => {
            if (event.target.value === "") return;
            typed.current = true;
            const box = activeBox();
            if (box !== null) box.value = event.target.value;
            setDraft(event.target.value);
          },
          children: [
            /* @__PURE__ */ jsxRuntime.jsx("option", { value: "", children: "（从目录里挑一个）" }),
            options.map((option) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: option.value, children: option.label }, option.value))
          ]
        }
      )
    ] }) : /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note", "data-probe": "ladder-state", "data-ladder": ladder, children: ladder === "unavailable" ? "模型目录服务不可用（或本页读不到会话 id）—— 请手工填写 provider/model。" : "模型目录还没就绪 —— 可以先手工填写，稍后目录到了再从下拉里挑。" }),
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "fly-actions", children: [
      /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          className: "fly-btn",
          type: "button",
          "data-act": "save-session",
          disabled: saving || !canSession,
          onClick: () => {
            void save("session");
          },
          children: "保存到本会话"
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          className: "fly-btn",
          type: "button",
          "data-act": "save-default",
          disabled: saving || presetEffective,
          onClick: () => {
            void save("default");
          },
          children: "设为所有会话默认"
        }
      ),
      /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          className: "fly-btn",
          type: "button",
          "data-act": "clear-session",
          disabled: saving || !canSession || config?.session === null || config?.session === void 0,
          onClick: () => {
            void save("session", "");
          },
          children: "清空本会话"
        }
      )
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note", "data-probe": "route-target", children: "上面三个动作作用于你最后碰过的那个输入框（hand / review / lite）—— 点一下要改的那条，再按保存。" }),
    presetEffective ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note", "data-probe": "preset-note", children: `preset 行已把路由钉成 ${config?.presetRow.hand ?? ""}，它压过本页（也压过镜像）—— 「设为所有会话默认」因此禁用；本会话的写入只有在该行清空后才轮到工具面。` }) : null,
    status === null ? null : /* @__PURE__ */ jsxRuntime.jsx("p", { className: status.tone === "error" ? "fly-note-error" : "fly-note", "data-probe": "route-status", "data-tone": status.tone, children: status.text })
  ] });
}
function SmartPanel() {
  const [routeConfig, setRouteConfig] = react.useState(null);
  const [sessionId, setSessionId] = react.useState(null);
  const [notice, setNotice] = react.useState(null);
  const rootRef = react.useRef(null);
  const scopedSession = react.useCallback(() => {
    const found = readSessionId(rootRef.current);
    setSessionId(found);
    return found;
  }, []);
  const load = react.useCallback(async () => {
    const sid = scopedSession();
    const query = sid === null ? "" : `?sessionId=${encodeURIComponent(sid)}`;
    try {
      const payload = await getJson(`${BASE}/routes${query}`);
      setRouteConfig(payload);
      setNotice(null);
    } catch (error) {
      setRouteConfig(null);
      setNotice(error instanceof Error ? `读路由配置失败：${error.message}` : `读路由配置失败：${String(error)}`);
    }
  }, [scopedSession]);
  react.useEffect(() => {
    void load();
  }, [load]);
  return /* @__PURE__ */ jsxRuntime.jsxs("section", { className: "fly-panel", "data-probe": "smart-panel", ref: rootRef, children: [
    /* @__PURE__ */ jsxRuntime.jsx("h1", { children: "Smart" }),
    /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-sub", children: "派发子代理时使用的模型路由。任务的计划与验收就是普通 markdown（docs/plans/），用 smart_check_doc 校验契约。" }),
    notice === null ? null : /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note-error", "data-probe": "route-notice", children: notice }),
    /* @__PURE__ */ jsxRuntime.jsx(RouteCard, { config: routeConfig, sessionId, onSaved: () => {
      void load();
    } })
  ] });
}
function apply(ctx) {
  browserContext = ctx;
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PACKAGE,
    kind: KIND,
    title: () => TAB_TITLE,
    guide: [{
      id: "open",
      order: GUIDE_ORDER,
      title: () => TAB_TITLE,
      description: () => TAB_DESCRIPTION,
      icon: SmartMark
    }]
  }), "fly-smart-panel: drawer type");
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.setAttribute("data-plugin", PACKAGE);
    tag.textContent = WORKBENCH_CSS;
    document.head.appendChild(tag);
    return () => {
      tag.remove();
    };
  }, "fly-smart-panel: workbench stylesheet");
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab", key: PACKAGE, inject: () => ({}) },
    SmartPanel
  )), "fly-smart-panel: drawer body");
}
function SmartMark({ size = 18, active = false }) {
  return /* @__PURE__ */ jsxRuntime.jsxs("svg", { className: "fly-mark", "data-active": active ? "true" : "false", width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "6", cy: "6", r: "2.4", stroke: "currentColor", strokeWidth: "1.6" }),
    /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "18", cy: "18", r: "2.4", stroke: "currentColor", strokeWidth: "1.6" }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M8.2 7.4 15.8 16.6", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" })
  ] });
}
exports.SmartMark = SmartMark;
exports.SmartPanel = SmartPanel;
exports.apply = apply;
exports.inject = inject;
exports.name = name;

    return module.exports;
  },
});
