/**
 * 鼠标控制器启动时序测试。
 * 验证配置请求尚未返回时，首个指针事件也已经进入输入层。
 */
import "../test_helper.js";
import "../../../content_scripts/mouse/context_menu_guard.js";
import "../../../content_scripts/mouse/path_sampler.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../content_scripts/mouse/gesture_session.js";

const ContextMenuGuard = globalThis.BrowserToolboxContextMenuGuard;
const RealGestureSession = globalThis.BrowserToolboxGestureSession;

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
  update() {}
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

  async function withControllerHarness(fn) {
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
      ["BrowserToolboxContextMenuGuard", globalThis.BrowserToolboxContextMenuGuard],
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
      ["requestAnimationFrame", globalThis.requestAnimationFrame],
      ["cancelAnimationFrame", globalThis.cancelAnimationFrame],
    ]);
    const document = new TestDocument();
    const overlayLog = { showCancelCalls: 0, showCalls: 0, drawCalls: [], hideCalls: 0 };
    class TrackingOverlay extends TestOverlay {
      showCancel() {
        overlayLog.showCancelCalls += 1;
      }
      show() {
        overlayLog.showCalls += 1;
      }
      draw(points) {
        overlayLog.drawCalls.push(points.slice());
      }
      hide() {
        overlayLog.hideCalls += 1;
      }
      setCancelHover() {}
      setGesture() {}
      setHud() {}
    }
    const pendingRafs = new Map();
    let nextRafId = 1;
    globalThis.requestAnimationFrame = (cb) => {
      const id = nextRafId++;
      pendingRafs.set(id, cb);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
      pendingRafs.delete(id);
    };
    globalThis.BrowserToolboxCommandInvocation = {
      ERROR_CODES: {},
      createInvocation: () => ({ requestId: "mouse-controller-test" }),
    };
    globalThis.BrowserToolboxMessageProtocol = { validate: () => false };
    globalThis.BrowserToolboxSettingsRepositoryInstance = null;
    globalThis.BrowserToolboxSettingsRuntimeClientInstance = runtimeSettings;
    globalThis.BrowserToolboxContextMenuGuard = ContextMenuGuard;
    globalThis.BrowserToolboxGestureRecognizer = {
      find: () => ({ exact: null, pattern: [] }),
      format: () => "",
    };
    globalThis.BrowserToolboxGestureOverlay = TrackingOverlay;
    globalThis.BrowserToolboxWheelGestureController = TestWheel;
    globalThis.BrowserToolboxRockerGestureController = TestRocker;
    globalThis.BrowserToolboxCursorController = TestCursor;
    globalThis.BrowserToolboxFrameGestureBridge = TestBridge;
    globalThis.BrowserToolboxGestureSession = RealGestureSession;
    globalThis.BrowserToolboxI18n = { hasMessage: () => false };
    globalThis.document = document;
    globalThis.location = { href: "https://example.test/" };

    const controller = new MouseController(document);
    await controller.init();
    controller.settings = structuredClone(bootstrapSettings);
    controller.settings.mouse.showTrail = true;
    try {
      await fn({
        controller,
        document,
        overlayLog,
        pendingRafs,
        flushRaf() {
          const entries = [...pendingRafs.entries()];
          pendingRafs.clear();
          for (const [, cb] of entries) cb(0);
        },
      });
    } finally {
      controller.destroy();
      for (const [name, value] of globals) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  }

  function pointerEvent(overrides = {}) {
    let defaultPrevented = false;
    let propagationStopped = false;
    return {
      button: 2,
      buttons: 2,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 100,
      clientY: 100,
      timeStamp: 1000,
      isTrusted: true,
      get defaultPrevented() {
        return defaultPrevented;
      },
      get propagationStopped() {
        return propagationStopped;
      },
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {
        propagationStopped = true;
      },
      ...overrides,
    };
  }

  should(
    "defer cancel overlay and pointer capture until activation, and ignore child blur",
    async () => {
      await withControllerHarness(async ({ controller, document, overlayLog, flushRaf }) => {
        const captured = [];
        const released = [];
        const target = {
          setPointerCapture: (id) => captured.push(id),
          hasPointerCapture: (id) => captured.includes(id) && !released.includes(id),
          releasePointerCapture: (id) => released.push(id),
        };
        document.dispatch("pointerdown", pointerEvent({ target, pointerId: 7, timeStamp: 1000 }));
        assert.equal("PENDING", controller.gesture?.state);
        assert.equal(0, overlayLog.showCancelCalls);
        assert.equal([], captured);

        document.dispatch(
          "pointermove",
          pointerEvent({
            target,
            pointerId: 7,
            clientX: 140,
            clientY: 100,
            timeStamp: 1020,
            getCoalescedEvents: () => [
              { clientX: 115, clientY: 100, timeStamp: 1010 },
              { clientX: 140, clientY: 100, timeStamp: 1020 },
            ],
          }),
        );
        assert.equal("ACTIVE", controller.gesture?.state);
        assert.equal(1, overlayLog.showCancelCalls);
        assert.equal([7], captured);

        // 页面内部子元素失焦不应中断激活中的鼠标手势。
        document.dispatch("blur", { target: { nodeName: "INPUT" } });
        assert.equal("ACTIVE", controller.gesture?.state);

        flushRaf();
        assert.isTrue(overlayLog.drawCalls.length >= 1);

        await controller.onPointerUp(
          pointerEvent({ target, pointerId: 7, clientX: 140, clientY: 100, timeStamp: 1030 }),
        );
        assert.equal([7], released);
        assert.equal(null, controller.gesture);
      });
    },
  );

  should(
    "arm native menu retry only for crisp early-suppressed clicks and pass second click through",
    async () => {
      await withControllerHarness(async ({ controller, document }) => {
        document.dispatch(
          "pointerdown",
          pointerEvent({ clientX: 50, clientY: 60, timeStamp: 1000 }),
        );
        const firstMenu = pointerEvent({ clientX: 50, clientY: 60, timeStamp: 1002 });
        document.dispatch("contextmenu", firstMenu);
        assert.isTrue(firstMenu.defaultPrevented);

        await controller.onPointerUp(
          pointerEvent({ clientX: 52, clientY: 61, timeStamp: 1090 }),
        );
        assert.isTrue(controller.guard.nativeMenuRetryPoint != null);

        document.dispatch(
          "pointerdown",
          pointerEvent({ clientX: 53, clientY: 62, timeStamp: 1200 }),
        );
        assert.equal(null, controller.gesture);
        const secondMenu = pointerEvent({ clientX: 53, clientY: 62, timeStamp: 1202 });
        document.dispatch("contextmenu", secondMenu);
        assert.isFalse(secondMenu.defaultPrevented);
      });
    },
  );

  should(
    "not arm native menu retry after a long hold or when no early contextmenu fired",
    async () => {
      await withControllerHarness(async ({ controller, document }) => {
        // 没有早到的 contextmenu（如 Windows/Linux）时，抬键后不启用双击重试。
        document.dispatch(
          "pointerdown",
          pointerEvent({ clientX: 50, clientY: 60, timeStamp: 1000 }),
        );
        await controller.onPointerUp(
          pointerEvent({ clientX: 50, clientY: 60, timeStamp: 1060 }),
        );
        assert.equal(null, controller.guard.nativeMenuRetryPoint);

        // 长按犹豫（> 320ms）即使拦过早到菜单，也不应启用双击重试以防打断紧随的手势。
        document.dispatch(
          "pointerdown",
          pointerEvent({ clientX: 50, clientY: 60, timeStamp: 2000 }),
        );
        document.dispatch(
          "contextmenu",
          pointerEvent({ clientX: 50, clientY: 60, timeStamp: 2002 }),
        );
        await controller.onPointerUp(
          pointerEvent({ clientX: 50, clientY: 60, timeStamp: 2450 }),
        );
        assert.equal(null, controller.guard.nativeMenuRetryPoint);
      });
    },
  );
});
