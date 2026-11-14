// The table-editor used for exclusion rules.
const preservedExclusionRules = new WeakMap();
let preservedExclusionWarningId = 0;

const ExclusionRulesEditor = {
  // When the Add rule button is clicked, use this as the pattern for the new rule. This is used by
  // the action.html toolbar popup.
  defaultPatternForNewRules: null,

  init() {
    document.querySelector("#exclusion-add-button").addEventListener("click", () => {
      this.addRow(this.defaultPatternForNewRules);
      this.dispatchEvent("input");
    });
  },

  // - exclusionRules: the value obtained from settings, with the shape [{pattern, passKeys}].
  setForm(exclusionRules = []) {
    const rulesTable = document.querySelector("#exclusion-rules");
    // Remove any previous rows.
    const existingRuleEls = rulesTable.querySelectorAll(".rule");
    for (const el of existingRuleEls) {
      el.remove();
    }

    for (const rule of exclusionRules) {
      this.addRow(rule.pattern, rule.passKeys, rule);
    }
  },

  // `pattern` and `passKeys` are optional.
  addRow(pattern, passKeys, originalRule = null) {
    const rulesTable = document.querySelector("#exclusion-rules");
    const rowTemplate = document.querySelector("#exclusion-rule-template").content;
    const rowEl = rowTemplate.cloneNode(true);

    const patternEl = rowEl.querySelector("[name=pattern]");
    patternEl.value = pattern ?? "";
    const i18n = globalThis.BrowserToolboxI18n;
    if (i18n) {
      patternEl.placeholder = i18n.message("urlPattern");
      patternEl.setAttribute("aria-label", i18n.message("urlPattern"));
    }
    patternEl.addEventListener("input", () => this.dispatchEvent("input"));

    const keysEl = rowEl.querySelector("[name=passKeys]");
    keysEl.value = passKeys ?? "";
    if (i18n) {
      keysEl.placeholder = i18n.message("allKeys");
      keysEl.setAttribute("aria-label", i18n.message("keysToExclude"));
    }
    keysEl.addEventListener("input", () => this.dispatchEvent("input"));

    const removeButton = rowEl.querySelector(".remove");
    if (i18n) {
      removeButton?.setAttribute(
        "aria-label",
        i18n.message("removeRule"),
      );
    }
    if (
      originalRule &&
      Object.keys(originalRule).some((key) => key !== "pattern" && key !== "passKeys")
    ) {
      // 未知附加字段无法安全编辑；行快照随行保留，防止保存或导出时丢失。
      const row = rowEl.querySelector("tr.rule");
      preservedExclusionRules.set(row, structuredClone(originalRule));
      patternEl.readOnly = keysEl.readOnly = true;
      removeButton.disabled = true;
      const warning = document.createElement("div");
      warning.className = "exclusion-preserved-warning";
      warning.id = `browser-toolbox-exclusion-preserved-${++preservedExclusionWarningId}`;
      warning.textContent = i18n?.message("exclusionRulePreserved") ||
        "This rule contains unsupported fields and is preserved as read-only. Restore its backup with a version that supports those fields.";
      patternEl.setAttribute("aria-describedby", warning.id);
      keysEl.setAttribute("aria-describedby", warning.id);
      patternEl.parentElement.append(warning);
    }
    removeButton.addEventListener("click", (e) => {
      e.target.closest("tr").remove();
      this.dispatchEvent("input");
    });
    rulesTable.appendChild(rowEl);
  },

  // Returns an array of rules, which can be stored in Settings.
  getRules() {
    const rows = Array.from(document.querySelectorAll("#exclusion-rules tr.rule"));
    return rows.flatMap((el) => {
      const preserved = preservedExclusionRules.get(el);
      if (preserved) return [structuredClone(preserved)];
      const rule = {
        // The ordering of these keys should match the order in defaultOptions in Settings.js.
        passKeys: el.querySelector("[name=passKeys]").value.trim(),
        pattern: el.querySelector("[name=pattern]").value.trim(),
      };
      return rule.pattern ? [rule] : [];
    });
  },
};

Object.assign(ExclusionRulesEditor, EventDispatcher);

export { ExclusionRulesEditor };
