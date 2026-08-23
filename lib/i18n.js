// OpenKeyMouse 的本地国际化适配层。
//
// 扩展页面和内容脚本都通过 chrome.i18n 读取本地 messages.json。这里保留一个稳定的
// data-i18n 约定，避免把用户可见文字散落在各个控制器中，也不需要任何网络请求。
(function () {
  const fallbackMessages = {
    extensionName: "OpenKeyMouse",
    extensionDescription:
      "A free, local-first keyboard and mouse navigation extension with no telemetry.",
    openKeyMouse: "OpenKeyMouse",
    save: "Save",
    saved: "Saved",
    cancel: "Cancel",
    close: "Close",
    reset: "Reset",
    enabled: "Enabled",
    disabled: "Disabled",
    general: "General",
    keyboard: "Keyboard",
    mouseGestures: "Mouse Gestures",
    superDrag: "Super Drag",
    wheelRocker: "Wheel & Rocker",
    rocker: "Rocker",
    siteRules: "Site Rules",
    backupRestore: "Backup & Restore",
    privacy: "Privacy",
    aboutLicenses: "About & Licenses",
    openSettings: "Open settings",
    openHelp: "Open help",
    currentSite: "Current site",
    allModulesEnabled: "All OpenKeyMouse modules are enabled on this site.",
    pageUnavailable: "The browser does not allow extensions to run on this page.",
    noTelemetry: "No telemetry, accounts, advertising, or paid features.",
    pattern: "Pattern",
    command: "Command",
    addBinding: "Add binding",
    removeBinding: "Remove binding",
    restoreDefaults: "Restore defaults",
    importSettings: "Import settings",
    exportSettings: "Export settings",
    chooseFile: "Choose a file",
    invalidSettings: "The settings file is invalid.",
    gestureUnrecognized: "Gesture not recognized",
    gestureCancelled: "Gesture cancelled",
    browserRestriction: "This page is restricted by the browser.",
    language: "Language",
    languageAuto: "Follow browser",
    languageEnglish: "English",
    languageChinese: "简体中文",
    directionMode: "Direction mode",
    fourWay: "Four directions",
    eightWay: "Eight directions",
    activationDistance: "Activation distance (px)",
    showTrail: "Show gesture trail",
    showHud: "Show command HUD",
    privacyImmutable:
      "Telemetry, remote configuration, and background network access are permanently disabled.",
    tabs: "Tabs",
    cursor: "Custom pointer",
    cursorAsset: "Local PNG pointer",
    cursorHotspotX: "Hotspot X",
    cursorHotspotY: "Hotspot Y",
    noCursorAsset: "No local pointer selected.",
    resetCursor: "Remove local pointer",
    wheelThreshold: "Wheel threshold",
    cooldown: "Cooldown (ms)",
    button: "Button",
    direction: "Direction",
    sequence: "Sequence",
    urlPattern: "URL pattern",
    modules: "Modules",
    context: "Context",
    settingsSections: "Settings sections",
    gestureEditor: "Gesture editor",
    superDragSafety:
      "Alt always keeps native dragging. File uploads, editors, password fields, custom draggable widgets, and invalid URLs are not intercepted.",
    siteRuleSpecificity:
      "The most specific matching rule wins; the top-level page URL controls all frames.",
    backupContents:
      "Exports contain settings only. Page content, history, bookmarks, temporary gestures, and remote assets are never exported.",
    privacyNetwork:
      "Only user-initiated navigation, search, and local extension pages may cause network activity. No project server is contacted.",
    licenseGpl: "GPL-3.0-or-later",
    aboutText: "OpenKeyMouse is based on Vimium v2.4.2 and remains free and open source.",
    cleanRoomText:
      "Vimium and shoulda.js notices are preserved in the repository. Mouse features are an independent clean-room implementation based only on public behavior descriptions.",
    dataHandling: "Data handling",
    privacyData:
      "OpenKeyMouse does not send URLs, history, bookmarks, page content, selected text, search terms, keystrokes, mouse paths, pointer images, configuration, device identifiers, installation identifiers, or crash reports to a project server or third-party analytics service.",
    localStorage: "Local storage",
    privacyStorage:
      "Settings are stored in browser storage. Custom pointer assets, if enabled, remain in local storage and are not synchronized or uploaded.",
    security: "Security",
    onboardingIntro:
      "Keyboard navigation and independently implemented mouse controls for Chromium browsers.",
    onboardingGesture:
      "Right-button gestures keep the native context menu until the activation threshold is crossed.",
    onboardingDrag:
      "Super drag leaves file upload, editors, password fields, and custom draggable widgets alone.",
    onboardingInvocation: "Every action is routed through a validated command invocation.",
    search: "Search",
    searchSettings: "Search",
    appearance: "Appearance",
    keyMappings: "Keyboard mappings",
    searchEngines: "Search engines",
    keyboardMappingNote:
      "Vimium-compatible mappings are imported into the existing keyboard settings.",
    searchEngineNote: "Searches are sent only when you explicitly invoke a search command.",
    vimiumBackup:
      "You can also import a Vimium JSON backup. Recognized fields are copied to the compatible Vimium settings and OpenKeyMouse settings; unknown fields are reported and ignored.",
    importSummary: "Import these settings",
    changedSettings: "Changed settings",
    ignoredFields: "Ignored fields",
    none: "None",
    openOnboarding: "Open onboarding",
    projectCharter: "Project Charter",
    thirdPartyNotices: "Third-party notices",
    command_OpenKeyMouse_closeWindow: "Close current window",
    command_OpenKeyMouse_newWindow: "Open a new window",
    command_OpenKeyMouse_toggleFullscreen: "Toggle fullscreen",
    command_OpenKeyMouse_minimizeWindow: "Minimize current window",
    command_OpenKeyMouse_maximizeWindow: "Maximize current window",
    command_OpenKeyMouse_showTabList: "Show tab list",
    command_OpenKeyMouse_toggleKeyboard: "Toggle keyboard navigation",
    command_OpenKeyMouse_toggleMouseGestures: "Toggle mouse gestures",
    command_OpenKeyMouse_toggleSuperDrag: "Toggle super drag",
    command_OpenKeyMouse_copySelection: "Copy selected text",
    command_OpenKeyMouse_copyLinkText: "Copy link text",
    command_OpenKeyMouse_copyLinkUrl: "Copy link URL",
    command_OpenKeyMouse_copyImageUrl: "Copy image URL",
    command_OpenKeyMouse_searchSelection: "Search selected text",
    command_OpenKeyMouse_openLinkForeground: "Open link in foreground",
    command_OpenKeyMouse_openLinkBackground: "Open link in background",
    command_OpenKeyMouse_openImageForeground: "Open image in foreground",
    command_OpenKeyMouse_openImageBackground: "Open image in background",
    command_OpenKeyMouse_downloadImage: "Download image",
  };

  const zhMessages = {
    extensionName: "OpenKeyMouse",
    extensionDescription: "免费、本地优先、无遥测的键盘与鼠标导航扩展。",
    openKeyMouse: "OpenKeyMouse",
    save: "保存",
    saved: "已保存",
    cancel: "取消",
    close: "关闭",
    reset: "重置",
    enabled: "启用",
    disabled: "停用",
    general: "常规",
    keyboard: "键盘导航",
    mouseGestures: "鼠标手势",
    superDrag: "超级拖拽",
    wheelRocker: "滚轮与摇杆",
    rocker: "摇杆",
    siteRules: "站点规则",
    backupRestore: "备份与恢复",
    privacy: "隐私",
    aboutLicenses: "关于与许可证",
    openSettings: "打开设置",
    openHelp: "打开帮助",
    currentSite: "当前站点",
    allModulesEnabled: "当前站点已启用 OpenKeyMouse 的全部模块。",
    pageUnavailable: "浏览器不允许扩展在此页面运行。",
    noTelemetry: "无遥测、无账号、无广告、无付费功能。",
    pattern: "轨迹",
    command: "命令",
    addBinding: "添加绑定",
    removeBinding: "移除绑定",
    restoreDefaults: "恢复默认值",
    importSettings: "导入设置",
    exportSettings: "导出设置",
    chooseFile: "选择文件",
    invalidSettings: "设置文件无效。",
    gestureUnrecognized: "未识别手势",
    gestureCancelled: "手势已取消",
    browserRestriction: "此页面受浏览器限制。",
    language: "语言",
    languageAuto: "跟随浏览器",
    languageEnglish: "English",
    languageChinese: "简体中文",
    directionMode: "方向模式",
    fourWay: "四向",
    eightWay: "八向",
    activationDistance: "激活距离（像素）",
    showTrail: "显示手势轨迹",
    showHud: "显示命令提示",
    privacyImmutable: "遥测、远程配置和后台网络访问永久关闭。",
    tabs: "标签页",
    cursor: "自定义指针",
    cursorAsset: "本地 PNG 指针",
    cursorHotspotX: "热点 X",
    cursorHotspotY: "热点 Y",
    noCursorAsset: "尚未选择本地指针。",
    resetCursor: "移除本地指针",
    wheelThreshold: "滚轮阈值",
    cooldown: "冷却时间（毫秒）",
    button: "按键",
    direction: "方向",
    sequence: "顺序",
    urlPattern: "网址匹配式",
    modules: "模块",
    context: "对象",
    settingsSections: "设置分区",
    gestureEditor: "手势编辑器",
    superDragSafety:
      "按住 Alt 始终保留原生拖拽。文件上传、编辑器、密码框、自定义 draggable 控件和无效网址不会被拦截。",
    siteRuleSpecificity: "匹配度最高的规则优先；顶层页面网址控制所有框架。",
    backupContents: "导出文件只包含设置，不包含页面内容、历史、书签、临时手势或远程资源。",
    privacyNetwork:
      "只有用户主动发起的导航、搜索和本地扩展页面可能产生网络活动；项目不会连接服务器。",
    licenseGpl: "GPL-3.0-or-later",
    aboutText: "OpenKeyMouse 基于 Vimium v2.4.2，保持免费和开源。",
    cleanRoomText:
      "仓库保留 Vimium 与 shoulda.js 的声明。鼠标功能仅依据公开行为描述独立实现，不复制闭源代码、资产、文案或界面。",
    dataHandling: "数据处理",
    privacyData:
      "OpenKeyMouse 不会向项目服务器或第三方分析服务发送网址、历史、书签、页面内容、选中文本、搜索词、按键、鼠标轨迹、指针图片、配置、设备标识、安装标识或崩溃报告。",
    localStorage: "本地存储",
    privacyStorage: "设置保存在浏览器存储中。启用的自定义指针只保存在本地，不同步、不上传。",
    security: "安全",
    onboardingIntro: "面向 Chromium 浏览器的键盘导航与独立实现鼠标控制。",
    onboardingGesture: "右键轨迹在越过激活阈值前保留原生右键菜单。",
    onboardingDrag: "超级拖拽会避开文件上传、编辑器、密码框和自定义 draggable 控件。",
    onboardingInvocation: "所有动作都经过校验后的命令调用协议。",
    search: "搜索",
    searchSettings: "搜索",
    appearance: "外观",
    keyMappings: "键盘映射",
    searchEngines: "搜索引擎",
    keyboardMappingNote: "兼容 Vimium 的键盘映射会导入现有键盘设置。",
    searchEngineNote: "只有你主动执行搜索命令时，搜索词才会发送给目标搜索引擎。",
    vimiumBackup:
      "也可以导入 Vimium JSON 备份。兼容字段会写入 Vimium 设置和 OpenKeyMouse 设置，未知字段会列出并忽略。",
    importSummary: "导入以下设置",
    changedSettings: "将修改的设置",
    ignoredFields: "已忽略字段",
    none: "无",
    openOnboarding: "打开入门说明",
    projectCharter: "项目章程",
    thirdPartyNotices: "第三方声明",
    command_OpenKeyMouse_closeWindow: "关闭当前窗口",
    command_OpenKeyMouse_newWindow: "打开新窗口",
    command_OpenKeyMouse_toggleFullscreen: "切换全屏",
    command_OpenKeyMouse_minimizeWindow: "最小化当前窗口",
    command_OpenKeyMouse_maximizeWindow: "最大化当前窗口",
    command_OpenKeyMouse_showTabList: "显示标签页列表",
    command_OpenKeyMouse_toggleKeyboard: "切换键盘导航",
    command_OpenKeyMouse_toggleMouseGestures: "切换鼠标手势",
    command_OpenKeyMouse_toggleSuperDrag: "切换超级拖拽",
    command_OpenKeyMouse_copySelection: "复制选中文本",
    command_OpenKeyMouse_copyLinkText: "复制链接文本",
    command_OpenKeyMouse_copyLinkUrl: "复制链接网址",
    command_OpenKeyMouse_copyImageUrl: "复制图片网址",
    command_OpenKeyMouse_searchSelection: "搜索选中文本",
    command_OpenKeyMouse_openLinkForeground: "前台打开链接",
    command_OpenKeyMouse_openLinkBackground: "后台打开链接",
    command_OpenKeyMouse_openImageForeground: "前台打开图片",
    command_OpenKeyMouse_openImageBackground: "后台打开图片",
    command_OpenKeyMouse_downloadImage: "下载图片",
  };

  let requestedLocale = null;

  function normalizeLocale(value) {
    if (value === "zh_CN" || String(value).toLowerCase().startsWith("zh")) return "zh_CN";
    if (value === "en" || String(value).toLowerCase().startsWith("en")) return "en";
    return "en";
  }

  function chromeMessage(key, substitutions) {
    try {
      if (globalThis.chrome?.i18n?.getMessage) {
        const message = chrome.i18n.getMessage(key, substitutions);
        if (message) return message;
      }
    } catch (_) {
      // 测试桩可能没有 i18n API，回退到内置英文值。
    }
    return fallbackMessages[key] || key;
  }

  function message(key, substitutions) {
    const catalog = normalizeLocale(locale()) === "zh_CN" ? zhMessages : fallbackMessages;
    return catalog[key] || chromeMessage(key, substitutions);
  }

  function hasMessage(key) {
    if (Object.hasOwn(fallbackMessages, key) || Object.hasOwn(zhMessages, key)) return true;
    try {
      return Boolean(chrome.i18n?.getMessage?.(key));
    } catch (_) {
      return false;
    }
  }

  function setLocale(value) {
    requestedLocale = value === "auto" || !value ? null : normalizeLocale(value);
    return locale();
  }

  function apply(root = document) {
    for (const element of root.querySelectorAll?.("[data-i18n]") || []) {
      element.textContent = message(element.dataset.i18n);
    }
    for (const element of root.querySelectorAll?.("[data-i18n-aria-label]") || []) {
      element.setAttribute("aria-label", message(element.dataset.i18nAriaLabel));
    }
    for (const element of root.querySelectorAll?.("[data-i18n-placeholder]") || []) {
      element.setAttribute("placeholder", message(element.dataset.i18nPlaceholder));
    }
    for (const element of root.querySelectorAll?.("[data-i18n-title]") || []) {
      element.setAttribute("title", message(element.dataset.i18nTitle));
    }
    if (root.documentElement) {
      root.documentElement.lang = locale();
    }
  }

  function locale() {
    if (requestedLocale) return requestedLocale;
    try {
      return normalizeLocale(chrome.i18n.getUILanguage?.() || navigator.language || "en");
    } catch (_) {
      return normalizeLocale(navigator.language || "en");
    }
  }

  globalThis.OpenKeyMouseI18n = Object.freeze({
    message,
    hasMessage,
    apply,
    locale,
    setLocale,
    fallbackMessages,
    zhMessages,
  });
})();
