// SPDX-License-Identifier: GPL-3.0-or-later
// 用可控动画帧验证候选快照和取消时序；原生页面验收仍须另行运行。
import { strict as assert } from "node:assert";
import "../../lib/browser_toolbox/runtime_host.js";
import "../../content_scripts/browser_toolbox/scroll_controller.js";
import "../../content_scripts/browser_toolbox/hints_runtime.js";

async function withFixture(test) {
  const names = [
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "Settings",
    "DomUtils",
    "BrowserToolboxRuntimeHostInstance",
    "BrowserToolboxHintsControllerInstance",
    "BrowserToolboxScrollControllerInstance",
    "BrowserToolboxFrameRuntimeBridgeInstance",
  ];
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const frames = new Map();
  let next = 0;
  Object.assign(globalThis, {
    requestAnimationFrame: (fn) => {
      const id = ++next;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    Settings: { get: () => true },
    DomUtils: { isReady: () => true, windowIsTooSmall: () => false },
    BrowserToolboxRuntimeHostInstance: {
      state: "active",
      runtimeEpoch: 1,
      context: { documentId: "doc" },
    },
    BrowserToolboxFrameRuntimeBridgeInstance: { hints: () => Promise.resolve({ ok: true }) },
  });
  const owner = new BrowserToolboxRuntime.ResourceScope();
  const scroll = globalThis.BrowserToolboxScrollControllerInstance =
    new BrowserToolboxScrollController(owner);
  const hints = globalThis.BrowserToolboxHintsControllerInstance = new BrowserToolboxHintsRuntime
    .Controller(owner, { documentId: "doc", frameId: 0 });
  const element = {
    scrollTop: 4000,
    scrollBy({ top }) {
      this.scrollTop = Math.max(0, this.scrollTop + top);
    },
  };
  const scans = [];
  hints.scanner = {
    collect: () => {
      scans.push(element.scrollTop);
      return [{ linkText: String(element.scrollTop) }];
    },
  };
  const request = (interactionId) => ({ interactionId, originatingFrameId: 2, modeIndex: 0 });
  const tick = (timestamp) => {
    const batch = [...frames.values()];
    frames.clear();
    for (const callback of batch) callback(timestamp);
  };
  try {
    await test({ owner, scroll, hints, element, scans, request, tick, frames });
  } finally {
    hints.destroy();
    scroll.destroy();
    owner.dispose();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

Deno.test("提示收集等待所有当前滚动完成，无滚动时同步返回", async () => {
  await withFixture(async ({ scroll, hints, element, scans, request, tick }) => {
    const immediate = hints.getHintDescriptors(request("immediate"));
    assert.ok(Array.isArray(immediate));
    assert.deepEqual(scans, [4000]);
    scroll.animate(element, "y", -4000, false);
    scroll.animate(element, "y", -100, false);
    const pending = hints.getHintDescriptors(request("pending"));
    assert.ok(pending instanceof Promise);
    assert.deepEqual(scans, [4000]);
    tick(0);
    tick(100);
    assert.equal(scroll.animations.size, 1);
    assert.deepEqual(scans, [4000]);
    tick(200);
    assert.deepEqual(await pending, [{ frameId: 0, localIndex: 0, linkText: "0" }]);
    assert.deepEqual(scans, [4000, 0]);
    assert.equal(scroll.idleListeners.size, 0);
  });
});

Deno.test("提示取消、替换和滚动销毁不会迟到收集", async () => {
  await withFixture(async ({ scroll, hints, element, scans, request, tick }) => {
    scroll.animate(element, "y", -4000, false);
    const cancelled = hints.getHintDescriptors(request("cancelled"));
    hints.cancelInteractions();
    assert.deepEqual(await cancelled, []);
    assert.equal(scroll.idleListeners.size, 0);
    const replaced = hints.getHintDescriptors(request("old"));
    const latest = hints.getHintDescriptors(request("new"));
    assert.deepEqual(await replaced, []);
    assert.equal(scroll.idleListeners.size, 1);
    tick(0);
    tick(200);
    assert.deepEqual(await latest, [{ frameId: 0, localIndex: 0, linkText: "0" }]);
    assert.deepEqual(scans, [0]);
    element.scrollTop = 4000;
    scroll.animate(element, "y", -4000, false);
    const destroyed = hints.getHintDescriptors(request("destroyed"));
    scroll.destroy();
    assert.deepEqual(await destroyed, []);
    assert.deepEqual(scans, [0]);
    assert.equal(scroll.idleListeners.size, 0);
  });
});
