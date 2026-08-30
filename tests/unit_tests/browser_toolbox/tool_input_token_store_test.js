import "../test_helper.js";
import "../../../lib/browser_toolbox/tools/tool_contract.js";
import "../../../lib/browser_toolbox/tools/tool_registry.js";
import "../../../background_scripts/browser_toolbox/tool_input_token_store.js";

context("BrowserToolbox tool input tokens", () => {
  function fakeStorage() {
    const values = new Map();
    return {
      async set(items) {
        for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      },
      async get(key) {
        if (key === null) {
          return Object.fromEntries([...values.entries()].map(([name, value]) => [name, structuredClone(value)]));
        }
        return values.has(key) ? { [key]: structuredClone(values.get(key)) } : {};
      },
      async remove(key) {
        for (const item of Array.isArray(key) ? key : [key]) values.delete(item);
      },
      values,
    };
  }

  should("be random, bound to one tool, and single-use", async () => {
    const storage = fakeStorage();
    const store = new BrowserToolboxToolInputTokenStore.ToolInputTokenStore(storage);
    const token = await store.put({
      toolId: "json.format",
      input: '{"safe":true}',
      source: "selection",
      tabId: 7,
    });
    assert.equal(32, token.length);
    assert.isTrue(/^[a-f0-9]+$/.test(token));
    assert.equal(null, await store.consume(token, "text.diff"));
    assert.equal(null, await store.consume(token, "json.format"));

    const next = await store.put({
      toolId: "json.format",
      input: '{"safe":true}',
      source: "selection",
    });
    const consumed = await store.consume(next, "json.format");
    assert.equal(
      { toolId: "json.format", source: "selection", input: '{"safe":true}', tabId: null },
      consumed,
    );
    assert.equal(null, await store.consume(next, "json.format"));
  });

  should("bind the expected source and remove expired or malformed records", async () => {
    const storage = fakeStorage();
    const store = new BrowserToolboxToolInputTokenStore.ToolInputTokenStore(storage);
    const token = await store.put({
      toolId: "json.format",
      input: "{}",
      source: "selection",
    });
    assert.equal(null, await store.consume(token, "json.format", "action"));
    assert.equal(null, await store.consume(token, "json.format", "selection"));
    await storage.set({
      "browserToolboxToolInput:expired": { expiresAt: 1 },
      "browserToolboxToolInput:malformed": "not-an-object",
    });
    assert.equal(2, await store.cleanup(2));
  });

  should("reject input that exceeds the descriptor limit", async () => {
    const storage = fakeStorage();
    const store = new BrowserToolboxToolInputTokenStore.ToolInputTokenStore(storage);
    let failed = false;
    try {
      await store.put({
        toolId: "time.convert",
        input: "x".repeat(65 * 1024),
        source: "selection",
      });
    } catch (_) {
      failed = true;
    }
    assert.isTrue(failed);
  });
});
