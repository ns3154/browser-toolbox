import "../test_helper.js";
import "../../../lib/browser_toolbox/command_center.js";

context("Command center", () => {
  should("combine searchable commands, tools, and settings in stable order", () => {
    const api = BrowserToolboxCommandCenter;
    const entries = api.createEntries({
      commands: [
        {
          name: "scrollToTop",
          title: "Scroll to top",
          i18nKey: "command_scrollToTop",
          category: "navigation",
          supportedInputs: ["ui"],
          requiredContext: [],
        },
        {
          name: "BrowserToolbox.openCommandCenter",
          title: "Open command center",
          supportedInputs: ["ui"],
          requiredContext: [],
        },
        {
          name: "copySelection",
          title: "Copy selected text",
          supportedInputs: ["ui"],
          requiredContext: ["selection"],
        },
      ],
      tools: [{ id: "json.format", titleKey: "toolJsonFormat", descriptionKey: "toolJsonDescription" }],
      settings: [{ id: "mouse", title: "Mouse settings", hash: "#mouse" }],
      localize: (key) => ({
        command_scrollToTop: "Scroll to top",
        toolJsonFormat: "JSON formatter",
        toolJsonDescription: "Format JSON",
      }[key] || key),
    });
    assert.equal(["command:scrollToTop", "tool:json.format", "setting:mouse"], entries.map((entry) => entry.id));
    assert.equal(["tool:json.format"], api.searchEntries(entries, "JSON").map((entry) => entry.id));
    assert.equal([], api.searchEntries(entries, "selection").map((entry) => entry.id));
  });

  should("rank exact titles before broader keyword matches", () => {
    const entries = [
      { id: "command:reloadPage", title: "Reload page", description: "Refresh", category: "navigation" },
      { id: "command:reload", title: "Reload", description: "Refresh the page", category: "navigation" },
    ];
    assert.equal(
      ["command:reload", "command:reloadPage"],
      BrowserToolboxCommandCenter.searchEntries(entries, "reload").map((entry) => entry.id),
    );
  });

  should("fall back to command metadata when a locale key is unavailable", () => {
    const entries = BrowserToolboxCommandCenter.createEntries({
      commands: [{
        name: "goBack",
        title: "Go back",
        i18nKey: "command_goBack",
        supportedInputs: ["ui"],
        requiredContext: [],
      }],
      localize: (key) => key,
    });
    assert.equal("Go back", entries[0].title);
  });
});
