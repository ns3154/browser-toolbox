// BrowserToolbox 的本地国际化适配层。
//
// 扩展页面和内容脚本都通过 chrome.i18n 读取本地 messages.json。这里保留一个稳定的
// data-i18n 约定，避免把用户可见文字散落在各个控制器中，也不需要任何网络请求。
(function () {
  const fallbackMessages = {
    extensionName: "Browser Toolbox",
    extensionDescription:
      "Free, local-first browser toolbox for keyboard and mouse navigation, page actions, and tab control. No ads, accounts, or telemetry.",
    browserToolbox: "Browser Toolbox",
    save: "Save",
    saved: "Saved",
    saving: "Saving…",
    saveChanges: "Save changes",
    noChanges: "No changes",
    cancel: "Cancel",
    close: "Close",
    reset: "Reset",
    enabled: "Enabled",
    disabled: "Disabled",
    general: "General",
    globalShowHud: "Show toolbox command hints",
    browserSyncEnabled: "Sync settings with the browser",
    browserSyncNote:
      "When disabled, settings stay in this browser's local storage and are not synchronized.",
    keyboard: "Keyboard",
    mouseGestures: "Mouse Gestures",
    superDrag: "Super Drag",
    wheelRocker: "Wheel & Rocker",
    rocker: "Rocker",
    siteRules: "Site Rules",
    backupRestore: "Backup & Restore",
    privacy: "Privacy",
    privacyTitle: "Browser Toolbox Privacy",
    aboutLicenses: "About & Licenses",
    openSettings: "Open settings",
    openBrowserToolboxSettings: "Browser Toolbox mouse, drag, wheel and privacy settings",
    browserToolboxSettings: "Browser Toolbox settings",
    browserToolboxHelpTitle: "Browser Toolbox Help",
    browserToolboxHelpIntro:
      "Keyboard navigation uses the Vimium baseline; this section summarizes Browser Toolbox modules and the current page state.",
    browserToolboxCurrentPage: "Current page state",
    browserToolboxAllModulesEnabled: "All Browser Toolbox modules are enabled on this page.",
    browserToolboxDisabledModules: "Disabled modules on this page",
    browserToolboxStatusUnavailable: "The current page state is not available.",
    browserToolboxAppliedRule: "Applied site rule",
    browserToolboxNoMatchingRule: "No Browser Toolbox site rule matches this page.",
    browserToolboxVimiumExcluded: "A Vimium page rule excludes keyboard navigation here.",
    browserToolboxBrowserLimit:
      "Some browser-managed pages do not allow extensions to run; controls may be unavailable there.",
    browserToolboxMouseHelp:
      "Draw a configured path with the gesture button. A light right click or movement below the activation threshold keeps the native context menu. When menu suppression is enabled, a right-button gesture blocks the menu after crossing the threshold; disabling it keeps the native menu but may conflict with gestures.",
    browserToolboxSuperDragHelp:
      "Drag links, text, or images to run configured actions. File uploads, editors, password fields, and draggable widgets remain native.",
    browserToolboxWheelHelp:
      "Use the configured mouse button with the wheel to run a thresholded action without changing ordinary scrolling.",
    browserToolboxRockerHelp:
      "Hold one mouse button and click the other to run a configured rocker action; unbound combinations remain ordinary clicks.",
    browserToolboxSiteRulesHelp:
      "Configure each module per site with Glob or regular-expression rules. The top-level page controls all frames.",
    browserToolboxPrivacyHelp:
      "No telemetry, accounts, advertising, paid features, remote code, or project-server requests are part of Browser Toolbox.",
    browserToolboxLicenseHelp: "The project code is available under GPL-3.0-or-later.",
    openBrowserToolboxSettingsPage: "Open Browser Toolbox settings",
    openPrivacyPolicy: "Privacy policy",
    openLicense: "License",
    keyboardBaselineNotice: "Keyboard navigation baseline: Vimium v2.4.2.",
    help: "Help",
    wiki: "Wiki",
    navigatingThePage: "Navigating the page",
    usingTheVomnibar: "Using the Vomnibar",
    usingFind: "Using find",
    navigatingHistory: "Navigating history",
    manipulatingTabs: "Manipulating tabs",
    linksAndSelections: "Links and selections",
    windows: "Windows",
    miscellaneous: "Miscellaneous",
    showAdvancedCommands: "Show advanced commands",
    hideAdvancedCommands: "Hide advanced commands",
    whatsNew: "What's new?",
    version: "Version",
    openHelp: "Open help",
    currentSite: "Current site",
    allModulesEnabled: "All Browser Toolbox modules are enabled on this site.",
    pageUnavailable: "The browser does not allow extensions to run on this page.",
    actionPageTitle: "Browser Toolbox",
    firefoxMissingHostsPermission: 'Vimium is missing the "all hosts" permission.',
    firefoxPermissionHelp:
      "Firefox requires users to grant this permission manually. You can enable it with the button below:",
    grantHostsPermission: "Enable all hosts permission",
    firefoxPermissionPathIntro: "Or navigate to:",
    firefoxPermissionPath:
      'about:addons > Vimium > Manage (three-dot menu) > Permissions > enable "Access your data for all websites".',
    seePermissionsHelp: "See permissions help",
    vimiumKeysEnabledOnPage: "Vimium keys are enabled on this page.",
    excludeKeysOnPage: "Exclude Vimium keys on this page",
    matchingPatterns: "Patterns matching the current page",
    keysToExclude: "Keys to exclude",
    seeExclusionRules: "See all exclusion rules on the",
    optionsPage: "Options",
    page: "page.",
    noTelemetry: "No telemetry, accounts, advertising, or paid features.",
    pattern: "Pattern",
    patternInput: "Pattern text (for example, L>R)",
    command: "Command",
    options: "Options",
    optionsDefault: "Default",
    optionsHint: "JSON object; values are validated before saving.",
    dangerousCommandWarning: "May close tabs or windows.",
    addBinding: "Add binding",
    addRule: "Add rule",
    removeBinding: "Remove binding",
    removeRule: "Remove rule",
    moveUp: "Move up",
    moveDown: "Move down",
    duplicateRule: "Duplicate rule",
    restoreDefaults: "Restore defaults",
    restoreDefaultsConfirm: "Restore Browser Toolbox settings to their defaults?",
    discardChanges: "Discard changes",
    unsavedChanges: "You have unsaved changes.",
    importSettings: "Import settings",
    exportSettings: "Export settings",
    chooseFile: "Choose a file",
    invalidSettings: "The settings file is invalid.",
    settingsConflict:
      "These settings changed in another Browser Toolbox page or device. Reload before saving.",
    settingsConflictFields: "Conflicting fields",
    settingsConflictMore: "more fields omitted",
    settingsRecoveryFailed:
      "The save failed and automatic recovery was incomplete. Reload before editing further.",
    validationUnknownCommand: "Unknown command",
    validationUnsupportedInput: "This command is not available for this input",
    validationInvalidOptions: "Invalid command options",
    validationDuplicate: "Duplicate binding",
    validationInvalidPattern: "Invalid gesture pattern",
    validationInvalidRegex: "Invalid regular expression",
    validationRegexComplexity: "Regular expression is too complex",
    validationInvalidSiteRule: "Invalid site rule",
    validationOutOfRange: "Value is outside the allowed range",
    validationPrivacy: "Privacy guarantees cannot be changed",
    validationSchema: "Unsupported settings schema",
    gestureUnrecognized: "Gesture not recognized",
    gestureCancelled: "Gesture cancelled",
    browserRestriction: "This page is restricted by the browser.",
    language: "Language",
    languageAuto: "Follow browser",
    languageEnglish: "English",
    languageChinese: "简体中文",
    triggerButton: "Gesture trigger button",
    mouseTriggerButtonHint:
      "The gesture button takes priority over super drag and rocker input when they use the same button. With the right button, a click or movement below the activation threshold keeps the native menu; when menu suppression is enabled, an activated gesture blocks it. Disabling suppression keeps the native menu but may conflict with gestures.",
    directionMode: "Direction mode",
    fourWay: "Four directions",
    eightWay: "Eight directions",
    activationDistance: "Activation distance (px)",
    sampleDistance: "Sample distance (px)",
    minimumSegmentDistance: "Minimum segment distance (px)",
    turnHysteresis: "Turn hysteresis (degrees)",
    maxSegments: "Maximum segments",
    maxDuration: "Maximum duration (ms)",
    showTrail: "Show gesture trail",
    showHud: "Show command HUD",
    suppressContextMenu: "Suppress context menu after gesture activation",
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
    continuousTabSwitching: "Continuous tab switching",
    button: "Button",
    direction: "Direction",
    sequence: "Sequence",
    leftButton: "Left button",
    rightButton: "Right button",
    middleButton: "Middle button",
    up: "Up",
    down: "Down",
    holdRightThenClickLeft: "Hold right, click left",
    holdLeftThenClickRight: "Hold left, click right",
    urlPattern: "URL pattern",
    modules: "Modules",
    siteRuleMatchType: "Match type",
    siteRuleGlob: "Glob",
    siteRuleRegex: "Regular expression",
    siteRuleEnabled: "Enable toolbox on this site",
    siteRuleDisableModules: "Disable modules on this site",
    siteRuleModuleHint: "Check a module to disable it on this site.",
    siteRuleDefaultHint:
      "Built-in high-conflict site rules disable mouse modules by default. You can edit or remove them.",
    siteRuleGlobHint: "Example: https://*.example.com/*",
    siteRuleRegexHint: "Example: ^https://(www\\.)?example\\.com/",
    siteRulePriority: "Priority",
    siteRuleOrder: "Configuration order",
    siteRulePrecedence: "Match precedence",
    siteRuleActions: "Actions",
    siteRuleNoRules: "No site rules yet. Add one to configure a URL.",
    testSiteUrl: "Test URL",
    siteRuleTestUrl: "URL to test",
    siteRuleTestUrlHint: "https://example.com/path",
    siteRuleTestUrlHelp: "Enter a URL; this field is not saved.",
    siteRuleEnterTestUrl: "Enter a URL to test.",
    siteRuleInvalidTestUrl: "Enter a valid URL.",
    siteRuleMatched: "The URL matches a site rule:",
    siteRuleNotMatched: "The URL does not match any site rule.",
    siteRuleEffectiveState: "Effective modules",
    siteRuleDisabledModules: "Disabled modules",
    siteRuleAllModulesEnabled: "All modules are enabled",
    siteRuleExplanationTitle: "Why this result applies",
    siteRuleNoMatchingRules: "No Browser Toolbox site rule matches this URL.",
    siteRuleDuplicateWarning:
      "This matching pattern is used by another rule; the later configured rule takes precedence for overlapping fields.",
    patternDoesNotMatch: "Pattern does not match the current URL",
    untitledTab: "(untitled)",
    allKeys: "All",
    noKeys: "No",
    someKeys: "Some",
    context: "Context",
    contextLink: "Link",
    contextSelection: "Selected text",
    contextImage: "Image",
    settingsSections: "Settings sections",
    navigationKeyboard: "Navigation & Keyboard",
    mouseDrag: "Mouse & Drag",
    searchTabs: "Search & Tabs",
    appearanceBehavior: "Appearance & Behavior",
    sitePrivacy: "Sites & Privacy",
    backupAbout: "Backup & About",
    settingsSearch: "Search settings",
    settingsSearchHint: "Filter settings sections…",
    settingsSearchMatches: "Matching sections",
    settingsSearchNoResults: "No matching settings sections.",
    gestureEditor: "Gesture editor",
    superDragSafety:
      "The selected bypass modifier always keeps native dragging. File uploads, editors, password fields, custom draggable widgets, and invalid URLs are not intercepted.",
    nativeBypassModifier: "Native drag bypass modifier",
    modifierAlt: "Alt",
    modifierControl: "Control",
    modifierMeta: "Command / Meta",
    modifierShift: "Shift",
    siteRuleSpecificity:
      "Glob rules with the most specific pattern win; for equal priority, the later rule wins. Regular expressions are supported explicitly. The top-level page URL controls all frames.",
    backupContents:
      "Exports contain settings only. Page content, history, bookmarks, temporary gestures, and remote assets are never exported.",
    privacyNetwork:
      "Only user-initiated navigation, search, and local extension pages may cause network activity. No project server is contacted.",
    licenseGpl: "GPL-3.0-or-later",
    aboutText:
      "Browser Toolbox uses Vimium v2.4.2 as its keyboard baseline and remains free and open source.",
    cleanRoomText:
      "Vimium and shoulda.js notices are preserved in the repository. Mouse features are an independent clean-room implementation based only on public behavior descriptions.",
    dataHandling: "Data handling",
    privacyData:
      "Browser Toolbox does not send URLs, history, bookmarks, page content, selected text, search terms, keystrokes, mouse paths, pointer images, configuration, device identifiers, installation identifiers, or crash reports to a project server or third-party analytics service.",
    localStorage: "Local storage",
    privacyStorage:
      "Settings are stored in browser storage. Custom pointer assets, if enabled, remain in local storage and are not synchronized or uploaded.",
    security: "Security",
    onboardingIntro:
      "A local browser workflow toolbox for Chromium browsers, with keyboard navigation and independent mouse input modules.",
    onboardingGesture:
      "A light right click keeps the native context menu. When menu suppression is enabled, a right-button gesture blocks the menu after crossing the activation threshold; disabling it keeps the native menu but may conflict with gestures.",
    onboardingDrag:
      "Super drag leaves file upload, editors, password fields, and custom draggable widgets alone.",
    onboardingInvocation: "Every action is routed through a validated command invocation.",
    search: "Search",
    searchSettings: "Search",
    vomnibarSearchOrOpen: "Search or open",
    vomnibarSearchBookmarks: "Search bookmarks",
    vomnibarSearchTabs: "Search tabs",
    vomnibarPlaceholderOmni: "Enter a search term or URL",
    vomnibarPlaceholderBookmarks: "Enter a bookmark title or URL",
    vomnibarPlaceholderTabs: "Enter a tab title or URL",
    vomnibarNewTab: "New tab",
    vomnibarHintSelect: "Select",
    vomnibarHintOpen: "Open",
    vomnibarHintClose: "Close",
    appearance: "Appearance",
    keyMappings: "Keyboard mappings",
    searchEngines: "Search engines",
    keyboardMappingNote:
      "Vimium-compatible mappings are imported into the existing keyboard settings.",
    searchEngineNote: "Searches are sent only when you explicitly invoke a search command.",
    vimiumBackup:
      "You can also import a Vimium JSON backup. Recognized fields are copied to the compatible Vimium settings and Browser Toolbox settings; unknown fields are reported, preserved when possible, and otherwise ignored.",
    importSummary: "Import these settings",
    changedSettings: "Changed settings",
    ignoredFields: "Ignored fields",
    unrecognizedFields: "Unrecognized settings (preserved)",
    importPreviewTitle: "Review settings import",
    importPreviewDescription: "Review the changes before anything is written.",
    importPreviewAdded: "Added",
    importPreviewChanged: "Changed",
    importPreviewRemoved: "Removed",
    importPreviewConfirm: "Import these changes",
    importPreviewCancel: "Cancel import",
    importPreviewNoChanges: "No Browser Toolbox settings will change.",
    importPreviewTruncated: "Some detailed changes are omitted from this preview.",
    none: "None",
    openOnboarding: "Open onboarding",
    projectCharter: "Project Charter",
    thirdPartyNotices: "Third-party notices",
    charterFree:
      "Browser Toolbox is free, open source, and provides the same complete feature set to every user.",
    charterPrivacy:
      "The project does not add telemetry, accounts, advertising, paid features, remote configuration, or background data collection.",
    securityBoundary:
      "Browser Toolbox keeps browser data and user input in the local browser. It does not load remote code or trust web pages to invoke privileged actions.",
    securityImport:
      "Imported settings are parsed, validated, previewed, and confirmed before they are written. Import files are never executed as HTML or script.",
    securityReport:
      "Do not include credentials, cookies, tokens, personal data, or complete browsing data in a public issue.",
    vimiumLicenseNotice: "Vimium v2.4.2 code and assets: MIT license",
    shouldaLicenseNotice: "shoulda.js test framework: MIT license",
    command_BrowserToolbox_closeWindow: "Close current window",
    command_BrowserToolbox_newWindow: "Open a new window",
    command_BrowserToolbox_toggleFullscreen: "Toggle fullscreen",
    command_BrowserToolbox_minimizeWindow: "Minimize current window",
    command_BrowserToolbox_maximizeWindow: "Maximize current window",
    command_BrowserToolbox_showTabList: "Show tab list",
    command_BrowserToolbox_toggleKeyboard: "Toggle keyboard navigation",
    command_BrowserToolbox_toggleMouseGestures: "Toggle mouse gestures",
    command_BrowserToolbox_toggleSuperDrag: "Toggle super drag",
    command_BrowserToolbox_copySelection: "Copy selected text",
    command_BrowserToolbox_copyLinkText: "Copy link text",
    command_BrowserToolbox_copyLinkUrl: "Copy link URL",
    command_BrowserToolbox_copyImageUrl: "Copy image URL",
    command_BrowserToolbox_searchSelection: "Search selected text",
    command_BrowserToolbox_openLinkForeground: "Open link in foreground",
    command_BrowserToolbox_openLinkBackground: "Open link in background",
    command_BrowserToolbox_openImageForeground: "Open image in foreground",
    command_BrowserToolbox_openImageBackground: "Open image in background",
    command_BrowserToolbox_downloadImage: "Download image",
  };

  const zhMessages = {
    extensionName: "浏览器工具箱",
    extensionDescription:
      "永久免费、开源、本地优先的浏览器工作流工具箱，用键盘和鼠标执行网页导航与标签页操作；无广告、无账户、无遥测。",
    browserToolbox: "浏览器工具箱",
    save: "保存",
    saved: "已保存",
    saving: "正在保存……",
    saveChanges: "保存修改",
    noChanges: "没有修改",
    cancel: "取消",
    close: "关闭",
    reset: "重置",
    enabled: "启用",
    disabled: "停用",
    general: "常规",
    globalShowHud: "显示工具箱命令提示",
    browserSyncEnabled: "使用浏览器同步设置",
    browserSyncNote: "关闭后，设置只保存在此浏览器的本地存储中，不会同步。",
    keyboard: "键盘导航",
    mouseGestures: "鼠标手势",
    superDrag: "超级拖拽",
    wheelRocker: "滚轮与摇杆",
    rocker: "摇杆",
    siteRules: "站点规则",
    backupRestore: "备份与恢复",
    privacy: "隐私",
    privacyTitle: "浏览器工具箱隐私",
    aboutLicenses: "关于与许可证",
    openSettings: "打开设置",
    openBrowserToolboxSettings: "浏览器工具箱的鼠标、拖拽、滚轮和隐私设置",
    browserToolboxSettings: "浏览器工具箱设置",
    browserToolboxHelpTitle: "浏览器工具箱帮助",
    browserToolboxHelpIntro: "键盘导航以 Vimium 为基线；这里汇总浏览器工具箱模块和当前页面状态。",
    browserToolboxCurrentPage: "当前页面状态",
    browserToolboxAllModulesEnabled: "当前页面已启用浏览器工具箱的全部模块。",
    browserToolboxDisabledModules: "当前页面停用的模块",
    browserToolboxStatusUnavailable: "当前页面状态暂时不可用。",
    browserToolboxAppliedRule: "生效的站点规则",
    browserToolboxNoMatchingRule: "当前页面没有匹配的浏览器工具箱站点规则。",
    browserToolboxVimiumExcluded: "Vimium 页面排除规则已在此处停用键盘导航。",
    browserToolboxBrowserLimit: "部分浏览器管理页面不允许扩展运行，控件在这些页面上可能不可用。",
    browserToolboxMouseHelp:
      "使用手势按键画出已配置的轨迹。右键轻点或移动未达到激活阈值时保留原生菜单；启用菜单抑制后，只有越过激活阈值的右键手势才会拦截菜单，关闭后始终保留原生菜单，但右键轨迹可能与菜单冲突。",
    browserToolboxSuperDragHelp:
      "拖拽链接、文字或图片即可执行配置的动作；文件上传、编辑器、密码框和 draggable 控件仍保持原生行为。",
    browserToolboxWheelHelp: "使用配置的鼠标按键配合滚轮，在达到阈值后执行动作，不改变普通滚动。",
    browserToolboxRockerHelp:
      "按住一个鼠标按键再点击另一个按键即可执行摇杆动作；未绑定组合仍保持普通点击。",
    browserToolboxSiteRulesHelp:
      "可以用 Glob 或正则表达式为每个站点分别配置模块；所有框架统一使用顶层页面。",
    browserToolboxPrivacyHelp:
      "浏览器工具箱不包含遥测、账号、广告、付费功能、远程代码或项目服务器请求。",
    browserToolboxLicenseHelp: "项目代码使用 GPL-3.0-or-later 许可证。",
    openBrowserToolboxSettingsPage: "打开浏览器工具箱设置",
    openPrivacyPolicy: "隐私政策",
    openLicense: "许可证",
    keyboardBaselineNotice: "键盘导航基线：Vimium v2.4.2。",
    help: "帮助",
    wiki: "Wiki",
    navigatingThePage: "页面导航",
    usingTheVomnibar: "使用 Vomnibar",
    usingFind: "使用查找",
    navigatingHistory: "浏览历史",
    manipulatingTabs: "操作标签页",
    linksAndSelections: "链接和选择",
    windows: "窗口",
    miscellaneous: "其他",
    showAdvancedCommands: "显示高级命令",
    hideAdvancedCommands: "隐藏高级命令",
    whatsNew: "更新内容",
    version: "版本",
    openHelp: "打开帮助",
    currentSite: "当前站点",
    allModulesEnabled: "当前站点已启用浏览器工具箱的全部模块。",
    pageUnavailable: "浏览器不允许扩展在此页面运行。",
    actionPageTitle: "浏览器工具箱",
    firefoxMissingHostsPermission: "Vimium 缺少“所有网站”权限。",
    firefoxPermissionHelp: "Firefox 要求用户手动授予此权限。你可以使用下面的按钮启用：",
    grantHostsPermission: "启用所有网站权限",
    firefoxPermissionPathIntro: "或者按以下路径操作：",
    firefoxPermissionPath:
      "about:addons > Vimium > 管理（三点菜单）> 权限 > 启用“访问所有网站上的数据”。",
    seePermissionsHelp: "查看权限帮助",
    vimiumKeysEnabledOnPage: "Vimium 按键已在此页面启用。",
    excludeKeysOnPage: "在此页面停用 Vimium 按键",
    matchingPatterns: "匹配当前页面的规则",
    keysToExclude: "要停用的键",
    seeExclusionRules: "查看全部排除规则，前往",
    optionsPage: "选项",
    page: "页面。",
    noTelemetry: "无遥测、无账号、无广告、无付费功能。",
    pattern: "轨迹",
    patternInput: "轨迹文本（例如 L>R）",
    command: "命令",
    options: "选项",
    optionsDefault: "默认",
    optionsHint: "JSON 对象；保存前会校验内容。",
    dangerousCommandWarning: "可能关闭标签页或窗口。",
    addBinding: "添加绑定",
    addRule: "添加规则",
    removeBinding: "移除绑定",
    removeRule: "删除规则",
    moveUp: "上移",
    moveDown: "下移",
    duplicateRule: "复制规则",
    restoreDefaults: "恢复默认值",
    restoreDefaultsConfirm: "要将浏览器工具箱设置恢复为默认值吗？",
    discardChanges: "放弃修改",
    unsavedChanges: "有未保存的修改。",
    importSettings: "导入设置",
    exportSettings: "导出设置",
    chooseFile: "选择文件",
    invalidSettings: "设置文件无效。",
    settingsConflict: "这些设置已在其他浏览器工具箱页面或设备上修改，请重新加载页面后再保存。",
    settingsConflictFields: "冲突字段",
    settingsConflictMore: "其余字段已省略",
    settingsRecoveryFailed: "保存失败，自动恢复未完全成功。请重新加载页面后再继续编辑。",
    validationUnknownCommand: "未知命令",
    validationUnsupportedInput: "此输入方式不支持该命令",
    validationInvalidOptions: "命令选项无效",
    validationDuplicate: "重复绑定",
    validationInvalidPattern: "手势轨迹无效",
    validationInvalidRegex: "正则表达式无效",
    validationRegexComplexity: "正则表达式过于复杂",
    validationInvalidSiteRule: "站点规则无效",
    validationOutOfRange: "数值超出允许范围",
    validationPrivacy: "隐私保证不可修改",
    validationSchema: "设置版本不受支持",
    gestureUnrecognized: "未识别手势",
    gestureCancelled: "手势已取消",
    browserRestriction: "此页面受浏览器限制。",
    language: "语言",
    languageAuto: "跟随浏览器",
    languageEnglish: "English",
    languageChinese: "简体中文",
    triggerButton: "手势触发按键",
    mouseTriggerButtonHint:
      "手势按键与超级拖拽或摇杆使用同一按键时，手势优先。手势按键为右键时，轻点或移动未达到激活阈值会保留原生菜单；启用菜单抑制后，越过阈值的右键手势才会拦截菜单，关闭后始终保留原生菜单，但右键轨迹可能冲突。",
    directionMode: "方向模式",
    fourWay: "四向",
    eightWay: "八向",
    activationDistance: "激活距离（像素）",
    sampleDistance: "采样距离（像素）",
    minimumSegmentDistance: "最小分段距离（像素）",
    turnHysteresis: "转向滞后角度（度）",
    maxSegments: "最大分段数",
    maxDuration: "最大持续时间（毫秒）",
    showTrail: "显示手势轨迹",
    showHud: "显示命令提示",
    suppressContextMenu: "手势激活后抑制原生菜单",
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
    continuousTabSwitching: "连续切换标签页",
    button: "按键",
    direction: "方向",
    sequence: "顺序",
    leftButton: "左键",
    rightButton: "右键",
    middleButton: "中键",
    up: "向上",
    down: "向下",
    holdRightThenClickLeft: "按住右键再点左键",
    holdLeftThenClickRight: "按住左键再点右键",
    urlPattern: "网址匹配式",
    modules: "模块",
    siteRuleMatchType: "匹配方式",
    siteRuleGlob: "Glob 通配式",
    siteRuleRegex: "正则表达式",
    siteRuleEnabled: "在此站点启用工具箱",
    siteRuleDisableModules: "在此站点停用模块",
    siteRuleModuleHint: "勾选模块即可在此站点停用它。",
    siteRuleDefaultHint: "内置高冲突站点规则默认停用鼠标相关模块，你可以编辑或删除它们。",
    siteRuleGlobHint: "示例：https://*.example.com/*",
    siteRuleRegexHint: "示例：^https://(www\\.)?example\\.com/",
    siteRulePriority: "优先级",
    siteRuleOrder: "配置顺序",
    siteRulePrecedence: "匹配顺序",
    siteRuleActions: "操作",
    siteRuleNoRules: "还没有站点规则。添加一条规则来配置网址。",
    testSiteUrl: "测试网址",
    siteRuleTestUrl: "待测试网址",
    siteRuleTestUrlHint: "https://example.com/path",
    siteRuleTestUrlHelp: "请输入网址；此字段不会保存。",
    siteRuleEnterTestUrl: "请输入要测试的网址。",
    siteRuleInvalidTestUrl: "请输入有效的网址。",
    siteRuleMatched: "该网址匹配到站点规则：",
    siteRuleNotMatched: "该网址没有匹配任何站点规则。",
    siteRuleEffectiveState: "最终模块状态",
    siteRuleDisabledModules: "已停用模块",
    siteRuleAllModulesEnabled: "所有模块均已启用",
    siteRuleExplanationTitle: "为什么会得到这个结果",
    siteRuleNoMatchingRules: "没有浏览器工具箱站点规则匹配此网址。",
    patternDoesNotMatch: "匹配式与当前网址不匹配",
    untitledTab: "（无标题）",
    allKeys: "全部",
    noKeys: "无",
    someKeys: "部分",
    context: "对象",
    contextLink: "链接",
    contextSelection: "选中文本",
    contextImage: "图片",
    settingsSections: "设置分区",
    navigationKeyboard: "导航与键盘",
    mouseDrag: "鼠标与拖拽",
    searchTabs: "搜索与标签",
    appearanceBehavior: "外观与行为",
    sitePrivacy: "站点与隐私",
    backupAbout: "备份与关于",
    settingsSearch: "搜索设置",
    settingsSearchHint: "筛选设置分区……",
    settingsSearchMatches: "匹配分区数",
    settingsSearchNoResults: "没有匹配的设置分区。",
    gestureEditor: "手势编辑器",
    superDragSafety:
      "按住所选旁路修饰键始终保留原生拖拽。文件上传、编辑器、密码框、自定义 draggable 控件和无效网址不会被拦截。",
    nativeBypassModifier: "原生拖拽旁路修饰键",
    modifierAlt: "Alt",
    modifierControl: "Control",
    modifierMeta: "Command / Meta",
    modifierShift: "Shift",
    siteRuleSpecificity:
      "Glob 通配式按匹配度优先；匹配度相同时后面的规则优先。也支持显式正则表达式。顶层页面网址控制所有框架。",
    backupContents: "导出文件只包含设置，不包含页面内容、历史、书签、临时手势或远程资源。",
    privacyNetwork:
      "只有用户主动发起的导航、搜索和本地扩展页面可能产生网络活动；项目不会连接服务器。",
    licenseGpl: "GPL-3.0-or-later",
    aboutText: "浏览器工具箱以 Vimium v2.4.2 为键盘基线，保持免费和开源。",
    cleanRoomText:
      "仓库保留 Vimium 与 shoulda.js 的声明。鼠标功能仅依据公开行为描述独立实现，不复制闭源代码、资产、文案或界面。",
    dataHandling: "数据处理",
    privacyData:
      "浏览器工具箱不会向项目服务器或第三方分析服务发送网址、历史、书签、页面内容、选中文本、搜索词、按键、鼠标轨迹、指针图片、配置、设备标识、安装标识或崩溃报告。",
    localStorage: "本地存储",
    privacyStorage: "设置保存在浏览器存储中。启用的自定义指针只保存在本地，不同步、不上传。",
    security: "安全",
    onboardingIntro:
      "面向 Chromium 浏览器的本地工作流工具箱，包含键盘导航和独立实现的鼠标输入模块。",
    onboardingGesture:
      "右键轻点会保留原生菜单；启用菜单抑制后，只有越过激活阈值的右键手势才会拦截菜单，关闭后始终保留原生菜单，但可能与轨迹冲突。",
    onboardingDrag: "超级拖拽会避开文件上传、编辑器、密码框和自定义 draggable 控件。",
    onboardingInvocation: "所有动作都经过校验后的命令调用协议。",
    search: "搜索",
    searchSettings: "搜索",
    vomnibarSearchOrOpen: "搜索或打开",
    vomnibarSearchBookmarks: "搜索书签",
    vomnibarSearchTabs: "搜索标签页",
    vomnibarPlaceholderOmni: "输入搜索词或网址",
    vomnibarPlaceholderBookmarks: "输入书签标题或网址",
    vomnibarPlaceholderTabs: "输入标签页标题或网址",
    vomnibarNewTab: "新标签页",
    vomnibarHintSelect: "选择",
    vomnibarHintOpen: "打开",
    vomnibarHintClose: "关闭",
    appearance: "外观",
    keyMappings: "键盘映射",
    searchEngines: "搜索引擎",
    keyboardMappingNote: "兼容 Vimium 的键盘映射会导入现有键盘设置。",
    searchEngineNote: "只有你主动执行搜索命令时，搜索词才会发送给目标搜索引擎。",
    vimiumBackup:
      "也可以导入 Vimium JSON 备份。兼容字段会写入 Vimium 设置和浏览器工具箱设置；未知字段会列出，能保留的设置字段会保留，其余字段会忽略。",
    importSummary: "导入以下设置",
    changedSettings: "将修改的设置",
    ignoredFields: "已忽略字段",
    unrecognizedFields: "未识别设置（已保留）",
    importPreviewTitle: "确认导入设置",
    importPreviewDescription: "请先检查变更，确认后才会写入设置。",
    importPreviewAdded: "新增",
    importPreviewChanged: "修改",
    importPreviewRemoved: "删除",
    importPreviewConfirm: "导入这些变更",
    importPreviewCancel: "取消导入",
    importPreviewNoChanges: "不会修改浏览器工具箱设置。",
    importPreviewTruncated: "部分详细变更已省略。",
    none: "无",
    openOnboarding: "打开入门说明",
    projectCharter: "项目章程",
    thirdPartyNotices: "第三方声明",
    charterFree: "浏览器工具箱永久免费、开源，并向所有用户提供同一套完整功能。",
    charterPrivacy: "项目不加入遥测、账号、广告、付费功能、远程配置或后台数据收集。",
    securityBoundary:
      "浏览器工具箱把浏览器数据和用户输入留在本地浏览器内，不加载远程代码，也不信任网页直接调用高权限动作。",
    securityImport:
      "导入设置会先解析、校验、预览并确认后才写入；导入文件不会作为 HTML 或脚本执行。",
    securityReport: "请不要在公开 issue 中提交凭证、Cookie、Token、个人资料或完整浏览数据。",
    vimiumLicenseNotice: "Vimium v2.4.2 代码和资源：MIT 许可证",
    shouldaLicenseNotice: "shoulda.js 测试框架：MIT 许可证",
    command_BrowserToolbox_closeWindow: "关闭当前窗口",
    command_BrowserToolbox_newWindow: "打开新窗口",
    command_BrowserToolbox_toggleFullscreen: "切换全屏",
    command_BrowserToolbox_minimizeWindow: "最小化当前窗口",
    command_BrowserToolbox_maximizeWindow: "最大化当前窗口",
    command_BrowserToolbox_showTabList: "显示标签页列表",
    command_BrowserToolbox_toggleKeyboard: "切换键盘导航",
    command_BrowserToolbox_toggleMouseGestures: "切换鼠标手势",
    command_BrowserToolbox_toggleSuperDrag: "切换超级拖拽",
    command_BrowserToolbox_copySelection: "复制选中文本",
    command_BrowserToolbox_copyLinkText: "复制链接文本",
    command_BrowserToolbox_copyLinkUrl: "复制链接网址",
    command_BrowserToolbox_copyImageUrl: "复制图片网址",
    command_BrowserToolbox_searchSelection: "搜索选中文本",
    command_BrowserToolbox_openLinkForeground: "前台打开链接",
    command_BrowserToolbox_openLinkBackground: "后台打开链接",
    command_BrowserToolbox_openImageForeground: "前台打开图片",
    command_BrowserToolbox_openImageBackground: "后台打开图片",
    command_BrowserToolbox_downloadImage: "下载图片",
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

  async function applyStoredLocale(root = document) {
    let storedLocale = null;
    try {
      const repository = globalThis.BrowserToolboxSettingsRepositoryInstance;
      if (repository?.getStoredLocale) {
        storedLocale = await repository.getStoredLocale();
      } else if (globalThis.BrowserToolboxSettingsStorageInstance?.getStoredLocale) {
        // 集成页面只需读取语言时复用存储兼容层，仍不触发迁移写入。
        storedLocale = await globalThis.BrowserToolboxSettingsStorageInstance.getStoredLocale();
      } else {
        const values = await globalThis.chrome?.storage?.sync?.get?.("browserToolboxSettings");
        storedLocale = values?.browserToolboxSettings?.general?.language;
      }
    } catch (_) {
      // 语言设置读取失败时使用浏览器界面语言，不阻塞 Vimium 页面打开。
    }
    setLocale(["en", "zh_CN"].includes(storedLocale) ? storedLocale : "auto");
    apply(root);
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

  function formatValidationError(error) {
    const text = String(error);
    if (text.startsWith("Unknown command:")) {
      return message("validationUnknownCommand") + ": " +
        text.slice("Unknown command:".length).trim();
    }
    if (text.includes(" does not support ")) {
      return message("validationUnsupportedInput") + ": " + text;
    }
    if (
      text.startsWith("Option ") || text.startsWith("Unknown option") ||
      text.startsWith("Options must")
    ) {
      return message("validationInvalidOptions") + ": " + text;
    }
    if (text.startsWith("Duplicate ")) {
      return message("validationDuplicate") + ": " +
        text.replace(/^Duplicate [^:]+ binding:\s*/, "");
    }
    if (text.includes("regular expression is too complex")) {
      return message("validationRegexComplexity");
    }
    if (text.includes("invalid regular expression")) return message("validationInvalidRegex");
    if (text.includes("invalid pattern") || text.includes("invalid sequence")) {
      return message("validationInvalidPattern");
    }
    if (text.startsWith("A site rule")) return message("validationInvalidSiteRule");
    if (text.includes("must be between") || text.includes("must be an integer")) {
      return message("validationOutOfRange") + ": " + text;
    }
    if (text.startsWith("Privacy guarantees")) return message("validationPrivacy");
    if (text.startsWith("Unsupported schema")) {
      return message("validationSchema") + ": " + text;
    }
    return text;
  }

  function formatValidationErrors(errors) {
    return (errors || []).map(formatValidationError).join("\n");
  }

  globalThis.BrowserToolboxI18n = Object.freeze({
    message,
    hasMessage,
    apply,
    applyStoredLocale,
    locale,
    setLocale,
    formatValidationError,
    formatValidationErrors,
    fallbackMessages,
    zhMessages,
  });
})();
