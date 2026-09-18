// 编码转换工具：所有解码路径都产生普通文本，不把结果解释成 HTML 或脚本。
(function () {
  const textEncoder = new TextEncoder();
  const message = (key, fallback) => globalThis.BrowserToolboxI18n?.message?.(key) || fallback;
  const codecError = (key, fallback) => new Error(message(key, fallback));

  function decodeText(bytes, charset = "utf-8") {
    try {
      // 保留文本开头的 BOM 字符，确保编码后再解码不会丢失输入。
      return new TextDecoder(charset, { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (_) {
      throw codecError("toolCodecInvalidUtf8", "字节序列不是有效的文本编码。");
    }
  }

  function encodeUnicode(value) {
    return Array.from(String(value), (char) => {
      const point = char.codePointAt(0);
      if (point >= 0xd800 && point <= 0xdfff) {
        throw codecError("toolCodecInvalidCodePoint", "Unicode 码点超出有效范围。");
      }
      return `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
    }).join(" ");
  }

  function decodeUnicode(value) {
    const tokens = String(value).trim().split(/[\s,]+/).filter(Boolean);
    return tokens.map((token) => {
      const normalized = token.replace(/^U\+/i, "");
      if (!/^[\da-f]{1,6}$/i.test(normalized)) {
        throw codecError(
          "toolCodecInvalidCodePoint",
          "Unicode 码点无效，请使用 U+4F60 这样的格式。",
        );
      }
      const codePoint = Number.parseInt(normalized, 16);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw codecError("toolCodecInvalidCodePoint", "Unicode 码点超出有效范围。");
      }
      return String.fromCodePoint(codePoint);
    }).join("");
  }

  function encodeBase64(value) {
    return bytesToBase64(textEncoder.encode(value));
  }

  function decodeBase64(value) {
    return decodeText(base64ToBytes(value));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    try {
      const binary = atob(String(value).replace(/[\t\n\f\r ]/g, ""));
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch (_) {
      throw codecError("toolCodecInvalidBase64", "Base64 格式无效。");
    }
  }

  function encodeUnicodeEscape(value) {
    const units = [];
    for (let index = 0; index < value.length; index++) {
      units.push(`\\u${value.charCodeAt(index).toString(16).padStart(4, "0")}`);
    }
    return units.join("");
  }

  function decodeUnicodeEscape(value) {
    // 逐段解释转义，替换结果不会再次参与解析，也不会执行输入中的脚本。
    return value.replace(/\\(?:u\{[^}]*\}?|u[\s\S]{0,4}|[\s\S]?)/g, (escape) => {
      if (/^\\u[\da-f]{4}$/i.test(escape)) {
        return String.fromCharCode(Number.parseInt(escape.slice(2), 16));
      }
      if (/^\\u\{[\da-f]{1,6}\}$/i.test(escape)) {
        const point = Number.parseInt(escape.slice(3, -1), 16);
        if (point <= 0x10ffff) return String.fromCodePoint(point);
      }
      throw codecError(
        "toolCodecInvalidEscape",
        "Unicode 转义无效，请使用 \\u4f60 或 \\u{1f600}。",
      );
    });
  }

  function decodeJsonString(value) {
    try {
      const decoded = JSON.parse(value);
      if (typeof decoded === "string") return decoded;
    } catch (_) {
      // 统一报告字符串输入错误，不把对象、数字等 JSON 值隐式转换成文本。
    }
    throw codecError("toolCodecInvalidJsonString", "请输入包含双引号的完整 JSON 字符串。");
  }

  function isXmlCharacter(point) {
    return point === 0x9 || point === 0xa || point === 0xd ||
      (point >= 0x20 && point <= 0xd7ff) || (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
  }

  function assertXmlCharacters(value) {
    for (const char of value) {
      if (!isXmlCharacter(char.codePointAt(0))) {
        throw codecError(
          "toolCodecInvalidXml",
          "XML 实体或字符无效，仅支持 XML 预定义实体和数字实体。",
        );
      }
    }
    return value;
  }

  function encodeXml(value) {
    return assertXmlCharacters(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  }

  function decodeXml(value) {
    const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    const decoded = value.replace(/&([^;\s&]*;)?/g, (match) => {
      const body = match.slice(1, -1);
      if (Object.hasOwn(entities, body)) return entities[body];
      const numeric = /^#(?:x[\da-fA-F]+|\d+)$/.test(body);
      const point = numeric
        ? Number.parseInt(body.slice(body[1] === "x" ? 2 : 1), body[1] === "x" ? 16 : 10)
        : -1;
      if (isXmlCharacter(point)) return String.fromCodePoint(point);
      throw codecError(
        "toolCodecInvalidXml",
        "XML 实体或字符无效，仅支持 XML 预定义实体和数字实体。",
      );
    });
    return assertXmlCharacters(decoded);
  }

  function encodeByteRadix(value, radix) {
    const width = radix === 2 ? 8 : radix === 8 ? 3 : 1;
    return Array.from(
      textEncoder.encode(value),
      (byte) => byte.toString(radix).padStart(width, "0"),
    ).join(" ");
  }

  function parseByteRadix(value, radix, maximum = 255) {
    const pattern = radix === 2 ? /^[01]{1,8}$/ : radix === 8 ? /^[0-7]{1,3}$/ : /^\d{1,3}$/;
    const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
    return Uint8Array.from(tokens, (token) => {
      const byte = Number.parseInt(token, radix);
      if (!pattern.test(token) || byte > maximum) {
        throw codecError(
          maximum === 127 ? "toolCodecInvalidAscii" : "toolCodecInvalidByte",
          maximum === 127
            ? "ASCII 仅支持 0–127 的字符和十进制编码。"
            : "请输入以空格分隔的有效字节，每个字节的值应在 0–255 之间。",
        );
      }
      return byte;
    });
  }

  function decodeByteRadix(value, radix) {
    return decodeText(parseByteRadix(value, radix));
  }

  function encodeAscii(value) {
    if (/[^\x00-\x7f]/.test(value)) {
      throw codecError("toolCodecInvalidAscii", "ASCII 仅支持 0–127 的字符和十进制编码。");
    }
    return encodeByteRadix(value, 10);
  }

  function decodeAscii(value) {
    return decodeText(parseByteRadix(value, 10, 127));
  }

  function transformUrl(value, mode) {
    try {
      return {
        urlEncode: encodeURIComponent,
        urlDecode: decodeURIComponent,
        uriEncode: encodeURI,
        uriDecode: decodeURI,
      }[mode](value);
    } catch (_) {
      throw codecError(
        "toolCodecInvalidUrl",
        "URL 转义无效，请检查百分号后是否是完整的 UTF-8 字节。",
      );
    }
  }

  function encodeDataUrl(value, file) {
    const bytes = file?.bytes || textEncoder.encode(value);
    const mime = file ? file.mime || "application/octet-stream" : "text/plain;charset=utf-8";
    if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;charset=[\w-]+)?$/i.test(mime)) {
      throw codecError("toolCodecInvalidDataUrl", "Data URL 格式或媒体类型无效。");
    }
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }

  function decodePercentBytes(value) {
    const bytes = textEncoder.encode(value);
    let length = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] === 0x25) {
        const pair = String.fromCharCode(bytes[index + 1], bytes[index + 2]);
        if (!/^[\da-f]{2}$/i.test(pair)) {
          throw codecError("toolCodecInvalidDataUrl", "Data URL 中的百分号转义无效。");
        }
        bytes[length++] = Number.parseInt(pair, 16);
        index += 2;
      } else {
        bytes[length++] = bytes[index];
      }
    }
    return bytes.subarray(0, length);
  }

  function decodeDataUrl(value) {
    const match = /^data:([^,]*),([\s\S]*)$/i.exec(value.trim());
    if (!match) {
      throw codecError("toolCodecInvalidDataUrl", "请输入完整的 data:媒体类型,内容 URL。");
    }
    const parts = match[1].split(";");
    const explicitMime = parts.shift();
    const mime = explicitMime.toLowerCase() || "text/plain";
    if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mime)) {
      throw codecError("toolCodecInvalidDataUrl", "Data URL 的媒体类型无效。");
    }
    let base64 = false;
    let charset = explicitMime ? "utf-8" : "us-ascii";
    for (const [index, part] of parts.entries()) {
      if (/^base64$/i.test(part) && index === parts.length - 1) base64 = true;
      else if (/^[\w!#$&^.+-]+=.+$/.test(part)) {
        if (/^charset=/i.test(part)) charset = part.slice(8).replace(/^"|"$/g, "");
      } else throw codecError("toolCodecInvalidDataUrl", "Data URL 的参数无效。");
    }
    const percentBytes = decodePercentBytes(match[2]);
    const bytes = base64 ? base64ToBytes(decodeText(percentBytes)) : percentBytes;
    const textual = /^text\//.test(mime) ||
      /(?:\/(?:json|xml|javascript)|\+(?:json|xml))$/.test(mime);
    let output;
    if (textual) {
      try {
        if (/^(?:us-ascii|ascii)$/i.test(charset) && bytes.some((byte) => byte > 127)) {
          throw new Error();
        }
        output = decodeText(bytes, charset);
      } catch (_) {
        // 无法作为文本读取时保留原始字节，下载时不会替换或丢弃非法字符。
      }
    }
    const binary = output === undefined;
    if (binary) {
      output = Array.from(bytes.subarray(0, 256), (byte) => byte.toString(16).padStart(2, "0"))
        .join(" ");
      if (bytes.length > 256) output += " …";
    }
    const suffixes = {
      "text/plain": "txt",
      "text/html": "html",
      "text/css": "css",
      "text/csv": "csv",
      "application/json": "json",
      "application/xml": "xml",
      "text/xml": "xml",
      "image/svg+xml": "svg",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "application/pdf": "pdf",
      "application/zip": "zip",
    };
    return {
      output,
      binary,
      download: { bytes, mime, filename: `decoded.${suffixes[mime] || "bin"}` },
      metadata: { mode: "dataUrlDecode", mime, bytes: bytes.length },
    };
  }

  function encodeHex(value) {
    return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
  }

  function decodeHex(value) {
    const compact = value.replace(/\s+/g, "");
    if (!/^(?:[\da-f]{2})*$/i.test(compact)) throw new Error("Hex 文本必须是完整的字节序列。");
    const bytes = Uint8Array.from(
      { length: compact.length / 2 },
      (_, index) => Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function encodeUtf8(value) {
    return encodeHex(value);
  }

  function decodeUtf8(value) {
    return decodeHex(value);
  }

  function encodeUtf16(value) {
    let output = "";
    for (let index = 0; index < value.length; index++) {
      if (index > 0) output += " ";
      output += value.charCodeAt(index).toString(16).padStart(4, "0");
    }
    return output;
  }

  function decodeUtf16(value) {
    const compact = value.replace(/\s+/g, "");
    if (!/^(?:[\da-f]{4})*$/i.test(compact)) throw new Error("UTF-16 文本必须是四位十六进制码元。");
    let output = "";
    for (let index = 0; index < compact.length; index += 4) {
      output += String.fromCharCode(Number.parseInt(compact.slice(index, index + 4), 16));
    }
    return output;
  }

  function encodeHtml(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function decodeHtml(value) {
    return value.replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|#39);/gi, (match, body) => {
      if (body.toLowerCase() === "amp") return "&";
      if (body.toLowerCase() === "lt") return "<";
      if (body.toLowerCase() === "gt") return ">";
      if (body.toLowerCase() === "quot") return '"';
      if (body.toLowerCase() === "apos" || body === "#39") return "'";
      const number = body.toLowerCase().startsWith("#x")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : match;
    });
  }

  function decodeJwt(value) {
    const parts = value.trim().split(".");
    if (parts.length !== 3) throw new Error("JWT 必须包含 header、payload 和 signature 三段。");
    const decodePart = (part) => {
      const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      return decodeBase64(padded);
    };
    let header;
    let payload;
    try {
      header = JSON.parse(decodePart(parts[0]));
      payload = JSON.parse(decodePart(parts[1]));
    } catch (_) {
      throw new Error("JWT header 或 payload 不是有效 JSON。");
    }
    return JSON.stringify({ header, payload, signature: parts[2] }, null, 2);
  }

  function parseCookie(value) {
    const entries = value.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? { name: part, value: "" }
        : { name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() };
    });
    return JSON.stringify(entries, null, 2);
  }

  function wordHex(value) {
    return Array.from({ length: 4 }, (_, index) =>
      ((value >>> (index * 8)) & 0xff)
        .toString(16).padStart(2, "0")).join("");
  }

  function leftRotate(value, amount) {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0;
  }

  // MD5 只用于旧系统兼容摘要；它不应被当作密码或签名算法。
  function md5(value) {
    const bytes = textEncoder.encode(String(value));
    const bitLength = bytes.length * 8;
    const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(bytes);
    buffer[bytes.length] = 0x80;
    const view = new DataView(buffer.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
    const shifts = [
      7,
      12,
      17,
      22,
      7,
      12,
      17,
      22,
      7,
      12,
      17,
      22,
      7,
      12,
      17,
      22,
      5,
      9,
      14,
      20,
      5,
      9,
      14,
      20,
      5,
      9,
      14,
      20,
      5,
      9,
      14,
      20,
      4,
      11,
      16,
      23,
      4,
      11,
      16,
      23,
      4,
      11,
      16,
      23,
      4,
      11,
      16,
      23,
      6,
      10,
      15,
      21,
      6,
      10,
      15,
      21,
      6,
      10,
      15,
      21,
      6,
      10,
      15,
      21,
    ];
    const constants = Array.from(
      { length: 64 },
      (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
    );
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    for (let offset = 0; offset < paddedLength; offset += 64) {
      const words = new Uint32Array(16);
      for (let index = 0; index < 16; index++) {
        words[index] = view.getUint32(offset + index * 4, true);
      }
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let index = 0; index < 64; index++) {
        let f;
        let g;
        if (index < 16) {
          f = (b & c) | (~b & d);
          g = index;
        } else if (index < 32) {
          f = (d & b) | (~d & c);
          g = (5 * index + 1) % 16;
        } else if (index < 48) {
          f = b ^ c ^ d;
          g = (3 * index + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * index) % 16;
        }
        const next = d;
        d = c;
        c = b;
        b = (b + leftRotate((a + f + constants[index] + words[g]) >>> 0, shifts[index])) >>> 0;
        a = next;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }
    return [a0, b0, c0, d0].map(wordHex).join("");
  }

  async function sha1(value) {
    if (!crypto.subtle?.digest) throw new Error("当前浏览器不支持 SHA-1 摘要。");
    const digest = await crypto.subtle.digest("SHA-1", textEncoder.encode(String(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  async function gzip(value, mode) {
    const Stream = mode === "compress"
      ? globalThis.CompressionStream
      : globalThis.DecompressionStream;
    if (!Stream) throw new Error("当前浏览器不支持 Gzip 流转换。");
    const stream = new Stream("gzip");
    const outputPromise = new Response(stream.readable).arrayBuffer();
    const writer = stream.writable.getWriter();
    const bytes = mode === "compress" ? textEncoder.encode(String(value)) : base64ToBytes(value);
    await writer.write(bytes);
    await writer.close();
    const output = new Uint8Array(await outputPromise);
    return mode === "compress"
      ? bytesToBase64(output)
      : new TextDecoder("utf-8", { fatal: true }).decode(output);
  }

  async function transform(input, { mode = "base64Encode", file } = {}) {
    const value = String(input);
    switch (mode) {
      case "unicodeEncode":
        return { output: encodeUnicode(value), metadata: { mode } };
      case "unicodeDecode":
        return { output: decodeUnicode(value), metadata: { mode } };
      case "utf8Encode":
        return { output: encodeUtf8(value), metadata: { mode, representation: "hex" } };
      case "utf8Decode":
        return { output: decodeUtf8(value), metadata: { mode, representation: "hex" } };
      case "base64Encode":
        return { output: encodeBase64(value), metadata: { mode } };
      case "base64Decode":
        return { output: decodeBase64(value), metadata: { mode } };
      case "hexEncode":
        return { output: encodeHex(value), metadata: { mode } };
      case "hexDecode":
        return { output: decodeHex(value), metadata: { mode } };
      case "utf16Encode":
        return { output: encodeUtf16(value), metadata: { mode } };
      case "utf16Decode":
        return { output: decodeUtf16(value), metadata: { mode } };
      case "urlEncode":
      case "urlDecode":
      case "uriEncode":
      case "uriDecode":
        return { output: transformUrl(value, mode), metadata: { mode } };
      case "unicodeEscapeEncode":
        return { output: encodeUnicodeEscape(value), metadata: { mode } };
      case "unicodeEscapeDecode":
        return { output: decodeUnicodeEscape(value), metadata: { mode } };
      case "jsonStringEncode":
        return { output: JSON.stringify(value), metadata: { mode } };
      case "jsonStringDecode":
        return { output: decodeJsonString(value), metadata: { mode } };
      case "xmlEncode":
        return { output: encodeXml(value), metadata: { mode } };
      case "xmlDecode":
        return { output: decodeXml(value), metadata: { mode } };
      case "binaryEncode":
      case "octalEncode":
      case "decimalEncode":
        return {
          output: encodeByteRadix(
            value,
            { binaryEncode: 2, octalEncode: 8, decimalEncode: 10 }[mode],
          ),
          metadata: { mode },
        };
      case "binaryDecode":
      case "octalDecode":
      case "decimalDecode":
        return {
          output: decodeByteRadix(
            value,
            { binaryDecode: 2, octalDecode: 8, decimalDecode: 10 }[mode],
          ),
          metadata: { mode },
        };
      case "asciiEncode":
        return { output: encodeAscii(value), metadata: { mode } };
      case "asciiDecode":
        return { output: decodeAscii(value), metadata: { mode } };
      case "dataUrlEncode":
        return { output: encodeDataUrl(value, file), metadata: { mode } };
      case "dataUrlDecode":
        return decodeDataUrl(value);
      case "htmlEncode":
        return { output: encodeHtml(value), metadata: { mode } };
      case "htmlDecode":
        return { output: decodeHtml(value), metadata: { mode } };
      case "jwtDecode":
        return {
          output: decodeJwt(value),
          metadata: {
            mode,
            warning: message(
              "toolJwtWarning",
              "JWT 仅解析结构，不验证签名或可信性。",
            ),
          },
        };
      case "cookieParse":
        return { output: parseCookie(value), metadata: { mode } };
      case "gzipCompress":
        return {
          output: await gzip(value, "compress"),
          metadata: { mode, outputEncoding: "base64" },
        };
      case "gzipDecompress":
        return {
          output: await gzip(value, "decompress"),
          metadata: { mode, inputEncoding: "base64" },
        };
      case "md5":
        return {
          output: md5(value),
          metadata: {
            mode,
            warning: message(
              "toolMd5Warning",
              "MD5 仅用于旧系统兼容，不适合安全用途。",
            ),
          },
        };
      case "sha1":
        return {
          output: await sha1(value),
          metadata: {
            mode,
            warning: message(
              "toolSha1Warning",
              "SHA-1 仅用于旧系统兼容，不适合安全用途。",
            ),
          },
        };
      default:
        throw new Error("未知的编码转换模式。");
    }
  }

  async function run(input, options = {}) {
    const maximum = globalThis.BrowserToolboxToolRuntime?.MAX_RENDER_BYTES || 10 * 1024 * 1024;
    const expansion = { binaryEncode: 9, octalEncode: 4, unicodeEscapeEncode: 6 }[options.mode];
    if (
      expansion &&
      (options.mode === "unicodeEscapeEncode"
              ? String(input).length
              : textEncoder.encode(input).length) * expansion > maximum
    ) {
      throw codecError("toolCodecOutputTooLarge", "转换结果超过 10 MiB，请缩小输入后重试。");
    }
    const result = await transform(input, options);
    if (textEncoder.encode(result.output).length > maximum) {
      throw codecError("toolCodecOutputTooLarge", "转换结果超过 10 MiB，请缩小输入后重试。");
    }
    return result;
  }

  globalThis.BrowserToolboxCodecTool = Object.freeze({
    run,
    encodeUnicode,
    decodeUnicode,
    encodeUnicodeEscape,
    decodeUnicodeEscape,
    decodeJsonString,
    encodeXml,
    decodeXml,
    encodeByteRadix,
    decodeByteRadix,
    encodeAscii,
    decodeAscii,
    encodeDataUrl,
    decodeDataUrl,
    encodeBase64,
    decodeBase64,
    bytesToBase64,
    base64ToBytes,
    encodeHex,
    decodeHex,
    encodeUtf8,
    decodeUtf8,
    encodeUtf16,
    decodeUtf16,
    decodeJwt,
    parseCookie,
    md5,
    sha1,
    gzip,
  });
})();
