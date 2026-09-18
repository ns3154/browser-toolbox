// 审计新增模块的网络调用。上游 Vimium 的既有搜索和本地资源读取不在本脚本范围内。
const roots = [
  "lib/browser_toolbox",
  "background_scripts/browser_toolbox",
  "content_scripts/mouse",
  "content_scripts/document_formatter",
  "pages/mouse_options.js",
  "pages/tab_list.js",
  "pages/tools",
  "vendor/yaml.js",
];
const patterns = [
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\s*\(/, "sendBeacon"],
  [/\bimportScripts\s*\(/, "importScripts"],
  [/\bhttps?:\/\//, "http(s) URL"],
];
const allowed = [
  // 站点规则中的 URL 是匹配数据，不是网络调用；保持文件和文本双重精确匹配，避免放宽真正的网络审计。
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://docs.google.com/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://*.notion.so/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://stackblitz.com/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://codesandbox.io/*" },
  { file: "lib/browser_toolbox/settings_schema.js", text: "https://codepen.io/*" },
  {
    file: "background_scripts/browser_toolbox/browser_command_adapter.js",
    text: "www.google.com/search",
  },
  { file: "lib/browser_toolbox/command_invocation.js", text: "browsertoolbox.invalid" },
  { file: "content_scripts/mouse/drag_context_classifier.js", text: "browsertoolbox.invalid" },
  { file: "content_scripts/mouse/gesture_overlay.js", text: "www.w3.org/2000/svg" },
  { file: "lib/browser_toolbox/tools/tool_icons.js", text: "www.w3.org/2000/svg" },
  { file: "content_scripts/document_formatter/document_formatter.js", text: "www.w3.org/1999/xhtml" },
  { file: "pages/mouse_options.js", text: "www.w3.org/2000/svg" },
  { file: "pages/mouse_options.js", text: "https://example.com/*" },
];
const files = [];

async function collect(root) {
  try {
    const stat = await Deno.stat(root);
    if (stat.isFile) files.push(root);
    else {
      for await (const entry of Deno.readDir(root)) await collect(`${root}/${entry.name}`);
    }
  } catch (_) {
    console.error(`无法读取审计目标: ${root}`);
    Deno.exit(1);
  }
}

for (const root of roots) await collect(root);
const findings = [];
for (const file of files) {
  const lines = (await Deno.readTextFile(file)).split("\n");
  lines.forEach((line, index) => {
    for (const [regexp, label] of patterns) {
      if (!regexp.test(line)) continue;
      const isAllowed = allowed.some((item) => item.file === file && line.includes(item.text));
      if (!isAllowed) findings.push(`${file}:${index + 1}: ${label}`);
    }
  });
}

if (findings.length > 0) {
  console.error("发现未列入白名单的新增网络调用：");
  console.error(findings.join("\n"));
  Deno.exit(1);
}
console.log(`网络审计通过：已扫描 ${files.length} 个新增模块文件，未发现后台或隐式网络调用。`);
