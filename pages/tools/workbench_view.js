// SPDX-License-Identifier: GPL-3.0-or-later
const runtime = globalThis.BrowserToolboxToolRuntime;

export function t(key, values = {}) {
  return globalThis.BrowserToolboxI18n.message(key).replace(
    /\{(\w+)\}/g,
    (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

export function node(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function icon(name) {
  return globalThis.BrowserToolboxToolIcons.createIcon(name);
}

export function action(key, { id, glyph, run, primary = false } = {}) {
  const button = node("button", primary ? "workbench-button workbench-copy" : "workbench-button");
  button.type = "button";
  if (id) button.id = id;
  labelAction(button, key, glyph);
  if (run) button.addEventListener("click", run);
  return button;
}

export function labelAction(button, key, glyph) {
  const label = node("span", "", t(key));
  button.replaceChildren(...(glyph ? [icon(glyph), label] : [label]));
}

export function group(label, control) {
  const element = node("div", "workbench-control");
  element.append(node("span", "", label), control);
  return element;
}

export function divider() {
  const element = node("span", "workbench-divider");
  element.setAttribute("aria-hidden", "true");
  return element;
}

export function segments(name, label, choices, initial, onChange) {
  const element = node("div", "segmented");
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", label);
  element.dataset.segment = name;
  let value = initial;
  const buttons = new Map();
  function set(next) {
    value = next;
    for (const [id, button] of buttons) button.setAttribute("aria-pressed", String(id === value));
  }
  for (const [id, text] of choices) {
    const button = node("button", "", text);
    button.type = "button";
    button.dataset.value = id;
    button.addEventListener("click", () => {
      if (value === id) return;
      set(id);
      onChange(id);
    });
    buttons.set(id, button);
    element.append(button);
  }
  set(initial);
  return {
    element,
    buttons,
    set,
    get value() {
      return value;
    },
  };
}

export function selectControl(label, options, value, id) {
  const select = node("select", "workbench-select");
  if (id) select.id = id;
  select.setAttribute("aria-label", label);
  for (const [key, text] of options) {
    const option = node("option", "", text);
    option.value = key;
    select.append(option);
  }
  select.value = value;
  return select;
}

export function panel(title, { id, result = false, subtitle = "", actions = [] } = {}) {
  const element = node("section", result ? "workbench-pane result-pane" : "workbench-pane");
  if (id) element.id = id;
  const header = node("div", "pane-header");
  const caption = node("div", "pane-caption");
  const heading = node("h2", "", title);
  heading.id = `${id}-title`;
  element.setAttribute("aria-labelledby", heading.id);
  const detail = node("span", "pane-subtitle", subtitle);
  caption.append(heading, detail);
  header.append(caption);
  if (actions.length) {
    const controls = node("div", "pane-actions");
    controls.append(...actions);
    header.append(controls);
  }
  element.append(header);
  return { element, header, heading, detail };
}

export function restoreButton(run) {
  document.querySelector(".workbench-header-actions").append(
    action("toolCodecRestoreExample", { id: "tool-restore", glyph: "restore", run }),
  );
}

export function mountPanes(ctx, ...panes) {
  const pair = node("div", "workbench-panes");
  pair.append(...panes.map((pane) => pane.element));
  ctx.footer.before(pair);
  return pair;
}

export function countLines(value) {
  return value ? value.split(/\r\n|\r|\n/).length : 0;
}

function numberLines(gutter, value) {
  const count = Math.max(1, countLines(value));
  const numbers = Array.from({ length: Math.min(5000, count) }, (_, index) => index + 1);
  if (count > numbers.length) numbers.push("…");
  gutter.textContent = numbers.join("\n");
}

function editorFrame(id, headingId, input) {
  const element = node("div", "workbench-editor");
  const gutter = node("pre", "editor-gutter");
  gutter.setAttribute("aria-hidden", "true");
  const area = node("div", "editor-area");
  const text = node(input ? "textarea" : "pre", "editor-text");
  text.id = id;
  text.setAttribute("aria-labelledby", headingId);
  area.append(text);
  element.append(gutter, area);
  text.addEventListener("scroll", () => gutter.scrollTop = text.scrollTop);
  return { element, gutter, area, text };
}

export function inputPane(ctx, {
  id = "tool-input",
  title,
  subtitle,
  placeholder = "toolInputHint",
  highlight,
  accept = ".txt,text/*",
  readFile = (file) => file.text(),
  onFile,
}) {
  let revision = 0;
  const file = node("input");
  file.id = id === "tool-input" ? "tool-file" : "tool-file-right";
  file.type = "file";
  file.hidden = true;
  file.accept = accept;
  file.setAttribute("aria-label", t("toolFileChoose"));
  const choose = action("toolFileChoose", {
    id: `${file.id}-trigger`,
    glyph: "document",
    run: () => file.click(),
  });
  choose.setAttribute("aria-controls", file.id);
  const clear = action("toolCodecClear", {
    id: `${id}-clear`,
    run: () => {
      set("");
      input.focus();
    },
  });
  const view = panel(title, { id: `${id}-pane`, subtitle, actions: [choose, clear] });
  const { element, gutter, area, text: input } = editorFrame(id, view.heading.id, true);
  const preview = node("pre", "editor-highlight");
  preview.setAttribute("aria-hidden", "true");
  if (highlight) area.prepend(preview);
  input.placeholder = t(placeholder);
  input.spellcheck = false;
  input.setAttribute("wrap", "off");
  input.setAttribute("autocapitalize", "off");
  input.autocomplete = "off";

  function syncHighlight() {
    preview.scrollTop = input.scrollTop;
    preview.scrollLeft = input.scrollLeft;
  }
  function redraw() {
    numberLines(gutter, input.value);
    const useHighlight = highlight && input.value.length > 0 && input.value.length <= 80000;
    element.classList.toggle("has-highlight", Boolean(useHighlight));
    preview.replaceChildren();
    if (useHighlight) highlight(preview, input.value + (input.value.endsWith("\n") ? " " : ""));
    gutter.scrollTop = input.scrollTop;
    syncHighlight();
  }
  input.addEventListener("input", () => {
    revision++;
    choose.removeAttribute("title");
    redraw();
  });
  if (highlight) input.addEventListener("scroll", syncHighlight);

  function set(value) {
    input.value = value;
    input.setSelectionRange(0, 0);
    input.scrollTo(0, 0);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  file.addEventListener("change", async () => {
    const [selected] = file.files;
    file.value = "";
    if (!selected) return;
    const request = ++revision;
    if (selected.size > Math.min(ctx.descriptor.maxInputBytes, runtime.MAX_RENDER_BYTES)) {
      ctx.toast(t("toolFileTooLarge"), true);
      return;
    }
    try {
      const text = await readFile(selected);
      if (request !== revision) return;
      onFile?.(selected);
      set(text);
      choose.title = selected.name;
    } catch (error) {
      if (request === revision) ctx.toast(t(error.messageKey || "toolWorkbenchFileError"), true);
    }
  });
  view.element.append(element, file);
  redraw();
  return { ...view, input, set, redraw };
}

export function codeResult(headingId) {
  const { element, gutter, text } = editorFrame("tool-output", headingId, false);
  text.tabIndex = 0;
  return {
    element,
    set(value, highlight) {
      text.replaceChildren();
      if (highlight && value.length <= 80000) highlight(text, value);
      else text.textContent = value;
      gutter.textContent = "";
      if (value) numberLines(gutter, value);
    },
  };
}

export function resultActions(ctx, { copyKey = "toolCodecCopyShort", download, regenerate } = {}) {
  let value = "";
  const copy = action(copyKey, {
    id: "tool-copy",
    glyph: "copy",
    primary: true,
    run: () => ctx.copy(value),
  });
  const save = download && action("toolDownloadShort", {
    id: "tool-download",
    glyph: "download",
    run: () => {
      const { name, mime } = download();
      runtime.downloadText(value, name, mime);
      ctx.toast(t("toolDownloaded"));
    },
  });
  const buttons = [regenerate, copy, save].filter(Boolean);
  function set(next) {
    value = next;
    copy.disabled = !value;
    if (save) save.disabled = !value;
  }
  set("");
  return { buttons, set };
}

export function copyRow(ctx, key, className = "") {
  const element = node("button", `copy-row ${className}`.trim());
  element.type = "button";
  const affordance = node("span", "copy-row-affordance");
  affordance.setAttribute("aria-hidden", "true");
  affordance.append(icon("copy"), node("span", "", t(key)));
  let value = "";
  element.addEventListener("click", () => ctx.copy(value));
  return {
    element,
    set(next, ...content) {
      value = next;
      element.disabled = !value;
      element.replaceChildren(...content, affordance);
      element.setAttribute(
        "aria-label",
        [t(key), ...content.map((item) => item.textContent)].join(" · "),
      );
    },
  };
}

export function checkedInput(value, handler) {
  const input = node("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => handler(input.checked));
  return input;
}

export function assertSize(ctx, input) {
  if (
    runtime.byteLength(input) > Math.min(ctx.descriptor.maxInputBytes, runtime.MAX_RENDER_BYTES)
  ) {
    throw Object.assign(new Error(), { messageKey: "toolWorkbenchInputLimit" });
  }
}

// 只提交最新输入的结果，等正在运行的转换退出后再处理下一次请求。
export function liveResult(compute, apply, fail, pending = () => {}) {
  let revision = 0;
  let timer;
  let running = Promise.resolve();
  return (delay = 0) => {
    const requested = ++revision;
    clearTimeout(timer);
    pending();
    const start = () => {
      running = running.then(async () => {
        if (requested !== revision) return;
        try {
          const result = await compute();
          if (requested === revision) apply(result);
        } catch (error) {
          if (requested === revision) fail(error);
        }
      });
      return running;
    };
    if (delay) timer = setTimeout(start, delay);
    else return start();
  };
}
