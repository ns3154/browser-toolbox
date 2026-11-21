// BrowserToolbox 设置页控制器。命令下拉框从后台注册表读取，不维护第二份命令清单。
(function () {
  const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
  const vimiumSettings = globalThis.BrowserToolboxVimiumSettingsAdapterInstance;
  const schema = globalThis.BrowserToolboxSettingsSchema;
  const validator = globalThis.BrowserToolboxSettingsValidator;
  const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
  const settingsPolicy = globalThis.BrowserToolboxSettingsPolicy;
  const toolSettingsApi = globalThis.BrowserToolboxToolSettings;
  const quantizer = globalThis.BrowserToolboxDirectionQuantizer;
  const gestureLab = globalThis.BrowserToolboxGestureLab;
  const draftApi = globalThis.BrowserToolboxSettingsDraft;
  const applicationServiceApi = globalThis.BrowserToolboxSettingsApplicationService;
  const sectionsApi = globalThis.BrowserToolboxSettingsSections;
  const navigationApi = globalThis.BrowserToolboxSettingsNavigation;
  const changeSummaryApi = globalThis.BrowserToolboxSettingsChangeSummary;
  const siteRulesApi = globalThis.BrowserToolboxSiteRulesEditor;
  const siteShortcut = consumeSiteShortcut();
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
  let importBackupBusy = false;
  let importBackupRefreshPending = false;
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
      general: message("generalAndTheme"),
      browserStartup: message("browserStartup"),
      search: message("searchEngines"),
      keyboard: message("keyboard"),
      mouse: message("mouseGestures"),
      superDrag: message("superDrag"),
      wheel: message("wheelRocker"),
      rocker: message("rocker"),
      cursor: message("cursor"),
      siteRules: message("siteRules"),
      privacy: message("privacyStatement"),
      toolsOverview: message("shortcutToolsConfig"),
      jsonFormatter: message("pageAutoFormatter"),
      appearance: message("cursor"),
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
    return globalThis.BrowserToolboxSettingsErrorFormatter.format(error, {
      message,
      conflictDetails: formatConflictDetails(error),
    });
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

  const SIDEBAR_EXPANDED_KEY = "browserToolboxSidebarExpanded";

  function readSidebarExpanded() {
    try {
      return globalThis.localStorage?.getItem(SIDEBAR_EXPANDED_KEY) === "true";
    } catch {
      return false;
    }
  }

  function writeSidebarExpanded(expanded) {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_EXPANDED_KEY, expanded ? "true" : "false");
    } catch {
      // 忽略无本地存储环境下的持久化错误。
    }
  }

  function applySidebarExpanded(expanded) {
    const layout = document.querySelector(".browser-toolbox-layout");
    const toggle = document.querySelector("#browser-toolbox-sidebar-toggle");
    layout?.classList.toggle("is-sidebar-expanded", Boolean(expanded));
    if (!toggle) return;
    const key = expanded ? "toolCollapse" : "toolExpand";
    const text = message(key);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-label", text);
    toggle.title = text;
    toggle.dataset.i18nAriaLabel = key;
    const label = toggle.querySelector(".browser-toolbox-sidebar-toggle-label");
    if (label) {
      label.dataset.i18n = key;
      label.textContent = text;
    }
  }

  function setupSidebarToggle() {
    const toggle = document.querySelector("#browser-toolbox-sidebar-toggle");
    applySidebarExpanded(readSidebarExpanded());
    toggle?.addEventListener("click", () => {
      const next = !document.querySelector(".browser-toolbox-layout")?.classList.contains(
        "is-sidebar-expanded",
      );
      applySidebarExpanded(next);
      writeSidebarExpanded(next);
    });
  }

  function syncNavigationTooltips() {
    for (const item of document.querySelectorAll(".browser-toolbox-nav-item, .browser-toolbox-nav-category")) {
      const label = item.querySelector("span[data-i18n]")?.textContent?.trim();
      if (label) item.title = label;
    }
  }

  function applySettingsTheme(themeOverride) {
    globalThis.BrowserToolboxTheme?.applyTheme?.(
      themeOverride ?? settings?.general?.theme,
      document,
    );
    editor?.draw?.();
  }

  function applySettingsLocale() {
    BrowserToolboxI18n.setLocale(settings.general.language);
    BrowserToolboxI18n.apply(document);
    applySettingsTheme();
    syncNavigationTooltips();
    const layout = document.querySelector(".browser-toolbox-layout");
    applySidebarExpanded(layout?.classList.contains("is-sidebar-expanded") ?? readSidebarExpanded());
    renderMouseEnabledStatus();
    renderMouseGestureCards();
    renderGestureLabStatus();
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

  async function canPreviewCursorAsset(asset) {
    const metadata = cursorAssetApi()?.readPngAsset(asset);
    if (!metadata) return false;
    const image = new Image();
    image.src = asset;
    let timeout;
    try {
      const decoded = await Promise.race([
        image.decode().then(() => true),
        new Promise((resolve) => timeout = setTimeout(() => resolve(false), 3000)),
      ]);
      return decoded && image.naturalWidth === metadata.width &&
        image.naturalHeight === metadata.height;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  function stageCursorDraft(asset) {
    if (!draft || !settings || !cursorAssetApi()?.isSafeAsset(asset)) return false;
    pendingCursorAsset = asset;
    cursorResetRequested = false;
    document.querySelector("#cursor-enabled").checked = true;
    setCursorPreview(asset, message("localCursorDraftPreview"));
    markDraftDirty({ force: true });
    return true;
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
    path.setAttribute(
      "d",
      "m4 17.5-.7 3.2 3.2-.7L18.8 7.7a2.3 2.3 0 0 0-3.2-3.2L4 17.5Zm10.8-11.4 3.2 3.2",
    );
    svg.appendChild(path);
    return svg;
  }

  function updateMouseInspectorDetail(commandText, patternText) {
    const commandNode = document.querySelector("#mouse-inspector-command");
    const noteNode = document.querySelector("#mouse-inspector-pattern-note");
    if (commandNode) commandNode.textContent = commandText || message("unassigned");
    if (noteNode && patternText) noteNode.textContent = patternText;
  }

  function renderMouseGestureCards() {
    const root = document.querySelector("#mouse-gesture-cards");
    if (!root) return;
    const bindings = settings?.mouse?.bindings || [];
    root.replaceChildren();
    let firstSelected = null;
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
        if (!firstSelected) firstSelected = { card, definition, commandText: command.textContent, directionText: direction.textContent };
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `${direction.textContent}: ${command.textContent}`);
        const selectCard = () => {
          for (const sibling of root.querySelectorAll(".browser-toolbox-mouse-gesture-card")) {
            sibling.classList.remove("is-selected");
          }
          card.classList.add("is-selected");
          editor?.showPattern?.(definition.pattern);
          updateMouseInspectorDetail(command.textContent, direction.textContent);
        };
        const focusBinding = () => {
          selectCard();
          const advanced = document.querySelector("#mouse-advanced-settings");
          if (advanced) {
            advanced.open = true;
            advanced.scrollIntoView({ block: "nearest" });
          }
          [...document.querySelectorAll("#mouse-bindings tr")]
            .find((row) => row._binding === binding)?._pattern?.focus();
        };
        card.addEventListener("click", focusBinding);
        card.addEventListener("focus", selectCard);
        card.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          focusBinding();
        });
      }
      root.appendChild(card);
    }
    if (firstSelected && previewPattern.length === 0) {
      firstSelected.card.classList.add("is-selected");
      updateMouseInspectorDetail(firstSelected.commandText, firstSelected.directionText);
      if (editor?.points?.length === 0) editor.showPattern?.(firstSelected.definition.pattern);
    }
    const count = document.querySelector("#mouse-gesture-count");
    if (count) count.textContent = String(mouseGestureCardDefinitions.length);
  }

  function renderAllBindings() {
    bindingEditor?.renderAll();
    renderMouseEnabledStatus();
    renderMouseGestureCards();
    renderGestureLabStatus();
  }

  function renderSiteRules() {
    siteRulesEditor?.render();
  }

  function consumeSiteShortcut() {
    if (!globalThis.location?.href) return null;
    const url = new URL(globalThis.location.href);
    const values = url.searchParams.getAll("siteOrigin");
    if (values.length === 0) return null;
    const origin = values.length === 1 ? siteRulesApi.parseSiteOrigin(values[0]) : null;
    // 参数只在本次加载中使用；立即清理地址，避免刷新重复创建草稿。
    url.searchParams.delete("siteOrigin");
    if (origin) url.hash = "siteRules";
    globalThis.history?.replaceState(null, "", url.href);
    return { origin };
  }

  function applySiteShortcut() {
    if (!siteShortcut) return;
    const result = siteRulesApi.prepareSiteRuleDraft(settings.siteRules, siteShortcut.origin);
    if (!result) {
      document.querySelector("#settings-error").textContent = message("siteRuleShortcutInvalid");
      return;
    }
    renderSiteRules();
    if (result.created) markDraftDirty();
    document.querySelector("#site-rule-test-url").value = `${siteShortcut.origin}/`;
    testSiteRules();
    document.querySelector("#save-status").textContent = message(
      result.created ? "siteRuleShortcutDraft" : "siteRuleShortcutExisting",
    );
    const row = [...document.querySelectorAll("#site-rules [data-rule-id]")]
      .find((element) => element.dataset.ruleId === result.rule.id);
    row?.querySelector("[data-field=pattern]")?.focus();
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
    const profile = explanation.effectiveProfile;
    const profileName = profile?.name ||
      (profile?.preset && schema?.SITE_PROFILE_PRESETS?.[profile.preset]
        ? message(schema.SITE_PROFILE_PRESETS[profile.preset].labelKey)
        : profile?.preset);
    effective.textContent = `${message("siteRuleEffectiveState")}: ${stateText}` +
      (profileName ? ` · ${message("siteRuleProfile")}: ${profileName}` : "");
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
    const effectiveSettings = settingsPolicy?.withEffectiveSettings?.(settings, url) || settings;
    const effectiveState = effectiveSettings.effectiveModules || explanation.effective;
    explanation.effective = effectiveState;
    explanation.effectiveProfile = effectiveSettings.effectiveSiteProfile ||
      explanation.effectiveProfile;
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

  async function persistSettings(next, vimiumPatch = {}, { beforeImport = false } = {}) {
    const snapshot = await settingsService.commit(next, { registry, vimiumPatch, beforeImport });
    return snapshot.settings;
  }

  async function save() {
    if (operationInProgress) return;
    setOperationBusy(true);
    document.querySelector("#save-status").textContent = message("saving");
    let createdCursorAssetId = null;
    let saveSucceeded = false;
    try {
      readForm();
      ensureSiteRuleIds(settings);
      const candidate = schema.clone(settings);
      if (cursorResetRequested) {
        candidate.cursor.localAssetId = null;
        candidate.cursor.enabled = false;
      } else if (pendingCursorAsset) {
        if (!cursorAssetApi()?.isSafeAsset(pendingCursorAsset)) {
          document.querySelector("#settings-error").textContent = message("invalidSettings");
          document.querySelector("#save-status").textContent = "";
          return;
        }
        if (typeof globalThis.crypto?.randomUUID !== "function") {
          throw new Error(message("configurationUnavailable"));
        }
        createdCursorAssetId = `browserToolboxCursor-${globalThis.crypto.randomUUID()}`;
        candidate.cursor.localAssetId = createdCursorAssetId;
      }
      const result = validator.validate(candidate, registry);
      const error = document.querySelector("#settings-error");
      if (!result.ok) {
        error.textContent = formatValidationErrors(result.errors);
        error.scrollIntoView({ block: "center" });
        document.querySelector("#save-status").textContent = "";
        return;
      }
      error.textContent = "";
      if (createdCursorAssetId) {
        if (await repository.readLocalAsset(createdCursorAssetId) !== undefined) {
          throw new Error(message("configurationUnavailable"));
        }
        try {
          await repository.writeLocalAsset(createdCursorAssetId, pendingCursorAsset);
        } catch (failure) {
          if (/quota/i.test(failure?.message || "")) {
            throw Object.assign(new Error("CONFIGURATION_LOCAL_QUOTA"), {
              code: "CONFIGURATION_LOCAL_QUOTA",
            });
          }
          throw failure;
        }
      }
      settings = await persistSettings(result.value);
      // 存储不支持按引用状态原子删除；旧资源和结果未知的新资源都需保留。
      pendingCursorAsset = null;
      cursorResetRequested = false;
      applySettingsLocale();
      document.querySelector("#dirty-status").textContent = "";
      markSettingsSaved(settings);
      writeForm();
      await loadCursorPreview();
      saveSucceeded = true;
    } catch (error) {
      const errorElement = document.querySelector("#settings-error");
      errorElement.textContent = formatSettingsError(error);
      // 长规则列表中保存栏固定在底部，将失败说明滚到视口中部，避免被保存栏遮住。
      errorElement.scrollIntoView({ block: "center" });
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
    downloadSettings(payload, "browser-toolbox-settings.json");
    updateDraftStatus();
  }

  function downloadSettings(payload, name) {
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function setImportBackupBusy(busy) {
    importBackupBusy = busy;
    const select = document.querySelector("#import-backup-select");
    const selected = select.selectedOptions[0];
    const valid = !busy && Boolean(select.value) && selected && !selected.disabled;
    document.querySelector("#import-backup-refresh").disabled = busy;
    document.querySelector("#import-backup-preview").disabled = !valid;
    document.querySelector("#import-backup-export").disabled = !valid;
    document.querySelector("#import-backup-export-cursor").disabled = !valid ||
      selected.dataset.cursorAssetPresent !== "true";
    document.querySelector("#import-backup-use-cursor").disabled = !valid ||
      selected.dataset.cursorAssetPresent !== "true";
    select.disabled = busy;
  }

  function finishImportBackupOperation() {
    setImportBackupBusy(false);
    if (importBackupRefreshPending) {
      importBackupRefreshPending = false;
      void refreshImportBackups();
    }
  }

  async function refreshImportBackups() {
    if (importBackupBusy) {
      importBackupRefreshPending = true;
      return;
    }
    const select = document.querySelector("#import-backup-select");
    const status = document.querySelector("#import-backup-status");
    const selected = select.value;
    setImportBackupBusy(true);
    status.textContent = "";
    try {
      const items = await globalThis.BrowserToolboxConfigurationClientInstance.request(
        "list-import-backups",
      );
      select.replaceChildren();
      if (!items.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = message("none");
        select.append(option);
      }
      for (const item of items) {
        const option = document.createElement("option");
        option.value = item.key;
        option.disabled = item.status !== "valid";
        option.dataset.cursorAssetPresent = String(item.cursorAssetPresent === true);
        const date = item.status === "valid" ? new Date(item.createdAt) : null;
        option.textContent = item.status === "valid"
          ? `${date.toLocaleString()}.${String(date.getMilliseconds()).padStart(3, "0")}` +
            (item.cursorAssetMissing
              ? ` · ${message("importBackupAssetMissing")}`
              : item.cursorAssetInvalid
              ? ` · ${message("importBackupAssetInvalid")}`
              : "")
          : message("importBackupInvalid");
        select.append(option);
      }
      if (
        selected &&
        [...select.options].some((option) => option.value === selected && !option.disabled)
      ) {
        select.value = selected;
      }
    } catch (_) {
      select.replaceChildren();
      status.textContent = message("configurationUnavailable");
    } finally {
      finishImportBackupOperation();
    }
  }

  async function exportImportBackup() {
    const select = document.querySelector("#import-backup-select");
    const status = document.querySelector("#import-backup-status");
    if (!select.value || importBackupBusy) return;
    const key = select.value;
    setImportBackupBusy(true);
    status.textContent = "";
    try {
      const backup = await globalThis.BrowserToolboxConfigurationClientInstance.request(
        "export-import-backup",
        { key },
      );
      const view = backup.snapshot;
      const toolbox = applicationServiceApi.composeSettings(
        view.toolboxSource.value,
        view.keyboard,
      );
      const payload = globalThis.BrowserToolboxSettingsMigrations.createExportPayload(toolbox, {
        extensionVersion: chrome.runtime.getManifest().version,
        keyboardSettings: view.keyboard,
      });
      downloadSettings(payload, "browser-toolbox-before-import.json");
      const limitations = backup.legacyLimitations || [];
      status.textContent = message("importBackupExported") +
        (limitations.length
          ? `\n${message("importBackupUnsupported")}: ${limitations.join(", ")}${
            backup.legacyLimitationsTruncated ? ", …" : ""
          }`
          : "");
    } catch (_) {
      status.textContent = message("configurationUnavailable");
    } finally {
      finishImportBackupOperation();
    }
  }

  async function previewImportBackup() {
    const select = document.querySelector("#import-backup-select");
    const status = document.querySelector("#import-backup-status");
    if (!select.value || importBackupBusy) return;
    const key = select.value;
    setImportBackupBusy(true);
    status.textContent = "";
    try {
      const preview = await globalThis.BrowserToolboxConfigurationClientInstance.request(
        "preview-import-restore",
        { key },
      );
      if (preview.writeAllowed || preview.releaseAllowed || preview.lineageVerified) {
        throw new Error("INVALID_CONFIGURATION_RECOVERY");
      }
      const cursorKeys = {
        none: "importBackupCursorNone",
        missing: "importBackupCursorMissing",
        invalid: "importBackupCursorInvalid",
        unchecked: "importBackupCursorUnchecked",
        "header-valid": "importBackupCursorHeaderValid",
      };
      if (!Object.hasOwn(cursorKeys, preview.cursorStatus)) {
        throw new Error("INVALID_CONFIGURATION");
      }
      const fields = preview.keyboardFields.length
        ? preview.keyboardFields.join(", ")
        : message("none");
      const limitations = preview.legacyLimitations || [];
      status.textContent = [
        message("importBackupPreviewIntro"),
        `${message("importBackupPreviewKeyboard")}: ${fields}`,
        message(preview.toolboxChanged ? "importBackupToolboxChanged" : "importBackupToolboxSame"),
        `${message("importBackupPreviewCursor")}: ${message(cursorKeys[preview.cursorStatus])}`,
        preview.cursorChanged ? message("importBackupCursorChanged") : "",
        limitations.length
          ? `${message("importBackupUnsupported")}: ${limitations.join(", ")}${
            preview.legacyLimitationsTruncated ? ", …" : ""
          }`
          : "",
      ].filter(Boolean).join("\n");
    } catch (failure) {
      status.textContent = formatSettingsError(failure);
    } finally {
      finishImportBackupOperation();
    }
  }

  async function exportImportBackupCursor() {
    const select = document.querySelector("#import-backup-select");
    const status = document.querySelector("#import-backup-status");
    if (!select.value || importBackupBusy) return;
    const key = select.value;
    setImportBackupBusy(true);
    status.textContent = "";
    try {
      const cursor = await globalThis.BrowserToolboxConfigurationClientInstance.request(
        "export-import-cursor",
        { key },
      );
      const prefix = "data:image/png;base64,";
      if (typeof cursor.dataUrl !== "string" || !cursor.dataUrl.startsWith(prefix)) {
        throw new Error("INVALID_CURSOR_ASSET");
      }
      let binary;
      try {
        binary = atob(cursor.dataUrl.slice(prefix.length));
      } catch (_) {
        status.textContent = message("importBackupCursorDecodeFailed");
        return;
      }
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: cursor.pngHeaderValid ? "image/png" : "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = cursor.pngHeaderValid
          ? "browser-toolbox-pointer.png"
          : "browser-toolbox-pointer-original.bin";
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      status.textContent = message(
        cursor.pngHeaderValid ? "importBackupCursorExported" : "importBackupCursorExportedInvalid",
      );
    } catch (failure) {
      status.textContent = formatSettingsError(failure);
    } finally {
      finishImportBackupOperation();
    }
  }

  async function useImportBackupCursor() {
    const select = document.querySelector("#import-backup-select");
    const status = document.querySelector("#import-backup-status");
    if (!select.value || importBackupBusy || operationInProgress || !draft || !settings) return;
    const key = select.value;
    setOperationBusy(true);
    setImportBackupBusy(true);
    status.textContent = message("importBackupCursorLoading");
    let timer;
    let staged = false;
    let feedback = null;
    try {
      const client = globalThis.BrowserToolboxConfigurationClientInstance;
      const cursor = await Promise.race([
        client.request("export-import-cursor", { key }),
        new Promise((_, reject) => timer = setTimeout(() => reject(new Error("TIMEOUT")), 5000)),
      ]);
      clearTimeout(timer);
      timer = null;
      if (!cursor.pngHeaderValid || !await canPreviewCursorAsset(cursor.dataUrl)) {
        feedback = "importBackupCursorUseInvalid";
        return;
      }
      if (!stageCursorDraft(cursor.dataUrl)) throw new Error("INVALID_CURSOR_ASSET");
      staged = true;
    } catch (_) {
      feedback = "importBackupCursorUseFailed";
    } finally {
      clearTimeout(timer);
      finishImportBackupOperation();
      setOperationBusy(false);
      if (feedback) status.textContent = message(feedback);
    }
    if (staged) {
      status.textContent = message("localCursorDraft");
      if (!document.querySelector('[data-panel="backupAbout"]').hidden) {
        navigation?.activate(document.querySelector('[data-section="appearance"]'), {
          focus: true,
        });
      }
      if (!document.querySelector('[data-panel="appearance"]').hidden) {
        document.querySelector("#local-cursor-status").textContent = message("localCursorDraft");
      }
    }
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

  function vimiumBackupSource(payload) {
    return payload?.settings && typeof payload.settings === "object" &&
        !Array.isArray(payload.settings)
      ? payload.settings
      : payload;
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
      "searchUrl",
    ]);
    const booleans = new Set([
      "filterLinkHints",
      "smoothScroll",
      "regexFindMode",
      "waitForEnterForFilteredHints",
      "hideHud",
      "openVomnibarOnNewTabPage",
      "grabBackFocus",
      "ignoreKeyboardLayout",
      "helpDialog_showAdvancedCommands",
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

  async function inspectKeyboardBackup(input) {
    const { inspectLegacyBackup, formatLegacyBackupFields } = await import(
      "./browser_toolbox/legacy_settings_backup.js"
    );
    try {
      return inspectLegacyBackup(JSON.stringify(input));
    } catch (failure) {
      if (
        ["UNSUPPORTED_LEGACY_BACKUP_RULE_FIELDS", "INVALID_LEGACY_BACKUP_FIELDS"].includes(
          failure?.code,
        )
      ) throw new Error(formatLegacyBackupFields(failure, message));
      throw new Error(message("invalidSettings"));
    }
  }

  async function importVimiumBackup(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(message("invalidSettings"));
    }
    const source = vimiumBackupSource(payload);
    const report = await inspectKeyboardBackup(source);
    const fields = report.patch;
    if (Object.keys(fields).length === 0 || !vimiumSettings.isAvailable()) {
      throw new Error(message("invalidSettings"));
    }
    if (Object.entries(fields).some(([name, value]) => !validateVimiumField(name, value))) {
      throw new Error(message("invalidSettings"));
    }
    const unknown = [...report.ignoredFields, ...(report.truncated ? ["…"] : [])];
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
    const list = (values) => values.length ? values.join(", ") : message("none");
    summary.changed.push(
      `${message("legacyBackupRecognizedFields")}: ${list(report.recognizedFields)}`,
      `${message("legacyBackupConvertedFields")}: ${list(report.convertedFields)}`,
    );
    if (!(await requestImportConfirmation(summary, { ignored: unknown }))) return false;
    settings = await persistSettings(result.value, fields, { beforeImport: true });
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
    const keyboardPatch = { ...(parsedExport.keyboardSettings || {}) };
    for (const value of [payload.settings, payload.keyboardSettings?.values]) {
      if (value && Object.hasOwn(value, "exclusionRules")) {
        await inspectKeyboardBackup({
          settingsVersion: "2.4.2",
          exclusionRules: value.exclusionRules,
        });
      }
    }
    // 旧版工具箱备份没有独立键盘分区时，明确保存的规则仍属于键盘权威域。
    if (
      !Object.hasOwn(keyboardPatch, "exclusionRules") &&
      Object.hasOwn(payload.settings, "exclusionRules")
    ) keyboardPatch.exclusionRules = schema.clone(payload.settings.exclusionRules);
    if (Object.entries(keyboardPatch).some(([name, value]) => !validateVimiumField(name, value))) {
      throw new Error(message("invalidSettings"));
    }
    const migrated = parsedExport.settings;
    if (Object.hasOwn(keyboardPatch, "keyMappings")) {
      migrated.keyboard.keyMappings = keyboardPatch.keyMappings;
    }
    if (Object.hasOwn(keyboardPatch, "searchEngines")) {
      migrated.searchEngines = keyboardPatch.searchEngines;
    }
    if (Object.hasOwn(keyboardPatch, "exclusionRules")) {
      migrated.exclusionRules = keyboardPatch.exclusionRules;
    }
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
    if (Object.keys(keyboardPatch).length) {
      summary.changed.push(Object.keys(keyboardPatch).join(", "));
    }
    if (!(await requestImportConfirmation(summary, report))) return false;
    settings = await persistSettings(result.value, keyboardPatch, { beforeImport: true });
    markSettingsSaved(settings);
    writeForm();
    pendingCursorAsset = null;
    cursorResetRequested = false;
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
    renderGestureLabStatus();
  }

  function renderGestureLabStatus() {
    const status = document.querySelector("#gesture-lab-status");
    const addButton = document.querySelector("#add-gesture-binding");
    if (!status || !addButton) return;
    const analysis = gestureLab?.analyze?.(previewPattern, settings?.mouse?.bindings, registry) || {
      pattern: previewPattern,
      exact: [],
      prefixes: [],
      longer: [],
    };
    status.className = "browser-toolbox-note";
    if (previewPattern.length === 0) {
      status.textContent = message("gestureLabHint");
      addButton.disabled = true;
      return;
    }
    if (analysis.exact.length > 0) {
      const commands = analysis.exact.slice(0, 2).map((binding) =>
        commandLabel(registry?.getCommand(binding.commandName))
      ).join(", ");
      status.classList.add("is-warning");
      status.textContent = `${message("gestureLabDuplicateWarning")}: ${commands}`;
      updateMouseInspectorDetail(commands, quantizer.formatPattern(previewPattern));
      addButton.disabled = true;
      return;
    }
    const warnings = [];
    if (analysis.prefixes.length > 0) warnings.push(message("gestureLabPrefixWarning"));
    if (analysis.longer.length > 0) warnings.push(message("gestureLabLongerWarning"));
    addButton.disabled = false;
    updateMouseInspectorDetail(
      message("gestureLabReady"),
      quantizer.formatPattern(previewPattern),
    );
    if (warnings.length > 0) {
      status.classList.add("is-warning");
      status.textContent = warnings.join(" ");
    } else {
      status.classList.add("is-success");
      status.textContent = message("gestureLabReady");
    }
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
    syncNavigationTooltips();
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

  function setupLocalCursorAssets() {
    const select = document.querySelector("#local-cursor-select");
    const refresh = document.querySelector("#local-cursor-refresh");
    const more = document.querySelector("#local-cursor-more");
    const view = document.querySelector("#local-cursor-view");
    const use = document.querySelector("#local-cursor-use");
    const download = document.querySelector("#local-cursor-export");
    const preview = document.querySelector("#local-cursor-preview");
    const status = document.querySelector("#local-cursor-status");
    const client = globalThis.BrowserToolboxConfigurationClientInstance;
    let busy = false;
    let next = null;
    let snapshot = null;
    const update = () => {
      refresh.disabled = busy;
      more.disabled = busy;
      more.hidden = !next;
      select.disabled = busy || !select.options.length;
      view.disabled = busy || !select.value;
      use.disabled = busy || !snapshot?.decodable;
      download.disabled = busy || !snapshot;
    };
    const clearPreview = () => {
      snapshot = null;
      preview.hidden = true;
      preview.removeAttribute("src");
      update();
    };
    const load = async (reset) => {
      if (busy || !reset && !next) return;
      busy = true;
      update();
      try {
        const result = await client.request("list-local-cursors", { after: reset ? null : next });
        if (
          result.writeAllowed !== false || result.releaseAllowed !== false ||
          result.lineageVerified !== false || !Array.isArray(result.keys) ||
          result.keys.some((key) => typeof key !== "string") ||
          result.next !== null && typeof result.next !== "string"
        ) throw new Error("INVALID_CURSOR_ASSET");
        if (reset) {
          select.replaceChildren();
          clearPreview();
        }
        const existing = new Set([...select.options].map((option) => option.value));
        for (const key of result.keys) {
          if (existing.has(key)) continue;
          const option = document.createElement("option");
          option.value = key;
          option.textContent = message("localCursorItem").replace(
            "$1",
            String(select.options.length + 1),
          );
          select.append(option);
          existing.add(key);
        }
        next = result.next;
        status.textContent = message(
          select.options.length ? "localCursorListed" : "localCursorEmpty",
        )
          .replace("$1", String(select.options.length));
      } catch (_) {
        status.textContent = message("localCursorUnavailable");
      } finally {
        busy = false;
        update();
      }
    };
    refresh.addEventListener("click", () => void load(true));
    more.addEventListener("click", () => void load(false));
    select.addEventListener("change", () => {
      clearPreview();
      status.textContent = "";
    });
    view.addEventListener("click", async () => {
      if (busy || !select.value) return;
      busy = true;
      clearPreview();
      try {
        const result = await client.request("read-local-cursor", { key: select.value });
        const prefix = "data:image/png;base64,";
        if (
          result.writeAllowed !== false || result.releaseAllowed !== false ||
          result.lineageVerified !== false || typeof result.dataUrl !== "string" ||
          !result.dataUrl.startsWith(prefix)
        ) throw new Error("INVALID_CURSOR_ASSET");
        const binary = atob(result.dataUrl.slice(prefix.length));
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const decodable = result.pngHeaderValid && await canPreviewCursorAsset(result.dataUrl);
        snapshot = { bytes, decodable, dataUrl: decodable ? result.dataUrl : null };
        if (decodable) {
          preview.src = result.dataUrl;
          preview.hidden = false;
        }
        status.textContent = message(
          decodable ? "localCursorPreviewed" : "localCursorOriginalOnly",
        );
      } catch (_) {
        status.textContent = message("localCursorUnreadable");
      } finally {
        busy = false;
        update();
      }
    });
    use.addEventListener("click", () => {
      if (
        busy || operationInProgress || !draft || !settings || !snapshot?.decodable ||
        !cursorAssetApi()?.isSafeAsset(snapshot.dataUrl)
      ) return;
      // 草稿持有已查看的内容；来源随后变化时不能悄悄改为另一张图片。
      if (!stageCursorDraft(snapshot.dataUrl)) return;
      status.textContent = message("localCursorDraft");
    });
    download.addEventListener("click", () => {
      if (busy || !snapshot) return;
      const blob = new Blob([snapshot.bytes], {
        type: snapshot.decodable ? "image/png" : "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = snapshot.decodable
          ? "browser-toolbox-local-pointer.png"
          : "browser-toolbox-local-pointer-original.bin";
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      status.textContent = message("localCursorExported");
    });
    update();
  }

  function setupMaintenanceEvents() {
    const runtimeStatus = document.querySelector("#runtime-maintenance-status");
    const runtimeInspect = document.querySelector("#runtime-inspect");
    const runtimeRestore = document.querySelector("#runtime-restore");
    const maintainRuntime = async (action) => {
      runtimeInspect.disabled = runtimeRestore.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({
          handler: "browserToolbox.runtimeMaintenance",
          action,
        });
        if (!result?.ok) throw new Error("RUNTIME_UNAVAILABLE");
        const values = [
          String(result.planVersion),
          String(result.activeFrames),
          String(result.failedFrames),
          String(result.refreshRequiredFrames),
        ];
        const status = message(
          result.engineName === "browser-toolbox" ? "runtimeStatusCanary" : "runtimeStatus",
        ).replace(
          /\$(\d)/g,
          (_match, index) => values[Number(index) - 1] || "",
        );
        runtimeStatus.textContent = result.pendingFrames > 0
          ? `${status} · ${message("runtimePending").replace("$1", String(result.pendingFrames))}`
          : status;
      } catch (_) {
        runtimeStatus.textContent = message("runtimeUnavailable");
      } finally {
        runtimeInspect.disabled = runtimeRestore.disabled = false;
      }
    };
    runtimeInspect?.addEventListener("click", () => maintainRuntime("inspect"));
    runtimeRestore?.addEventListener("click", () => maintainRuntime("restore"));
    const configurationStatus = document.querySelector("#configuration-status");
    const configurationButtons = [...document.querySelectorAll('[id^="configuration-"]')]
      .filter((element) => element.tagName === "BUTTON");
    const configuration = globalThis.BrowserToolboxConfigurationClientInstance;
    const observationSelect = document.querySelector("#conflict-observation-select");
    const observationRefresh = document.querySelector("#conflict-observation-refresh");
    const observationCapture = document.querySelector("#conflict-observation-capture");
    const observationExport = document.querySelector("#conflict-observation-export");
    const observationReview = document.querySelector("#conflict-observation-review");
    const observationStatus = document.querySelector("#conflict-observation-status");
    const reviewPanel = document.querySelector("#conflict-review");
    const reviewFields = document.querySelector("#conflict-review-fields");
    const reviewExport = document.querySelector("#conflict-review-export");
    const searchDefaultNote = document.querySelector("#conflict-search-default-note");
    const searchDefaultRecover = document.querySelector("#conflict-search-default-recover");
    let observationBusy = false;
    let activeReview = null;
    const updateObservationButtons = () => {
      const status = observationSelect.selectedOptions[0]?.dataset.status;
      const available = ["saved", "archived", "field-archive"].includes(
        status,
      );
      observationRefresh.disabled = observationBusy;
      observationCapture.disabled = observationBusy;
      observationSelect.disabled = observationBusy ||
        ![...observationSelect.options].some((option) => !option.disabled && option.value);
      observationExport.disabled = observationBusy || !available;
      observationReview.disabled = observationBusy || !available || status === "field-archive";
      const groups = [...reviewFields.querySelectorAll("fieldset")];
      for (const group of groups) group.disabled = observationBusy;
      reviewExport.disabled = observationBusy || !activeReview || !groups.length ||
        groups.some((group) => !group.querySelector('input[type="radio"]:checked'));
      searchDefaultRecover.disabled = observationBusy || !activeReview?.searchDefaultRecoveryAvailable ||
        groups.length !== 1 ||
        groups[0].querySelector('input[type="radio"]:checked')?.value !== "observed";
    };
    const clearReview = () => {
      activeReview = null;
      reviewPanel.hidden = true;
      searchDefaultNote.hidden = true;
      searchDefaultRecover.hidden = true;
      reviewFields.replaceChildren();
      updateObservationButtons();
    };
    const loadObservations = async () => {
      const records = await configuration.request("list-conflict-observations");
      if (!Array.isArray(records)) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
      clearReview();
      observationSelect.replaceChildren();
      for (const item of records) {
        const labels = {
          saved: "conflictObservationSaved",
          archived: "conflictObservationArchived",
          "field-archive": "conflictObservationFieldArchive",
          unsupported: "conflictObservationUnsupported",
          quota: "conflictObservationQuotaMarker",
          invalid: "conflictObservationInvalid",
        };
        if (!Object.hasOwn(labels, item.status)) {
          throw new Error("INVALID_CONFIGURATION_OBSERVATION");
        }
        const option = document.createElement("option");
        const time = item.capturedAt ? ` · ${item.capturedAt}` : "";
        option.textContent = message(labels[item.status]) + time;
        option.value = item.key;
        option.dataset.status = item.status;
        option.disabled = !["saved", "archived", "field-archive"].includes(item.status);
        observationSelect.append(option);
      }
      const first = [...observationSelect.options].find((option) => !option.disabled);
      if (first) observationSelect.value = first.value;
      observationStatus.textContent = message(
        records.length ? "conflictObservationListed" : "conflictObservationEmpty",
      ).replace("$1", String(records.length));
    };
    const withObservationBusy = async (operation) => {
      if (observationBusy) return;
      observationBusy = true;
      updateObservationButtons();
      try {
        await operation();
      } catch (failure) {
        const labels = {
          CONFIGURATION_BACKUP_QUOTA: "conflictObservationQuota",
          CONFIGURATION_LOCAL_QUOTA: "conflictObservationQuota",
          CONFIGURATION_CONFLICT_REVIEW_TOO_LARGE: "conflictReviewTooLarge",
          CONFIGURATION_EXTERNAL_CONFLICT: "conflictReviewChanged",
          CONFIGURATION_DIGEST_MISMATCH: "conflictReviewChanged",
          INVALID_CONFIGURATION_CONFLICT_CHOICES: "conflictReviewInvalid",
        };
        observationStatus.textContent = message(
          labels[failure?.code] ||
            (activeReview ? "conflictReviewInvalid" : "configurationUnavailable"),
        );
      } finally {
        observationBusy = false;
        updateObservationButtons();
      }
    };
    observationSelect.addEventListener("change", clearReview);
    observationRefresh.addEventListener("click", () => withObservationBusy(loadObservations));
    observationCapture.addEventListener("click", () =>
      withObservationBusy(async () => {
        const result = await configuration.request("capture-conflict-observation");
        if (
          result.writeAllowed !== false || result.releaseAllowed !== false ||
          result.lineageVerified !== false || result.pointInTimeVerified !== false ||
          !["saved", "unsupported", "quota"].includes(result.status)
        ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
        await loadObservations();
        const status = result.status === "saved"
          ? "conflictObservationCaptured"
          : result.status === "quota"
          ? "conflictObservationQuota"
          : "conflictObservationOnlyMarker";
        observationStatus.textContent = message(status);
      }));
    observationExport.addEventListener("click", () =>
      withObservationBusy(async () => {
        const saved = await configuration.request("export-conflict-observation", {
          key: observationSelect.value,
        });
        if (
          saved.writeAllowed !== false || saved.releaseAllowed !== false ||
          saved.lineageVerified !== false || saved.pointInTimeVerified !== false
        ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
        downloadSettings(saved, "browser-toolbox-saved-conflict-observation.json");
        observationStatus.textContent = message("conflictObservationExported");
      }));
    observationReview.addEventListener("click", () =>
      withObservationBusy(async () => {
        clearReview();
        const key = observationSelect.value;
        const review = await configuration.request("review-conflict-observation", { key });
        if (
          review.writeAllowed !== false || review.releaseAllowed !== false ||
          review.lineageVerified !== false || review.pointInTimeVerified !== false ||
          typeof review.recordDigest !== "string" || !Array.isArray(review.fields)
        ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
        review.fields.forEach((field, index) => {
          if (
            typeof field.path !== "string" || !field.committed || !field.observed ||
            typeof field.committed.present !== "boolean" ||
            typeof field.observed.present !== "boolean"
          ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
          const group = document.createElement("fieldset");
          group.dataset.path = field.path;
          const legend = document.createElement("legend");
          legend.textContent = field.path;
          group.append(legend);
          for (const side of ["committed", "observed"]) {
            const label = document.createElement("label");
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = `conflict-review-choice-${index}`;
            radio.value = side;
            const text = document.createElement("span");
            text.textContent = message(
              side === "committed" ? "conflictReviewCommitted" : "conflictReviewObserved",
            );
            label.append(radio, " ", text);
            const value = document.createElement("pre");
            value.textContent = field[side].present
              ? JSON.stringify(field[side].value, null, 2)
              : message("conflictReviewMissing");
            group.append(label, value);
          }
          reviewFields.append(group);
        });
        activeReview = {
          key,
          recordDigest: review.recordDigest,
          searchDefaultRecoveryAvailable: review.searchDefaultRecoveryAvailable === true,
        };
        searchDefaultNote.hidden = searchDefaultRecover.hidden =
          !activeReview.searchDefaultRecoveryAvailable;
        reviewPanel.hidden = false;
        observationStatus.textContent = message(
          review.fields.length ? "conflictReviewChoose" : "conflictReviewNoChanges",
        );
      }));
    searchDefaultRecover.addEventListener("click", () =>
      withObservationBusy(async () => {
        if (draft?.isDirty || operationInProgress) {
          observationStatus.textContent = message("configurationSaveFirst");
          return;
        }
        if (!activeReview?.searchDefaultRecoveryAvailable ||
          reviewFields.querySelector('input[type="radio"]:checked')?.value !== "observed") {
          throw new Error("INVALID_CONFIGURATION_CONFLICT_CHOICES");
        }
        setOperationBusy(true);
        try {
          const result = await configuration.request("recover-search-default-conflict", {
            key: activeReview.key,
            recordDigest: activeReview.recordDigest,
          });
          if (settings) {
            vimiumSettings.source()._settings = schema.clone(result.keyboard);
            vimiumSettings.source().configurationRevision = result.revision;
            repository.settings = schema.clone(result.toolboxSource.value);
            repository.storageArea = result.toolboxSource.area;
            const snapshot = settingsService.capture({ saveBaseline: true });
            settings = snapshot.settings;
            markSettingsSaved(settings);
            writeForm();
            applySettingsLocale();
          }
          await loadObservations();
          await maintainConfiguration("preview");
          const current = await configuration.request("preview");
          if (current.code) throw Object.assign(new Error(current.code), { code: current.code });
          configurationStatus.textContent = message("conflictSearchDefaultRecovered");
          observationStatus.textContent = message("conflictSearchDefaultRecovered");
        } finally {
          setOperationBusy(false);
        }
      }));
    reviewFields.addEventListener("change", updateObservationButtons);
    reviewExport.addEventListener("click", () =>
      withObservationBusy(async () => {
        if (!activeReview) throw new Error("INVALID_CONFIGURATION_CONFLICT_CHOICES");
        const choices = [...reviewFields.querySelectorAll("fieldset")].map((group) => ({
          path: group.dataset.path,
          side: group.querySelector('input[type="radio"]:checked')?.value,
        }));
        const candidate = await configuration.request("prepare-conflict-candidate", {
          ...activeReview,
          choices,
        });
        if (
          candidate.writeAllowed !== false || candidate.releaseAllowed !== false ||
          candidate.lineageVerified !== false || candidate.pointInTimeVerified !== false ||
          candidate.recordDigest !== activeReview.recordDigest
        ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
        const migrations = globalThis.BrowserToolboxSettingsMigrations;
        const keyboardFields = migrations.KEYBOARD_EXPORT_FIELDS;
        if (
          !Array.isArray(keyboardFields) ||
          Object.keys(candidate.keyboard).length !== keyboardFields.length ||
          keyboardFields.some((field) => !Object.hasOwn(candidate.keyboard, field))
        ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
        const toolbox = schema.clone(candidate.toolbox);
        toolbox.cursor.localAssetId = null;
        toolbox.cursor.enabled = false;
        const settings = applicationServiceApi.composeSettings(toolbox, candidate.keyboard);
        const payload = migrations.createExportPayload(settings, {
          extensionVersion: chrome.runtime.getManifest().version,
          keyboardSettings: candidate.keyboard,
        });
        const parsed = migrations.parseExportPayload(payload);
        if (
          !parsed?.ok || parsed.ignored.length || parsed.preserved.length ||
          keyboardFields.some((field) =>
            JSON.stringify(parsed.keyboardSettings[field]) !==
              JSON.stringify(candidate.keyboard[field])
          )
        ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
        downloadSettings(payload, "browser-toolbox-conflict-candidate.json");
        observationStatus.textContent = message("conflictReviewExported");
      }));
    const maintainConfiguration = async (action, input = {}) => {
      if (!["preview", "export", "export-conflict"].includes(action) && draft?.isDirty) {
        configurationStatus.textContent = message("configurationSaveFirst");
        return;
      }
      configurationButtons.forEach((button) => button.disabled = true);
      try {
        if (action === "export-conflict") {
          const observation = await configuration.request("export-conflict");
          if (
            observation.writeAllowed !== false || observation.releaseAllowed !== false ||
            observation.lineageVerified !== false || observation.pointInTimeVerified !== false
          ) throw new Error("INVALID_CONFIGURATION_OBSERVATION");
          downloadSettings(observation, "browser-toolbox-conflict-observation.json");
          configurationStatus.textContent = message("configurationConflictExported");
          return;
        }
        if (action === "export") {
          const recovery = await configuration.request("export");
          const view = recovery.snapshot;
          const toolbox = applicationServiceApi.composeSettings(
            view.toolboxSource.value,
            view.keyboard,
          );
          const payload = globalThis.BrowserToolboxSettingsMigrations.createExportPayload(toolbox, {
            extensionVersion: chrome.runtime.getManifest().version,
            keyboardSettings: view.keyboard,
          });
          downloadSettings(
            payload,
            recovery.source === "baseline"
              ? "browser-toolbox-recovery-baseline.json"
              : "browser-toolbox-recovery-settings.json",
          );
          configurationStatus.textContent = message(
            recovery.source === "baseline"
              ? "configurationBaselineExported"
              : "configurationStatus",
          ).replace("$1", String(view.revision));
          return;
        }
        if (action !== "preview") await configuration.request(action, input);
        const summary = await configuration.request("preview");
        const conflict = ["CONFIGURATION_EXTERNAL_CONFLICT", "CONFIGURATION_RECOVERY_CONFLICT"]
          .includes(summary.code);
        for (const id of ["configuration-export-conflict", "configuration-conflict-export-note"]) {
          document.getElementById(id).hidden = !conflict;
        }
        observationCapture.hidden = !conflict;
        configurationStatus.textContent = message(
          summary.code
            ? conflict ? "configurationConflict" : "configurationUnavailable"
            : "configurationStatus",
        ).replace("$1", String(summary.revision));
        if (conflict) {
          const captureMessages = {
            saved: "conflictObservationCaptured",
            unsupported: "conflictObservationOnlyMarker",
            invalid: "conflictObservationInvalid",
            quota: "conflictObservationQuota",
            failed: "conflictObservationFailed",
          };
          observationStatus.textContent = message(
            captureMessages[summary.captureStatus] || "conflictObservationNotCaptured",
          );
          if (summary.captureStatus === "saved") {
            await withObservationBusy(loadObservations);
          }
        }
        if (action !== "preview" && settings) {
          const snapshot = await settingsService.load(registry);
          settings = snapshot.settings;
          markSettingsSaved(settings);
          writeForm();
          applySettingsLocale();
        }
      } catch (_) {
        configurationStatus.textContent = message("configurationUnavailable");
      } finally {
        configurationButtons.forEach((button) => button.disabled = false);
      }
    };
    document.querySelector("#configuration-inspect")?.addEventListener(
      "click",
      () => maintainConfiguration("preview"),
    );
    document.querySelector("#configuration-export")?.addEventListener(
      "click",
      () => maintainConfiguration("export"),
    );
    document.querySelector("#configuration-rollback")?.addEventListener(
      "click",
      () => maintainConfiguration("rollback"),
    );
    document.querySelector("#configuration-export-conflict")?.addEventListener(
      "click",
      () => maintainConfiguration("export-conflict"),
    );
  }

  function setupEvents() {
    document.querySelector("#restore-defaults").addEventListener("click", restoreDefaults);
    document.querySelector("#save-settings").addEventListener("click", save);
    document.querySelector("#export-settings").addEventListener("click", exportSettings);
    document.querySelector("#import-backup-refresh").addEventListener(
      "click",
      refreshImportBackups,
    );
    document.querySelector("#import-backup-export").addEventListener("click", exportImportBackup);
    document.querySelector("#import-backup-export-cursor").addEventListener(
      "click",
      exportImportBackupCursor,
    );
    document.querySelector("#import-backup-use-cursor").addEventListener(
      "click",
      useImportBackupCursor,
    );
    document.querySelector("#import-backup-preview").addEventListener("click", previewImportBackup);
    document.querySelector("#import-backup-select").addEventListener(
      "change",
      () => setImportBackupBusy(false),
    );
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
        if (imported) {
          document.querySelector("#save-status").textContent = message("saved");
          void refreshImportBackups();
        }
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
        applySettingsTheme();
        document.querySelector("#save-status").textContent = "";
        document.querySelector("#settings-error").textContent = "";
        await loadCursorPreview();
      } finally {
        setOperationBusy(false);
      }
    });
    document.querySelector("#add-site-rule").addEventListener("click", () => {
      const rule = {
        id: siteRulesApi.newId(),
        matchType: "glob",
        pattern: "https://example.com/*",
        enabled: true,
        modules: {},
      };
      settings.siteRules.push(rule);
      renderSiteRules();
      markDraftDirty();
      const row = [...document.querySelectorAll("#site-rules [data-rule-id]")]
        .find((element) => element.dataset.ruleId === rule.id);
      const pattern = row?.querySelector("[data-field=pattern]");
      pattern?.focus({ preventScroll: true });
      pattern?.select();
      pattern?.scrollIntoView({ block: "center", inline: "nearest" });
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
      renderGestureLabStatus();
      markDraftDirty();
    });
    document.querySelector("#gesture-pattern-input").addEventListener("input", (event) => {
      setPreviewPattern(event.target.value, false);
    });
    document.querySelector("#gesture-pattern-input").addEventListener("blur", (event) => {
      setPreviewPattern(event.target.value);
    });
    document.querySelector("#mouse-bindings")?.addEventListener("click", (event) => {
      const thumb = event.target.closest?.(".browser-toolbox-gesture-thumb");
      const row = thumb?.closest?.("tr");
      if (!row?._binding) return;
      const normalized = directionQuantizer?.normalizePattern?.(row._binding.pattern) || [];
      if (normalized.length > 0) editor?.showPattern?.(normalized);
      const commandText = commandLabel(registry?.getCommand(row._binding.commandName));
      const patternText = directionQuantizer?.formatPattern?.(normalized) || "";
      updateMouseInspectorDetail(commandText, patternText);
    });
    document.addEventListener("input", (event) => {
      if (event.target.closest?.("#mouse-bindings")) {
        bindingEditor?.sync();
        renderGestureLabStatus();
      }
      if (
        !event.target.closest("#site-rules, #conflict-review, #local-cursor-assets") &&
        event.target.id !== "gesture-pattern-input" &&
        event.target.id !== "conflict-observation-select" &&
        event.target.id !== "site-rule-test-url"
      ) markDraftDirty({ sync: true });
    });
    document.addEventListener("change", (event) => {
      if (event.target.closest?.("#mouse-bindings")) renderGestureLabStatus();
      if (
        !event.target.closest("#site-rules, #conflict-review, #local-cursor-assets") &&
        event.target.id !== "import-settings" &&
        event.target.id !== "cursor-file" &&
        event.target.id !== "conflict-observation-select" &&
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
    BrowserToolboxI18n.apply(document);
    setupLocalCursorAssets();
    setupMaintenanceEvents();
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
        if (kind === "mouse") {
          renderMouseGestureCards();
          renderGestureLabStatus();
        }
      },
    });
    BrowserToolboxI18n.setLocale(settings.general.language);
    BrowserToolboxI18n.apply(document);
    applySettingsTheme();
    document.querySelector("#general-theme")?.addEventListener("change", (event) => {
      // 下拉框改动即实时预览主题，同时保留草稿脏状态由用户显式保存或放弃。
      applySettingsTheme(event.target.value);
    });
    editor = new globalThis.BrowserToolboxGestureEditor(
      document.querySelector("#gesture-canvas"),
      (pattern) => {
        setPreviewPattern(pattern);
      },
    );
    setupNavigation();
    setupSidebarToggle();
    toolSettingsApi?.render(settings);
    toolSettingsApi?.bindLimitFeedback();
    setupEvents();
    void refreshImportBackups();
    setPreviewPattern([]);
    writeForm();
    applySiteShortcut();
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
