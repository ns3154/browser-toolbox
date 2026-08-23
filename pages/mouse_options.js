// OpenKeyMouse 设置页控制器。命令下拉框从后台注册表读取，不维护第二份命令清单。
(function () {
  const repository = globalThis.OpenKeyMouseSettingsRepositoryInstance;
  const schema = globalThis.OpenKeyMouseSettingsSchema;
  const migrations = globalThis.OpenKeyMouseSettingsMigrations;
  const validator = globalThis.OpenKeyMouseSettingsValidator;
  const quantizer = globalThis.OpenKeyMouseDirectionQuantizer;
  let settings;
  let registry;
  let editor;
  let previewPattern = [];
  let pendingCursorAsset = null;
  let cursorResetRequested = false;

  function message(key) {
    return globalThis.OpenKeyMouseI18n?.message(key) || key;
  }

  async function loadRegistry() {
    const response = await chrome.runtime.sendMessage({ handler: "openKeyMouse.commandRegistry" });
    const commands = Array.isArray(response) ? response : [];
    const byName = new Map(commands.map((command) => [command.name, command]));
    registry = { commands, getCommand: (name) => byName.get(name) || null };
  }

  function commandOptions(select, selected) {
    select.replaceChildren();
    for (const command of registry.commands) {
      const option = document.createElement("option");
      option.value = command.name;
      const localized =
        command.i18nKey && globalThis.OpenKeyMouseI18n?.hasMessage?.(command.i18nKey)
          ? message(command.i18nKey)
          : null;
      option.textContent = localized || command.title || command.desc || command.name;
      option.selected = command.name === selected;
      select.appendChild(option);
    }
  }

  function cursorAssetApi() {
    return globalThis.OpenKeyMouseCursorAsset;
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
    const values = await chrome.storage.local.get(id);
    setCursorPreview(values[id], id);
  }

  function rowButton(labelKey, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = message(labelKey);
    button.addEventListener("click", onClick);
    return button;
  }

  function renderMouseBindings() {
    const body = document.querySelector("#mouse-bindings");
    body.replaceChildren();
    for (const binding of settings.mouse.bindings) {
      const row = document.createElement("tr");
      const pattern = document.createElement("input");
      pattern.value = binding.pattern.join(">");
      pattern.setAttribute("aria-label", message("pattern"));
      const command = document.createElement("select");
      commandOptions(command, binding.commandName);
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = binding.enabled !== false;
      const enabledLabel = document.createElement("label");
      enabledLabel.className = "okm-check";
      enabledLabel.append(enabled, document.createTextNode(message("enabled")));
      const remove = rowButton("removeBinding", () => {
        settings.mouse.bindings = settings.mouse.bindings.filter((item) => item !== binding);
        renderMouseBindings();
      });
      row.append(cell(pattern), cell(command), cell(enabledLabel), cell(remove));
      row._binding = binding;
      row._pattern = pattern;
      row._command = command;
      row._enabled = enabled;
      body.appendChild(row);
    }
  }

  function renderContextBindings(section, selector, columns) {
    const body = document.querySelector(selector);
    body.replaceChildren();
    for (const binding of settings[section].bindings) {
      const row = document.createElement("tr");
      for (const value of columns(binding)) row.appendChild(cell(value));
      body.appendChild(row);
    }
  }

  function cell(value) {
    const td = document.createElement("td");
    if (value instanceof Node) td.appendChild(value);
    else td.textContent = value == null ? "" : String(value);
    return td;
  }

  function renderAllBindings() {
    renderMouseBindings();
    renderContextBindings("superDrag", "#super-drag-bindings", (binding) => [
      binding.context,
      binding.pattern.join(">"),
      commandSelectForBinding(binding),
      rowButton("removeBinding", () => {
        settings.superDrag.bindings = settings.superDrag.bindings.filter((item) =>
          item !== binding
        );
        renderAllBindings();
      }),
    ]);
    renderContextBindings("wheel", "#wheel-bindings", (binding) => [
      binding.button,
      binding.direction,
      commandSelectForBinding(binding),
    ]);
    renderContextBindings("rocker", "#rocker-bindings", (binding) => [
      binding.sequence,
      commandSelectForBinding(binding),
    ]);
  }

  function commandSelectForBinding(binding) {
    const select = document.createElement("select");
    commandOptions(select, binding.commandName);
    select.addEventListener("change", () => binding.commandName = select.value);
    return select;
  }

  function renderSiteRules() {
    const body = document.querySelector("#site-rules");
    body.replaceChildren();
    for (const rule of settings.siteRules) {
      const row = document.createElement("tr");
      const pattern = document.createElement("input");
      pattern.value = rule.pattern;
      pattern.addEventListener("input", () => rule.pattern = pattern.value);
      const modules = document.createElement("div");
      for (const name of ["keyboard", "mouse", "superDrag", "wheel", "rocker", "cursor"]) {
        const label = document.createElement("label");
        label.className = "okm-check";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = rule.modules?.[name] !== false;
        checkbox.addEventListener("change", () => {
          rule.modules ||= {};
          rule.modules[name] = checkbox.checked;
        });
        label.append(checkbox, document.createTextNode(name));
        modules.appendChild(label);
      }
      row.append(
        cell(pattern),
        cell(modules),
        cell(rowButton("removeBinding", () => {
          settings.siteRules = settings.siteRules.filter((item) => item !== rule);
          renderSiteRules();
        })),
      );
      body.appendChild(row);
    }
  }

  function readForm() {
    settings.general.enabled = document.querySelector("#general-enabled").checked;
    settings.general.language = document.querySelector("#language").value;
    settings.keyboard.keyMappings = document.querySelector("#key-mappings").value;
    settings.searchEngines = document.querySelector("#search-engines").value;
    settings.mouse.enabled = document.querySelector("#mouse-enabled").checked;
    settings.mouse.directionMode = document.querySelector("#direction-mode").value;
    settings.mouse.activationDistancePx = Number(
      document.querySelector("#activation-distance").value,
    );
    settings.mouse.showTrail = document.querySelector("#show-trail").checked;
    settings.mouse.showCommandHud = document.querySelector("#show-command-hud").checked;
    settings.superDrag.enabled = document.querySelector("#super-drag-enabled").checked;
    settings.wheel.enabled = document.querySelector("#wheel-enabled").checked;
    settings.wheel.threshold = Number(document.querySelector("#wheel-threshold").value);
    settings.wheel.cooldownMs = Number(document.querySelector("#wheel-cooldown").value);
    settings.rocker.enabled = document.querySelector("#rocker-enabled").checked;
    settings.cursor.enabled = document.querySelector("#cursor-enabled").checked;
    settings.cursor.hotspotX = Number(document.querySelector("#cursor-hotspot-x").value);
    settings.cursor.hotspotY = Number(document.querySelector("#cursor-hotspot-y").value);
    for (const row of document.querySelectorAll("#mouse-bindings tr")) {
      const binding = row._binding;
      binding.pattern = quantizer.normalizePattern(row._pattern.value);
      binding.commandName = row._command.value;
      binding.enabled = row._enabled.checked;
    }
    return settings;
  }

  function writeForm() {
    document.querySelector("#general-enabled").checked = settings.general.enabled;
    document.querySelector("#language").value = settings.general.language;
    document.querySelector("#key-mappings").value = settings.keyboard.keyMappings;
    document.querySelector("#search-engines").value = settings.searchEngines;
    document.querySelector("#mouse-enabled").checked = settings.mouse.enabled;
    document.querySelector("#direction-mode").value = settings.mouse.directionMode;
    document.querySelector("#activation-distance").value = settings.mouse.activationDistancePx;
    document.querySelector("#show-trail").checked = settings.mouse.showTrail;
    document.querySelector("#show-command-hud").checked = settings.mouse.showCommandHud;
    document.querySelector("#super-drag-enabled").checked = settings.superDrag.enabled;
    document.querySelector("#wheel-enabled").checked = settings.wheel.enabled;
    document.querySelector("#wheel-threshold").value = settings.wheel.threshold;
    document.querySelector("#wheel-cooldown").value = settings.wheel.cooldownMs;
    document.querySelector("#rocker-enabled").checked = settings.rocker.enabled;
    document.querySelector("#cursor-enabled").checked = settings.cursor.enabled;
    document.querySelector("#cursor-hotspot-x").value = settings.cursor.hotspotX;
    document.querySelector("#cursor-hotspot-y").value = settings.cursor.hotspotY;
    renderAllBindings();
    renderSiteRules();
  }

  async function save() {
    readForm();
    const oldCursorAssetId = settings.cursor.localAssetId;
    let createdCursorAssetId = null;
    if (cursorResetRequested) {
      settings.cursor.localAssetId = null;
      settings.cursor.enabled = false;
    } else if (pendingCursorAsset) {
      if (!cursorAssetApi()?.isSafeAsset(pendingCursorAsset)) {
        document.querySelector("#settings-error").textContent = message("invalidSettings");
        return;
      }
      createdCursorAssetId = `openKeyMouseCursor-${
        globalThis.crypto?.randomUUID?.() || Date.now()
      }`;
      await chrome.storage.local.set({ [createdCursorAssetId]: pendingCursorAsset });
      settings.cursor.localAssetId = createdCursorAssetId;
    }
    const result = validator.validate(settings, registry);
    const error = document.querySelector("#settings-error");
    if (!result.ok) {
      if (createdCursorAssetId) await chrome.storage.local.remove(createdCursorAssetId);
      error.textContent = result.errors.join("\n");
      return;
    }
    try {
      error.textContent = "";
      await Settings.set("keyMappings", settings.keyboard.keyMappings);
      await Settings.set("searchEngines", settings.searchEngines);
      await repository.setSettings(result.value, registry);
      settings = repository.getSettings();
      if (oldCursorAssetId && oldCursorAssetId !== settings.cursor.localAssetId) {
        await chrome.storage.local.remove(oldCursorAssetId);
      }
      pendingCursorAsset = null;
      cursorResetRequested = false;
      OpenKeyMouseI18n.setLocale(settings.general.language);
      OpenKeyMouseI18n.apply(document);
      document.querySelector("#save-status").textContent = message("saved");
      writeForm();
      await loadCursorPreview();
    } catch (error) {
      if (createdCursorAssetId) await chrome.storage.local.remove(createdCursorAssetId);
      document.querySelector("#settings-error").textContent = error.message;
    }
  }

  function exportSettings() {
    const payload = {
      format: "open-key-mouse-settings",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      extensionVersion: chrome.runtime.getManifest().version,
      source: "OpenKeyMouse",
      settings: schema.clone(readForm()),
      localAssets: [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "open-key-mouse-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
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
    if (Object.keys(fields).length === 0 || !globalThis.Settings) {
      throw new Error(message("invalidSettings"));
    }
    if (Object.entries(fields).some(([name, value]) => !validateVimiumField(name, value))) {
      throw new Error(message("invalidSettings"));
    }
    const unknown = Object.keys(source).filter((key) =>
      key !== "settingsVersion" && !vimiumImportFields.includes(key)
    );
    const importedNames = Object.keys(fields).join(", ");
    const unknownText = unknown.length > 0
      ? `\n${message("ignoredFields")}: ${unknown.join(", ")}`
      : "";

    const next = schema.mergeSettings(settings);
    if (typeof fields.keyMappings === "string") next.keyboard.keyMappings = fields.keyMappings;
    if (typeof fields.searchEngines === "string") next.searchEngines = fields.searchEngines;
    if (Array.isArray(fields.exclusionRules)) next.exclusionRules = fields.exclusionRules;
    const result = validator.validate(next, registry);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    if (
      !globalThis.confirm?.(
        `${message("importSummary")}: ${importedNames}\n${
          message("changedSettings")
        }: ${importedNames}${unknownText}`,
      )
    ) return;
    await Settings.onLoaded();
    await Settings.setSettings(Object.assign(Settings.getSettings(), fields));
    await repository.setSettings(result.value, registry);
    settings = repository.getSettings();
    settings.keyboard.keyMappings = Settings.get("keyMappings");
    settings.searchEngines = Settings.get("searchEngines");
    writeForm();
    await loadCursorPreview();
    document.querySelector("#settings-error").textContent = unknown.length > 0
      ? `${message("ignoredFields")}: ${unknown.join(", ")}`
      : "";
  }

  async function importSettings(file) {
    if (!file || file.size > 1024 * 1024) throw new Error(message("invalidSettings"));
    const payload = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(message("invalidSettings"));
    }
    if (payload.format !== "open-key-mouse-settings" || !payload.settings) {
      return importVimiumBackup(payload);
    }
    const migrated = migrations.migrate(payload.settings);
    // 导入文件不携带本地指针二进制资源，避免产生悬空引用或把资源带出本机。
    migrated.cursor.localAssetId = null;
    migrated.cursor.enabled = false;
    const result = validator.validate(migrated, registry);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const changed = Object.keys(result.value).filter((key) =>
      JSON.stringify(result.value[key]) !== JSON.stringify(settings[key])
    );
    if (
      !globalThis.confirm?.(
        `${message("importSummary")}\n${message("changedSettings")}: ${
          changed.join(", ") || message("none")
        }`,
      )
    ) return;
    await Settings.set("keyMappings", result.value.keyboard.keyMappings);
    await Settings.set("searchEngines", result.value.searchEngines);
    await repository.setSettings(result.value, registry);
    settings = repository.getSettings();
    writeForm();
    pendingCursorAsset = null;
    cursorResetRequested = false;
    await loadCursorPreview();
  }

  function setupNavigation() {
    for (const button of document.querySelectorAll("[data-section]")) {
      button.addEventListener("click", () => {
        const name = button.dataset.section;
        for (const item of document.querySelectorAll("[data-section]")) {
          item.setAttribute("aria-selected", String(item === button));
        }
        for (const panel of document.querySelectorAll("[data-panel]")) {
          panel.hidden = panel.dataset.panel !== name;
        }
      });
    }
  }

  function setupEvents() {
    document.querySelector("#save-settings").addEventListener("click", save);
    document.querySelector("#export-settings").addEventListener("click", exportSettings);
    document.querySelector("#import-settings").addEventListener("change", async (event) => {
      try {
        await importSettings(event.target.files[0]);
        document.querySelector("#save-status").textContent = message("saved");
      } catch (error) {
        document.querySelector("#settings-error").textContent = error.message;
      } finally {
        event.target.value = "";
      }
    });
    document.querySelector("#add-site-rule").addEventListener("click", () => {
      settings.siteRules.push({
        id: `rule-${Date.now()}`,
        pattern: "https://example.com/*",
        enabled: true,
        modules: { keyboard: false },
      });
      renderSiteRules();
    });
    document.querySelector("#clear-gesture").addEventListener("click", () => editor.clear());
    document.querySelector("#add-gesture-binding").addEventListener("click", () => {
      if (previewPattern.length === 0) return;
      settings.mouse.bindings.push({
        id: `mouse-${Date.now()}`,
        enabled: true,
        pattern: previewPattern.slice(),
        commandName: "goBack",
        options: {},
      });
      renderMouseBindings();
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
    });
  }

  async function init() {
    await loadRegistry();
    await Settings.onLoaded();
    await repository.ensureLoaded(registry);
    settings = repository.getSettings();
    settings.keyboard.keyMappings = Settings.get("keyMappings");
    settings.searchEngines = Settings.get("searchEngines");
    OpenKeyMouseI18n.setLocale(settings.general.language);
    OpenKeyMouseI18n.apply(document);
    editor = new globalThis.OpenKeyMouseGestureEditor(
      document.querySelector("#gesture-canvas"),
      (pattern) => {
        previewPattern = pattern;
        document.querySelector("#gesture-preview").textContent = pattern.join(" > ") || "";
      },
    );
    setupNavigation();
    setupEvents();
    writeForm();
    await loadCursorPreview();
  }

  document.addEventListener("DOMContentLoaded", () =>
    init().catch((error) => {
      document.querySelector("#settings-error").textContent = error.message;
    }));
})();
