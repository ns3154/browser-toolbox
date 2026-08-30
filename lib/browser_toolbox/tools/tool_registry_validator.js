// 工具注册表校验器：供启动、设置保存和单元测试复用同一套边界。
(function () {
  const registry = globalThis.BrowserToolboxToolRegistry;
  const contract = globalThis.BrowserToolboxToolContract;

  function validateSettingsToolIds(settings) {
    const errors = [];
    const tools = settings?.tools;
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
      errors.push("tools 必须是对象。");
      return errors;
    }
    if (!registry.validateToolIds(tools.pinnedIds, {
      max: 6,
      source: "action",
      surface: "popup",
    })) {
      errors.push("tools.pinnedIds 必须是最多 6 个不重复的静态工具 ID。");
    }
    if (
      !registry.validateToolIds(tools.contextMenu?.toolIds, {
        max: 3,
        source: "selection",
        surface: "contextMenu",
      })
    ) errors.push("tools.contextMenu.toolIds 必须是最多 3 个支持选中文本的不重复工具 ID。");
    return errors;
  }

  function assertRegistry() {
    const errors = contract.validateRegistry(registry.entries);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    return registry.entries;
  }

  globalThis.BrowserToolboxToolRegistryValidator = Object.freeze({
    validateSettingsToolIds,
    assertRegistry,
  });
})();
