import "../test_helper.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../content_scripts/mouse/gesture_recognizer.js";

context("Gesture recognizer", () => {
  const bindings = [
    { pattern: ["L"], commandName: "goBack", enabled: true },
    { pattern: ["D", "R"], commandName: "removeTab", enabled: true },
  ];

  should("distinguish exact matches and prefixes", () => {
    assert.equal("goBack", OpenKeyMouseGestureRecognizer.find(["L"], bindings).exact.commandName);
    const prefix = OpenKeyMouseGestureRecognizer.find(["D"], bindings);
    assert.isTrue(prefix.isPrefix);
    assert.equal(null, prefix.exact);
  });

  should("not execute an unknown pattern", () => {
    const result = OpenKeyMouseGestureRecognizer.find(["U"], bindings);
    assert.equal(null, result.exact);
    assert.isFalse(result.isPrefix);
  });
});
