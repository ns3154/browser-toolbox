// SPDX-License-Identifier: GPL-3.0-or-later
import {
  assertSize,
  codeResult,
  divider,
  group,
  inputPane,
  liveResult,
  mountPanes,
  node,
  panel,
  restoreButton,
  resultActions,
  segments,
  t,
} from "./workbench_view.js";

function highlightTable(target, text, delimiter) {
  const newline = text.indexOf("\n");
  const head = newline < 0 ? text : text.slice(0, newline);
  const fragment = document.createDocumentFragment();
  head.split(delimiter).forEach((cell, index) => {
    if (index) fragment.append(node("span", "token-punctuation", delimiter));
    fragment.append(node("span", "token-key", cell));
  });
  if (newline >= 0) fragment.append(text.slice(newline));
  target.append(fragment);
}

export function renderTablePreview(target, rows, metadata) {
  target.replaceChildren();
  if (!rows?.length) return;
  const table = node("table", "table-preview");
  const head = node("thead");
  const body = node("tbody");
  const width = Math.min(metadata.columns, 100);
  rows.forEach((row, index) => {
    const line = node("tr");
    for (let column = 0; column < width; column++) {
      const value = row[column] ?? "";
      const cell = node(index === 0 ? "th" : "td", "", value);
      if (index === 0) cell.scope = "col";
      else if (/^true$/i.test(value)) cell.classList.add("token-string");
      line.append(cell);
    }
    (index === 0 ? head : body).append(line);
  });
  table.append(head, body);
  target.append(table);
  if (metadata.rows > rows.length || metadata.columns > width) {
    target.append(
      node(
        "p",
        "workbench-inline-note",
        t("toolTablePreviewLimited", { rows: rows.length - 1, columns: width }),
      ),
    );
  }
}

export function mountTable(ctx) {
  const formats = new Map([
    ["Markdown", "Markdown"],
    ["Delimited", "TSV"],
    ["Json", "JSON"],
    ["Xml", "XML"],
    ["Mysql", "MySQL"],
    ["Php", "PHP"],
  ]);
  const source = segments(
    "table-input",
    t("toolInput"),
    [["csv", "CSV"], ["tsv", "TSV"]],
    "csv",
    () => {
      updateFormat();
      input.redraw();
      refresh();
    },
  );
  const target = segments("table-output", t("toolOutput"), [...formats], "Markdown", () => {
    updateFormat();
    refresh();
  });
  const arrow = node("span", "table-toolbar-arrow", "→");
  arrow.setAttribute("aria-hidden", "true");
  ctx.toolbar.append(
    group(t("toolInput"), source.element),
    arrow,
    group(t("toolOutput"), target.element),
    node("span", "workbench-toolbar-note", t("toolTableHint")),
  );
  const delimited = () => source.value === "csv" ? "Tsv" : "Csv";
  const format = () => target.value === "Delimited" ? delimited() : target.value;
  const input = inputPane(ctx, {
    title: t("toolInput"),
    accept: ".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain",
    highlight: (element, value) =>
      highlightTable(element, value, source.value === "csv" ? "," : "\t"),
    onFile(file) {
      if (/\.tsv$/i.test(file.name)) source.set("tsv");
      else if (/\.csv$/i.test(file.name)) source.set("csv");
      updateFormat();
    },
  });
  const view = segments(
    "table-view",
    t("toolWorkbenchView"),
    [
      ["source", t("toolTableSource")],
      ["preview", t("toolTablePreview")],
    ],
    "preview",
    updateView,
  );
  const outputActions = resultActions(ctx, {
    download: () => {
      const extensions = {
        Markdown: "md",
        Csv: "csv",
        Tsv: "tsv",
        Json: "json",
        Xml: "xml",
        Mysql: "sql",
        Php: "php",
      };
      return { name: `browser-toolbox-table.${extensions[format()]}` };
    },
  });
  const result = panel(t("toolConversionResult"), {
    id: "tool-result-workspace",
    result: true,
    actions: [view.element, divider(), ...outputActions.buttons],
  });
  const code = codeResult(result.heading.id);
  const preview = node("div", "table-preview-scroll");
  preview.id = "table-preview";
  preview.tabIndex = 0;
  preview.setAttribute("aria-labelledby", result.heading.id);
  result.element.append(code.element, preview);
  mountPanes(ctx, input, result);

  function updateView() {
    preview.hidden = view.value !== "preview";
    code.element.hidden = !preview.hidden;
  }

  function updateFormat() {
    target.buttons.get("Delimited").textContent = delimited().toUpperCase();
    input.detail.textContent = source.value.toUpperCase();
    result.detail.textContent = target.buttons.get(target.value).textContent;
  }

  function showResult(converted) {
    code.set(converted?.output ?? "");
    outputActions.set(converted?.output ?? "");
    const metadata = converted?.metadata;
    renderTablePreview(preview, converted?.preview, metadata);
    const warnings = [
      metadata?.formulaCells
        ? t("toolTableFormulaCount", { count: metadata.formulaCells }) + " " +
          t("toolFormulaWarning")
        : "",
      format() === "Mysql" ? t("toolSqlWarning") : "",
    ].filter(Boolean);
    ctx.status(warnings.join(" · "), { warning: warnings.length > 0 });
    ctx.stats(
      "UTF-8",
      metadata && t("toolTableDimensions", { rows: metadata.rows - 1, columns: metadata.columns }),
    );
  }
  const refresh = liveResult(
    () => {
      const value = input.input.value;
      assertSize(ctx, value);
      if (value === "") return null;
      return ctx.implementation.run({
        input: value,
        options: { mode: `${source.value}To${format()}`, includePreview: true },
      });
    },
    showResult,
    (error) => {
      showResult(null);
      ctx.status(t(error.messageKey || "toolInvalid"), { error: true });
    },
    () => outputActions.set(""),
  );
  input.input.addEventListener("input", () => refresh(150));
  restoreButton(() => {
    source.set("csv");
    target.set("Markdown");
    view.set("preview");
    updateView();
    updateFormat();
    input.set([
      "tool,category,local_only",
      `${t("toolJsonFormat")},developer,true`,
      `${t("toolCodecTransform")},developer,true`,
      `${t("toolTextDiff")},text,true`,
      `${t("toolIdGenerate")},generate,true`,
    ].join("\n"));
  });
  updateView();
  updateFormat();
  return { input, refresh };
}
