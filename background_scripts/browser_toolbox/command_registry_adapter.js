// 命令注册表是设置页、帮助页、输入适配器和 Dispatcher 共用的唯一命令元数据来源。
import { allCommands } from "../all_commands.js";

/**
 * 统一命令注册项的公共元数据。
 * @typedef {Object} BrowserToolboxCommandMetadata
 * @property {string} name 命令名称。
 * @property {string} [title] 显示标题。
 * @property {string} [i18nKey] 本地化键。
 * @property {string} execution 执行层。
 * @property {Array<string>} supportedInputs 支持的输入来源。
 * @property {Array<string>} requiredContext 所需页面上下文。
 * @property {Object} [optionSchema] 参数 schema。
 * @property {boolean} dangerous 是否危险命令。
 */
(function () {
  const supportedDefaults = ["keyboard", "mouseGesture", "superDrag", "wheel", "rocker", "ui"];
  const i18nKey = (name) => `command_${name.replaceAll(".", "_")}`;
  const browserToolboxPrefix = "BrowserToolbox.";

  function commandFromUpstream(command) {
    return Object.assign({}, command, {
      title: command.desc,
      i18nKey: i18nKey(command.name),
      category: command.group,
      execution: command.background ? "background" : command.topFrame ? "topFrame" : "page",
      repeatable: !command.noRepeat,
      dangerous: (command.repeatLimit != null && command.repeatLimit <= 25) ||
        globalThis.BrowserToolboxCommandInvocation?.DANGEROUS_COMMANDS?.has(command.name),
      supportedInputs: command.supportedInputs || supportedDefaults,
      requiredContext: command.requiredContext || [],
      requiredPermissions: command.requiredPermissions || (command.background ? ["tabs"] : []),
    });
  }

  function assertUniqueCommands(commands) {
    const names = new Set();
    for (const command of commands) {
      if (!command || typeof command.name !== "string" || command.name.length === 0) {
        throw new Error("Command metadata must contain a non-empty name.");
      }
      if (names.has(command.name)) throw new Error(`Duplicate command name: ${command.name}`);
      names.add(command.name);
    }
    return commands;
  }

  function withBrowserToolboxCommands(commands) {
    const list = commands.slice();
    const existing = new Set(list.map((command) => command?.name));
    // 自定义测试注册表也必须包含产品命令，但命令定义只保留在 all_commands.js 一处。
    for (const command of allCommands) {
      if (command.name.startsWith(browserToolboxPrefix) && !existing.has(command.name)) {
        list.push(command);
      }
    }
    return list;
  }

  /**
   * 从上游命令清单构建统一注册项。
   * @param {Array<Object>} [commands] 上游命令清单。
   * @returns {Array<BrowserToolboxCommandMetadata>} 规范化注册项。
   */
  function createRegistry(commands = allCommands) {
    return assertUniqueCommands(withBrowserToolboxCommands(commands)).map(commandFromUpstream);
  }

  class CommandRegistry {
    constructor(commands = createRegistry()) {
      this.commands = assertUniqueCommands(commands).map((command) =>
        Object.freeze(Object.assign({}, command))
      );
      this.byName = new Map(this.commands.map((command) => [command.name, command]));
    }

    getCommand(name) {
      return this.byName.get(name) || null;
    }

    listCommands() {
      return this.commands.slice();
    }

    /**
     * 校验某个输入绑定能否调用对应命令。
     * @param {Object} binding 绑定配置。
     * @returns {Object} 校验结果及命令注册项。
     */
    validateBinding(binding) {
      const command = this.getCommand(binding?.commandName);
      const source = binding.source || "mouseGesture";
      const validate = globalThis.BrowserToolboxCommandInvocation?.validateCommandMetadata;
      if (!validate) {
        if (!command) return { ok: false, error: `Unknown command: ${binding?.commandName}` };
        if (!command.supportedInputs.includes(source)) {
          return { ok: false, error: `${command.name} does not support ${source}.` };
        }
        return { ok: true, command };
      }
      return validate(command, {
        source,
        contextType: binding.context || null,
        options: Object.hasOwn(binding || {}, "options") ? binding.options : {},
      });
    }
  }

  const registry = new CommandRegistry();
  globalThis.BrowserToolboxCommandRegistry = registry;
  globalThis.BrowserToolboxCommandRegistryClass = CommandRegistry;
  globalThis.BrowserToolboxCreateCommandRegistry = createRegistry;
})();
