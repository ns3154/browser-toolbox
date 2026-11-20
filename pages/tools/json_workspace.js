// SPDX-License-Identifier: GPL-3.0-or-later
import {
  action,
  assertSize,
  codeResult,
  divider,
  group,
  inputPane,
  labelAction,
  liveResult,
  mountPanes,
  node,
  panel,
  restoreButton,
  resultActions,
  segments,
  selectControl,
  t,
} from "./workbench_view.js";

const formatter = globalThis.BrowserToolboxDocumentFormatters;
const MAX_VISIBLE_NODES = 3000;

function highlightJson(target, source) {
  const tokens = /"(?:\\.|[^"\\])*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const keySuffix = /\s*:/y;
  const fragment = document.createDocumentFragment();
  let end = 0;
  for (const match of source.matchAll(tokens)) {
    const [value] = match;
    fragment.append(source.slice(end, match.index));
    end = match.index + value.length;
    keySuffix.lastIndex = end;
    const type = value.startsWith('"')
      ? (keySuffix.test(source) ? "key" : "string")
      : /^[tfn]/.test(value)
      ? "literal"
      : "number";
    fragment.append(node("span", `token-${type}`, value));
  }
  fragment.append(source.slice(end));
  target.append(fragment);
}

function nodeCountLabel(value) {
  if (value.kind === "object") return t("toolJsonFieldCount", { count: value.entries.length });
  if (value.kind === "array") return t("toolJsonItemCount", { count: value.items.length });
  return t("toolJsonValue");
}

function entriesFor(value, sortOrder) {
  if (value.kind === "array") return value.items.map((item, index) => ({ value: item, index }));
  const entries = value.entries.map((entry, index) => ({ ...entry, index }));
  if (sortOrder === "original") return entries;
  const direction = sortOrder === "descending" ? -1 : 1;
  return entries.sort((a, b) => direction * formatter.compareCodePoints(a.keyValue, b.keyValue));
}

function displayTree(tree, root, options, collapse, ctx) {
  let visible = 0;
  function branch(value, path, key, comma) {
    const hasChildren = Boolean(value.entries?.length || value.items?.length);
    const collapsed = hasChildren && collapse.closed(path);
    const element = node("div", "json-branch");
    const row = node("div", "json-row");
    if (key) row.dataset.jsonKey = key.value;
    if (hasChildren) {
      const toggle = action(collapsed ? "toolExpandNode" : "toolCollapseNode", {
        glyph: "chevron",
        run: () => collapse.toggle(path),
      });
      toggle.className = "json-toggle";
      toggle.dataset.path = path;
      toggle.setAttribute("aria-expanded", String(!collapsed));
      row.append(toggle);
    } else row.append(node("span", "json-gutter-slot"));

    const text = node("span", "json-row-text");
    if (key) text.append(node("span", "token-key", key.raw), ": ");
    const opening = value.kind === "object" ? "{" : "[";
    const closing = value.kind === "object" ? "}" : "]";
    if (hasChildren) {
      text.append(node("span", "json-punctuation", collapsed ? `${opening}…${closing}` : opening));
      if (collapsed && comma) text.append(",");
      text.append(node("span", "json-node-count", nodeCountLabel(value)));
    } else {
      text.append(node("span", `token-${value.kind}`, value.raw ?? opening + closing));
      if (comma) text.append(",");
    }
    const copy = action("toolCopyNode", {
      glyph: "copy",
      run: () => ctx.copy(formatter.renderJsonNode(value, 0, options)),
    });
    copy.classList.add("json-copy-node");
    row.append(text, copy);
    element.append(row);

    if (hasChildren && !collapsed) {
      const children = node("div", "json-children");
      const entries = entriesFor(value, options.sortOrder);
      for (const [position, entry] of entries.entries()) {
        if (visible >= MAX_VISIBLE_NODES) break;
        visible++;
        children.append(branch(
          entry.value,
          `${path}.${entry.index}`,
          entry.key && { ...entry.key, value: entry.keyValue },
          position < entries.length - 1,
        ));
      }
      const end = node("div", "json-closing");
      end.append(
        node("span", "json-gutter-slot"),
        node("span", "json-punctuation", closing + (comma ? "," : "")),
      );
      element.append(children, end);
    }
    return element;
  }
  tree.replaceChildren();
  if (root) tree.append(branch(root, "root"));
  if (visible >= MAX_VISIBLE_NODES) {
    tree.append(node("p", "workbench-inline-note", t("toolJsonTreeLimited")));
  }
}

