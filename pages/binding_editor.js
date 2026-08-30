// 设置页绑定编辑器：负责四类输入模块的绑定表格，不负责保存、迁移或页面导航。
/**
 * 绑定编辑器依赖。
 * @typedef {Object} BrowserToolboxBindingEditorOptions
 * @property {Document} [documentRef] 用于渲染的文档。
 * @property {function(): Object} getSettings 获取可变设置。
 * @property {Object} getRegistry 获取命令注册表。
 * @property {function(string): string} message 本地化函数。
 * @property {Object} quantizer 方向量化器。
 * @property {function(): void} [markDirty] 标记草稿变更。
 * @property {function(string): string} [idFactory] 生成绑定 ID。
 * @property {function(string): void} [onBindingsChange] 绑定变更后的视图刷新回调。
 */
(function () {
  const DIRECTION_MESSAGE_KEYS = Object.freeze({
    U: "gestureDirectionUp",
    D: "gestureDirectionDown",
    L: "gestureDirectionLeft",
    R: "gestureDirectionRight",
    UL: "gestureDirectionUpLeft",
    UR: "gestureDirectionUpRight",
    DL: "gestureDirectionDownLeft",
    DR: "gestureDirectionDownRight",
  });

  class BindingEditor {
    /**
     * 创建绑定表格编辑器。
     * @param {BrowserToolboxBindingEditorOptions} options 编辑器依赖。
     */
    constructor({
      documentRef = globalThis.document,
      getSettings,
      getRegistry,
      message,
      quantizer,
      markDirty = () => {},
      idFactory = (prefix) => `${prefix}-${Date.now()}`,
      onBindingsChange = () => {},
    }) {
      this.document = documentRef;
      this.getSettings = getSettings;
      this.getRegistry = getRegistry;
      this.message = message;
      this.quantizer = quantizer;
      this.markDirty = markDirty;
      this.idFactory = idFactory;
      this.onBindingsChange = onBindingsChange;
    }

    get settings() {
      return this.getSettings();
    }

    get registry() {
      return this.getRegistry();
    }

    cell(value) {
      const cell = this.document.createElement("td");
      if (
        value && typeof globalThis.Node !== "undefined" && value instanceof globalThis.Node
      ) {
        cell.appendChild(value);
      } else {
        cell.textContent = value == null ? "" : String(value);
      }
      return cell;
    }

    rowButton(labelKey, onClick) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.textContent = this.message(labelKey);
      button.setAttribute("aria-label", this.message(labelKey));
      button.addEventListener("click", onClick);
      return button;
    }

    fieldInput(value, labelKey) {
      const input = this.document.createElement("input");
      input.type = "text";
      input.value = value || "";
      input.setAttribute("aria-label", this.message(labelKey));
      return input;
    }

    fieldSelect(value, labelKey, options) {
      const select = this.document.createElement("select");
      select.setAttribute("aria-label", this.message(labelKey));
      for (const [optionValue, optionLabel] of options) {
        const option = this.document.createElement("option");
        option.value = optionValue;
        option.textContent = optionLabel;
        select.appendChild(option);
      }
      select.value = value;
      return select;
    }

    patternControl(binding) {
      const input = this.fieldInput(this.quantizer.formatPattern(binding.pattern), "pattern");
      input.className = "browser-toolbox-binding-pattern";
      input.autocomplete = "off";
      input.spellcheck = false;
      const updateAccessiblePattern = () => {
        const pattern = this.quantizer.normalizePattern(input.value);
        const labels = pattern.map((direction) => this.message(DIRECTION_MESSAGE_KEYS[direction]));
        input.dataset.pattern = pattern.join(">");
        input.setAttribute(
          "aria-label",
          `${this.message("pattern")}: ${labels.join(", ") || this.message("none")}`,
        );
      };
      input.addEventListener("input", updateAccessiblePattern);
      input.addEventListener("blur", () => {
        input.value = this.quantizer.formatPattern(input.value);
        updateAccessiblePattern();
      });
      updateAccessiblePattern();
      return input;
    }

    dangerousWarning(command) {
      if (!command?.dangerous) return null;
      const warning = this.document.createElement("span");
      warning.className = "browser-toolbox-dangerous-warning";
      warning.setAttribute("role", "note");
      warning.textContent = `⚠ ${this.message("dangerousCommandWarning")}`;
      return warning;
    }

    optionSchemaEntries(command) {
      return Object.entries(command?.optionSchema || {}).filter(([, rule]) =>
        ["boolean", "enum", "string"].includes(rule?.type)
      );
    }

    optionSchemaEditor(binding, command, textarea) {
      const entries = this.optionSchemaEntries(command);
      if (entries.length === 0) return null;
      const fields = this.document.createElement("div");
      fields.className = "browser-toolbox-options-fields";
      const controls = new Map();
      const defaultLabel = this.message("optionsDefault");

      const syncControls = () => {
        const options = binding.options && typeof binding.options === "object" &&
            !Array.isArray(binding.options)
          ? binding.options
          : {};
        for (const [name, control] of controls) {
          if (control.tagName === "SELECT") {
            control.value = Object.hasOwn(options, name) ? String(options[name]) : "";
          } else {
            control.value = typeof options[name] === "string" ? options[name] : "";
          }
        }
      };

      const syncTextarea = () => {
        textarea.value = JSON.stringify(binding.options || {}, null, 2);
        textarea.classList.remove("browser-toolbox-invalid");
      };

      for (const [name, rule] of entries) {
        const label = this.document.createElement("label");
        label.className = "browser-toolbox-option-field";
        const title = this.document.createElement("span");
        title.textContent = name;
        let control;
        if (rule.type === "enum" || rule.type === "boolean") {
          control = this.document.createElement("select");
          const defaultOption = this.document.createElement("option");
          defaultOption.value = "";
          defaultOption.textContent = defaultLabel;
          control.appendChild(defaultOption);
          const values = rule.type === "boolean" ? ["true", "false"] : rule.values || [];
          for (const value of values) {
            const option = this.document.createElement("option");
            option.value = String(value);
            option.textContent = String(value);
            control.appendChild(option);
          }
        } else {
          control = this.document.createElement("input");
          control.type = "text";
          control.placeholder = defaultLabel;
        }
        control.dataset.optionName = name;
        control.setAttribute("aria-label", `${this.message("options")}: ${name}`);
        const updateBinding = () => {
          const options = binding.options && typeof binding.options === "object" &&
              !Array.isArray(binding.options)
            ? binding.options
            : {};
          if (control.tagName === "SELECT") {
            if (control.value === "") delete options[name];
            else options[name] = rule.type === "boolean" ? control.value === "true" : control.value;
          } else if (control.value === "") delete options[name];
          else options[name] = control.value;
          binding.options = options;
          syncTextarea();
          this.markDirty();
        };
        control.addEventListener(control.tagName === "SELECT" ? "change" : "input", updateBinding);
        controls.set(name, control);
        label.append(title, control);
        fields.appendChild(label);
      }
      syncControls();
      textarea._syncOptionControls = syncControls;
      return fields;
    }

    commandOptions(select, selected, inputSource = "mouseGesture", contextType = null) {
      select.replaceChildren();
      const invocation = globalThis.BrowserToolboxCommandInvocation;
      const supported = this.registry.commands.filter((command) =>
        invocation?.validateCommandMetadata
          ? invocation.validateCommandMetadata(command, {
            source: inputSource,
            contextType,
            options: {},
          }).ok
          : command.supportedInputs?.includes(inputSource)
      );
      const commands = supported.some((command) => command.name === selected) ? supported : [
        ...supported,
        this.registry.getCommand(selected) || {
          name: selected,
          title: selected + " (unsupported)",
          supportedInputs: [],
        },
      ];
      for (const command of commands) {
        const option = this.document.createElement("option");
        option.value = command.name;
        const localized = command.i18nKey &&
            globalThis.BrowserToolboxI18n?.hasMessage?.(command.i18nKey)
          ? this.message(command.i18nKey)
          : null;
        option.textContent = localized || command.title || command.desc || command.name;
        if (command.dangerous) option.dataset.dangerous = "true";
        option.selected = command.name === selected;
        select.appendChild(option);
      }
      return this.registry.getCommand(selected);
    }

    optionsEditor(binding, command) {
      const details = this.document.createElement("details");
      details.className = "browser-toolbox-binding-options";
      const summary = this.document.createElement("summary");
      summary.textContent = this.message("options");
      const textarea = this.document.createElement("textarea");
      textarea.rows = 2;
      textarea.spellcheck = false;
      textarea.className = "browser-toolbox-options-json";
      textarea.setAttribute("aria-label", this.message("options"));
      textarea.value = JSON.stringify(binding.options || {}, null, 2);
      const schemaEditor = this.optionSchemaEditor(binding, command, textarea);
      const hint = this.document.createElement("span");
      hint.className = "browser-toolbox-options-hint";
      const optionNames = Object.keys(command?.optionSchema || {});
      hint.textContent = optionNames.length > 0
        ? `${this.message("optionsHint")} (${optionNames.join(", ")})`
        : command?.options
        ? this.message("optionsHint")
        : "{}";
      textarea.addEventListener("input", () => {
        try {
          const value = JSON.parse(textarea.value || "{}");
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
          binding.options = value;
          textarea.classList.remove("browser-toolbox-invalid");
          textarea._syncOptionControls?.();
        } catch (_) {
          binding.options = null;
          textarea.classList.add("browser-toolbox-invalid");
          textarea._syncOptionControls?.();
        }
        this.markDirty();
      });
      details.append(summary);
      if (schemaEditor) details.append(schemaEditor);
      details.append(textarea, hint);
      return details;
    }

    optionsCell(binding, command) {
      const wrapper = this.document.createElement("div");
      wrapper.className = "browser-toolbox-options-cell";
      wrapper.appendChild(this.optionsEditor(binding, command));
      return wrapper;
    }

    commandControl(binding, inputSource, contextType = null) {
      const wrapper = this.document.createElement("div");
      wrapper.className = "browser-toolbox-command-control";
      const select = this.document.createElement("select");
      this.commandOptions(select, binding.commandName, inputSource, contextType);
      select.setAttribute("aria-label", this.message("command"));
      const warningHost = this.document.createElement("span");
      const updateWarning = () => {
        warningHost.replaceChildren();
        const warning = this.dangerousWarning(this.registry.getCommand(select.value));
        if (warning) warningHost.appendChild(warning);
      };
      select.addEventListener("change", () => {
        binding.commandName = select.value;
        binding.options = {};
        const optionsCell = select.closest("tr")?.querySelector(".browser-toolbox-options-cell");
        optionsCell?.replaceChildren(
          this.optionsEditor(binding, this.registry.getCommand(select.value)),
        );
        updateWarning();
        this.markDirty();
      });
      wrapper.append(select, warningHost);
      updateWarning();
      return { wrapper, select };
    }

    enabledControl(binding) {
      const label = this.document.createElement("label");
      label.className = "browser-toolbox-check";
      const input = this.document.createElement("input");
      input.type = "checkbox";
      input.checked = binding.enabled !== false;
      input.setAttribute("aria-label", this.message("enabled"));
      label.append(input, this.document.createTextNode(this.message("enabled")));
      return { label, input };
    }

    ensureCommandCompatible(binding, inputSource, contextType) {
      const command = this.registry.getCommand(binding.commandName);
      const validate = globalThis.BrowserToolboxCommandInvocation?.validateCommandMetadata;
      if (
        !validate || validate(command, {
          source: inputSource,
          contextType,
          options: binding.options || {},
        }).ok
      ) return;
      const replacement = this.registry.commands.find((candidate) =>
        validate(candidate, { source: inputSource, contextType, options: {} }).ok
      );
      if (replacement) {
        binding.commandName = replacement.name;
        binding.options = {};
      }
    }

    renderCommandCells(row, binding, inputSource, contextType = null) {
      this.ensureCommandCompatible(binding, inputSource, contextType);
      const commandCell = row.querySelector(".browser-toolbox-command-cell");
      const optionsCell = row.querySelector(".browser-toolbox-options-cell");
      const commandNode = this.commandControl(binding, inputSource, contextType);
      commandCell?.replaceChildren(commandNode.wrapper);
      optionsCell?.replaceChildren(
        this.optionsEditor(binding, this.registry.getCommand(binding.commandName)),
      );
      row._command = commandNode.select;
    }

    renderMouseBindings() {
      const body = this.document.querySelector("#mouse-bindings");
      if (!body) return;
      body.replaceChildren();
      for (const binding of this.settings.mouse.bindings) {
        const row = this.document.createElement("tr");
        const pattern = this.patternControl(binding);
        const commandNode = this.commandControl(binding, "mouseGesture");
        const enabledNode = this.enabledControl(binding);
        const remove = this.rowButton("removeBinding", () => {
          this.settings.mouse.bindings = this.settings.mouse.bindings.filter((item) =>
            item !== binding
          );
          this.renderMouseBindings();
          this.onBindingsChange("mouse");
          this.markDirty();
        });
        row.append(
          this.cell(pattern),
          Object.assign(this.cell(commandNode.wrapper), {
            className: "browser-toolbox-command-cell",
          }),
          this.cell(enabledNode.label),
          Object.assign(
            this.cell(this.optionsCell(binding, this.registry.getCommand(binding.commandName))),
            {
              className: "browser-toolbox-options-cell",
            },
          ),
          this.cell(remove),
        );
        row._binding = binding;
        row._pattern = pattern;
        row._command = commandNode.select;
        row._enabled = enabledNode.input;
        body.appendChild(row);
      }
    }

    renderSuperDragBindings() {
      const body = this.document.querySelector("#super-drag-bindings");
      if (!body) return;
      body.replaceChildren();
      for (const binding of this.settings.superDrag.bindings) {
        const row = this.document.createElement("tr");
        row._binding = binding;
        const context = this.fieldSelect(binding.context, "context", [
          ["LINK", this.message("contextLink")],
          ["SELECTED_TEXT", this.message("contextSelection")],
          ["IMAGE", this.message("contextImage")],
        ]);
        const pattern = this.patternControl(binding);
        const commandNode = this.commandControl(binding, "superDrag", binding.context);
        const enabledNode = this.enabledControl(binding);
        const remove = this.rowButton("removeBinding", () => {
          this.settings.superDrag.bindings = this.settings.superDrag.bindings.filter((item) =>
            item !== binding
          );
          this.renderSuperDragBindings();
          this.onBindingsChange("superDrag");
          this.markDirty();
        });
        context.addEventListener("change", () => {
          binding.context = context.value;
          this.renderCommandCells(row, binding, "superDrag", binding.context);
          this.markDirty();
        });
        row.append(
          this.cell(context),
          this.cell(pattern),
          Object.assign(this.cell(commandNode.wrapper), {
            className: "browser-toolbox-command-cell",
          }),
          this.cell(enabledNode.label),
          Object.assign(
            this.cell(this.optionsCell(binding, this.registry.getCommand(binding.commandName))),
            {
              className: "browser-toolbox-options-cell",
            },
          ),
          this.cell(remove),
        );
        row._context = context;
        row._pattern = pattern;
        row._command = commandNode.select;
        row._enabled = enabledNode.input;
        body.appendChild(row);
      }
    }

    renderWheelBindings() {
      const body = this.document.querySelector("#wheel-bindings");
      if (!body) return;
      body.replaceChildren();
      for (const binding of this.settings.wheel.bindings) {
        const row = this.document.createElement("tr");
        row._binding = binding;
        const button = this.fieldSelect(binding.button, "button", [
          ["LEFT_BUTTON", this.message("leftButton")],
          ["RIGHT_BUTTON", this.message("rightButton")],
          ["MIDDLE_BUTTON", this.message("middleButton")],
        ]);
        const direction = this.fieldSelect(binding.direction, "direction", [
          ["UP", this.message("up")],
          ["DOWN", this.message("down")],
        ]);
        const commandNode = this.commandControl(binding, "wheel");
        const enabledNode = this.enabledControl(binding);
        const remove = this.rowButton("removeBinding", () => {
          this.settings.wheel.bindings = this.settings.wheel.bindings.filter((item) =>
            item !== binding
          );
          this.renderWheelBindings();
          this.onBindingsChange("wheel");
          this.markDirty();
        });
        row.append(
          this.cell(button),
          this.cell(direction),
          Object.assign(this.cell(commandNode.wrapper), {
            className: "browser-toolbox-command-cell",
          }),
          this.cell(enabledNode.label),
          Object.assign(
            this.cell(this.optionsCell(binding, this.registry.getCommand(binding.commandName))),
            {
              className: "browser-toolbox-options-cell",
            },
          ),
          this.cell(remove),
        );
        row._button = button;
        row._direction = direction;
        row._command = commandNode.select;
        row._enabled = enabledNode.input;
        body.appendChild(row);
      }
    }

    renderRockerBindings() {
      const body = this.document.querySelector("#rocker-bindings");
      if (!body) return;
      body.replaceChildren();
      for (const binding of this.settings.rocker.bindings) {
        const row = this.document.createElement("tr");
        row._binding = binding;
        const sequence = this.fieldSelect(binding.sequence, "sequence", [
          ["HOLD_RIGHT_THEN_CLICK_LEFT", this.message("holdRightThenClickLeft")],
          ["HOLD_LEFT_THEN_CLICK_RIGHT", this.message("holdLeftThenClickRight")],
        ]);
        const commandNode = this.commandControl(binding, "rocker");
        const enabledNode = this.enabledControl(binding);
        const remove = this.rowButton("removeBinding", () => {
          this.settings.rocker.bindings = this.settings.rocker.bindings.filter((item) =>
            item !== binding
          );
          this.renderRockerBindings();
          this.onBindingsChange("rocker");
          this.markDirty();
        });
        row.append(
          this.cell(sequence),
          Object.assign(this.cell(commandNode.wrapper), {
            className: "browser-toolbox-command-cell",
          }),
          this.cell(enabledNode.label),
          Object.assign(
            this.cell(this.optionsCell(binding, this.registry.getCommand(binding.commandName))),
            {
              className: "browser-toolbox-options-cell",
            },
          ),
          this.cell(remove),
        );
        row._sequence = sequence;
        row._command = commandNode.select;
        row._enabled = enabledNode.input;
        body.appendChild(row);
      }
    }

    /**
     * 渲染指定输入模块的绑定。
     * @param {string} kind 输入模块类型。
     * @returns {void}
     */
    render(kind) {
      const renderers = {
        mouse: () => this.renderMouseBindings(),
        superDrag: () => this.renderSuperDragBindings(),
        wheel: () => this.renderWheelBindings(),
        rocker: () => this.renderRockerBindings(),
      };
      renderers[kind]?.();
    }

    /**
     * 渲染全部绑定表格。
     * @returns {void}
     */
    renderAll() {
      this.renderMouseBindings();
      this.renderSuperDragBindings();
      this.renderWheelBindings();
      this.renderRockerBindings();
    }

    /**
     * 从当前 DOM 控件同步回绑定对象。
     * @returns {void}
     */
    sync() {
      for (const row of this.document.querySelectorAll("tbody tr")) {
        if (!row._binding) continue;
        const binding = row._binding;
        if (row._pattern) binding.pattern = this.quantizer.normalizePattern(row._pattern.value);
        if (row._context) binding.context = row._context.value;
        if (row._button) binding.button = row._button.value;
        if (row._direction) binding.direction = row._direction.value;
        if (row._sequence) binding.sequence = row._sequence.value;
        if (row._command) binding.commandName = row._command.value;
        if (row._enabled) binding.enabled = row._enabled.checked;
      }
    }
  }

  globalThis.BrowserToolboxBindingEditor = Object.freeze({ BindingEditor });
})();
