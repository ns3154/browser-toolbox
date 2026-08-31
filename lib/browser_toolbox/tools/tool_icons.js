// 工具图标工厂：所有图标都来自本地 SVG 路径，不加载远程资源。
(function () {
  const PATHS = Object.freeze({
    toolbox: "M4 8h16v12H4zM8 8V5h8v3M2 12h20M8 12v2m8-2v2",
    braces: "M8 4H6a2 2 0 0 0-2 2v3a3 3 0 0 1-2 3 3 3 0 0 1 2 3v3a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v3a3 3 0 0 0 2 3 3 3 0 0 0-2 3v3a2 2 0 0 1-2 2h-2",
    diff: "M5 5h14M5 12h8M5 19h14M16 9l3 3-3 3",
    code: "m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14",
    clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    hash: "M10 3 8 21M16 3l-2 18M4 9h16M3 15h16",
    key: "M15.5 7.5a4.5 4.5 0 1 0-8.4 2.2L3 14v3h3v3h3v-3h2.1l2.6-2.6a4.5 4.5 0 0 0 1.8-6.9ZM12 7.5h.01",
    table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M16 5v14",
    mouse: "M12 3.5C7.6 3.5 4 7 4 11.5v5C4 21 7.6 24.5 12 24.5s8-3.5 8-8v-5c0-4.5-3.6-8-8-8ZM12 4v8m-8 0h16",
    drag: "M8 21V8a3 3 0 0 1 6 0v5-7a3 3 0 0 1 6 0v9m-7-5V6a3 3 0 0 1 6 0v7m-6-2V8a3 3 0 0 1 6 0v8m-17-4 3 3 3-3",
    wheel: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v5m-5 4h10",
    keyboard: "M4 6h16v12H4zM7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 14h10",
    search: "M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4ZM16 16l5 5",
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    sliders: "M5 6h14M5 12h14M5 18h14M9 4v4m6 2v4m-4 6v4",
    shield: "M12 3 20 6v5c0 5-3.2 8.4-8 10-4.8-1.6-8-5-8-10V6l8-3Z",
    lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5m0-8h.01",
    arrowLeft: "M19 12H5m7-7-7 7 7 7",
    settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM4.5 13.5l-1.2.7 1.8 3.1 1.3-.7a7.5 7.5 0 0 0 2.1 1.2V19.3h3.6v-1.5a7.5 7.5 0 0 0 2.1-1.2l1.3.7 1.8-3.1-1.2-.7a7.6 7.6 0 0 0 0-2.4l1.2-.7-1.8-3.1-1.3.7a7.5 7.5 0 0 0-2.1-1.2V5.3H8.5v1.5a7.5 7.5 0 0 0-2.1 1.2l-1.3-.7-1.8 3.1 1.2.7a7.6 7.6 0 0 0 0 2.4Z",
    copy: "M9 9h10v11H9zM5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1",
    trash: "M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3",
    chevron: "m7 9 5 5 5-5",
    download: "M12 3v12m0 0 4-4m-4 4-4-4M5 21h14",
    restore: "M4 12a8 8 0 1 0 2.3-5.6L4 8.7M4 4v4.7h4.7",
    compress: "M9 3H3v6m0-6 7 7M15 3h6v6m0-6-7 7M9 21H3v-6m0 6 7-7M15 21h6v-6m0 6-7-7",
    sort: "M4 6h8M4 12h6M4 18h4M17 4v16m0 0 3-3m-3 3-3-3",
    more: "M5 12h.01M12 12h.01M19 12h.01",
  });

  function createIcon(name, options = {}) {
    const documentRef = options.documentRef || globalThis.document;
    const svg = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", options.className || "browser-toolbox-tool-icon");
    const path = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", PATHS[name] || PATHS.code);
    svg.append(path);
    return svg;
  }

  globalThis.BrowserToolboxToolIcons = Object.freeze({ createIcon });
})();
