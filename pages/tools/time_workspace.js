// SPDX-License-Identifier: GPL-3.0-or-later
import {
  action,
  assertSize,
  copyRow,
  divider,
  labelAction,
  mountPanes,
  node,
  panel,
  resultActions,
  segments,
  selectControl,
  t,
} from "./workbench_view.js";

const time = globalThis.BrowserToolboxTimeTool;
const UTC = ["UTC", "toolZoneUtc"];
const NEW_YORK = ["America/New_York", "toolZoneNewYork"];
const SAN_FRANCISCO = ["America/Los_Angeles", "toolZoneSanFrancisco"];
const TOKYO = ["Asia/Tokyo", "toolZoneTokyo"];
const QUICK_ZONES = [UTC, ["Asia/Shanghai", "toolZoneShanghai"], NEW_YORK, SAN_FRANCISCO, [
  "Europe/London",
  "toolZoneLondon",
], TOKYO];
const WORLD_ZONES = [UTC, NEW_YORK, SAN_FRANCISCO, ["Europe/Berlin", "toolZoneFrankfurt"], [
  "Asia/Singapore",
  "toolZoneSingapore",
], TOKYO];

const offsetFormatters = new Map();
function offsetAt(milliseconds, zone) {
  if (!offsetFormatters.has(zone)) {
    offsetFormatters.set(
      zone,
      new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "longOffset" }),
    );
  }
  const part =
    offsetFormatters.get(zone).formatToParts(milliseconds).find(({ type }) =>
      type === "timeZoneName"
    ).value;
  const offset = /([+-])(\d\d):(\d\d)/.exec(part);
  if (!offset) return { minutes: 0, label: "UTC+00:00" };
  const [, sign, hours, minutes] = offset;
  return {
    minutes: (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)),
    label: `UTC${sign}${hours}:${minutes}`,
  };
}

function calendarStatus(milliseconds, delta) {
  const language = document.documentElement.lang;
  const date = new Intl.DateTimeFormat(language, { dateStyle: "full" }).format(milliseconds);
  if (!delta) return `${date} · ${t("toolTimeSameOffset")}`;
  const duration = Math.abs(delta);
  const parts = [];
  if (duration >= 60) {
    parts.push(
      new Intl.NumberFormat(language, { style: "unit", unit: "hour" }).format(
        Math.floor(duration / 60),
      ),
    );
  }
  if (duration % 60) {
    parts.push(
      new Intl.NumberFormat(language, { style: "unit", unit: "minute" }).format(duration % 60),
    );
  }
  const difference = t(delta > 0 ? "toolTimeAhead" : "toolTimeBehind", { offset: parts.join(" ") });
  return `${date} · ${difference}`;
}

function mountClock(ctx) {
  const samples = [
    ["time-current-local", "toolTimeCurrentLocal", (now) => time.formatLocalDate(now, false)],
    ["time-current-seconds", "toolTimeUnixSeconds", (now) => String(Math.floor(now / 1000))],
    ["time-current-milliseconds", "toolTimeUnixMillis", String],
  ];
  const values = samples.map(([id, key, format], index) => {
    const label = node("span", "", t(key));
    label.id = `${id}-label`;
    const button = node("button", "clock-copy");
    button.id = id;
    button.type = "button";
    button.setAttribute("aria-labelledby", `${label.id} ${id}`);
    button.title = t("toolTimeClickCopy");
    button.addEventListener("click", () => ctx.copy(button.textContent));
    if (index) ctx.toolbar.append(divider());
    const sample = node("div", "workbench-control");
    sample.append(label, button);
    ctx.toolbar.append(sample);
    return { button, format };
  });
  ctx.toolbar.append(node("span", "workbench-toolbar-note", t("toolTimeClickCopy")));
  let timer;
  function tick() {
    const now = Date.now();
    for (const { button, format } of values) button.textContent = format(now);
  }
  const toggle = action("toolTimePause", {
    id: "time-current-toggle",
    glyph: "pause",
    run() {
      if (timer === undefined) {
        start();
      } else {
        clearInterval(timer);
        timer = undefined;
      }
      const paused = timer === undefined;
      toggle.setAttribute("aria-pressed", String(paused));
      labelAction(toggle, paused ? "toolTimeResume" : "toolTimePause", paused ? "play" : "pause");
    },
  });
  toggle.setAttribute("aria-pressed", "false");
  ctx.toolbar.append(toggle);
  function start() {
    tick();
    timer = setInterval(tick, 1000);
  }
  start();
}

