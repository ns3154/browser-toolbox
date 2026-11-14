// 合成契约在 Phase 0 冻结；新旧适配均与同一批既有输出对照。
import "../test_helper.js";
import "../../../lib/settings.js";
import "../../../lib/keyboard_utils.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../background_scripts/browser_toolbox/command_registry_adapter.js";
import "../../../lib/browser_toolbox/page_command_executor.js";
import { allCommands } from "../../../background_scripts/all_commands.js";
import { defaultKeyMappings, KeyMappingsParser } from "../../../background_scripts/commands.js";
import "../../../content_scripts/mode.js";
import "../../../content_scripts/mode_key_handler.js";
import "../../../content_scripts/marks.js";
import "../../../content_scripts/link_hints.js";
import "../../../content_scripts/vomnibar.js";
import "../../../content_scripts/mode_normal.js";

const fixture = JSON.parse(await Deno.readTextFile("tests/fixtures/runtime_compat_contracts.json"));
context("命令契约的首次同步构造", () => {
  should("文档加载不分配命令索引，首次查询后仍保持完整冻结契约与别名", async () => {
    const OriginalMap = globalThis.Map;
    let allocations = 0;
    stub(globalThis, "BrowserToolboxCommandDefinitions", BrowserToolboxCommandDefinitions);
    stub(globalThis, "Map", class extends OriginalMap {
      constructor(...args) { super(...args); allocations++; }
    });
    await import("../../../lib/browser_toolbox/command_definitions.js?startup-lazy");
    const definitions = BrowserToolboxCommandDefinitions;
    assert.equal(0, allocations);
    const first = definitions.getCommand("scrollDown");
    assert.isTrue(first === definitions.getCommand("scrollDown"));
    assert.equal(2, allocations);
    const commands = definitions.listCommands();
    assert.equal(95, commands.length);
    for (const command of commands) {
      assert.isTrue(Object.isFrozen(command));
      assert.isTrue(Object.isFrozen(command.countPolicy));
      for (const alias of command.aliases) assert.isTrue(definitions.getCommand(alias) === command);
    }
    assert.equal(null, definitions.getCommand("syntheticUnknownCommand"));
    assert.equal(2, allocations);
  });
});
context("运行时替换的冻结契约", () => {
  should("默认键位与所有命令的参数、次数和执行位置不变", () => {
    assert.equal(fixture.defaultKeyMappings, defaultKeyMappings);
    assert.equal(fixture.commands, JSON.parse(JSON.stringify(allCommands)));
  });
  for (const { input, result } of fixture.parserCases) {
    should(`原有映射语法保持既有输出：${input.replaceAll("\n", " / ")}`, () => {
      assert.equal(result, JSON.parse(JSON.stringify(KeyMappingsParser.parse(input, false))));
    });
  }
  for (
    const [name, count, options, expected] of [
      ["scrollDown", null, {}, 1],
      ["scrollDown", 100, {}, 100],
      ["scrollDown", 3, { count: 2 }, 6],
      ["scrollDown", null, { count: 3 }, 3],
      ["closeTabsOnRight", null, {}, null],
      ["closeTabsOnLeft", 2, {}, 2],
    ]
  ) {
    should(`${name} 经页面适配保留 count=${count}、映射次数及 null 语义`, () => {
      let captured;
      stub(
        BrowserToolboxPageCommandExecutorInstance,
        "executeCompatibility",
        (_entry, actual) => captured = actual,
      );
      NormalMode.prototype.commandHandler({ command: { command: name, options }, count });
      assert.equal(expected, captured);
    });
  }
  should("noRepeat 仍执行一次，超出 repeatLimit 的取消不产生副作用", () => {
    const counts = [];
    stub(
      BrowserToolboxPageCommandExecutorInstance,
      "executeCompatibility",
      (_entry, count) => counts.push(count),
    );
    NormalMode.prototype.commandHandler({
      command: { command: "scrollDown", options: {}, noRepeat: true },
      count: 10,
    });
    stub(globalThis, "confirm", () => false);
    NormalMode.prototype.commandHandler({
      command: { command: "scrollDown", options: {}, repeatLimit: 2 },
      count: 3,
    });
    assert.equal([1], counts);
  });
  should("Phase 1 不改变 v1 的 null/100 限制，保留 Phase 3 的已知差异", () => {
    for (const [name, count] of [["closeTabsOnRight", null], ["scrollDown", 100]]) {
      const invocation = BrowserToolboxCommandInvocation.createInvocation(
        name,
        {},
        { type: "keyboard" },
        {},
        count,
      );
      assert.equal(
        "INVALID_OPTIONS",
        BrowserToolboxCommandInvocation.validateInvocation(
          invocation,
          BrowserToolboxCommandRegistry,
        ).code,
      );
    }
  });
});
