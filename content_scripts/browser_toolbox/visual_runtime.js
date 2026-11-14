// SPDX-License-Identifier: GPL-3.0-or-later
// 选择控制由本模块拥有；共享 Mode 只管理栈，Selection/Range 决定原生文字边界。
(function () {
  const opposite = (direction) => direction === "forward" ? "backward" : "forward";
  function textControl(selection) {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    if (typeof element?.selectionStart !== "number") {
      if (selection.type === "Range" && selection.isCollapsed) {
        element = selection.anchorNode?.childNodes[selection.anchorOffset];
      }
    }
    return element && !element.isContentEditable &&
        typeof element.selectionStart === "number"
      ? element
      : null;
  }

  class SelectionNavigator {
    constructor(alter = "extend") {
      this.selection = getSelection();
      this.alter = alter;
    }
    snapshot() {
      const control = textControl(this.selection);
      return control
        ? {
          control,
          start: control.selectionStart,
          end: control.selectionEnd,
          direction: control.selectionDirection,
        }
        : {
          anchor: this.selection.anchorNode,
          anchorOffset: this.selection.anchorOffset,
          focus: this.selection.focusNode,
          focusOffset: this.selection.focusOffset,
        };
    }
    restore(state) {
      if (state.control?.isConnected) {
        state.control.setSelectionRange(state.start, state.end, state.direction);
      } else if (state.anchor?.isConnected && state.focus?.isConnected) {
        this.selection.setBaseAndExtent(
          state.anchor,
          state.anchorOffset,
          state.focus,
          state.focusOffset,
        );
      }
    }
    direction() {
      const control = textControl(this.selection);
      if (control) return control.selectionDirection === "backward" ? "backward" : "forward";
      const { anchorNode, anchorOffset, focusNode, focusOffset } = this.selection;
      if (!anchorNode || !focusNode) return "forward";
      if (anchorNode.nodeType !== Node.TEXT_NODE || focusNode.nodeType !== Node.TEXT_NODE) {
        // 控件代理和元素边界不能表达隐藏文字方向；按原生字符增量判断并保持浏览器的边界停留。
        for (const direction of ["forward", "backward"]) {
          const change = this.extendCharacter(direction);
          if (!change) continue;
          this.extendCharacter(opposite(direction));
          return change > 0 ? direction : opposite(direction);
        }
        return "forward";
      }
      const anchor = document.createRange();
      const focus = document.createRange();
      anchor.setStart(anchorNode, anchorOffset);
      anchor.collapse(true);
      focus.setStart(focusNode, focusOffset);
      focus.collapse(true);
      return anchor.compareBoundaryPoints(Range.START_TO_START, focus) > 0 ? "backward" : "forward";
    }
    collapse(endpoint) {
      if (!this.selection.toString().length) return;
      const state = this.snapshot();
      if (state.control) {
        const backward = state.direction === "backward";
        const offset = (endpoint === "anchor") === backward ? state.end : state.start;
        state.control.setSelectionRange(offset, offset);
      } else if (this.selection.toString().length) {
        // 控件内部选区通过原生折叠保持其隐藏文字范围与焦点，不能改成 body 的代理端点。
        const start = (endpoint === "anchor") === (this.direction() === "forward");
        this.selection[start ? "collapseToStart" : "collapseToEnd"]();
      }
    }
    reverse() {
      if (!this.selection.rangeCount) return;
      const state = this.snapshot();
      if (
        state.control && state.control !== document.activeElement ||
        !state.control && (state.anchor?.nodeType !== Node.TEXT_NODE ||
            state.focus?.nodeType !== Node.TEXT_NODE)
      ) {
        // 已失焦控件的隐藏选区由 Range 投影到元素边界；修改内部游标会复活旧控件选区。
        const original = this.selection.getRangeAt(0).cloneRange();
        const range = original.cloneRange();
        const backward = this.direction() === "backward";
        range.collapse(backward);
        this.setRange(range);
        this.selection.extend(
          backward ? original.endContainer : original.startContainer,
          backward ? original.endOffset : original.startOffset,
        );
        return;
      }
      if (state.control) {
        state.control.setSelectionRange(state.start, state.end, opposite(this.direction()));
      } else if (state.anchor?.isConnected && state.focus?.isConnected) {
        this.selection.setBaseAndExtent(
          state.focus,
          state.focusOffset,
          state.anchor,
          state.anchorOffset,
        );
      }
    }
    setRange(range) {
      if (!range?.startContainer.isConnected) return;
      this.selection.removeAllRanges();
      this.selection.addRange(range);
    }
    nextCharacter() {
      if (!this.selection.rangeCount) return undefined;
      const state = this.snapshot();
      // 探测始终从当前焦点开始，随后恢复两个端点；不靠反向移动猜测原位置。
      this.collapse("focus");
      this.selection.modify("extend", "forward", "character");
      const value = this.selection.toString();
      this.restore(state);
      return value ? value[value.length - 1] : undefined;
    }
    extendCharacter(direction) {
      const before = this.selection.toString().length;
      this.selection.modify("extend", direction, "character");
      return this.selection.toString().length - before;
    }
    move(direction, granularity) {
      if (direction !== "forward" || !["word", "vimword"].includes(granularity)) {
        this.selection.modify(this.alter, direction, granularity);
        return;
      }
      // w 越过词及后面的分隔符，e 越过前面的分隔符及词；范围数据保持冻结契约。
      const categories = granularity === "vimword" ? [true, false] : [false, true];
      for (const wordCharacter of categories) {
        for (;;) {
          const next = this.nextCharacter();
          if (!next || BrowserToolboxVisualWordCharacter(next) !== wordCharacter) break;
          if (!this.extendCharacter("forward")) return;
        }
      }
      if (this.alter === "move") this.selection.collapseToEnd();
    }
    object(entity, count) {
      this.collapse("focus");
      if (entity === "word") this.move("forward", "character");
      this.move("backward", entity);
      this.collapse("focus");
      for (let index = 0; index < count; index++) this.move("forward", entity);
    }
    wholeLines(count) {
      this.alter = "extend";
      if (this.direction() === "forward") this.reverse();
      this.move("backward", "lineboundary");
      this.reverse();
      for (let index = 1; index < count; index++) this.move("forward", "line");
      this.move("forward", "lineboundary");
      if (this.nextCharacter() === "\n") this.move("forward", "character");
    }
    expandLine() {
      const direction = this.direction();
      this.move(direction, "lineboundary");
      this.reverse();
      this.move(opposite(direction), "lineboundary");
      this.reverse();
    }
    scroll() {
      if (!this.selection.rangeCount) return;
      const element = DomUtils.getElementWithFocus(this.selection, this.direction() === "backward");
      if (element) BrowserToolboxScrollControllerInstance.scrollIntoView(element);
    }
    initialCaret() {
      if (!document.body) return false;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (
          node.data.trim().length < 50 || !DomUtils.getVisibleClientRect(parent) ||
          DomUtils.isEditable(parent)
        ) continue;
        const range = document.createRange();
        range.setStart(node, node.data.search(/\S/));
        range.collapse(true);
        this.setRange(range);
        return true;
      }
      return false;
    }
  }

  const movements = Object.freeze({
    l: ["forward", "character"],
    h: ["backward", "character"],
    j: ["forward", "line"],
    k: ["backward", "line"],
    e: ["forward", "word"],
    b: ["backward", "word"],
    B: ["backward", "word"],
    w: ["forward", "vimword"],
    W: ["forward", "vimword"],
    ")": ["forward", "sentence"],
    "(": ["backward", "sentence"],
    "}": ["forward", "paragraph"],
    "{": ["backward", "paragraph"],
    "0": ["backward", "lineboundary"],
    "$": ["forward", "lineboundary"],
    G: ["forward", "documentboundary"],
    gg: ["backward", "documentboundary"],
  });
  function keyMapping() {
    const root = {};
    for (
      const keys of [
        ...Object.keys(movements),
        "aw",
        "as",
        "n",
        "N",
        "/",
        "y",
        "Y",
        "p",
        "P",
        "v",
        "V",
        "c",
        "o",
        "<c-e>",
        "<c-y>",
      ]
    ) {
      const tokens = keys.startsWith("<") ? [keys] : [...keys];
      let branch = root;
      for (const token of tokens.slice(0, -1)) branch = branch[token] ||= {};
      branch[tokens.at(-1)] = { command: keys };
    }
    return root;
  }

  class VisualMode extends Mode {
    constructor(controller, kind = "visual") {
      super();
      this.controller = controller;
      this.kind = kind;
    }
    init(options = {}) {
      if (!this.controller.live()) return false;
      this.navigator = new SelectionNavigator(this.kind === "caret" ? "move" : "extend");
      this.selection = this.navigator.selection;
      this.sequence = new BrowserToolboxInputRuntime.KeySequence(keyMapping());
      const indicator = this.kind === "caret"
        ? "Caret mode"
        : this.kind === "visual/line"
        ? "Visual mode (line)"
        : "Visual mode";
      super.init({
        ...options,
        name: this.kind,
        indicator: options.indicator ?? indicator,
        singleton: "visual-mode-group",
        suppressAllKeyboardEvents: true,
        keydown: (event) => this.keydown(event),
        keypress: (event) => {
          if (
            event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey &&
            !event.shiftKey
          ) {
            this.yank();
            return this.suppressEvent;
          }
          return this.continueBubbling;
        },
      });
      this.retainSelection = options.userLaunchedMode && this.selection.type === "Range";
      this.onExit((event) => {
        if (!this.retainSelection) {
          const escape = event?.type === "keydown" && KeyboardUtils.isEscape(event) &&
            this.name !== "caret";
          this.navigator.collapse(escape ? "focus" : "anchor");
        }
        const element = document.activeElement;
        if (event?.type !== "click" && DomUtils.isEditable(element)) element.blur();
      });
      this.push({
        click: (event) =>
          this.alwaysContinueBubbling(() => {
            if (DomUtils.isFocusable(event.target)) this.exit(event);
          }),
      });
      if (this.kind === "caret") {
        if (this.selection.type === "None" && !this.navigator.initialCaret()) {
          this.exit();
          HUD.show("Create a selection before entering visual mode.", 2500);
          return false;
        }
        this.navigator.collapse("anchor");
        this.navigator.extendCharacter("forward");
        this.navigator.scroll();
      } else {
        if (this.selection.rangeCount) {
          const rect = this.selection.getRangeAt(0).getBoundingClientRect();
          if (
            rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth
          ) {
            this.selection.removeAllRanges();
          } else if (this.selection.type === "Caret") {
            this.navigator.extendCharacter("forward") || this.navigator.extendCharacter("backward");
          }
        }
        if (this.selection.type !== "Range") {
          this.controller.create("caret").init();
          HUD.show("No usable selection, entering caret mode...", 2500);
          if (this.kind === "visual/line" && this.selection.rangeCount) this.navigator.expandLine();
          return this;
        }
        if (this.kind === "visual/line") this.navigator.expandLine();
      }
      return this;
    }
    keydown(event) {
      if (KeyboardUtils.isEscape(event)) {
        if (this.sequence.pending) this.sequence.reset();
        else this.exit(event);
        return this.suppressEvent;
      }
      const result = this.sequence.accept(KeyboardUtils.getKeyCharString(event));
      if (result.entry) this.command(result.entry.command, result.count ?? 1);
      return result.handled ? this.suppressEvent : this.continueBubbling;
    }
    command(key, count) {
      if (this.kind === "caret") this.navigator.collapse("anchor");
      if (movements[key]) {
        const [direction, granularity] = movements[key];
        for (let index = 0; index < count; index++) {
          this.navigator.move(direction, granularity);
          if (this.kind === "visual/line" && this.selection.isCollapsed) {
            this.navigator.expandLine();
            if (granularity === "line" && this.navigator.direction() !== direction) {
              this.navigator.reverse();
            }
            this.navigator.move(direction, granularity);
          }
        }
      } else {
        this.action(key, count);
      }
      this.navigator.scroll();
      if (this.modeIsActive) {
        if (this.kind === "visual/line") this.navigator.expandLine();
        if (this.kind === "caret") this.navigator.extendCharacter("forward");
      }
    }
    action(key, count) {
      switch (key) {
        case "aw":
        case "as":
          return this.navigator.object(key === "aw" ? "word" : "sentence", count);
        case "o":
          return this.navigator.reverse();
        case "n":
        case "N":
          return this.find(count, key === "N");
        case "/": {
          this.exit();
          const find = this.controller.find();
          if (!find) return;
          const mode = new BrowserToolboxFindRuntime.FindMode(find, { returnToViewport: true });
          mode.onExit(() => {
            if (this.controller.live()) this.controller.create("visual").init();
          });
          return;
        }
        case "v":
        case "V":
          return this.controller.create(key === "v" ? "visual" : "visual/line").init();
        case "c":
          this.navigator.collapse(
            this.kind === "caret" || this.selection.toString().length <= 1 ? "anchor" : "focus",
          );
          return this.controller.create("caret").init();
        case "Y":
          this.navigator.wholeLines(count);
          return this.yank();
        case "y":
          return this.yank();
        case "p":
        case "P": {
          const url = this.yank();
          chrome.runtime.sendMessage({
            handler: key === "p" ? "openUrlInCurrentTab" : "openUrlInNewTab",
            url,
          }).catch(() => {});
          return;
        }
        case "<c-e>":
        case "<c-y>":
          return BrowserToolboxScrollControllerInstance.scrollBy(
            "y",
            (key === "<c-e>" ? 1 : -1) * count * Settings.get("scrollStepSize"),
            1,
            false,
          );
      }
    }
    find(count, backwards) {
      const find = this.controller.find();
      if (!find || !this.selection.rangeCount) return;
      const initial = this.selection.getRangeAt(0).cloneRange();
      for (let index = 0; index < count; index++) {
        const query = find.getQuery(backwards);
        if (!query) return HUD.show("No query to find.", 1000);
        if (!find.execute(query, { colorSelection: false, backwards })) {
          this.navigator.setRange(initial);
          return HUD.show(`No matches for '${find.query.rawQuery}'`, 1000);
        }
      }
      if (this.kind === "caret" && this.selection.toString().length) {
        this.controller.create("visual").init();
      }
    }
    yank() {
      const text = this.yankedText = this.selection.toString();
      this.exit();
      this.controller.copy(text).then((result) => {
        if (!this.controller.live()) return;
        if (!result.ok) return HUD.show("Unable to copy to the clipboard.", 2500);
        const message = text.length > 15
          ? text.replace(/\s+/g, " ").slice(0, 12) + "..."
          : text.replace(/\s+/g, " ");
        HUD.show(
          `Yanked ${text.length} character${text.length === 1 ? "" : "s"}: \"${message}\".`,
          2500,
        );
      });
      return text;
    }
  }

  class Controller {
    constructor(parentResources, context, enabled = () => true) {
      this.context = context;
      this.enabled = enabled;
      this.epoch = globalThis.BrowserToolboxRuntimeHostInstance?.runtimeEpoch;
      this.resources = new BrowserToolboxRuntime.ResourceScope();
      this.pendingCopies = new Map();
      this.closed = false;
      parentResources.add(() => this.destroy());
    }
    live() {
      const host = globalThis.BrowserToolboxRuntimeHostInstance;
      return !this.closed && this.enabled() &&
        globalThis.BrowserToolboxVisualControllerInstance === this &&
        host?.state === "active" && !host.suspended && !host.maintenancePaused &&
        host.runtimeEpoch === this.epoch && host.context.documentId === this.context.documentId;
    }
    find() {
      return this.live() ? globalThis.BrowserToolboxFindControllerInstance : null;
    }
    create(kind) {
      return new VisualMode(this, kind);
    }
    commands() {
      const enter = (kind) => () => this.create(kind).init({ userLaunchedMode: true });
      return { enterVisualMode: enter("visual"), enterVisualLineMode: enter("visual/line") };
    }
    copy(text) {
      if (!this.live()) return Promise.resolve({ ok: false, code: "CANCELLED" });
      if (typeof text !== "string" || !text.length) {
        return Promise.resolve({ ok: false, code: "NO_MATCHING_ELEMENT" });
      }
      const requestId = crypto.randomUUID();
      const result = new Promise((resolve) => {
        const timer = setTimeout(
          () => this.finishCopy(requestId, { ok: false, code: "CLIPBOARD_TIMEOUT" }),
          3000,
        );
        const remove = this.resources.add(() => clearTimeout(timer), "timer");
        const clipboard = HUD.retainClipboard(requestId);
        this.pendingCopies.set(requestId, { resolve, remove, clipboard });
      });
      (async () => {
        if (!await HUD.init()) return this.finishCopy(requestId, { ok: false, code: "CANCELLED" });
        const component = HUD.hudUI;
        // 等待 HUD 样式表与私有端口均就绪后再发起复制，避免冷启动时外层仍为 display:none 导致父框架授焦失败。
        await Promise.all([component.cssReady, component.iframePort]);
        if (!this.live() || component.disposed || !this.pendingCopies.has(requestId)) return;
        await component.postMessage({
          name: "copyToClipboardWithResult",
          data: text,
          copyRequestId: requestId,
        });
      })().catch(() => this.finishCopy(requestId, { ok: false, code: "CLIPBOARD_DENIED" }));
      return result;
    }
    finishCopy(requestId, result) {
      const pending = this.pendingCopies.get(requestId);
      if (!pending) return;
      this.pendingCopies.delete(requestId);
      pending.remove();
      pending.clipboard.release();
      pending.resolve(result);
    }
    completeCopy(message) {
      if (
        !this.live() || typeof message.copyRequestId !== "string" || typeof message.ok !== "boolean"
      ) return;
      this.finishCopy(message.copyRequestId, {
        ok: message.ok,
        code: message.ok ? "OK" : "CLIPBOARD_DENIED",
      });
    }
    cancelInteractions() {
      if (this.pendingCopies.size) HUD.destroy();
      for (const requestId of [...this.pendingCopies.keys()]) {
        this.finishCopy(requestId, { ok: false, code: "CANCELLED" });
      }
      for (const mode of [...Mode.modes]) {
        if (mode.controller === this) mode.exit();
      }
    }
    destroy() {
      if (this.closed) return;
      this.closed = true;
      for (const requestId of [...this.pendingCopies.keys()]) {
        this.finishCopy(requestId, { ok: false, code: "CANCELLED" });
      }
      this.resources.dispose();
    }
  }
  globalThis.BrowserToolboxVisualRuntime = Object.freeze({
    SelectionNavigator,
    VisualMode,
    Controller,
    keyMapping,
  });
})();
