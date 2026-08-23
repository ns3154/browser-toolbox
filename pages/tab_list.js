// 标签页列表只使用 tabs API，不申请 management 权限，也不保存标签历史。
(function () {
  let tabs = [];

  function score(tab, query) {
    if (!query) return 0;
    const text = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
    let index = 0;
    for (const char of query.toLowerCase()) {
      index = text.indexOf(char, index);
      if (index < 0) return -1;
      index++;
    }
    return query.length * 10 - index;
  }

  async function render() {
    const query = document.querySelector("#query").value.trim();
    const list = document.querySelector("#tabs");
    list.replaceChildren();
    const filtered = tabs.map((tab) => ({ tab, score: score(tab, query) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score || a.tab.index - b.tab.index);
    for (const { tab } of filtered) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${tab.pinned ? "📌 " : ""}${tab.title || tab.url || "(untitled)"}`;
      button.addEventListener("click", async () => {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
        window.close();
      });
      button.addEventListener("auxclick", async (event) => {
        if (event.button === 1) {
          event.preventDefault();
          await chrome.tabs.remove(tab.id);
          tabs = tabs.filter((item) => item.id !== tab.id);
          render();
        }
      });
      item.appendChild(button);
      list.appendChild(item);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    OpenKeyMouseI18n.apply(document);
    tabs = await chrome.tabs.query({});
    document.querySelector("#query").addEventListener("input", render);
    render();
  });
})();
