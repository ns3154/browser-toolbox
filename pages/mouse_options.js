// BrowserToolbox 设置页控制器。命令下拉框从后台注册表读取，不维护第二份命令清单。
(function () {
  const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
  const vimiumSettings = globalThis.BrowserToolboxVimiumSettingsAdapterInstance;
  const schema = globalThis.BrowserToolboxSettingsSchema;
  const validator = globalThis.BrowserToolboxSettingsValidator;
  const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
  const toolSettingsApi = globalThis.BrowserToolboxToolSettings;
  const quantizer = globalThis.BrowserToolboxDirectionQuantizer;
  const draftApi = globalThis.BrowserToolboxSettingsDraft;
  const applicationServiceApi = globalThis.BrowserToolboxSettingsApplicationService;
  const sectionsApi = globalThis.BrowserToolboxSettingsSections;
  const navigationApi = globalThis.BrowserToolboxSettingsNavigation;
  const changeSummaryApi = globalThis.BrowserToolboxSettingsChangeSummary;
  const siteRulesApi = globalThis.BrowserToolboxSiteRulesEditor;
  const bindingEditorApi = globalThis.BrowserToolboxBindingEditor;
  const settingsService = new applicationServiceApi.SettingsApplicationService({
    repository,
    vimiumSettings,
  });
  let settings;
  let draft;
  let registry;
  let editor;
  let bindingEditor;
  let navigation;
  let siteRulesEditor;
  let previewPattern = [];
  let pendingCursorAsset = null;
  let cursorResetRequested = false;
  let operationInProgress = false;
  const directionMessageKeys = Object.freeze({
    U: "gestureDirectionUp",
    D: "gestureDirectionDown",
    L: "gestureDirectionLeft",
    R: "gestureDirectionRight",
  });
  const mouseGestureCardDefinitions = Object.freeze([
    { pattern: ["U"], arrow: "↑", direction: "gestureDirectionUp" },
    { pattern: ["R"], arrow: "→", direction: "gestureDirectionRight" },
    { pattern: ["L"], arrow: "←", direction: "gestureDirectionLeft" },
    { pattern: ["D"], arrow: "↓", direction: "gestureDirectionDown" },
  ]);

  function message(key) {
    return globalThis.BrowserToolboxI18n?.message(key) || key;
  }

  function formatValidationErrors(errors) {
    const formatter = globalThis.BrowserToolboxI18n?.formatValidationErrors;
    return formatter ? formatter(errors) : errors.join("\n");
  }

  function settingsSectionLabels() {
    return {
      general: message("general"),
      keyboard: message("keyboard"),
      mouse: message("mouseGestures"),
      superDrag: message("superDrag"),
      wheel: message("wheelRocker"),
      rocker: message("rocker"),
      cursor: message("cursor"),
      siteRules: message("siteRules"),
      privacy: message("privacy"),
      toolsOverview: message("toolsOverview"),
      jsonFormatter: message("jsonFormatter"),
      textDiff: message("textDiff"),
      codecTransform: message("codecTransform"),
      timeAndId: message("timeAndId"),
      appearance: message("appearance"),
      backupAbout: message("backupAbout"),
    };
  }

  function formatConflictDetails(error) {
    const domainLabels = {
      BrowserToolbox: message("browserToolbox"),
      browserToolbox: message("browserToolbox"),
      Vimium: "Vimium",
      vimium: "Vimium",
    };
    return (error?.conflicts || []).map((conflict) => {
      const fields = (conflict.paths || []).map((path) =>
        changeSummaryApi?.formatPath(path, settingsSectionLabels()) || path
      );
      if (conflict.truncated) fields.push(message("settingsConflictMore"));
      const label = domainLabels[conflict.name] || conflict.name;
      return fields.length > 0 ? `${label}: ${fields.join(", ")}` : label;
    });
  }

  function formatSettingsError(error) {
    if (error?.code === "browser-toolbox-settings-conflict") {
      const details = formatConflictDetails(error);
      return [
        message("settingsConflict"),
        details.length > 0 ? `${message("settingsConflictFields")}: ${details.join("; ")}` : "",
      ].filter(Boolean).join("\n");
    }
    if (error?.rollbackErrors?.length > 0) {
      return `${error.message}\n${message("settingsRecoveryFailed")}`;
    }
    return error?.message || String(error);
  }

  function updateDraftStatus() {
    const dirty = Boolean(draft?.isDirty);
    const saveButton = document.querySelector("#save-settings");
    const discardButton = document.querySelector("#discard-changes");
    const dirtyStatus = document.querySelector("#dirty-status");
    if (saveButton) saveButton.disabled = operationInProgress || !dirty;
    if (discardButton) discardButton.disabled = operationInProgress || !dirty;
    if (dirtyStatus) dirtyStatus.textContent = dirty ? message("unsavedChanges") : "";
  }

  function setOperationBusy(busy) {
    operationInProgress = busy;
    const main = document.querySelector(".browser-toolbox-main");
    if (main) {
      if (busy) {
        main.setAttribute("aria-busy", "true");
        main.setAttribute("inert", "");
      } else {
        main.removeAttribute("aria-busy");
        main.removeAttribute("inert");
      }
    }
    for (const selector of ["#restore-defaults", "#import-settings"]) {
      const element = document.querySelector(selector);
      if (element) element.disabled = busy;
    }
    updateDraftStatus();
  }

  function updateSettingsSearchStatus(result) {
    const input = document.querySelector("#settings-section-search");
    const status = document.querySelector("#settings-search-status");
    if (!input || !status || !input.value.trim()) {
      if (status) status.textContent = "";
      return;
    }
    status.textContent = result?.matchedSections === 0
      ? message("settingsSearchNoResults")
      : `${message("settingsSearchMatches")}: ${result.matchedSections}`;
  }

  function applySettingsLocale() {
    BrowserToolboxI18n.setLocale(settings.general.language);
    BrowserToolboxI18n.apply(document);
    renderMouseEnabledStatus();
    renderMouseGestureCards();
    if (navigation) {
      const result = navigation.filter(document.querySelector("#settings-section-search")?.value);
      updateSettingsSearchStatus(result);
    }
  }

  function markDraftDirty({ sync = false, force = false } = {}) {
    if (sync) readForm();
    draft?.markDirty(force);
    if (draft?.isDirty) {
      const saveStatus = document.querySelector("#save-status");
      if (saveStatus) saveStatus.textContent = "";
    }
    updateDraftStatus();
  }

  function replaceSettings(next, saved = false) {
    settings = draft.replace(next, saved);
    updateDraftStatus();
  }

  function markSettingsSaved(next) {
    settings = draft.markSaved(next);
    updateDraftStatus();
  }

  function ensureSiteRuleIds(value) {
    for (const rule of value?.siteRules || []) rule.id ||= siteRulesApi.newId();
    return value;
  }

  function renderMouseEnabledStatus() {
    const status = document.querySelector(".browser-toolbox-settings-status-label");
    if (!status) return;
    status.textContent = settings?.mouse?.enabled === false
      ? message("mouseDisabledStatus")
      : message("mouseEnabledStatus");
  }

  async function loadRegistry() {
    const response = await chrome.runtime.sendMessage({
      handler: "browserToolbox.commandRegistry",
    });
    const commands = Array.isArray(response) ? response : [];
    const byName = new Map(commands.map((command) => [command.name, command]));
    registry = {
      commands,
      getCommand: (name) => byName.get(name) || null,
      listCommands: () => commands.slice(),
      validateBinding: (binding) => {
        const command = byName.get(binding?.commandName);
        const source = binding?.source || "mouseGesture";
        const validate = globalThis.BrowserToolboxCommandInvocation?.validateCommandMetadata;
        if (!validate) {
          if (!command) return { ok: false, error: "Unknown command: " + binding?.commandName };
          if (!command.supportedInputs?.includes(source)) {
            return { ok: false, error: command.name + " does not support " + source + "." };
          }
          return { ok: true, command };
        }
        return validate(command, {
          source,
          contextType: binding.context || null,
          options: Object.hasOwn(binding || {}, "options") ? binding.options : {},
        });
      },
    };
  }

  // 绑定表格由 BrowserToolboxBindingEditor 独立负责。

  function cursorAssetApi() {
    return globalThis.BrowserToolboxCursorAsset;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(new Error("Unable to read the local PNG.")), {
        once: true,
      });
      reader.readAsDataURL(file);
    });
  }

  function setCursorPreview(asset, status = null) {
    const image = document.querySelector("#cursor-preview");
    const label = document.querySelector("#cursor-file-status");
    if (asset && cursorAssetApi()?.isSafeAsset(asset)) {
      image.src = asset;
      image.hidden = false;
      label.textContent = status || message("cursorAsset");
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      label.textContent = status || message("noCursorAsset");
    }
  }

  async function loadCursorPreview() {
    const id = settings.cursor.localAssetId;
    if (!id) {
      setCursorPreview(null);
      return;
    }
    const asset = await repository.readLocalAsset(id);
    setCursorPreview(asset, id);
  }

  async function removeCursorAsset(id) {
    if (!id) return;
    try {
      await repository.removeLocalAsset(id);
    } catch (_) {
      // 资源清理失败时保留旧资源，避免影响已经成功提交的配置。
    }
  }

  function commandLabel(command) {
    if (!command) return message("unassigned");
    if (command.i18nKey && BrowserToolboxI18n?.hasMessage?.(command.i18nKey)) {
      return message(command.i18nKey);
    }
    return command.title || command.desc || command.name || message("unassigned");
  }

  function createMouseGestureIcon(arrow) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 32 32");
    svg.setAttribute("class", "browser-toolbox-mouse-gesture-icon");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const paths = {
      "↑": "M16 27V5m0 0-6 6m6-6 6 6",
      "→": "M5 16h22m0 0-6-6m6 6-6 6",
      "←": "M27 16H5m0 0 6-6m-6 6 6 6",
      "↓": "M16 5v22m0 0-6-6m6 6 6-6",
    };
    path.setAttribute("d", paths[arrow] || paths["↑"]);
    svg.appendChild(path);
    return svg;
  }

  function createMouseGestureEditIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "browser-toolbox-mouse-gesture-edit-icon");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m4 17.5-.7 3.2 3.2-.7L18.8 7.7a2.3 2.3 0 0 0-3.2-3.2L4 17.5Zm10.8-11.4 3.2 3.2");
    svg.appendChild(path);
    return svg;
  }

  function renderMouseGestureCards() {
    const root = document.querySelector("#mouse-gesture-cards");
    if (!root) return;
    const bindings = settings?.mouse?.bindings || [];
    root.replaceChildren();
    for (const definition of mouseGestureCardDefinitions) {
      const binding = bindings.find((candidate) =>
        JSON.stringify(candidate?.pattern || []) === JSON.stringify(definition.pattern)
      );
      const card = document.createElement("article");
      card.className = "browser-toolbox-mouse-gesture-card";
      card.dataset.pattern = definition.pattern.join(">");
      const icon = createMouseGestureIcon(definition.arrow);
      const copy = document.createElement("span");
      copy.className = "browser-toolbox-mouse-gesture-card-copy";
      const direction = document.createElement("strong");
      direction.textContent = `${definition.arrow} ${message(definition.direction)}`;
      const command = document.createElement("small");
      command.textContent = commandLabel(registry?.getCommand(binding?.commandName));
      if (!binding) card.classList.add("is-unassigned");
      copy.append(direction, command);
      card.append(icon, copy, createMouseGestureEditIcon());
      if (binding) {
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `${direction.textContent}: ${command.textContent}`);
        const focusBinding = () => {
          const advanced = document.querySelector("#mouse-advanced-settings");
          advanced.open = true;
          advanced.scrollIntoView({ block: "nearest" });
          [...document.querySelectorAll("#mouse-bindings tr")]
            .find((row) => row._binding === binding)?._pattern?.focus();
        };
        card.addEventListener("click", focusBinding);
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          focusBinding();
        });
      }
      root.appendChild(card);
    }
    const count = document.querySelector("#mouse-gesture-count");
    if (count) count.textContent = String(mouseGestureCardDefinitions.length);
  }

  function renderAllBindings() {
    bindingEditor?.renderAll();
    renderMouseEnabledStatus();
    renderMouseGestureCards();
  }

  function renderSiteRules() {
    siteRulesEditor?.render();
  }

  function clearSiteRuleExplanation() {
    const explanation = document.querySelector("#site-rule-test-explanation");
    const matches = document.querySelector("#site-rule-test-matches");
    const effective = document.querySelector("#site-rule-test-effective");
    if (explanation) explanation.hidden = true;
    matches?.replaceChildren();
    if (effective) effective.textContent = "";
  }

  function renderSiteRuleExplanation(explanation, moduleNames, stateText) {
    const panel = document.querySelector("#site-rule-test-explanation");
    const matches = document.querySelector("#site-rule-test-matches");
    const effective = document.querySelector("#site-rule-test-effective");
    if (!panel || !matches || !effective) return;
    matches.replaceChildren();
    const matchedRules = explanation.matchedRules || [];
    if (matchedRules.length === 0) {
      const item = document.createElement("li");
      item.textContent = message("siteRuleNoMatchingRules");
      matches.appendChild(item);
    } else {
      for (const [precedence, { rule, index }] of matchedRules.entries()) {
        const item = document.createElement("li");
        const matchType = rule.matchType === "regex"
          ? message("siteRuleRegex")
          : message("siteRuleGlob");
        const disabled = moduleNames
          .filter((name) => rule.modules?.[name] === false)
          .map((name) => message(moduleRegistry.labelKey(name)));
        const details = rule.enabled === false
          ? message("disabled")
          : disabled.length > 0
          ? `${message("siteRuleDisabledModules")}: ${disabled.join(", ")}`
          : message("enabled");
        item.textContent = `${message("siteRulePrecedence")} ${precedence + 1} · ${
          message("siteRuleOrder")
        } ${index + 1}: ${matchType} — ${rule.pattern} (${details})`;
        matches.appendChild(item);
      }
    }
    effective.textContent = `${message("siteRuleEffectiveState")}: ${stateText}`;
    panel.hidden = false;
  }

  function testSiteRules() {
    readForm();
    const matcher = globalThis.BrowserToolboxSiteRuleMatcher;
    const result = document.querySelector("#site-rule-test-result");
    if (!matcher || !result) return;
    const url = document.querySelector("#site-rule-test-url")?.value.trim() || "";
    if (!url) {
      result.removeAttribute("title");
      result.textContent = message("siteRuleEnterTestUrl");
      clearSiteRuleExplanation();
      return;
    }
    try {
      new URL(url);
    } catch (_) {
      result.removeAttribute("title");
      result.textContent = message("siteRuleInvalidTestUrl");
      clearSiteRuleExplanation();
      return;
    }
    const moduleNames = moduleRegistry.ids({ siteRule: true });
    const defaults = {
      enabled: settings.general.enabled,
      ...moduleRegistry.enabledDefaults(settings),
    };
    const explanation = matcher.explain ? matcher.explain(settings.siteRules, url, defaults) : {
      matchedRules: [],
      effectiveRule: matcher.effectiveRule(settings.siteRules, url),
      effective: matcher.resolve(settings.siteRules, url, defaults),
    };
    const effectiveState = explanation.effective;
    if (effectiveState.enabled === false) {
      moduleRegistry.disableAll(effectiveState);
    }
    if (matcher.exclusionState(settings.exclusionRules, url).disabled) {
      effectiveState.keyboard = false;
    }
    const disabled = moduleNames
      .filter((name) => effectiveState[name] === false)
      .map((name) => message(moduleRegistry.labelKey(name)));
    const stateText = disabled.length > 0
      ? `${message("siteRuleDisabledModules")}: ${disabled.join(", ")}`
      : message("siteRuleAllModulesEnabled");
    result.title = url;
    result.textContent = `${
      explanation.effectiveRule
        ? `${message("siteRuleMatched")} ${explanation.effectiveRule.pattern} (${url})`
        : message("siteRuleNotMatched")
    } ${message("siteRuleEffectiveState")}: ${stateText}`;
    renderSiteRuleExplanation(explanation, moduleNames, stateText);
  }

  function readForm() {
    sectionsApi?.readForm(settings);
    toolSettingsApi?.readForm(settings);
    bindingEditor?.sync();
    return settings;
  }

  function writeForm() {
    sectionsApi?.writeForm(settings);
    toolSettingsApi?.writeForm(settings);
    renderAllBindings();
    renderSiteRules();
  }

  async function persistSettings(next, vimiumPatch = {}) {
    const snapshot = await settingsService.commit(next, { registry, vimiumPatch });
    return snapshot.settings;
  }

  async function save() {
    if (operationInProgress) return;
    setOperationBusy(true);
    document.querySelector("#save-status").textContent = message("saving");
    let createdCursorAssetId = null;
    let settingsCommitted = false;
    let saveSucceeded = false;
    try {
      readForm();
      ensureSiteRuleIds(settings);
      const oldCursorAssetId = settings.cursor.localAssetId;
      if (cursorResetRequested) {
        settings.cursor.localAssetId = null;
        settings.cursor.enabled = false;
      } else if (pendingCursorAsset) {
        if (!cursorAssetApi()?.isSafeAsset(pendingCursorAsset)) {
          document.querySelector("#settings-error").textContent = message("invalidSettings");
          document.querySelector("#save-status").textContent = "";
          return;
        }
        createdCursorAssetId = `browserToolboxCursor-${
          globalThis.crypto?.randomUUID?.() || Date.now()
        }`;
        await repository.writeLocalAsset(createdCursorAssetId, pendingCursorAsset);
        settings.cursor.localAssetId = createdCursorAssetId;
      }
      const result = validator.validate(settings, registry);
      const error = document.querySelector("#settings-error");
      if (!result.ok) {
        await removeCursorAsset(createdCursorAssetId);
        error.textContent = formatValidationErrors(result.errors);
        document.querySelector("#save-status").textContent = "";
        return;
      }
      error.textContent = "";
      settings = await persistSettings(result.value);
      settingsCommitted = true;
      if (oldCursorAssetId && oldCursorAssetId !== settings.cursor.localAssetId) {
        await removeCursorAsset(oldCursorAssetId);
      }
      pendingCursorAsset = null;
      cursorResetRequested = false;
      applySettingsLocale();
      document.querySelector("#dirty-status").textContent = "";
      markSettingsSaved(settings);
      writeForm();
      await loadCursorPreview();
      saveSucceeded = true;
    } catch (error) {
      if (!settingsCommitted) await removeCursorAsset(createdCursorAssetId);
      document.querySelector("#settings-error").textContent = formatSettingsError(error);
      document.querySelector("#save-status").textContent = "";
    } finally {
      setOperationBusy(false);
      if (saveSucceeded) document.querySelector("#save-status").textContent = message("saved");
    }
  }

  async function restoreDefaults() {
    if (
      operationInProgress ||
      !globalThis.confirm?.(message("restoreDefaultsConfirm"))
    ) return;
    setOperationBusy(true);
    let restored = false;
    try {
      readForm();
      const previousCursorAssetId = settings.cursor.localAssetId;
      const defaults = schema.clone(schema.DEFAULT_SETTINGS);
      // 恢复 BrowserToolbox 自身默认值时保留 Vimium 的键位和搜索引擎，避免按钮意外覆盖上游设置。
      defaults.keyboard.keyMappings = vimiumSettings.get("keyMappings");
      defaults.searchEngines = vimiumSettings.get("searchEngines");
      defaults.exclusionRules = vimiumSettings.get("exclusionRules");
      const result = validator.validate(defaults, registry);
      if (!result.ok) {
        document.querySelector("#settings-error").textContent = formatValidationErrors(
          result.errors,
        );
        return;
      }
      settings = await persistSettings(result.value, {
        exclusionRules: result.value.exclusionRules,
      });
      await removeCursorAsset(previousCursorAssetId);
      pendingCursorAsset = null;
      cursorResetRequested = false;
      markSettingsSaved(settings);
      writeForm();
      await loadCursorPreview();
      applySettingsLocale();
      document.querySelector("#settings-error").textContent = "";
      restored = true;
    } catch (error) {
      document.querySelector("#settings-error").textContent = formatSettingsError(error);
    } finally {
      setOperationBusy(false);
      if (restored) document.querySelector("#save-status").textContent = message("saved");
    }
  }

  function exportSettings() {
    const payload = settingsService.createExportPayload(readForm(), {
      extensionVersion: chrome.runtime.getManifest().version,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "browser-toolbox-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
    updateDraftStatus();
  }

  function renderImportSummary(summary, { ignored = [], preserved = [] } = {}) {
    const labels = settingsSectionLabels();
    const renderList = (id, values) => {
      const list = document.querySelector(`#${id}`);
      if (!list) return;
      list.replaceChildren();
      const items = values.length > 0 ? values : [message("none")];
      for (const value of items) {
        const item = document.createElement("li");
        item.textContent = values.length > 0
          ? changeSummaryApi?.formatPath(value, labels) || value
          : value;
        if (values.length === 0) item.className = "browser-toolbox-empty-summary";
        list.append(item);
      }
    };
    renderList("import-preview-added", summary.added);
    renderList("import-preview-changed", summary.changed);
    renderList("import-preview-removed", summary.removed);
    const ignoredElement = document.querySelector("#import-preview-ignored");
    if (ignoredElement) {
      ignoredElement.hidden = ignored.length === 0;
      ignoredElement.textContent = ignored.length > 0
        ? `${message("ignoredFields")}: ${ignored.join(", ")}`
        : "";
    }
    const unrecognizedElement = document.querySelector("#import-preview-unrecognized");
    if (unrecognizedElement) {
      unrecognizedElement.hidden = preserved.length === 0;
      unrecognizedElement.textContent = preserved.length > 0
        ? `${message("unrecognizedFields")}: ${preserved.join(", ")}`
        : "";
    }
    const truncated = document.querySelector("#import-preview-truncated");
    if (truncated) truncated.hidden = !summary.truncated;
    const description = document.querySelector("#import-preview-description");
    if (description) {
      description.textContent = message("importPreviewDescription") +
        (summary.added.length === 0 && summary.changed.length === 0 && summary.removed.length === 0
          ? ` ${message("importPreviewNoChanges")}`
          : "");
    }
  }

  function importReportText({ ignored = [], preserved = [] } = {}) {
    return [
      preserved.length > 0 ? `${message("unrecognizedFields")}: ${preserved.join(", ")}` : "",
      ignored.length > 0 ? `${message("ignoredFields")}: ${ignored.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }

  function importSummaryText(summary, { ignored = [], preserved = [] } = {}) {
    const labels = {
      added: message("importPreviewAdded"),
      changed: message("importPreviewChanged"),
      removed: message("importPreviewRemoved"),
    };
    const parts = [
      labels.added,
      summary.added,
      labels.changed,
      summary.changed,
      labels.removed,
      summary.removed,
    ]
      .map((value) => Array.isArray(value) ? value.join(", ") || message("none") : value);
    if (preserved.length > 0) {
      parts.push(`${message("unrecognizedFields")}: ${preserved.join(", ")}`);
    }
    if (ignored.length > 0) parts.push(`${message("ignoredFields")}: ${ignored.join(", ")}`);
    return `${message("importPreviewTitle")}\n${parts.join("\n")}`;
  }

  async function requestImportConfirmation(summary, report = {}) {
    const dialog = document.querySelector("#import-preview-dialog");
    const confirmButton = document.querySelector("#import-preview-confirm");
    const cancelButton = document.querySelector("#import-preview-cancel");
    const normalizedReport = {
      ignored: report.ignored || [],
      preserved: report.preserved || [],
    };
    if (
      !dialog || typeof dialog.showModal !== "function" || !confirmButton || !cancelButton
    ) return Boolean(globalThis.confirm?.(importSummaryText(summary, normalizedReport)));
    const activeElement = document.activeElement;
    const returnFocus = activeElement && activeElement !== document.body &&
        activeElement !== document.documentElement
      ? activeElement
      : document.querySelector("#import-settings");
    renderImportSummary(summary, normalizedReport);
    try {
      dialog.showModal();
    } catch (_) {
      return Boolean(globalThis.confirm?.(importSummaryText(summary, normalizedReport)));
    }
    confirmButton.focus();
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (accepted) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener("cancel", onCancel);
        dialog.removeEventListener("close", onClose);
        confirmButton.removeEventListener("click", onConfirm);
        cancelButton.removeEventListener("click", onCancelButton);
        if (dialog.open) dialog.close();
        if (returnFocus && !returnFocus.disabled && returnFocus.isConnected) {
          returnFocus.focus();
        }
        resolve(accepted);
      };
      const onConfirm = () => finish(true);
      const onCancelButton = () => finish(false);
      const onCancel = (event) => {
        event.preventDefault();
        finish(false);
      };
      const onClose = () => finish(false);
      confirmButton.addEventListener("click", onConfirm);
      cancelButton.addEventListener("click", onCancelButton);
      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("close", onClose);
    });
  }

  const vimiumImportFields = [
    "keyMappings",
    "searchEngines",
    "exclusionRules",
    "linkHintCharacters",
    "linkHintNumbers",
    "filterLinkHints",
    "userDefinedLinkHintCss",
    "scrollStepSize",
    "smoothScroll",
    "previousPatterns",
    "nextPatterns",
    "regexFindMode",
    "waitForEnterForFilteredHints",
    "hideHud",
    "newTabDestination",
    "newTabCustomUrl",
    "openVomnibarOnNewTabPage",
  ];

  function vimiumBackupSource(payload) {
    return payload?.settings && typeof payload.settings === "object" &&
        !Array.isArray(payload.settings)
      ? payload.settings
      : payload;
  }

  function vimiumBackupFields(payload) {
    const source = vimiumBackupSource(payload);
    return Object.fromEntries(
      vimiumImportFields.filter((key) => Object.hasOwn(source, key)).map((
        key,
      ) => [key, source[key]]),
    );
  }

  function validateVimiumField(name, value) {
    const strings = new Set([
      "keyMappings",
      "searchEngines",
      "linkHintCharacters",
      "linkHintNumbers",
      "userDefinedLinkHintCss",
      "previousPatterns",
      "nextPatterns",
      "newTabDestination",
      "newTabCustomUrl",
    ]);
    const booleans = new Set([
      "filterLinkHints",
      "smoothScroll",
      "regexFindMode",
      "waitForEnterForFilteredHints",
      "hideHud",
      "openVomnibarOnNewTabPage",
    ]);
    if (strings.has(name)) return typeof value === "string" && value.length <= 256 * 1024;
    if (booleans.has(name)) return typeof value === "boolean";
    if (name === "scrollStepSize") {
      return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10000;
    }
    if (name === "exclusionRules") {
      return Array.isArray(value) && value.length <= 1000 &&
        value.every((rule) =>
          rule && typeof rule === "object" && typeof rule.pattern === "string" &&
          typeof rule.passKeys === "string"
        );
    }
    return false;
  }

  async function importVimiumBackup(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(message("invalidSettings"));
    }
    const source = vimiumBackupSource(payload);
    const fields = vimiumBackupFields(payload);
    if (Object.keys(fields).length === 0 || !vimiumSettings.isAvailable()) {
      throw new Error(message("invalidSettings"));
    }
    if (Object.entries(fields).some(([name, value]) => !validateVimiumField(name, value))) {
      throw new Error(message("invalidSettings"));
    }
    const unknown = Object.keys(source).filter((key) =>
      key !== "settingsVersion" && !vimiumImportFields.includes(key)
    );
    const importedNames = Object.keys(fields).join(", ");

    const next = schema.mergeSettings(settings);
    ensureSiteRuleIds(next);
    if (typeof fields.keyMappings === "string") next.keyboard.keyMappings = fields.keyMappings;
    if (typeof fields.searchEngines === "string") next.searchEngines = fields.searchEngines;
    if (Array.isArray(fields.exclusionRules)) next.exclusionRules = fields.exclusionRules;
    const result = validator.validate(next, registry);
    if (!result.ok) throw new Error(formatValidationErrors(result.errors));
    const summary = changeSummaryApi?.summarize(settings, result.value) || {
      added: [],
      changed: importedNames ? [importedNames] : [],
      removed: [],
      truncated: false,
    };
    if (!(await requestImportConfirmation(summary, { ignored: unknown }))) return false;
    settings = await persistSettings(result.value, fields);
    markSettingsSaved(settings);
    writeForm();
    await loadCursorPreview();
    applySettingsLocale();
    document.querySelector("#settings-error").textContent = importReportText({ ignored: unknown });
    return true;
  }

  async function importSettings(file) {
    if (!file || file.size > 1024 * 1024) throw new Error(message("invalidSettings"));
    readForm();
    const payload = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(message("invalidSettings"));
    }
    const parsedExport = settingsService.migrateExportPayload(payload);
    if (!parsedExport) return importVimiumBackup(payload);
    if (!parsedExport.ok) throw new Error(message("invalidSettings"));
    const migrated = parsedExport.settings;
    // 导入文件不携带本地指针二进制资源，避免产生悬空引用或把资源带出本机。
    migrated.cursor.localAssetId = null;
    migrated.cursor.enabled = false;
    ensureSiteRuleIds(migrated);
    const result = validator.validate(migrated, registry);
    if (!result.ok) throw new Error(formatValidationErrors(result.errors));
    const summary = changeSummaryApi?.summarize(settings, result.value) || {
      added: [],
      changed: ["settings"],
      removed: [],
      truncated: false,
    };
    const report = {
      ignored: parsedExport.ignored || [],
      preserved: parsedExport.preserved || [],
    };
    if (!(await requestImportConfirmation(summary, report))) return false;
    const previousCursorAssetId = settings.cursor.localAssetId;
    settings = await persistSettings(result.value);
    markSettingsSaved(settings);
    writeForm();
    pendingCursorAsset = null;
    cursorResetRequested = false;
    if (previousCursorAssetId && previousCursorAssetId !== settings.cursor.localAssetId) {
      await removeCursorAsset(previousCursorAssetId);
    }
    await loadCursorPreview();
    applySettingsLocale();
    document.querySelector("#settings-error").textContent = importReportText(report);
    return true;
  }

  function setPreviewPattern(pattern, updateInput = true) {
    previewPattern = quantizer.normalizePattern(pattern);
    const preview = document.querySelector("#gesture-preview");
    const formatted = quantizer.formatPattern(previewPattern);
    const accessible = previewPattern.map((direction) => message(directionMessageKeys[direction]));
    preview.textContent = formatted;
    preview.setAttribute("aria-label", accessible.join(", "));
    if (updateInput) {
      document.querySelector("#gesture-pattern-input").value = formatted;
    }
    document.querySelector("#add-gesture-binding").disabled = previewPattern.length === 0;
  }

  function setupNavigation() {
    navigation = new navigationApi.SettingsNavigation(
      document.querySelector(".browser-toolbox-nav"),
      {
        onActivate: (name) => {
          document.querySelector(".browser-toolbox-main")?.setAttribute(
            "data-active-section",
            name,
          );
        },
        sections: sectionsApi,
      },
    ).init();
    // 导航由注册表动态生成，生成后重新应用当前语言。
    BrowserToolboxI18n.apply(document);
    const searchInput = document.querySelector("#settings-section-search");
    searchInput?.addEventListener("input", () => {
      const result = navigation.filter(searchInput.value);
      updateSettingsSearchStatus(result);
    });
    searchInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !searchInput.value) return;
      event.preventDefault();
      searchInput.value = "";
      const result = navigation.filter("");
      updateSettingsSearchStatus(result);
    });
    updateSettingsSearchStatus(navigation.filter(searchInput?.value));
  }

  function setupEvents() {
    document.querySelector("#restore-defaults").addEventListener("click", restoreDefaults);
    document.querySelector("#save-settings").addEventListener("click", save);
    document.querySelector("#export-settings").addEventListener("click", exportSettings);
    document.querySelector("#import-settings").addEventListener("change", async (event) => {
      if (operationInProgress) return;
      const importInput = event.target;
      setOperationBusy(true);
      let imported = false;
      try {
        imported = await importSettings(importInput.files[0]);
      } catch (error) {
        document.querySelector("#settings-error").textContent = formatSettingsError(error);
      } finally {
        setOperationBusy(false);
        if (imported) document.querySelector("#save-status").textContent = message("saved");
        importInput.value = "";
        const restoreImportFocus = () => {
          const active = document.activeElement;
          const focusOwnedByImportFlow = !active ||
            active === document.body ||
            active === document.documentElement ||
            active === importInput ||
            active.closest?.("#import-preview-dialog");
          if (
            focusOwnedByImportFlow &&
            !importInput.disabled &&
            importInput.isConnected
          ) importInput.focus();
        };
        restoreImportFocus();
        globalThis.setTimeout(restoreImportFocus, 0);
      }
    });
    document.querySelector("#discard-changes").addEventListener("click", async () => {
      if (operationInProgress) return;
      setOperationBusy(true);
      try {
        settings = draft.reset();
        pendingCursorAsset = null;
        cursorResetRequested = false;
        editor.clear();
        setPreviewPattern([]);
        writeForm();
        document.querySelector("#save-status").textContent = "";
        document.querySelector("#settings-error").textContent = "";
        await loadCursorPreview();
      } finally {
        setOperationBusy(false);
      }
    });
    document.querySelector("#add-site-rule").addEventListener("click", () => {
      settings.siteRules.push({
        id: siteRulesApi.newId(),
        matchType: "glob",
        pattern: "https://example.com/*",
        enabled: true,
        modules: {},
      });
      renderSiteRules();
      markDraftDirty();
    });
    document.querySelector("#add-super-drag-binding").addEventListener("click", () => {
      settings.superDrag.bindings.push({
        id: siteRulesApi.newId("drag"),
        enabled: true,
        context: "SELECTED_TEXT",
        pattern: ["D", "D"],
        commandName: "BrowserToolbox.copySelection",
        options: {},
      });
      bindingEditor?.render("superDrag");
      markDraftDirty();
    });
    document.querySelector("#add-wheel-binding").addEventListener("click", () => {
      settings.wheel.bindings.push({
        id: siteRulesApi.newId("wheel"),
        enabled: true,
        button: "MIDDLE_BUTTON",
        direction: "UP",
        commandName: "scrollToTop",
        options: {},
      });
      bindingEditor?.render("wheel");
      markDraftDirty();
    });
    document.querySelector("#test-site-rules").addEventListener("click", testSiteRules);
    document.querySelector("#clear-gesture").addEventListener("click", () => editor.clear());
    document.querySelector("#add-gesture-binding").addEventListener("click", () => {
      if (previewPattern.length === 0) return;
      settings.mouse.bindings.push({
        id: siteRulesApi.newId("mouse"),
        enabled: true,
        pattern: previewPattern.slice(),
        commandName: "goBack",
        options: {},
      });
      bindingEditor?.render("mouse");
      renderMouseGestureCards();
      markDraftDirty();
    });
    document.querySelector("#gesture-pattern-input").addEventListener("input", (event) => {
      setPreviewPattern(event.target.value, false);
    });
    document.querySelector("#gesture-pattern-input").addEventListener("blur", (event) => {
      setPreviewPattern(event.target.value);
    });
    document.addEventListener("input", (event) => {
      if (
        !event.target.closest("#site-rules") &&
        event.target.id !== "gesture-pattern-input" &&
        event.target.id !== "site-rule-test-url"
      ) markDraftDirty({ sync: true });
    });
    document.addEventListener("change", (event) => {
      if (
        !event.target.closest("#site-rules") &&
        event.target.id !== "import-settings" &&
        event.target.id !== "cursor-file" &&
        event.target.id !== "site-rule-test-url"
      ) markDraftDirty({ sync: true });
    });
    globalThis.addEventListener?.("beforeunload", (event) => {
      if (!draft?.isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    document.querySelector("#cursor-file").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (file.type !== "image/png" || file.size > cursorAssetApi().MAX_BYTES) {
          throw new Error(message("invalidSettings"));
        }
        const asset = await readFileAsDataUrl(file);
        if (!cursorAssetApi().isSafeAsset(asset)) throw new Error(message("invalidSettings"));
        pendingCursorAsset = asset;
        cursorResetRequested = false;
        setCursorPreview(asset, file.name);
        document.querySelector("#cursor-enabled").checked = true;
        markDraftDirty({ force: true });
      } catch (error) {
        pendingCursorAsset = null;
        document.querySelector("#settings-error").textContent = error.message;
        setCursorPreview(null);
      } finally {
        event.target.value = "";
      }
    });
    document.querySelector("#reset-cursor").addEventListener("click", () => {
      pendingCursorAsset = null;
      cursorResetRequested = true;
      document.querySelector("#cursor-enabled").checked = false;
      setCursorPreview(null);
      markDraftDirty({ force: true });
    });
  }

  async function init() {
    const main = document.querySelector(".browser-toolbox-main");
    main?.setAttribute("data-settings-ready", "false");
    await loadRegistry();
    const loadedSnapshot = await settingsService.load(registry);
    const loaded = loadedSnapshot.settings;
    ensureSiteRuleIds(loaded);
    draft = new draftApi.SettingsDraft(loaded);
    settings = draft.getMutable();
    draft.addEventListener(updateDraftStatus);
    siteRulesEditor = new siteRulesApi.SiteRulesEditor({
      body: document.querySelector("#site-rules"),
      getRules: () => settings.siteRules,
      message,
      onChange: () => markDraftDirty(),
    });
    bindingEditor = new bindingEditorApi.BindingEditor({
      documentRef: document,
      getSettings: () => settings,
      getRegistry: () => registry,
      message,
      quantizer,
      markDirty: () => markDraftDirty(),
      idFactory: siteRulesApi.newId,
      onBindingsChange: (kind) => {
        if (kind === "mouse") renderMouseGestureCards();
      },
    });
    BrowserToolboxI18n.setLocale(settings.general.language);
    BrowserToolboxI18n.apply(document);
    editor = new globalThis.BrowserToolboxGestureEditor(
      document.querySelector("#gesture-canvas"),
      (pattern) => {
        setPreviewPattern(pattern);
      },
    );
    setupNavigation();
    toolSettingsApi?.render(settings);
    toolSettingsApi?.bindLimitFeedback();
    setupEvents();
    setPreviewPattern([]);
    writeForm();
    await loadCursorPreview();
    updateDraftStatus();
    // 只有完整加载设置、绑定事件和资源预览后，外部页面才可以安全进行下一步操作。
    main?.setAttribute("data-settings-ready", "true");
  }

  document.addEventListener("DOMContentLoaded", () =>
    init().catch((error) => {
      document.querySelector("#settings-error").textContent = error.message;
    }));
})();
