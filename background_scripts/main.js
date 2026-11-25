import "../lib/utils.js";
import "../lib/browser_toolbox/configuration_client.js";
import "../lib/settings.js";
import "../lib/url_utils.js";
import "../lib/i18n.js";
import "../lib/browser_toolbox/value_utils.js";
import "../lib/browser_toolbox/tools/tool_contract.js";
import "../lib/browser_toolbox/tools/tool_registry.js";
import "../lib/browser_toolbox/tools/tool_registry_validator.js";
import "../lib/browser_toolbox/command_invocation.js";
import "../lib/browser_toolbox/message_protocol.js";
import "../lib/browser_toolbox/runtime_plan.js";
import "../lib/browser_toolbox/settings_schema.js";
import "../lib/browser_toolbox/regex_safety.js";
import "../lib/browser_toolbox/module_registry.js";
import "../lib/browser_toolbox/browser_startup.js";
import "../lib/browser_toolbox/settings_validator.js";
import "../lib/browser_toolbox/site_rule_matcher.js";
import "../background_scripts/tab_recency.js";
import * as bgUtils from "../background_scripts/bg_utils.js";
import "../background_scripts/all_commands.js";
import "./browser_toolbox/settings_migrations.js";
import "./browser_toolbox/settings_storage.js";
import "../lib/browser_toolbox/settings_policy.js";
import "./browser_toolbox/vimium_settings_adapter.js";
import "./browser_toolbox/settings_repository.js";
import "./browser_toolbox/tool_input_token_store.js";
import "./browser_toolbox/tool_launcher.js";
import "./browser_toolbox/tool_context_menu_manager.js";
import "./browser_toolbox/command_registry_adapter.js";
import "./browser_toolbox/browser_command_adapter.js";
import "./browser_toolbox/request_ledger.js";
import "./browser_toolbox/document_authority.js";
import "./browser_toolbox/command_dispatcher.js";
import "./browser_toolbox/gesture_frame_coordinator.js";
import "./browser_toolbox/runtime_maintenance.js";
import "../content_scripts/mouse/cursor_controller.js";
import "./browser_toolbox/configuration_writer.js";
import { TransitionArchive as ReadOnlyTransitionArchive } from "./browser_toolbox/transition_archive.js";
import { Commands } from "../background_scripts/commands.js";
import * as exclusions from "../background_scripts/exclusions.js";
import "../background_scripts/completion/search_engines.js";
import "../background_scripts/completion/search_wrapper.js";
import "../background_scripts/completion/completers.js";
import "../background_scripts/tab_operations.js";
import * as marks from "../background_scripts/marks.js";

import {
  BookmarkCompleter,
  DomainCompleter,
  HistoryCompleter,
  MultiCompleter,
  SearchEngineCompleter,
  TabCompleter,
} from "./completion/completers.js";

// NOTE(philc): This file has many superfluous return statements in its functions, as a result of
// converting from coffeescript to es6. Many can be removed, but I didn't take the time to
// diligently track down precisely which return statements could be removed when I was doing the
// conversion.

import * as TabOperations from "./tab_operations.js";

// Allow Vimium's content scripts to access chrome.storage.session. Otherwise,
// chrome.storage.session will be null in content scripts.
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

// This is exported for use by "marks.js".
globalThis.tabLoadedHandlers = {}; // tabId -> function()

// A Vimium secret, available only within the current browser session. The secret is a generated
// strong random string.
const randomArray = globalThis.crypto.getRandomValues(new Uint8Array(32)); // 32-byte random token.
const secretToken = randomArray.reduce((a, b) => a.toString(16) + b.toString(16));
chrome.storage.session.set({ vimiumSecret: secretToken });

const completionSources = {
  bookmarks: new BookmarkCompleter(),
  history: new HistoryCompleter(),
  domains: new DomainCompleter(),
  tabs: new TabCompleter(),
  searchEngines: new SearchEngineCompleter(),
};

const completers = {
  omni: new MultiCompleter([
    completionSources.bookmarks,
    completionSources.history,
    completionSources.domains,
    completionSources.tabs,
    completionSources.searchEngines,
  ]),
  bookmarks: new MultiCompleter([completionSources.bookmarks]),
  tabs: new MultiCompleter([completionSources.tabs]),
};

async function queryTabsForCommand({ tab, commandCenterTabId }) {
  // 以来源标签所在窗口为准，避免焦点切换后把操作施加到另一个窗口。
  const query = tab.windowId == null ? { currentWindow: true } : { windowId: tab.windowId };
  if (bgUtils.isFirefox()) query.hidden = false;
  const tabs = await chrome.tabs.query(query);
  return commandCenterTabId == null ? tabs : tabs.filter((item) => item.id !== commandCenterTabId);
}

function onURLChange(details) {
  // sendMessage will throw "Error: Could not establish connection. Receiving end does not exist."
  // if there is no Vimium content script loaded in the given tab. This can occur if the user
  // navigated to a page where Vimium doesn't have permissions, like chrome:// URLs. This error is
  // noisy and mysterious (it usually doesn't have a valid line number), so we silence it.
  const message = {
    handler: "checkEnabledAfterURLChange",
    silenceLogging: true,
  };
  chrome.tabs.sendMessage(details.tabId, message, { frameId: details.frameId })
    .catch(() => {});
}

// Re-check whether Vimium is enabled for a frame when the URL changes without a reload.
// There's no reliable way to detect when the URL has changed in the content script, so we
// have to use the webNavigation API in our background script.
chrome.webNavigation.onHistoryStateUpdated.addListener(onURLChange); // history.pushState.
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onURLChange); // Hash changed.

if (!globalThis.isUnitTests) {
  // Cache "content_scripts/vimium.css" in chrome.storage.session for UI components.
  (function () {
    const url = chrome.runtime.getURL("content_scripts/vimium.css");
    fetch(url).then(async (response) => {
      if (response.ok) {
        chrome.storage.session.set({ vimiumCSSInChromeStorage: await response.text() });
      }
    });
  })();
}

function muteTab(tab) {
  chrome.tabs.update(tab.id, { muted: !tab.mutedInfo.muted });
}

function toggleMuteTab(request, sender) {
  const currentTab = request.tab;
  const tabId = request.tabId;
  const registryEntry = request.registryEntry;

  if ((registryEntry.options.all != null) || (registryEntry.options.other != null)) {
    // If there are any audible, unmuted tabs, then we mute them; otherwise we unmute any muted tabs.
    chrome.tabs.query({ audible: true }, function (tabs) {
      let tab;
      if (registryEntry.options.other != null) {
        tabs = tabs.filter((t) => t.id !== currentTab.id);
      }
      const audibleUnmutedTabs = tabs.filter((t) => t.audible && !t.mutedInfo.muted);
      if (audibleUnmutedTabs.length >= 0) {
        chrome.tabs.sendMessage(tabId, {
          frameId: sender.frameId,
          handler: "showMessage",
          message: `Muting ${audibleUnmutedTabs.length} tab(s).`,
        });
        for (tab of audibleUnmutedTabs) {
          muteTab(tab);
        }
      } else {
        chrome.tabs.sendMessage(tabId, {
          frameId: sender.frameId,
          handler: "showMessage",
          message: "Unmuting all muted tabs.",
        });
        for (tab of tabs) {
          if (tab.mutedInfo.muted) {
            muteTab(tab);
          }
        }
      }
    });
  } else {
    if (currentTab.mutedInfo.muted) {
      chrome.tabs.sendMessage(tabId, {
        frameId: sender.frameId,
        handler: "showMessage",
        message: "Unmuted tab.",
      });
    } else {
      chrome.tabs.sendMessage(tabId, {
        frameId: sender.frameId,
        handler: "showMessage",
        message: "Muted tab.",
      });
    }
    muteTab(currentTab);
  }
}

// 忽略隐藏标签或命令中心后，可操作列表的下标可能与浏览器的标签下标不同。
function getTabIndex(tab, tabs) {
  return tabs[tab.index]?.id === tab.id ? tab.index : tabs.findIndex((item) => item.id === tab.id);
}

