// SPDX-License-Identifier: GPL-3.0-or-later
import { openUrlInNewTab } from "../tab_operations.js";

async function resolveDestinations(url, options) {
  if (url) return [url];
  const keys = Object.keys(options);
  const accepted = await Promise.all(keys.map((key) => UrlUtils.isUrl(key)));
  const mapped = keys.filter((_, index) => accepted[index]);
  if (mapped.length) return mapped;
  const destination = Settings.get("newTabDestination");
  const custom = Settings.get("newTabCustomUrl");
  if (destination === Settings.newTabDestinations.vimiumNewTabPage) {
    return [Settings.vimiumNewTabPageUrl];
  }
  return [
    destination === Settings.newTabDestinations.customUrl && custom.length
      ? custom
      : UrlUtils.chromeNewTabUrl,
  ];
}

export async function createTab(
  { count, tab, url, position, active, registryEntry, executionGuard },
) {
  const options = registryEntry.options;
  const destinations = await resolveDestinations(url, options);
  if (options.window || options.incognito) {
    // 原生新标签由浏览器创建；不可把 Firefox 的 about:newtab 显式传给窗口 API。
    const urls = destinations.filter((value) => value !== UrlUtils.chromeNewTabUrl);
    for (let repeat = 0; repeat < count; repeat++) {
      await executionGuard();
      await chrome.windows.create({ url: urls, incognito: options.incognito || false });
    }
    return;
  }
  let previous = tab;
  let first = true;
  for (let repeat = 0; repeat < count; repeat++) {
    for (const destination of destinations) {
      // 只有第一张使用映射位置和前台策略，其余紧接已创建标签且不抢焦点。
      previous = await openUrlInNewTab({
        tab: previous,
        url: destination,
        position: first ? position ?? options.position : "after",
        active: first ? active : false,
        executionGuard,
      });
      first = false;
    }
  }
}

globalThis.BrowserToolboxNewTabCommands = Object.freeze({ createTab });
