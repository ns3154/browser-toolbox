// SPDX-License-Identifier: GPL-3.0-or-later
import {
  action,
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
  selectControl,
  t,
} from "./workbench_view.js";

function highlightConfig(target, source, properties) {
  const fragment = document.createDocumentFragment();
  const entry = properties
    ? /^(\s*)((?:\\.|[^=:\s\\])+)([ \t]*(?:[=:][ \t]*|[ \t]+))(.*)$/
    : /^(\s*(?:-\s+)?)(.*?)(:\s+|:$)(.*)$/;
  source.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (index) fragment.append("\n");
    if ((properties ? /^\s*[#!]/ : /^\s*#/).test(line)) {
      fragment.append(node("span", "token-comment", line));
      return;
    }
    const match = entry.exec(line);
    if (!match) {
      fragment.append(line);
      return;
    }
    const [, space, key, separator, value] = match;
    fragment.append(
      space,
      node("span", "token-key", key),
      node("span", "token-punctuation", separator),
      properties || /^["']/.test(value) ? node("span", "token-string", value) : value,
    );
  });
  target.append(fragment);
}

export function mountConfig(ctx) {
  const direction = segments(
    "config-direction",
    t("toolConfigDirection"),
    [
      ["propertiesToYaml", t("toolConfigForward")],
      ["yamlToProperties", t("toolConfigReverse")],
    ],
    "propertiesToYaml",
    () => {
      updateDirection();
      refresh();
    },
  );
  const toYaml = () => direction.value === "propertiesToYaml";
  const indent = selectControl(
    t("toolIndent"),
    [
      ["2", t("toolIndent2")],
      ["4", t("toolIndent4")],
    ],
    "2",
    "config-indent",
  );
  indent.addEventListener("change", () => refresh());
  ctx.toolbar.append(
    group(t("toolConfigDirection"), direction.element),
    divider(),
    group(t("toolIndent"), indent),
    node("span", "workbench-toolbar-note", t("toolConfigShortHint")),
  );

  let filename = "";
  const input = inputPane(ctx, {
    title: t("toolInput"),
    highlight: (target, source) => highlightConfig(target, source, toYaml()),
    accept: ".properties,.yaml,.yml,.txt,text/plain,application/yaml,text/yaml",
    async readFile(file) {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch (_) {
        throw Object.assign(new Error(), { messageKey: "toolConfigEncoding" });
      }
    },
    onFile(file) {
      if (/\.ya?ml$/i.test(file.name)) direction.set("yamlToProperties");
      else if (/\.properties$/i.test(file.name)) direction.set("propertiesToYaml");
      filename = file.name;
      updateDirection();
    },
  });
  let output = "";
  const swap = action("toolConfigRefill", {
    id: "config-swap",
    glyph: "swap",
    run: () => {
      direction.set(toYaml() ? "yamlToProperties" : "propertiesToYaml");
      updateDirection();
      input.set(output);
      refresh();
    },
  });
  swap.disabled = true;
  const resultButtons = resultActions(ctx, {
    download: () => {
      const base = filename.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_") || "application";
      return toYaml()
        ? { name: `${base}.yaml`, mime: "application/yaml;charset=utf-8" }
        : { name: `${base}.properties` };
    },
  });
  const result = panel(t("toolConversionResult"), {
    id: "tool-result-workspace",
    result: true,
    actions: [swap, ...resultButtons.buttons],
  });
  const code = codeResult(result.heading.id);
  result.element.append(code.element);
  mountPanes(ctx, input, result);

  function updateDirection() {
    input.detail.textContent = toYaml() ? t("toolConfigNameProperties") : t("toolConfigNameYaml");
    result.detail.textContent = toYaml() ? t("toolConfigNameYaml") : t("toolConfigNameProperties");
    input.input.placeholder = t(toYaml() ? "toolConfigPropertiesHint" : "toolConfigYamlHint");
    indent.disabled = !toYaml();
    input.redraw();
  }

  const refresh = liveResult(() => {
    const value = input.input.value;
    assertSize(ctx, value);
    if (!value.trim()) return null;
    return ctx.implementation.run({
      input: value,
      options: { direction: direction.value, indent: Number(indent.value) },
    });
  }, (converted) => {
    output = converted?.output ?? "";
    code.set(
      output.replace(/\n$/, ""),
      (target, source) => highlightConfig(target, source, !toYaml()),
    );
    swap.disabled = !output;
    resultButtons.set(output);
    const metadata = converted?.metadata;
    ctx.status(
      metadata
        ? t("toolConfigStats", { count: metadata.count, comments: metadata.commentLines })
        : "",
      {
        ok: Boolean(metadata),
      },
    );
    ctx.stats(
      "UTF-8",
      metadata &&
        t("toolConfigLineSummary", { input: metadata.inputLines, output: metadata.outputLines }),
    );
  }, (error) => {
    code.set("");
    const detail = t(error.messageKey || "toolConfigYamlSyntax");
    ctx.status(
      error.line
        ? t("toolConfigErrorLocation", {
          line: error.line,
          column: error.column || 1,
          message: detail,
        })
        : detail,
      { error: true },
    );
    ctx.stats("UTF-8");
  }, () => {
    swap.disabled = true;
    resultButtons.set("");
  });
  input.input.addEventListener("input", () => refresh(150));
  restoreButton(() => {
    filename = "";
    direction.set("propertiesToYaml");
    updateDirection();
    input.set([
      `# ${t("toolConfigExampleComment")}`,
      "server.port=8080",
      "spring.application.name=browser-toolbox",
      "logging.level.root=INFO",
      "features.local-only=true",
    ].join("\n"));
  });
  updateDirection();
  return { input, refresh };
}
