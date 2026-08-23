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
});
