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

  should("支持按完整网址和不带协议的地址搜索普通标签页", () => {
    const url = "http://example.test:8080/report?week=12#summary";
    const tabs = [
      { id: 1, index: 0, title: "统计", url },
      { id: 2, index: 1, title: "Browser Toolbox", url: "chrome-extension://random-id/pages/report.html" },
    ];
    for (const query of [url, "example.test:8080/report", "/report?week=12#summary"]) {
      assert.equal([1], BrowserToolboxTabList.filterTabs(tabs, query).map((tab) => tab.id));
    }
    assert.equal([], BrowserToolboxTabList.filterTabs(tabs, "random-id/pages"));
  });

  should("保留位于长标题末尾的模糊匹配并继续按分数排序", () => {
    const tabs = [
      { id: 1, index: 0, title: "团队联调排期与功能范围说明及上周问题跟进和验收记录补充文档预算" },
      { id: 2, index: 1, title: "预算报告" },
      { id: 3, index: 2, title: "上线清单" },
    ];
    assert.equal([2, 1], BrowserToolboxTabList.filterTabs(tabs, "预算").map((tab) => tab.id));
  });
});