export function mountJson(ctx) {
  const { descriptor } = ctx;
  const control = (key) => descriptor.controls.find((item) => item.key === key);
  const choices = (key) => control(key).options.map(([id, label]) => [id, t(label)]);
  const mode = segments(
    "json-mode",
    t("toolMode"),
    choices("operation").filter(([id]) => id === "format" || id === "compact"),
    control("operation").defaultValue,
    () => refresh(),
  );
  const indent = selectControl(
    t("toolIndent"),
    choices("indent"),
    control("indent").defaultValue,
    "json-indent",
  );
  const sort = selectControl(
    t("toolJsonKeySort"),
    choices("sortOrder"),
    control("sortOrder").defaultValue,
    "json-sort",
  );
  const expand = action("toolJsonExpandEscaped", {
    id: "json-expand-escaped",
    run: () => {
      expand.setAttribute("aria-pressed", String(expand.getAttribute("aria-pressed") !== "true"));
      refresh();
    },
  });
  expand.setAttribute("aria-pressed", "false");
  const repair = action("toolRepair", {
    id: "json-repair",
    run: () => {
      const candidate = formatter.repairMojibake(input.input.value);
      if (!candidate.changed) {
        ctx.toast(t("toolJsonRepairNone"));
        return;
      }
      if (
        globalThis.confirm(
          `${t("toolRepairConfirm")}\n\n${candidate.previewBefore}\n→\n${candidate.previewAfter}`,
        )
      ) {
        input.set(candidate.value);
        refresh();
      }
    },
  });
  ctx.toolbar.append(
    group(t("toolMode"), mode.element),
    divider(),
    group(t("toolIndent"), indent),
    group(t("toolJsonKeySort"), sort),
    divider(),
    expand,
    repair,
    node("span", "workbench-toolbar-note", t("toolJsonLiveCheck")),
  );
  const input = inputPane(ctx, {
    title: t("toolJsonInput"),
    subtitle: t("toolJsonLiveCheckShort"),
    placeholder: "toolJsonInputHint",
    highlight: highlightJson,
    accept: ".json,.txt,text/plain,application/json",
  });

  const outputActions = resultActions(ctx, {
    download: () => ({
      name: `browser-toolbox-${Date.now()}.json`,
      mime: "application/json;charset=utf-8",
    }),
  });
  const view = segments(
    "json-view",
    t("toolWorkbenchView"),
    [["tree", t("toolJsonTree")], ["source", t("toolJsonSource")]],
    "tree",
    showView,
  );
  let collapseByDefault = false;
  const changedPaths = new Set();
  const collapse = {
    closed: (path) => collapseByDefault !== changedPaths.has(path),
    toggle(path) {
      if (!changedPaths.delete(path)) changedPaths.add(path);
      redrawTree();
      tree.querySelector(`[data-path="${path}"]`)?.focus();
    },
  };
  const fold = action("toolCollapseAll", {
    id: "json-fold-all",
    glyph: "compress",
    run: () => {
      collapseByDefault = Boolean(tree.querySelector('button[aria-expanded="true"]'));
      changedPaths.clear();
      redrawTree();
    },
  });
  const separator = divider();
  const result = panel(t("toolJsonOutput"), {
    id: "tool-result-workspace",
    result: true,
    actions: [view.element, separator, fold, ...outputActions.buttons],
  });
  const tree = node("div", "json-tree");
  tree.id = "json-result-tree";
  tree.tabIndex = 0;
  tree.setAttribute("aria-labelledby", result.heading.id);
  const raw = codeResult(result.heading.id);
  result.element.append(tree, raw.element);
  mountPanes(ctx, input, result);

  let lastResult;
  let inputMetrics = { characters: 0, bytes: 0 };
  const options = () => ({
    operation: mode.value,
    sortOrder: sort.value,
    indent: indent.value,
    expandEscaped: expand.getAttribute("aria-pressed") === "true",
  });
  function showView() {
    tree.hidden = fold.hidden = separator.hidden = view.value !== "tree";
    raw.element.hidden = !tree.hidden;
    if (!tree.hidden) redrawTree();
    updateSubtitle();
  }
  function updateSubtitle() {
    result.detail.textContent = lastResult && view.value === "tree"
      ? `${t("toolJsonTreeLabel")} · ${nodeCountLabel(lastResult.root)}`
      : "";
  }
  function redrawTree() {
    if (tree.hidden) return;
    displayTree(
      tree,
      lastResult?.root,
      {
        sortOrder: sort.value,
        indent: indent.value === "tab" ? "\t" : " ".repeat(Number(indent.value)),
        compact: mode.value === "compact",
      },
      collapse,
      ctx,
    );
    fold.disabled = !lastResult || !tree.querySelector(".json-toggle");
    const expanded = tree.querySelector('button[aria-expanded="true"]');
    labelAction(
      fold,
      expanded ? "toolCollapseAll" : "toolExpandAll",
      expanded ? "compress" : "expand",
    );
  }
  function updateSummary() {
    const before = input.input.value.slice(0, input.input.selectionStart).split("\n");
    const metadata = lastResult?.metadata;
    ctx.stats(
      t("toolJsonCursor", { line: before.length, column: before.at(-1).length + 1 }),
      t("toolJsonCharacterCount", { count: inputMetrics.characters }),
      `${inputMetrics.bytes} B`,
      metadata && `${
        t(
          {
            array: "toolJsonArray",
            object: "toolJsonObject",
            string: "toolJsonStringType",
            number: "toolJsonNumberType",
            literal: lastResult.root.raw === "null" ? "toolJsonNullType" : "toolJsonBooleanType",
          }[metadata.rootType],
        )
      } · ${t("toolJsonDepth")} ${metadata.maxDepth + 1}`,
    );
  }
  function apply(next) {
    lastResult = next;
    if (next) inputMetrics = next.metadata;
    outputActions.set(next?.output ?? "");
    raw.set(next?.output ?? "", highlightJson);
    redrawTree();
    updateSubtitle();
    updateSummary();
    const duplicates = next?.metadata.duplicateKeys;
    ctx.status(
      next
        ? t(duplicates ? "toolJsonValidDuplicates" : "toolJsonValid", { count: duplicates })
        : "",
      { ok: Boolean(next) },
    );
  }
  const refresh = liveResult(
    () => {
      const value = input.input.value;
      assertSize(ctx, value);
      if (!value.trim()) return null;
      return ctx.implementation.run({ input: value, options: options(), state: {} });
    },
    apply,
    (error) => {
      apply(null);
      const label = error.messageKey ||
        (error.exceededBudget || error.name === "FormatterBudgetError"
          ? "toolJsonBudget"
          : error.line
          ? "toolJsonErrorPosition"
          : "toolInvalid");
      ctx.status(t(label, error), { error: true });
    },
    () => outputActions.set(""),
  );

  input.input.addEventListener("input", () => {
    const value = input.input.value;
    let characters = 0;
    for (const _ of value) characters++;
    inputMetrics = { characters, bytes: globalThis.BrowserToolboxToolRuntime.byteLength(value) };
    repair.disabled = !value.trim();
    updateSummary();
    refresh(150);
  });
  input.input.addEventListener("selectionchange", updateSummary);
  for (const control of [indent, sort]) control.addEventListener("change", () => refresh());
  restoreButton(() => {
    input.set(JSON.stringify(
      {
        app: t("browserToolbox"),
        version: chrome.runtime.getManifest().version,
        localOnly: true,
        maxBytes: descriptor.maxInputBytes,
        tools: [t(descriptor.titleKey), t("toolCodecTransform")],
      },
      null,
      2,
    ));
  });
  repair.disabled = true;
  showView();
  return { input, refresh };
}
