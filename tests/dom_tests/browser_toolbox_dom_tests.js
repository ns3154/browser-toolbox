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

  should("show only a stable cancel target before the first real direction", () => {
    const overlay = new BrowserToolboxGestureOverlay(document);
    overlay.showCancel({ label: "取消" });
    assert.equal("block", overlay.host.style.display);
    assert.isFalse(overlay.hud.hidden);
    assert.equal("hidden", overlay.hud.style.visibility);
    assert.isTrue(overlay.backdrop.hidden);
    assert.equal(0, overlay.directionTrack.children.length);
    assert.isTrue(overlay.cancel.classList.contains("is-visible"));
    assert.equal("取消", overlay.cancelLabel.textContent);
    overlay.destroy();
  });

  should("render direction icons, matched command text, and a hittable cancel state", () => {
    const overlay = new BrowserToolboxGestureOverlay(document);
    overlay.showCancel({ label: "取消" });
    overlay.setGesture(["R", "L", "R"], "刷新", { cancelLabel: "取消" });
    assert.equal("visible", overlay.hud.style.visibility);
    assert.isFalse(overlay.backdrop.hidden);
    assert.equal(
      ["R", "L", "R"],
      [...overlay.directionTrack.querySelectorAll(".browser-toolbox-direction")].map((element) =>
        element.dataset.direction
      ),
    );
    assert.equal("刷新", overlay.statusLabel.textContent);
    assert.isTrue(overlay.statusRow.classList.contains("is-visible"));

    overlay.cancelTarget.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      right: 160,
      bottom: 260,
      width: 60,
      height: 60,
    });
    assert.isTrue(overlay.isCancelPoint({ x: 130, y: 230 }));
    assert.isFalse(overlay.isCancelPoint({ x: 40, y: 40 }));
    overlay.setCancelHover(true);
    assert.equal("true", overlay.cancelTarget.dataset.hovered);
    assert.isTrue(overlay.cancel.classList.contains("is-hovered"));
    overlay.destroy();
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
