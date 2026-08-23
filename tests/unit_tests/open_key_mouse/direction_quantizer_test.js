import "../test_helper.js";
import "../../../content_scripts/mouse/direction_quantizer.js";

context("Direction quantizer", () => {
  should("quantize four directions", () => {
    assert.equal("R", OpenKeyMouseDirectionQuantizer.quantize(10, 1, "4-way"));
    assert.equal("L", OpenKeyMouseDirectionQuantizer.quantize(-10, 1, "4-way"));
    assert.equal("U", OpenKeyMouseDirectionQuantizer.quantize(1, -10, "4-way"));
    assert.equal("D", OpenKeyMouseDirectionQuantizer.quantize(1, 10, "4-way"));
  });

  should("support eight-way diagonal directions", () => {
    assert.equal("UR", OpenKeyMouseDirectionQuantizer.quantize(10, -10, "8-way"));
    assert.equal("DL", OpenKeyMouseDirectionQuantizer.quantize(-10, 10, "8-way"));
  });

  should("cover zero vectors, all eight sectors and hysteresis", () => {
    assert.equal("R", OpenKeyMouseDirectionQuantizer.quantize(0, 0, "4-way", "R"));
    assert.equal("R", OpenKeyMouseDirectionQuantizer.quantize(10, 0, "8-way"));
    assert.equal("UR", OpenKeyMouseDirectionQuantizer.quantize(10, -10, "8-way"));
    assert.equal("U", OpenKeyMouseDirectionQuantizer.quantize(0, -10, "8-way"));
    assert.equal("UL", OpenKeyMouseDirectionQuantizer.quantize(-10, -10, "8-way"));
    assert.equal("L", OpenKeyMouseDirectionQuantizer.quantize(-10, 0, "8-way"));
    assert.equal("DL", OpenKeyMouseDirectionQuantizer.quantize(-10, 10, "8-way"));
    assert.equal("D", OpenKeyMouseDirectionQuantizer.quantize(0, 10, "8-way"));
    assert.equal("DR", OpenKeyMouseDirectionQuantizer.quantize(10, 10, "8-way"));
    assert.equal("R", OpenKeyMouseDirectionQuantizer.quantize(10, 1, "8-way", "R", 45));
    assert.equal(0, OpenKeyMouseDirectionQuantizer.angleDistance(0, Math.PI * 2));
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
      OpenKeyMouseDirectionQuantizer.quantizePoints(points, { maxSegments: 2 }),
    );
  });

  should("ignore short, invalid and repeated samples and normalize patterns", () => {
    assert.equal([], OpenKeyMouseDirectionQuantizer.quantizePoints(null));
    assert.equal([], OpenKeyMouseDirectionQuantizer.quantizePoints([{ x: 0, y: 0 }]));
    assert.equal(
      [],
      OpenKeyMouseDirectionQuantizer.quantizePoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    );
    assert.equal(
      ["R"],
      OpenKeyMouseDirectionQuantizer.quantizePoints([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
      ]),
    );
    assert.equal(["L", "U"], OpenKeyMouseDirectionQuantizer.normalizePattern(" L > U > invalid "));
    assert.equal(["R"], OpenKeyMouseDirectionQuantizer.normalizePattern(["R", "bad"]));
    assert.equal([], OpenKeyMouseDirectionQuantizer.normalizePattern(42));
  });
});
