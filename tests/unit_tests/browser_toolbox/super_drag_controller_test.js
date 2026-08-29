import "../test_helper.js";
import * as jsdom from "jsdom";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../content_scripts/mouse/path_sampler.js";
import "../../../content_scripts/mouse/direction_quantizer.js";
import "../../../content_scripts/mouse/gesture_session.js";
import "../../../content_scripts/mouse/gesture_recognizer.js";
import "../../../content_scripts/mouse/drag_context_classifier.js";
import "../../../content_scripts/mouse/super_drag_controller.js";
import "../../../background_scripts/browser_toolbox/command_registry_adapter.js";

context("Super drag controller", () => {
  should("classify and complete a link drag", () => {
    const doc =
      new jsdom.JSDOM("<a id='link' href='https://example.com'>Example</a>").window.document;
    const controller = new BrowserToolboxSuperDragController({
      enabled: true,
      nativeBypassModifier: "Alt",
      bindings: [{ context: "LINK", pattern: ["R"], commandName: "goForward" }],
    });
    const target = doc.querySelector("#link");
    const event = { button: 0, altKey: false, clientX: 0, clientY: 0, target };
    assert.isTrue(controller.pointerDown(event, "", null));
    controller.pointerMove({ clientX: 24, clientY: 0 });
    const result = controller.pointerUp();
    assert.isTrue(result.active);
    assert.equal("LINK", result.context.type);
    assert.equal("goForward", result.binding.commandName);

    const invocation = BrowserToolboxCommandInvocation.createInvocation(
      result.binding.commandName,
      {},
      { type: "superDrag" },
      result.context,
    );
    const validation = BrowserToolboxCommandInvocation.validateInvocation(
      invocation,
      BrowserToolboxCommandRegistry,
    );
    assert.isTrue(validation.ok);
  });

  should("preserve native input and cancellation paths", () => {
    const doc =
      new jsdom.JSDOM("<input id='input'><a id='link' href='https://example.com'>Link</a>").window
        .document;
    const link = doc.querySelector("#link");
    const input = doc.querySelector("#input");
    const event = { button: 0, altKey: false, clientX: 0, clientY: 0, target: link };
    const controller = new BrowserToolboxSuperDragController({ enabled: false });
    assert.isFalse(controller.pointerDown(event, "", null));
    controller.updateSettings({ enabled: true, nativeBypassModifier: "Alt", bindings: [] });
    assert.isFalse(controller.pointerDown({ ...event, button: 2 }, "", null));
    assert.isFalse(controller.pointerDown({ ...event, altKey: true }, "", null));
    assert.isFalse(controller.pointerDown({ ...event, target: input }, "", null));
    assert.isTrue(controller.pointerDown(event, "", null));
    controller.cancel();
    assert.equal(null, controller.pointerMove({ clientX: 20, clientY: 0 }));
    assert.equal(null, controller.pointerUp());
    assert.isFalse(controller.pointerDown({ ...event, target: input }, "", { files: [{}] }));
  });

  should("honor each configured native drag bypass modifier", () => {
    const doc = new jsdom.JSDOM("<a id='link' href='https://example.com'>Link</a>").window.document;
    const target = doc.querySelector("#link");
    const controller = new BrowserToolboxSuperDragController({ enabled: true, bindings: [] });
    const modifierFlags = {
      Alt: "altKey",
      Control: "ctrlKey",
      Meta: "metaKey",
      Shift: "shiftKey",
    };
    for (const [nativeBypassModifier, flag] of Object.entries(modifierFlags)) {
      controller.updateSettings({ enabled: true, nativeBypassModifier, bindings: [] });
      assert.isFalse(
        controller.pointerDown(
          {
            button: 0,
            clientX: 0,
            clientY: 0,
            target,
            [flag]: true,
          },
          "",
          null,
        ),
        nativeBypassModifier,
      );
    }
  });
});
