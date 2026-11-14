// SPDX-License-Identifier: GPL-3.0-or-later
// 多主题外观预设注册表与同步应用辅助；与 pages/theme_tokens.css 保持同一套调色板真源。
(function () {
  const DEFAULT_THEME = "sage-mist";
  const SUPPORTED_THEMES = Object.freeze(
    globalThis.BrowserToolboxSettingsSchema?.SUPPORTED_THEMES ||
      ["sage-mist", "cobalt", "paper-ink", "slate"],
  );
  const STORAGE_KEY = "browserToolboxSettings";

  function getReadKeys() {
    const legacyKey = globalThis.BrowserToolboxStorageKeys?.legacySettings;
    return legacyKey ? [STORAGE_KEY, legacyKey] : [STORAGE_KEY];
  }

  // 供 Shadow DOM 与 Canvas 轨迹读取的明暗调色板，避免内容脚本直接依赖页面 CSS。
  const PALETTES = Object.freeze({
    "sage-mist": Object.freeze({
      light: Object.freeze({
        bg: "#f3f7f4",
        border: "#c8d8ce",
        sep: "#d4e2d9",
        text: "#1b2e24",
        muted: "#5a7063",
        track: "#88a093",
        accent: "#15803d",
        trail: "#1f7a5c",
        trailHalo: "rgba(255, 255, 255, .78)",
        shadow: "0 8px 24px rgba(20, 40, 30, .10), 0 1px 3px rgba(20, 40, 30, .06)",
        cancelBg: "#fff7ed",
        cancelBorder: "#fdba74",
        cancelText: "#9a3412",
        cancelTrack: "rgba(154, 52, 18, .55)",
        cancelPillBg: "#9a3412",
        cancelPillText: "#fff7ed",
      }),
      dark: Object.freeze({
        bg: "#141e19",
        border: "#2b3f34",
        sep: "#24362c",
        text: "#e2ece6",
        muted: "#8ca496",
        track: "#6f8a7b",
        accent: "#4ade80",
        trail: "#4ade80",
        trailHalo: "rgba(10, 18, 14, .78)",
        shadow: "0 10px 28px rgba(0, 0, 0, .42), 0 1px 4px rgba(0, 0, 0, .28)",
        cancelBg: "#2e160d",
        cancelBorder: "#9a3412",
        cancelText: "#fed7aa",
        cancelTrack: "rgba(254, 215, 170, .55)",
        cancelPillBg: "#c2410c",
        cancelPillText: "#fff7ed",
      }),
    }),
    cobalt: Object.freeze({
      light: Object.freeze({
        bg: "#ffffff",
        border: "#d4def0",
        sep: "#e6ebf5",
        text: "#182032",
        muted: "#535d73",
        track: "#94a3b8",
        accent: "#2d58f5",
        trail: "#2d58f5",
        trailHalo: "rgba(255, 255, 255, .82)",
        shadow: "0 8px 24px rgba(15, 23, 42, .12), 0 1px 3px rgba(15, 23, 42, .06)",
        cancelBg: "#fff7ed",
        cancelBorder: "#fdba74",
        cancelText: "#9a3412",
        cancelTrack: "rgba(154, 52, 18, .55)",
        cancelPillBg: "#9a3412",
        cancelPillText: "#fff7ed",
      }),
      dark: Object.freeze({
        bg: "#141b2b",
        border: "#2a3956",
        sep: "#232e44",
        text: "#ebf0f9",
        muted: "#98a6bf",
        track: "#64748b",
        accent: "#5b82ff",
        trail: "#5b82ff",
        trailHalo: "rgba(10, 14, 24, .78)",
        shadow: "0 10px 28px rgba(0, 0, 0, .46), 0 1px 4px rgba(0, 0, 0, .30)",
        cancelBg: "#2e160d",
        cancelBorder: "#9a3412",
        cancelText: "#fed7aa",
        cancelTrack: "rgba(254, 215, 170, .55)",
        cancelPillBg: "#c2410c",
        cancelPillText: "#fff7ed",
      }),
    }),
    "paper-ink": Object.freeze({
      light: Object.freeze({
        bg: "#faf8f5",
        border: "#dfd6c8",
        sep: "#eae3d8",
        text: "#1f1b16",
        muted: "#6f665a",
        track: "#a39887",
        accent: "#b45309",
        trail: "#b45309",
        trailHalo: "rgba(255, 255, 255, .82)",
        shadow: "0 8px 24px rgba(41, 31, 20, .12), 0 1px 3px rgba(41, 31, 20, .06)",
        cancelBg: "#fef2f2",
        cancelBorder: "#fca5a5",
        cancelText: "#991b1b",
        cancelTrack: "rgba(153, 27, 27, .55)",
        cancelPillBg: "#991b1b",
        cancelPillText: "#fef2f2",
      }),
      dark: Object.freeze({
        bg: "#191714",
        border: "#352f27",
        sep: "#2b2620",
        text: "#f3efe8",
        muted: "#a69d8f",
        track: "#857b6d",
        accent: "#f5b963",
        trail: "#f5b963",
        trailHalo: "rgba(18, 15, 11, .78)",
        shadow: "0 10px 28px rgba(0, 0, 0, .46), 0 1px 4px rgba(0, 0, 0, .30)",
        cancelBg: "#311214",
        cancelBorder: "#991b1b",
        cancelText: "#fecaca",
        cancelTrack: "rgba(254, 202, 202, .55)",
        cancelPillBg: "#b91c1c",
        cancelPillText: "#fef2f2",
      }),
    }),
    slate: Object.freeze({
      light: Object.freeze({
        bg: "#ffffff",
        border: "#d4d4d8",
        sep: "#e4e4e7",
        text: "#18181b",
        muted: "#63636e",
        track: "#9f9fa9",
        accent: "#18181b",
        trail: "#27272a",
        trailHalo: "rgba(255, 255, 255, .85)",
        shadow: "0 8px 24px rgba(15, 23, 42, .12), 0 1px 3px rgba(15, 23, 42, .06)",
        cancelBg: "#fff7ed",
        cancelBorder: "#fdba74",
        cancelText: "#9a3412",
        cancelTrack: "rgba(154, 52, 18, .55)",
        cancelPillBg: "#9a3412",
        cancelPillText: "#fff7ed",
      }),
      dark: Object.freeze({
        bg: "#18181c",
        border: "#313138",
        sep: "#27272e",
        text: "#f4f4f6",
        muted: "#9f9fa9",
        track: "#71717a",
        accent: "#f4f4f6",
        trail: "#e4e4e7",
        trailHalo: "rgba(12, 12, 15, .78)",
        shadow: "0 10px 28px rgba(0, 0, 0, .48), 0 1px 4px rgba(0, 0, 0, .32)",
        cancelBg: "#2e160d",
        cancelBorder: "#9a3412",
        cancelText: "#fed7aa",
        cancelTrack: "rgba(254, 215, 170, .55)",
        cancelPillBg: "#c2410c",
        cancelPillText: "#fff7ed",
      }),
    }),
  });

  function resolveTheme(theme) {
    return SUPPORTED_THEMES.includes(theme) ? theme : DEFAULT_THEME;
  }

  function isDarkMode(win = globalThis) {
    try {
      return Boolean(win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
    } catch (_) {
      return false;
    }
  }

  function getPalette(theme, dark = isDarkMode()) {
    const resolved = resolveTheme(theme);
    return PALETTES[resolved][dark ? "dark" : "light"];
  }

  function applyTheme(theme, doc = globalThis.document) {
    const resolved = resolveTheme(theme);
    if (doc?.documentElement?.dataset) {
      doc.documentElement.dataset.btTheme = resolved;
    }
    return resolved;
  }

  function extractTheme(record) {
    const legacyKey = globalThis.BrowserToolboxStorageKeys?.legacySettings;
    const value = record?.[STORAGE_KEY] || (legacyKey ? record?.[legacyKey] : null);
    return value?.general?.theme;
  }

  async function readStoredTheme() {
    let raw = null;
    try {
      const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
      if (repository?.getStoredTheme) {
        raw = await repository.getStoredTheme();
      } else if (globalThis.BrowserToolboxSettingsStorageInstance?.getStoredTheme) {
        raw = await globalThis.BrowserToolboxSettingsStorageInstance.getStoredTheme();
      } else if (globalThis.chrome?.storage) {
        // 与 SettingsStorage.readSettings 保持一致：规范键优先于旧键，同级下 local 优先于 sync。
        const keys = getReadKeys();
        const legacyKey = keys[1];
        const [localValues, syncValues] = await Promise.all([
          globalThis.chrome.storage.local?.get?.(keys).catch?.(() => ({})) || {},
          globalThis.chrome.storage.sync?.get?.(keys).catch?.(() => ({})) || {},
        ]);
        const candidates = [
          localValues?.[STORAGE_KEY],
          syncValues?.[STORAGE_KEY],
          legacyKey ? localValues?.[legacyKey] : null,
          legacyKey ? syncValues?.[legacyKey] : null,
        ];
        const selected = candidates.find((item) => item != null);
        raw = selected?.general?.theme;
      }
    } catch (_) {
      // 存储不可用时回退默认主题，确保界面渲染不阻塞。
    }
    return resolveTheme(raw);
  }

  async function applyStoredTheme(doc = globalThis.document, onChange) {
    const resolved = applyTheme(await readStoredTheme(), doc);
    onChange?.(resolved);
    return resolved;
  }

  function watchTheme(doc = globalThis.document, onChange) {
    const storageApi = globalThis.chrome?.storage;
    const runtimeApi = globalThis.chrome?.runtime;
    const refresh = () => void applyStoredTheme(doc, onChange);

    const onStorageChanged = (changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") return;
      const legacyKey = globalThis.BrowserToolboxStorageKeys?.legacySettings;
      const changed = changes?.[STORAGE_KEY] || (legacyKey ? changes?.[legacyKey] : null);
      if (!changed) return;
      if (areaName === "local") {
        const nextTheme = extractTheme({ [STORAGE_KEY]: changed.newValue });
        if (nextTheme != null) {
          const resolved = applyTheme(nextTheme, doc);
          onChange?.(resolved);
          return;
        }
      }
      refresh();
    };

    const onRuntimeMessage = (message) => {
      if (message?.type === "browserToolbox.settingsChanged") refresh();
    };

    storageApi?.onChanged?.addListener?.(onStorageChanged);
    runtimeApi?.onMessage?.addListener?.(onRuntimeMessage);

    return () => {
      storageApi?.onChanged?.removeListener?.(onStorageChanged);
      runtimeApi?.onMessage?.removeListener?.(onRuntimeMessage);
    };
  }

  globalThis.BrowserToolboxTheme = Object.freeze({
    DEFAULT_THEME,
    SUPPORTED_THEMES,
    PALETTES,
    resolveTheme,
    isDarkMode,
    getPalette,
    applyTheme,
    readStoredTheme,
    applyStoredTheme,
    watchTheme,
  });
})();