//
// Selects the tab with the ID specified in request.id
//
async function selectSpecificTab(request) {
  const tab = await chrome.tabs.get(request.id);
  if (request.executionGuard) await request.executionGuard();
  // Focus the tab's window. TODO(philc): Why are we null-checking chrome.windows here?
  if (chrome.windows != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  if (request.executionGuard) await request.executionGuard();
  await chrome.tabs.update(request.id, { active: true });
}

async function moveTab(request) {
  const { count, tab, registryEntry } = request;
  const delta = registryEntry.command === "moveTabLeft" ? -count : count;
  const tabs = await queryTabsForCommand(request);
  const activeIndex = getTabIndex(tab, tabs);
  if (activeIndex < 0) return;
  const pinnedCount = tabs.filter((item) => item.pinned).length;
  const minIndex = tab.pinned ? 0 : pinnedCount;
  const maxIndex = (tab.pinned ? pinnedCount : tabs.length) - 1;
  const moveIndex = Math.max(minIndex, Math.min(maxIndex, activeIndex + delta));
  await chrome.tabs.move(tab.id, { index: tabs[moveIndex].index });
}

function createRepeatCommand(command) {
  return async function (request) {
    let i = request.count - 1;
    const r = Object.assign({}, request);
    delete r.count;
    while (i >= 0) {
      if (request.executionGuard) await request.executionGuard();
      i--;
      await command(r);
    }
  };
}

function nextZoomLevel(currentZoom, steps) {
  // Chrome's default zoom levels.
  const chromeLevels = [0.25, 0.33, 0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  // Firefox's default zoom levels.
  const firefoxLevels = [0.3, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.2, 1.33, 1.5, 1.7, 2, 2.4, 3, 4, 5];

  let zoomLevels = chromeLevels; // Chrome by default
  if (bgUtils.isFirefox()) {
    zoomLevels = firefoxLevels;
  }

  if (steps === 0) { // Nothing
    return currentZoom;
  } else if (steps > 0) { // In
    // Chrome sometimes returns values with floating point errors.
    // Example: Chrome gives 0.32999999999999996 instead of 0.33.
    currentZoom += 0.0000001; // This is needed to solve floating point bugs in Chrome.
    const nextIndex = zoomLevels.findIndex((level) => level > currentZoom);
    const floorIndex = nextIndex == -1 ? zoomLevels.length : nextIndex - 1;
    return zoomLevels[Math.min(zoomLevels.length - 1, floorIndex + steps)];
  } else if (steps < 0) { // Out
    currentZoom -= 0.0000001; // This is needed to solve floating point bugs in Chrome.
    let ceilIndex = zoomLevels.findIndex((level) => level >= currentZoom);
    ceilIndex = ceilIndex == -1 ? zoomLevels.length : ceilIndex;
    return zoomLevels[Math.max(0, ceilIndex + steps)];
  }
}

// These are commands which are bound to keystrokes which must be handled by the background page.
// They are mapped in commands.js.
const BackgroundCommands = {
  // Create a new tab. Also, with:
  //     map X createTab http://www.bbc.com/news
  // create a new tab with the given URL.
  createTab: createRepeatCommand(async function (request) {
    if (request.urls == null) {
      if (request.url) {
        // If the request contains a URL, then use it.
        request.urls = [request.url];
      } else {
        // Otherwise, if we have a registryEntry containing URLs, then use them.
        const options = Object.keys(request.registryEntry.options);
        const promises = options.map((opt) => UrlUtils.isUrl(opt));
        const isUrl = await Promise.all(promises);
        const urlList = options.filter((_, i) => isUrl[i]);
        if (urlList.length > 0) {
          request.urls = urlList;
        } else {
          // Otherwise, just create a new tab.
          let url;
          const destination = Settings.get("newTabDestination");
          const customUrl = Settings.get("newTabCustomUrl");
          if (destination == Settings.newTabDestinations.vimiumNewTabPage) {
            url = Settings.vimiumNewTabPageUrl;
          } else if (destination == Settings.newTabDestinations.customUrl && customUrl.length > 0) {
            url = customUrl;
          } else {
            url = UrlUtils.chromeNewTabUrl;
          }
          request.urls = [url];
        }
      }
    }
    if (request.registryEntry.options.incognito || request.registryEntry.options.window) {
      // Firefox does not allow an incognito window to be created with the URL about:newtab. It
      // throws this error: "Illegal URL: about:newtab".
      const urls = request.urls.filter((u) => u != UrlUtils.chromeNewTabUrl);
      const windowConfig = {
        url: urls,
        incognito: request.registryEntry.options.incognito || false,
      };
      await chrome.windows.create(windowConfig);
    } else {
      const urls = request.urls.slice().reverse();
      if (request.position == null) {
        request.position = request.registryEntry.options.position;
      }
      while (urls.length > 0) {
        const url = urls.pop();
        const tab = await TabOperations.openUrlInNewTab(Object.assign(request, { url }));
        // Ensure subsequent invocations of this command place the next tab directly after this one.
        Object.assign(request, { tab, position: "after", active: false });
      }
    }
  }),

  duplicateTab: createRepeatCommand(async (request) => {
    const tab = await chrome.tabs.duplicate(request.tabId);
    // Ensure subsequent invocations of this command place the next tab directly after this one.
    request.tabId = tab.id;
  }),

  async moveTabToNewWindow(request) {
    const { count, tab } = request;
    const tabs = await queryTabsForCommand(request);
    const activeIndex = getTabIndex(tab, tabs);
    if (activeIndex < 0) return;
    const start = Math.max(0, Math.min(activeIndex, tabs.length - count));
    const [first, ...rest] = tabs.slice(start, start + count);
    const window = await chrome.windows.create({ tabId: first.id, incognito: first.incognito });
    if (rest.length > 0) {
      await chrome.tabs.move(rest.map((item) => item.id), { windowId: window.id, index: -1 });
    }
  },

  nextTab(request) {
    return selectTab("next", request);
  },
  previousTab(request) {
    return selectTab("previous", request);
  },
  firstTab(request) {
    return selectTab("first", request);
  },
  lastTab(request) {
    return selectTab("last", request);
  },
  async removeTab(request) {
    await forCountTabs(request, (tab) => {
      // In Firefox, Ctrl-W will not close a pinned tab, but on Chrome, it will. We try to be
      // consistent with each browser's UX for pinned tabs.
      if (tab.pinned && bgUtils.isFirefox()) return;
      return chrome.tabs.remove(tab.id);
    });
  },
  restoreTab: createRepeatCommand(async (request) => {
    await chrome.sessions.restore(null);
  }),
  async togglePinTab(request) {
    await forCountTabs(request, (tab) => chrome.tabs.update(tab.id, { pinned: !tab.pinned }));
  },
  toggleMuteTab,
  moveTabLeft: moveTab,
  moveTabRight: moveTab,

  async setZoom({ tabId, registryEntry }) {
    const level = registryEntry.options?.["level"] ?? "1";
    const newZoom = parseFloat(level);
    if (!isNaN(newZoom)) {
      chrome.tabs.setZoom(tabId, newZoom);
    }
  },
  async zoomIn({ count, tabId }) {
    const currentZoom = await chrome.tabs.getZoom(tabId);
    const newZoom = nextZoomLevel(currentZoom, count);
    chrome.tabs.setZoom(tabId, newZoom);
  },
  async zoomOut({ count, tabId }) {
    const currentZoom = await chrome.tabs.getZoom(tabId);
    const newZoom = nextZoomLevel(currentZoom, -count);
    chrome.tabs.setZoom(tabId, newZoom);
  },
  async zoomReset({ tabId }) {
    chrome.tabs.setZoom(tabId, 0); // setZoom of 0 sets to the tab default.
  },

  async nextFrame(request, sender) {
    const { count: requestedCount, tabId } = request;
    let count = requestedCount;
    if (globalThis.BrowserToolboxRuntimePlans?.COMPILED_UI_CANARY) {
      const source = await browserToolboxDocumentAuthority.compatible(sender);
      const allowsPlan = (version) => BrowserToolboxRuntimePlans.allowed.some((plan) =>
        plan.planVersion === version && plan.moduleImplementations.frameFocus === "browser-toolbox");
      if (allowsPlan(source.planVersion)) {
        browserToolboxFrameFocusService ||= new BrowserToolboxFrameFocusService({
          api: chrome, authority: browserToolboxDocumentAuthority, allowsPlan,
        });
        return browserToolboxFrameFocusService.next(request, sender);
      }
    }
    // We're assuming that these frames are returned in the order that they appear on the page. This
    // seems to be the case empirically. If it's ever needed, we could also sort by frameId.
    let frameIds = await getFrameIdsForTab(tabId);
    const promises = frameIds.map(async (frameId) => {
      // It is possible that this sendMessage call fails, if a frame gets unloaded while the request
      // is in flight.
      let isError = false;
      const status = await (chrome.tabs.sendMessage(tabId, { handler: "getFocusStatus" }, {
        frameId: frameId,
      }).catch((_) => {
        isError = true;
      }));
      return { frameId, status, isError };
    });

    const frameResponses = (await Promise.all(promises)).filter((r) => !r.isError);

    const focusedFrameId = frameResponses.find(({ status }) => status.focused)?.frameId;
    // It's theoretically possible that focusedFrameId is null if the user switched tabs or away
    // from the browser while the request is in flight.
    if (focusedFrameId == null) return;

    // Prune any frames which gave an error response (i.e. they disappeared).
    frameIds = frameResponses.filter((r) => r.status.focusable).map((r) => r.frameId);

    const index = frameIds.indexOf(focusedFrameId);
    count = count ?? 1;
    const nextIndex = (index + count) % frameIds.length;
    if (index == nextIndex) return;
    await chrome.tabs.sendMessage(tabId, { handler: "focusFrame", highlight: true }, {
      frameId: frameIds[nextIndex],
    });
  },

  async closeTabsOnLeft(request) {
    await removeTabsRelative("before", request);
  },
  async closeTabsOnRight(request) {
    await removeTabsRelative("after", request);
  },
  async closeOtherTabs(request) {
    await removeTabsRelative("both", request);
  },

  async visitPreviousTab({ count, tab, commandCenterTabId }) {
    await bgUtils.tabRecency.init();
    const tabIds = bgUtils.tabRecency.getTabsByRecency()
      .filter((tabId) => tabId !== tab.id && tabId !== commandCenterTabId);
    if (tabIds.length > 0) {
      const id = tabIds[(count - 1) % tabIds.length];
      await selectSpecificTab({ id });
    }
  },

  async reload(request) {
    const bypassCache = request.registryEntry.options.hard ?? false;
    await forCountTabs(request, (tab) => chrome.tabs.reload(tab.id, { bypassCache }));
  },
};

const browserToolboxSettingsRepository = globalThis.BrowserToolboxSettingsRepositoryInstance;
if (!globalThis.isUnitTests) {
  globalThis.BrowserToolboxConfigurationWriterInstance = new BrowserToolboxConfigurationStore
    .ConfigurationWriter({
    storage: chrome.storage,
    defaults: () => Settings.defaultOptions,
    migrateLegacy: (value) => Settings.migrateSettingsIfNecessary(value),
    migrateToolbox: (value) => BrowserToolboxSettingsMigrations.migrate(value),
    validateToolbox: (value) =>
      BrowserToolboxSettingsValidator.assertValid(value, BrowserToolboxCommandRegistry),
    onCommit: (snapshot) => {
      Settings._settings = snapshot.keyboard;
      Settings.configurationRevision = snapshot.revision;
      browserToolboxSettingsRepository.settings = snapshot.toolboxSource.value;
      browserToolboxSettingsRepository.storageArea = snapshot.toolboxSource.area;
      Settings.dispatchEvent("change");
      browserToolboxSettingsRepository.emit();
    },
  });
}
const browserToolboxFrameCoordinator = globalThis.BrowserToolboxGestureFrameCoordinatorInstance;
const browserToolboxToolInputTokenStore = globalThis.BrowserToolboxToolInputTokenStoreInstance;
const browserToolboxStartupNavigator = new globalThis.BrowserToolboxBrowserStartup
  .BrowserStartupNavigator({ logger: (message) => Utils.debugLog(message) });
const browserToolboxToolContextMenuManager = new globalThis.BrowserToolboxToolContextMenuManager
  .ToolContextMenuManager({
  settingsRepository: browserToolboxSettingsRepository,
});

// 设置页或同步设备修改配置后，只广播失效通知；每个 frame 再按自身生命周期读取一次有效快照。
// 这样消息不携带完整配置，也不会把不同标签页的站点规则结果混用。
let browserToolboxSettingsChangeBroadcastPending = false;
async function broadcastBrowserToolboxSettingsChange() {
  if (browserToolboxSettingsChangeBroadcastPending) return;
  browserToolboxSettingsChangeBroadcastPending = true;
  try {
    const tabs = await chrome.tabs.query({});
    const message = globalThis.BrowserToolboxMessageProtocol.create(
      "browserToolbox.settingsChanged",
    );
    await Promise.all((tabs || []).map((tab) => {
      if (tab?.id == null) return Promise.resolve();
      try {
        return Promise.resolve(chrome.tabs.sendMessage(tab.id, message)).catch(() => {});
      } catch (_) {
        return Promise.resolve();
      }
    }));
  } catch (_) {
    // 没有可访问的标签页时不影响配置保存；下一次内容脚本初始化会重新读取配置。
  } finally {
    browserToolboxSettingsChangeBroadcastPending = false;
  }
}

browserToolboxSettingsRepository.addEventListener(() => {
  broadcastBrowserToolboxSettingsChange();
  browserToolboxToolContextMenuManager.reconcile().catch(() => {});
});

const browserToolboxBrowserAdapter = new globalThis.BrowserToolboxBrowserCommandAdapter(
  browserToolboxSettingsRepository,
);
const browserToolboxDispatcher = new globalThis.BrowserToolboxCommandDispatcher({
  registry: globalThis.BrowserToolboxCommandRegistry,
  browserAdapter: browserToolboxBrowserAdapter,
  backgroundCommands: BackgroundCommands,
  selectBackgroundCommands: (invocation, authority) => {
    if (invocation.commandName !== "createTab" || invocation.source.type !== "keyboard") return null;
    const plan = BrowserToolboxRuntimePlans.allowed.find((item) =>
      item.planVersion === authority?.planVersion
    );
    return plan?.moduleImplementations.newTab === "browser-toolbox"
      ? BrowserToolboxNewTabCommands
      : null;
  },
  gestureCoordinator: browserToolboxFrameCoordinator,
  requestLedger: new BrowserToolboxRequestLedger(chrome.storage.session),
  targetIdentity: (tabId, frameId) => browserToolboxDocumentAuthority.target(tabId, frameId),
});
const browserToolboxDocumentAuthority = new BrowserToolboxDocumentAuthority(chrome);
let browserToolboxCompletionHub = null;
const sameCompletionOwner = (a, b) =>
  a.documentId === b.documentId && a.componentId === b.componentId &&
  a.ownerDocumentId === b.ownerDocumentId && a.ownerEpoch === b.ownerEpoch &&
  a.tabId === b.tabId && a.frameId === b.frameId &&
  a.planVersion === b.planVersion && a.incognito === b.incognito;
async function browserToolboxCompletionSession(sender, verifiedComponent = null) {
  if (!BrowserToolboxRuntimePlans.COMPILED_VOMNIBAR_CANARY || browserToolboxDocumentAuthority.role(sender) !== "component") return null;
  // 消息入口已刚校验过 component(sender) 时直接复用其授权快照，避免补全前重复执行两轮 getFrame IPC。
  const record = verifiedComponent || await browserToolboxDocumentAuthority.component(sender);
  const plan = BrowserToolboxRuntimePlans.allowed.find((item) => item.planVersion === record.planVersion);
  if (record.component !== "vomnibar" || plan?.moduleImplementations.completers !== "browser-toolbox") return null;
  if (!browserToolboxCompletionHub) {
    const Hub = globalThis.BrowserToolboxCompletions?.CompletionHub;
    if (!Hub) throw new Error("COMPLETIONS_NOT_INSTALLED");
    browserToolboxCompletionHub = new Hub(chrome, { settings: Settings, tabRecency: bgUtils.tabRecency, firefox: bgUtils.isFirefox() });
  }
  // Native核验后到租用会话之间没有异步操作；查询完成后仍重新核验，拒绝导航或撤销期间的回包。
  return { record, session: browserToolboxCompletionHub.get(record) };
}
const browserToolboxPausedRuntimeTabs = new Set();
let browserToolboxMarksService = null;
let browserToolboxFrameFocusService = null;
async function browserToolboxMarkAction(request, sender) {
  if (!BrowserToolboxRuntimePlans.COMPILED_MARKS_CANARY ||
    browserToolboxDocumentAuthority.role(sender) !== "content") {
    return { ok: false, code: "PERMISSION_DENIED" };
  }
  if (!browserToolboxMarksService) {
    browserToolboxMarksService = new BrowserToolboxMarksService({
      api: chrome,
      authority: browserToolboxDocumentAuthority,
      ledger: browserToolboxDispatcher.requestLedger,
      allowsPlan: (version) => BrowserToolboxRuntimePlans.allowed.some((plan) =>
        plan.planVersion === version && plan.moduleImplementations.marks === "browser-toolbox"),
      paused: (tabId) => browserToolboxPausedRuntimeTabs.has(tabId),
      relay: (tabId, frameId, message, plan) =>
        sendLifecycleMessage(tabId, frameId, "relay", message, plan),
      open: (request) => TabOperations.openUrlInNewTab(request),
      ready: (tabId) => new Promise((resolve, reject) => {
        let timer;
        const finish = (error) => {
          clearTimeout(timer);
          if (tabLoadedHandlers[tabId] === loaded) delete tabLoadedHandlers[tabId];
          chrome.tabs.onRemoved.removeListener(removed);
          error ? reject(error) : resolve();
        };
        const loaded = () => finish();
        const removed = (id) => {
          if (id === tabId) finish(Object.assign(new Error("MARK_TARGET_CLOSED"), { code: "MARK_TARGET_CLOSED" }));
        };
        tabLoadedHandlers[tabId] = loaded;
        chrome.tabs.onRemoved.addListener(removed);
        timer = setTimeout(() => finish(Object.assign(new Error("MARK_TARGET_TIMEOUT"), { code: "RESULT_UNKNOWN" })), 10000);
        // 新页可能已经完成注册；即时核对一次，后续由实际 domReady 唤醒，不轮询。
        browserToolboxDocumentAuthority.target(tabId, 0).then(() => finish()).catch(() => {});
      }),
    });
  }
  return browserToolboxMarksService.handle(request, sender);
}
async function browserToolboxSubmitVomnibar(request, sender) {
  if (!BrowserToolboxRuntimePlans.COMPILED_VOMNIBAR_CANARY ||
    browserToolboxDocumentAuthority.role(sender) !== "content") {
    return { ok: false, code: "PERMISSION_DENIED" };
  }
  const submission = request.payload.submission;
  if (!BrowserToolboxMessageProtocol.validateVomnibarSubmission(submission)) {
    return { ok: false, code: "INVALID_VOMNIBAR_SUBMISSION" };
  }
  const executionGuard = async () => {
    const authority = await browserToolboxDocumentAuthority.verify(request.identity, sender);
    if (browserToolboxPausedRuntimeTabs.has(sender.tab.id)) throw Object.assign(new Error("STALE_RUNTIME"), { code: "STALE_RUNTIME" });
    if (authority.component || !BrowserToolboxRuntimePlans.allowed.some((plan) =>
      plan.planVersion === authority.planVersion && plan.moduleImplementations.vomnibar === "browser-toolbox"
    )) throw Object.assign(new Error("PERMISSION_DENIED"), { code: "PERMISSION_DENIED" });
  };
  await executionGuard();
  await sendRequestHandlers[submission.handler]({
    ...submission, count: 1, tab: sender.tab, tabId: sender.tab.id, executionGuard,
  }, sender);
  return { ok: true };
}
const browserToolboxOwnHintsPlan = (version) => BrowserToolboxRuntimePlans.allowed.some((plan) =>
  plan.planVersion === version && plan.moduleImplementations.hints === "browser-toolbox"
);
const browserToolboxHintsCoordinator = BrowserToolboxRuntimePlans.COMPILED_HINTS_CANARY
  ? new BrowserToolboxHintsCoordinator.Coordinator({
    frames: (tabId) => getFrameIdsForTab(tabId),
    target: (tabId, frameId) => browserToolboxDocumentAuthority.target(tabId, frameId),
    paused: (tabId) => browserToolboxPausedRuntimeTabs.has(tabId),
    allowsPlan: browserToolboxOwnHintsPlan,
    send: (tabId, _frameId, message, identity) => chrome.tabs.sendMessage(tabId,
      BrowserToolboxMessageProtocol.envelope("lifecycle", "hints", { message }, identity),
      { documentId: identity.documentId }),
  })
  : null;
const browserToolboxRuntimeMaintenance = new BrowserToolboxRuntimeMaintenance(chrome, {
  plans: BrowserToolboxRuntimePlans,
  frames: (tabId) => browserToolboxDocumentAuthority.frames(tabId, { probe: true }),
  clearTab: async (tabId) => {
    browserToolboxPausedRuntimeTabs.add(tabId);
    await browserToolboxHintsCoordinator?.cancelTab(tabId);
    browserToolboxCompletionHub?.clearTab(tabId);
    browserToolboxFrameCoordinator.clearTab(tabId);
    await browserToolboxDocumentAuthority.clearTab(tabId);
  },
  onFinished: () => browserToolboxPausedRuntimeTabs.clear(),
});

async function forCountTabs(request, callback) {
  const { count, tab } = request;
  const tabs = await queryTabsForCommand(request);
  const activeTabIndex = getTabIndex(tab, tabs);
  if (activeTabIndex < 0) return;
  const startTabIndex = Math.max(0, Math.min(activeTabIndex, tabs.length - count));
  await Promise.all(tabs.slice(startTabIndex, startTabIndex + count).map(callback));
}

// Remove tabs before, after, or either side of the currently active tab
async function removeTabsRelative(direction, request) {
  const { count: requestedCount, tab: activeTab } = request;
  // count is null if the user didn't type a count prefix before issuing this command and didn't
  // specify a count=n option in their keymapping settings. Interpret this as closing all tabs on
  // either side.
  const count = requestedCount ?? 99999;
  const tabs = await queryTabsForCommand(request);
  const activeIndex = getTabIndex(activeTab, tabs);
  if (activeIndex < 0) return;
  const toRemove = tabs.filter((tab, tabIndex) => {
    if (tab.pinned || tab.id == activeTab.id) {
      return false;
    }
    switch (direction) {
      case "before":
        return tabIndex < activeIndex &&
          tabIndex >= activeIndex - count;
      case "after":
        return tabIndex > activeIndex &&
          tabIndex <= activeIndex + count;
      case "both":
        return true;
    }
  });

  if (toRemove.length > 0) await chrome.tabs.remove(toRemove.map((t) => t.id));
}

// Selects a tab before or after the currently selected tab.
// - direction: "next", "previous", "first" or "last".
async function selectTab(direction, request) {
  const { count, tab, commandCenterTabId } = request;
  const tabs = await queryTabsForCommand(request);
  const current = getTabIndex(tab, tabs);
  if (current < 0 || (tabs.length === 1 && commandCenterTabId == null)) return;
  const toSelect = (() => {
    switch (direction) {
      case "next":
        return (current + count % tabs.length) % tabs.length;
      case "previous":
        return (current - count % tabs.length + tabs.length) % tabs.length;
      case "first":
        return Math.min(tabs.length - 1, count - 1);
      case "last":
        return Math.max(0, tabs.length - count);
    }
  })();
  const id = tabs[toSelect].id;
  if (commandCenterTabId != null) await selectSpecificTab({ id });
  else await chrome.tabs.update(id, { active: true });
}

// Chrome 的内置 XML 查看器不会执行 manifest.content_scripts；这里只为顶层 XML 页面补一条
// 静态文件注入路径。先读取浏览器已经判定的 MIME 类型，不读取或上传页面内容，也不触碰 iframe。
const browserToolboxRawDocumentFormatterScripts = [
  "lib/i18n.js",
  "lib/browser_toolbox/value_utils.js",
  "lib/browser_toolbox/tools/tool_contract.js",
  "lib/browser_toolbox/tools/tool_registry.js",
  "lib/browser_toolbox/tools/tool_registry_validator.js",
  "lib/browser_toolbox/tools/document_formatters.js",
  "content_scripts/document_formatter/document_formatter.js",
  "lib/browser_toolbox/command_invocation.js",
  "lib/browser_toolbox/message_protocol.js",
  "lib/browser_toolbox/settings_schema.js",
  "lib/browser_toolbox/theme.js",
  "lib/browser_toolbox/regex_safety.js",
  "lib/browser_toolbox/module_registry.js",
  "lib/browser_toolbox/settings_validator.js",
  "lib/browser_toolbox/site_rule_matcher.js",
  "lib/browser_toolbox/settings_policy.js",
  "background_scripts/browser_toolbox/settings_migrations.js",
  "background_scripts/browser_toolbox/settings_storage.js",
  "background_scripts/browser_toolbox/vimium_settings_adapter.js",
  "background_scripts/browser_toolbox/settings_repository.js",
  "lib/browser_toolbox/settings_runtime_client.js",
];

async function injectRawDocumentFormatterIntoXml(tabId, frameId) {
  if (frameId !== 0 || !chrome.scripting?.executeScript) return;
  try {
    const [pageInfo] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => ({
        contentType: document.contentType,
        formatterLoaded: Boolean(globalThis.BrowserToolboxDocumentFormatterController),
      }),
    });
    const contentType = String(pageInfo?.result?.contentType || "").toLowerCase();
    if (!/^application\/(?:[^;]+\+)?xml$/.test(contentType)) return;
    if (!pageInfo?.result?.formatterLoaded) {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: browserToolboxRawDocumentFormatterScripts,
      });
      await chrome.scripting.insertCSS({
        target: { tabId, frameIds: [0] },
        files: ["pages/theme_tokens.css", "content_scripts/document_formatter/document_formatter.css"],
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: async () => {
        if (!document.body || document.querySelector(".browser-toolbox-document-toolbar")) {
          return {};
        }
        await globalThis.BrowserToolboxDocumentFormatterController?.init?.();
      },
    });
  } catch (_) {
    // 浏览器受限页、页面在导航中卸载或用户撤回权限时保持原页面，不影响 Vimium 主流程。
  }
}

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId }) => {
  // Vimium can't run on all tabs (e.g. chrome:// URLs). insertCSS will throw an error on such tabs,
  // which is expected, and noise. Swallow that error.
  const swallowError = () => {};
  await Settings.onLoaded();
  await chrome.scripting.insertCSS({
    css: Settings.get("userDefinedLinkHintCss"),
    target: {
      tabId: tabId,
      frameIds: [frameId],
    },
  }).catch(swallowError);
  await injectRawDocumentFormatterIntoXml(tabId, frameId);
});

