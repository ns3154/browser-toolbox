context("BrowserToolbox DOM integration", () => {
  async function loadMarkup(path) {
    const response = await fetch(new URL(path, import.meta.url));
    return new DOMParser().parseFromString(await response.text(), "text/html");
  }

  should("keep the popup layers and functional control IDs in the redesigned order", async () => {
    const popup = await loadMarkup("../../pages/action.html");
    assert.equal(
      [
        "browser-toolbox-action-brand",
        "browser-toolbox-controls",
        "browser-toolbox-tools",
        "browser-toolbox-enhancement-summary",
        "browser-toolbox-action-footer",
      ],
      [...popup.querySelector("main").children]
        .filter((element) => [
          "browser-toolbox-action-brand",
          "browser-toolbox-controls",
          "browser-toolbox-tools",
          "browser-toolbox-enhancement-summary",
        ].some((name) => element.id === name || element.classList.contains(name)) ||
          element.classList.contains("browser-toolbox-action-footer"))
        .map((element) => element.id || [...element.classList].find((name) => name.startsWith("browser-toolbox-action-"))),
    );
    assert.equal(4, popup.querySelectorAll("#browser-toolbox-enhancement-summary input[type=checkbox]").length);
    assert.isTrue(popup.querySelector("#browser-toolbox-site-details") === null);
    assert.isTrue(popup.querySelector("#exclusion-rule-template") === null);
    assert.isTrue(Boolean(popup.querySelector("#browser-toolbox-all-tools")));
    assert.isTrue(Boolean(popup.querySelector("#browser-toolbox-open-command-center")));
  });

  should("expose exactly three settings groups and fifteen navigable panels", async () => {
    const settings = await loadMarkup("../../pages/mouse_options.html");
    const panels = [...settings.querySelectorAll("[data-panel]")].map((panel) => panel.dataset.panel);
    assert.equal(15, panels.length);
    assert.equal(
      ["general", "keyboard", "toolsOverview", "jsonFormatter", "textDiff", "codecTransform", "timeAndId", "search", "appearance", "mouse", "superDrag", "wheel", "siteRules", "privacy", "backupAbout"],
      panels,
    );
    assert.equal(6, settings.querySelectorAll("[data-panel=jsonFormatter] input[type=checkbox]").length);
    assert.isTrue(Boolean(settings.querySelector("#browser-tool-directory-search")));
    assert.isTrue(Boolean(settings.querySelector("#browser-tool-directory")));
    assert.isTrue(Boolean(settings.querySelector("#gesture-lab-status")));
  });

  should("provide a keyboard-friendly command center page", async () => {
    const commandCenter = await loadMarkup("../../pages/command_center.html");
    assert.isTrue(Boolean(commandCenter.querySelector("#command-center-search")));
    assert.equal("listbox", commandCenter.querySelector("#command-center-results").getAttribute("role"));
    assert.isTrue(Boolean(commandCenter.querySelector("#command-center-status[role=status]")));
  });

  should("keep each utility on a standalone page with its own result affordances", async () => {
    const tools = await loadMarkup("../../pages/tools/index.html");
    assert.isTrue(Boolean(tools.querySelector("[data-tool-page='true']")));
    assert.isTrue(tools.querySelector("#tool-back") === null);
    assert.isTrue(tools.querySelector("#tool-settings") === null);
    assert.isTrue(Boolean(tools.querySelector(".browser-toolbox-result-heading #tool-copy")));
    assert.isTrue(tools.querySelector(".browser-toolbox-tool-actions #tool-copy") === null);
    assert.isTrue(Boolean(tools.querySelector("#json-result-tree")));
    assert.isTrue(Boolean(tools.querySelector("#diff-result-list")));
    assert.isTrue(Boolean(tools.querySelector("#codec-output")));
    assert.isTrue(tools.querySelector("#tool-picker") === null);
    assert.isTrue(tools.querySelector("#tool-catalog") === null);
    assert.isTrue(Boolean(tools.querySelector("#tool-input")));
    assert.isTrue(Boolean(tools.querySelector("#tool-input-right")));
  });

  should("render formatted source as text without creating executable DOM", () => {
    const source = '{"markup":"<img src=x onerror=alert(1)>","text":"<b>plain</b>"}';
    const result = BrowserToolboxDocumentFormatters.formatJsonDocument(source);
    const output = document.createElement("pre");
    output.textContent = result.formatted;
    document.body.append(output);
    assert.equal(0, output.querySelectorAll("img, b, script").length);
    assert.equal(result.formatted, output.textContent);
    output.remove();
  });

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
