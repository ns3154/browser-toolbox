// SPDX-License-Identifier: GPL-3.0-or-later
// 候选模型与排序由本模块拥有；URL、HTML转义只使用公共无状态工具。
export const termsFor = (query) => query.trim().split(/\s+/).filter(Boolean);
const expression = (term, prefix = "", suffix = "", global = false) =>
  new RegExp(
    prefix + Utils.escapeRegexSpecialCharacters(term) + suffix,
    (Utils.hasUpperCase(term) ? "" : "i") + (global ? "g" : ""),
  );
const check = (terms, values, compile) =>
  terms.every((term) => values.some((value) => compile(term).test(value || "")));
export const matches = (terms, ...values) => check(terms, values, expression);

function wordScoreField(text, entries) {
  let score = 0, count = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const globalPattern = entry.global;
    globalPattern.lastIndex = 0;
    let match = globalPattern.exec(text);
    if (!match) continue;
    // 直接累计全局正则命中长度，避免为每个候选分片分配数组。
    let matchedLength = 0;
    do {
      const piece = match[0].length;
      matchedLength += piece;
      if (!piece) globalPattern.lastIndex++;
    } while ((match = globalPattern.exec(text)) !== null);
    score += 1;
    count += Math.min(text.length, matchedLength);
    if (entry.begin.test(text)) {
      score++;
      if (entry.whole.test(text)) score++;
    }
  }
  const maximum = Math.max(count, text.length);
  return score / (3 * entries.length) *
    (maximum ? (maximum - Math.abs(count - text.length)) / maximum : 0);
}

function wordScoreEntries(entries, url, title) {
  if (!entries.length) return 0;
  const urlScore = wordScoreField(url || "", entries);
  const titleScore = title ? wordScoreField(title, entries) : urlScore;
  return (Math.max(urlScore, titleScore) + titleScore) / 2;
}

export function wordScore(terms, url, title, compile = expression) {
  if (!terms.length) return 0;
  const entries = terms.map((term) => ({
    global: compile(term, "", "", true),
    begin: compile(term, "\\b"),
    whole: compile(term, "\\b", "\\b"),
  }));
  return wordScoreEntries(entries, url, title);
}
export function recentScore(timestamp, now = Date.now()) {
  const month = 30 * 24 * 60 * 60 * 1000;
  return (Math.max(0, month - (now - timestamp)) / month) ** 3 * (2 / 3);
}
export const historyScore = (terms, url, title, timestamp, now = Date.now(), compile = expression) => {
  const recent = recentScore(timestamp, now);
  if (!terms.length) return recent;
  const words = wordScore(terms, url, title, compile);
  return (words + Math.max(words, recent)) / 2;
};
export function prepareQuery(terms) {
  // 正则只在本次查询内复用；并发查询和普通/无痕会话不共享搜索文字或可变匹配状态。
  terms = [...terms];
  const entries = terms.map((term) => ({
    plain: expression(term),
    global: expression(term, "", "", true),
    begin: expression(term, "\\b"),
    whole: expression(term, "\\b", "\\b"),
  }));
  const cache = new Map(terms.map((term, index) => [term, entries[index]]));
  const compile = (term, prefix = "", suffix = "", global = false) => {
    const item = cache.get(term);
    if (global && !prefix && !suffix) return item.global;
    return suffix ? item.whole : prefix ? item.begin : item.plain;
  };
  return {
    // 热点补全循环固定传入 (url, title)，避免每次扫描都分配剩余参数数组和闭包。
    matches: (first = "", second = "", ...rest) => {
      if (rest.length) return check(terms, [first, second, ...rest], compile);
      const a = first || "";
      const b = second || "";
      for (let index = 0; index < entries.length; index++) {
        const plain = entries[index].plain;
        if (!plain.test(a) && !plain.test(b)) return false;
      }
      return true;
    },
    wordScore: (url, title) => wordScoreEntries(entries, url, title),
    historyScore: (url, title, timestamp, now) => {
      const recent = recentScore(timestamp, now);
      if (!entries.length) return recent;
      const words = wordScoreEntries(entries, url, title);
      return (words + Math.max(words, recent)) / 2;
    },
  };
}
export const boostScore = (factor, score) => score + (score < .5 ? score : 1 - score) * factor;

