// 时间转换工具：明确单位并拒绝无效日期，避免把本地输入发送到外部服务。
(function () {
  const FILETIME_EPOCH = 116444736000000000n;

  function pad(value, length = 2) {
    return String(value).padStart(length, "0");
  }

  function formatLocalDate(milliseconds, includeMilliseconds = true) {
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) throw new Error("时间无效。");
    const result = [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    ].join(" ");
    return includeMilliseconds ? `${result}.${pad(date.getMilliseconds(), 3)}` : result;
  }

  function formatTimeZone(milliseconds, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(milliseconds));
      const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
      return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
    } catch (_) {
      throw new Error("时区名称无效。");
    }
  }

  function parseLocalDate(value) {
    const text = String(value).trim();
    if (!text) throw new Error("当地时间无效。");
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return parseIso(text);
    const match =
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,3}))?)?)?)?$/
        .exec(text);
    if (!match) throw new Error("当地时间格式无效。");
    const [
      ,
      yearText,
      monthText,
      dayText,
      hourText = "0",
      minuteText = "0",
      secondText = "0",
      millisecondText = "0",
    ] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const millisecond = Number(millisecondText.padEnd(3, "0"));
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    date.setHours(hour, minute, second, millisecond);
    if (
      date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second ||
      date.getMilliseconds() !== millisecond
    ) throw new Error("当地时间无效。");
    return date.getTime();
  }

  function unixMillisecondsToFiletime(milliseconds) {
    const number = Number(milliseconds);
    if (!Number.isFinite(number) || Math.abs(number) > 8640000000000) {
      throw new Error("Unix 毫秒时间戳无效或超出范围。");
    }
    return (BigInt(Math.trunc(number)) * 10000n) + FILETIME_EPOCH;
  }

  function parseFiletime(value) {
    try {
      return BigInt(String(value).trim());
    } catch (_) {
      throw new Error("Windows FILETIME 必须是整数。");
    }
  }

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
      return {
        output: String(Math.floor(timestamp / 1000)),
        metadata: { mode, milliseconds: timestamp },
      };
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
    if (mode === "unixSecondsToLocal" || mode === "unixMillisecondsToLocal") {
      const sourceMode = mode === "unixSecondsToLocal"
        ? "unixSecondsToIso"
        : "unixMillisecondsToIso";
      const result = run(value, { mode: sourceMode });
      return {
        output: formatLocalDate(result.metadata.milliseconds),
        metadata: { mode, milliseconds: result.metadata.milliseconds },
      };
    }
    if (mode === "localToUnixSeconds" || mode === "localToUnixMilliseconds") {
      const milliseconds = parseLocalDate(value);
      const output = mode === "localToUnixSeconds"
        ? String(Math.floor(milliseconds / 1000))
        : String(milliseconds);
      return { output, metadata: { mode, milliseconds } };
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
      const filetime = (BigInt(Math.trunc(seconds)) * 10000000n) + FILETIME_EPOCH;
      return { output: filetime.toString(), metadata: { mode, unit: "100ns" } };
    }
    if (mode === "unixMillisecondsToFiletime") {
      return {
        output: unixMillisecondsToFiletime(value).toString(),
        metadata: { mode, unit: "100ns" },
      };
    }
    if (mode === "filetimeToUnix") {
      const seconds = (parseFiletime(value) - FILETIME_EPOCH) / 10000000n;
      return { output: seconds.toString(), metadata: { mode, unit: "seconds" } };
    }
    if (mode === "filetimeToLocal") {
      const milliseconds = Number((parseFiletime(value) - FILETIME_EPOCH) / 10000n);
      if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8640000000000) {
        throw new Error("Windows FILETIME 无效或超出范围。");
      }
      return {
        output: formatLocalDate(milliseconds),
        metadata: { mode, milliseconds, unit: "local" },
      };
    }
    throw new Error("未知的时间转换模式。");
  }

  globalThis.BrowserToolboxTimeTool = Object.freeze({
    run,
    formatLocalDate,
    formatTimeZone,
  });
})();
