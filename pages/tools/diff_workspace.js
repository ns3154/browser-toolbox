// SPDX-License-Identifier: GPL-3.0-or-later
import {
  action,
  assertSize,
  countLines,
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
  t,
} from "./workbench_view.js";

export function diffBlocks(entries) {
  const blocks = [];
  let change;
  for (const entry of entries) {
    if (entry.type === "same") {
      blocks.push({ same: entry });
      change = null;
    } else {
      if (!change) {
        change = { remove: [], add: [] };
        blocks.push(change);
      }
      change[entry.type].push(entry);
    }
  }
  return blocks;
}

function characterEdges(oldText, newText) {
  if (!oldText || !newText) return { prefix: "", oldText, newText, suffix: "" };
  const size = Math.min(oldText.length, newText.length);
  let start = 0;
  let end = 0;
  while (start < size && oldText[start] === newText[start]) start++;
  while (end < size - start && oldText.at(-end - 1) === newText.at(-end - 1)) end++;
  // 首尾边界不能切在一个 Unicode 代理对中间。
  const isLowSurrogate = (char) => /[\uDC00-\uDFFF]/.test(char);
  if (start && (isLowSurrogate(oldText[start]) || isLowSurrogate(newText[start]))) start--;
  if (end && isLowSurrogate(oldText.at(-end))) end--;
  if (start + end < 2 && oldText.length !== newText.length) {
    return { prefix: "", oldText, newText, suffix: "" };
  }
  return {
    prefix: oldText.slice(0, start),
    suffix: end ? oldText.slice(-end) : "",
    oldText: oldText.slice(start, oldText.length - end),
    newText: newText.slice(start, newText.length - end),
  };
}

export function markDiffPair(oldText, newText) {
  const oldLine = node("code");
  const newLine = node("code");
  function markDifference(before, after) {
    const changed = characterEdges(before, after);
    oldLine.append(changed.prefix);
    newLine.append(changed.prefix);
    if (changed.oldText) oldLine.append(node("mark", "", changed.oldText));
    if (changed.newText) newLine.append(node("mark", "", changed.newText));
    oldLine.append(changed.suffix);
    newLine.append(changed.suffix);
  }
  // 保留整词锚点，并细化到同一词内部。长行只比较首尾，避免额外平方开销。
  if (oldText.length + newText.length > 1000) {
    markDifference(oldText, newText);
    return [oldLine, newLine];
  }
  const words = (text) => text.match(/[\p{L}\p{M}\p{N}_]+|\s+|[^\s]/gu) || [];
  const left = words(oldText);
  const right = words(newText);
  if (left.length * right.length > 6000) {
    markDifference(oldText, newText);
    return [oldLine, newLine];
  }
  const blocks = diffBlocks(globalThis.BrowserToolboxDiffTool.compareSequences(left, right));
  for (const block of blocks) {
    if (block.same) {
      oldLine.append(block.same.text);
      newLine.append(block.same.text);
    } else {
      markDifference(
        block.remove.map(({ text }) => text).join(""),
        block.add.map(({ text }) => text).join(""),
      );
    }
  }
  return [oldLine, newLine];
}

function lineNumber(number) {
  return node("span", "diff-number", String(number ?? ""));
}

const symbols = { same: "", remove: "−", add: "+" };

function diffRow(entry, code = node("code", "", entry.text)) {
  const row = node("div", `diff-line diff-${entry.type}`);
  row.append(
    lineNumber(entry.leftLine),
    lineNumber(entry.rightLine),
    node("span", "diff-marker", symbols[entry.type]),
    code,
  );
  return row;
}

function sideCell(entry, number, code) {
  const cell = node("div", `diff-cell ${entry ? `diff-${entry.type}` : "diff-spacer"}`);
  cell.append(
    lineNumber(number),
    node("span", "diff-marker", entry ? symbols[entry.type] : ""),
    code ?? node("code", "", entry?.text ?? ""),
  );
  return cell;
}

function sideRow(left, right, oldCode, newCode) {
  const row = node("div", "diff-side-line");
  row.append(sideCell(left, left?.leftLine, oldCode), sideCell(right, right?.rightLine, newCode));
  return row;
}

function renderDiff(container, blocks, sideBySide, onlyChanges) {
  const fragment = document.createDocumentFragment();
  const labels = node("div", "diff-labels");
  if (sideBySide) {
    labels.classList.add("diff-side-labels");
    labels.append(node("span", "", t("toolDiffOriginal")), node("span", "", t("toolDiffModified")));
  } else {
    labels.append(
      node("span", "", t("toolDiffOldLine")),
      node("span", "", t("toolDiffNewLine")),
      node("span"),
      node("span", "", t("toolDiffContents")),
    );
  }
  fragment.append(labels);
  for (const block of blocks) {
    if (block.same) {
      if (!onlyChanges) {
        fragment.append(sideBySide ? sideRow(block.same, block.same) : diffRow(block.same));
      }
      continue;
    }
    const oldRows = [];
    const newRows = [];
    for (let index = 0; index < Math.max(block.remove.length, block.add.length); index++) {
      const left = block.remove[index];
      const right = block.add[index];
      const [oldCode, newCode] = left && right ? markDiffPair(left.text, right.text) : [];
      if (sideBySide) fragment.append(sideRow(left, right, oldCode, newCode));
      else {
        if (left) oldRows.push(diffRow(left, oldCode));
        if (right) newRows.push(diffRow(right, newCode));
      }
    }
    fragment.append(...oldRows, ...newRows);
  }
  container.replaceChildren(fragment);
}

