// 工具设置控件：从静态工具注册表生成入口，不复制工具 ID 或工具标题。
(function () {
  const registry = globalThis.BrowserToolboxToolRegistry;
  const message = (key) => globalThis.BrowserToolboxI18n?.message(key) || key;
  const groups = Object.freeze([
    { id: "action-tool-list", path: ["pinnedIds"], source: "action", surface: "popup", max: 6 },
    {
      id: "context-menu-tool-list",
      path: ["contextMenu", "toolIds"],
      source: "selection",
      surface: "contextMenu",
      max: 3,
    },
  ]);

  function readPath(value, path) {
    return path.reduce((current, key) => current?.[key], value);
  }

  function writePath(value, path, result) {
    const parent = path.slice(0, -1).reduce((current, key) => current[key], value);
    parent[path.at(-1)] = result;
  }

  function createToolIcon(descriptor) {
    return globalThis.BrowserToolboxToolIcons?.createIcon(descriptor.icon, {
      className: "browser-toolbox-tool-icon",
    }) || document.createElement("span");
  }

  function toolPageUrl(toolId) {
    const path = `pages/tools/index.html?tool=${encodeURIComponent(toolId)}&source=settings`;
    return globalThis.chrome?.runtime?.getURL?.(path) || `../${path}`;
  }

  function createToolRow(descriptor, group) {
    const label = document.createElement("label");
    label.className = "browser-toolbox-tool-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.toolId = descriptor.id;
    input.dataset.toolGroup = group.id;
    input.setAttribute("aria-describedby", `${group.id}-description`);
    const icon = createToolIcon(descriptor);
    const copy = document.createElement("span");
    copy.className = "browser-toolbox-tool-option-copy";
    const title = document.createElement("strong");
    title.textContent = message(descriptor.titleKey);
    const description = document.createElement("small");
    description.textContent = message(descriptor.descriptionKey);
    copy.append(title, description);
    const mark = document.createElement("i");
    mark.className = "browser-toolbox-tool-option-mark";
    mark.setAttribute("aria-hidden", "true");
    label.append(input, icon, copy, mark);
    return label;
  }

  function searchableToolText(descriptor) {
    return [
      descriptor.id,
      descriptor.categoryId,
      message(descriptor.titleKey),
      message(descriptor.descriptionKey),
      ...descriptor.keywordKeys.map((key) => message(key)),
    ].join(" ").toLocaleLowerCase();
  }

  function createToolDirectoryItem(descriptor) {
    const item = document.createElement("article");
    item.className = "browser-toolbox-tool-directory-item";
    const icon = createToolIcon(descriptor);
    const copy = document.createElement("span");
    copy.className = "browser-toolbox-tool-directory-copy";
    const title = document.createElement("strong");
    title.textContent = message(descriptor.titleKey);
    const description = document.createElement("small");
    description.textContent = message(descriptor.descriptionKey);
    const id = document.createElement("code");
    id.textContent = descriptor.id;
    copy.append(title, description, id);
    const link = document.createElement("a");
    link.href = toolPageUrl(descriptor.id);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = message("toolOpen");
    item.append(icon, copy, link);
    return item;
  }

  function renderDirectory(root = document, query = "") {
    const container = root.querySelector("#browser-tool-directory");
    if (!container) return;
    const normalized = String(query).trim().toLocaleLowerCase();
    container.replaceChildren();
    for (const category of registry.categories) {
      const descriptors = registry.entries.filter((descriptor) =>
        descriptor.categoryId === category.id &&
        (!normalized || searchableToolText(descriptor).includes(normalized))
      );
      if (descriptors.length === 0) continue;
      const group = document.createElement("section");
      group.className = "browser-toolbox-tool-directory-group";
      const heading = document.createElement("h4");
      heading.textContent = message(category.labelKey);
      const list = document.createElement("div");
      list.className = "browser-toolbox-tool-directory-list";
      descriptors.forEach((descriptor) => list.append(createToolDirectoryItem(descriptor)));
      group.append(heading, list);
      container.append(group);
    }
    const status = root.querySelector("#browser-tool-directory-status");
    if (status) {
      const count = container.querySelectorAll(".browser-toolbox-tool-directory-item").length;
      status.textContent = count > 0 ? `${count} · ${message("toolDirectory")}` : message("toolCatalogNoResults");
    }
  }

  function renderCapabilitySections(root = document) {
    for (const container of root.querySelectorAll("[data-tool-capability]")) {
      const descriptors = String(container.dataset.toolCapability || "")
        .split(",")
        .map((id) => registry.get(id.trim()))
        .filter(Boolean);
      container.replaceChildren();
      const grid = document.createElement("div");
      grid.className = "browser-toolbox-capability-grid";
      for (const descriptor of descriptors) {
        const card = document.createElement("article");
        card.className = "browser-toolbox-capability-card";
        const icon = createToolIcon(descriptor);
        const copy = document.createElement("span");
        copy.className = "browser-toolbox-capability-copy";
        const title = document.createElement("strong");
        title.textContent = message(descriptor.titleKey);
        const description = document.createElement("small");
        description.textContent = message(descriptor.descriptionKey);
        copy.append(title, description);
        const link = document.createElement("a");
        link.href = toolPageUrl(descriptor.id);
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = message("toolOpen");
        card.append(icon, copy, link);
        grid.append(card);
      }
      container.append(grid);
    }
  }

  function render(settings, root = document) {
    for (const group of groups) {
      const container = root.querySelector(`#${group.id}`);
      if (!container) continue;
      container.replaceChildren();
      const selected = new Set(readPath(settings?.tools, group.path) || []);
      for (const descriptor of registry.list({ source: group.source, surface: group.surface })) {
        const row = createToolRow(descriptor, group);
        const input = row.querySelector("input");
        input.checked = selected.has(descriptor.id);
        container.append(row);
      }
    }
    renderDirectory(root);
    renderCapabilitySections(root);
    const directorySearch = root.querySelector("#browser-tool-directory-search");
    if (directorySearch && directorySearch.dataset.bound !== "true") {
      directorySearch.dataset.bound = "true";
      directorySearch.addEventListener("input", (event) => {
        renderDirectory(root, event.target.value);
      });
    }
    return settings;
  }

  function readForm(settings, root = document) {
    settings.tools ||= {};
    for (const group of groups) {
      const container = root.querySelector(`#${group.id}`);
      if (!container) continue;
      writePath(settings.tools, group.path, Array.from(
        container.querySelectorAll(`input[data-tool-group="${group.id}"]:checked`),
        (input) => input.dataset.toolId,
      ));
    }
    return settings;
  }

  function writeForm(settings, root = document) {
    return render(settings, root);
  }

  function bindLimitFeedback(root = document) {
    for (const group of groups) {
      const container = root.querySelector(`#${group.id}`);
      const status = root.querySelector(`#${group.id}-status`);
      if (!container || !status) continue;
      container.addEventListener("change", (event) => {
        if (!event.target.matches("input[type=checkbox]")) return;
        const checked = container.querySelectorAll("input[type=checkbox]:checked").length;
        if (checked <= group.max) {
          status.textContent = "";
          return;
        }
        event.target.checked = false;
        status.textContent = `${message("toolSelectionLimit")}: ${group.max}`;
      });
    }
  }

  globalThis.BrowserToolboxToolSettings = Object.freeze({
    groups,
    render,
    readForm,
    writeForm,
    bindLimitFeedback,
    renderDirectory,
    renderCapabilitySections,
  });
})();