// XML 查看器的 body 可能在 onCommitted 之后才完成；完成导航时再调用一次只读初始化。
chrome.webNavigation.onCompleted?.addListener?.(({ tabId, frameId }) => {
  injectRawDocumentFormatterIntoXml(tabId, frameId).catch(() => {});
});

// Returns all frame IDs for the given tab. Note that in Chrome, this will omit frame IDs for frames
// or iFrames which contain chrome-extension:// URLs, even if those pages are listed in Vimium's
// web_accessible_resources in manifest.json.
async function getFrameIdsForTab(tabId) {
  // getAllFrames unfortunately excludes frames and iframes from chrome-extension:// URLs.
  // In Firefox, by contrast, pages with moz-extension:// URLs are included.
  return browserToolboxDocumentAuthority.frameIds(tabId);
}

const lifecycleRelays = new Set([
  "userIsInteractingWithThePage",
  "focusFrame",
  "getFocusStatus",
  "getScrollPosition",
  "setScrollPosition",
  "checkEnabledAfterURLChange",
  "showMessage",
]);
const lifecycleHints = new Set([
  "getHintDescriptors",
  "activateMode",
  "updateKeyState",
  "rotateHints",
  "setOpenLinkMode",
  "activateActiveHintMarker",
  "exit",
  "mouseOutOfLastClickedElement",
]);
async function sendLifecycleMessage(
  tabId,
  frameId,
  action,
  message,
  expectedPlanVersion = null,
  resolvedIdentity = null,
) {
  if (bgUtils.isFirefox()) {
    return chrome.tabs.sendMessage(tabId, {
      ...message,
      handler: action === "hints" ? "linkHintsMessage" : message.handler,
    }, { frameId });
  }
  const identity = resolvedIdentity || await browserToolboxDocumentAuthority.target(tabId, frameId);
  if (expectedPlanVersion != null && identity.planVersion !== expectedPlanVersion) {
    throw Object.assign(new Error("RUNTIME_PLAN_MISMATCH"), { code: "RUNTIME_PLAN_MISMATCH" });
  }
  return chrome.tabs.sendMessage(
    tabId,
    BrowserToolboxMessageProtocol.envelope(
      "lifecycle",
      action,
      { message },
      identity,
    ),
    { documentId: identity.documentId },
  );
}
async function invokeCompatibleCommand(entry, count, sender) {
  const descriptor = BrowserToolboxCommandDefinitions.getCommand(entry?.command);
  if (!descriptor) return { ok: false, code: "UNKNOWN_COMMAND" };
  const authority = await browserToolboxDocumentAuthority.compatible(sender);
  if (authority.component && authority.component !== "help") {
    return { ok: false, code: "PERMISSION_DENIED" };
  }
  const identity = {
    documentId: authority.documentId,
    runtimeEpoch: authority.runtimeEpoch,
    incognito: authority.incognito,
  };
  const invocation = BrowserToolboxCommandInvocation.createV2(
    entry.command,
    entry.options || {},
    { type: "keyboard" },
    {
      sourceFrameId: authority.component ? 0 : sender.frameId,
    },
    count,
    {
      countProvided: count != null,
      identity,
      confirmationGranted: descriptor.countPolicy.confirmationThreshold != null &&
        count > descriptor.countPolicy.confirmationThreshold,
    },
  );
  return browserToolboxDispatcher.dispatch(
    invocation,
    sender,
    authority,
    () => browserToolboxDocumentAuthority.verify(identity, sender),
  );
}
async function relayLifecycle(request, sender) {
  if (
    !lifecycleRelays.has(request.message?.handler) ||
    request.frameId != null && (!Number.isInteger(request.frameId) || request.frameId < 0)
  ) return { ok: false, code: "INVALID_MESSAGE_ACTION" };
  const frames = request.frameId == null
    ? await getFrameIdsForTab(sender.tab.id)
    : [request.frameId];
  await Promise.all(
    frames.map((frame) =>
      sendLifecycleMessage(sender.tab.id, frame, "relay", request.message).catch(() => {})
    ),
  );
  return { ok: true };
}

