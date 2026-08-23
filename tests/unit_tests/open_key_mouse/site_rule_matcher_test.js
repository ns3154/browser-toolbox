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

  should("resolve flags, choose effective rules and ignore invalid input", () => {
    const matcher = OpenKeyMouseSiteRuleMatcher;
    assert.equal(null, matcher.compile("x".repeat(2049)));
    assert.equal(-3, matcher.specificity("***"));
    assert.equal({ mouse: true }, matcher.resolve(null, "https://example.com", { mouse: true }));
    assert.equal(
      {
        enabled: true,
        mouse: true,
        passKeys: "jk",
      },
      matcher.resolve(
        [
          {
            pattern: "https://example.com/*",
            enabled: false,
            modules: { mouse: false },
            passKeys: "jk",
          },
          { pattern: "https://example.com/*", enabled: true, modules: { mouse: true } },
        ],
        "https://example.com/page",
        { enabled: false },
      ),
    );
    assert.equal(
      { pattern: "https://docs.example.com/editor/private", modules: { mouse: true } },
      matcher.effectiveRule(rules, "https://docs.example.com/editor/private"),
    );
    assert.equal(null, matcher.effectiveRule(rules, "https://other.example/"));
    assert.equal(
      { disabled: false, passKeys: "" },
      matcher.exclusionState([
        { pattern: "[", passKeys: "j" },
        null,
      ], "https://example.com/"),
    );
  });
});
