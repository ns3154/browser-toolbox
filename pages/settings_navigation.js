// 设置页层级导航：导航结构来自分区注册表，一级分类负责分组，二级页面负责切换面板。
/**
 * 层级导航控制器依赖。
 * @typedef {Object} BrowserToolboxNavigationOptions
 * @property {function(string, Element): void} [onActivate] 激活回调。
 * @property {Object} [sections] 分区注册表。
 * @property {Document} [documentRef] DOM 文档。
 */
(function () {
  class SettingsNavigation {
    /**
     * 创建设置页层级导航。
     * @param {Element} root 导航根节点。
     * @param {BrowserToolboxNavigationOptions} [options] 导航选项。
     */
    constructor(
      root,
      { onActivate = () => {}, sections = null, documentRef = globalThis.document } = {},
    ) {
      this.root = root;
      this.document = documentRef;
      this.sections = sections;
      this.onActivate = onActivate;
      this.activeButton = null;
      this.searchQuery = "";
      if (this.sections?.SECTIONS?.length || this.sections?.sections?.length) this.render();
      this.refreshElements();
      this.handleHashChange = () => {
        const name = this.sectionFromHash();
        const button = this.buttons.find((item) => item.dataset.section === name);
        if (button) this.activate(button, { updateHash: false });
      };
    }

    render() {
      if (
        !this.root || !this.document ||
        !(this.sections?.SECTIONS?.length || this.sections?.sections?.length)
      ) return;
      const groups = new Map();
      for (const group of this.sections.GROUPS || this.sections.groups || []) {
        groups.set(group.id, group);
      }
      const sectionsByGroup = new Map();
      for (const section of this.sections.SECTIONS || this.sections.sections || []) {
        if (!sectionsByGroup.has(section.group)) sectionsByGroup.set(section.group, []);
        sectionsByGroup.get(section.group).push(section);
      }
      this.root.replaceChildren();
      for (const group of groups.values()) {
        const groupElement = this.document.createElement("div");
        groupElement.className = "browser-toolbox-nav-group";
        groupElement.dataset.navGroup = group.id;

        const category = this.document.createElement("button");
        category.id = `browser-toolbox-nav-category-${group.id}`;
        category.className = "browser-toolbox-nav-category";
        category.type = "button";
        category.dataset.navCategory = group.id;
        category.setAttribute("aria-expanded", "false");
        category.setAttribute("aria-controls", `browser-toolbox-subnav-${group.id}`);
        const chevron = this.document.createElement("span");
        chevron.className = "browser-toolbox-nav-chevron";
        chevron.setAttribute("aria-hidden", "true");
        const label = this.document.createElement("span");
        label.dataset.i18n = group.labelKey;
        category.append(chevron, label);

        const subnav = this.document.createElement("div");
        subnav.id = `browser-toolbox-subnav-${group.id}`;
        subnav.className = "browser-toolbox-nav-items";
        subnav.setAttribute("role", "tablist");
        subnav.setAttribute("aria-orientation", "vertical");
        subnav.setAttribute("aria-labelledby", category.id);
        subnav.dataset.i18nAriaLabel = group.labelKey;
        subnav.hidden = true;
        for (const section of sectionsByGroup.get(group.id) || []) {
          const button = this.document.createElement("button");
          button.className = "browser-toolbox-nav-item";
          button.type = "button";
          button.dataset.section = section.id;
          button.setAttribute("aria-selected", "false");
          button.dataset.i18n = section.labelKey;
          subnav.appendChild(button);
        }
        groupElement.append(category, subnav);
        this.root.appendChild(groupElement);
      }
      this.refreshElements();
    }

    refreshElements() {
      this.groups = [...(this.root?.querySelectorAll?.(".browser-toolbox-nav-group") || [])];
      this.categories = [...(this.root?.querySelectorAll?.("[data-nav-category]") || [])];
      this.buttons = [
        ...(this.root?.querySelectorAll?.(".browser-toolbox-nav-item[data-section]") || []),
      ];
      this.panels = [...(this.document?.querySelectorAll?.("[data-panel]") || [])];
    }

    visibleCategories() {
      return this.categories.filter((category) =>
        !category.closest(".browser-toolbox-nav-group")?.hidden
      );
    }

    visibleButtons() {
      return this.buttons.filter((button) =>
        !button.hidden && !button.closest(".browser-toolbox-nav-group")?.hidden
      );
    }

    focusableButtons() {
      return this.visibleButtons().filter((button) =>
        !button.closest(".browser-toolbox-nav-items")?.hidden
      );
    }

    sectionSearchText(button) {
      const section = button?.dataset.section || "";
      const metadata = (this.sections?.SECTIONS || this.sections?.sections || [])
        .find((candidate) => candidate.id === section);
      const i18n = globalThis.BrowserToolboxI18n;
      // 分区注册表同时维护搜索关键词；保存字段值不会改变索引，新增分区时也不会依赖
      // 隐藏面板的动态内容，避免用户输入或规则数据污染导航结果。
      return [
        button?.textContent || "",
        section,
        ...(metadata?.searchKeys || []).flatMap((key) => [
          key,
          i18n?.message?.(key) || key,
        ]),
      ].join(" ").toLocaleLowerCase();
    }

    /**
     * 按关键词筛选一级分类和二级分区。
     * @param {string} [query] 搜索词。
     * @returns {{query: string, matchedSections: number, totalSections: number}} 筛选结果。
     */
    filter(query = "") {
      this.searchQuery = String(query).trim();
      const normalized = this.searchQuery.toLocaleLowerCase();
      let matchedSections = 0;
      for (const group of this.groups) {
        const category = group.querySelector("[data-nav-category]");
        const groupText = `${category?.textContent || ""} ${group.dataset.navGroup || ""}`
          .toLocaleLowerCase();
        const groupMatches = !normalized || groupText.includes(normalized);
        const buttons = [...group.querySelectorAll(".browser-toolbox-nav-item[data-section]")];
        let groupMatchesCount = 0;
        for (const button of buttons) {
          const sectionText = this.sectionSearchText(button);
          const matched = !normalized || groupMatches || sectionText.includes(normalized);
          button.hidden = !matched;
          if (matched) groupMatchesCount += 1;
        }
        group.hidden = groupMatchesCount === 0;
        this.setGroupExpanded(
          group,
          groupMatchesCount > 0 &&
            (Boolean(normalized) || group === this.activeButton?.closest(
                  ".browser-toolbox-nav-group",
                )),
        );
        matchedSections += groupMatchesCount;
      }
      const visible = this.focusableButtons();
      const activeIsVisible = visible.includes(this.activeButton);
      for (const button of this.buttons) {
        button.setAttribute(
          "tabindex",
          button === this.activeButton && activeIsVisible ? "0" : "-1",
        );
      }
      if (!activeIsVisible) visible[0]?.setAttribute("tabindex", "0");
      return { query: this.searchQuery, matchedSections, totalSections: this.buttons.length };
    }

    /**
     * 绑定键盘和 hash 导航事件。
     * @returns {SettingsNavigation} 当前控制器。
     */
    init() {
      this.root.setAttribute("role", "navigation");
      this.root.setAttribute("aria-orientation", "vertical");
      this.categories.forEach((category) => this.configureCategory(category));
      this.buttons.forEach((button, index) => this.configureButton(button, index));
      const hashButton = this.buttons.find((button) =>
        button.dataset.section === this.sectionFromHash()
      );
      const selectedButton = this.buttons.find((button) =>
        button.getAttribute("aria-selected") === "true"
      );
      this.activate(hashButton || selectedButton || this.buttons[0], { updateHash: false });
      globalThis.addEventListener?.("hashchange", this.handleHashChange);
      return this;
    }

    sectionFromHash() {
      const value = globalThis.location?.hash?.slice(1) || "";
      try {
        return decodeURIComponent(value);
      } catch (_) {
        return value;
      }
    }

    configureCategory(category) {
      category.addEventListener("click", () => {
        const group = category.closest(".browser-toolbox-nav-group");
        if (category.getAttribute("aria-expanded") === "true") {
          this.setGroupExpanded(group, false);
          category.focus();
          return;
        }
        const first = group?.querySelector(".browser-toolbox-nav-item[data-section]");
        if (first) this.activate(first, { focus: true });
      });
      category.addEventListener("keydown", (event) => {
        if (
          event.key === "ArrowRight" ||
          (event.key === "ArrowDown" && category.getAttribute("aria-expanded") !== "true")
        ) {
          event.preventDefault();
          const group = category.closest(".browser-toolbox-nav-group");
          const first = [
            ...(group?.querySelectorAll(
              ".browser-toolbox-nav-item[data-section]",
            ) || []),
          ].find((item) => !item.hidden);
          if (first) this.activate(first, { focus: true });
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          this.setGroupExpanded(category.closest(".browser-toolbox-nav-group"), false);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          const categories = this.visibleCategories();
          const target = event.key === "Home" ? categories[0] : categories.at(-1);
          target?.focus();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const categories = this.visibleCategories();
          const currentIndex = categories.indexOf(category);
          if (currentIndex < 0 || categories.length === 0) return;
          const nextIndex = currentIndex + (event.key === "ArrowDown" ? 1 : -1);
          categories.at((nextIndex + categories.length) % categories.length)?.focus();
        }
      });
    }

    configureButton(button, index) {
      const name = button.dataset.section;
      const panel = this.panels.find((candidate) => candidate.dataset.panel === name);
      const tabId = `browser-toolbox-tab-${name}`;
      const panelId = `browser-toolbox-panel-${name}`;
      button.id = tabId;
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panelId);
      button.setAttribute("tabindex", index === 0 ? "0" : "-1");
      if (panel) {
        panel.id = panelId;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tabId);
        panel.tabIndex = 0;
      }
      button.addEventListener("click", () => this.activate(button));
      button.addEventListener("keydown", (event) => {
        const buttons = this.visibleButtons();
        const current = buttons.indexOf(button);
        if (current < 0) return;
        let next = null;
        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          next = buttons[current + 1] || buttons[0];
        } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          next = buttons[current - 1] || buttons.at(-1);
        } else if (event.key === "Home") {
          next = buttons[0];
        } else if (event.key === "End") {
          next = buttons.at(-1);
        }
        if (!next) return;
        event.preventDefault();
        this.activate(next, { focus: true });
      });
    }

    setGroupExpanded(group, expanded) {
      const category = group?.querySelector("[data-nav-category]");
      const subnav = group?.querySelector(".browser-toolbox-nav-items");
      category?.setAttribute("aria-expanded", String(expanded));
      if (subnav) subnav.hidden = !expanded;
    }

    expandOnly(group) {
      for (const item of this.groups) this.setGroupExpanded(item, item === group);
    }

    /**
     * 激活一个二级设置分区。
     * @param {Element|null} button 目标导航按钮。
     * @param {{focus?: boolean, updateHash?: boolean}} [options] 激活选项。
     * @returns {void}
     */
    activate(button, { focus = false, updateHash = true } = {}) {
      if (!button) return;
      const name = button.dataset.section;
      const group = button.closest(".browser-toolbox-nav-group");
      this.expandOnly(group);
      for (const item of this.buttons) {
        const selected = item === button;
        item.setAttribute("aria-selected", String(selected));
        item.setAttribute("tabindex", selected ? "0" : "-1");
      }
      for (const panel of this.panels) panel.hidden = panel.dataset.panel !== name;
      this.activeButton = button;
      if (updateHash && globalThis.history?.replaceState) {
        globalThis.history.replaceState(null, "", `#${encodeURIComponent(name)}`);
      }
      if (focus) button.focus();
      this.onActivate(name, button);
    }
  }

  globalThis.BrowserToolboxSettingsNavigation = Object.freeze({ SettingsNavigation });
})();
