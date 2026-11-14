import "../lib/chrome_api_stubs.js";
import "../lib/utils.js";
import "../lib/dom_utils.js";
import "../lib/browser_toolbox/configuration_client.js";
import "../lib/settings.js";
import "../lib/keyboard_utils.js";
import "../lib/find_mode_history.js";
import "../lib/browser_toolbox/runtime_plan.js";
import "../lib/browser_toolbox/theme.js";
import * as UIComponentMessenger from "./ui_component_messenger.js";

let findMode = null;
let pendingFindKey = null;
let findHistory = FindModeHistory;
let historyReady;
let independentHud = null;
let independentHudReady;
const usesOwnModule = (name) =>
  BrowserToolboxRuntimePlans.allowed.some((plan) =>
    plan.planVersion === BrowserToolboxUIAuthorization.session?.planVersion &&
    plan.moduleImplementations[name] === "browser-toolbox"
  );
export const usesIndependentFind = () => usesOwnModule("find");
async function prepareIndependentHud() {
  independentHudReady ||= import("./browser_toolbox/hud_controller.js").then(({ HudController }) =>
    independentHud = new HudController({ post: UIComponentMessenger.postMessage }));
  return independentHudReady;
}
async function prepareFindHistory() {
  await BrowserToolboxUIAuthorization.ready;
  if (usesOwnModule("ui")) return;
  if (usesIndependentFind()) {
    await import("../lib/browser_toolbox/find_history.js");
    findHistory = new BrowserToolboxFindHistory();
    globalThis.addEventListener("pagehide", () => findHistory.destroy(), { once: true });
  }
  await findHistory.init();
}

// Chrome creates a unique port for each MessageChannel, so there's a race condition between
// JavaScript messages of Vimium and browser messages during style recomputation. This duration was
// determined empirically. See https://github.com/philc/vimium/pull/3277#discussion_r283080348
const TIME_TO_WAIT_FOR_IPC_MESSAGES = 17;

