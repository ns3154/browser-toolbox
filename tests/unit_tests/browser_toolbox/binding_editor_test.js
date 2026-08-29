/**
 * 绑定编辑器的单元测试。
 * 测试输入为固定设置快照和 DOM 夹具，输出为断言结果。
 */
import "../test_helper.js";
import * as testHelper from "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../pages/binding_editor.js";

context("Binding editor", () => {
  let editor;

  setup(async () => {
    await testHelper.jsdomStub("pages/mouse_options.html");
    editor = new BrowserToolboxBindingEditor.BindingEditor({
      documentRef: document,
      getSettings: () => ({}),
      getRegistry: () => ({ commands: [], getCommand: () => null }),
      message: (key) => ({ optionsDefault: "Default" }[key] || key),
      markDirty: () => {},
    });
  });

  should("provide schema-driven controls while keeping the JSON editor synchronized", () => {
    const binding = { options: {} };
    const details = editor.optionsEditor(binding, {
      optionSchema: {
        hard: { type: "boolean" },
        disposition: { type: "enum", values: ["foreground", "background"] },
      },
    });
    const hard = details.querySelector("select[data-option-name='hard']");
    const disposition = details.querySelector("select[data-option-name='disposition']");
    const textarea = details.querySelector("textarea");

    assert.isTrue(Boolean(hard));
    assert.equal("", hard.value);
    assert.equal("", disposition.value);
    hard.value = "true";
    hard.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.isTrue(binding.options.hard);
    assert.isTrue(textarea.value.includes('"hard": true'));

    textarea.value = '{"hard":false,"disposition":"background"}';
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal("false", hard.value);
    assert.equal("background", disposition.value);

    disposition.value = "";
    disposition.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.isFalse(Object.hasOwn(binding.options, "disposition"));
  });

  should("update string options from the binding editor", () => {
    const binding = { options: {} };
    const details = editor.optionsEditor(binding, {
      optionSchema: { keyword: { type: "string", maxLength: 64 } },
    });
    const keyword = details.querySelector("input[data-option-name='keyword']");
    const textarea = details.querySelector("textarea");

    assert.isTrue(Boolean(keyword));
    keyword.value = "local";
    keyword.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal("local", binding.options.keyword);
    assert.isTrue(textarea.value.includes('"keyword": "local"'));
  });

  should("fall back to the plain JSON editor for commands without a schema", () => {
    const details = editor.optionsEditor({ options: { position: "after" } }, {
      options: { position: "Where to place the tab." },
    });
    assert.equal(0, details.querySelectorAll(".browser-toolbox-options-fields").length);
    assert.equal('{\n  "position": "after"\n}', details.querySelector("textarea").value);
  });
});
