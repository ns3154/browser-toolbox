import { markDiffPair } from "../../pages/tools/diff_workspace.js";
import { renderTablePreview } from "../../pages/tools/table_workspace.js";
import { liveResult, segments } from "../../pages/tools/workbench_view.js";

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

  should("expose exactly four settings groups and twelve navigable panels", async () => {
    const settings = await loadMarkup("../../pages/mouse_options.html");
    const panels = [...settings.querySelectorAll("[data-panel]")].map((panel) => panel.dataset.panel);
    assert.equal(12, panels.length);
    assert.equal(
      [
        "general",
        "search",
        "mouse",
        "superDrag",
        "wheel",
        "keyboard",
        "appearance",
        "toolsOverview",
        "jsonFormatter",
        "siteRules",
        "privacy",
        "backupAbout",
      ],
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

  should("在独立工作台提供真实的工具目录入口，并保留编码转换双结果", async () => {
    const tools = await loadMarkup("../../pages/tools/index.html");
    const template = tools.querySelector("#tool-workbench-template").content;
    assert.isTrue(Boolean(template.querySelector("[data-tool-page='true']")));
    assert.equal("../mouse_options.html#toolsOverview", template.querySelector("[data-i18n='allTools']").getAttribute("href"));
    assert.isTrue(Boolean(template.querySelector(".workbench-foot #tool-status[role='status']")));
    assert.isTrue(template.querySelector("#tool-run") === null);
    for (const selector of ["#codec-output", "#codec-decode-output", "#tool-input", "#tool-file-trigger"]) {
      assert.isTrue(Boolean(tools.querySelector(`main ${selector}`)));
    }
  });

  should("更新分段控件的按下状态，只在值改变时执行回调", () => {
    const values = [];
    const control = segments("test", "测试", [["left", "左"], ["right", "右"]], "left", (value) => values.push(value));
    control.buttons.get("left").click();
    control.buttons.get("right").click();
    assert.equal(["right"], values);
    assert.equal("right", control.value);
    assert.equal("false", control.buttons.get("left").getAttribute("aria-pressed"));
    assert.equal("true", control.buttons.get("right").getAttribute("aria-pressed"));
  });

  should("按原文展示表格内容，只用文本和 mark 表示行内差异", () => {
    const table = document.createElement("div");
    renderTablePreview(table, [["header"], ["<strong>literal</strong>"]], { rows: 2, columns: 1 });
    assert.equal("col", table.querySelector("th").scope);
    assert.equal("<strong>literal</strong>", table.querySelector("td").textContent);
    assert.isTrue(table.querySelector("strong") === null);
    const [before, after] = markDiffPair("name = item01 <b>", "name = item02 <b>");
    assert.equal("1", before.querySelector("mark").textContent);
    assert.equal("2", after.querySelector("mark").textContent);
    assert.equal("name = item02 <b>", after.textContent);
    assert.isTrue(after.querySelector("b") === null);
  });

  should("忽略旧转换的结果，只把最新一次绘制到界面", async () => {
    let resolve;
    let value = 1;
    const shown = [];
    const refresh = liveResult(() => value === 1 ? new Promise((finish) => resolve = finish) : value,
      (result) => shown.push(result), (error) => { throw error; });
    const first = refresh();
    await Promise.resolve();
    value = 2;
    const second = refresh();
    resolve(1);
    await Promise.all([first, second]);
    assert.equal([2], shown);
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
    assert.isTrue(overlay.stage.classList.contains("is-cancel-hovered"));
    overlay.setHud("滚动提示", true);
    assert.isFalse(overlay.stage.classList.contains("is-cancel-hovered"));
    overlay.setTheme("paper-ink");
    assert.equal("paper-ink", overlay.root.dataset.btTheme);
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