export function mountTime(ctx) {
  mountClock(ctx);
  const input = node("input", "workbench-text time-input");
  input.id = "time-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "1795149000";
  const parseModes = segments(
    "time-parse",
    t("toolTimeParseMode"),
    [
      ["auto", t("toolTimeAuto")],
      ["seconds", t("toolTimeUnixSeconds")],
      ["milliseconds", t("toolTimeUnixMillis")],
      ["filetime", "FILETIME"],
    ],
    "auto",
    () => refresh(),
  );
  const fill = action("toolTimeFillNow", {
    id: "time-fill-now",
    glyph: "clock",
    run() {
      parseModes.set("auto");
      input.value = String(Date.now());
      refresh();
    },
  });
  const clear = action("toolCodecClear", {
    id: "time-clear",
    run() {
      input.value = "";
      refresh();
      input.focus();
    },
  });
  const form = panel(t("toolTimeInput"), {
    id: "time-input-pane",
    subtitle: t("toolTimeAutoHint"),
    actions: [fill, clear],
  });
  const fields = node("div", "time-fields");
  const valueLabel = node("label", "workbench-field-label", t("toolTimeValueLabel"));
  valueLabel.htmlFor = input.id;
  const hint = node("p", "workbench-help", t("toolTimeInputHint"));
  hint.id = "time-input-hint";
  input.setAttribute("aria-describedby", hint.id);
  const valueGroup = node("div", "workbench-field");
  valueGroup.append(valueLabel, input, hint);
  const parse = node("div", "workbench-field");
  parse.append(node("span", "workbench-field-label", t("toolTimeParseMode")), parseModes.element);

  const zoneGroup = node("div", "workbench-field");
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const availableZones = new Set([
    "UTC",
    ...QUICK_ZONES.slice(1).map(([zone]) => zone),
    ...WORLD_ZONES.slice(1).map(([zone]) => zone),
    ...(Intl.supportedValuesOf?.("timeZone") ?? []),
  ]);
  const sortedZones = [...availableZones].sort();
  const zone = selectControl(
    t("toolTimezone"),
    sortedZones.map((key) => [key, key]),
    NEW_YORK[0],
    "time-zone",
  );
  zone.addEventListener("change", () => refresh());
  const zoneLabel = node("label", "workbench-field-label", t("toolTimezone"));
  zoneLabel.htmlFor = zone.id;
  const quick = node("div", "time-quick");
  const quickButtons = new Map();
  for (const [id, title] of QUICK_ZONES) {
    const button = action(title, {
      run() {
        zone.value = id;
        refresh();
      },
    });
    button.dataset.zone = id;
    quickButtons.set(id, button);
    quick.append(button);
  }
  const calendar = node("p", "time-calendar");
  calendar.hidden = true;
  zoneGroup.append(zoneLabel, zone, quick);
  fields.append(valueGroup, parse, zoneGroup, calendar);
  form.element.append(fields);

  const copyAll = resultActions(ctx, { copyKey: "toolCopyAll" });
  const output = panel(t("toolConversionResult"), {
    id: "tool-result-workspace",
    subtitle: t("toolTimeAllFormats"),
    result: true,
    actions: copyAll.buttons,
  });
  const outputRows = node("div", "time-output");
  const rows = [
    ["local", "toolTimeLocal", "toolTimeSystemZone"],
    ["iso", "toolTimeIsoUtc", "toolTimeUtcHint"],
    ["zone", "toolTimeTargetValue"],
    ["seconds", "toolTimeSecondsValue", "toolTimeSecondsHint"],
    ["milliseconds", "toolTimeMillisValue", "toolTimeMillisHint"],
    ["filetime", "toolTimeFiletime", "toolTimeFiletimeHint"],
  ].map(([id, key, hint]) => {
    const row = copyRow(ctx, "toolCodecCopyShort", "time-output-row");
    row.element.dataset.timeResult = id;
    outputRows.append(row.element);
    return { id, key, hint, row };
  });
  output.element.append(outputRows);
  mountPanes(ctx, form, output);

  const world = panel(t("toolTimeInputWorld"), {
    id: "time-world",
    subtitle: t("toolTimeClickCopy"),
  });
  const worldGrid = node("div", "time-world-grid");
  const worldRows = WORLD_ZONES.map(([id, key]) => {
    const row = copyRow(ctx, "toolCodecCopyShort", "time-world-cell");
    row.element.dataset.worldZone = id;
    worldGrid.append(row.element);
    return { id, key, row };
  });
  world.element.append(worldGrid);
  ctx.footer.before(world.element);

  let shownOption;
  function refresh() {
    let parsed;
    let error;
    if (input.value.trim()) {
      try {
        assertSize(ctx, input.value);
        parsed = time.parseInput(input.value, parseModes.value);
      } catch (issue) {
        error = t(issue.messageKey || "toolTimeInvalidInput");
      }
    }
    const milliseconds = parsed?.milliseconds;
    const selected = zone.selectedOptions[0];
    const target = parsed && offsetAt(milliseconds, zone.value);
    const local = parsed && offsetAt(milliseconds, localZone);
    if (shownOption) shownOption.textContent = shownOption.value;
    shownOption = selected;
    if (target) selected.textContent = `${zone.value} (${target.label})`;
    for (const [id, button] of quickButtons) {
      button.setAttribute("aria-pressed", String(id === zone.value));
    }
    form.detail.textContent = parseModes.value === "auto"
      ? t("toolTimeAutoHint")
      : parseModes.buttons.get(parseModes.value).textContent;
    input.setAttribute("aria-invalid", String(Boolean(error)));
    calendar.hidden = !parsed;
    calendar.textContent = parsed
      ? calendarStatus(milliseconds, target.minutes - local.minutes)
      : "";

    const values = parsed
      ? {
        local: time.formatLocalDate(milliseconds),
        iso: new Date(milliseconds).toISOString(),
        zone: `${time.formatTimeZone(milliseconds, zone.value)} (${target.label})`,
        seconds: String(Math.floor(milliseconds / 1000)),
        milliseconds: String(milliseconds),
        filetime: parsed.filetime,
      }
      : {};
    for (const { id, key, hint, row } of rows) {
      const label = node("span", "time-output-label");
      const detail = id === "zone"
        ? [zone.value, target?.label].filter(Boolean).join(" · ")
        : [t(hint), id === "local" ? local?.label : ""].filter(Boolean).join(" · ");
      label.append(node("strong", "", t(key)), node("small", "", detail));
      row.set(values[id] ?? "", label, node("code", "", values[id] ?? "—"));
    }
    copyAll.set(parsed ? rows.map(({ id, key }) => `${t(key)}\t${values[id]}`).join("\n") : "");
    for (const { id, key, row } of worldRows) {
      const value = parsed ? time.formatTimeZone(milliseconds, id) : "";
      const label = parsed ? `${t(key)} (${offsetAt(milliseconds, id).label})` : t(key);
      row.set(value, node("span", "", label), node("code", "", value || "—"));
    }
    const recognized = parsed && t(
      {
        seconds: "toolTimeParsedSeconds",
        milliseconds: "toolTimeParsedMillis",
        filetime: "toolTimeParsedFiletime",
        iso: "toolTimeParsedIso",
        local: "toolTimeParsedLocal",
      }[parsed.kind],
    );
    ctx.status(error || recognized || "", { error: Boolean(error), ok: Boolean(parsed) });
    ctx.stats(parsed && t("toolTimeIntl"));
  }
  input.addEventListener("input", refresh);
  return { input: { set: (value) => input.value = value }, refresh };
}
