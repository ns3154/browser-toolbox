/**
 * 设置页层级导航的单元测试。
 * 测试输入为分区元数据和搜索词，输出为可见分区及激活状态断言。
 */
import * as testHelper from "../test_helper.js";
import "../../../lib/i18n.js";
import "../../../pages/settings_sections.js";
import "../../../pages/settings_navigation.js";

context("BrowserToolbox settings navigation", () => {
  let navigation;

  setup(async () => {
    await testHelper.jsdomStub("pages/mouse_options.html");
    BrowserToolboxI18n.setLocale("en");
    navigation = new BrowserToolboxSettingsNavigation.SettingsNavigation(
      document.querySelector(".browser-toolbox-nav"),
      {
        sections: BrowserToolboxSettingsSections,
        documentRef: document,
      },
    ).init();
    BrowserToolboxI18n.apply(document);
  });

  teardown(() => BrowserToolboxI18n.setLocale("auto"));

  should("filter by translated group or section labels and keep the result count", () => {
    const result = navigation.filter("mouse");
    assert.equal(1, result.matchedSections);
    assert.isFalse(document.querySelector("[data-nav-group='browsingEnhancement']").hidden);
    assert.isTrue(document.querySelector("[data-nav-group='utilityTools']").hidden);
    assert.equal(
      ["mouse"],
      navigation.visibleButtons().map((button) => button.dataset.section),
    );

    const appearance = navigation.filter("appearance");
    assert.equal(1, appearance.matchedSections);
    assert.equal("appearance", navigation.visibleButtons()[0].dataset.section);
  });

  should("find a section by a field label instead of only its navigation title", () => {
    const result = navigation.filter("activation distance");
    assert.equal(1, result.matchedSections);
    assert.equal("mouse", navigation.visibleButtons()[0].dataset.section);
  });

  should("restore all groups and the active focus stop when the filter is cleared", () => {
    navigation.filter("pointer");
    navigation.filter("");
    assert.equal(15, navigation.buttons.filter((button) => !button.hidden).length);
    assert.isTrue(navigation.groups.every((group) => !group.hidden));
    assert.isTrue(navigation.categories.every((category) =>
      category.getAttribute("aria-expanded") === "true"
    ));
    assert.equal(1, navigation.buttons.filter((button) => button.tabIndex === 0).length);
  });

  should("keep keyboard navigation across the three visible groups", () => {
    navigation.filter("");
    const activeGroup = navigation.activeButton.closest(".browser-toolbox-nav-group");
    const focusable = navigation.focusableButtons();
    assert.isTrue(focusable.length > 0);
    assert.equal(15, focusable.length);

    const currentGroupButtons = navigation.visibleButtons().filter((button) =>
      button.closest(".browser-toolbox-nav-group") === activeGroup
    );
    const lastInGroup = currentGroupButtons.at(-1);
    const next = navigation.visibleButtons()[navigation.visibleButtons().indexOf(lastInGroup) + 1];
    lastInGroup.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown" }),
    );
    assert.equal(
      next,
      navigation.activeButton,
    );
    assert.isFalse(next.closest(".browser-toolbox-nav-items").hidden);
  });

  should("search Chinese labels after the locale changes", () => {
    BrowserToolboxI18n.setLocale("zh_CN");
    BrowserToolboxI18n.apply(document);
    const result = navigation.filter("站点");
    assert.equal(1, result.matchedSections);
    assert.equal(
      ["siteRules"],
      navigation.visibleButtons().map((button) => button.dataset.section),
    );
  });

  should("localize the settings page title with the rest of the document", () => {
    BrowserToolboxI18n.setLocale("zh_CN");
    BrowserToolboxI18n.apply(document);
    assert.equal("浏览器工具箱", document.title);
  });
});
