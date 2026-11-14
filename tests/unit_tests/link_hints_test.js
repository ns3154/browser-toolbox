import * as testHelper from "./test_helper.js";
import "../../lib/keyboard_utils.js";
import "../../lib/settings.js";
import "../../lib/browser_toolbox/runtime_host.js";
import "../../content_scripts/mode.js";
import "../../content_scripts/link_hints.js";

const contentHintCoordinator = globalThis.HintCoordinator;

context("With insufficient link characters", () => {
  setup(async () => {
    await Settings.onLoaded();
  });

  teardown(async () => {
    await Settings.clear();
  });

  should("throw error in AlphabetHints", async () => {
    await Settings.set("linkHintCharacters", "ab");
    new AlphabetHints();
    await Settings.set("linkHintCharacters", "a");
    assert.throwsError(() => new AlphabetHints(), "Error");
  });

  should("throw error in FilterHints", async () => {
    await Settings.set("linkHintNumbers", "12");
    new FilterHints();
    await Settings.set("linkHintNumbers", "1");
    assert.throwsError(() => new FilterHints(), "Error");
  });
});

context("兼容HintCoordinator收集超时对齐与重叠会话清理", () => {
  setup(async () => {
    await testHelper.jsdomStub("pages/hud_page.html");
    await Settings.onLoaded();
    stub(globalThis, "HUD", { show() {}, hide() {} });
    stub(Mode, "setIndicator", () => {});
  });

  teardown(async () => {
    contentHintCoordinator.exit({ isSuccess: false });
    await Settings.clear();
  });

  should("收集等待兜底时长不早于后台三秒超时，且prepare失败立即释放拦截并清空本地提示", async () => {
    const timeouts = [];
    let resolvePrepare;
    const calls = [];
    stub(Utils, "setTimeout", (ms, fn) => {
      timeouts.push({ ms, fn });
      return timeouts.length;
    });
    stub(globalThis, "frameId", 0);
    stub(DomUtils, "isReady", () => true);
    stub(DomUtils, "windowIsTooSmall", () => false);
    stub(LocalHints, "getLocalHints", () => [{ linkText: "alpha" }]);
    stub(globalThis, "BrowserToolboxFrameRuntimeBridgeInstance", {
      useV2: () => true,
      hints(operation, payload) {
        calls.push({ operation, payload });
        if (operation === "prepare") {
          return new Promise((resolve) => resolvePrepare = resolve);
        }
        return Promise.resolve({ ok: true });
      },
    });

    LinkHints.activateMode(1, {});
    assert.isTrue(timeouts.length >= 1);
    assert.isTrue(timeouts[0].ms >= 3500);
    const id = contentHintCoordinator.runtimeInteractionId;
    const descriptors = contentHintCoordinator.getHintDescriptors({
      modeIndex: 0,
      requestedByHelpDialog: false,
      interactionId: id,
      originatingFrameId: 0,
    });
    assert.equal(1, descriptors.length);
    assert.equal(1, contentHintCoordinator.localHints.length);

    // prepare 返回失败时立即退出收集拦截并清空残留 localHints，不留脏长度。
    resolvePrepare({ ok: false, code: "HINTS_TIMEOUT" });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(null, contentHintCoordinator.runtimeInteractionId);
    assert.equal(null, contentHintCoordinator.localHints);
    assert.isFalse(Boolean(contentHintCoordinator.cacheAllKeydownEvents?.modeIsActive));
  });

  should("上一轮exit回声到达前开始新收集时，立即拆除旧提示标记容器", () => {
    let deactivated = 0;
    contentHintCoordinator.linkHintsMode = {
      deactivateMode() {
        deactivated++;
      },
    };
    contentHintCoordinator.localHints = [{ linkText: "stale" }];
    stub(Utils, "setTimeout", () => 1);
    stub(globalThis, "BrowserToolboxFrameRuntimeBridgeInstance", {
      useV2: () => true,
      hints: () => Promise.resolve({ ok: true }),
    });

    LinkHints.activateMode(1, {});
    assert.equal(1, deactivated);
    assert.equal(null, contentHintCoordinator.linkHintsMode);
    assert.equal(null, contentHintCoordinator.localHints);
  });

  should("收集模式退出时立即从engineResources注销兜底计时器，不泄漏timer计数", () => {
    const engineResources = new BrowserToolboxRuntime.ResourceScope();
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", { engineResources });
    stub(globalThis, "BrowserToolboxFrameRuntimeBridgeInstance", {
      useV2: () => true,
      hints: () => new Promise(() => {}),
    });
    LinkHints.activateMode(1, {});
    assert.equal({ timer: 1 }, engineResources.counts());
    contentHintCoordinator.cacheAllKeydownEvents.exit();
    assert.equal({}, engineResources.counts());
    engineResources.dispose();
  });

  should("兼容提示在扩展平滑滚动结束后才收集，静止时保持同步快路径", async () => {
    let scrolling = false;
    let idle;
    let scans = 0;
    stub(globalThis, "frameId", 0);
    stub(DomUtils, "isReady", () => true);
    stub(DomUtils, "windowIsTooSmall", () => false);
    stub(LocalHints, "getLocalHints", () => {
      scans++;
      return [{ linkText: "alpha" }];
    });
    stub(globalThis, "Scroller", {
      isAnimating: () => scrolling,
      onIdle(callback) {
        idle = callback;
        return () => idle = null;
      },
    });
    const request = (interactionId) => ({ modeIndex: 0, interactionId, originatingFrameId: 1 });
    const immediate = contentHintCoordinator.getHintDescriptors(request("immediate"));
    assert.isFalse(Boolean(immediate?.then));
    assert.equal(1, immediate.length);
    scrolling = true;
    const pending = contentHintCoordinator.getHintDescriptors(request("pending"));
    assert.isTrue(Boolean(pending?.then));
    assert.equal(1, scans);
    const finish = idle;
    scrolling = false;
    finish(true);
    assert.equal(1, (await pending).length);
    assert.equal(2, scans);
    assert.equal(null, idle);
  });

  should("滚动等待中的兼容提示被替换或退出后，旧请求不会迟到收集", async () => {
    const callbacks = new Set();
    let scans = 0;
    stub(globalThis, "frameId", 0);
    stub(DomUtils, "isReady", () => true);
    stub(DomUtils, "windowIsTooSmall", () => false);
    stub(LocalHints, "getLocalHints", () => {
      scans++;
      return [{ linkText: "alpha" }];
    });
    stub(globalThis, "Scroller", {
      isAnimating: () => true,
      onIdle(callback) {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
    });
    const request = (interactionId) => ({ modeIndex: 0, interactionId, originatingFrameId: 1 });
    const old = contentHintCoordinator.getHintDescriptors(request("old"));
    const next = contentHintCoordinator.getHintDescriptors(request("next"));
    assert.equal([], await old);
    assert.equal(1, callbacks.size);
    for (const callback of [...callbacks]) callback(true);
    assert.equal(1, (await next).length);
    const cancelled = contentHintCoordinator.getHintDescriptors(request("cancelled"));
    contentHintCoordinator.exit({ isSuccess: false });
    assert.equal([], await cancelled);
    assert.equal(0, callbacks.size);
    assert.equal(1, scans);
  });

  should("无会话编号的等待在滚动结束回调后立即退出，也不能迟到收集", async () => {
    let idle;
    let scans = 0;
    stub(globalThis, "frameId", 0);
    stub(DomUtils, "isReady", () => true);
    stub(DomUtils, "windowIsTooSmall", () => false);
    stub(LocalHints, "getLocalHints", () => {
      scans++;
      return [{ linkText: "alpha" }];
    });
    stub(globalThis, "Scroller", {
      isAnimating: () => true,
      onIdle(callback) {
        idle = callback;
        return () => {};
      },
    });
    const pending = contentHintCoordinator.getHintDescriptors({ modeIndex: 0 });
    idle(true);
    contentHintCoordinator.exit({ isSuccess: false });
    assert.equal([], await pending);
    assert.equal(0, scans);
  });
});
