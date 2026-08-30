// 编码转换工具：所有解码路径都产生普通文本，不把结果解释成 HTML 或脚本。
(function () {
  const textEncoder = new TextEncoder();
  const message = (key, fallback) => globalThis.BrowserToolboxI18n?.message?.(key) || fallback;

  function encodeUnicode(value) {
    return Array.from(String(value), (char) => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
      .join(" ");
  }

  function decodeUnicode(value) {
    const tokens = String(value).trim().split(/[\s,]+/).filter(Boolean);
    return tokens.map((token) => {
      const normalized = token.replace(/^U\+/i, "");
      if (!/^[\da-f]{1,6}$/i.test(normalized)) throw new Error("Unicode 码点格式无效。");
      const codePoint = Number.parseInt(normalized, 16);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw new Error("Unicode 码点超出有效范围。");
      }
      return String.fromCodePoint(codePoint);
    }).join("");
  }

  function encodeBase64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function decodeBase64(value) {
    const binary = atob(value.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value).replace(/\s+/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function encodeHex(value) {
    return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
  }

  function decodeHex(value) {
    const compact = value.replace(/\s+/g, "");
    if (!/^(?:[\da-f]{2})*$/i.test(compact)) throw new Error("Hex 文本必须是完整的字节序列。");
    const bytes = Uint8Array.from({ length: compact.length / 2 }, (_, index) =>
      Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16));
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
    return Array.from({ length: 4 }, (_, index) => ((value >>> (index * 8)) & 0xff)
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
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const constants = Array.from({ length: 64 }, (_, index) =>
      Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    for (let offset = 0; offset < paddedLength; offset += 64) {
      const words = new Uint32Array(16);
      for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, true);
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
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function gzip(value, mode) {
    const Stream = mode === "compress" ? globalThis.CompressionStream : globalThis.DecompressionStream;
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

  async function run(input, { mode = "base64Encode" } = {}) {
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
        return { output: encodeURIComponent(value), metadata: { mode } };
      case "urlDecode":
        return { output: decodeURIComponent(value), metadata: { mode } };
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
        return { output: await gzip(value, "compress"), metadata: { mode, outputEncoding: "base64" } };
      case "gzipDecompress":
        return { output: await gzip(value, "decompress"), metadata: { mode, inputEncoding: "base64" } };
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

  globalThis.BrowserToolboxCodecTool = Object.freeze({
    run,
    encodeUnicode,
    decodeUnicode,
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