export function shortUrl(value) {
  let url = (Utils.decodeURIByParts(value) || value).toLowerCase();
  const google = "https?://www\\.google\\.(com|ca|com\\.au|co\\.uk|ie)/";
  if (new RegExp("^" + google + ".*[&?]q=").test(url)) {
    for (
      const param of "ei gws_rd url ved usg sa usg sig2 bih biw cd aqs ie sourceid es_sm".split(" ")
    ) {
      url = url.replace(new RegExp("&" + param + "=[^&]+"), "");
    }
  }
  if (new RegExp("^" + google + "maps/place/.*/@").test(url)) url = url.replace(/\/@.*/, "");
  return url.replace(/^https?:\/\//, "").replace(/\W+$/, "");
}
export function candidate(fields) {
  return {
    title: "",
    autoSelect: false,
    highlightTerms: true,
    deDuplicate: true,
    isPrimarySuggestion: false,
    ...fields,
  };
}
export function highlight(text, terms, enabled = true) {
  let escaped = Utils.escapeHtml(text || "");
  if (!enabled) return escaped;
  const ranges = [];
  for (const term of terms) {
    for (const match of escaped.matchAll(expression(Utils.escapeHtml(term), "", "", true))) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && previous[1] >= range[0]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  for (const [start, end] of merged.reverse()) {
    escaped = escaped.slice(0, start) + `<span class='match'>${escaped.slice(start, end)}</span>` +
      escaped.slice(end);
  }
  return escaped;
}
export function render(candidate, api = chrome, firefox = false) {
  if (candidate.insertText && candidate.isCustomSearch) candidate.title = candidate.insertText;
  const arrow = "&#8618;";
  const title = highlight(candidate.title, candidate.queryTerms, candidate.highlightTerms);
  const top = `<div class="top-half"><span class="source ${
    candidate.insertText ? "" : "no-insert-text"
  }">${arrow}</span><span class="source">${
    Utils.escapeHtml(candidate.description)
  }</span><span class="title">${title}</span></div>`;
  if (candidate.isCustomSearch) return top;
  let icon = "";
  if (candidate.description === "tab" && !firefox) {
    const url = new URL(api.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", candidate.url);
    url.searchParams.set("size", "16");
    icon = `<img class="icon" src="${Utils.escapeHtml(url.toString())}" />`;
  }
  return top +
    `<div class="bottom-half"><span class="source no-insert-text">${arrow}</span>${icon}<span class="url">${
      highlight(candidate.shortUrl, candidate.queryTerms, candidate.highlightTerms)
    }</span></div>`;
}
export function finish(candidates, api, firefox, { inPlace = false } = {}) {
  // 调用方独占当次数组时允许原地排序，避免高频补全查询复制数千条候选引用。
  const sorted = inPlace ? candidates : [...candidates];
  sorted.sort((a, b) => b.relevancy - a.relevancy);
  const seen = new Set(), results = [];
  for (const item of sorted) {
    item.shortUrl ??= shortUrl(item.url);
    if (item.deDuplicate && seen.has(item.shortUrl)) continue;
    if (results.length === 10) break;
    seen.add(item.shortUrl);
    item.html = render(item, api, firefox);
    results.push(item);
  }
  return results;
}
export function bookmarks(tree) {
  const ignored = new Set(["Other Bookmarks", "Mobile Bookmarks", "Bookmarks Bar"]);
  const pending = [...tree].reverse().map((node) => ({ node, parent: "" })), result = [];
  while (pending.length) {
    const { node, parent } = pending.pop();
    const path = node.title && !(parent === "" && ignored.has(node.title))
      ? parent + "/" + node.title
      : parent;
    if (node.url != null) {
      result.push({
        ...node,
        title: node.title || "",
        pathAndTitle: path,
        isJavascript: UrlUtils.hasJavascriptProtocol(node.url),
      });
    }
    for (const child of [...node.children || []].reverse()) {
      pending.push({ node: child, parent: path });
    }
  }
  return result;
}