const HintCoordinator = {
  // Forward the message in "request" to all frames the in sender's tab.
  async broadcastLinkHintsMessage(request, sender) {
    if (
      !lifecycleHints.has(request.messageType) ||
      ["getHintDescriptors", "activateMode"].includes(request.messageType)
    ) return { ok: false, code: "INVALID_HINT_ACTION" };
    const frames = await getFrameIdsForTab(sender.tab.id);
    if (!frames.includes(sender.frameId)) frames.push(sender.frameId);
    await Promise.all(
      frames.map((frame) =>
        sendLifecycleMessage(sender.tab.id, frame, "hints", request).catch(() => {})
      ),
    );
    return { ok: true };
  },

  // This is sent by the content script once the user issues the link hints command.
  async prepareToActivateLinkHintsMode(
    tabId,
    originatingFrameId,
    { modeIndex, requestedByHelpDialog, isExtensionPage, interactionId, planVersion },
  ) {
    const frameIds = await getFrameIdsForTab(tabId);
    // If link hints was triggered on a Vimium extension page (like the vimium help dialog or
    // options page), we cannot directly retrieve the frameIds for those pages using the
    // getFrameIdsForTab. However, as a workaround, if those pages were the pages activating hints,
    // their frameId is equal to originatingFrameId.
    if (isExtensionPage && !frameIds.includes(originatingFrameId)) {
      frameIds.push(originatingFrameId);
    }
    const verifiedIdentities = new Map();
    if (BrowserToolboxRuntimePlans.COMPILED_CANARY) {
      const identities = await Promise.all(frameIds.map((frameId) =>
        browserToolboxDocumentAuthority.target(tabId, frameId)));
      if (identities.some((identity) => identity.planVersion !== planVersion)) {
        throw Object.assign(new Error("RUNTIME_PLAN_MISMATCH"), { code: "RUNTIME_PLAN_MISMATCH" });
      }
      // 收集阶段复用刚核验通过的同代次身份，减少重复枚举 frame IPC；激活阶段仍重新校验以捕获收集中途导航。
      frameIds.forEach((frameId, index) => verifiedIdentities.set(frameId, identities[index]));
    }
    const timeout = 3000;
    let promises = frameIds.map(async (frameId) => {
      let promise = sendLifecycleMessage(
        tabId,
        frameId,
        "hints",
        {
          handler: "linkHintsMessage",
          messageType: "getHintDescriptors",
          modeIndex,
          requestedByHelpDialog,
          interactionId,
          originatingFrameId,
        },
        BrowserToolboxRuntimePlans.COMPILED_CANARY ? planVersion : null,
        verifiedIdentities.get(frameId) || null,
      );

      promise = Utils.promiseWithTimeout(promise, timeout)
        .catch((error) => Utils.debugLog("Swallowed getHintDescriptors error:", error));

      const descriptors = await promise;

      return {
        frameId,
        descriptors,
      };
    });

    const responses = (await Promise.all(promises))
      .filter((r) => r.descriptors != null);

    const frameIdToDescriptors = {};
    for (const { frameId, descriptors } of responses) {
      frameIdToDescriptors[frameId] = descriptors;
    }

    promises = responses.map(({ frameId }) => {
      // Don't send this frame's own link hints back to it -- they're already stored in that frame's
      // content script. At the time that we wrote this, this resulted in a 150% speedup for link
      // busy sites like Reddit.
      const outgoingFrameIdToHintDescriptors = Object.assign({}, frameIdToDescriptors);
      delete outgoingFrameIdToHintDescriptors[frameId];
      return sendLifecycleMessage(
        tabId,
        frameId,
        "hints",
        {
          handler: "linkHintsMessage",
          messageType: "activateMode",
          frameId: frameId,
          originatingFrameId: originatingFrameId,
          frameIdToHintDescriptors: outgoingFrameIdToHintDescriptors,
          modeIndex: modeIndex,
          interactionId,
        },
        BrowserToolboxRuntimePlans.COMPILED_CANARY ? planVersion : null,
      ).catch((error) => {
        Utils.debugLog(
          "Swallowed linkHints activateMode error:",
          error,
          "tabId",
          tabId,
          "frameId",
          frameId,
        );
      });
    });
    await Promise.all(promises);
  },
};

