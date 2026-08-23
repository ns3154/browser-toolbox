import "../test_helper.js";
import "../../../content_scripts/mouse/path_sampler.js";

context("PathSampler", () => {
  should("ignore points below the sampling distance", () => {
    const sampler = new OpenKeyMousePathSampler.PathSampler({ sampleDistancePx: 4 });
    sampler.reset({ x: 0, y: 0 });
    assert.isFalse(sampler.add({ x: 2, y: 2 }));
    assert.equal(1, sampler.getPoints().length);
    assert.isTrue(sampler.add({ x: 4, y: 0 }));
    assert.equal(2, sampler.getPoints().length);
  });

  should("cap active samples at 512 points", () => {
    const sampler = new OpenKeyMousePathSampler.PathSampler({
      sampleDistancePx: 0,
      maxPoints: 512,
    });
    sampler.reset({ x: 0, y: 0 });
    for (let index = 1; index < 1000; index++) sampler.add({ x: index, y: 0 });
    assert.equal(512, sampler.getPoints().length);
  });
});
