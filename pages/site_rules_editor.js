// 站点规则编辑器：规则顺序、字段编辑和行操作集中处理，避免主设置控制器维护 DOM 细节。
/**
 * 站点规则编辑器依赖。
 * @typedef {Object} BrowserToolboxSiteRulesEditorOptions
 * @property {Element} body 规则表格 body。
 * @property {function(): Array<Object>} getRules 获取可变规则列表。
 * @property {function(string): string} message 本地化函数。
 * @property {function(Object): void} onChange 变更回调。
 * @property {Document} [documentRef] DOM 文档。
 */
(function () {
  const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
  const matcher = globalThis.BrowserToolboxSiteRuleMatcher;
  const clone = globalThis.BrowserToolboxValueUtils.clone;
  const schema = globalThis.BrowserToolboxSettingsSchema;

  function newId(prefix = "rule") {
    return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
  }

  /**
   * 检查站点规则的 glob/regex 匹配式。
   * @param {unknown} rule 待检查规则。
   * @returns {{key: string, code: string}|null} 校验错误或空值。
   */
  function validatePattern(rule) {
    const pattern = rule?.pattern;
    const matchType = rule?.matchType || "glob";
    if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 2048) {
      return { key: "validationInvalidSiteRule", code: "invalid" };
    }
    if (matchType === "regex") {
      const safety = globalThis.BrowserToolboxRegexSafety;
      const analysis = safety?.analyze?.(pattern);
      if (analysis && !analysis.ok) {
        return {
          key: analysis.code === "complexity"
            ? "validationRegexComplexity"
            : "validationInvalidRegex",
          code: analysis.code,
        };
      }
    }
    if (!matcher?.compile?.(pattern, matchType)) {
      return {
        key: matchType === "regex" ? "validationInvalidRegex" : "validationInvalidSiteRule",
        code: "invalid",
      };
    }
    return null;
  }

  class SiteRulesEditor {
    /**
     * 创建站点规则表格编辑器。
     * @param {BrowserToolboxSiteRulesEditorOptions} options 编辑器依赖。
     */
    constructor({ body, getRules, message, onChange, documentRef = globalThis.document }) {
      this.body = body;
      this.getRules = getRules;
      this.message = message;
      this.onChange = onChange;
      this.document = documentRef;
      this.body.addEventListener("input", (event) => this.handleField(event));
      this.body.addEventListener("change", (event) => this.handleField(event));
      this.body.addEventListener("click", (event) => this.handleAction(event));
    }

    ensureIds() {
      for (const rule of this.getRules()) rule.id ||= newId();
    }

    ruleFor(element) {
      const id = element.closest("tr")?.dataset.ruleId;
      return this.getRules().find((rule) => rule.id === id) || null;
    }

    button(labelKey, action, disabled = false) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "browser-toolbox-rule-action";
      if (action === "removeRule") button.classList.add("danger");
      button.dataset.action = action;
      button.textContent = this.message(labelKey);
      button.setAttribute("aria-label", this.message(labelKey));
      button.disabled = disabled;
      return button;
    }

    cell(value, className = "") {
      const cell = this.document.createElement("td");
      if (className) cell.className = className;
      const nodeConstructor = this.document?.defaultView?.Node || globalThis.Node;
      if (nodeConstructor && value instanceof nodeConstructor) cell.appendChild(value);
      else cell.textContent = value == null ? "" : String(value);
      return cell;
    }

    updatePatternValidation(row, rule) {
      const pattern = row?._pattern;
      const error = row?._patternError;
      if (!pattern || !error) return;
      const validation = validatePattern(rule);
      if (!validation) {
        pattern.removeAttribute("aria-invalid");
        error.hidden = true;
        error.textContent = "";
        return;
      }
      pattern.setAttribute("aria-invalid", "true");
      error.hidden = false;
      error.textContent = this.message(validation.key);
    }

    updateDuplicateWarning(row, diagnostic) {
      const warning = row?._patternWarning;
      if (!warning) return;
      const hasDuplicate = Boolean(diagnostic?.hasDuplicate);
      warning.hidden = !hasDuplicate;
      warning.textContent = hasDuplicate ? this.message("siteRuleDuplicateWarning") : "";
    }

    updateDuplicateWarnings() {
      const rules = this.getRules();
      const diagnostics = matcher?.diagnose?.(rules) || [];
      const rows = [...this.body.querySelectorAll("tr[data-rule-id]")];
      for (const [index, rule] of rules.entries()) {
        const row = rows.find((candidate) => candidate.dataset.ruleId === rule.id);
        this.updateDuplicateWarning(row, diagnostics[index]);
      }
    }

    profileInput(field, section, name, value) {
      const profile = this.ruleFor(field).profile;
      if (section === "meta") {
        if (value) profile[name] = value;
        else delete profile[name];
        return;
      }
      profile[section] ||= {};
      if (field.type === "checkbox") profile[section][name] = field.checked;
      else if (field.type === "number") {
        if (field.value === "") delete profile[section][name];
        else profile[section][name] = Number(field.value);
      } else if (name === "triggerButton") {
        if (field.value === "") delete profile[section][name];
        else profile[section][name] = Number(field.value);
      } else if (field.value === "") delete profile[section][name];
      else profile[section][name] = field.value;
    }

    profileSectionLabel(section) {
      return this.message({
        mouse: "siteProfileMouse",
        superDrag: "siteProfileSuperDrag",
        wheel: "siteProfileWheel",
        rocker: "rocker",
      }[section] || section);
    }

    profileField(labelKey, section, name, type, value, options = {}) {
      const label = this.document.createElement("label");
      label.className = "browser-toolbox-site-profile-field";
      const text = this.document.createElement("span");
      text.textContent = this.message(labelKey);
      const input = this.document.createElement(type === "select" ? "select" : "input");
      if (type !== "select") input.type = type;
      input.dataset.profileSection = section;
      input.dataset.profileField = name;
      input.setAttribute("aria-label", this.message(labelKey));
      if (type === "checkbox") {
        input.checked = Boolean(value);
        input.indeterminate = value == null;
        label.classList.add("browser-toolbox-check");
      } else if (type === "select") {
        for (const [optionValue, optionLabel] of options.options || []) {
          const option = this.document.createElement("option");
          option.value = optionValue;
          option.textContent = this.message(optionLabel);
          input.appendChild(option);
        }
        input.value = value == null ? "" : String(value);
      } else {
        if (value != null) input.value = String(value);
        if (options.min != null) input.min = String(options.min);
        if (options.max != null) input.max = String(options.max);
        input.step = "1";
      }
      label.append(text, input);
      return label;
    }

    renderProfile(rule) {
      const profile = rule.profile || {};
      const details = this.document.createElement("details");
      details.className = "browser-toolbox-site-rule-profile";
      details.open = Boolean(rule.profile);
      const summary = this.document.createElement("summary");
      summary.textContent = this.message("siteRuleProfile");
      const hint = this.document.createElement("p");
      hint.className = "browser-toolbox-site-profile-hint";
      hint.textContent = this.message("siteRuleProfileHint");
      const meta = this.document.createElement("div");
      meta.className = "browser-toolbox-site-profile-meta";
      meta.append(
        this.profileField("siteRuleProfile", "meta", "preset", "select", profile.preset, {
          options: [
            ["", "siteRuleProfileInherit"],
            ...Object.entries(schema?.SITE_PROFILE_PRESETS || {}).map(([value, preset]) => [
              value,
              preset.labelKey,
            ]),
            ["custom", "siteRuleProfileCustom"],
          ],
        }),
        this.profileField("siteProfileName", "meta", "name", "text", profile.name),
      );
      const sections = this.document.createElement("div");
      sections.className = "browser-toolbox-site-profile-sections";
      const mouse = this.document.createElement("fieldset");
      mouse.className = "browser-toolbox-site-profile-section";
      const mouseLegend = this.document.createElement("legend");
      mouseLegend.textContent = this.profileSectionLabel("mouse");
      mouse.appendChild(mouseLegend);
      mouse.append(
        this.profileField("siteProfileEnabled", "mouse", "enabled", "checkbox", profile.mouse?.enabled),
        this.profileField("siteProfileTriggerButton", "mouse", "triggerButton", "select", profile.mouse?.triggerButton, {
          options: [["0", "leftButton"], ["1", "middleButton"], ["2", "rightButton"]],
        }),
        this.profileField("siteProfileActivationDistance", "mouse", "activationDistancePx", "number", profile.mouse?.activationDistancePx, { min: 1, max: 200 }),
        this.profileField("siteProfileMinimumSegmentDistance", "mouse", "minimumSegmentDistancePx", "number", profile.mouse?.minimumSegmentDistancePx, { min: 2, max: 500 }),
        this.profileField("siteProfileShowTrail", "mouse", "showTrail", "checkbox", profile.mouse?.showTrail),
        this.profileField("siteProfileShowHud", "mouse", "showCommandHud", "checkbox", profile.mouse?.showCommandHud),
      );
      const superDrag = this.document.createElement("fieldset");
      superDrag.className = "browser-toolbox-site-profile-section";
      const superDragLegend = this.document.createElement("legend");
      superDragLegend.textContent = this.profileSectionLabel("superDrag");
      superDrag.append(
        superDragLegend,
        this.profileField("siteProfileEnabled", "superDrag", "enabled", "checkbox", profile.superDrag?.enabled),
        this.profileField("siteProfileBypassModifier", "superDrag", "nativeBypassModifier", "select", profile.superDrag?.nativeBypassModifier, {
          options: [["Alt", "modifierAlt"], ["Control", "modifierControl"], ["Meta", "modifierMeta"], ["Shift", "modifierShift"]],
        }),
      );
      const wheel = this.document.createElement("fieldset");
      wheel.className = "browser-toolbox-site-profile-section";
      const wheelLegend = this.document.createElement("legend");
      wheelLegend.textContent = this.profileSectionLabel("wheel");
      wheel.append(
        wheelLegend,
        this.profileField("siteProfileEnabled", "wheel", "enabled", "checkbox", profile.wheel?.enabled),
        this.profileField("siteProfileWheelThreshold", "wheel", "threshold", "number", profile.wheel?.threshold, { min: 10, max: 2000 }),
        this.profileField("siteProfileCooldown", "wheel", "cooldownMs", "number", profile.wheel?.cooldownMs, { min: 0, max: 5000 }),
      );
      const rocker = this.document.createElement("fieldset");
      rocker.className = "browser-toolbox-site-profile-section";
      const rockerLegend = this.document.createElement("legend");
      rockerLegend.textContent = this.profileSectionLabel("rocker");
      rocker.append(
        rockerLegend,
        this.profileField("siteProfileEnabled", "rocker", "enabled", "checkbox", profile.rocker?.enabled),
      );
      sections.append(mouse, superDrag, wheel, rocker);
      details.append(summary, hint, meta, sections);
      return details;
    }

    /**
     * 重绘全部规则行。
     * @returns {void}
     */
    render() {
      this.ensureIds();
      const rules = this.getRules();
      const diagnostics = matcher?.diagnose?.(rules) || rules.map((_, index) => ({
        index,
        duplicateIndexes: [],
        hasDuplicate: false,
      }));
      this.body.replaceChildren();
      if (rules.length === 0) {
        const row = this.document.createElement("tr");
        row.className = "browser-toolbox-site-rule-empty-row";
        const empty = this.document.createElement("td");
        empty.colSpan = 5;
        empty.className = "browser-toolbox-empty-state";
        empty.textContent = this.message("siteRuleNoRules");
        row.appendChild(empty);
        this.body.appendChild(row);
        return;
      }
      for (const [index, rule] of rules.entries()) {
        this.renderRow(rule, index, rules.length, diagnostics[index]);
      }
    }

    renderRow(rule, index, count, diagnostic = null) {
      const row = this.document.createElement("tr");
      row.className = "browser-toolbox-site-rule-card";
      row.dataset.ruleId = rule.id;
      const matchType = this.document.createElement("select");
      matchType.dataset.field = "matchType";
      matchType.setAttribute("aria-label", this.message("siteRuleMatchType"));
      for (const [value, labelKey] of [["glob", "siteRuleGlob"], ["regex", "siteRuleRegex"]]) {
        const option = this.document.createElement("option");
        option.value = value;
        option.textContent = this.message(labelKey);
        matchType.appendChild(option);
      }
      matchType.value = rule.matchType === "regex" ? "regex" : "glob";
      const matchTypeLabel = this.document.createElement("span");
      matchTypeLabel.className = "browser-toolbox-rule-field-label";
      matchTypeLabel.textContent = this.message("siteRuleMatchType");
      const matchTypeCell = this.cell(matchType, "browser-toolbox-rule-match-cell");
      matchTypeCell.prepend(matchTypeLabel);

      const pattern = this.document.createElement("input");
      pattern.type = "text";
      pattern.dataset.field = "pattern";
      pattern.value = rule.pattern || "";
      pattern.placeholder = this.message(
        matchType.value === "regex" ? "siteRuleRegexHint" : "siteRuleGlobHint",
      );
      pattern.setAttribute("aria-label", this.message("urlPattern"));
      const patternError = this.document.createElement("div");
      patternError.className = "browser-toolbox-site-rule-error";
      patternError.id = "browser-toolbox-site-rule-error-" + rule.id;
      patternError.setAttribute("role", "status");
      patternError.setAttribute("aria-live", "polite");
      const patternWarning = this.document.createElement("div");
      patternWarning.className = "browser-toolbox-site-rule-warning";
      patternWarning.id = "browser-toolbox-site-rule-warning-" + rule.id;
      patternWarning.setAttribute("role", "status");
      patternWarning.hidden = true;
      pattern.setAttribute("aria-describedby", `${patternError.id} ${patternWarning.id}`);
      const patternLabel = this.document.createElement("span");
      patternLabel.className = "browser-toolbox-rule-field-label";
      patternLabel.textContent = this.message("urlPattern");
      const patternCell = this.cell(pattern, "browser-toolbox-rule-pattern-cell");
      patternCell.prepend(patternLabel);
      patternCell.append(patternError, patternWarning);

      const enabledLabel = this.document.createElement("label");
      enabledLabel.className = "browser-toolbox-switch";
      const enabled = this.document.createElement("input");
      enabled.type = "checkbox";
      enabled.dataset.field = "enabled";
      enabled.checked = rule.enabled !== false;
      enabled.setAttribute("aria-label", this.message("siteRuleEnabled"));
      enabledLabel.append(
        enabled,
        this.document.createTextNode(this.message("siteRuleEnabled")),
      );
      const enabledCell = this.cell(enabledLabel, "browser-toolbox-rule-enabled-cell");

      const modules = this.document.createElement("div");
      modules.className = "browser-toolbox-site-rule-modules";
      modules.setAttribute("aria-label", this.message("siteRuleDisableModules"));
      modules.setAttribute("aria-describedby", "site-rule-module-help");
      const modulesTitle = this.document.createElement("span");
      modulesTitle.className = "browser-toolbox-rule-section-label";
      modulesTitle.textContent = this.message("siteRuleDisableModules");
      const moduleOptions = this.document.createElement("div");
      moduleOptions.className = "browser-toolbox-site-rule-module-options";
      for (const module of moduleRegistry.entries({ siteRule: true })) {
        const label = this.document.createElement("label");
        label.className = "browser-toolbox-check";
        const checkbox = this.document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.module = module.id;
        checkbox.checked = rule.modules?.[module.id] === false;
        checkbox.setAttribute("aria-label", this.message(module.labelKey));
        label.append(checkbox, this.document.createTextNode(this.message(module.labelKey)));
        moduleOptions.appendChild(label);
      }
      modules.append(modulesTitle, moduleOptions, this.renderProfile(rule));
      const modulesCell = this.cell(modules, "browser-toolbox-rule-modules-cell");

      const priority = this.document.createElement("div");
      priority.className = "browser-toolbox-rule-actions";
      const rank = this.document.createElement("span");
      rank.className = "browser-toolbox-rule-priority";
      rank.textContent = `${this.message("siteRuleOrder")}: ${index + 1}`;
      priority.append(
        rank,
        this.button("moveUp", "moveUp", index === 0),
        this.button("moveDown", "moveDown", index === count - 1),
        this.button("duplicateRule", "duplicateRule"),
        this.button("removeRule", "removeRule"),
      );
      const actionCell = this.cell(priority, "browser-toolbox-rule-action-cell");
      row.append(
        matchTypeCell,
        patternCell,
        enabledCell,
        modulesCell,
        actionCell,
      );
      row._pattern = pattern;
      row._patternError = patternError;
      row._patternWarning = patternWarning;
      this.updatePatternValidation(row, rule);
      this.updateDuplicateWarning(row, diagnostic);
      this.body.appendChild(row);
    }

    /**
     * 处理规则字段输入/变更事件。
     * @param {Event} event DOM 事件。
     * @returns {void}
     */
    handleField(event) {
      const field = event.target.closest?.("[data-field], [data-module], [data-profile-field]");
      if (!field) return;
      const rule = this.ruleFor(field);
      if (!rule) return;
      if (field.dataset.profileField) {
        const section = field.dataset.profileSection;
        const name = field.dataset.profileField;
        const value = field.type === "checkbox" ? field.checked : field.value;
        if (section === "meta" && name === "preset") {
          if (!value) delete rule.profile;
          else if (value !== "custom" && schema?.SITE_PROFILE_PRESETS?.[value]) {
            rule.profile = clone(schema.SITE_PROFILE_PRESETS[value].profile);
          } else {
            rule.profile ||= {};
            rule.profile.preset = "custom";
          }
          this.render();
          this.onChange({ type: "profile", rule });
          return;
        }
        rule.profile ||= { preset: "custom" };
        rule.profile.preset = "custom";
        this.profileInput(field, section, name, value);
        this.onChange({ type: "profile", rule });
        return;
      }
      if (field.dataset.field === "pattern") rule.pattern = field.value;
      if (field.dataset.field === "matchType") {
        rule.matchType = field.value;
        const pattern = field.closest("tr")?.querySelector("[data-field='pattern']");
        if (pattern) {
          pattern.placeholder = this.message(
            field.value === "regex" ? "siteRuleRegexHint" : "siteRuleGlobHint",
          );
        }
      }
      if (field.dataset.field === "enabled") rule.enabled = field.checked;
      if (field.dataset.module) {
        rule.modules ||= {};
        if (field.checked) rule.modules[field.dataset.module] = false;
        else delete rule.modules[field.dataset.module];
      }
      if (field.dataset.field === "pattern" || field.dataset.field === "matchType") {
        this.updatePatternValidation(field.closest("tr"), rule);
        this.updateDuplicateWarnings();
      }
      this.onChange({ type: "field", rule });
    }

    /**
     * 处理规则移动、复制和删除操作。
     * @param {Event} event DOM 事件。
     * @returns {void}
     */
    handleAction(event) {
      const button = event.target.closest?.("button[data-action]");
      if (!button || button.disabled) return;
      const rule = this.ruleFor(button);
      if (!rule) return;
      const rules = this.getRules();
      const index = rules.indexOf(rule);
      if (button.dataset.action === "removeRule") rules.splice(index, 1);
      if (button.dataset.action === "moveUp" && index > 0) {
        [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
      }
      if (button.dataset.action === "moveDown" && index < rules.length - 1) {
        [rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
      }
      if (button.dataset.action === "duplicateRule") {
        const copy = clone(rule);
        copy.id = newId();
        rules.splice(index + 1, 0, copy);
      }
      this.render();
      this.onChange({ type: button.dataset.action, rule });
    }
  }

  globalThis.BrowserToolboxSiteRulesEditor = Object.freeze({
    SiteRulesEditor,
    newId,
    validatePattern,
  });
})();
