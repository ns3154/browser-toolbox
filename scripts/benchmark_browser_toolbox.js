#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run
// BrowserToolbox 性能回归：测量高频输入、资源清理和常见列表规模，不上传任何数据。
import jsdom from "npm:jsdom";
import "../tests/unit_tests/test_chrome_stubs.js";
import "../lib/browser_toolbox/value_utils.js";
import "../lib/browser_toolbox/command_invocation.js";
import "../lib/browser_toolbox/message_protocol.js";
import "../content_scripts/mouse/path_sampler.js";
import "../content_scripts/mouse/direction_quantizer.js";
import "../content_scripts/mouse/gesture_session.js";
import "../content_scripts/mouse/gesture_recognizer.js";
import "../content_scripts/mouse/context_menu_guard.js";
import "../content_scripts/mouse/cursor_controller.js";
import "../content_scripts/mouse/rocker_gesture_controller.js";
import "../content_scripts/mouse/wheel_gesture_controller.js";
import "../content_scripts/mouse/frame_gesture_bridge.js";
import "../content_scripts/mouse/drag_context_classifier.js";
import "../content_scripts/mouse/super_drag_controller.js";

globalThis.isUnitTests = true;
globalThis.vimiumDomTestsAreRunning = true;

function assert(condition, message) {
  if (!condition) throw new Error(`性能回归失败：${message}`);
}

function createPort() {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    messages: [],
    disconnected: false,
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      },
    },
    postMessage(message) {
      this.messages.push(message);
    },
    disconnect() {
      if (this.disconnected) return;
      this.disconnected = true;
      for (const listener of disconnectListeners) listener();
    },
  };
}

function instrumentDocument() {
  const window = new jsdom.JSDOM("<!doctype html><html><body></body></html>").window;
  const document = window.document;
  const originalAdd = document.addEventListener.bind(document);
  const originalRemove = document.removeEventListener.bind(document);
  const listeners = new Map();
  const activeListeners = () => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  document.addEventListener = function (type, listener, options) {
    originalAdd(type, listener, options);
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  };
  document.removeEventListener = function (type, listener, options) {
    originalRemove(type, listener, options);
    listeners.get(type)?.delete(listener);
  };
  return { window, document, activeListeners };
}

function pointerEvent(overrides = {}) {
  return Object.assign({
    button: 2,
    pointerType: "mouse",
    clientX: 0,
    clientY: 0,
    timeStamp: 1000,
    preventDefault() {},
    stopPropagation() {},
  }, overrides);
}

const settings = {
  general: { enabled: true, showHud: false },
  mouse: {
    enabled: true,
    triggerButton: 2,
    activationDistancePx: 10,
    sampleDistancePx: 4,
    minimumSegmentDistancePx: 18,
    turnHysteresisDegrees: 18,
    maxSegments: 8,
    maxDurationMs: 2500,
    directionMode: "4-way",
    showTrail: true,
    showCommandHud: false,
    suppressContextMenuAfterActivation: true,
    bindings: [],
  },
  superDrag: { enabled: false, bindings: [] },
  wheel: { enabled: false, threshold: 80, cooldownMs: 180 },
  rocker: { enabled: false, bindings: [] },
  cursor: { enabled: false, localAssetId: null },
  effectiveModules: {
    keyboard: true,
    mouse: true,
    superDrag: false,
    wheel: false,
    rocker: false,
    cursor: false,
  },
};

const repositoryListeners = new Set();
globalThis.BrowserToolboxSettingsRepositoryInstance = {
  async ensureLoaded() {},
  getEffectiveSettings() {
    return settings;
  },
  addEventListener(listener) {
    repositoryListeners.add(listener);
  },
  removeEventListener(listener) {
    repositoryListeners.delete(listener);
  },
};

const firstDocument = instrumentDocument();
globalThis.window = firstDocument.window;
globalThis.document = firstDocument.document;
globalThis.MouseEvent = firstDocument.window.MouseEvent;
globalThis.HTMLElement = firstDocument.window.HTMLElement;

const ports = [];
chrome.runtime.connect = () => {
  const port = createPort();
  ports.push(port);
  return port;
};

const savedRequestAnimationFrame = globalThis.requestAnimationFrame;
let requestAnimationFrameCalls = 0;
globalThis.requestAnimationFrame = () => ++requestAnimationFrameCalls;

await import("../content_scripts/mouse/gesture_overlay.js");
await import("../content_scripts/mouse/mouse_controller.js");
await import("../pages/tab_list.js");

const metrics = {};
const controller = new BrowserToolboxMouseController(firstDocument.document);
await controller.init();

let idleDispatches = 0;
const originalPointerMove = controller.onPointerMove.bind(controller);
controller.onPointerMove = (event) => {
  idleDispatches += 1;
  return originalPointerMove(event);
};
let startedAt = performance.now();
for (let index = 0; index < 1000; index++) {
  firstDocument.document.dispatchEvent(
    new firstDocument.window.Event("pointermove", {
      bubbles: true,
      cancelable: true,
    }),
  );
}
metrics.idlePointerMoves = {
  events: idleDispatches,
  elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
  activeGesture: Boolean(controller.gesture),
  overlayCreated: Boolean(controller.overlay.host),
  requestAnimationFrameCalls,
};
assert(idleDispatches === 1000, "空闲 pointermove 事件未全部经过单一监听器");
assert(!controller.gesture && !controller.overlay.host, "空闲状态创建了手势或覆盖层");
assert(requestAnimationFrameCalls === 0, "空闲状态启动了 requestAnimationFrame 循环");

