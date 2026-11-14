// SPDX-License-Identifier: GPL-3.0-or-later
// 仅提示 Canary 加载；旧算法保留在本地包内，兼容引擎准备时同步安装。
(function () {
  let loading;
  globalThis.BrowserToolboxLoadCompatibleHints = async () => {
    if (globalThis.LocalHints?.getLocalHints) return;
    if (!loading) {
      loading = (async () => {
        if (location.protocol.endsWith("extension:")) {
          await import(
            chrome.runtime.getURL("content_scripts/browser_toolbox/compat_link_hints.js")
          );
        } else {
          const host = BrowserToolboxRuntimeHostInstance;
          const response = await chrome.runtime.sendMessage(
            BrowserToolboxMessageProtocol.envelope("lifecycle", "initialize", {
              runtimeEpoch: host.runtimeEpoch + (host.engine ? 0 : 1),
              compatibleHints: true,
            }),
          );
          const selected = BrowserToolboxRuntimePlans.allowed.find((plan) =>
            plan.planVersion === response?.planVersion
          );
          if (selected?.moduleImplementations.hints !== "vimium-compat") {
            throw new Error("COMPAT_HINTS_UNAVAILABLE");
          }
        }
        if (!globalThis.LocalHints?.getLocalHints) throw new Error("COMPAT_HINTS_UNAVAILABLE");
      })().catch((error) => {
        loading = null;
        throw error;
      });
    }
    return loading;
  };
  const current = () => globalThis.BrowserToolboxHintsControllerInstance;
  const activate = (name, count, index, options) => {
    const controller = current();
    if (controller) return controller.activate(count, index);
    const compatible = globalThis.LinkHints;
    if (compatible !== LinkHints) return compatible?.[name](count, options);
  };
  const LinkHints = {
    activateMode(count, options = {}) {
      const index =
        ({ "copy-text": 7, hover: 8, focus: 9 })[options.registryEntry?.options?.action] ??
          options.mode?.modeIndex ?? 0;
      return activate("activateMode", count, index, options);
    },
    activateModeToOpenInNewTab: (count) => activate("activateModeToOpenInNewTab", count, 1),
    activateModeToOpenInNewForegroundTab: (count) =>
      activate("activateModeToOpenInNewForegroundTab", count, 2),
    activateModeWithQueue: () => activate("activateModeWithQueue", 1, 3),
    activateModeToCopyLinkUrl: (count) => activate("activateModeToCopyLinkUrl", count, 4),
    activateModeToOpenIncognito: (count) => activate("activateModeToOpenIncognito", count, 5),
    activateModeToDownloadLink: (count) => activate("activateModeToDownloadLink", count, 6),
  };
  const HintCoordinator = {};
  for (
    const name of [
      "prepareToActivateMode",
      "getHintDescriptors",
      "activateMode",
      "willHandleMessage",
      "updateKeyState",
      "rotateHints",
      "setOpenLinkMode",
      "activateActiveHintMarker",
      "getLocalHint",
      "exit",
      "mouseOutOfLastClickedElement",
    ]
  ) {
    HintCoordinator[name] = (...args) => {
      const controller = current();
      if (controller) return controller[name](...args);
      const compatible = globalThis.HintCoordinator;
      if (compatible !== HintCoordinator) return compatible?.[name](...args);
    };
  }
  for (
    const name of [
      "localHints",
      "linkHintsMode",
      "runtimeInteractionId",
      "lastClickedElementRef",
      "cacheAllKeydownEvents",
    ]
  ) {
    Object.defineProperty(HintCoordinator, name, {
      get: () =>
        current()?.[name] ??
          (globalThis.HintCoordinator !== HintCoordinator
            ? globalThis.HintCoordinator?.[name]
            : undefined),
    });
  }
  Object.assign(globalThis, { LinkHints, HintCoordinator });
})();
