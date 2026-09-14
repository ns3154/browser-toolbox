// 浏览器工具箱命令中心的数据层：把命令、工具和设置入口整理为可搜索的本地条目。
(function () {
  const EXCLUDED_COMMANDS = new Set([
    "BrowserToolbox.openCommandCenter",
    "BrowserToolbox.openTool",
  ]);

  function text(value) {
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  function localized(localize, key, fallback = "") {
    const value = text(typeof localize === "function" ? localize(key) : "");
    return value && value !== key ? value : text(fallback);
  }

  function searchable(entry) {
    return [
      entry.title,
      entry.description,
      entry.id,
      entry.commandName,
      entry.toolId,
      entry.category,
      ...(entry.keywords || []),
    ].map((value) => text(value).toLocaleLowerCase());
  }

  function createEntries({ commands = [], tools = [], settings = [], localize = (key) => key } = {}) {
    const commandEntries = (commands || [])
      .filter((command) =>
        command &&
        !EXCLUDED_COMMANDS.has(command.name) &&
        (command.supportedInputs || []).includes("ui") &&
        (command.requiredContext || []).length === 0
      )
      .map((command) => ({
        id: `command:${command.name}`,
        kind: "command",
        commandName: command.name,
        title: localized(localize, command.i18nKey, command.title || command.name),
        description: command.name,
        category: command.category || "command",
        keywords: [command.title, command.i18nKey, ...(command.keywords || [])],
        dangerous: Boolean(command.dangerous),
      }));
    const toolEntries = (tools || []).map((tool) => ({
      id: `tool:${tool.id}`,
      kind: "tool",
      toolId: tool.id,
      title: localized(localize, tool.titleKey, tool.title || tool.id),
      description: localized(localize, tool.descriptionKey, tool.description || ""),
      category: tool.category || tool.categoryId || "tool",
      keywords: [tool.id, tool.categoryId, ...(tool.keywordKeys || [])],
      dangerous: false,
    }));
    const settingEntries = (settings || []).map((setting) => ({
      id: `setting:${setting.id}`,
      kind: "setting",
      settingId: setting.id,
      hash: setting.hash || "",
      title: text(setting.title) || setting.id,
      description: text(setting.description),
      category: "settings",
      keywords: setting.keywords || [],
      dangerous: false,
    }));
    return [...commandEntries, ...toolEntries, ...settingEntries];
  }

  function searchEntries(entries, query = "") {
    const normalized = text(query).trim().toLocaleLowerCase();
    if (!normalized) return [...(entries || [])];
    return (entries || [])
      .map((entry, index) => {
        const fields = searchable(entry);
        const title = text(entry.title).toLocaleLowerCase();
        const id = text(entry.id).toLocaleLowerCase();
        let rank = Number.POSITIVE_INFINITY;
        if (title === normalized || id === normalized) rank = 0;
        else if (title.startsWith(normalized) || id.startsWith(normalized)) rank = 1;
        else if (title.includes(normalized)) rank = 2;
        else if (fields.some((field) => field.includes(normalized))) rank = 3;
        return { entry, index, rank };
      })
      .filter((item) => Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((item) => item.entry);
  }

  globalThis.BrowserToolboxCommandCenter = Object.freeze({
    createEntries,
    searchEntries,
  });
})();
