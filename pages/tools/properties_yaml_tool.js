// SPDX-License-Identifier: GPL-3.0-or-later
// 配置转换只在本地运行；路径树使用 Map，避免特殊键改变对象原型。
import {
  Document,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
} from "../../vendor/yaml.js";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_NODES = 20000;
const MAX_DEPTH = 64;
const MAX_INDEX = 10000;
const encoder = new TextEncoder();

function fail(messageKey, line = 0, column = 0) {
  throw Object.assign(new Error(messageKey), { messageKey, line, column });
}

function unescapeProperty(text, line) {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    let char = text[i];
    if (char === "\\") {
      char = text[++i];
      if (char === "u") {
        const hex = text.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("toolConfigUnicodeError", line);
        result += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
      char = ({ n: "\n", r: "\r", t: "\t", f: "\f" })[char] ?? char ?? "";
    }
    result += char;
  }
  return result;
}

function parseProperties(input) {
  const physical = input.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const entries = [];
  let logical = "";
  let startLine = 1;
  let continued = false;
  for (let i = 0; i < physical.length; i++) {
    const part = physical[i].replace(/^[ \t\f]+/, "");
    if (!continued) {
      if (!part || /^[#!]/.test(part)) continue;
      startLine = i + 1;
    }
    const slashCount = part.match(/\\+$/)?.[0].length || 0;
    continued = slashCount % 2 === 1;
    logical += continued ? part.slice(0, -1) : part;
    if (continued && i < physical.length - 1) continue;
    let end = 0;
    while (end < logical.length) {
      if (logical[end] === "\\") end += 2;
      else if (/[=: \t\f]/.test(logical[end])) break;
      else end++;
    }
    let valueStart = end;
    while (/[ \t\f]/.test(logical[valueStart] || "\0")) valueStart++;
    if (/[=:]/.test(logical[valueStart] || "\0")) valueStart++;
    while (/[ \t\f]/.test(logical[valueStart] || "\0")) valueStart++;
    entries.push({
      key: unescapeProperty(logical.slice(0, end), startLine),
      value: unescapeProperty(logical.slice(valueStart), startLine),
      line: startLine,
    });
    if (entries.length > MAX_NODES) fail("toolConfigLimit", startLine);
    logical = "";
    continued = false;
  }
  return entries;
}

function parsePath(key, line) {
  const path = [];
  let offset = 0;
  let needsName = false;
  while (offset < key.length) {
    if (key[offset] === "[" && !needsName) {
      const match = /^\[(0|[1-9][0-9]*)\]/.exec(key.slice(offset));
      if (!match || Number(match[1]) > MAX_INDEX) fail("toolConfigInvalidPath", line);
      path.push(Number(match[1]));
      offset += match[0].length;
    } else {
      const match = /^[^.\[\]]+/.exec(key.slice(offset));
      if (!match) fail("toolConfigInvalidPath", line);
      path.push(match[0]);
      offset += match[0].length;
      needsName = false;
    }
    if (path.length > MAX_DEPTH) fail("toolConfigLimit", line);
    if (offset === key.length) break;
    if (key[offset] === ".") {
      offset++;
      needsName = true;
      if (offset === key.length) fail("toolConfigInvalidPath", line);
    } else if (key[offset] !== "[") fail("toolConfigInvalidPath", line);
  }
  if (!path.length) fail("toolConfigInvalidPath", line);
  return path;
}

function propertiesToYaml(input, indent) {
  const entries = parseProperties(input);
  if (!entries.length) return { output: "", count: 0 };
  let root;
  let nodes = 0;
  const branch = (part, line) => ({
    kind: typeof part === "number" ? "seq" : "map",
    children: new Map(),
    line,
  });
  for (const entry of entries) {
    const path = parsePath(entry.key, entry.line);
    root ||= branch(path[0], entry.line);
    let parent = root;
    for (let i = 0; i < path.length; i++) {
      const part = path[i];
      if (parent.kind !== (typeof part === "number" ? "seq" : "map")) {
        fail("toolConfigConflict", entry.line);
      }
      const existing = parent.children.get(part);
      if (i === path.length - 1) {
        if (existing) {
          fail(
            existing.kind === "value" ? "toolConfigDuplicate" : "toolConfigConflict",
            entry.line,
          );
        }
        parent.children.set(part, { kind: "value", value: entry.value });
        nodes++;
      } else {
        if (existing?.kind === "value") fail("toolConfigConflict", entry.line);
        if (!existing) {
          parent.children.set(part, branch(path[i + 1], entry.line));
          nodes++;
        }
        parent = parent.children.get(part);
      }
      if (nodes > MAX_NODES) fail("toolConfigLimit", entry.line);
    }
  }
  const materialize = (node) => {
    if (node.kind === "value") return node.value;
    if (node.kind === "map") {
      return new Map([...node.children].map(([key, value]) => [key, materialize(value)]));
    }
    const result = [];
    for (let index = 0; index < node.children.size; index++) {
      if (!node.children.has(index)) fail("toolConfigSparseArray", node.line);
      result.push(materialize(node.children.get(index)));
    }
    return result;
  };
  const document = new Document(materialize(root), { version: "1.2" });
  return { output: document.toString({ indent, lineWidth: 0 }), count: entries.length };
}

function escapeProperty(text, key = false) {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const code = text.charCodeAt(index);
    const next = text.charCodeAt(index + 1);
    const previous = text.charCodeAt(index - 1);
    const orphanSurrogate =
      (code >= 0xd800 && code <= 0xdbff && !(next >= 0xdc00 && next <= 0xdfff)) ||
      (code >= 0xdc00 && code <= 0xdfff && !(previous >= 0xd800 && previous <= 0xdbff));
    const escaped = ({ "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\f": "\\f" })[char];
    if (escaped) result += escaped;
    else if ((char === " " && (key || index === 0)) || (key && /[=:#!]/.test(char))) {
      result += `\\${char}`;
    } else if (/[\x00-\x1f\x7f]/.test(char) || orphanSurrogate) {
      // 孤立代理项必须写成转义，避免 UTF-8 下载时被替换成其他字符。
      result += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    } else result += char;
  }
  return result;
}

function yamlToProperties(input) {
  const lines = new LineCounter();
  const document = parseDocument(input, {
    version: "1.2",
    schema: "core",
    intAsBigInt: true,
    uniqueKeys: true,
    stringKeys: true,
    strict: true,
    lineCounter: lines,
  });
  const issue = document.errors[0] || document.warnings[0];
  if (issue) {
    const position = lines.linePos(issue.pos?.[0] || 0);
    fail(
      issue.code === "DUPLICATE_KEY" ? "toolConfigDuplicate" : "toolConfigYamlSyntax",
      position.line,
      position.col,
    );
  }
  const location = (node) => lines.linePos(node?.range?.[0] || 0);
  const reject = (key, node) => {
    const pos = location(node);
    fail(key, pos.line, pos.col);
  };
  if (!isMap(document.contents) && !isSeq(document.contents)) {
    reject("toolConfigRoot", document.contents);
  }
  const output = [];
  let bytes = 0;
  let nodes = 0;
  const seen = new Set();
  const walk = (node, path, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) reject("toolConfigLimit", node);
    if (node?.tag && !/^tag:yaml\.org,2002:(?:str|bool|int|float|null|map|seq)$/.test(node.tag)) {
      reject("toolConfigYamlSyntax", node);
    }
    if (isAlias(node)) reject("toolConfigAlias", node);
    if (isMap(node) || isSeq(node)) {
      if (!node.items.length) reject("toolConfigEmptyCollection", node);
      if (isMap(node)) {
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
            reject("toolConfigInvalidPath", pair.key);
          }
          const key = pair.key.value;
          if (key === "<<") reject("toolConfigAlias", pair.key);
          if (!key || /[.\[\]]/.test(key)) reject("toolConfigAmbiguousKey", pair.key);
          walk(pair.value, path ? `${path}.${key}` : key, depth + 1);
        }
      } else {
        if (node.items.length > MAX_INDEX + 1) reject("toolConfigLimit", node);
        node.items.forEach((child, index) => walk(child, `${path}[${index}]`, depth + 1));
      }
      return;
    }
    if (!isScalar(node) || node.value == null) reject("toolConfigNull", node);
    if (seen.has(path)) reject("toolConfigConflict", node);
    seen.add(path);
    // 数值原文优先于 JavaScript number，避免浮点与长数字的精度变化。
    const value = typeof node.value === "string" ? node.value : node.source ?? String(node.value);
    const line = `${escapeProperty(path, true)}=${escapeProperty(value)}`;
    bytes += encoder.encode(line).length + 1;
    if (bytes > MAX_OUTPUT_BYTES) reject("toolConfigLimit", node);
    output.push(line);
  };
  walk(document.contents, "", 0);
  return { output: output.join("\n") + "\n", count: output.length };
}

