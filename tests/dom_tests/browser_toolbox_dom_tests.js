context("BrowserToolbox DOM integration", () => {
  should("draw and clean a Shadow DOM gesture overlay", () => {
    const overlay = new BrowserToolboxGestureOverlay(document);
    overlay.show();
    overlay.draw([{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }]);
    assert.isTrue(overlay.host != null);
    overlay.hide();
    overlay.destroy();
    assert.isTrue(overlay.host == null);
  });

  should("recognize a gesture session without leaving points after cancel", () => {
    const session = new BrowserToolboxGestureSession({
      activationDistancePx: 5,
      minimumSegmentDistancePx: 5,
      sampleDistancePx: 1,
    });
    session.start({ x: 0, y: 0 }, 0);
    const result = session.move({ x: 20, y: 0 }, 10);
    assert.isTrue(result.activated);
    assert.equal(["R"], result.pattern);
    session.cancel("test");
    assert.equal(0, session.snapshot(false).points.length);
  });
});
