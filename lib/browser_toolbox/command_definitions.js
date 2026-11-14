// SPDX-License-Identifier: GPL-3.0-or-later
// 名称与描述来自 Vimium v2.4.2/MIT，原版权和许可见 MIT-LICENSE、CREDITS。
// 本表显式声明执行契约，运行时不读取 all_commands.js 的隐式字段；新增模型为 BrowserToolbox。
(function () {
  let definitions;
  // 文档启动只安装同步门面；首次命令查询再构造整张契约，后台清单仍立即取得完整声明。
  // deno-fmt-ignore
  function initializeDefinitions() {
  // 固定契约共用只读默认对象，避免每个页面为 95 行反复分配相同数组和策略。
  const commonInputs = ["keyboard","mouseGesture","superDrag","wheel","rocker","ui"];
  const empty = [];
  const emptySchema = Object.freeze({});
  const commonPolicy = {"meaning":"repeat","nullable":false,"noRepeat":false,"confirmationThreshold":null,"keyboardHardLimit":9007199254740991,"otherInputHardLimit":50,"executionBudgetMs":30000};
  const common = { execution: "page", repeatable: true, dangerous: false, supportedInputs: commonInputs, requiredContext: empty, requiredPermissions: empty, resultKind: "execution" };
  const rows = [
    {"name":"scrollDown","desc":"Scroll down","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollUp","desc":"Scroll up","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollToTop","desc":"Scroll to the top of the page","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollToBottom","desc":"Scroll to the bottom of the page","group":"navigation"},
    {"name":"scrollPageDown","desc":"Scroll a half page down","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollPageUp","desc":"Scroll a half page up","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollFullPageDown","desc":"Scroll a full page down","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollFullPageUp","desc":"Scroll a full page up","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollLeft","desc":"Scroll left","group":"navigation","countPolicy":{"meaning":"scalar"}},
    {"name":"scrollRight","desc":"Scroll right","group":"navigation","advanced":true,"countPolicy":{"meaning":"scalar"}},
    {"name":"scrollToLeft","desc":"Scroll all the way to the left","group":"navigation","advanced":true},
    {"name":"scrollToRight","desc":"Scroll all the way to the right","group":"navigation"},
    {"name":"reload","desc":"Reload the page","group":"navigation","background":true,"options":{"hard":"Perform a hard reload, forcing the browser to bypass its cache."},"optionSchema":{"hard":{"type":"boolean"}},"execution":"background","requiredPermissions":["tabs"]},
    {"name":"copyCurrentUrl","desc":"Copy the current URL to the clipboard","group":"navigation","noRepeat":true,"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"openCopiedUrlInCurrentTab","desc":"Open the clipboard's URL in the current tab","group":"navigation","noRepeat":true,"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"openCopiedUrlInNewTab","desc":"Open the clipboard's URL in a new tab","group":"navigation","noRepeat":true,"options":{"position":"Where to place the tab in the tab bar. One of `start`, `before`, `after`, `end`. `after` is the default."},"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"goUp","desc":"Go up the URL hierarchy","group":"navigation","advanced":true,"countPolicy":{"meaning":"scalar"}},
    {"name":"goToRoot","desc":"Go to the root of current URL hierarchy","group":"navigation","advanced":true},
    {"name":"enterInsertMode","desc":"Enter insert mode","group":"navigation","noRepeat":true,"repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}},
    {"name":"enterVisualMode","desc":"Enter visual mode","group":"navigation","noRepeat":true,"repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}},
    {"name":"enterVisualLineMode","desc":"Enter visual line mode","group":"navigation","advanced":true,"noRepeat":true,"repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}},
    {"name":"passNextKey","desc":"Pass the next key to the page","options":{"normal":"Optional. Enter Vimium's normal mode, and ignore any defined pass keys."},"group":"navigation","advanced":true,"resultKind":"interaction"},
    {"name":"focusInput","desc":"Focus the first text input on the page","group":"navigation","resultKind":"interaction","countPolicy":{"meaning":"scalar"}},
    {"name":"LinkHints.activateMode","desc":"Open a link in the current tab","options":{"action":"one of `hover`, `focus`, `copy-text`. When a link is selected, instead of clicking on the link, perform the specified action."},"group":"navigation","advanced":true,"resultKind":"interaction"},
    {"name":"LinkHints.activateModeToOpenInNewTab","desc":"Open a link in a new tab","group":"navigation","resultKind":"interaction"},
    {"name":"LinkHints.activateModeToOpenInNewForegroundTab","desc":"Open a link in a new tab & switch to it","group":"navigation","resultKind":"interaction"},
    {"name":"LinkHints.activateModeWithQueue","desc":"Open multiple links in a new tab","group":"navigation","advanced":true,"noRepeat":true,"repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}},
    {"name":"LinkHints.activateModeToDownloadLink","desc":"Download link url","group":"navigation","advanced":true,"resultKind":"interaction"},
    {"name":"LinkHints.activateModeToOpenIncognito","desc":"Open a link in incognito window","group":"navigation","advanced":true,"resultKind":"interaction"},
    {"name":"LinkHints.activateModeToCopyLinkUrl","desc":"Copy a link URL to the clipboard","group":"navigation","advanced":true,"resultKind":"interaction"},
    {"name":"goPrevious","desc":"Follow the link labeled previous or <","group":"navigation","advanced":true,"noRepeat":true,"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"goNext","desc":"Follow the link labeled next or >","group":"navigation","advanced":true,"noRepeat":true,"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"nextFrame","desc":"Select the next frame on the page","group":"navigation","background":true,"execution":"background","requiredPermissions":["tabs"]},
    {"name":"mainFrame","desc":"Select the page's main/top frame","group":"navigation","topFrame":true,"noRepeat":true,"execution":"topFrame","repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"Marks.activateCreateMode","desc":"Create a new mark","details":"Do this by typing the key bound to this command, and then a letter. This will set a mark bound to that letter. Lowercase letters are local marks and uppercase letters are global marks.","options":{"swap":"Swap global and local marks. This option exists because in a browser, global marks are generally more useful than local marks, and so it may be desirable to make lowercase letters represent global marks rather than local marks."},"group":"navigation","advanced":true,"noRepeat":true,"repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}},
    {"name":"Marks.activateGotoMode","desc":"Jump to a mark","options":{"swap":"Swap global and local marks. This option exists because in a browser, global marks are generally more useful than local marks, and so it may be desirable to make lowercase letters represent global marks rather than local marks."},"group":"navigation","advanced":true,"noRepeat":true,"repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}},
    {"name":"Vomnibar.activate","desc":"Open URL, bookmark or history entry","options":{"query":"The text to prefill the Vomnibar with.","keyword":"The keyword of a search engine defined in the \"Custom search engines\" section of the Vimium Options page. The Vomnibar will be scoped to use that search engine."},"group":"vomnibar","topFrame":true,"execution":"topFrame","resultKind":"interaction"},
    {"name":"Vomnibar.activateInNewTab","desc":"Open URL, bookmark or history entry in a new tab","group":"vomnibar","options":{"query":"The text to prefill the Vomnibar with.","keyword":"The keyword of a search engine defined in the \"Custom search engines\" section of the Vimium Options page. The Vomnibar will be scoped to use that search engine."},"topFrame":true,"execution":"topFrame","resultKind":"interaction"},
    {"name":"Vomnibar.activateBookmarks","desc":"Open a bookmark","group":"vomnibar","options":{"query":"The text to prefill the Vomnibar with."},"topFrame":true,"execution":"topFrame","resultKind":"interaction"},
    {"name":"Vomnibar.activateBookmarksInNewTab","desc":"Open a bookmark in a new tab","group":"vomnibar","options":{"query":"The text to prefill the Vomnibar with."},"topFrame":true,"execution":"topFrame","resultKind":"interaction"},
    {"name":"Vomnibar.activateTabSelection","desc":"Search through your open tabs","group":"vomnibar","topFrame":true,"execution":"topFrame","resultKind":"interaction"},
    {"name":"Vomnibar.activateEditUrl","desc":"Edit the current URL","group":"vomnibar","topFrame":true,"execution":"topFrame","resultKind":"interaction"},
    {"name":"Vomnibar.activateEditUrlInNewTab","desc":"Edit the current URL and open in a new tab","group":"vomnibar","topFrame":true,"execution":"topFrame","resultKind":"interaction"},
    {"name":"enterFindMode","desc":"Enter find mode.","group":"find","noRepeat":true,"repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}},
    {"name":"performFind","desc":"Cycle forward to the next find match","group":"find","countPolicy":{"meaning":"scalar"}},
    {"name":"performBackwardsFind","desc":"Cycle backward to the previous find match","group":"find","countPolicy":{"meaning":"scalar"}},
    {"name":"findSelected","desc":"Find the selected text","group":"find","advanced":true,"countPolicy":{"meaning":"scalar"}},
    {"name":"findSelectedBackwards","desc":"Find the selected text, searching backwards","group":"find","advanced":true,"countPolicy":{"meaning":"scalar"}},
    {"name":"goBack","desc":"Go back in history","group":"history","countPolicy":{"meaning":"scalar"}},
    {"name":"goForward","desc":"Go forward in history","group":"history","countPolicy":{"meaning":"scalar"}},
    {"name":"createTab","desc":"Create new tab","options":{"(any url)":"Open this URL, rather than the browser's new tab page. E.g.: `map X createTab https://example.com`","window":"Create the tab in a new window","incognito":"Create the tab in an incognito window","position":"Where to place the tab in the tab bar. One of `start`, `before`, `after`, `end`. `after` is the default."},"group":"tabs","background":true,"repeatLimit":20,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"confirmationThreshold":20,"otherInputHardLimit":10}},
    {"name":"previousTab","desc":"Go one tab left","group":"tabs","background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"position"}},
    {"name":"nextTab","desc":"Go one tab right","group":"tabs","background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"position"}},
    {"name":"visitPreviousTab","desc":"Go to previously-visited tab","group":"tabs","background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"position"}},
    {"name":"firstTab","desc":"Go to the first tab","group":"tabs","background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"position"}},
    {"name":"lastTab","desc":"Go to the last tab","group":"tabs","background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"position"}},
    {"name":"duplicateTab","desc":"Duplicate current tab","group":"tabs","background":true,"repeatLimit":20,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"confirmationThreshold":20,"otherInputHardLimit":10}},
    {"name":"togglePinTab","desc":"Pin or unpin current tab","group":"tabs","background":true,"execution":"background","requiredPermissions":["tabs"]},
    {"name":"toggleMuteTab","desc":"Mute or unmute current tab","options":{"all":"Mute all tabs.","other":"Mute every tab except the current one."},"group":"tabs","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"removeTab","desc":"Close current tab","group":"tabs","background":true,"repeatLimit":25,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"confirmationThreshold":25,"otherInputHardLimit":10}},
    {"name":"restoreTab","desc":"Restore closed tab","group":"tabs","background":true,"repeatLimit":20,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"confirmationThreshold":20,"otherInputHardLimit":10}},
    {"name":"moveTabToNewWindow","desc":"Move tab to new window","group":"tabs","advanced":true,"background":true,"execution":"background","requiredPermissions":["tabs"]},
    {"name":"closeTabsOnLeft","desc":"Close tabs on the left","group":"tabs","advanced":true,"background":true,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"meaning":"range","nullable":true,"otherInputHardLimit":10}},
    {"name":"closeTabsOnRight","desc":"Close tabs on the right","group":"tabs","advanced":true,"background":true,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"meaning":"range","nullable":true,"otherInputHardLimit":10}},
    {"name":"closeOtherTabs","desc":"Close all other tabs","group":"tabs","advanced":true,"background":true,"noRepeat":true,"execution":"background","repeatable":false,"dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true,"otherInputHardLimit":10}},
    {"name":"moveTabLeft","desc":"Move tab to the left","group":"tabs","advanced":true,"background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"position"}},
    {"name":"moveTabRight","desc":"Move tab to the right","group":"tabs","advanced":true,"background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"position"}},
    {"name":"setZoom","desc":"Set zoom","group":"tabs","advanced":true,"background":true,"options":{"level":"The zoom level. This can be a range of [0.25, 5.0]. 1.0 is the default."},"execution":"background","requiredPermissions":["tabs"]},
    {"name":"zoomIn","desc":"Zoom in","group":"tabs","advanced":true,"background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"scalar"}},
    {"name":"zoomOut","desc":"Zoom out","group":"tabs","advanced":true,"background":true,"execution":"background","requiredPermissions":["tabs"],"countPolicy":{"meaning":"scalar"}},
    {"name":"zoomReset","desc":"Reset zoom","group":"tabs","advanced":true,"background":true,"execution":"background","requiredPermissions":["tabs"]},
    {"name":"BrowserToolbox.closeWindow","desc":"Close current window","group":"windows","background":true,"repeatLimit":1,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"confirmationThreshold":1,"otherInputHardLimit":10}},
    {"name":"BrowserToolbox.newWindow","desc":"Open a new window","group":"windows","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.toggleFullscreen","desc":"Toggle fullscreen","group":"windows","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.minimizeWindow","desc":"Minimize current window","group":"windows","background":true,"repeatLimit":1,"execution":"background","dangerous":true,"requiredPermissions":["tabs"],"countPolicy":{"confirmationThreshold":1,"otherInputHardLimit":10}},
    {"name":"BrowserToolbox.maximizeWindow","desc":"Maximize current window","group":"windows","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.showTabList","desc":"Show tab list","group":"tabs","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.openSettings","desc":"Open Browser Toolbox settings","group":"settings","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.openCommandCenter","desc":"Open Browser Toolbox command center","group":"settings","background":true,"noRepeat":true,"supportedInputs":["keyboard","ui"],"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.openTool","desc":"Open a Browser Toolbox utility","group":"tools","background":true,"noRepeat":true,"supportedInputs":["ui"],"optionSchema":{"toolId":{"type":"string","maxLength":64},"inputToken":{"type":"string","maxLength":128},"source":{"type":"enum","values":["action","selection","page","link","image","command"]}},"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.toggleKeyboard","desc":"Toggle keyboard navigation","group":"settings","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.toggleMouseGestures","desc":"Toggle mouse gestures","group":"settings","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.toggleSuperDrag","desc":"Toggle super drag","group":"settings","background":true,"noRepeat":true,"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.copySelection","desc":"Copy selected text","group":"links","noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["selection"],"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.copyLinkText","desc":"Copy link text","group":"links","noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["link"],"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.copyLinkUrl","desc":"Copy link URL","group":"links","noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["link"],"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.copyImageUrl","desc":"Copy image URL","group":"links","noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["image"],"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.searchSelection","desc":"Search selected text","group":"links","background":true,"noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["selection"],"optionSchema":{"disposition":{"type":"enum","values":["foreground","background"]},"keyword":{"type":"string","maxLength":64}},"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.openLinkForeground","desc":"Open link in foreground","group":"links","background":true,"noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["link"],"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.openLinkBackground","desc":"Open link in background","group":"links","background":true,"noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["link"],"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.openImageForeground","desc":"Open image in foreground","group":"links","background":true,"noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["image"],"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.openImageBackground","desc":"Open image in background","group":"links","background":true,"noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["image"],"execution":"background","repeatable":false,"requiredPermissions":["tabs"],"countPolicy":{"noRepeat":true}},
    {"name":"BrowserToolbox.downloadImage","desc":"Download image","group":"links","noRepeat":true,"supportedInputs":["superDrag"],"requiredContext":["image"],"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"toggleViewSource","desc":"View page source","group":"misc","advanced":true,"noRepeat":true,"repeatable":false,"countPolicy":{"noRepeat":true}},
    {"name":"showHelp","desc":"Show help","group":"misc","noRepeat":true,"topFrame":true,"execution":"topFrame","repeatable":false,"resultKind":"interaction","countPolicy":{"noRepeat":true}}
  ];
  // 映射解析器保留键值文本；例如 hard=false 仍是旧实现的非空字符串，不能在新入口中改成布尔 false。
  const scalar = { type: "mappingScalar", maxLength: 8192 };
  const text = { type: "string", maxLength: 8192 };
  const parameters = {
    reload: { hard: scalar },
    openCopiedUrlInNewTab: { position: text },
    passNextKey: { normal: scalar },
    "LinkHints.activateMode": { action: text },
    "Marks.activateCreateMode": { swap: scalar },
    "Marks.activateGotoMode": { swap: scalar },
    "Vomnibar.activate": { query: text, keyword: text },
    "Vomnibar.activateInNewTab": { query: text, keyword: text },
    "Vomnibar.activateBookmarks": { query: text },
    "Vomnibar.activateBookmarksInNewTab": { query: text },
    createTab: { "(any url)": scalar, window: scalar, incognito: scalar, position: text },
    toggleMuteTab: { all: scalar, other: scalar },
    setZoom: { level: scalar },
  };
  const resultCodes = ["OK", "INTERACTION_OPENED", "CANCELLED", "UNKNOWN_COMMAND", "INVALID_OPTIONS", "PERMISSION_DENIED", "NO_ACTIVE_TAB", "COMMAND_UNAVAILABLE", "COMMAND_FAILED", "RESULT_UNKNOWN", "DUPLICATE_REQUEST", "CONFIRMATION_REQUIRED", "STALE_RUNTIME", "EXTENSION_CONTEXT_LOST"];
  const freeze = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  freeze(common); freeze(commonPolicy); freeze(parameters); freeze(resultCodes);
  const rawByName = new Map(rows.flatMap(row => (row.aliases || [row.name]).map(name => [name, row])));
  const byName = new Map();
  // 网页初始化无需构造所有命令描述；首次同步查找只构造该命令，后台/帮助清单仍返回完整冻结契约。
  function getCommand(name) {
    const row = rawByName.get(name);
    if (!row) return null;
    if (!byName.has(row.name)) byName.set(row.name, freeze({ ...common, ...row,
      title: row.title || row.desc, category: row.category || row.group,
      i18nKey: row.i18nKey || "command_" + row.name.replaceAll(".", "_"),
      aliases: row.aliases || [row.name],
      countPolicy: row.countPolicy ? { ...commonPolicy, ...row.countPolicy } : commonPolicy,
      parameterSchema: parameters[row.name] || row.optionSchema || emptySchema,
      resultCodes }));
    return byName.get(row.name);
  }
  return Object.freeze({getCommand, listCommands: () => rows.map(row => getCommand(row.name))});
  }
  globalThis.BrowserToolboxCommandDefinitions = Object.freeze({
    getCommand(name) {
      definitions ||= initializeDefinitions();
      return definitions.getCommand(name);
    },
    listCommands() {
      definitions ||= initializeDefinitions();
      return definitions.listCommands();
    },
  });
})();
