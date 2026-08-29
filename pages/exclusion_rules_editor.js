// The table-editor used for exclusion rules.
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

    const rowTemplate = document.querySelector("#exclusion-rule-template").content;
    for (const rule of exclusionRules) {
      this.addRow(rule.pattern, rule.passKeys);
    }
  },

  // `pattern` and `passKeys` are optional.
  addRow(pattern, passKeys) {
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

    if (i18n) {
      rowEl.querySelector(".remove")?.setAttribute(
        "aria-label",
        i18n.message("removeRule"),
      );
    }
    rowEl.querySelector(".remove").addEventListener("click", (e) => {
      e.target.closest("tr").remove();
      this.dispatchEvent("input");
    });
    rulesTable.appendChild(rowEl);
  },

  // Returns an array of rules, which can be stored in Settings.
  getRules() {
    const rows = Array.from(document.querySelectorAll("#exclusion-rules tr.rule"));
    const rules = rows
      .map((el) => {
        return {
          // The ordering of these keys should match the order in defaultOptions in Settings.js.
          passKeys: el.querySelector("[name=passKeys]").value.trim(),
          pattern: el.querySelector("[name=pattern]").value.trim(),
        };
      })
      // Exclude blank patterns.
      .filter((rule) => rule.pattern);
    return rules;
  },
};

Object.assign(ExclusionRulesEditor, EventDispatcher);

export { ExclusionRulesEditor };
