// SPDX-License-Identifier: GPL-3.0-or-later
// 输入/候选状态属于当前激活；旧回包或旧hidden不能提交新一次交互的动作。
import { parseConfig } from "../../background_scripts/user_search_engines.js";
import "../../lib/browser_toolbox/runtime_host.js";

export class VomnibarController {
  constructor({ api = chrome, messenger, settings = Settings } = {}) {
    Object.assign(this, { api, messenger, settings });
    this.implementation = "browser-toolbox";
    this.resources = new BrowserToolboxRuntime.ResourceScope();
    this.activation = this.queryRevision = 0;
    this.box = document.getElementById("vomnibar");
    this.input = this.box.querySelector("input");
    this.list = this.box.querySelector("ul");
    this.modeLabel = this.box.querySelector("#vomnibar-mode-label");
    this.dispositionLabel = this.box.querySelector("#vomnibar-disposition");
    this.resources.listen(this.input, "input", () => this.onInput());
    this.resources.listen(this.input, "keydown", (event) => this.onKeyEvent(event));
    this.resources.listen(this.input, "keypress", (event) => this.onKeyEvent(event));
    this.resources.listen(window, "focus", () => {
      if (this.active) this.input.focus();
    });
    this.resources.listen(this.box, "click", (event) => {
      if (this.active) this.input.focus();
      event.stopImmediatePropagation();
    });
    this.resources.listen(document, "click", () => this.hide(), false);
    this.resources.listen(window, "pagehide", () => this.destroy());
    this.initialSelection = -1;
    this.clear();
  }
  async activate(options) {
    if (this.closed) throw new Error("VOMNIBAR_CLOSED");
    this.activation++;
    this.active = true;
    this.hiding = this.committing = false;
    this.pendingAction = null;
    this.interactionId = options.interactionId;
    this.completerName = options.completer || "omni";
    this.initialSelection = options.selectFirst ? 0 : -1;
    this.forceNewTab = options.newTab === true;
    this.engines = parseConfig(this.settings.get("searchEngines")).keywordToEngine;
    this.clear();
    this.input.value = options.query || "";
    this.engine = Object.hasOwn(this.engines, options.keyword)
      ? this.engines[options.keyword]
      : null;
    const copy = {
      bookmarks: ["vomnibarSearchBookmarks", "vomnibarPlaceholderBookmarks"],
      tabs: ["vomnibarSearchTabs", "vomnibarPlaceholderTabs"],
      omni: ["vomnibarSearchOrOpen", "vomnibarPlaceholderOmni"],
    }[this.completerName] || ["vomnibarSearchOrOpen", "vomnibarPlaceholderOmni"];
    const label = BrowserToolboxI18n.message(copy[0]);
    this.modeLabel.textContent = label;
    this.input.placeholder = BrowserToolboxI18n.message(copy[1]);
    this.input.setAttribute("aria-label", label);
    this.dispositionLabel.textContent = BrowserToolboxI18n.message("vomnibarNewTab");
    this.dispositionLabel.hidden = !this.forceNewTab;
    this.send({ handler: "refreshCompletions", completerName: this.completerName }).catch(() => {});
    this.input.focus();
    await this.update();
  }
  async send(message) {
    const result = await this.api.runtime.sendMessage(message);
    if (result?.ok === false) throw new Error("VOMNIBAR_REQUEST_FAILED");
    return result;
  }
  clear() {
    this.queryRevision++;
    this.input.value = "";
    this.completions = [];
    this.selection = this.initialSelection;
    this.previousInput = null;
    this.engine = null;
    this.seenTab = false;
    this.render();
  }
  render() {
    this.list.innerHTML = this.completions.map((item, index) =>
      `<li id="vomnibar-completion-${index}" role="option" aria-selected="false">${item.html}</li>`
    ).join("");
    this.list.style.display = this.completions.length ? "block" : "";
    this.input.setAttribute("aria-expanded", String(this.completions.length > 0));
    this.updateSelection();
  }
  updateSelection() {
    const current = this.completions[this.selection];
    if (this.selection >= 0 && current?.insertText != null) {
      this.previousInput ??= this.input.value;
      this.input.value = current.insertText;
    } else if (this.previousInput != null) {
      this.input.value = this.previousInput;
      this.previousInput = null;
    }
    for (const [index, element] of [...this.list.children].entries()) {
      const selected = index === this.selection;
      element.className = selected ? "selected" : "";
      element.setAttribute("aria-selected", String(selected));
    }
    const id = this.list.children[this.selection]?.id;
    if (id) this.input.setAttribute("aria-activedescendant", id);
    else this.input.removeAttribute("aria-activedescendant");
  }
  async update() {
    const revision = ++this.queryRevision, activation = this.activation;
    const query = (this.engine ? this.engine.keyword + " " : "") + this.input.value;
    try {
      const results = await this.send({
        handler: "filterCompletions",
        completerName: this.completerName,
        query,
        queryTerms: query.trim().split(/\s+/).filter(Boolean),
        seenTabToOpenCompletionList: this.seenTab,
      });
      if (
        !this.active || this.closed || activation !== this.activation ||
        revision !== this.queryRevision
      ) return;
      if (!Array.isArray(results)) throw new Error("INVALID_COMPLETIONS_RESPONSE");
      this.lastErrorCode = null;
      this.completions = results;
      this.selection = results[0]?.autoSelect ? 0 : this.initialSelection;
      this.selection = Math.min(
        results.length - 1,
        Math.max(this.initialSelection, this.selection),
      );
      this.render();
      this.input.focus();
    } catch (_) {
      if (
        this.active && !this.closed && activation === this.activation &&
        revision === this.queryRevision
      ) {
        this.lastErrorCode = "COMPLETIONS_UNAVAILABLE";
        // 失败不能留下上一查询的可提交候选；保留用户已输入的文字以便继续编辑。
        this.completions = [];
        this.selection = -1;
        this.previousInput = null;
        this.render();
      }
    }
  }
  cancel() {
    this.send({ handler: "cancelCompletions", completerName: this.completerName }).catch(() => {});
  }
  onInput() {
    if (!this.active || this.closed) return;
    this.seenTab = false;
    this.cancel();
    if (!this.engine) {
      const parts = this.input.value.trimStart().split(/\s+/);
      if (parts.length > 1 && Object.hasOwn(this.engines, parts[0])) {
        this.engine = this.engines[parts[0]];
        this.input.value = this.input.value.trim().split(/\s+/).slice(1).join(" ");
      }
    }
    if (this.previousInput != null) {
      this.previousInput = null;
      this.selection = -1;
    }
    this.update();
  }
  action(event) {
    const key = KeyboardUtils.getKeyChar(event);
    if (
      event.type === "keypress" && key !== "enter" || event.type === "keydown" && key === "enter"
    ) return null;
    if (KeyboardUtils.isEscape(event)) return "dismiss";
    if (
      key === "up" || event.shiftKey && event.key === "Tab" ||
      event.ctrlKey && ["k", "p"].includes(key)
    ) return "up";
    if (event.key === "Tab" && !event.shiftKey) return "tab";
    if (key === "down" || event.ctrlKey && ["j", "n"].includes(key)) return "down";
    if (event.ctrlKey && key === "enter") return "edit";
    if (event.key === "Enter") return "enter";
    if (event.key === "Delete" && event.shiftKey && !event.ctrlKey && !event.altKey) {
      return "remove";
    }
    if (KeyboardUtils.isBackspace(event)) return "delete";
    return null;
  }
  onKeyEvent(event) {
    if (!this.active || this.closed || event.isComposing || event.keyCode === 229) return;
    const action = this.action(event);
    if (!action) return;
    if (action === "dismiss") this.hide();
    else if (["tab", "down"].includes(action)) {
      if (
        action === "tab" && this.completerName === "omni" && !this.seenTab &&
        !this.input.value.trim()
      ) {
        this.seenTab = true;
        this.update();
      } else if (this.completions.length) {
        this.selection++;
        if (this.selection === this.completions.length) this.selection = this.initialSelection;
        this.updateSelection();
      }
    } else if (action === "up") {
      this.selection--;
      if (this.selection < this.initialSelection) this.selection = this.completions.length - 1;
      this.updateSelection();
    } else if (action === "edit") {
      if (!this.engine && this.selection >= 0) {
        this.previousInput ??= this.input.value;
        this.input.value = this.completions[this.selection]?.url;
        this.input.scrollLeft = this.input.scrollWidth;
      }
    } else if (action === "delete") {
      if (this.engine && this.input.selectionEnd === 0) {
        const keyword = this.engine.keyword;
        this.input.value = keyword + this.input.value.trimStart();
        this.input.selectionStart = this.input.selectionEnd = keyword.length;
        this.engine = null;
        this.update();
      } else if (this.seenTab && !this.input.value.trim()) {
        this.seenTab = false;
        this.update();
      } else return;
    } else if (action === "enter") {
      this.submit(event).catch(() => {
        this.lastErrorCode = "RESULT_UNKNOWN";
      });
    }
    event.stopImmediatePropagation();
    event.preventDefault();
  }
  async submit(event) {
    if (!this.active || this.closed || this.committing) return;
    const activation = this.activation;
    const item = this.completions[this.selection];
    const primary = (value) => value?.isPrimarySuggestion && value?.isCustomSearch;
    let query = this.input.value.trim();
    const newTab = this.forceNewTab || event.shiftKey || event.ctrlKey || event.altKey ||
      event.metaKey;
    if (!this.completions.length || this.selection === -1) {
      if (!query) return;
      this.committing = true;
      if (primary(this.completions[0])) {
        // 未选中primary时仍打开当前标签；先隐藏并让父文档释放iframe，再执行导航。
        this.hide(
          this.urlSubmission(UrlUtils.createSearchUrl(query, this.completions[0].searchUrl)),
        );
      } else {
        const url = await UrlUtils.isUrl(query);
        if (this.closed || !this.active || activation !== this.activation) return;
        this.hide(
          url
            ? this.urlSubmission(query, newTab)
            : { handler: "launchSearchQuery", query, openInNewTab: Boolean(newTab) },
        );
      }
    } else {
      this.committing = true;
      if (primary(item)) {
        query = UrlUtils.createSearchUrl(query, item.searchUrl);
        this.hide(this.urlSubmission(query, newTab));
      } else {
        this.hide(
          item.description === "tab"
            ? { handler: "selectSpecificTab", id: item.tabId }
            : this.urlSubmission(item.url, newTab),
        );
      }
    }
  }
  urlSubmission(url, newTab) {
    if (newTab && UrlUtils.hasJavascriptProtocol(url)) newTab = false;
    return { handler: newTab ? "openUrlInNewTab" : "openUrlInCurrentTab", url };
  }
  hide(action = null) {
    if (this.closed || !this.active) return;
    const activation = this.activation, interactionId = this.interactionId;
    this.active = false;
    this.hiding = true;
    this.pendingAction = action ? { activation, action } : null;
    this.input.blur();
    this.clear();
    this.cancel();
    this.resources.timeout(() => {
      if (activation === this.activation && this.hiding) {
        this.messenger.postMessage({ name: "hide", interactionId });
      }
    }, 0);
  }
  onHidden(message = {}) {
    if (
      this.closed || message.interactionId !== this.interactionId ||
      !this.active && !this.hiding && !this.committing && !this.pendingAction
    ) return;
    const activation = this.activation, interactionId = this.interactionId;
    const pending = this.pendingAction;
    this.pendingAction = null;
    this.active = this.hiding = this.committing = false;
    this.clear();
    // 交给已认证的父文档先移除iframe，避免Enter导航时扩展子框架阻止BFCache。
    Promise.resolve().then(() => {
      if (!this.closed && activation === this.activation && !this.active) {
        this.messenger.postMessage({
          name: "vomnibarInteractionFinished",
          interactionId,
          ...(pending?.activation === activation ? { submission: pending.action } : {}),
        });
      }
    }).catch(() => {
      this.lastErrorCode = "RESULT_UNKNOWN";
    });
  }
  deactivate() {
    this.activation++;
    this.active = this.hiding = this.committing = false;
    this.pendingAction = null;
    this.clear();
    this.cancel();
  }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.active = false;
    this.activation++;
    this.queryRevision++;
    this.pendingAction = null;
    this.cancel();
    this.resources.dispose();
    this.completions = [];
  }
}