function isValidGestureRequest(request, field = null) {
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(request?.requestId || "")) return false;
  if (field === "direction") return /^(?:L|R|U|D|UL|UR|DL|DR)$/.test(request.direction || "");
  if (field === "pattern") {
    return Array.isArray(request.pattern) && request.pattern.length <= 8 &&
      request.pattern.every((direction) => /^(?:L|R|U|D|UL|UR|DL|DR)$/.test(direction));
  }
  return true;
}

const GESTURE_PORT_NAME = "browserToolbox.gesture";
const GESTURE_PORT_HANDLERS = new Set([
  "browserToolbox.gestureStart",
  "browserToolbox.gestureUpdate",
  "browserToolbox.gestureFinish",
  "browserToolbox.gestureCancel",
]);

const sendRequestHandlers = {
  async "browserToolbox.message"(request, sender) {
    if (!BrowserToolboxMessageProtocol.validateEnvelope(request)) {
      return { ok: false, code: "INVALID_MESSAGE" };
    }
    try {
      if (request.kind === "lifecycle" && request.action === "initialize") {
        if (browserToolboxDocumentAuthority.role(sender) === "untrusted") {
          return { ok: false, code: "PERMISSION_DENIED" };
        }
        if (browserToolboxDocumentAuthority.role(sender) === "component") {
          await browserToolboxDocumentAuthority.component(sender);
        }
        const [plan] = await Promise.all([
          BrowserToolboxRuntimePlans.select(chrome),
          Settings.onLoaded(),
        ]);
        const session = request.payload.runtimeEpoch == null
          ? null
          : await browserToolboxDocumentAuthority.register(sender, request.payload.runtimeEpoch, plan.planVersion);
        if (!session) await browserToolboxDocumentAuthority.active(sender);
        if (request.payload.compatibleHints === true) {
          if (!BrowserToolboxRuntimePlans.COMPILED_HINTS_CANARY ||
            plan.moduleImplementations.hints !== "vimium-compat" ||
            browserToolboxDocumentAuthority.role(sender) !== "content") {
            return { ok: false, code: "PERMISSION_DENIED" };
          }
          await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
            files: ["content_scripts/browser_toolbox/compat_link_hints.js"],
            world: "ISOLATED",
          });
          await browserToolboxDocumentAuthority.active(sender);
        }
        return {
          ...await sendRequestHandlers.initializeFrame(request.payload, sender),
          ...session,
          planVersion: plan.planVersion,
        };
      }
      if (request.kind === "lifecycle" && request.action === "register") {
        return {
          ok: true,
          session: await browserToolboxDocumentAuthority.register(
            sender,
            request.payload.runtimeEpoch,
            (await BrowserToolboxRuntimePlans.select(chrome)).planVersion,
          ),
        };
      }
      if (request.kind === "lifecycle" && request.action === "unregister") {
        await browserToolboxHintsCoordinator?.releaseDocument(request.identity, sender);
        await browserToolboxDocumentAuthority.unregister(request.identity, sender);
        return { ok: true };
      }
      if (request.kind === "ui" && request.action === "claim") {
        return {
          ok: true,
          proof: await browserToolboxDocumentAuthority.claim(request.payload, sender),
        };
      }
      if (request.kind === "ui" && request.action === "finalize") {
        return {
          ok: true,
          session: await browserToolboxDocumentAuthority.finalize(request.payload, sender),
        };
      }
      if (request.kind === "ui" && request.action === "attest") {
        await browserToolboxDocumentAuthority.attest(request.payload, request.identity, sender);
        return { ok: true };
      }
      if (request.kind === "ui" && request.action === "authorize") {
        return {
          ok: true,
          grant: await browserToolboxDocumentAuthority.authorize(
            request.payload.component,
            request.payload.componentId,
            request.identity,
            sender,
          ),
        };
      }
      if (request.kind === "ui" && request.action === "submitVomnibar") {
        return await browserToolboxSubmitVomnibar(request, sender);
      }
      if (request.kind === "ui" && ["captureFocus", "restoreFocus"].includes(request.action)) {
        if (!BrowserToolboxRuntimePlans.COMPILED_UI_CANARY ||
          browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) {
          return { ok: false, code: "STALE_RUNTIME" };
        }
        browserToolboxFrameFocusService ||= new BrowserToolboxFrameFocusService({
          api: chrome, authority: browserToolboxDocumentAuthority,
          allowsPlan: (version) => BrowserToolboxRuntimePlans.allowed.some((plan) =>
            plan.planVersion === version && plan.moduleImplementations.frameFocus === "browser-toolbox"),
        });
        if (request.action === "captureFocus") {
          return { ok: true, target: await browserToolboxFrameFocusService.captureFocus(
            request.payload.frameId, request.identity, sender,
          ) };
        }
        await browserToolboxFrameFocusService.restoreFocus(request.payload.target, request.identity, sender);
        return { ok: true };
      }
      if (request.kind === "lifecycle" && request.action === "marks") {
        return await browserToolboxMarkAction(request, sender);
      }
      const authority = await browserToolboxDocumentAuthority.verify(request.identity, sender);
      if (request.kind === "ui" && request.action === "release") {
        await browserToolboxDocumentAuthority.release(
          request.payload.componentId,
          request.identity,
          sender,
        );
        return { ok: true };
      }
      if (request.kind === "command" && request.action === "invoke") {
        if (browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) {
          return { ok: false, code: "STALE_RUNTIME" };
        }
        const invocation = request.payload.invocation;
        if (
          authority.component && authority.component !== "help" ||
          invocation?.protocolVersion !== 2 || invocation.requestId !== request.requestId ||
          JSON.stringify(invocation.identity) !== JSON.stringify(request.identity)
        ) return { ok: false, code: "PERMISSION_DENIED" };
        const result = await browserToolboxDispatcher.dispatch(
          invocation,
          sender,
          authority,
          () => {
            if (browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) {
              throw Object.assign(new Error("STALE_RUNTIME"), { code: "STALE_RUNTIME" });
            }
            return browserToolboxDocumentAuthority.verify(request.identity, sender);
          },
        );
        return {
          ...result,
          requestId: request.requestId,
          documentId: request.identity.documentId,
          runtimeEpoch: request.identity.runtimeEpoch,
        };
      }
      if (request.kind === "lifecycle" && request.action === "ready") {
        return sendRequestHandlers.domReady(request.payload, sender);
      }
      if (request.kind === "lifecycle" && request.action === "relay") {
        if (authority.component && authority.component !== "help") {
          return { ok: false, code: "PERMISSION_DENIED" };
        }
        return relayLifecycle(request.payload, sender);
      }
      if (request.kind === "lifecycle" && request.action === "hints") {
        if (browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) {
          return { ok: false, code: "STALE_RUNTIME" };
        }
        if (authority.component && authority.component !== "help") {
          return { ok: false, code: "PERMISSION_DENIED" };
        }
        const input = request.payload;
        if (
          input.operation === "prepare" && Number.isInteger(input.modeIndex) &&
          input.modeIndex >= 0 && input.modeIndex <= 9 &&
          /^[a-f0-9-]{36}$/.test(input.interactionId || "")
        ) {
          if (browserToolboxOwnHintsPlan(authority.planVersion) && browserToolboxHintsCoordinator) {
            return browserToolboxHintsCoordinator.prepare(input, sender, authority);
          }
          await HintCoordinator.prepareToActivateLinkHintsMode(
            sender.tab.id,
            sender.frameId,
            { ...input, planVersion: authority.planVersion || 1 },
          );
          return { ok: true, code: "INTERACTION_OPENED" };
        }
        if (input.operation === "broadcast" && /^[a-f0-9-]{36}$/.test(input.interactionId || "")) {
          if (browserToolboxOwnHintsPlan(authority.planVersion) && browserToolboxHintsCoordinator) {
            return browserToolboxHintsCoordinator.broadcast(input, sender, authority);
          }
          return HintCoordinator.broadcastLinkHintsMessage(input, sender);
        }
        return { ok: false, code: "INVALID_HINT_ACTION" };
      }
      return { ok: false, code: "INVALID_MESSAGE_ACTION" };
    } catch (failure) {
      return { ok: false, code: failure.code || "MESSAGE_UNAVAILABLE" };
    }
  },
  async "browserToolbox.configuration"(request, sender) {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    if (!writer) return { ok: false, code: "CONFIGURATION_UNAVAILABLE" };
    const action = request.action;
    const input = request.input || {};
    const senderUrl = sender.url?.split(/[?#]/)[0];
    const editor = ["pages/mouse_options.html", "pages/options.html", "pages/action.html"]
      .some((page) => senderUrl === chrome.runtime.getURL(page)) &&
      (sender.frameId == null || sender.frameId === 0);
    const helpPreference = action === "commit" &&
      senderUrl === chrome.runtime.getURL("pages/help_dialog_page.html") &&
      input.toolbox === undefined && Object.keys(input.legacyPatch || {}).length === 1 &&
      Object.hasOwn(input.legacyPatch || {}, "helpDialog_showAdvancedCommands");
    const recoveryInspector = action === "inspect-transition-conflict" &&
      senderUrl === chrome.runtime.getURL("pages/configuration_recovery.html") &&
      (sender.frameId == null || sender.frameId === 0);
    if (action !== "read" && !editor && !helpPreference && !recoveryInspector) {
      return { ok: false, code: "PERMISSION_DENIED" };
    }
    if (action === "inspect-transition-conflict" && !recoveryInspector) {
      return { ok: false, code: "PERMISSION_DENIED" };
    }
    if (
      ["import", "list-import-backups", "export-import-backup", "preview-import-restore"]
        .includes(action) &&
      !["pages/mouse_options.html", "pages/options.html"]
        .some((page) => senderUrl === chrome.runtime.getURL(page))
    ) return { ok: false, code: "PERMISSION_DENIED" };
    if (
      ["export-import-cursor", "list-local-cursors", "read-local-cursor"].includes(action) &&
      senderUrl !== chrome.runtime.getURL("pages/mouse_options.html")
    ) return { ok: false, code: "PERMISSION_DENIED" };
    if (
      [
        "export-conflict",
        "list-conflict-observations",
        "export-conflict-observation",
        "capture-conflict-observation",
        "review-conflict-observation",
        "prepare-conflict-candidate",
        "recover-search-default-conflict",
      ].includes(action) &&
      senderUrl !== chrome.runtime.getURL("pages/mouse_options.html")
    ) return { ok: false, code: "PERMISSION_DENIED" };
    try {
      let value;
      if (action === "read") value = await writer.read(input.minimumRevision || 0);
      else if (action === "preview") value = await writer.preview();
      else if (action === "export-conflict") value = await writer.exportCompatibilityConflict();
      else if (action === "list-conflict-observations") {
        value = await writer.listCompatibilityConflictObservations();
      } else if (action === "export-conflict-observation") {
        value = await writer.exportCompatibilityConflictObservation(input.key);
      } else if (action === "capture-conflict-observation") {
        value = await writer.captureCurrentCompatibilityConflict();
      } else if (action === "review-conflict-observation") {
        value = await writer.reviewCompatibilityConflictObservation(input.key);
      } else if (action === "prepare-conflict-candidate") {
        value = await writer.prepareCompatibilityConflictCandidate(
          input.key,
          input.recordDigest,
          input.choices,
        );
      } else if (action === "recover-search-default-conflict") {
        value = await writer.recoverSearchDefaultConflict(input.key, input.recordDigest);
      } else if (action === "commit") value = await writer.commit(input);
      else if (action === "import") value = await writer.importConfiguration(input);
      else if (action === "list-import-backups") value = await writer.listImportBackups();
      else if (action === "export-import-backup") {
        value = await writer.exportImportBackup(input.key);
      } else if (action === "export-import-cursor") {
        value = await writer.exportImportBackupCursor(input.key);
      } else if (action === "list-local-cursors") {
        value = await writer.listLocalCursorAssets(input.after ?? null);
      } else if (action === "read-local-cursor") {
        value = await writer.readLocalCursorAsset(input.key);
      } else if (action === "preview-import-restore") {
        value = await writer.previewImportBackupRestore(input.key);
      } else if (action === "inspect-transition-conflict") {
        const inspector = new ReadOnlyTransitionArchive({ writer, authorize: () => false });
        value = {
          ...await inspector.inspectConflict(input.kind),
          writeAllowed: false,
          releaseAllowed: false,
          lineageVerified: false,
        };
      } else if (action === "resolve") value = await writer.resolve(input.choice);
      else if (action === "rollback") value = await writer.rollback();
      else if (action === "export") value = await writer.exportConfiguration();
      else return { ok: false, code: "INVALID_CONFIGURATION_ACTION" };
      return { ok: true, value };
    } catch (failure) {
      const result = { ok: false, code: failure.code || "INVALID_CONFIGURATION" };
      for (const key of ["conflicts", "quota", "requiredBytes", "limitBytes"]) {
        if (failure[key] != null) result[key] = failure[key];
      }
      return result;
    }
  },
  "browserToolbox.runtimeMaintenance"(request, sender) {
    return browserToolboxRuntimeMaintenance.run(request.action, sender);
  },
  async "browserToolbox.gestureStart"(request, sender) {
    if (browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) return { accepted: false };
    if (!isValidGestureRequest(request)) return { accepted: false };
    await browserToolboxSettingsRepository.ensureLoaded(globalThis.BrowserToolboxCommandRegistry);
    if (browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) return { accepted: false };
    const settings = sender.tab?.url
      ? browserToolboxSettingsRepository.getEffectiveSettings(sender.tab.url)
      : null;
    return {
      accepted: browserToolboxFrameCoordinator.start(
        sender.tab?.id,
        sender.frameId,
        request.requestId,
        settings?.mouse?.maxDurationMs,
      ),
    };
  },
  "browserToolbox.gestureUpdate"(request, sender) {
    if (!isValidGestureRequest(request, "direction")) return { accepted: false };
    return {
      accepted: browserToolboxFrameCoordinator.update(
        sender.tab?.id,
        sender.frameId,
        request.requestId,
        request.direction,
      ),
    };
  },
  "browserToolbox.gestureFinish"(request, sender) {
    if (!isValidGestureRequest(request, "pattern")) return { accepted: false };
    return {
      accepted: Boolean(
        browserToolboxFrameCoordinator.finish(sender.tab?.id, sender.frameId, request.requestId),
      ),
    };
  },
  "browserToolbox.gestureCancel"(request, sender) {
    if (!isValidGestureRequest(request)) return { accepted: false };
    browserToolboxFrameCoordinator.cancel(sender.tab?.id, request.requestId);
    return { accepted: true };
  },
  "browserToolbox.commandRegistry"() {
    return globalThis.BrowserToolboxCommandRegistry.listCommands().map((command) => {
      const copy = Object.assign({}, command);
      delete copy.details;
      return copy;
    });
  },
  async "browserToolbox.effectiveSettings"(_request, sender) {
    if (!sender?.tab?.url) return null;
    await browserToolboxSettingsRepository.ensureLoaded(globalThis.BrowserToolboxCommandRegistry);
    return browserToolboxSettingsRepository.getEffectiveSettings(sender.tab.url);
  },
  async "browserToolbox.invoke"(request, sender) {
    if (browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) {
      return globalThis.BrowserToolboxCommandInvocation.createResult(false, "STALE_RUNTIME");
    }
    if (!globalThis.BrowserToolboxMessageProtocol.isTrustedSender(sender, chrome.runtime.id)) {
      return globalThis.BrowserToolboxCommandInvocation.createResult(
        false,
        globalThis.BrowserToolboxCommandInvocation.ERROR_CODES.PERMISSION_DENIED,
      );
    }
    if (
      !globalThis.BrowserToolboxMessageProtocol.validate({
        protocolVersion: globalThis.BrowserToolboxCommandInvocation.PROTOCOL_VERSION,
        type: "browserToolbox.invoke",
        invocation: request.invocation,
      })
    ) {
      return globalThis.BrowserToolboxCommandInvocation.createResult(
        false,
        globalThis.BrowserToolboxCommandInvocation.ERROR_CODES.INVALID_OPTIONS,
      );
    }
    return browserToolboxDispatcher.dispatch(request.invocation, sender, null, () => {
      if (browserToolboxPausedRuntimeTabs.has(sender.tab?.id)) {
        throw Object.assign(new Error("STALE_RUNTIME"), { code: "STALE_RUNTIME" });
      }
    });
  },
  async "browserToolbox.consumeToolInput"(request) {
    if (
      typeof request?.token !== "string" || typeof request?.toolId !== "string" ||
      request.token.length > 128 || request.toolId.length > 64 ||
      (request.source != null &&
        !globalThis.BrowserToolboxToolContract.SOURCES.includes(request.source))
    ) return null;
    return browserToolboxToolInputTokenStore.consume(
      request.token,
      request.toolId,
      request.source ?? null,
    );
  },
  async runBackgroundCommand(request, sender) {
    if (bgUtils.isFirefox()) {
      return BackgroundCommands[request.registryEntry.command](request, sender);
    }
    return invokeCompatibleCommand(request.registryEntry, request.count, sender);
  },
  // getCurrentTabUrl is used by the content scripts to get their full URL, because window.location
  // cannot help with Chrome-specific URLs like "view-source:http:..".
  getCurrentTabUrl({ tab }) {
    return tab.url;
  },
  openUrlInNewTab: createRepeatCommand(async (request, callback) => {
    await TabOperations.openUrlInNewTab(request, callback);
  }),
  async openUrlInNewWindow(request) {
    await TabOperations.openUrlInNewWindow(request);
  },
  async openUrlInIncognito(request) {
    await chrome.windows.create({
      incognito: true,
      url: await UrlUtils.convertToUrl(request.url),
    });
  },
  openUrlInCurrentTab: TabOperations.openUrlInCurrentTab,
  openOptionsPageInNewTab(request) {
    return chrome.tabs.create({
      url: chrome.runtime.getURL("pages/options.html"),
      index: request.tab.index + 1,
    });
  },

  async launchSearchQuery({ query, openInNewTab, executionGuard }) {
    const disposition = openInNewTab ? "NEW_TAB" : "CURRENT_TAB";
    if (executionGuard) await executionGuard();
    await chrome.search.query({ disposition, text: query });
  },

  domReady(_, sender) {
    const isTopFrame = sender.frameId == 0;
    if (!isTopFrame) return;
    const tabId = sender.tab.id;
    // The only feature that uses tabLoadedHandlers is marks.
    if (tabLoadedHandlers[tabId]) tabLoadedHandlers[tabId]();
    delete tabLoadedHandlers[tabId];
  },

  nextFrame: BackgroundCommands.nextFrame,
  selectSpecificTab,
  createMark: marks.create,
  gotoMark: marks.goto,
  // Send a message to all frames in the current tab. If request.frameId is provided, then send
  // messages to only the frame with that ID.
  async sendMessageToFrames(request, sender) {
    if (bgUtils.isFirefox()) {
      return chrome.tabs.sendMessage(
        sender.tab.id,
        request.message,
        request.frameId == null ? {} : { frameId: request.frameId },
      );
    }
    if (request.message?.handler === "runInTopFrame") {
      return invokeCompatibleCommand(request.message.registryEntry, 1, sender);
    }
    await browserToolboxDocumentAuthority.compatible(sender);
    return relayLifecycle(request, sender);
  },
  async broadcastLinkHintsMessage(request, sender) {
    if (!bgUtils.isFirefox()) await browserToolboxDocumentAuthority.compatible(sender);
    return HintCoordinator.broadcastLinkHintsMessage(request, sender);
  },
  async prepareToActivateLinkHintsMode(request, sender) {
    if (!bgUtils.isFirefox()) await browserToolboxDocumentAuthority.compatible(sender);
    return HintCoordinator.prepareToActivateLinkHintsMode(sender.tab.id, sender.frameId, request);
  },

  async initializeFrame(request, sender) {
    // Check whether the extension is enabled for the top frame's URL, rather than the URL of the
    // specific frame that sent this request.
    const enabledState = exclusions.isEnabledForUrl(sender.tab.url);

    const isTopFrame = sender.frameId == 0;
    if (isTopFrame) {
      let whichIcon;
      if (!enabledState.isEnabledForUrl) {
        whichIcon = "disabled";
      } else if (enabledState.passKeys.length > 0) {
        whichIcon = "partial";
      } else {
        whichIcon = "enabled";
      }

      let iconSet = {
        "enabled": {
          "16": "../icons/action_enabled_16.png",
          "32": "../icons/action_enabled_32.png",
        },
        "partial": {
          "16": "../icons/action_partial_16.png",
          "32": "../icons/action_partial_32.png",
        },
        "disabled": {
          "16": "../icons/action_disabled_16.png",
          "32": "../icons/action_disabled_32.png",
        },
      };

      if (bgUtils.isFirefox()) {
        // Only Firefox supports SVG icons.
        iconSet = {
          "enabled": "../icons/action_enabled.svg",
          "partial": "../icons/action_partial.svg",
          "disabled": "../icons/action_disabled.svg",
        };
      }

      chrome.action.setIcon({ path: iconSet[whichIcon], tabId: sender.tab.id });
    }

    const response = Object.assign({
      isFirefox: bgUtils.isFirefox(),
      firefoxVersion: await bgUtils.getFirefoxVersion(),
      frameId: sender.frameId,
      // 身份只由浏览器 sender 提供；旧入口仍保留原有字段与语义。
      documentId: sender.documentId ?? null,
      tabId: sender.tab.id,
      documentLifecycle: sender.documentLifecycle ?? "active",
      incognito: sender.tab.incognito === true,
    }, enabledState);

    return response;
  },

  async getBrowserInfo() {
    return {
      isFirefox: bgUtils.isFirefox(),
      firefoxVersion: await bgUtils.getFirefoxVersion(),
    };
  },

  async filterCompletions(request, sender, verifiedComponent = null) {
    // 入口未提前提供 component 快照时才尝试 warmSession 预命中；已有 verifiedComponent 时直接进入会话解析避免重复扫表。
    const warm = !verifiedComponent && BrowserToolboxRuntimePlans.COMPILED_VOMNIBAR_CANARY &&
      !browserToolboxDocumentAuthority.writingDocuments &&
      browserToolboxDocumentAuthority.role(sender) === "component"
      ? browserToolboxCompletionHub?.warmSession(sender, browserToolboxDocumentAuthority.cachedDocuments)
      : null;
    const own = warm ||
      await browserToolboxCompletionSession(sender, verifiedComponent).catch(() => ({ denied: true }));
    if (own?.denied) return { ok: false, code: "UI_NOT_AUTHORIZED" };
    if (own) {
      try {
        const response = await own.session.filter(request);
        let current;
        if (own.session.lastFilterWarm) {
          // 热查询后优先读取已同步维护的内存文档快照，仅在缓存失效时才等待 records() 异步读取。
          const documents = browserToolboxDocumentAuthority.cachedDocuments ||
            await browserToolboxDocumentAuthority.records();
          const matched = documents.find((item) =>
            item.documentId === sender.documentId && item.tabId === sender.tab?.id && item.component
          );
          current = matched && browserToolboxCompletionHub.ownerPresent(matched, documents)
            ? matched
            : null;
        } else {
          current = await browserToolboxDocumentAuthority.component(sender);
        }
        if (!current || !sameCompletionOwner(own.record, current)) {
          return { ok: false, code: "STALE_COMPLETIONS_OWNER" };
        }
        return response;
      } catch (_) { return { ok: false, code: "COMPLETIONS_UNAVAILABLE" }; }
    }
    const completer = completers[request.completerName];
    let response = await completer.filter(request);

    // NOTE(smblott): response contains `relevancyFunction` (function) properties which cause
    // postMessage, below, to fail in Firefox. See #2576. We cannot simply delete these methods,
    // as they're needed elsewhere. Converting the response to JSON and back is a quick and easy
    // way to sanitize the object.
    response = JSON.parse(JSON.stringify(response));

    return response;
  },

  async refreshCompletions(request, sender, verifiedComponent = null) {
    const own = await browserToolboxCompletionSession(sender, verifiedComponent).catch(() => ({ denied: true }));
    if (own?.denied) return { ok: false, code: "UI_NOT_AUTHORIZED" };
    if (own) {
      try { await own.session.refresh(request.completerName); return { ok: true }; }
      catch (_) { return { ok: false, code: "COMPLETIONS_UNAVAILABLE" }; }
    }
    const completer = completers[request.completerName];
    completer.refresh();
  },

  async cancelCompletions(request, sender, verifiedComponent = null) {
    const own = await browserToolboxCompletionSession(sender, verifiedComponent).catch(() => ({ denied: true }));
    if (own?.denied) return { ok: false, code: "UI_NOT_AUTHORIZED" };
    if (own) return own.session.cancel();
    const completer = completers[request.completerName];
    completer.cancel();
  },
};

// 手势 Port 只接受固定的四类消息，并在连接断开时清理对应的 Service Worker 会话。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== GESTURE_PORT_NAME) return;
  const sender = port.sender || {};
  if (!globalThis.BrowserToolboxMessageProtocol.isTrustedSender(sender, chrome.runtime.id)) {
    port.disconnect();
    return;
  }
  let requestId = null;
  let disconnected = false;
  let messageQueue = Promise.resolve();

  const postResult = (result) => {
    if (disconnected) return;
    try {
      port.postMessage(result || { accepted: false });
    } catch (_) {
      // Port 可能刚好在异步处理期间断开；onDisconnect 会负责清理会话。
    }
  };

  const handleGesturePortMessage = async (request) => {
    if (!GESTURE_PORT_HANDLERS.has(request?.handler)) return;
    if (!bgUtils.isFirefox() && browserToolboxDocumentAuthority.role(sender) === "component") {
      try {
        if ((await browserToolboxDocumentAuthority.component(sender)).component !== "help") {
          throw new Error("PERMISSION_DENIED");
        }
      } catch (_) {
        postResult({ accepted: false, code: "UI_NOT_AUTHORIZED" });
        return;
      }
    }
    if (request.handler === "browserToolbox.gestureStart") {
      if (requestId || !isValidGestureRequest(request)) {
        postResult({ accepted: false });
        return;
      }
      requestId = request.requestId;
      const result = await sendRequestHandlers[request.handler](request, sender);
      if (disconnected) {
        browserToolboxFrameCoordinator.cancel(sender.tab?.id, requestId);
        requestId = null;
        return;
      }
      if (result?.accepted !== true) requestId = null;
      postResult(result);
      return;
    }

    if (!requestId || request.requestId !== requestId) {
      postResult({ accepted: false });
      return;
    }
    const result = await sendRequestHandlers[request.handler](request, sender);
    if (
      request.handler === "browserToolbox.gestureFinish" ||
      request.handler === "browserToolbox.gestureCancel"
    ) requestId = null;
    postResult(result);
  };

  port.onMessage.addListener((request) => {
    // 启动需要异步读取配置；串行处理可以避免 update 抢在 start 建立会话前执行。
    messageQueue = messageQueue.then(() => handleGesturePortMessage(request)).catch(() => {
      if (requestId) browserToolboxFrameCoordinator.cancel(sender.tab?.id, requestId);
      requestId = null;
      postResult({ accepted: false });
    });
  });

  port.onDisconnect.addListener(() => {
    disconnected = true;
    if (requestId) browserToolboxFrameCoordinator.cancel(sender.tab?.id, requestId);
    requestId = null;
  });
});

