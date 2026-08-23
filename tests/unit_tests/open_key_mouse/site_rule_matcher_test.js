import "../test_helper.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../lib/open_key_mouse/settings_schema.js";
import "../../../lib/open_key_mouse/site_rule_matcher.js";

context("Site rule matcher", () => {
  const rules = [
    { pattern: "https://*.example.com/*", modules: { mouse: false } },
    { pattern: "https://docs.example.com/editor/*", modules: { superDrag: false } },
    { pattern: "https://docs.example.com/editor/private", modules: { mouse: true } },
  ];

  should("apply the most specific rule last", () => {
    const result = OpenKeyMouseSiteRuleMatcher.resolve(
      rules,
      "https://docs.example.com/editor/private",
      { mouse: true, superDrag: true },
    );
    assert.isTrue(result.mouse);
    assert.isFalse(result.superDrag);
  });

  should("reject malformed patterns without throwing", () => {
    assert.isFalse(OpenKeyMouseSiteRuleMatcher.matches({ pattern: "[" }, "https://example.com/"));
    assert.equal(null, OpenKeyMouseSiteRuleMatcher.compile(""));
  });

  should("honor Vimium absolute and partial exclusion rules", () => {
    assert.equal(
      { disabled: true, passKeys: "" },
      OpenKeyMouseSiteRuleMatcher.exclusionState(
        [{ pattern: "https?://mail.example.com/*", passKeys: "" }],
        "https://mail.example.com/inbox",
      ),
    );
    assert.equal(
      { disabled: false, passKeys: "jk" },
      OpenKeyMouseSiteRuleMatcher.exclusionState(
        [{ pattern: "https?://mail.example.com/*", passKeys: "j k" }],
        "https://mail.example.com/inbox",
      ),
    );
  });
});
