// 时间转换工具：明确单位并拒绝无效日期，避免把本地输入发送到外部服务。
(function () {
  function parseIso(value) {
    const text = String(value).trim();
    if (!text) throw new Error("ISO 日期无效。");
    // 无时区的日期时间会依赖设备本地时区；拒绝静默猜测，日期-only 则按 ISO 规则视为 UTC。
    const hasTime = /\d[T ]\d/.test(text);
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    if (hasTime && !hasZone) throw new Error("ISO 日期时间必须明确包含时区（Z 或 UTC 偏移量）。");
    const timestamp = Date.parse(text);
    if (!Number.isFinite(timestamp)) throw new Error("ISO 日期无效。");
    return timestamp;
  }

  function run(input, options = {}) {
    const { mode = "isoToTimestamp", timezone = "UTC" } = options;
    const value = String(input).trim();
    if (mode === "isoToUnixSeconds" || mode === "isoToTimestamp") {
      const timestamp = parseIso(value);
      return { output: String(Math.floor(timestamp / 1000)), metadata: { mode, milliseconds: timestamp } };
    }
    if (mode === "isoToUnixMilliseconds") {
      const timestamp = parseIso(value);
      return { output: String(timestamp), metadata: { mode, milliseconds: timestamp } };
    }
    if (mode === "unixSecondsToIso" || mode === "timestampToIso") {
      const number = Number(value);
      if (!Number.isFinite(number) || Math.abs(number) > 8640000000) {
        throw new Error("Unix 时间戳无效或超出范围。");
      }
      const milliseconds = number * 1000;
      const date = new Date(milliseconds);
      if (Number.isNaN(date.getTime())) throw new Error("Unix 时间戳无效。");
      return { output: date.toISOString(), metadata: { mode, milliseconds } };
    }
    if (mode === "unixMillisecondsToIso") {
      const number = Number(value);
      if (!Number.isFinite(number) || Math.abs(number) > 8640000000000) {
        throw new Error("Unix 毫秒时间戳无效或超出范围。");
      }
      const milliseconds = number;
      const date = new Date(milliseconds);
      if (Number.isNaN(date.getTime())) throw new Error("Unix 时间戳无效。");
      return { output: date.toISOString(), metadata: { mode, milliseconds } };
    }
    if (mode === "isoToTimezone") {
      const timestamp = parseIso(value);
      try {
        const formatted = new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(new Date(timestamp));
        return { output: formatted, metadata: { mode, timezone } };
      } catch (_) {
        throw new Error("时区名称无效。");
      }
    }
    if (mode === "unixToFiletime") {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || Math.abs(seconds) > 8640000000) {
        throw new Error("Unix 秒时间戳无效。");
      }
      const filetime = (BigInt(Math.trunc(seconds)) * 10000000n) + 116444736000000000n;
      return { output: filetime.toString(), metadata: { mode, unit: "100ns" } };
    }
    if (mode === "filetimeToUnix") {
      let filetime;
      try {
        filetime = BigInt(value);
      } catch (_) {
        throw new Error("Windows FILETIME 必须是整数。");
      }
      const seconds = (filetime - 116444736000000000n) / 10000000n;
      return { output: seconds.toString(), metadata: { mode, unit: "seconds" } };
    }
    throw new Error("未知的时间转换模式。");
  }

  globalThis.BrowserToolboxTimeTool = Object.freeze({ run });
})();
