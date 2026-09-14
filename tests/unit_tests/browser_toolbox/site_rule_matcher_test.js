import "../test_helper.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/site_rule_matcher.js";

context("Site rule matcher", () => {
  const rules = [
    { pattern: "https://*.example.com/*", modules: { mouse: false } },
    { pattern: "https://docs.example.com/editor/*", modules: { superDrag: false } },
    { pattern: "https://docs.example.com/editor/private", modules: { mouse: true } },
  ];

  should("apply the most specific rule last", () => {
    const result = BrowserToolboxSiteRuleMatcher.resolve(
      rules,
      "https://docs.example.com/editor/private",
      { mouse: true, superDrag: true },
    );
    assert.isTrue(result.mouse);
    assert.isFalse(result.superDrag);
  });

  should("reject malformed patterns without throwing", () => {
    assert.isFalse(BrowserToolboxSiteRuleMatcher.matches({ pattern: "[" }, "https://example.com/"));
    assert.equal(null, BrowserToolboxSiteRuleMatcher.compile(""));
    assert.isFalse(
      BrowserToolboxSiteRuleMatcher.matches(
        { pattern: "[", matchType: "regex" },
        "https://example.com/",
      ),
    );
  });

  should("support explicit regular expressions without changing glob behavior", () => {
    const matcher = BrowserToolboxSiteRuleMatcher;
    assert.isTrue(
      matcher.compile("https://*.example.com/*") === matcher.compile(
        "https://*.example.com/*",
      ),
    );
    assert.isTrue(
      matcher.matches(
        { pattern: "^https://(www\\.)?example\\.com/(docs|editor)/", matchType: "regex" },
        "https://example.com/editor/",
      ),
    );
    assert.isFalse(
      matcher.matches(
        { pattern: "^https://(www\\.)?example\\.com/(docs|editor)/", matchType: "regex" },
        "https://example.net/editor/",
      ),
    );
    assert.isTrue(
      matcher.matches({ pattern: "https://*.example.com/*" }, "https://www.example.com/"),
    );
    assert.equal(null, matcher.compile("[", "regex"));
    assert.equal(0, matcher.specificity({ pattern: "example", matchType: "regex" }));
  });

  should("reject obvious catastrophic-backtracking expressions and explain matches", () => {
    const matcher = BrowserToolboxSiteRuleMatcher;
    assert.equal(null, matcher.compile("^(a+)+$", "regex"));
    const explanation = matcher.explain(
      [{ pattern: "https://*.example.com/*", modules: { mouse: false } }],
      "https://www.example.com/",
      { enabled: true, mouse: true },
    );
    assert.equal(1, explanation.matchedRules.length);
    assert.equal("https://*.example.com/*", explanation.effectiveRule.pattern);
    assert.isFalse(explanation.effective.mouse);
  });

  should("show every matching rule in effective precedence order", () => {
    const matcher = BrowserToolboxSiteRuleMatcher;
    const explanation = matcher.explain(
      [
        { pattern: "https://*.example.com/*", modules: { mouse: false } },
        { pattern: "https://docs.example.com/*", modules: { superDrag: false } },
        { pattern: "https://docs.example.com/private", modules: { mouse: true } },
      ],
      "https://docs.example.com/private",
      { mouse: true, superDrag: true },
    );
    assert.equal(
      ["https://docs.example.com/private", "https://docs.example.com/*", "https://*.example.com/*"],
      explanation.matchedRules.map(({ rule }) => rule.pattern),
    );
    assert.equal(
      { mouse: true, superDrag: false },
      explanation.effective,
    );
    assert.equal(
      explanation.effective,
      matcher.resolve(
        [
          { pattern: "https://*.example.com/*", modules: { mouse: false } },
          { pattern: "https://docs.example.com/*", modules: { superDrag: false } },
          { pattern: "https://docs.example.com/private", modules: { mouse: true } },
        ],
        "https://docs.example.com/private",
        { mouse: true, superDrag: true },
      ),
    );
  });

  should("merge site profiles by precedence at the field level", () => {
    const matcher = BrowserToolboxSiteRuleMatcher;
    const rulesWithProfiles = [
      {
        pattern: "https://*.example.com/*",
        profile: { preset: "reading", mouse: { showTrail: false }, wheel: { threshold: 120 } },
      },
      {
        pattern: "https://docs.example.com/*",
        profile: { mouse: { activationDistancePx: 24 }, wheel: { cooldownMs: 300 } },
      },
    ];
    const profile = matcher.effectiveProfile(rulesWithProfiles, "https://docs.example.com/page");
    assert.equal("reading", profile.preset);
    assert.equal({ showTrail: false, activationDistancePx: 24 }, profile.mouse);
    assert.equal({ threshold: 120, cooldownMs: 300 }, profile.wheel);
    assert.equal(profile, matcher.explain(rulesWithProfiles, "https://docs.example.com/page").effectiveProfile);
  });

  should("diagnose duplicate matching patterns without guessing partial overlaps", () => {
    const diagnostics = BrowserToolboxSiteRuleMatcher.diagnose([
      { pattern: "https://*.example.com/*" },
      { pattern: "https://*.example.com/*", matchType: "glob" },
      { pattern: "https://example.com/", matchType: "regex" },
      { pattern: "https://example.com/", matchType: "regex" },
    ]);
    assert.equal(
      [true, true, true, true],
      diagnostics.map((diagnostic) => diagnostic.hasDuplicate),
    );
    assert.equal([1], diagnostics[0].duplicateIndexes);
    assert.equal([0], diagnostics[1].duplicateIndexes);
    assert.equal([3], diagnostics[2].duplicateIndexes);
    assert.equal([2], diagnostics[3].duplicateIndexes);
    assert.equal(
      [false, false],
      BrowserToolboxSiteRuleMatcher.diagnose([
        { pattern: "https://*.example.com/*" },
        { pattern: "https://*.example.com/*", matchType: "regex" },
      ]).map((diagnostic) => diagnostic.hasDuplicate),
    );
  });

  should("treat question marks as literal characters in glob patterns", () => {
    const matcher = BrowserToolboxSiteRuleMatcher;
    assert.isTrue(
      matcher.matches(
        { pattern: "https://example.com/help?topic=mouse" },
        "https://example.com/help?topic=mouse",
      ),
    );
    assert.isFalse(
      matcher.matches(
        { pattern: "https://example.com/help?topic=mouse" },
        "https://example.com/helpXtopic=mouse",
      ),
    );
  });

  should("honor Vimium absolute and partial exclusion rules", () => {
    assert.equal(
      { disabled: true, passKeys: "" },
      BrowserToolboxSiteRuleMatcher.exclusionState(
        [{ pattern: "https?://mail.example.com/*", passKeys: "" }],
        "https://mail.example.com/inbox",
      ),
    );
    assert.equal(
      { disabled: false, passKeys: "jk" },
      BrowserToolboxSiteRuleMatcher.exclusionState(
        [{ pattern: "https?://mail.example.com/*", passKeys: "j k" }],
        "https://mail.example.com/inbox",
      ),
    );
  });

  should("resolve flags, choose effective rules and ignore invalid input", () => {
    const matcher = BrowserToolboxSiteRuleMatcher;
    assert.equal(null, matcher.compile("x".repeat(2049)));
    assert.equal(-3, matcher.specificity("***"));
    assert.equal({ mouse: true }, matcher.resolve(null, "https://example.com", { mouse: true }));
    assert.equal(
      { enabled: false, keyboard: false, mouse: false },
      matcher.resolve(
        [{ pattern: "https://example.com/*", enabled: false }],
        "https://example.com/page",
        { enabled: true, keyboard: true, mouse: true },
      ),
    );
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