function lineCount(value) {
  return value ? value.replace(/\r\n|\r/g, "\n").replace(/\n$/, "").split("\n").length : 0;
}

export function run(input, { direction = "propertiesToYaml", indent = 2 } = {}) {
  if (typeof input !== "string" || encoder.encode(input).length > MAX_INPUT_BYTES) {
    fail("toolConfigLimit");
  }
  if (!["propertiesToYaml", "yamlToProperties"].includes(direction)) fail("toolInvalid");
  if (![2, 4].includes(Number(indent))) fail("toolInvalid");
  const result = !input.trim()
    ? { output: "", count: 0 }
    : direction === "propertiesToYaml"
    ? propertiesToYaml(input, Number(indent))
    : yamlToProperties(input);
  if (encoder.encode(result.output).length > MAX_OUTPUT_BYTES) fail("toolConfigLimit");
  return {
    output: result.output,
    metadata: {
      count: result.count,
      inputLines: lineCount(input),
      outputLines: lineCount(result.output),
    },
    extension: direction === "propertiesToYaml" ? "yaml" : "properties",
  };
}

export function runInWorker(input, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("properties_yaml_worker.js", import.meta.url), {
      type: "module",
    });
    const finish = (callback, value) => {
      clearTimeout(timer);
      worker.terminate();
      callback(value);
    };
    const timer = setTimeout(() =>
      finish(
        reject,
        Object.assign(new Error("toolConfigTimeout"), {
          messageKey: "toolConfigTimeout",
        }),
      ), 5000);
    worker.onmessage = ({ data }) => {
      if (data.error) finish(reject, Object.assign(new Error(data.error.messageKey), data.error));
      else finish(resolve, data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(
        reject,
        Object.assign(new Error("toolConfigWorkerError"), { messageKey: "toolConfigWorkerError" }),
      );
    };
    worker.postMessage({ input, options });
  });
}

globalThis.BrowserToolboxPropertiesYamlTool = Object.freeze({ run, runInWorker, lineCount });
