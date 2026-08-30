// BrowserToolbox 静态工具注册表：注册项是代码的一部分，不从 URL、配置或网络动态加载。
(function () {
  const contract = globalThis.BrowserToolboxToolContract;
  const descriptors = [
    {
      schemaVersion: 1,
      id: "json.format",
      categoryId: "developer",
      route: "json",
      titleKey: "toolJsonFormat",
      descriptionKey: "toolJsonFormatDescription",
      category: "format",
      keywordKeys: ["toolKeywordJson", "toolKeywordFormat", "toolKeywordValidate"],
      icon: "braces",
      surfaces: { catalog: true, popup: true, contextMenu: true, settings: true },
      executionContexts: ["extension-page"],
      inputMode: "single",
      localOnly: true,
      capabilities: [
        "format",
        "sort",
        "repairMojibake",
        "metadata",
        "collapse",
        "copy",
        "download",
      ],
      maxInputBytes: 10 * 1024 * 1024,
      allowedSources: ["action", "selection", "page", "command"],
      entry: "json.format",
      controls: [
        { key: "operation", labelKey: "toolJsonOperation", type: "select", defaultValue: "format", options: [
          ["format", "toolJsonFormatOperation"], ["compact", "toolJsonCompactOperation"],
          ["validate", "toolJsonValidateOperation"], ["sort", "toolJsonSortOperation"],
        ] },
        { key: "indent", labelKey: "toolIndent", type: "select", defaultValue: "2", options: [
          ["2", "toolIndent2"], ["4", "toolIndent4"], ["8", "toolIndent8"], ["tab", "toolIndentTab"],
        ] },
        { key: "sortOrder", labelKey: "toolSort", type: "select", defaultValue: "original", options: [
          ["original", "toolKeepOrder"], ["ascending", "toolSortAscending"], ["descending", "toolSortDescending"],
        ] },
        { key: "compact", labelKey: "toolCompact", type: "checkbox", defaultValue: false },
        { key: "expandEscaped", labelKey: "toolExpandEscaped", type: "checkbox", defaultValue: false },
        { key: "repair", labelKey: "toolRepair", type: "checkbox", defaultValue: false },
      ],
    },
    {
      schemaVersion: 1,
      id: "text.diff",
      categoryId: "text",
      route: "diff",
      titleKey: "toolTextDiff",
      descriptionKey: "toolTextDiffDescription",
      category: "text",
      keywordKeys: ["toolKeywordDiff", "toolKeywordText"],
      icon: "diff",
      surfaces: { catalog: true, popup: true, contextMenu: true, settings: true },
      executionContexts: ["extension-page"],
      inputMode: "dual",
      localOnly: true,
      capabilities: ["diff", "copy"],
      maxInputBytes: 10 * 1024 * 1024,
      allowedSources: ["action", "selection", "command"],
      entry: "text.diff",
      controls: [],
    },
    {
      schemaVersion: 1,
      id: "codec.transform",
      categoryId: "developer",
      route: "codec",
      titleKey: "toolCodecTransform",
      descriptionKey: "toolCodecTransformDescription",
      category: "codec",
      keywordKeys: ["toolKeywordCodec", "toolKeywordBase64", "toolKeywordJwt"],
      icon: "code",
      surfaces: { catalog: true, popup: true, contextMenu: true, settings: true },
      executionContexts: ["extension-page"],
      inputMode: "single",
      localOnly: true,
      capabilities: ["encode", "decode", "convert", "copy"],
      maxInputBytes: 5 * 1024 * 1024,
      allowedSources: ["action", "selection", "command"],
      entry: "codec.transform",
      controls: [{ key: "mode", labelKey: "toolMode", type: "select", defaultValue: "base64Encode", options: [
        ["unicodeEncode", "toolUnicodeEncode"], ["unicodeDecode", "toolUnicodeDecode"],
        ["utf8Encode", "toolUtf8Encode"], ["utf8Decode", "toolUtf8Decode"],
        ["base64Encode", "toolBase64Encode"], ["base64Decode", "toolBase64Decode"],
        ["hexEncode", "toolHexEncode"], ["hexDecode", "toolHexDecode"],
        ["utf16Encode", "toolUtf16Encode"], ["utf16Decode", "toolUtf16Decode"],
        ["urlEncode", "toolUrlEncode"], ["urlDecode", "toolUrlDecode"],
        ["htmlEncode", "toolHtmlEncode"], ["htmlDecode", "toolHtmlDecode"],
        ["jwtDecode", "toolJwtDecode"], ["cookieParse", "toolCookieParse"],
        ["gzipCompress", "toolGzipCompress"], ["gzipDecompress", "toolGzipDecompress"],
        ["md5", "toolMd5"], ["sha1", "toolSha1"],
      ] }],
    },
    {
      schemaVersion: 1,
      id: "time.convert",
      categoryId: "developer",
      route: "time",
      titleKey: "toolTimeConvert",
      descriptionKey: "toolTimeConvertDescription",
      category: "time",
      keywordKeys: ["toolKeywordTime", "toolKeywordUnix", "toolKeywordTimezone"],
      icon: "clock",
      surfaces: { catalog: true, popup: true, contextMenu: true, settings: true },
      executionContexts: ["extension-page"],
      inputMode: "single",
      localOnly: true,
      capabilities: ["convert", "copy"],
      maxInputBytes: 64 * 1024,
      allowedSources: ["action", "selection", "command"],
      entry: "time.convert",
      controls: [
        { key: "mode", labelKey: "toolMode", type: "select", defaultValue: "isoToUnixSeconds", options: [
          ["isoToUnixSeconds", "toolIsoToUnixSeconds"], ["isoToUnixMilliseconds", "toolIsoToUnixMilliseconds"],
          ["unixSecondsToIso", "toolUnixSecondsToIso"], ["unixMillisecondsToIso", "toolUnixMillisecondsToIso"],
          ["isoToTimezone", "toolIsoToTimezone"], ["unixToFiletime", "toolUnixToFiletime"],
          ["filetimeToUnix", "toolFiletimeToUnix"],
        ] },
        { key: "timezone", labelKey: "toolTimezone", type: "text", defaultValue: "UTC" },
      ],
    },
    {
      schemaVersion: 1,
      id: "id.generate",
      categoryId: "generate",
      route: "id",
      titleKey: "toolIdGenerate",
      descriptionKey: "toolIdGenerateDescription",
      category: "generate",
      keywordKeys: ["toolKeywordId", "toolKeywordUuid", "toolKeywordSnowflake"],
      icon: "hash",
      surfaces: { catalog: true, popup: true, contextMenu: false, settings: true },
      executionContexts: ["extension-page"],
      inputMode: "none",
      localOnly: true,
      capabilities: ["generate", "copy"],
      maxInputBytes: 0,
      allowedSources: ["action", "command"],
      entry: "id.generate",
      controls: [
        { key: "mode", labelKey: "toolMode", type: "select", defaultValue: "uuid", options: [
          ["uuid", "toolUuid"], ["ulid", "toolUlid"], ["snowflake", "toolSnowflake"], ["nanoid", "toolNanoid"],
        ] },
        { key: "count", labelKey: "toolCount", type: "select", defaultValue: "1", options: [
          ["1", "toolCount1"], ["5", "toolCount5"], ["10", "toolCount10"],
        ] },
      ],
    },
    {
      schemaVersion: 1,
      id: "password.generate",
      categoryId: "generate",
      route: "password",
      titleKey: "toolPasswordGenerate",
      descriptionKey: "toolPasswordGenerateDescription",
      category: "generate",
      keywordKeys: ["toolKeywordPassword", "toolKeywordRandom"],
      icon: "key",
      surfaces: { catalog: true, popup: true, contextMenu: false, settings: true },
      executionContexts: ["extension-page"],
      inputMode: "none",
      localOnly: true,
      capabilities: ["generate", "password", "copy"],
      maxInputBytes: 0,
      allowedSources: ["action", "command"],
      entry: "password.generate",
      controls: [
        { key: "length", labelKey: "toolLength", type: "select", defaultValue: "20", options: [
          ["12", "toolLength12"], ["20", "toolLength20"], ["32", "toolLength32"], ["64", "toolLength64"],
        ] },
        { key: "symbols", labelKey: "toolSymbols", type: "checkbox", defaultValue: true },
      ],
    },
    {
      schemaVersion: 1,
      id: "table.convert",
      categoryId: "data",
      route: "table",
      titleKey: "toolTableConvert",
      descriptionKey: "toolTableConvertDescription",
      category: "table",
      keywordKeys: ["toolKeywordCsv", "toolKeywordTsv", "toolKeywordSql"],
      icon: "table",
      surfaces: { catalog: true, popup: false, contextMenu: true, settings: true },
      executionContexts: ["extension-page"],
      inputMode: "single",
      localOnly: true,
      capabilities: ["convert", "table", "copy", "download"],
      maxInputBytes: 5 * 1024 * 1024,
      allowedSources: ["action", "selection", "command"],
      entry: "table.convert",
      controls: [{ key: "mode", labelKey: "toolMode", type: "select", defaultValue: "csvToMarkdown", options: [
        ["csvToMarkdown", "toolCsvToMarkdown"], ["tsvToMarkdown", "toolTsvToMarkdown"],
        ["csvToTsv", "toolCsvToTsv"], ["tsvToCsv", "toolTsvToCsv"],
        ["csvToJson", "toolCsvToJson"], ["tsvToJson", "toolTsvToJson"],
        ["csvToXml", "toolCsvToXml"], ["tsvToXml", "toolTsvToXml"],
        ["csvToMysql", "toolCsvToMysql"], ["tsvToMysql", "toolTsvToMysql"],
        ["csvToPhp", "toolCsvToPhp"], ["tsvToPhp", "toolTsvToPhp"],
      ] }],
    },
  ];
  const categories = Object.freeze([
    Object.freeze({ id: "developer", labelKey: "toolCategoryDeveloper" }),
    Object.freeze({ id: "text", labelKey: "toolCategoryText" }),
    Object.freeze({ id: "generate", labelKey: "toolCategoryGenerate" }),
    Object.freeze({ id: "data", labelKey: "toolCategoryData" }),
  ]);
  const errors = contract.validateRegistry(descriptors);
  if (errors.length > 0) throw new Error(`工具注册表无效：${errors.join("；")}`);
  const entries = Object.freeze(descriptors.map(contract.cloneDescriptor));
  const byId = new Map(entries.map((descriptor) => [descriptor.id, descriptor]));
  const TOOL_IDS = Object.freeze(entries.map((descriptor) => descriptor.id));
  const DEFAULT_ACTION_TOOL_IDS = Object.freeze(TOOL_IDS.slice(0, 6));
  const DEFAULT_CONTEXT_MENU_TOOL_IDS = Object.freeze(TOOL_IDS.slice(0, 3));

  function get(id) {
    return byId.get(id) || null;
  }

  function has(id) {
    return byId.has(id);
  }

  function list({ source = null, surface = null } = {}) {
    return entries.filter((descriptor) =>
      (!source || descriptor.allowedSources.includes(source)) &&
      (!surface || descriptor.surfaces[surface] === true)
    );
  }

  function search(query = "", { source = null } = {}) {
    const normalized = String(query).trim().toLocaleLowerCase();
    return list({ source }).filter((descriptor) => {
      if (!normalized) return true;
      return [descriptor.id, descriptor.categoryId, descriptor.titleKey, descriptor.descriptionKey, ...descriptor.keywordKeys]
        .some((value) => String(value).toLocaleLowerCase().includes(normalized));
    });
  }

  function validateToolIds(ids, { max = Infinity, source = null, surface = null } = {}) {
    if (!Array.isArray(ids) || ids.length > max) return false;
    const seen = new Set();
    return ids.every((id) => {
      if (seen.has(id) || !has(id)) return false;
      seen.add(id);
      return (!source || get(id).allowedSources.includes(source)) &&
        (!surface || get(id).surfaces[surface] === true);
    });
  }

  globalThis.BrowserToolboxToolRegistry = Object.freeze({
    entries,
    TOOL_IDS,
    DEFAULT_ACTION_TOOL_IDS,
    DEFAULT_CONTEXT_MENU_TOOL_IDS,
    categories,
    get,
    has,
    list,
    search,
    validateToolIds,
  });
})();
