/* dsh-plugin-fly-smart — browser half, built by scripts/build-plugin-client.mjs.
 * src-hash: 977d1e302a53fa4398a4462d7af6eee9a227ed349f193842efe8c9b9c3021b3c
 * Factory-form CJS: the loader calls the factory with its platform `require`
 * and memoizes the returned exports. Keep the banner so the loader id and the
 * package that produced the bundle stay greppable in a live page. */
window.__ModuleLoader__.load({
  id: "dsh-plugin-fly-smart",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const jsxRuntime = require("react/jsx-runtime");
const react = require("react");
const name = "fly-smart-panel";
const inject = ["slots", "sidebarRightTabs"];
const KIND = "fly.smart";
const TAB_TITLE = "Smart 工作流";
const TAB_DESCRIPTION = "smart 任务的阶段板、产物、门记录与路由告警";
const GUIDE_ORDER = 40;
const PACKAGE = "dsh-plugin-fly-smart-panel";
const BASE = "/fly/smart";
const BOARD = [
  { id: "brainstorm", label: "脑暴", gate: "G1" },
  { id: "design", label: "设计", gate: "G2" },
  { id: "plan", label: "计划", gate: "G3" },
  { id: "acceptance", label: "验收设计", gate: "G4" },
  { id: "executing", label: "执行", gate: null },
  { id: "reviewing", label: "验收", gate: "G5" },
  { id: "done", label: "完成", gate: null }
];
const ARTIFACT_LABEL = {
  brainstorm: "脑暴",
  design: "设计",
  plan: "计划",
  acceptance: "验收设计",
  executing: "执行报告",
  // 设计文档把这一阶段的产物名叫「验收」（review.md = 逐条验收结论），阶段板也这么叫；
  // 标签曾是「评审」——那是**手模型逐阶段评审**的说法（同一页 `<dt>评审</dt>` 用对了）。
  reviewing: "验收",
  summary: "收尾总结"
};
const STATUS_LABEL = {
  todo: "待做",
  active: "进行中",
  passed: "已过门",
  archived: "已归档"
};
const PHASE_LABEL = Object.fromEntries(BOARD.map((entry) => [entry.id, entry.label]));
const PRE_STYLE = {
  margin: "0",
  maxHeight: "340px",
  overflow: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontFamily: "var(--fly-mono, ui-monospace, SFMono-Regular, monospace)",
  fontSize: "12px",
  lineHeight: 1.6
};
const BRIEFING_LABEL = {
  none: "未生成",
  "awaiting-user": "待确认",
  confirmed: "已确认",
  stale: "已过期",
  failed: "生成失败",
  revise: "需修改"
};
function briefingStatus(task) {
  const report = task.briefings;
  return report?.[task.state.phase]?.status ?? "none";
}
function briefingRoute(task) {
  const report = task.briefings;
  return report?.[task.state.phase]?.route ?? null;
}
function reworkExhausted(entry) {
  return typeof entry.reworkUsed === "number" && typeof entry.reworkCap === "number" && entry.reworkCap > 0 && entry.reworkUsed >= entry.reworkCap;
}
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
function reworkBudgetOf(state) {
  const max = state.settings?.maxRework ?? 5;
  const grants = (state.reworkGrants ?? []).filter((grant) => grant.phase === state.phase).length;
  const used = (state.history ?? []).filter((entry) => entry.to === state.phase).length;
  return { used, cap: max * (1 + grants), grants };
}
function artifactOpenDecisions(task) {
  const markdown = task.artifacts[task.state.phase]?.markdown ?? "";
  if (markdown === "") return null;
  const headings = [];
  let items = 0;
  let inside = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (/^#{1,6}\s/u.test(line)) {
      inside = line.includes("需要你裁决");
      if (inside) headings.push(line.replace(/^#{1,6}\s*/u, "").trim());
      continue;
    }
    if (inside && /^([-*+]|\d+[.)])\s+\S/u.test(line)) items += 1;
  }
  return headings.length === 0 ? null : { headings, items };
}
function pendingDecisionsOf(task) {
  return task.state.pendingDecisions ?? artifactOpenDecisions(task);
}
function decidedCount(task) {
  let total = 0;
  for (const rounds of Object.values(task.state.decisions ?? {})) {
    for (const round of Array.isArray(rounds) ? rounds : []) total += Array.isArray(round?.entries) ? round.entries.length : 0;
  }
  return total;
}
function formatTime(value) {
  if (typeof value !== "string" || value === "") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}
function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
function formatRoute(provider, model) {
  return provider === null || model === null ? "—" : `${provider}/${model}`;
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
function RouteCard({ config, sessionId, onSaved }) {
  const [draft, setDraft] = react.useState("");
  const [saving, setSaving] = react.useState(false);
  const [status, setStatus] = react.useState(null);
  const [ladder, setLadder] = react.useState("unavailable");
  const [options, setOptions] = react.useState([]);
  const inputRef = react.useRef(null);
  const reviewInputRef = react.useRef(null);
  const roleRef = react.useRef("hand");
  const typed = react.useRef(false);
  react.useEffect(() => {
    const next = config?.session?.hand ?? config?.default?.hand ?? "";
    if (typed.current) return;
    if (inputRef.current !== null) inputRef.current.value = next;
    if (reviewInputRef.current !== null) reviewInputRef.current.value = config?.session?.review ?? config?.default?.review ?? "";
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
  const activeBox = () => roleRef.current === "review" ? reviewInputRef.current : inputRef.current;
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
    /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-sub", "data-probe": "route-path", children: `配置面 ${config?.path ?? "…"}（hand / review 可写；brain 只读）` }),
    /* @__PURE__ */ jsxRuntime.jsxs("dl", { className: "fly-kv", children: [
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "brain（只读）" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "brain-route", children: config?.brain?.value ?? "（镜像里没有 brain 键 —— 本页只写 hand / review）" }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "hand 当前生效" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "effective-route", children: `${config?.effective?.hand === void 0 || config.effective.hand === "" ? "（未配置）" : config.effective.hand} · ${SOURCE_LABEL[config?.effective?.source ?? "none"]}` }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "review 当前生效" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "effective-review-route", children: reviewEffectiveLabel(config) }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "本会话 hand" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "session-route", children: config?.session?.hand === void 0 || config.session.hand === "" ? "（未单独设置）" : config.session.hand }),
      /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "本会话 review" }),
      /* @__PURE__ */ jsxRuntime.jsx("dd", { "data-probe": "session-review-route", children: config?.session?.review === void 0 || config.session.review === "" ? "（未单独设置）" : config.session.review }),
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
    /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note", "data-probe": "route-target", children: "上面三个动作作用于你最后碰过的那个输入框（hand 或 review）—— 点一下要改的那条，再按保存。" }),
    presetEffective ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note", "data-probe": "preset-note", children: `preset 行已把路由钉成 ${config?.presetRow.hand ?? ""}，它压过本页（也压过镜像）—— 「设为所有会话默认」因此禁用；本会话的写入只有在该行清空后才轮到工具面。` }) : null,
    status === null ? null : /* @__PURE__ */ jsxRuntime.jsx("p", { className: status.tone === "error" ? "fly-note-error" : "fly-note", "data-probe": "route-status", "data-tone": status.tone, children: status.text })
  ] });
}
function phaseStatus(phase, task) {
  const state = task.state;
  const archived = typeof state.archivedAt === "string";
  const order = BOARD.map((entry) => entry.id);
  const currentIndex = order.indexOf(state.phase);
  const index = order.indexOf(phase.id);
  if (archived) return phase.id === "done" ? "archived" : "passed";
  const gatePassed = phase.gate !== null && task.gates.some((record) => record.gate === phase.gate);
  if (gatePassed || currentIndex !== -1 && index < currentIndex) return "passed";
  if (index === currentIndex) return "active";
  return "todo";
}
function artifactTabs(task) {
  const phases = ["brainstorm", "design", "plan", "acceptance", "executing", "reviewing"];
  const present = phases.filter((phase) => task.artifacts[phase] !== void 0);
  return task.summary === null ? present : [...present, "summary"];
}
function artifactText(task, phase) {
  if (phase === "summary") return task.summary?.markdown ?? null;
  return task.artifacts[phase]?.markdown ?? null;
}
function MarkdownView({ markdown }) {
  const lines = markdown.split("\n");
  const blocks = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length === 0) return;
    blocks.push({ kind: "text", body: buffer.join("\n") });
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading === null) {
      buffer.push(line);
      continue;
    }
    flush();
    blocks.push({ kind: "heading", body: heading[2], level: heading[1].length });
  }
  flush();
  return /* @__PURE__ */ jsxRuntime.jsx("div", { children: blocks.map((block, index) => block.kind === "heading" ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-sub", "data-heading": block.level, style: { margin: "10px 0 6px" }, children: block.body }, `h-${index}`) : /* @__PURE__ */ jsxRuntime.jsx("pre", { style: PRE_STYLE, children: block.body.replace(/^\n+|\n+$/gu, "") }, `t-${index}`)) });
}
function SmartPanel() {
  const [tasks, setTasks] = react.useState([]);
  const [root, setRoot] = react.useState("");
  const [selected, setSelected] = react.useState(null);
  const [task, setTask] = react.useState(null);
  const [tab, setTab] = react.useState(null);
  const [notice, setNotice] = react.useState(null);
  const [busy, setBusy] = react.useState(true);
  const [routeConfig, setRouteConfig] = react.useState(null);
  const [legacyCount, setLegacyCount] = react.useState(0);
  const [unknownWorkspace, setUnknownWorkspace] = react.useState(null);
  const [sessionId, setSessionId] = react.useState(null);
  const [jumped, setJumped] = react.useState(null);
  const rootRef = react.useRef(null);
  const artifactsRef = react.useRef(null);
  const scopedSession = react.useCallback(() => {
    const found = readSessionId(rootRef.current);
    setSessionId(found);
    return found;
  }, []);
  const load = react.useCallback(async (wanted) => {
    setBusy(true);
    const sid = scopedSession();
    const query = sid === null ? "" : `?sessionId=${encodeURIComponent(sid)}`;
    try {
      const namespace = await getJson(`${BASE}${query}`);
      setRoot(namespace.root);
      setRouteConfig(namespace.routeConfig ?? null);
      if (namespace.exists === false) {
        setTasks([]);
        setTask(null);
        setNotice({ kind: "missing", message: namespace.message ?? `${namespace.root} 下还没有任何 smart 任务。` });
        return;
      }
      const index = await getJson(`${BASE}/tasks${query}`);
      setRoot(index.root);
      setTasks(index.tasks);
      setLegacyCount(index.legacyCount ?? 0);
      const next = wanted ?? index.tasks[0]?.id ?? null;
      setSelected(next);
      if (index.unknownWorkspace === true) {
        setTask(null);
        setUnknownWorkspace(index.message ?? "无法确定当前工作区。");
        setNotice(null);
        return;
      }
      setUnknownWorkspace(null);
      if (next === null) {
        setTask(null);
        setNotice({ kind: "missing", message: `${index.root} 下还没有任何 smart 任务。` });
        return;
      }
      const detail = await getJson(`${BASE}/task?id=${encodeURIComponent(next)}${sid === null ? "" : `&sessionId=${encodeURIComponent(sid)}`}`);
      setTask(detail);
      setNotice(null);
      setTab((current) => {
        const available = artifactTabs(detail);
        return current !== null && available.includes(current) ? current : available[0] ?? null;
      });
    } catch (error) {
      setTask(null);
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ kind: error instanceof HostError && error.status === 503 ? "missing" : "error", message });
    } finally {
      setBusy(false);
    }
  }, [scopedSession]);
  react.useEffect(() => {
    void load();
  }, [load]);
  const jump = (phase) => {
    setTab(phase);
    setJumped(phase);
  };
  react.useEffect(() => {
    if (jumped === null) return;
    const card = artifactsRef.current ?? rootRef.current?.querySelector('[data-probe="artifacts"]') ?? null;
    const button = card?.querySelector(`button[data-artifact="${jumped}"]`);
    if (button === null || button === void 0) return;
    const target = button;
    target.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
  }, [jumped, tab]);
  const hand = task?.routes.hand ?? [];
  return /* @__PURE__ */ jsxRuntime.jsxs("section", { className: "fly-panel", "data-plugin": PACKAGE, "data-session-id": sessionId ?? "", ref: rootRef, children: [
    /* @__PURE__ */ jsxRuntime.jsx("h1", { children: "Smart 工作流" }),
    /* @__PURE__ */ jsxRuntime.jsxs("p", { className: "fly-sub", children: [
      "smart 模式的磁盘事实：阶段板、六个产物、门记录、手模型评审与验收取证。",
      root === "" ? "" : ` 数据源 ${root}`
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx(RouteCard, { config: routeConfig, sessionId, onSaved: () => {
      void load(selected);
    } }),
    unknownWorkspace === null ? null : /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note", "data-probe": "unknown-workspace", children: unknownWorkspace }),
    legacyCount === 0 ? null : /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note", "data-probe": "legacy-count", children: `另有 ${legacyCount} 个任务在兼容根（旧任务仍可读、可继续、可归档）。` }),
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "fly-actions", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "fly-chip-row", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "tasks", children: `任务 ${tasks.length}` }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "root", title: root, children: `根目录 ${root === "" ? "…" : root}` }),
        task === null ? null : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "phase", children: `阶段 ${PHASE_LABEL[task.state.phase] ?? task.state.phase}` }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "gate", children: `开门 ${task.state.awaitingGate ?? "无"}` }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: "fly-chip",
              "data-chip": "rework",
              ...reworkBudgetOf(task.state).used >= reworkBudgetOf(task.state).cap ? { "data-tone": "warn" } : {},
              title: `本阶段（${PHASE_LABEL[task.state.phase] ?? task.state.phase}）返工额度：已用 ${reworkBudgetOf(task.state).used} / 上限 ${reworkBudgetOf(task.state).cap}${reworkBudgetOf(task.state).grants === 0 ? "" : `（含你加额的 ${reworkBudgetOf(task.state).grants} 次）`}${reworkBudgetOf(task.state).used >= reworkBudgetOf(task.state).cap ? "。额度已用尽：下一道门会把「是否继续重做」交给你" : ""}`,
              children: `返工 ${reworkBudgetOf(task.state).used}/${reworkBudgetOf(task.state).cap}`
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "consults", children: `评审 ${task.consults.length}` }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: "fly-chip",
              "data-chip": "briefing",
              ...briefingStatus(task) === "stale" || briefingStatus(task) === "failed" ? { "data-tone": "warn" } : {},
              title: `briefing（${PHASE_LABEL[task.state.phase] ?? task.state.phase}）：${BRIEFING_LABEL[briefingStatus(task)] ?? briefingStatus(task)}${briefingRoute(task) === null ? "" : ` · ${briefingRoute(task)}`}`,
              children: `briefing ${BRIEFING_LABEL[briefingStatus(task)] ?? briefingStatus(task)}`
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "evidence", children: `取证 ${task.verifications.length}` }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "archived", children: task.state.archivedAt === void 0 ? "未归档" : `归档 ${formatTime(task.state.archivedAt)}` }),
          pendingDecisionsOf(task) === null ? decidedCount(task) === 0 ? null : /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "decisions", children: `已裁决 ${decidedCount(task)}` }) : /* @__PURE__ */ jsxRuntime.jsx(
            "span",
            {
              className: "fly-chip",
              "data-chip": "decisions",
              "data-tone": "warn",
              title: pendingDecisionsOf(task)?.headings.join(" / "),
              children: `待裁决 ${pendingDecisionsOf(task)?.items}`
            }
          ),
          task.routes.drifted ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "route", "data-tone": "warn", children: `路由不一致 ${task.routes.executed ?? ""}` }) : task.routes.executed === null ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "route", children: "执行路由未知" }) : /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-chip": "route", "data-tone": "ok", children: `路由一致 ${task.routes.executed}` })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("button", { className: "fly-btn", type: "button", onClick: () => {
        void load(selected);
      }, disabled: busy, children: busy ? "读取…" : "刷新" })
    ] }),
    notice === null ? null : notice.kind === "missing" ? /* @__PURE__ */ jsxRuntime.jsxs("p", { className: "fly-empty", "data-probe": "empty", children: [
      notice.message,
      " ",
      "它会按 脑暴 → 设计 → 计划 → 验收设计 → 执行 → 验收 推进，每个阶段过门前都要问过你。"
    ] }) : /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-note-error", "data-probe": "host-error", children: notice.message }),
    tasks.length === 0 ? null : /* @__PURE__ */ jsxRuntime.jsxs("article", { className: "fly-card", "data-probe": "tasks", children: [
      /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "任务" }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "fly-chip-row", children: tasks.map((entry) => /* @__PURE__ */ jsxRuntime.jsx(
        "button",
        {
          className: "fly-btn",
          type: "button",
          "data-task": entry.id,
          "data-selected": entry.id === selected ? "true" : "false",
          onClick: () => {
            setSelected(entry.id);
            void load(entry.id);
          },
          children: `${entry.title === "" ? entry.id : entry.title} · ${PHASE_LABEL[entry.phase] ?? entry.phase}${entry.pendingDecisions != null ? ` · 待裁决 ${entry.pendingDecisions.items}` : entry.awaitingGate === null ? "" : ` · ${entry.awaitingGate}`}${reworkExhausted(entry) ? " · 额度用尽" : ""}`
        },
        entry.id
      )) })
    ] }),
    task === null ? null : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
      task.routes.drifted ? /* @__PURE__ */ jsxRuntime.jsxs("p", { className: "fly-note-error", "data-probe": "route-warning", children: [
        `路由告警：执行报告写的是 ${task.routes.executed ?? "未知路由"}，`,
        `手模型评审记录是 ${hand.length === 0 ? "（无）" : hand.join("、")}。`,
        "设计由一个模型评审、由另一个模型执行 —— 请人工确认这是有意为之。"
      ] }) : null,
      /* @__PURE__ */ jsxRuntime.jsxs("section", { className: "fly-card", "data-probe": "board", children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "阶段板" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "fly-grid", children: BOARD.map((entry) => {
          const status = phaseStatus(entry, task);
          const target = entry.id === "done" ? "summary" : entry.id;
          const artifact = target === "summary" ? task.summary ?? void 0 : task.artifacts[target];
          const consult = task.consults.find((record) => record.phase === entry.id);
          return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "fly-card", "data-phase": entry.id, "data-status": status, children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "fly-chip-row", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", children: entry.gate ?? "—" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-chip", "data-phase-status": status, children: entry.label }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-tag", "data-phase-status": status, children: STATUS_LABEL[status] }),
              entry.id === task.state.phase && pendingDecisionsOf(task) != null ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-tag", "data-chip": "decisions", children: `待裁决 ${pendingDecisionsOf(task)?.items}` }) : null,
              entry.id === task.state.phase && reworkBudgetOf(task.state).used >= reworkBudgetOf(task.state).cap ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "fly-tag", "data-chip": "rework", children: "额度用尽" }) : null
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("dl", { className: "fly-kv", children: [
              /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "产物" }),
              /* @__PURE__ */ jsxRuntime.jsx("dd", { children: artifact === void 0 ? "—" : /* @__PURE__ */ jsxRuntime.jsx(
                "button",
                {
                  className: "fly-btn",
                  type: "button",
                  "data-artifact-jump": entry.id,
                  title: "跳到产物查看器",
                  onClick: () => jump(target),
                  children: `${artifact.file} · ${formatBytes(artifact.bytes)}`
                }
              ) }),
              /* @__PURE__ */ jsxRuntime.jsx("dt", { children: "评审" }),
              /* @__PURE__ */ jsxRuntime.jsx("dd", { children: consult === void 0 ? "—" : formatRoute(consult.provider, consult.model) })
            ] })
          ] }, entry.id);
        }) })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("article", { className: "fly-card", "data-probe": "artifacts", ref: artifactsRef, children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "产物查看器" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "fly-chip-row", children: artifactTabs(task).map((phase) => /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            className: "fly-btn",
            type: "button",
            "data-artifact": phase,
            "data-selected": phase === tab ? "true" : "false",
            "data-focused": phase === jumped ? "true" : "false",
            onClick: () => {
              setTab(phase);
              setJumped(null);
            },
            children: ARTIFACT_LABEL[phase] ?? phase
          },
          phase
        )) }),
        tab !== null && artifactText(task, tab) !== null ? /* @__PURE__ */ jsxRuntime.jsx(MarkdownView, { markdown: artifactText(task, tab) }) : /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-empty", children: "这个任务还没有产物。" })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("article", { className: "fly-card", "data-probe": "gates", children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "门记录" }),
        task.gates.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-empty", children: "还没有任何门记录（每个设计阶段结束时由用户确认）。" }) : /* @__PURE__ */ jsxRuntime.jsxs("table", { className: "fly-table", children: [
          /* @__PURE__ */ jsxRuntime.jsx("thead", { children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "门" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "时间" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "确认人" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "备注" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx("tbody", { children: task.gates.map((record, index) => /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: record.gate ?? "—" }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: formatTime(record.at) }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: record.by ?? "—" }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: record.note === void 0 || record.note === "" ? "—" : record.note })
          ] }, `${record.gate ?? "gate"}-${index}`)) })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("h2", { style: { marginTop: "16px" }, children: "返工历史" }),
        task.history.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-empty", children: "没有被退回重做的产物。" }) : /* @__PURE__ */ jsxRuntime.jsxs("table", { className: "fly-table", children: [
          /* @__PURE__ */ jsxRuntime.jsx("thead", { children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "时间" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "归档产物" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx("tbody", { children: task.history.map((entry) => /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: formatTime(entry.at) }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: `${entry.file} · ${formatBytes(entry.bytes)}` })
          ] }, entry.file)) })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("article", { className: "fly-card", "data-probe": "consults", children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "手模型评审" }),
        task.consults.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-empty", children: "还没有评审记录（每个设计阶段过门前都要请手模型评审一次）。" }) : /* @__PURE__ */ jsxRuntime.jsxs("table", { className: "fly-table", children: [
          /* @__PURE__ */ jsxRuntime.jsx("thead", { children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "阶段" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "时间" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "路由" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "问题" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx("tbody", { children: task.consults.map((record) => /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: record.phase }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: formatTime(record.at) }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { "data-route": formatRoute(record.provider, record.model), children: formatRoute(record.provider, record.model) }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: record.question === "" ? "—" : record.question })
          ] }, record.phase)) })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsxs("article", { className: "fly-card", "data-probe": "evidence", children: [
        /* @__PURE__ */ jsxRuntime.jsx("h2", { children: "验收取证" }),
        task.verifications.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx("p", { className: "fly-empty", children: "还没有取证记录（验收阶段由只读子代理逐条核对验收项）。" }) : /* @__PURE__ */ jsxRuntime.jsxs("table", { className: "fly-table", children: [
          /* @__PURE__ */ jsxRuntime.jsx("thead", { children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "时间" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "证据" }),
            /* @__PURE__ */ jsxRuntime.jsx("th", { children: "路由" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx("tbody", { children: task.verifications.map((row) => /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: formatTime(row.at) }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: `${row.file}${row.missing ? "（文件缺失）" : ""}` }),
            /* @__PURE__ */ jsxRuntime.jsx("td", { children: formatRoute(row.provider, row.model) })
          ] }, row.file)) })
        ] })
      ] })
    ] })
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
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register(
    { name: "sidebar.right.pane.tab", key: PACKAGE, inject: () => ({}) },
    SmartPanel
  )), "fly-smart-panel: drawer body");
}
function SmartMark({ size = 18, active = false }) {
  return /* @__PURE__ */ jsxRuntime.jsxs("svg", { className: "fly-mark", "data-active": active ? "true" : "false", width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M3 6h7M3 12h12M3 18h7", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }),
    /* @__PURE__ */ jsxRuntime.jsx("path", { d: "M18 4v6", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" }),
    /* @__PURE__ */ jsxRuntime.jsx("circle", { cx: "18", cy: "12", r: "2.2", stroke: "currentColor", strokeWidth: "1.6" })
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
