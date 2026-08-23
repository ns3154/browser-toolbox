// 命令注册表是设置页、帮助页、输入适配器和 Dispatcher 共用的唯一命令元数据来源。
import { allCommands } from "../all_commands.js";

(function () {
  const supportedDefaults = ["keyboard", "mouseGesture", "superDrag", "wheel", "rocker", "ui"];
  const i18nKey = (name) => `command_${name.replaceAll(".", "_")}`;
  const addedCommands = [
    ["OpenKeyMouse.closeWindow", "Close current window", "windows", "background", true, true],
    ["OpenKeyMouse.newWindow", "Open a new window", "windows", "background", true, false],
    [
      "OpenKeyMouse.toggleKeyboard",
      "Toggle keyboard navigation",
      "settings",
      "background",
      true,
      false,
    ],
    [
      "OpenKeyMouse.toggleMouseGestures",
      "Toggle mouse gestures",
      "settings",
      "background",
      true,
      false,
    ],
    ["OpenKeyMouse.toggleSuperDrag", "Toggle super drag", "settings", "background", true, false],
    ["OpenKeyMouse.showTabList", "Show tab list", "tabs", "background", false, false],
    ["OpenKeyMouse.copySelection", "Copy selected text", "page", "page", true, false],
    ["OpenKeyMouse.copyLinkText", "Copy link text", "links", "page", true, false],
    ["OpenKeyMouse.copyLinkUrl", "Copy link URL", "links", "page", true, false],
    ["OpenKeyMouse.copyImageUrl", "Copy image URL", "links", "page", true, false],
    ["OpenKeyMouse.searchSelection", "Search selected text", "links", "background", true, false],
    [
      "OpenKeyMouse.openLinkForeground",
      "Open link in foreground",
      "links",
      "background",
      true,
      false,
    ],
    [
      "OpenKeyMouse.openLinkBackground",
      "Open link in background",
      "links",
      "background",
      true,
      false,
    ],
    [
      "OpenKeyMouse.openImageForeground",
      "Open image in foreground",
      "links",
      "background",
      true,
      false,
    ],
    [
      "OpenKeyMouse.openImageBackground",
      "Open image in background",
      "links",
      "background",
      true,
      false,
    ],
    ["OpenKeyMouse.downloadImage", "Download image", "links", "page", true, false],
    ["OpenKeyMouse.toggleFullscreen", "Toggle fullscreen", "windows", "background", true, false],
    ["OpenKeyMouse.minimizeWindow", "Minimize current window", "windows", "background", true, true],
    [
      "OpenKeyMouse.maximizeWindow",
      "Maximize current window",
      "windows",
      "background",
      true,
      false,
    ],
  ];

  function commandFromUpstream(command) {
    return Object.assign({}, command, {
      title: command.desc,
      i18nKey: i18nKey(command.name),
      category: command.group,
      execution: command.background ? "background" : command.topFrame ? "topFrame" : "page",
      repeatable: !command.noRepeat,
      dangerous: command.repeatLimit != null && command.repeatLimit <= 25,
      supportedInputs: command.supportedInputs || supportedDefaults,
      requiredContext: command.requiredContext || [],
      requiredPermissions: command.requiredPermissions || (command.background ? ["tabs"] : []),
    });
  }

  function createRegistry(commands = allCommands) {
    const list = commands.map(commandFromUpstream);
    const existing = new Set(list.map((command) => command.name));
    for (const [name, title, category, execution, repeatable, dangerous] of addedCommands) {
      if (existing.has(name)) continue;
      list.push({
        name,
        title,
        desc: title,
        i18nKey: i18nKey(name),
        category,
        group: category,
        execution,
        repeatable,
        dangerous,
        supportedInputs: supportedDefaults,
        requiredContext:
          name.includes("Link") || name.includes("Image") || name.includes("Selection")
            ? ["pointer"]
            : [],
        requiredPermissions: execution === "background" ? ["tabs"] : [],
        noRepeat: !repeatable,
      });
    }
    return list;
  }

  class CommandRegistry {
    constructor(commands = createRegistry()) {
      this.commands = commands.map((command) => Object.freeze(Object.assign({}, command)));
      this.byName = new Map(this.commands.map((command) => [command.name, command]));
    }

    getCommand(name) {
      return this.byName.get(name) || null;
    }

    listCommands() {
      return this.commands.slice();
    }

    validateBinding(binding) {
      const command = this.getCommand(binding?.commandName);
      if (!command) return { ok: false, error: `Unknown command: ${binding?.commandName}` };
      const source = binding.source || "mouseGesture";
      if (!command.supportedInputs.includes(source)) {
        return { ok: false, error: `${command.name} does not support ${source}.` };
      }
      return { ok: true, command };
    }
  }

  const registry = new CommandRegistry();
  globalThis.OpenKeyMouseCommandRegistry = registry;
  globalThis.OpenKeyMouseCommandRegistryClass = CommandRegistry;
  globalThis.OpenKeyMouseCreateCommandRegistry = createRegistry;
})();