const baselineNodeCount = firstDocument.document.querySelectorAll("*").length;
startedAt = performance.now();
for (let index = 0; index < 100; index++) {
  controller.onPointerDown(pointerEvent({ timeStamp: 1000 + index }));
  controller.onPointerMove(pointerEvent({ clientX: 30, timeStamp: 1001 + index }));
  controller.cancelAll("performance");
}
const nodeCountAfterGestures = firstDocument.document.querySelectorAll("*").length;
metrics.gestureCleanup = {
  gestures: 100,
  elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
  domNodesBefore: baselineNodeCount,
  domNodesAfter: nodeCountAfterGestures,
  domNodeGrowth: nodeCountAfterGestures - baselineNodeCount,
  disconnectedPorts: ports.filter((port) => port.disconnected).length,
  activePort: Boolean(controller.bridge?.port),
  activeGesture: Boolean(controller.gesture),
  activeTimer: controller.gestureTimeoutId != null,
};
assert(metrics.gestureCleanup.domNodeGrowth <= 1, "100 次手势产生了超过一个持久覆盖层节点");
assert(metrics.gestureCleanup.disconnectedPorts === 100, "手势结束后仍有未断开的 Port");
assert(!metrics.gestureCleanup.activePort && !metrics.gestureCleanup.activeGesture);
assert(!metrics.gestureCleanup.activeTimer, "手势结束后仍有定时器引用");

controller.destroy();
const cleanupDocument = instrumentDocument();
globalThis.window = cleanupDocument.window;
globalThis.document = cleanupDocument.document;
const cleanupController = new BrowserToolboxMouseController(cleanupDocument.document);
startedAt = performance.now();
let maxActiveListeners = 0;
for (let index = 0; index < 100; index++) {
  await cleanupController.init();
  maxActiveListeners = Math.max(maxActiveListeners, cleanupDocument.activeListeners());
  cleanupController.destroy();
  assert(cleanupDocument.activeListeners() === 0, "destroy 后仍保留页面事件监听器");
}
metrics.listenerCleanup = {
  cycles: 100,
  elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
  maxActiveListeners,
  remainingListeners: cleanupDocument.activeListeners(),
  repositoryListeners: repositoryListeners.size,
};
assert(metrics.listenerCleanup.remainingListeners === 0);
assert(metrics.listenerCleanup.repositoryListeners === 0);

const wheel = new BrowserToolboxWheelGestureController();
const scrollSettings = {
  enabled: true,
  threshold: 80,
  cooldownMs: 0,
  continuousTabSwitching: true,
};
startedAt = performance.now();
for (let index = 0; index < 10000; index++) {
  wheel.handle({
    buttons: 2,
    deltaY: index % 2 === 0 ? 2 : -1,
    now: index,
    settings: scrollSettings,
  });
}
metrics.longScroll = {
  wheelEvents: 10000,
  elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
  accumulatedKeys: wheel.accumulated.size,
  cooldownKeys: wheel.lastTriggerAt.size,
};
assert(metrics.longScroll.accumulatedKeys <= 1 && metrics.longScroll.cooldownKeys <= 1);
wheel.reset();
assert(wheel.accumulated.size === 0 && wheel.lastTriggerAt.size === 0, "长页面滚动重置未清空状态");

const framePorts = [];
const frameRuntime = {
  connect() {
    const port = createPort();
    framePorts.push(port);
    return port;
  },
};
startedAt = performance.now();
for (let index = 0; index < 8; index++) {
  const bridge = new BrowserToolboxFrameGestureBridge({ runtimeApi: frameRuntime });
  bridge.start(`frame-${index}`);
  bridge.update("R");
  bridge.cancel();
}
metrics.multiFrame = {
  frames: 8,
  elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
  disconnectedPorts: framePorts.filter((port) => port.disconnected).length,
};
assert(metrics.multiFrame.disconnectedPorts === 8, "多 frame 模拟结束后仍有活动 Port");

const tabs = Array.from({ length: 50 }, (_, index) => ({
  id: index + 1,
  index,
  title: `Project ${index + 1}`,
  url: `https://example.com/project-${index + 1}`,
}));
startedAt = performance.now();
const result = BrowserToolboxTabList.filterTabs(tabs, "project 49");
metrics.tabSearch = {
  tabs: 50,
  query: "project 49",
  elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
  results: result.length,
  firstTabId: result[0]?.id ?? null,
};
assert(result.length === 1 && result[0].id === 49, "50 个标签页搜索结果不稳定");

controller.destroy();
globalThis.window = undefined;
globalThis.document = undefined;
if (savedRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
else globalThis.requestAnimationFrame = savedRequestAnimationFrame;
console.log("BrowserToolbox 性能回归通过：");
console.log(JSON.stringify(metrics, null, 2));
