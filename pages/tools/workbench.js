// SPDX-License-Identifier: GPL-3.0-or-later
import { mountDiff } from "./diff_workspace.js";
import { mountId, mountPassword } from "./generator_workspace.js";
import { mountJson } from "./json_workspace.js";
import { mountConfig } from "./properties_yaml_view.js";
import { mountTable } from "./table_workspace.js";
import { mountTime } from "./time_workspace.js";
import { node, t } from "./workbench_view.js";

const views = {
  "json.format": mountJson,
  "config.convert": mountConfig,
  "table.convert": mountTable,
  "text.diff": mountDiff,
  "time.convert": mountTime,
  "id.generate": mountId,
  "password.generate": mountPassword,
};

export async function mountWorkbench(descriptor, implementation, params, consumeInput) {
  const template = document.getElementById("tool-workbench-template");
  const page = template.content.firstElementChild.cloneNode(true);
  document.querySelector("main").replaceWith(page);
  document.body.className = "tool-workbench-document";
  document.body.dataset.toolId = descriptor.id;
  globalThis.BrowserToolboxI18n.apply(page);
  page.querySelector("#tool-title").textContent = document.title = t(descriptor.titleKey);
  const toolbar = page.querySelector("#tool-controls");
  const board = page.querySelector("#tool-workspace");
  const footer = page.querySelector(".workbench-foot");
  const statusText = page.querySelector("#tool-status");
  const stats = page.querySelector(".workbench-stats");
  const notification = page.querySelector(".workbench-toast");
  let toastTimer;
  function toast(text, error = false) {
    clearTimeout(toastTimer);
    notification.textContent = text;
    notification.classList.toggle("is-error", error);
    toastTimer = setTimeout(() => notification.textContent = "", 2100);
  }
  const ctx = {
    descriptor,
    implementation,
    toolbar,
    board,
    footer,
    toast,
    status(text, { ok = false, error = false, warning = false } = {}) {
      statusText.textContent = text;
      statusText.dataset.state = error ? "error" : warning ? "warning" : ok ? "valid" : "";
    },
    stats(...values) {
      stats.replaceChildren(...values.filter(Boolean).map((value) => node("span", "", value)));
    },
    async copy(text) {
      if (!text) return;
      const success = await globalThis.BrowserToolboxToolRuntime.copyText(text);
      toast(t(success ? "toolCopied" : "toolCopyUnavailable"), !success);
    },
  };
  const view = views[descriptor.id](ctx);
  toolbar.hidden = !toolbar.childElementCount;
  let invalidToken = false;
  if (params.get("inputToken") && view.input) {
    const consumed = await consumeInput();
    invalidToken = !consumed || consumed.toolId !== descriptor.id;
    if (!invalidToken) view.input.set(consumed.input ?? "");
  }
  await view.refresh();
  const notice = params.get("notice");
  if (invalidToken) ctx.status(t("toolTokenInvalid"), { error: true });
  else if (notice === "empty-selection") ctx.status(t("toolEmptySelection"));
  else if (notice === "selection-too-large") {
    ctx.status(t("toolSelectionTooLarge"), { error: true });
  }
}
