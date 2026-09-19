// _locales 是翻译的唯一事实源；生成同步可用的内置文案，避免内容脚本首开等待异步加载。
const projectRoot = new URL("../", import.meta.url);
const runtimeFile = new URL("lib/i18n.js", projectRoot);
const startMarker = "  // 本地化消息开始：由 scripts/sync_i18n.js 生成，请修改 _locales。";
const endMarker = "  // 本地化消息结束。";

export async function synchronizeCatalogs({ check = false } = {}) {
  const locales = [];
  for await (const entry of Deno.readDir(new URL("_locales/", projectRoot))) {
    if (entry.isDirectory) locales.push(entry.name);
  }
  const catalogs = {};
  for (const locale of locales.sort()) {
    const entries = JSON.parse(
      await Deno.readTextFile(new URL(`_locales/${locale}/messages.json`, projectRoot)),
    );
    catalogs[locale] = Object.fromEntries(
      Object.entries(entries).map(([key, entry]) => {
        if (typeof entry.message !== "string" || !entry.message.trim()) {
          throw new Error(`${locale}.${key} 缺少翻译`);
        }
        return [key, entry.message];
      }),
    );
  }
  const keys = Object.keys(catalogs.en).sort();
  const tokens = (text) =>
    (text.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}|\$[a-zA-Z0-9_]+\$/g) || []).sort();
  for (const [locale, catalog] of Object.entries(catalogs)) {
    if (JSON.stringify(Object.keys(catalog).sort()) !== JSON.stringify(keys)) {
      throw new Error(`${locale} 的文案键与英文不一致`);
    }
    for (const key of keys) {
      if (JSON.stringify(tokens(catalog[key])) !== JSON.stringify(tokens(catalogs.en[key]))) {
        throw new Error(`${locale}.${key} 的占位符与英文不一致`);
      }
    }
  }
  const lines = [startMarker, "  // deno-fmt-ignore", "  const catalogs = {"];
  for (const [locale, catalog] of Object.entries(catalogs)) {
    lines.push(`    ${JSON.stringify(locale)}: {`);
    for (const [key, value] of Object.entries(catalog)) {
      lines.push(`      ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    }
    lines.push("    },");
  }
  lines.push("  };", endMarker);
  const source = await Deno.readTextFile(runtimeFile);
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < start) throw new Error("未找到内置文案的生成区间");
  const result = source.slice(0, start) + lines.join("\n") + source.slice(end + endMarker.length);
  if (check && result !== source) {
    throw new Error(
      "内置文案未同步，请运行 deno run --allow-read --allow-write scripts/sync_i18n.js",
    );
  }
  if (!check && result !== source) await Deno.writeTextFile(runtimeFile, result);
  return { locales, messageCount: keys.length };
}

if (import.meta.main) {
  const result = await synchronizeCatalogs({ check: Deno.args.includes("--check") });
  console.log(
    `本地化一致性检查通过：${result.locales.length} 种语言，每种 ${result.messageCount} 条文案。`,
  );
}
