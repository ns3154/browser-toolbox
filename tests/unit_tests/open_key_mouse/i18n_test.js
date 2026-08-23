import "../test_helper.js";
import "../../../lib/i18n.js";

context("OpenKeyMouse internationalization", () => {
  teardown(() => OpenKeyMouseI18n.setLocale("auto"));

  should("switch the new UI catalog between English and Simplified Chinese", () => {
    OpenKeyMouseI18n.setLocale("en");
    assert.equal("Save", OpenKeyMouseI18n.message("save"));
    assert.equal("Pattern text (for example, L>R)", OpenKeyMouseI18n.message("patternInput"));
    OpenKeyMouseI18n.setLocale("zh_CN");
    assert.equal("保存", OpenKeyMouseI18n.message("save"));
    assert.equal("轨迹文本（例如 L>R）", OpenKeyMouseI18n.message("patternInput"));
    assert.equal("复制链接网址", OpenKeyMouseI18n.message("command_OpenKeyMouse_copyLinkUrl"));
  });
});
