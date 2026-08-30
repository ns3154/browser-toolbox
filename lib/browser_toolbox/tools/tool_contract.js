// BrowserToolbox 工具契约：所有工具都必须通过静态元数据进入运行时。
(function () {
  const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
  const INPUT_MODES = Object.freeze(["none", "single", "dual"]);
  const SOURCES = Object.freeze(["action", "selection", "page", "link", "image", "command"]);
  const CAPABILITIES = Object.freeze([
    "format",
    "sort",
    "repairMojibake",
    "metadata",
    "collapse",
    "copy",
    "download",
    "diff",
    "encode",
    "decode",
    "convert",
    "generate",
    "password",
    "table",
  ]);
  const CAPABILITY_SET = new Set(CAPABILITIES);
  const SOURCE_SET = new Set(SOURCES);
  const INPUT_MODE_SET = new Set(INPUT_MODES);
  const MAX_TOOL_ID_LENGTH = 64;
  const MAX_TOOL_INPUT_BYTES = 10 * 1024 * 1024;
  const CONTROL_TYPES = new Set(["select", "checkbox", "text"]);
  const KEY_PATTERN = /^[a-z][a-zA-Z0-9_-]*$/;

  function isPlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function validateDescriptor(descriptor, { knownIds = new Set() } = {}) {
    const errors = [];
    if (!isPlainRecord(descriptor)) return ["工具描述必须是普通对象。"];
    if (
      typeof descriptor.id !== "string" || descriptor.id.length === 0 ||
      descriptor.id.length > MAX_TOOL_ID_LENGTH || !TOOL_ID_PATTERN.test(descriptor.id)
    ) errors.push("工具 ID 必须是稳定的分段小写标识。");
    if (knownIds.has(descriptor.id)) errors.push(`工具 ID 重复：${descriptor.id}。`);
    if (descriptor.schemaVersion !== 1) errors.push(`工具 schemaVersion 必须为 1：${descriptor.id}。`);
    for (const key of ["titleKey", "descriptionKey", "category", "entry"]) {
      if (typeof descriptor[key] !== "string" || descriptor[key].length === 0) {
        errors.push(`工具 ${key} 必须是非空字符串。`);
      }
    }
    for (const key of ["categoryId", "route", "icon"]) {
      if (
        typeof descriptor[key] !== "string" || descriptor[key].length === 0 ||
        descriptor[key].length > 64 || !KEY_PATTERN.test(descriptor[key])
      ) {
        errors.push(`工具 ${key} 必须是非空字符串：${descriptor.id || "unknown"}。`);
      }
    }
    if (!Array.isArray(descriptor.keywordKeys) || descriptor.keywordKeys.some((key) => typeof key !== "string")) {
      errors.push(`工具 keywordKeys 必须是字符串数组：${descriptor.id || "unknown"}。`);
    }
    if (!isPlainRecord(descriptor.surfaces) ||
      ["catalog", "popup", "contextMenu", "settings"].some((key) => typeof descriptor.surfaces[key] !== "boolean")) {
      errors.push(`工具 surfaces 不完整：${descriptor.id || "unknown"}。`);
    }
    if (!Array.isArray(descriptor.executionContexts) || !descriptor.executionContexts.includes("extension-page")) {
      errors.push(`工具必须声明 extension-page 执行上下文：${descriptor.id || "unknown"}。`);
    }
    if (!Array.isArray(descriptor.controls)) {
      errors.push(`工具 controls 必须是数组：${descriptor.id || "unknown"}。`);
    } else {
      const controlKeys = new Set();
      for (const control of descriptor.controls) {
        if (!isPlainRecord(control) || typeof control.key !== "string" || controlKeys.has(control.key)) {
          errors.push(`工具控件定义无效或重复：${descriptor.id || "unknown"}。`);
          continue;
        }
        controlKeys.add(control.key);
        if (typeof control.labelKey !== "string" || !CONTROL_TYPES.has(control.type)) {
          errors.push(`工具控件类型或本地化键无效：${descriptor.id}.${control.key}。`);
        }
        if (control.type === "select" && (!Array.isArray(control.options) || control.options.length === 0)) {
          errors.push(`工具选择控件缺少选项：${descriptor.id}.${control.key}。`);
        }
        if (Array.isArray(control.options) && control.options.some((option) =>
          !Array.isArray(option) || option.length !== 2 || option.some((value) => typeof value !== "string")
        )) errors.push(`工具控件选项无效：${descriptor.id}.${control.key}。`);
      }
    }
    if (!INPUT_MODE_SET.has(descriptor.inputMode)) {
      errors.push(`工具 inputMode 无效：${descriptor.id || "unknown"}。`);
    }
    if (descriptor.localOnly !== true) {
      errors.push(`工具必须声明 localOnly=true：${descriptor.id}。`);
    }
    if (
      !Number.isInteger(descriptor.maxInputBytes) || descriptor.maxInputBytes < 0 ||
      descriptor.maxInputBytes > MAX_TOOL_INPUT_BYTES
    ) errors.push(`工具输入上限无效：${descriptor.id}。`);
    if (!Array.isArray(descriptor.capabilities) || descriptor.capabilities.length === 0) {
      errors.push(`工具 capabilities 不能为空：${descriptor.id}。`);
    } else {
      const capabilities = new Set();
      for (const capability of descriptor.capabilities) {
        if (!CAPABILITY_SET.has(capability)) {
          errors.push(`工具能力无效：${descriptor.id}.${capability}。`);
        }
        if (capabilities.has(capability)) {
          errors.push(`工具能力重复：${descriptor.id}.${capability}。`);
        }
        capabilities.add(capability);
      }
    }
    if (!Array.isArray(descriptor.allowedSources) || descriptor.allowedSources.length === 0) {
      errors.push(`工具 allowedSources 不能为空：${descriptor.id}。`);
    } else {
      const sources = new Set();
      for (const source of descriptor.allowedSources) {
        if (!SOURCE_SET.has(source)) errors.push(`工具来源无效：${descriptor.id}.${source}。`);
        if (sources.has(source)) errors.push(`工具来源重复：${descriptor.id}.${source}。`);
        sources.add(source);
      }
    }
    if (descriptor.inputMode === "none" && descriptor.maxInputBytes !== 0) {
      errors.push(`无输入工具的 maxInputBytes 必须为 0：${descriptor.id}。`);
    }
    return errors;
  }

  function validateRegistry(descriptors) {
    if (!Array.isArray(descriptors)) return ["工具注册表必须是数组。"];
    const errors = [];
    const knownIds = new Set();
    const knownRoutes = new Set();
    const knownEntries = new Set();
    for (const descriptor of descriptors) {
      errors.push(...validateDescriptor(descriptor, { knownIds }));
      if (typeof descriptor?.id === "string") knownIds.add(descriptor.id);
      if (typeof descriptor?.route === "string") {
        if (knownRoutes.has(descriptor.route)) errors.push(`工具 route 重复：${descriptor.route}。`);
        knownRoutes.add(descriptor.route);
      }
      if (typeof descriptor?.entry === "string") {
        if (knownEntries.has(descriptor.entry)) errors.push(`工具加载入口重复：${descriptor.entry}。`);
        knownEntries.add(descriptor.entry);
      }
    }
    return errors;
  }

  function cloneDescriptor(descriptor) {
    return Object.freeze({
      ...descriptor,
      capabilities: Object.freeze(descriptor.capabilities.slice()),
      allowedSources: Object.freeze(descriptor.allowedSources.slice()),
      keywordKeys: Object.freeze(descriptor.keywordKeys.slice()),
      executionContexts: Object.freeze(descriptor.executionContexts.slice()),
      surfaces: Object.freeze({ ...descriptor.surfaces }),
      controls: Object.freeze(descriptor.controls.map((control) => Object.freeze({
        ...control,
        options: control.options ? Object.freeze(control.options.map((option) => Object.freeze(option.slice()))) : undefined,
      }))),
    });
  }

  globalThis.BrowserToolboxToolContract = Object.freeze({
    TOOL_ID_PATTERN,
    INPUT_MODES,
    SOURCES,
    CAPABILITIES,
    MAX_TOOL_ID_LENGTH,
    MAX_TOOL_INPUT_BYTES,
    isPlainRecord,
    validateDescriptor,
    validateRegistry,
    cloneDescriptor,
  });
})();
