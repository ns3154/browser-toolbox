/**
 * 标签页列表搜索的单元测试。
 * 测试输入为模拟 tabs API 数据，输出为排序和扩展 URL 过滤断言。
 */
import "../test_helper.js";
import "../../../pages/tab_list.js";

context("BrowserToolbox tab list", () => {
  should("rank a 50-tab result set without using the extension ID", () => {
    const tabs = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      index,
      title: `Project ${index + 1}`,
      url: `https://example.com/project-${index + 1}`,
    }));
    tabs.push({
      id: 100,
      index: 50,
      title: "chrome-extension://random-id/pages/tab_list.html",
      url: "chrome-extension://random-id/pages/tab_list.html",
    });

    const result = BrowserToolboxTabList.filterTabs(tabs, "project 49");
    assert.equal(1, result.length);
    assert.equal(49, result[0].id);
  });

  should("keep extension page titles searchable when they are not URL placeholders", () => {
    const tabs = [{
      id: 1,
      index: 0,
      title: "Browser Toolbox settings",
      url: "chrome-extension://random-id/pages/mouse_options.html",
    }];
    assert.equal(1, BrowserToolboxTabList.filterTabs(tabs, "settings").length);
  });
});
