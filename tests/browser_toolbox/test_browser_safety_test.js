// SPDX-License-Identifier: GPL-3.0-or-later
import { strict as assert } from "node:assert";
import { assertSafeTestBrowser } from "../../scripts/test_browser_safety.js";

Deno.test("浏览器测试默认阻止有头和外部连接，显式允许时保留原生专项入口", () => {
  const name = "BROWSER_TOOLBOX_ALLOW_HEADED_TESTS";
  const previous = Deno.env.get(name);
  try {
    Deno.env.delete(name);
    assert.doesNotThrow(() => assertSafeTestBrowser());
    assert.throws(() => assertSafeTestBrowser({ headless: false }), /明确授权/);
    assert.throws(() => assertSafeTestBrowser({ external: true }), /明确授权/);
    Deno.env.set(name, "true");
    assert.doesNotThrow(() => assertSafeTestBrowser({ headless: false, external: true }));
  } finally {
    if (previous === undefined) Deno.env.delete(name);
    else Deno.env.set(name, previous);
  }
});
