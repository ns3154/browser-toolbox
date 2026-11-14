// SPDX-License-Identifier: GPL-3.0-or-later
// 按冻结契约独立维护查询、匹配游标与选区；公共 Mode/HUD 只承担模式栈和显示能力。
(function () {
  function parse(raw, regexDefault = false) {
    let isRegex = regexDefault;
    const parsedQuery = raw.replace(/(\\{1,2})([rRI]?)/g, (whole, slashes, flag) => {
      if (slashes.length !== 1 || !flag) return whole;
      if (flag === "r") isRegex = true;
      if (flag === "R") isRegex = false;
      return "";
    });
    const ignoreCase = parsedQuery === parsedQuery.toLowerCase();
    const pattern = isRegex ? parsedQuery : parsedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { rawQuery: raw, parsedQuery, ignoreCase, isRegex, pattern };
  }
  function textNodes(root = document.body) {
    const nodes = [];
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) nodes.push(node);
      else if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node.checkVisibility() || node.style.display === "contents")
      ) {
        for (const child of node.childNodes) visit(child);
      }
    };
    if (root) visit(root);
    return nodes;
  }
  function currentRange() {
    const selection = getSelection();
    if (selection.type === "None") {
      const range = document.createRange();
      range.setStart(document.body, 0);
      range.collapse(true);
      return range;
    }
    if (selection.type === "Range") selection.collapseToStart();
    return selection.getRangeAt(0).cloneRange();
  }
  class Controller {
    constructor(resources, history) {
      this.resources = resources;
      this.history = history;
      this.query = null;
      this.groups = [];
      this.closed = false;
    }
    activate() {
      // 同一文档重建引擎时保留已完成的查询；匹配重新扫描，不能沿用已注销控制器的节点数组。
      const previous = legacyQuery;
      if (previous) {
        this.query = {
          rawQuery: previous.rawQuery,
          parsedQuery: previous.parsedQuery,
          ignoreCase: previous.ignoreCase,
          isRegex: previous.isRegex,
          hasResults: previous.hasResults,
        };
        if (previous.regexPattern) {
          this.collectMatches(
            new RegExp(previous.regexPattern.source, previous.regexPattern.flags),
          );
          const [row, col] = previous.activeRegexIndices || [];
          if (this.groups[row]?.values[col] != null) this.query.activeRegexIndices = [row, col];
        }
        legacyQuery = undefined;
      }
      this.resources.listen(document, "selectionchange", (event) => {
        if (event.isTrusted && !this.selectionPending) {
          document.body?.classList.remove("vimium-find-mode");
        }
      });
    }
    updateQuery(raw) {
      const parsed = parse(raw, Settings.get("regexFindMode"));
      this.query = { ...(this.query || {}), ...parsed };
      let pattern;
      try {
        pattern = new RegExp(parsed.pattern, `g${parsed.ignoreCase ? "i" : ""}`);
      } catch (_) {
        return;
      }
      return this.collectMatches(pattern);
    }
    collectMatches(pattern) {
      const groups = [];
      for (const node of textNodes()) {
        const values = node.textContent.match(pattern);
        if (!values) continue;
        const indices = [];
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(node.textContent)) !== null) {
          if (!match[0]) break;
          indices.push(match.index);
        }
        groups.push({ node, values, indices });
      }
      this.groups = groups;
      Object.assign(this.query, {
        regexPattern: pattern,
        regexMatchedNodes: groups.map((group) => group.node),
        regexMatches: groups.map((group) => group.values),
        matchCount: groups.reduce((count, group) => count + group.values.length, 0),
      });
      this.updateActiveRegexIndices();
      return this.query.matchCount;
    }
    updateActiveRegexIndices() {
      const selection = getSelection();
      let row = this.groups.findIndex((group) => group.node === selection.anchorNode);
      if (row < 0 && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        row = this.groups.findIndex(({ node }) => {
          const candidate = document.createRange();
          candidate.setStart(node, 0);
          return range.compareBoundaryPoints(Range.START_TO_START, candidate) <= 0;
        });
      }
      this.query.activeRegexIndices = [Math.max(0, row), 0];
    }
    getQueryFromRegexMatches() {
      if (!this.groups.length) return "";
      const [row, col] = this.query.activeRegexIndices;
      return this.groups[row]?.values[col] || "";
    }
    getNextQueryFromRegexMatches(backwards) {
      if (!this.groups.length) return "";
      let [row, col] = this.query.activeRegexIndices;
      col += backwards ? -1 : 1;
      if (col < 0) {
        row = (row + this.groups.length - 1) % this.groups.length;
        col = this.groups[row].values.length - 1;
      } else if (col >= this.groups[row].values.length) {
        row = (row + 1) % this.groups.length;
        col = 0;
      }
      this.query.activeRegexIndices = [row, col];
      return this.getQueryFromRegexMatches();
    }
    getQuery(backwards) {
      if (!this.query) return;
      const recent = this.history.getQuery();
      if (recent !== this.query.rawQuery) this.updateQuery(recent);
      return this.getNextQueryFromRegexMatches(backwards);
    }
    saveQuery() {
      return this.history.saveQuery(this.query.rawQuery);
    }
    execute(query, options = {}) {
      if (!this.query || this.closed) return false;
      if (query == null) query = this.getQuery(options.backwards);
      const color = options.colorSelection !== false;
      if (color) {
        document.body.classList.add("vimium-find-mode");
        this.selectionPending = true;
      }
      let found = false;
      const [row, col] = this.query.activeRegexIndices || [0, 0];
      const group = this.groups[row];
      const index = group?.indices[col];
      if (group?.node.isConnected && index != null) {
        try {
          const range = document.createRange();
          range.setStart(group.node, index);
          range.setEnd(group.node, index + query.length);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const rect = range.getBoundingClientRect();
          if (rect.top < 0 || rect.bottom > innerHeight) {
            scrollTo({
              top: scrollY + rect.top + rect.height / 2 - innerHeight / 2,
              behavior: "instant",
            });
          }
          found = true;
        } catch (_) {
          found = false;
        }
      }
      options.postFindFocus?.focus();
      if (color) this.resources.timeout(() => this.selectionPending = false, 0);
      if (
        DomUtils.isEditable(document.activeElement) && !DomUtils.isSelected(document.activeElement)
      ) document.activeElement.blur();
      return found;
    }
    focusFoundLink() {
      if (!this.query?.hasResults) return;
      let node = getSelection().anchorNode;
      while (node && node !== document.body) {
        if (node.nodeName.toLowerCase() === "a") {
          node.focus();
          return;
        }
        node = node.parentNode;
      }
    }
    handleEnter() {
      this.focusFoundLink();
      document.body.classList.add("vimium-find-mode");
      return this.saveQuery();
    }
    handleEscape() {
      document.body.classList.remove("vimium-find-mode");
      const selection = getSelection();
      if (!selection.isCollapsed && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      this.focusFoundLink();
      const element = document.activeElement;
      if (
        this.query?.hasResults && DomUtils.isSelectable(element) &&
        DomUtils.isDOMDescendant(selection.anchorNode, element)
      ) DomUtils.simulateSelect(element);
    }
    postFind() {
      if (DomUtils.isEditable(document.activeElement)) return new PostFindMode();
    }
    findNext(backwards) {
      const query = this.getQuery(backwards);
      if (!query) {
        HUD.show("No query to find.", 1000);
        return;
      }
      Marks.setPreviousPosition();
      this.query.hasResults = this.execute(query, { backwards });
      if (this.query.hasResults) {
        this.focusFoundLink();
        return this.postFind();
      }
      HUD.show(`No matches for '${this.query.rawQuery}'`, 1000);
    }
    commands() {
      const repeat = (backwards) => (count, { executionDeadline } = {}) => {
        for (let index = 0; index < count; index++) {
          if (executionDeadline && Date.now() >= executionDeadline) {
            throw new Error("EXECUTION_BUDGET_EXCEEDED");
          }
          this.findNext(backwards);
        }
      };
      const selected = (backwards) => async () => {
        const text = getSelection().toString();
        if (!text) return;
        this.updateQuery(text);
        await this.saveQuery();
        this.findNext(backwards);
      };
      return {
        enterFindMode: async () => {
          Marks.setPreviousPosition();
          return await new FindMode(this).ready;
        },
        performFind: repeat(false),
        performBackwardsFind: repeat(true),
        findSelected: selected(false),
        findSelectedBackwards: selected(true),
      };
    }
    destroy() {
      this.closed = true;
      this.history.destroy();
      // 只保留当前文档的一份公共查询视图，供同文档重建或整套兼容回退；新文档不会继承。
      if (globalThis.BrowserToolboxFindControllerInstance === this && this.query) {
        legacyQuery = this.query;
      }
      this.query = null;
      this.groups = [];
      document.body?.classList.remove("vimium-find-mode");
    }
  }
  class FindMode extends Mode {
    constructor(controller, options = {}) {
      super();
      this.controller = controller;
      this.sessionId = crypto.randomUUID();
      this.initialRange = currentRange();
      controller.query = { rawQuery: "" };
      controller.groups = [];
      this.scrollX = scrollX;
      this.scrollY = scrollY;
      super.init({
        ...options,
        name: "find",
        indicator: false,
        exitOnClick: true,
        exitOnEscape: true,
        suppressAllKeyboardEvents: true,
      });
      this.ready = HUD.showFindMode(this);
    }
    restoreSelection() {
      if (!this.initialRange?.startContainer.isConnected) return;
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(this.initialRange);
    }
    checkReturnToViewPort() {
      if (this.options.returnToViewport) scrollTo(this.scrollX, this.scrollY);
    }
    findInPlace(raw, options) {
      this.checkReturnToViewPort();
      this.controller.updateQuery(raw);
      this.restoreSelection();
      const query = this.controller.query.isRegex
        ? this.controller.getQueryFromRegexMatches()
        : this.controller.query.parsedQuery;
      this.controller.query.hasResults = this.controller.execute(query, options);
    }
    exit(event) {
      HUD.unfocusIfFocused();
      super.exit();
      if (event) this.controller.handleEscape();
    }
  }
  class PostFindMode extends Mode {
    constructor() {
      super();
      const element = document.activeElement;
      const mark = (event) => {
        InsertMode.suppressedEvent = event;
        return this.continueBubbling;
      };
      super.init({
        name: "post-find",
        singleton: "post-find-mode/focus-input",
        exitOnBlur: element,
        exitOnClick: true,
        keydown: mark,
        keypress: mark,
        keyup: mark,
      });
      const initialType = getSelection().type;
      const printable = (event) =>
        KeyboardUtils.isPrintable(event) ? this.suppressEvent : this.continueBubbling;
      this.unshift({
        keydown: printable,
        keypress: printable,
        keyup: () => {
          if (getSelection().type !== initialType) this.exit();
        },
      });
      this.push({
        keydown: (event) => {
          if (KeyboardUtils.isEscape(event)) {
            this.exit();
            return this.suppressEvent;
          }
          handlerStack.remove();
          return this.continueBubbling;
        },
      });
    }
  }
  // 兼容类只暴露公共查询视图；旧 Visual 使用相同接口，匹配与状态仍由新控制器持有。
  let legacyQuery = globalThis.FindMode?.query;
  if (globalThis.FindMode) {
    Object.defineProperty(globalThis.FindMode, "query", {
      configurable: true,
      get: () =>
        globalThis.BrowserToolboxFindControllerInstance
          ? BrowserToolboxFindControllerInstance.query
          : legacyQuery,
      set: (query) => {
        const controller = globalThis.BrowserToolboxFindControllerInstance;
        if (controller) controller.query = query;
        else legacyQuery = query;
      },
    });
  }
  globalThis.BrowserToolboxFindRuntime = { Controller, FindMode, PostFindMode, parse, textNodes };
})();
