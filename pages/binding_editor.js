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
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DIRECTION_MESSAGE_KEYS = Object.freeze({
    U: "gestureDirectionUp",
    D: "gestureDirectionDown",
    L: "gestureDirectionLeft",
    R: "gestureDirectionRight",
  });
  const DIRECTION_VECTORS = Object.freeze({
    U: [0, -1],
    D: [0, 1],
    L: [-1, 0],
    R: [1, 0],
  });
  const OPPOSITE_DIRECTIONS = Object.freeze({ U: "D", D: "U", L: "R", R: "L" });

  // 按四向序列生成缩放居中且带折叠偏置的矢量轨迹点集，避免折返笔画完全重合。
  function buildGesturePreviewGeometry(pattern) {
    if (!Array.isArray(pattern) || pattern.length === 0) return null;
    const raw = [[0, 0]];
    const seenEdges = new Set();
    for (let index = 0; index < pattern.length; index += 1) {
      const dir = pattern[index];
      const vec = DIRECTION_VECTORS[dir];
      if (!vec) continue;
      const prevPoint = raw[raw.length - 1];
      let nextX = prevPoint[0] + vec[0];
      let nextY = prevPoint[1] + vec[1];
      const edgeKey = [
        `${prevPoint[0]},${prevPoint[1]}`,
        `${nextX},${nextY}`,
      ].sort().join("->");
      if (OPPOSITE_DIRECTIONS[pattern[index - 1]] === dir || seenEdges.has(edgeKey)) {
        // 遇折返或重叠线段时先沿垂直法线平滑横向微移，保持往返竖/横线各自笔直平行。
        const nudge = 0.34;
        const shiftedStart = vec[0] === 0
          ? [prevPoint[0] + nudge, prevPoint[1]]
          : [prevPoint[0], prevPoint[1] + nudge];
        raw.push(shiftedStart);
        nextX = shiftedStart[0] + vec[0];
        nextY = shiftedStart[1] + vec[1];
      }
      seenEdges.add(edgeKey);
      raw.push([nextX, nextY]);
    }
    if (raw.length < 2) return null;
    const xs = raw.map((point) => point[0]);
    const ys = raw.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const padX = 8;
    const padY = 7;
    const drawW = 44 - padX * 2;
    const drawH = 40 - padY * 2;
    const scale = Math.min(
      spanX > 0 ? drawW / spanX : drawW,
      spanY > 0 ? drawH / spanY : drawH,
    );
    const offsetX = padX + (drawW - spanX * scale) / 2;
    const offsetY = padY + (drawH - spanY * scale) / 2;
    const points = raw.map(([x, y]) => [
      Math.round((offsetX + (x - minX) * scale) * 10) / 10,
      Math.round((offsetY + (y - minY) * scale) * 10) / 10,
    ]);
    const end = points[points.length - 1];
    const beforeEnd = points[points.length - 2];
    const dx = end[0] - beforeEnd[0];
    const dy = end[1] - beforeEnd[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const headSize = 4.2;
    const wing = 3.1;
    const tipPath = [
      `M ${(end[0] - ux * headSize - uy * wing).toFixed(1)} ${(end[1] - uy * headSize + ux * wing).toFixed(1)}`,
      `L ${end[0].toFixed(1)} ${end[1].toFixed(1)}`,
      `L ${(end[0] - ux * headSize + uy * wing).toFixed(1)} ${(end[1] - uy * headSize - ux * wing).toFixed(1)}`,
    ].join(" ");
    const linePath = points.map(([px, py], idx) => `${idx === 0 ? "M" : "L"} ${px} ${py}`).join(" ");
    return {
      start: points[0],
      linePath,
      tipPath,
    };
  }

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
      const NodeCtor = this.document.defaultView?.Node || globalThis.Node;
      if (
        value &&
        (typeof value.nodeType === "number" ||
          (typeof NodeCtor !== "undefined" && value instanceof NodeCtor))
      ) {
        cell.appendChild(value);
      } else {
        cell.textContent = value == null ? "" : String(value);
      }
      return cell;
    }

    svgElement(tag, attributes = {}) {
      const node = this.document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attributes)) {
        node.setAttribute(key, String(value));
      }
      return node;
    }

    rowButton(labelKey, onClick) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.textContent = this.message(labelKey);
      button.setAttribute("aria-label", this.message(labelKey));
      button.addEventListener("click", onClick);
      return button;
    }

    // 用垃圾桶图标替代宽文本移除按钮，减少右侧操作区对轨迹与命令列的挤压。
    removeIconButton(labelKey, onClick) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "browser-toolbox-binding-remove-icon";
      const label = this.message(labelKey);
      button.setAttribute("aria-label", label);
      button.title = label;
      const svg = this.svgElement("svg", {
        viewBox: "0 0 24 24",
        width: 15,
        height: 15,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.9,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
        focusable: "false",
      });
      svg.appendChild(
        this.svgElement("path", { d: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" }),
      );
      button.appendChild(svg);
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

    // 按方案 B 渲染矢量轨迹缩略图与可点击展开编辑的完整步骤条，避免窄列单行裁切。
    createPatternVisualField(binding) {
      const thumb = this.document.createElement("div");
      thumb.className = "browser-toolbox-gesture-thumb";
      const svg = this.svgElement("svg", {
        viewBox: "0 0 44 40",
        width: 38,
        height: 34,
        fill: "none",
        "aria-hidden": "true",
        focusable: "false",
      });
      const stepCount = this.document.createElement("span");
      stepCount.className = "browser-toolbox-gesture-steps";
      thumb.append(svg, stepCount);

      const editor = this.document.createElement("div");
      editor.className = "browser-toolbox-pattern-editor";
      const readout = this.document.createElement("button");
      readout.type = "button";
      readout.className = "browser-toolbox-pattern-readout";
      const arrowBadge = this.document.createElement("span");
      arrowBadge.className = "browser-toolbox-pattern-arrows";
      const namesLabel = this.document.createElement("span");
      namesLabel.className = "browser-toolbox-pattern-names";
      readout.append(arrowBadge);

      const input = this.patternControl(binding);
      const inputWrap = this.document.createElement("span");
      inputWrap.className = "browser-toolbox-pattern-input-wrap";
      inputWrap.appendChild(input);

      const refreshVisual = () => {
        const pattern = this.quantizer.normalizePattern(input.value);
        const geometry = buildGesturePreviewGeometry(pattern);
        svg.replaceChildren();
        if (geometry) {
          svg.append(
            this.svgElement("path", {
              d: geometry.linePath,
              stroke: "currentColor",
              "stroke-width": 2.4,
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
            }),
            this.svgElement("circle", {
              cx: geometry.start[0],
              cy: geometry.start[1],
              r: 2.5,
              fill: "currentColor",
            }),
            this.svgElement("path", {
              d: geometry.tipPath,
              stroke: "currentColor",
              "stroke-width": 2.1,
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
            }),
          );
        }
        stepCount.textContent = String(pattern.length);
        const arrows = this.quantizer.formatPattern(pattern, " ");
        arrowBadge.textContent = arrows || this.message("none");
        const labels = pattern.map((direction) => this.message(DIRECTION_MESSAGE_KEYS[direction]));
        namesLabel.textContent = labels.join(" · ");
        readout.setAttribute("aria-label", input.getAttribute("aria-label") || this.message("pattern"));
      };

      readout.addEventListener("click", () => {
        input.focus();
        input.select?.();
      });
      input.addEventListener("input", refreshVisual);
      input.addEventListener("blur", refreshVisual);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          input.blur();
        }
      });
      refreshVisual();

      editor.append(readout, namesLabel, inputWrap);
      return { thumb, patternField: editor, patternInput: input };
    }

    enabledControl(binding, { compact = false } = {}) {
      const label = this.document.createElement("label");
      label.className = compact
        ? "browser-toolbox-switch browser-toolbox-binding-switch"
        : "browser-toolbox-check";
      const input = this.document.createElement("input");
      input.type = "checkbox";
      input.checked = binding.enabled !== false;
      const enabledText = this.message("enabled");
      input.setAttribute("aria-label", enabledText);
      if (compact) {
        label.title = enabledText;
        label.append(input);
      } else {
        label.append(input, this.document.createTextNode(enabledText));
      }
      return { label, input };
    }

    // 统一构建手势与超级拖拽的主从卡片行：左侧矢量缩略图，中间完整轨迹条+命令，右侧紧凑操作组。
    appendVisualBindingRow({
      body,
      binding,
      inputSource,
      contextType = null,
      extraTopNode = null,
      onRemove,
    }) {
      const row = this.document.createElement("tr");
      row.className = "browser-toolbox-binding-card-row";
      const { thumb, patternField, patternInput } = this.createPatternVisualField(binding);
      const commandNode = this.commandControl(binding, inputSource, contextType);
      const enabledNode = this.enabledControl(binding, { compact: true });
      const remove = this.removeIconButton("removeBinding", onRemove);

      const mainStack = this.document.createElement("div");
      mainStack.className = "browser-toolbox-binding-main-stack";
      const mainTop = this.document.createElement("div");
      mainTop.className = "browser-toolbox-binding-main-top";
      mainTop.appendChild(patternField);
      if (extraTopNode) mainTop.appendChild(extraTopNode);

      const commandHost = this.document.createElement("div");
      commandHost.className = "browser-toolbox-command-cell";
      commandHost.appendChild(commandNode.wrapper);
      mainStack.append(mainTop, commandHost);

      const thumbCell = Object.assign(this.cell(thumb), {
        className: "browser-toolbox-binding-thumb-cell",
      });
      const mainCell = Object.assign(this.cell(mainStack), {
        className: "browser-toolbox-binding-main-cell",
      });
      const enabledCell = Object.assign(this.cell(enabledNode.label), {
        className: "browser-toolbox-binding-enabled-cell",
      });
      const optionsCell = Object.assign(
        this.cell(this.optionsEditor(binding, this.registry.getCommand(binding.commandName))),
        { className: "browser-toolbox-options-cell" },
      );
      const removeCell = Object.assign(this.cell(remove), {
        className: "browser-toolbox-binding-remove-cell",
      });

      row.append(thumbCell, mainCell, enabledCell, optionsCell, removeCell);
      row._binding = binding;
      row._pattern = patternInput;
      row._command = commandNode.select;
      row._enabled = enabledNode.input;
      body.appendChild(row);
      return row;
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
        this.appendVisualBindingRow({
          body,
          binding,
          inputSource: "mouseGesture",
          onRemove: () => {
            this.settings.mouse.bindings = this.settings.mouse.bindings.filter((item) =>
              item !== binding
            );
            this.renderMouseBindings();
            this.onBindingsChange("mouse");
            this.markDirty();
          },
        });
      }
    }

    renderSuperDragBindings() {
      const body = this.document.querySelector("#super-drag-bindings");
      if (!body) return;
      body.replaceChildren();
      for (const binding of this.settings.superDrag.bindings) {
        const context = this.fieldSelect(binding.context, "context", [
          ["LINK", this.message("contextLink")],
          ["SELECTED_TEXT", this.message("contextSelection")],
          ["IMAGE", this.message("contextImage")],
        ]);
        context.className = "browser-toolbox-super-drag-context";
        const row = this.appendVisualBindingRow({
          body,
          binding,
          inputSource: "superDrag",
          contextType: binding.context,
          extraTopNode: context,
          onRemove: () => {
            this.settings.superDrag.bindings = this.settings.superDrag.bindings.filter((item) =>
              item !== binding
            );
            this.renderSuperDragBindings();
            this.onBindingsChange("superDrag");
            this.markDirty();
          },
        });
        row._context = context;
        context.addEventListener("change", () => {
          binding.context = context.value;
          this.renderCommandCells(row, binding, "superDrag", binding.context);
          this.markDirty();
        });
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
