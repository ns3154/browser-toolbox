import "../test_helper.js";
import "../../../content_scripts/mouse/direction_quantizer.js";

context("Direction quantizer", () => {
  should("quantize four directions", () => {
    assert.equal("R", BrowserToolboxDirectionQuantizer.quantize(10, 1, "4-way"));
    assert.equal("L", BrowserToolboxDirectionQuantizer.quantize(-10, 1, "4-way"));
    assert.equal("U", BrowserToolboxDirectionQuantizer.quantize(1, -10, "4-way"));
    assert.equal("D", BrowserToolboxDirectionQuantizer.quantize(1, 10, "4-way"));
  });

  should("map diagonal vectors to their dominant cardinal direction", () => {
    assert.equal("R", BrowserToolboxDirectionQuantizer.quantize(10, -10, "8-way"));
    assert.equal("L", BrowserToolboxDirectionQuantizer.quantize(-10, 10, "8-way"));
    assert.equal("U", BrowserToolboxDirectionQuantizer.quantize(10, -20, "8-way"));
    assert.equal("D", BrowserToolboxDirectionQuantizer.quantize(-10, 20, "8-way"));
    assert.equal([], BrowserToolboxDirectionQuantizer.normalizePattern("UR > ↗"));
  });

  should("format only cardinal UI patterns as arrows", () => {
    assert.equal(
      "↑ · →",
      BrowserToolboxDirectionQuantizer.formatPattern(["U", "R", "DL"]),
    );
    assert.equal(
      ["U", "R"],
      BrowserToolboxDirectionQuantizer.normalizePattern("↑ · → · ↙"),
    );
    assert.equal([], BrowserToolboxDirectionQuantizer.normalizePattern("↖↗ ↙↘"));
    assert.equal(
      ["U", "R"],
      BrowserToolboxDirectionQuantizer.normalizePattern("U > R > invalid"),
    );
  });

  should("ignore diagonal previous values and preserve cardinal zero vectors", () => {
    assert.equal("R", BrowserToolboxDirectionQuantizer.quantize(0, 0, "4-way", "R"));
    assert.equal(null, BrowserToolboxDirectionQuantizer.quantize(0, 0, "4-way", "UR"));
  });

  should("cover cardinal vectors in every quadrant", () => {
    assert.equal("R", BrowserToolboxDirectionQuantizer.quantize(10, 0, "8-way"));
    assert.equal("R", BrowserToolboxDirectionQuantizer.quantize(10, -10, "8-way"));
    assert.equal("U", BrowserToolboxDirectionQuantizer.quantize(0, -10, "8-way"));
    assert.equal("L", BrowserToolboxDirectionQuantizer.quantize(-10, -10, "8-way"));
    assert.equal("L", BrowserToolboxDirectionQuantizer.quantize(-10, 0, "8-way"));
    assert.equal("L", BrowserToolboxDirectionQuantizer.quantize(-10, 10, "8-way"));
    assert.equal("D", BrowserToolboxDirectionQuantizer.quantize(0, 10, "8-way"));
    assert.equal("R", BrowserToolboxDirectionQuantizer.quantize(10, 10, "8-way"));
  });

  should("merge continuous segments and enforce a maximum", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 40, y: 40 },
    ];
    assert.equal(
      ["R", "D"],
      BrowserToolboxDirectionQuantizer.quantizePoints(points, { maxSegments: 2 }),
    );
  });

  should("ignore short, invalid and repeated samples and normalize patterns", () => {
    assert.equal([], BrowserToolboxDirectionQuantizer.quantizePoints(null));
    assert.equal([], BrowserToolboxDirectionQuantizer.quantizePoints([{ x: 0, y: 0 }]));
    assert.equal(
      [],
      BrowserToolboxDirectionQuantizer.quantizePoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    );
    assert.equal(
      ["R"],
      BrowserToolboxDirectionQuantizer.quantizePoints([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
      ]),
    );
    assert.equal(
      ["L", "U"],
      BrowserToolboxDirectionQuantizer.normalizePattern(" L > U > invalid "),
    );
    assert.equal(["R"], BrowserToolboxDirectionQuantizer.normalizePattern(["R", "bad"]));
    assert.equal([], BrowserToolboxDirectionQuantizer.normalizePattern(42));
  });
});