export function mountDiff(ctx) {
  const views = segments(
    "diff-view",
    t("toolWorkbenchView"),
    [
      ["unified", t("toolDiffUnified")],
      ["side", t("toolDiffSideBySide")],
    ],
    "unified",
    updateResults,
  );
  const only = action("toolDiffOnlyChanges", {
    id: "diff-only-changes",
    run: () => {
      only.setAttribute("aria-pressed", String(!onlyChanges()));
      updateResults();
    },
  });
  only.setAttribute("aria-pressed", "false");
  const onlyChanges = () => only.getAttribute("aria-pressed") === "true";
  const swap = action("toolDiffSwap", {
    id: "diff-swap",
    glyph: "swap",
    run: () => {
      const original = left.input.value;
      left.set(right.input.value);
      right.set(original);
      refresh();
    },
  });
  const fold = action("toolDiffCollapseInput", {
    id: "diff-fold-input",
    glyph: "chevronUp",
    run: () => {
      inputs.hidden = !inputs.hidden;
      fold.setAttribute("aria-expanded", String(!inputs.hidden));
      labelAction(
        fold,
        inputs.hidden ? "toolDiffExpandInput" : "toolDiffCollapseInput",
        inputs.hidden ? "chevron" : "chevronUp",
      );
    },
  });
  fold.classList.add("workbench-toolbar-end");
  fold.setAttribute("aria-expanded", "true");
  fold.setAttribute("aria-controls", "diff-inputs");
  ctx.toolbar.append(group(t("toolWorkbenchView"), views.element), only, swap, fold);
  const left = inputPane(ctx, { title: t("toolDiffOriginal") });
  const right = inputPane(ctx, { id: "tool-input-right", title: t("toolDiffModified") });
  const inputs = mountPanes(ctx, left, right);
  inputs.id = "diff-inputs";

  const resultButtons = resultActions(ctx, { copyKey: "toolDiffCopy" });
  const result = panel(t("toolDiffPanel"), {
    id: "tool-result-workspace",
    result: true,
    actions: resultButtons.buttons,
  });
  const added = node("span", "diff-badge diff-add");
  const removed = node("span", "diff-badge diff-remove");
  result.detail.after(added, removed);
  const list = node("div", "diff-list");
  list.id = "diff-result-list";
  list.tabIndex = 0;
  list.setAttribute("aria-labelledby", result.heading.id);
  result.element.append(list);
  ctx.footer.before(result.element);
  let blocks = [];
  let metadata;

  function updateResults() {
    left.detail.textContent = t("toolWorkbenchLines", { count: countLines(left.input.value) });
    right.detail.textContent = t("toolWorkbenchLines", { count: countLines(right.input.value) });
    const changes = blocks.filter((block) => !block.same);
    const additions = changes.reduce((count, block) => count + block.add.length, 0);
    const removals = changes.reduce((count, block) => count + block.remove.length, 0);
    result.detail.textContent = metadata ? t("toolDiffChanges", { count: changes.length }) : "";
    added.hidden = removed.hidden = !metadata;
    added.textContent = t("toolDiffAdded", { count: additions });
    removed.textContent = t("toolDiffRemoved", { count: removals });
    renderDiff(list, blocks, views.value === "side", onlyChanges());
    const lines = blocks.flatMap((block) =>
      block.same ? (onlyChanges() ? [] : [`  ${block.same.text}`]) : [
        ...block.remove.map(({ text }) => `- ${text}`),
        ...block.add.map(({ text }) => `+ ${text}`),
      ]
    );
    resultButtons.set(lines.join("\n"));
    ctx.stats(
      metadata &&
        t("toolDiffStats", {
          left: metadata.leftLines,
          right: metadata.rightLines,
          count: lines.length,
        }),
    );
  }
  const refresh = liveResult(() => {
    const input = left.input.value;
    const rightInput = right.input.value;
    assertSize(ctx, input);
    assertSize(ctx, rightInput);
    return input || rightInput ? ctx.implementation.run({ input, rightInput }) : null;
  }, (diff) => {
    blocks = diffBlocks(diff?.entries ?? []);
    metadata = diff?.metadata;
    updateResults();
    ctx.status(metadata ? t("toolDiffMethod") : "");
  }, (error) => {
    blocks = [];
    metadata = null;
    updateResults();
    ctx.status(t(error.messageKey || "toolInvalid", error), { error: true });
  }, () => resultButtons.set(""));
  for (const { input } of [left, right]) input.addEventListener("input", () => refresh(150));
  restoreButton(() => {
    const title = `title = ${t("browserToolbox")}`;
    const rest = [`locale = ${document.documentElement.lang}`, "local-only = true"];
    left.set([title, "theme = default", ...rest].join("\n"));
    right.set([title, "theme = sage-mist", ...rest, "start-page = tools"].join("\n"));
  });
  return { input: left, refresh };
}