Utils.addChromeRuntimeOnMessageListener(
  Object.keys(sendRequestHandlers),
  async function (request, sender) {
    if (!globalThis.BrowserToolboxMessageProtocol.isTrustedSender(sender, chrome.runtime.id)) {
      return;
    }
    let verifiedComponent = null;
    if (
      !bgUtils.isFirefox() && browserToolboxDocumentAuthority.role(sender) === "component" &&
      request.handler !== "browserToolbox.message" && request.handler !== "getBrowserInfo"
    ) {
      try {
        const warm = request.handler === "filterCompletions" &&
          BrowserToolboxRuntimePlans.COMPILED_VOMNIBAR_CANARY &&
          !browserToolboxDocumentAuthority.writingDocuments &&
          !browserToolboxPausedRuntimeTabs.has(sender.tab?.id)
          ? browserToolboxCompletionHub?.warmSession(sender, browserToolboxDocumentAuthority.cachedDocuments)
          : null;
        const component = warm
          ? warm.record
          : await browserToolboxDocumentAuthority.component(sender);
        verifiedComponent = component;
        const actions = {
          hud: ["browserToolbox.configuration"],
          vomnibar: [
            "browserToolbox.configuration",
            "filterCompletions",
            "cancelCompletions",
            "refreshCompletions",
            "selectSpecificTab",
            "openUrlInNewTab",
            "openUrlInCurrentTab",
            "launchSearchQuery",
          ],
          help: [
            "browserToolbox.configuration",
            "browserToolbox.commandRegistry",
            "browserToolbox.effectiveSettings",
            "browserToolbox.invoke",
            "initializeFrame",
            "domReady",
            "getCurrentTabUrl",
            "runBackgroundCommand",
            "sendMessageToFrames",
            "openOptionsPageInNewTab",
            "prepareToActivateLinkHintsMode",
            "linkHintsMessage",
            "openUrlInNewTab",
            "openUrlInCurrentTab",
            "openUrlInIncognito",
            "selectSpecificTab",
          ],
        }[component.component];
        if (!actions?.includes(request.handler)) return { ok: false, code: "PERMISSION_DENIED" };
      } catch (_) {
        return { ok: false, code: "UI_NOT_AUTHORIZED" };
      }
    }
    Utils.debugLog(
      "main.js: onMessage:%ourl:%otab:%oframe:%o",
      request.handler,
      sender.url?.replace(/https?:\/\//, ""),
      sender.tab?.id,
      sender.frameId,
      // request // Often useful for debugging.
    );
    // NOTE(philc): We expect all messages to come from a content script in a tab. I've observed in
    // Firefox when the extension is first installed, domReady and initializeFrame messages come from
    // content scripts in about:blank URLs, which have a null sender.tab. I don't know what this
    // corresponds to. Since we expect a valid sender.tab, ignore those messages.
    if (
      sender.tab == null &&
      ![
        "browserToolbox.invoke",
        "browserToolbox.commandRegistry",
        "browserToolbox.runtimeMaintenance",
        "browserToolbox.configuration",
        "browserToolbox.message",
      ].includes(request.handler)
    ) return;
    if (
      [
        "browserToolbox.configuration",
        "browserToolbox.runtimeMaintenance",
        "browserToolbox.message",
      ].includes(
        request.handler,
      )
    ) {
      return sendRequestHandlers[request.handler](request, sender);
    }
    await Settings.onLoaded();
    if (BrowserToolboxRuntimePlans.COMPILED_MARKS_CANARY &&
      ["createMark", "gotoMark"].includes(request.handler)) {
      try {
        const authority = await browserToolboxDocumentAuthority.compatible(sender);
        if (BrowserToolboxRuntimePlans.allowed.some((plan) =>
          plan.planVersion === authority.planVersion && plan.moduleImplementations.marks === "browser-toolbox")) {
          return { ok: false, code: "PERMISSION_DENIED" };
        }
      } catch (error) {
        return { ok: false, code: error.code || "STALE_RUNTIME" };
      }
    }
    request = Object.assign({ count: 1 }, request, {
      tab: sender.tab,
      tabId: sender.tab?.id,
    });
    const handler = sendRequestHandlers[request.handler];
    const result = handler ? await handler(request, sender, verifiedComponent) : null;
    return result;
  },
);

// Remove chrome.storage.local/findModeRawQueryListIncognito if there are no remaining
// incognito-mode windows. Since the common case is that there are none to begin with, we first
// check whether the key is set at all.
chrome.tabs.onRemoved.addListener(function (tabId) {
  browserToolboxCompletionHub?.clearTab(tabId);
  browserToolboxHintsCoordinator?.cancelTab(tabId).catch(() => {});
  browserToolboxDocumentAuthority.clearTab(tabId).catch(() => {});
  browserToolboxFrameCoordinator.clearTab(tabId);
  if (tabLoadedHandlers[tabId]) {
    delete tabLoadedHandlers[tabId];
  }
  chrome.storage.session.get("findModeRawQueryListIncognito", function (items) {
    if (items.findModeRawQueryListIncognito) {
      return chrome.windows != null
        ? chrome.windows.getAll(null, function (windows) {
          for (const window of windows) {
            if (window.incognito) return;
          }
          // There are no remaining incognito-mode tabs, and findModeRawQueryListIncognito is set.
          return chrome.storage.session.remove("findModeRawQueryListIncognito");
        })
        : undefined;
    }
  });
});

// Convenience function for development use.
globalThis.runTests = () => open(chrome.runtime.getURL("tests/dom_tests/dom_tests.html"));

//
// Begin initialization.
//

// True if the major version of Vimium has changed.
// - previousVersion: this will be null for new installs.
function majorVersionHasIncreased(previousVersion) {
  const currentVersion = Utils.getCurrentVersion();
  if (previousVersion == null) return false;
  const currentMajorVersion = currentVersion.split(".").slice(0, 2).join(".");
  const previousMajorVersion = previousVersion.split(".").slice(0, 2).join(".");
  return Utils.compareVersions(currentMajorVersion, previousMajorVersion) == 1;
}

async function injectContentScriptsAndCSSIntoExistingTabs() {
  const manifest = chrome.runtime.getManifest();
  const contentScriptConfig = manifest.content_scripts[0];
  const contentScripts = contentScriptConfig.js;
  const cssFiles = contentScriptConfig.css;

  // The scripting.executeScript and scripting.insertCSS APIs can fail if we don't have permissions
  // to run scripts in a given tab. Examples are: chrome:// URLs, file:// pages (if the user hasn't
  // granted Vimium access to file URLs), and probably incognito tabs (unconfirmed). Calling these
  // APIs on such tabs results in an error getting logged on the background page. To avoid this
  // noise, we swallow the failures. We could instead try to determine if the tab is scriptable by
  // checking its URL scheme before calling these APIs, but that approach has some nuance to it.
  // This is simpler.
  const swallowError = (_) => {};

  const tabs = await chrome.tabs.query({ status: "complete" });
  for (const tab of tabs) {
    const target = { tabId: tab.id, allFrames: true };

    // Inject all of our content javascripts.
    chrome.scripting.executeScript({
      files: contentScripts,
      target: target,
    }).catch(swallowError);

    // Inject our extension's CSS.
    chrome.scripting.insertCSS({
      files: cssFiles,
      target: target,
    }).catch(swallowError);

    // Inject the user's link hint CSS.
    chrome.scripting.insertCSS({
      css: Settings.get("userDefinedLinkHintCss"),
      target: target,
    }).catch(swallowError);
  }
}

let browserToolboxInitializationPromise = null;

function initializeExtension() {
  if (browserToolboxInitializationPromise) return browserToolboxInitializationPromise;
  const run = (async () => {
    await Settings.onLoaded();
    await browserToolboxSettingsRepository.ensureLoaded(globalThis.BrowserToolboxCommandRegistry);
    try {
      await browserToolboxToolInputTokenStore.cleanup();
    } catch (_) {
      // session storage 暂时不可用时不阻断既有 Vimium 能力；后续启动会再次清理。
    }
    await Commands.init();
    await browserToolboxToolContextMenuManager.reconcile(
      browserToolboxSettingsRepository.getSettings(),
    );
  })();
  const promise = run.finally(() => {
    if (browserToolboxInitializationPromise === promise) browserToolboxInitializationPromise = null;
  });
  browserToolboxInitializationPromise = promise;
  return promise;
}

/**
 * 处理新标签页事件：先确认目标是浏览器原生新标签页，再加载配置并导航，避免误改普通网页。
 * @param {Object} tab 新建或更新后的标签页快照。
 * @returns {Promise<void>} 处理完成。
 */
async function redirectBrowserToolboxNewTab(tab) {
  let currentTab = tab;
  if (tab?.incognito === true) return;
  if (!globalThis.BrowserToolboxBrowserStartup.isNewTabTab(currentTab)) {
    if (
      tab?.url ||
      tab?.pendingUrl ||
      !Number.isInteger(tab?.id) ||
      typeof chrome.tabs.get !== "function"
    ) return;
    try {
      currentTab = await chrome.tabs.get(tab.id);
    } catch (_) {
      return;
    }
  }
  if (!globalThis.BrowserToolboxBrowserStartup.isNewTabTab(currentTab)) return;

  await initializeExtension();
  const settings = browserToolboxSettingsRepository.getSettings();
  if (!settings.browserStartup?.newTabEnabled) return;

  const result = await browserToolboxStartupNavigator.redirectNewTab(currentTab, settings);
  if (result.redirected) {
    Utils.debugLog(`新标签页已跳转：${result.url}`);
  }
}

if (chrome.tabs.onCreated?.addListener) {
  chrome.tabs.onCreated.addListener((tab) => {
    redirectBrowserToolboxNewTab(tab).catch((error) => {
      Utils.debugLog(`新标签页导航失败：${error?.message || error}`);
    });
  });
}

if (chrome.tabs.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!globalThis.BrowserToolboxBrowserStartup.isNewTabUrl(changeInfo?.url)) return;
    redirectBrowserToolboxNewTab({ ...tab, id: tabId, url: changeInfo.url }).catch((error) => {
      Utils.debugLog(`新标签页更新导航失败：${error?.message || error}`);
    });
  });
}

