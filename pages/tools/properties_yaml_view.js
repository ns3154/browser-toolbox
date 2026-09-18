// SPDX-License-Identifier: GPL-3.0-or-later
// 配置页复用共享输入、文件和结果控件，布局与 JSON 工作台保持一致。
(function () {
  function create({ message, icon, onDirectionChange, onSwap, onIndentChange }) {
    const byId = (id) => document.getElementById(id);
    const element = (tag, className = "", text = "") => {
      const node = document.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };
    let direction = "propertiesToYaml";
    const heading = document.querySelector(".browser-toolbox-tool-heading");
    const divider = element("span", "config-brand-divider");
    divider.setAttribute("aria-hidden", "true");
    heading.replaceChildren(
      byId("tool-icon"),
      document.querySelector(".browser-toolbox-eyebrow"),
      divider,
      byId("tool-title"),
    );
    const input = byId("tool-input");
    const controls = byId("tool-controls");
    const directions = element("div", "config-directions");
    directions.setAttribute("role", "group");
    directions.setAttribute("aria-label", message("toolConfigDirection"));
    const directionButtons = new Map();
    for (
      const [value, label] of [
        ["propertiesToYaml", "Properties → YAML"],
        ["yamlToProperties", "YAML → Properties"],
      ]
    ) {
      const button = element("button", "config-direction", label);
      button.type = "button";
      button.dataset.direction = value;
      button.addEventListener("click", () => {
        if (direction === value) return;
        setDirection(value);
        onDirectionChange();
      });
      directionButtons.set(value, button);
      directions.append(button);
    }
    const swap = element("button", "browser-toolbox-icon-button config-text-button");
    swap.type = "button";
    swap.id = "config-swap";
    swap.title = message("toolConfigSwapHint");
    swap.append(icon("swap"), element("span", "", message("toolConfigSwap")));
    swap.addEventListener("click", onSwap);
    controls.replaceChildren(directions, swap);
    byId("tool-run").textContent = message("toolConvert");
    byId("tool-restore").hidden = true;

    const inputPanel = element("section", "config-input-panel");
    inputPanel.setAttribute("aria-labelledby", "tool-input-title");
    const inputHeading = element("div", "config-panel-heading");
    const inputLabel = element("div", "config-panel-label");
    const inputKind = element("span", "config-kind", message("toolInput"));
    inputKind.id = "config-input-kind";
    inputLabel.append(byId("tool-input-title"), inputKind);
    const filePicker = document.querySelector(".browser-toolbox-tool-file");
    byId("tool-file-trigger").replaceChildren(
      icon("document"),
      element("span", "", message("toolFileChoose")),
    );
    byId("tool-file").accept = ".properties,.yaml,.yml,.txt,text/plain,application/yaml,text/yaml";
    byId("tool-file-name").hidden = true;
    inputHeading.append(inputLabel, filePicker);
    const inputGrid = document.querySelector(".browser-toolbox-tool-input-grid");
    inputGrid.before(inputPanel);
    inputPanel.append(inputHeading, inputGrid);
    input.setAttribute("aria-labelledby", "tool-input-title config-input-kind");
    input.setAttribute("wrap", "off");

    const resultHeading = document.querySelector(".browser-toolbox-result-heading");
    const resultLabel = element("div", "config-panel-label");
    resultLabel.append(
      byId("tool-output-title"),
      element("span", "config-kind", message("toolOutput")),
    );
    const resultActions = element("div", "config-result-actions");
    const indent = element("select", "config-indent");
    indent.id = "config-indent";
    indent.setAttribute("aria-label", message("toolIndent"));
    for (const size of [2, 4]) {
      const option = element("option", "", message(`toolIndent${size}`));
      option.value = String(size);
      indent.append(option);
    }
    indent.addEventListener("change", onIndentChange);
    for (
      const [id, iconName, labelKey] of [
        ["tool-copy", "copy", "toolConfigCopy"],
        ["tool-download", "download", "toolDownloadShort"],
      ]
    ) {
      const button = byId(id);
      button.classList.add("config-text-button");
      button.replaceChildren(icon(iconName), element("span", "", message(labelKey)));
      resultActions.append(button);
    }
    resultActions.prepend(indent);
    resultHeading.replaceChildren(resultLabel, resultActions);
    const outputEditor = element("div", "config-output-editor");
    const outputLines = element("div", "config-output-lines");
    outputLines.setAttribute("aria-hidden", "true");
    const output = byId("tool-output");
    output.setAttribute("aria-labelledby", "tool-output-title");
    output.dataset.placeholder = message("toolConfigOutputHint");
    output.before(outputEditor);
    outputEditor.append(outputLines, output);
    output.addEventListener("scroll", () => {
      outputLines.scrollTop = output.scrollTop;
    });
    const summary = element("span", "config-summary");
    summary.id = "config-summary";
    const note = element("p", "config-note", message("toolConfigSemantics"));
    const footer = document.querySelector(".browser-toolbox-tool-footer");
    footer.append(summary, note);

    function renderCode(target, text, format) {
      target.replaceChildren();
      if (text.length > 80000) {
        target.textContent = text;
        return;
      }
      const fragment = document.createDocumentFragment();
      const sourceLines = text.replace(/\r\n|\r/g, "\n").split("\n");
      sourceLines.forEach((line, index) => {
        if (index) fragment.append(document.createTextNode("\n"));
        if (/^\s*[#!]/.test(line)) fragment.append(element("span", "config-token-comment", line));
        else {
          const match = format === "properties"
            ? /^(\s*)(.*?)([=:])(.*)$/.exec(line)
            : /^(\s*(?:-\s+)?)(.*?)(:\s+|:$)(.*)$/.exec(line);
          if (match) {
            fragment.append(
              document.createTextNode(match[1]),
              element("span", "config-token-key", match[2]),
              document.createTextNode(match[3]),
              element("span", "config-token-value", match[4]),
            );
          } else fragment.append(document.createTextNode(line));
        }
      });
      target.append(fragment);
    }

    function updateInput() {
      const highlight = byId("json-input-highlight");
      const gutter = byId("json-input-line-numbers");
      const count = input.value.length > 80000
        ? 0
        : input.value.replace(/\r\n|\r/g, "\n").split("\n").length;
      const plain = input.value.length > 80000 || count > 5000;
      input.classList.toggle("config-plain-input", plain);
      if (plain) {
        highlight.textContent = "";
        gutter.textContent = "";
        return;
      }
      gutter.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
      renderCode(
        highlight,
        input.value + (input.value.endsWith("\n") ? " " : ""),
        direction === "propertiesToYaml" ? "properties" : "yaml",
      );
      syncScroll();
    }

    function syncScroll() {
      byId("json-input-highlight").scrollTop = input.scrollTop;
      byId("json-input-highlight").scrollLeft = input.scrollLeft;
      byId("json-input-line-numbers").scrollTop = input.scrollTop;
    }
    input.addEventListener("scroll", syncScroll);

    function setDirection(value) {
      direction = value;
      for (const [key, button] of directionButtons) {
        button.setAttribute("aria-pressed", String(key === value));
      }
      const toYaml = value === "propertiesToYaml";
      byId("tool-input-title").textContent = toYaml ? "Properties" : "YAML";
      byId("tool-output-title").textContent = toYaml ? "YAML" : "Properties";
      input.placeholder = message(toYaml ? "toolConfigPropertiesHint" : "toolConfigYamlHint");
      indent.hidden = !toYaml;
      updateInput();
    }

    function clear() {
      output.replaceChildren();
      outputLines.textContent = "";
      summary.textContent = "";
      swap.disabled = true;
      byId("tool-copy").disabled = true;
      byId("tool-download").disabled = true;
    }

    function applyResult(result) {
      const value = result.output.replace(/\n$/, "");
      renderCode(output, value, result.extension);
      outputLines.textContent = Array.from({ length: result.metadata.outputLines }, (_, i) => i + 1)
        .join("\n");
      summary.textContent = message("toolConfigLineSummary")
        .replace("{input}", result.metadata.inputLines).replace(
          "{output}",
          result.metadata.outputLines,
        );
      swap.disabled = !result.output;
      byId("tool-copy").disabled = !result.output;
      byId("tool-download").disabled = !result.output;
    }

    setDirection(direction);
    clear();
    return {
      options: () => ({ direction, indent: Number(indent.value) }),
      setDirection,
      updateInput,
      clear,
      applyResult,
      selectFile: (name) => {
        if (/\.ya?ml$/i.test(name)) setDirection("yamlToProperties");
        else if (/\.properties$/i.test(name)) setDirection("propertiesToYaml");
      },
    };
  }
  globalThis.BrowserToolboxPropertiesYamlView = Object.freeze({ create });
})();
