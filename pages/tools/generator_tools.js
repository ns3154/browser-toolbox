// ID 和密码工具：随机源固定使用 Web Crypto，不记录或上传生成结果。
(function () {
  const runtime = globalThis.BrowserToolboxToolRuntime;
  const UUID_HEX = "0123456789abcdef";

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = runtime.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let output = "";
    for (const [index, byte] of bytes.entries()) {
      output += byte.toString(16).padStart(2, "0");
      if ([3, 5, 7, 9].includes(index)) output += "-";
    }
    return output;
  }

  function ulid() {
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let time = Date.now();
    let timePart = "";
    for (let index = 0; index < 10; index++) {
      timePart = alphabet[time % 32] + timePart;
      time = Math.floor(time / 32);
    }
    let randomPart = "";
    const bytes = runtime.randomBytes(16);
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
      buffer = (buffer << 8) | byte;
      bits += 8;
      while (bits >= 5 && randomPart.length < 16) {
        bits -= 5;
        randomPart += alphabet[(buffer >> bits) & 31];
      }
    }
    while (randomPart.length < 16) randomPart += alphabet[runtime.randomBytes(1)[0] & 31];
    return timePart + randomPart;
  }

  function nanoid() {
    const alphabet = "_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let output = "";
    const limit = 256 - (256 % alphabet.length);
    while (output.length < 21) {
      for (const byte of runtime.randomBytes(32)) {
        if (byte >= limit) continue;
        output += alphabet[byte % alphabet.length];
        if (output.length === 21) break;
      }
    }
    return output;
  }

  function snowflake() {
    const epoch = 1577836800000n;
    const timestamp = BigInt(Date.now()) - epoch;
    const bytes = runtime.randomBytes(4);
    const random = BigInt(((bytes[0] << 14) | (bytes[1] << 6) | (bytes[2] & 63)) >>> 0);
    return ((timestamp << 22n) | (random & 4194303n)).toString();
  }

  function generateId({ mode = "uuid", count = 1 } = {}) {
    const safeCount = Math.min(20, Math.max(1, Number(count) || 1));
    const generators = { uuid, ulid, snowflake, nanoid };
    if (!generators[mode]) throw new Error("未知的 ID 生成模式。");
    const values = Array.from({ length: safeCount }, () => generators[mode]());
    return { output: values.join("\n"), metadata: { mode, count: safeCount } };
  }

  function generatePassword({ length = 20, symbols = true } = {}) {
    const safeLength = Math.min(256, Math.max(8, Number(length) || 20));
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789" +
      (symbols ? "!@#$%^&*()-_=+[]{}:,.?" : "");
    let output = "";
    const limit = 256 - (256 % alphabet.length);
    while (output.length < safeLength) {
      for (const byte of runtime.randomBytes(safeLength * 2)) {
        if (byte >= limit) continue;
        output += alphabet[byte % alphabet.length];
        if (output.length === safeLength) break;
      }
    }
    return { output, metadata: { length: safeLength, symbols } };
  }

  globalThis.BrowserToolboxGeneratorTools = Object.freeze({
    generateId,
    generatePassword,
    uuid,
    ulid,
    snowflake,
    nanoid,
  });
})();