if (chrome.tabs.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    browserToolboxStartupNavigator.forgetNewTab(tabId);
  });
}

// The browser may have tabs already open. We inject the content scripts and Vimium's CSS
// immediately so that the extension is running on the pages immediately after install, rather than
// having to reload those pages.
chrome.runtime.onInstalled.addListener(async (details) => {
  Utils.debugLog("chrome.runtime.onInstalled");

  // NOTE(philc): In my testing, when the onInstalled event occurs, the onStartup event does not
  // also occur, so we need to initialize Vimium here.
  await initializeExtension();

  // 仅首次安装展示可操作的入门指引，更新和浏览器重启不打断用户。
  if (details.reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("pages/onboarding.html") });
  }

  const shouldInjectContentScripts =
    // NOTE(philc): 2023-06-16: we do not install the content scripts in all tabs on Firefox.
    // I believe this is because Firefox does this already. See https://stackoverflow.com/a/37132144
    // for commentary.
    !bgUtils.isFirefox() &&
    (["chrome_update", "shared_module_update"].includes(details.reason));
  if (shouldInjectContentScripts) injectContentScriptsAndCSSIntoExistingTabs();
});

// Note that this event is not fired when an incognito profile is started.
chrome.runtime.onStartup.addListener(async () => {
  Utils.debugLog("chrome.runtime.onStartup");
  await initializeExtension();
  try {
    await browserToolboxStartupNavigator.openConfiguredPage(
      browserToolboxSettingsRepository.getSettings(),
    );
  } catch (error) {
    // 启动导航失败时不影响 Vimium 和工具箱的其他后台能力。
    Utils.debugLog(`浏览器启动导航失败：${error?.message || error}`);
  }
});

Object.assign(globalThis, {
  TabOperations,
  // Exported for tests:
  HintCoordinator,
  BackgroundCommands,
  majorVersionHasIncreased,
  nextZoomLevel,
  browserToolboxDispatcher,
  browserToolboxSettingsRepository,
  browserToolboxFrameCoordinator,
  browserToolboxStartupNavigator,
  browserToolboxSubmitVomnibar,
});

// The chrome.runtime.onStartup and onInstalled events are not fired when disabling and then
// re-enabling the extension in developer mode, so we also initialize the extension here.
initializeExtension();
