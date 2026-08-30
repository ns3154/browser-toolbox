/**
 * 设置表单分区绑定的单元测试。
 * 测试输入为表单字段元数据和 DOM 值，输出为设置快照断言。
 */
import "../test_helper.js";
import "../../../pages/settings_sections.js";

context("Settings section registry", () => {
  const sections = () => globalThis.BrowserToolboxSettingsSections;

  should("keep every section attached to a unique registered group", () => {
    const api = sections();
    assert.isTrue(api.validateRegistry(api.GROUPS, api.SECTIONS));
    assert.equal(15, api.SECTIONS.length);
    assert.equal(3, api.GROUPS.length);
    assert.equal(
      [
        "mouse",
        "superDrag",
        "wheel",
        "keyboard",
        "search",
        "general",
        "toolsOverview",
        "jsonFormatter",
        "textDiff",
        "codecTransform",
        "timeAndId",
        "appearance",
        "siteRules",
        "privacy",
        "backupAbout",
      ],
      api.SECTIONS.map((section) => section.id),
    );
  });

  should("read and write scalar form fields through declared paths", () => {
    const api = sections();
    const elements = new Map(api.FORM_FIELDS.map((field) => [field.id, {
      checked: false,
      value: field.type === "number" ? "0" : "",
    }]));
    const root = { querySelector: (selector) => elements.get(selector.slice(1)) || null };
    const settings = {
      general: {
        enabled: true,
        showHud: true,
        browserSyncEnabled: true,
        language: "zh_CN",
      },
      keyboard: { enabled: true, keyMappings: "j" },
      searchEngines: "g https://example.com/?q=%s",
      mouse: {
        enabled: true,
        triggerButton: 1,
        directionMode: "8-way",
        activationDistancePx: 12,
        sampleDistancePx: 5,
        minimumSegmentDistancePx: 20,
        turnHysteresisDegrees: 15,
        maxSegments: 6,
        maxDurationMs: 1800,
        showTrail: false,
        showCommandHud: true,
        suppressContextMenuAfterActivation: false,
      },
      superDrag: { enabled: false, nativeBypassModifier: "Control" },
      wheel: { enabled: true, threshold: 90, cooldownMs: 220, continuousTabSwitching: true },
      rocker: { enabled: false },
      cursor: { enabled: true, hotspotX: 7, hotspotY: 8 },
    };
    api.writeForm(settings, root);
    const copy = {
      general: {},
      keyboard: {},
      mouse: {},
      superDrag: {},
      wheel: {},
      rocker: {},
      cursor: {},
    };
    api.readForm(copy, root);
    assert.equal(settings.general, copy.general);
    assert.equal(settings.keyboard, copy.keyboard);
    assert.equal(settings.mouse, copy.mouse);
    assert.equal(settings.superDrag, copy.superDrag);
    assert.equal(settings.wheel, copy.wheel);
    assert.equal(settings.rocker, copy.rocker);
    assert.equal(settings.cursor, copy.cursor);
    assert.equal(settings.searchEngines, copy.searchEngines);
  });

  should("reject duplicate or unknown section metadata", () => {
    const api = sections();
    const throws = (callback) => {
      try {
        callback();
        return false;
      } catch (_) {
        return true;
      }
    };
    assert.isTrue(throws(() =>
      api.validateRegistry(api.GROUPS, [
        ...api.SECTIONS,
        { id: "general", group: "navigationKeyboard", labelKey: "general" },
      ])
    ));
    assert.isTrue(throws(() =>
      api.validateRegistry(api.GROUPS, [
        { id: "new", group: "missing", labelKey: "general" },
      ])
    ));
  });
});
