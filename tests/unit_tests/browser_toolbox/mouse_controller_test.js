/**
 * 鼠标控制器启动时序测试。
 * 验证配置请求尚未返回时，首个指针事件也已经进入输入层。
 */
import "../test_helper.js";
import "../../../content_scripts/mouse/context_menu_guard.js";

const previousGlobals = new Map([
  ["BrowserToolboxCommandInvocation", globalThis.BrowserToolboxCommandInvocation],
  ["BrowserToolboxMessageProtocol", globalThis.BrowserToolboxMessageProtocol],
  ["BrowserToolboxSettingsRepositoryInstance", globalThis.BrowserToolboxSettingsRepositoryInstance],
  [
    "BrowserToolboxSettingsRuntimeClientInstance",
    globalThis.BrowserToolboxSettingsRuntimeClientInstance,
  ],
  ["BrowserToolboxGestureRecognizer", globalThis.BrowserToolboxGestureRecognizer],
  ["BrowserToolboxMouseController", globalThis.BrowserToolboxMouseController],
  ["BrowserToolboxPageExecutor", globalThis.BrowserToolboxPageExecutor],
  ["vimiumDomTestsAreRunning", globalThis.vimiumDomTestsAreRunning],
]);

let resolveSettings;
const loadingSettings = new Promise((resolve) => resolveSettings = resolve);
const runtimeSettings = {
  getSettings: () => bootstrapSettings,
  ensureLoaded: () => loadingSettings,
  addEventListener: (listener) => runtimeSettings.listeners.add(listener),
  removeEventListener: (listener) => runtimeSettings.listeners.delete(listener),
  listeners: new Set(),
};
const bootstrapSettings = {
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
    showTrail: false,
    showCommandHud: false,
    suppressContextMenuAfterActivation: true,
    bindings: [],
  },
  superDrag: { enabled: false },
  wheel: { enabled: false, bindings: [] },
  rocker: { enabled: false, bindings: [] },
  cursor: { enabled: false },
  effectiveModules: { mouse: true, superDrag: false, wheel: false, rocker: false, cursor: false },
};

globalThis.BrowserToolboxCommandInvocation = {
  ERROR_CODES: {},
  createInvocation: () => ({ requestId: "mouse-controller-test" }),
};
globalThis.BrowserToolboxMessageProtocol = { validate: () => false };
globalThis.BrowserToolboxSettingsRepositoryInstance = null;
globalThis.BrowserToolboxSettingsRuntimeClientInstance = runtimeSettings;
globalThis.BrowserToolboxGestureRecognizer = { find: () => ({ exact: null }), format: () => "" };
globalThis.vimiumDomTestsAreRunning = true;
await import("../../../content_scripts/mouse/mouse_controller.js");
const MouseController = globalThis.BrowserToolboxMouseController;

for (const [name, value] of previousGlobals) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}

class TestDocument {
  constructor() {
    this.listeners = new Map();
    this.visibilityState = "visible";
    this.defaultView = { getSelection: () => ({ toString: () => "" }) };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

class TestOverlay {
  showCancel() {}
  hide() {}
  destroy() {}
  isCancelPoint() {
    return false;
  }
}

class TestWheel {
  release() {}
  reset() {}
}

class TestRocker {
  pointerDown() {
    return null;
  }
  pointerUp() {
    return false;
  }
  cancel() {}
}

class TestCursor {
  clear() {}
}

class TestBridge {
  start() {}
  waitUntilReady() {
    return Promise.resolve(true);
  }
  cancel() {}
  finish() {}
}

class TestSession {
  constructor() {
    this.state = "IDLE";
  }

  start() {
    this.state = "PENDING";
  }

  isActive() {
    return this.state === "ACTIVE";
  }
  cancel() {
    this.state = "CANCELLED";
  }
}

context("Mouse controller", () => {
  should("install listeners before the first settings request settles", async () => {
    const globals = new Map([
      ["BrowserToolboxCommandInvocation", globalThis.BrowserToolboxCommandInvocation],
      ["BrowserToolboxMessageProtocol", globalThis.BrowserToolboxMessageProtocol],
      [
        "BrowserToolboxSettingsRepositoryInstance",
        globalThis.BrowserToolboxSettingsRepositoryInstance,
      ],
      [
        "BrowserToolboxSettingsRuntimeClientInstance",
        globalThis.BrowserToolboxSettingsRuntimeClientInstance,
      ],
      ["BrowserToolboxGestureRecognizer", globalThis.BrowserToolboxGestureRecognizer],
      ["BrowserToolboxGestureOverlay", globalThis.BrowserToolboxGestureOverlay],
      ["BrowserToolboxWheelGestureController", globalThis.BrowserToolboxWheelGestureController],
      ["BrowserToolboxRockerGestureController", globalThis.BrowserToolboxRockerGestureController],
      ["BrowserToolboxCursorController", globalThis.BrowserToolboxCursorController],
      ["BrowserToolboxFrameGestureBridge", globalThis.BrowserToolboxFrameGestureBridge],
      ["BrowserToolboxGestureSession", globalThis.BrowserToolboxGestureSession],
      ["BrowserToolboxI18n", globalThis.BrowserToolboxI18n],
      ["document", globalThis.document],
      ["location", globalThis.location],
    ]);
    const document = new TestDocument();
    const actualSettings = structuredClone(bootstrapSettings);
    globalThis.BrowserToolboxCommandInvocation = {
      ERROR_CODES: {},
      createInvocation: () => ({ requestId: "mouse-controller-test" }),
    };
    globalThis.BrowserToolboxMessageProtocol = { validate: () => false };
    globalThis.BrowserToolboxSettingsRepositoryInstance = null;
    globalThis.BrowserToolboxSettingsRuntimeClientInstance = runtimeSettings;
    globalThis.BrowserToolboxGestureRecognizer = {
      find: () => ({ exact: null }),
      format: () => "",
    };
    globalThis.BrowserToolboxGestureOverlay = TestOverlay;
    globalThis.BrowserToolboxWheelGestureController = TestWheel;
    globalThis.BrowserToolboxRockerGestureController = TestRocker;
    globalThis.BrowserToolboxCursorController = TestCursor;
    globalThis.BrowserToolboxFrameGestureBridge = TestBridge;
    globalThis.BrowserToolboxGestureSession = TestSession;
    globalThis.BrowserToolboxI18n = { hasMessage: () => false };
    globalThis.document = document;
    globalThis.location = { href: "https://example.test/" };

    const controller = new MouseController(document);
    try {
      const initialization = controller.init();
      assert.isTrue(controller.initializing);
      assert.isTrue(controller.listeners.length > 0);

      const event = {
        button: 2,
        buttons: 2,
        pointerType: "mouse",
        clientX: 20,
        clientY: 30,
        timeStamp: 1,
        isTrusted: true,
        preventDefault() {},
        stopPropagation() {},
      };
      document.dispatch("pointerdown", event);
      assert.equal("PENDING", controller.gesture?.state);

      resolveSettings(actualSettings);
      await initialization;
      assert.isTrue(controller.settingsReady);
      assert.equal(actualSettings, controller.settings);
    } finally {
      controller.destroy();
      for (const [name, value] of globals) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  });
});
