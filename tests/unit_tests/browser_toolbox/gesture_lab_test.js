import "../test_helper.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../lib/browser_toolbox/gesture_lab.js";

context("Gesture lab", () => {
  should("normalize drawn and arrow-text patterns before comparing bindings", () => {
    const result = BrowserToolboxGestureLab.analyze("↑ →", [
      { id: "same", pattern: ["U", "R"], commandName: "goBack" },
      { id: "disabled", pattern: ["U", "R"], commandName: "goForward", enabled: false },
      { id: "longer", pattern: ["U", "R", "D"], commandName: "reload" },
      { id: "shorter", pattern: ["U"], commandName: "goBack" },
    ]);
    assert.equal(["U", "R"], result.pattern);
    assert.equal(["same"], result.exact.map((binding) => binding.id));
    assert.equal(["longer"], result.prefixes.map((binding) => binding.id));
    assert.equal(["shorter"], result.longer.map((binding) => binding.id));
    assert.equal("same", result.match.id);
  });

  should("identify dangerous exact bindings for an explicit confirmation", () => {
    const result = BrowserToolboxGestureLab.analyze(["D", "R"], [
      { pattern: ["D", "R"], commandName: "removeTab" },
    ], { getCommand: (name) => ({ name, dangerous: name === "removeTab" }) });
    assert.isTrue(result.dangerous);
  });
});
