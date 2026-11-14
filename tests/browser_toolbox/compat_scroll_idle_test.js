// SPDX-License-Identifier: GPL-3.0-or-later
// 使用可控动画帧验证兼容滚动的结束、并发和销毁通知。
import { strict as assert } from "node:assert";
import "../../content_scripts/scroller.js";

async function withScroller(run) {
  const names = [
    "document",
    "location",
    "Utils",
    "Settings",
    "handlerStack",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "innerHeight",
    "innerWidth",
    "BrowserToolboxScrollControllerInstance",
  ];
  const previous = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const frames = new Map();
  let nextId = 0;
  const element = {
    scrollTop: 1000,
    scrollLeft: 0,
    scrollHeight: 100000,
    clientHeight: 800,
    getBoundingClientRect: () => ({ top: 0, bottom: 800, left: 0, right: 1200 }),
    scrollBy({ top = 0, left = 0 }) {
      this.scrollTop = Math.max(
        0,
        Math.min(this.scrollHeight - this.clientHeight, this.scrollTop + top),
      );
      this.scrollLeft += left;
    },
  };
  const install = (name, value) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  install("document", { scrollingElement: element, body: element });
  install("location", { host: "synthetic.invalid" });
  install("Utils", { isString: (value) => typeof value === "string", isFirefox: () => false });
  install("Settings", { get: () => true });
  install("handlerStack", {
    push: () => ++nextId,
    remove() {},
    alwaysContinueBubbling: (fn) => fn(),
  });
  install("requestAnimationFrame", (callback) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  });
  install("cancelAnimationFrame", (id) => frames.delete(id));
  install("innerHeight", 800);
  install("innerWidth", 1200);
  install("BrowserToolboxScrollControllerInstance", null);
  const advance = (time) => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(time);
  };
  try {
    Scroller.init();
    await run({ frames, advance });
  } finally {
    Scroller.destroy();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

Deno.test("兼容滚动无动画同步通知，并等待多个动画全部结束", async () => {
  await withScroller(({ advance }) => {
    const events = [];
    Scroller.onIdle((success) => events.push(success));
    assert.deepEqual(events, [true]);
    Scroller.scrollBy("y", 100, 1, false);
    Scroller.scrollBy("y", 4000, 1, false);
    assert.equal(Scroller.isAnimating(), true);
    Scroller.onIdle((success) => events.push(success));
    advance(0);
    advance(100);
    advance(150);
    assert.deepEqual(events, [true]);
    for (let time = 200; time <= 1000 && Scroller.isAnimating(); time += 50) advance(time);
    assert.deepEqual(events, [true, true]);
    assert.equal(Scroller.isAnimating(), false);
  });
});

Deno.test("兼容滚动等待可取消，销毁时以失败结束所有余下等待", async () => {
  await withScroller(({ frames }) => {
    const events = [];
    Scroller.scrollBy("y", 4000, 1, false);
    const unsubscribe = Scroller.onIdle(() => events.push("cancelled"));
    Scroller.onIdle((success) => events.push(success));
    unsubscribe();
    Scroller.destroy();
    assert.deepEqual(events, [false]);
    assert.equal(frames.size, 0);
    assert.equal(Scroller.isAnimating(), false);
  });
});