// Set the input element's text, and move the cursor to the end.
function setTextInInputElement(inputEl, text) {
  inputEl.textContent = text;
  // Move the cursor to the end. Based on one of the solutions here:
  // http://stackoverflow.com/questions/1125292/how-to-move-cursor-to-end-of-contenteditable-entity
  const range = document.createRange();
  range.selectNodeContents(inputEl);
  range.collapse(false);
  const selection = globalThis.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function onKeyEvent(event) {
  if (independentHud) return independentHud.key(event);
  if (event.isComposing || event.keyCode === 229) return;
  // Handle <Enter> on "keypress", and other events on "keydown"; this avoids interence with CJK
  // translation (see #2915 and #2934).
  let rawQuery;
  if ((event.type === "keypress") && (event.key !== "Enter")) {
    return null;
  }
  if ((event.type === "keydown") && (event.key === "Enter")) {
    return null;
  }

  const inputEl = document.querySelector("#hud-find-input");
  // Don't do anything if we're not in find mode.
  if (inputEl == null) return;

  if (
    (KeyboardUtils.isBackspace(event) && (inputEl.textContent.length === 0)) ||
    (event.key === "Enter") || KeyboardUtils.isEscape(event)
  ) {
    inputEl.blur();
    pendingFindKey = { key: event.key, findSessionId: findMode.sessionId };
    UIComponentMessenger.postMessage({
      name: "hideFindMode",
      exitEventIsEnter: event.key === "Enter",
      exitEventIsEscape: KeyboardUtils.isEscape(event),
      findSessionId: findMode.sessionId,
      exitKey: event.key,
    });
  } else if (event.key === "ArrowUp") {
    if (rawQuery = findHistory.getQuery(findMode.historyIndex + 1)) {
      findMode.historyIndex += 1;
      if (findMode.historyIndex === 0) {
        findMode.partialQuery = findMode.rawQuery;
      }
      setTextInInputElement(inputEl, rawQuery);
      findMode.executeQuery();
    }
  } else if (event.key === "ArrowDown") {
    findMode.historyIndex = Math.max(-1, findMode.historyIndex - 1);
    rawQuery = 0 <= findMode.historyIndex
      ? findHistory.getQuery(findMode.historyIndex)
      : findMode.partialQuery;
    setTextInInputElement(inputEl, rawQuery);
    findMode.executeQuery();
  } else {
    return;
  }

  DomUtils.suppressEvent(event);
  return false;
}

export function onFindKeyup(event) {
  if (independentHud) return independentHud.keyup(event);
  if (!pendingFindKey || event.key !== pendingFindKey.key) return;
  UIComponentMessenger.postMessage({ name: "findKeyReleased", ...pendingFindKey });
  pendingFindKey = null;
}

const clipboardJobs = new Map();
let clipboardRevision = 0;

function cancelClipboardJobs() {
  clipboardRevision++;
  for (const job of clipboardJobs.values()) {
    clearTimeout(job.timer);
    job.resolveWait?.(false);
  }
}

function waitClipboard(job, delay, fallback) {
  return new Promise((resolve) => {
    job.resolveWait = (value) => {
      clearTimeout(job.timer);
      job.removeFocusListener?.();
      job.removeFocusListener = null;
      job.timer = job.resolveWait = null;
      resolve(value);
    };
    job.timer = setTimeout(() => job.resolveWait?.(fallback), delay);
  });
}

function waitClipboardFocus(job, delay) {
  if (document.hasFocus()) return Promise.resolve(true);
  if (delay <= 0) return Promise.resolve(false);
  const waiting = waitClipboard(job, delay, false);
  const check = () => {
    if (document.hasFocus()) job.resolveWait?.(true);
  };
  globalThis.addEventListener("focus", check, true);
  job.removeFocusListener = () => globalThis.removeEventListener("focus", check, true);
  check();
  return waiting;
}

// Navigator.clipboard is only available in secure contexts. Show a warning when clipboard actions
// fail on non-HTTPS sites. See #4572.
function ensureClipboardIsAvailable() {
  if (!navigator.clipboard) {
    UIComponentMessenger.postMessage({ name: "showClipboardUnavailableMessage" });
    return false;
  }
  return true;
}

async function performLegacyClipboard(message, kind = "copy") {
  const id = kind === "visual" ? message.copyRequestId : message.clipboardRequestId;
  if (
    typeof id !== "string" || clipboardJobs.has(id) ||
    kind !== "paste" && typeof message.data !== "string"
  ) return;
  const session = BrowserToolboxUIAuthorization.session;
  const job = { revision: clipboardRevision };
  clipboardJobs.set(id, job);
  let closed = false, ok = false, focusGranted = false, value;
  const onHide = () => {
    closed = true;
    clearTimeout(job.timer);
    job.resolveWait?.(false);
  };
  globalThis.addEventListener("pagehide", onHide, { once: true });
  try {
    if (kind === "visual" ? !navigator.clipboard : !ensureClipboardIsAvailable()) return;
    await new Promise((resolve) => Utils.setTimeout(TIME_TO_WAIT_FOR_IPC_MESSAGES, resolve));
    if (
      closed || BrowserToolboxUIAuthorization.session !== session ||
      clipboardJobs.get(id) !== job || clipboardRevision !== job.revision
    ) return;
    // 由父框架 HUD 校验租约并聚焦 iframe，再在共享一秒期限内确认跨进程原生焦点到达，禁止子框架自聚焦抢焦。
    const focusDeadline = performance.now() + 1000;
    const focused = waitClipboard(job, 1000, false);
    job.focusPending = true;
    UIComponentMessenger.postMessage({ name: "clipboardFocus", clipboardRequestId: id });
    const allowed = await focused;
    job.focusPending = false;
    focusGranted = allowed;
    if (
      !allowed || closed || BrowserToolboxUIAuthorization.session !== session ||
      clipboardJobs.get(id) !== job || clipboardRevision !== job.revision
    ) return;
    const nativeFocused = await waitClipboardFocus(job, focusDeadline - performance.now());
    if (
      !nativeFocused || closed || BrowserToolboxUIAuthorization.session !== session ||
      clipboardJobs.get(id) !== job || clipboardRevision !== job.revision || !document.hasFocus()
    ) return;
    if (kind === "paste") value = (await navigator.clipboard.readText()).replace(/\xa0/g, " ");
    else {
      await navigator.clipboard.writeText(message.data.replace(/\xa0/g, " "));
      // writeText 在子渲染进程向 ClipboardHost 入队 CommitWrite 后即返回，而 MessageChannel 直连父渲染进程可能先于主进程消费 CommitWrite 就触发失焦拆框；保持焦点等待 IPC 落地后再归还焦点。
      await new Promise((resolve) => Utils.setTimeout(TIME_TO_WAIT_FOR_IPC_MESSAGES, resolve));
      if (
        closed || BrowserToolboxUIAuthorization.session !== session ||
        clipboardJobs.get(id) !== job || clipboardRevision !== job.revision
      ) return;
    }
    ok = true;
  } catch (_) {
    ok = false;
  } finally {
    job.resolveWait?.(false);
    clearTimeout(job.timer);
    globalThis.removeEventListener("pagehide", onHide);
    if (
      focusGranted && !closed && BrowserToolboxUIAuthorization.session === session &&
      clipboardRevision === job.revision && document.hasFocus()
    ) {
      UIComponentMessenger.postMessage({ name: "unfocusIfFocused", clipboardRequestId: id });
    }
    if (clipboardJobs.get(id) === job) clipboardJobs.delete(id);
    if (!closed && BrowserToolboxUIAuthorization.session === session) {
      // 成功、拒绝与不安全上下文都结束同一次借用，不能让隐藏 HUD 永久存活。
      UIComponentMessenger.postMessage(
        kind === "visual"
          ? { name: "copyToClipboardResult", copyRequestId: id, ok }
          : {
            name: kind === "paste" && ok ? "pasteResponse" : "clipboardComplete",
            clipboardRequestId: id,
            ...(kind === "paste" && ok ? { data: value } : {}),
            ok,
          },
      );
    }
  }
}

// Exported for unit tests.
export const handlers = {
  show(data) {
    const el = document.querySelector("#hud");
    el.textContent = data.text;
    el.classList.add("vimium-ui-component-visible");
    el.classList.remove("vimium-ui-component-hidden");
    el.classList.remove("hud-find");
  },

  hidden() {
    cancelClipboardJobs();
    const el = document.querySelector("#hud");
    // We get a flicker when the HUD later becomes visible again (with new text) unless we reset its
    // contents here.
    el.textContent = "";
    el.classList.add("vimium-ui-component-hidden");
    el.classList.remove("vimium-ui-component-visible");
  },

  showFindMode(data = {}) {
    cancelClipboardJobs();
    if (usesIndependentFind()) {
      return (historyReady ||= prepareFindHistory()).then(() => renderFindMode(data));
    }
    return renderFindMode(data);
  },

  updateMatchesCount({ matchCount, showMatchText }) {
    const countEl = document.querySelector("#hud-match-count");
    // Don't do anything if we're not in find mode.
    if (countEl == null) return;

    if (Utils.isFirefox()) {
      document.querySelector("#hud-find-input").focus();
    }
    const countText = matchCount > 0
      ? ` (${matchCount} Match${matchCount === 1 ? "" : "es"})`
      : " (No matches)";
    countEl.textContent = showMatchText ? countText : "";
  },

  copyToClipboard(message) {
    return performLegacyClipboard(message, "copy");
  },

  copyToClipboardWithResult(message) {
    if (!usesOwnModule("visual")) return Promise.resolve();
    return performLegacyClipboard(message, "visual");
  },

  pasteFromClipboard(message) {
    return performLegacyClipboard(message, "paste");
  },

  clipboardFocusResult({ clipboardRequestId, ok }) {
    const job = clipboardJobs.get(clipboardRequestId);
    if (job?.focusPending) job.resolveWait?.(ok === true);
  },
};

function init() {
  globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
  globalThis.BrowserToolboxTheme?.watchTheme?.(document);
  // Manually inject custom user styles.
  document.addEventListener("DOMContentLoaded", async () => {
    await BrowserToolboxUIAuthorization.ready;
    await Settings.onLoaded();
    await globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
    DomUtils.injectUserCss();
  });

  document.addEventListener("keydown", onKeyEvent);
  document.addEventListener("keypress", onKeyEvent);
  document.addEventListener("keyup", onFindKeyup);

  UIComponentMessenger.init();
  UIComponentMessenger.registerHandler(async function (event) {
    if (usesOwnModule("ui")) return (await prepareIndependentHud()).handle(event.data);
    await Utils.populateBrowserInfo();
    const handler = handlers[event.data.name];
    Utils.assert(handler != null, "Unrecognized message type.", event.data);
    return handler(event.data);
  });

  historyReady = prepareFindHistory();
}

function renderFindMode(data) {
  let executeQuery;
  const hudEl = document.querySelector("#hud");
  hudEl.classList.add("hud-find");

  const inputEl = document.createElement("span");
  // NOTE(mrmr1993): Chrome supports non-standard "plaintext-only", which is what we *really*
  // want.
  try {
    inputEl.contentEditable = "plaintext-only";
  } catch (error) { // Fallback to standard-compliant version.
    inputEl.contentEditable = "true";
  }
  inputEl.id = "hud-find-input";
  hudEl.appendChild(inputEl);

  inputEl.addEventListener(
    "input",
    executeQuery = function (event) {
      // On Chrome when IME is on, the order of events is:
      //   keydown, input.isComposing=true, keydown, input.true, ..., keydown, input.true, compositionend;
      // while on Firefox, the order is: keydown, input.true, ..., input.true, keydown, compositionend, input.false.
      // Therefore, check event.isComposing here, to avoid window focus changes during typing with
      // IME, since such changes will prevent normal typing on Firefox (see #3480)
      if ((Utils.isFirefox() || usesIndependentFind()) && event?.isComposing) {
        return;
      }
      // Replace \u00A0 (&nbsp;) with a normal space.
      findMode.rawQuery = inputEl.textContent.replace("\u00A0", " ");
      UIComponentMessenger.postMessage({
        name: "search",
        query: findMode.rawQuery,
        findSessionId: findMode.sessionId,
      });
    },
  );
  inputEl.addEventListener("compositionend", executeQuery);

  const countEl = document.createElement("span");
  countEl.id = "hud-match-count";
  countEl.style.float = "right";
  hudEl.appendChild(countEl);
  Utils.setTimeout(TIME_TO_WAIT_FOR_IPC_MESSAGES, function () {
    // On Firefox, the page must first be focused before the HUD input element can be focused.
    // #3460.
    if (Utils.isFirefox()) {
      globalThis.focus();
    }
    inputEl.focus();
  });

  findMode = {
    historyIndex: -1,
    partialQuery: "",
    rawQuery: "",
    executeQuery,
    sessionId: data.findSessionId,
  };
}

const testEnv = globalThis.window == null;
if (!testEnv) {
  init();
}
