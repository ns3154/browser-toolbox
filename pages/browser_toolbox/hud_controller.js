// SPDX-License-Identifier: GPL-3.0-or-later
// 查找输入和剪贴板任务各自绑定会话，组合态按键始终交给系统输入法。
import "../../lib/browser_toolbox/find_history.js";

export class HudController {
  constructor({ post, page = globalThis, history = new BrowserToolboxFindHistory() }) {
    Object.assign(this, { post, page, history });
    this.document = page.document;
    this.jobs = new Map();
    this.revision = 0;
    this.historyReady = history.init();
    this.onHide = () => this.destroy();
    page.addEventListener("pagehide", this.onHide, { once: true });
  }
  async handle(data) {
    if (this.closed || !data || typeof data !== "object") return;
    switch (data.name) {
      case "show":
        return this.show(data.text);
      case "hidden":
        return this.hidden();
      case "showFindMode":
        return this.showFind(data.findSessionId);
      case "updateMatchesCount":
        return this.matches(data);
      case "copyToClipboard":
        return this.clipboard(data, "copy");
      case "copyToClipboardWithResult":
        return this.clipboard(data, "visual");
      case "pasteFromClipboard":
        return this.clipboard(data, "paste");
      case "clipboardFocusResult": {
        const job = this.jobs.get(data.clipboardRequestId);
        if (job?.focusPending) job.resolveWait?.(data.ok === true);
        break;
      }
    }
  }
  element() {
    return this.document.getElementById("hud");
  }
  hidden() {
    this.revision++;
    for (const job of this.jobs.values()) job.resolveWait?.(false);
    this.find = null;
    const hud = this.element();
    hud.replaceChildren();
    hud.classList.add("vimium-ui-component-hidden");
    hud.classList.remove("vimium-ui-component-visible", "hud-find");
  }
  show(text) {
    this.hidden();
    const hud = this.element();
    hud.textContent = typeof text === "string" ? text : "";
    hud.classList.add("vimium-ui-component-visible");
    hud.classList.remove("vimium-ui-component-hidden");
  }
  async showFind(sessionId) {
    if (typeof sessionId !== "string") return false;
    this.hidden();
    const revision = this.revision;
    await this.historyReady;
    if (this.closed || revision !== this.revision) return false;
    const hud = this.element();
    hud.classList.add("hud-find", "vimium-ui-component-visible");
    hud.classList.remove("vimium-ui-component-hidden");
    const input = this.document.createElement("span");
    input.id = "hud-find-input";
    try {
      input.contentEditable = "plaintext-only";
    } catch (_) {
      input.contentEditable = "true";
    }
    const count = this.document.createElement("span");
    count.id = "hud-match-count";
    count.style.float = "right";
    hud.append(input, count);
    const find = this.find = {
      sessionId,
      input,
      count,
      index: -1,
      raw: "",
      partial: "",
      composing: false,
    };
    input.addEventListener("compositionstart", () => find.composing = true);
    input.addEventListener("compositionend", () => {
      find.composing = false;
      this.search(find);
    });
    input.addEventListener("input", (event) => {
      if (!event.isComposing && !find.composing) this.search(find);
    });
    // 等待父组件可见性的原生通知；有界等待结束后仍须复核当前查找会话。
    await new Promise((resolve) => setTimeout(resolve, 17));
    if (this.closed || this.find !== find || find.exiting) return false;
    input.focus();
    return true;
  }
  search(find) {
    if (this.closed || this.find !== find || find.exiting || find.composing) return;
    find.raw = find.input.textContent.replace(/\u00a0/g, " ");
    this.post({ name: "search", query: find.raw, findSessionId: find.sessionId });
  }
  setText(find, text) {
    find.input.textContent = text;
    const range = this.document.createRange();
    range.selectNodeContents(find.input);
    range.collapse(false);
    const selection = this.page.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    this.search(find);
  }
  key(event) {
    const find = this.find;
    if (!find || find.exiting || this.closed) return;
    if (event.isComposing || event.keyCode === 229 || find.composing) {
      if (event.key === "Enter") find.compositionEnter = true;
      return;
    }
    if (event.type === "keydown" && event.key === "Enter") return;
    if (event.type === "keypress" && (event.key !== "Enter" || find.compositionEnter)) return;
    const escape = KeyboardUtils.isEscape(event);
    if (
      escape || event.key === "Enter" ||
      KeyboardUtils.isBackspace(event) && !find.input.textContent.length
    ) {
      find.exiting = true;
      find.input.blur();
      this.pendingFindKey = { key: event.key, findSessionId: find.sessionId };
      this.post({
        name: "hideFindMode",
        exitEventIsEnter: event.key === "Enter",
        exitEventIsEscape: escape,
        findSessionId: find.sessionId,
        exitKey: event.key,
      });
    } else if (event.key === "ArrowUp") {
      const query = this.history.getQuery(find.index + 1);
      if (query) {
        if (find.index === -1) find.partial = find.raw;
        find.index++;
        this.setText(find, query);
      }
    } else if (event.key === "ArrowDown") {
      find.index = Math.max(-1, find.index - 1);
      this.setText(find, find.index < 0 ? find.partial : this.history.getQuery(find.index));
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
    return false;
  }
  keyup(event) {
    if (event.key === "Enter" && this.find) this.find.compositionEnter = false;
    if (event.key !== this.pendingFindKey?.key || this.closed) return;
    this.post({ name: "findKeyReleased", ...this.pendingFindKey });
    this.pendingFindKey = null;
  }
  matches({ matchCount, showMatchText }) {
    if (!this.find || this.find.exiting) return;
    this.find.count.textContent = showMatchText
      ? matchCount > 0 ? ` (${matchCount} Match${matchCount === 1 ? "" : "es"})` : " (No matches)"
      : "";
  }
  waitClipboard(job, delay, fallback) {
    return new Promise((resolve) => {
      job.resolveWait = (value) => {
        clearTimeout(job.timer);
        job.removeFocusListener?.();
        job.removeFocusListener = null;
        job.timer = job.resolveWait = null;
        resolve(value);
      };
      job.timer = setTimeout(() => job.resolveWait?.(fallback), delay);
    });
  }
  waitClipboardFocus(job, delay) {
    if (delay <= 0) return Promise.resolve(false);
    const waiting = this.waitClipboard(job, delay, false);
    const check = () => {
      if (this.document.hasFocus()) job.resolveWait?.(true);
    };
    this.page.addEventListener("focus", check, true);
    job.removeFocusListener = () => this.page.removeEventListener("focus", check, true);
    check();
    return waiting;
  }
  async clipboard(message, kind) {
    const id = kind === "visual" ? message.copyRequestId : message.clipboardRequestId;
    if (
      typeof id !== "string" || this.jobs.has(id) ||
      kind !== "paste" && typeof message.data !== "string"
    ) return;
    const job = { revision: this.revision };
    this.jobs.set(id, job);
    let ok = false, value;
    try {
      if (!this.page.navigator.clipboard) {
        if (kind !== "visual") this.post({ name: "showClipboardUnavailableMessage" });
        return;
      }
      const proceed = await this.waitClipboard(job, 17, true);
      if (
        !proceed || this.closed || this.jobs.get(id) !== job || this.revision !== job.revision
      ) return;
      // 授焦回执与跨进程原生焦点可能先后到达，两者共享原有的一秒期限。
      const focusDeadline = this.page.performance.now() + 1000;
      const focused = this.waitClipboard(job, 1000, false);
      job.focusPending = true;
      this.post({ name: "clipboardFocus", clipboardRequestId: id });
      const allowed = await focused;
      job.focusPending = false;
      if (
        !allowed || this.closed || this.jobs.get(id) !== job || this.revision !== job.revision
      ) return;
      const nativeFocused = await this.waitClipboardFocus(
        job,
        focusDeadline - this.page.performance.now(),
      );
      if (
        !nativeFocused || this.closed || this.jobs.get(id) !== job ||
        this.revision !== job.revision ||
        !this.document.hasFocus()
      ) return;
      if (kind === "paste") {
        value = (await this.page.navigator.clipboard.readText()).replace(/\u00a0/g, " ");
      } else {
        await this.page.navigator.clipboard.writeText(message.data.replace(/\u00a0/g, " "));
        // 保持子文档原生焦点等待主进程消费 ClipboardHost::CommitWrite，避免跨进程 MessageChannel 先一步触发父框架归焦与拆框。
        const flushed = await this.waitClipboard(job, 17, true);
        if (
          !flushed || this.closed || this.jobs.get(id) !== job || this.revision !== job.revision
        ) return;
      }
      ok = true;
    } catch (_) {
      ok = false;
    } finally {
      job.resolveWait?.(false);
      clearTimeout(job.timer);
      if (
        !this.closed && this.revision === job.revision && this.document.hasFocus()
      ) this.post({ name: "unfocusIfFocused", clipboardRequestId: id });
      if (this.jobs.get(id) === job) this.jobs.delete(id);
      if (!this.closed) {
        this.post(
          kind === "visual" ? { name: "copyToClipboardResult", copyRequestId: id, ok } : {
            name: kind === "paste" && ok ? "pasteResponse" : "clipboardComplete",
            clipboardRequestId: id,
            ok,
            ...(kind === "paste" && ok ? { data: value } : {}),
          },
        );
      }
    }
  }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.revision++;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.resolveWait?.(false);
    }
    this.jobs.clear();
    this.find = this.pendingFindKey = null;
    this.history.destroy();
    this.page.removeEventListener("pagehide", this.onHide);
  }
}
