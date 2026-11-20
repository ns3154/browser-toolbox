// SPDX-License-Identifier: GPL-3.0-or-later
import {
  action,
  checkedInput,
  copyRow,
  mountPanes,
  node,
  panel,
  resultActions,
  segments,
  t,
} from "./workbench_view.js";

const idKinds = {
  uuid: { label: "UUID v4", detail: "toolIdUuidDetail", bits: 122 },
  ulid: { label: "ULID", detail: "toolIdUlidDetail", bits: 80 },
  snowflake: { label: "Snowflake", detail: "toolIdSnowflakeDetail", bits: 22 },
  nanoid: { label: "NanoID", detail: "toolIdNanoidDetail", bits: 126 },
};

function generatorPanes(ctx, { actionKey, copyKey, refresh }) {
  ctx.board.classList.add("generator-board");
  const parameters = panel(t("toolGenerateParameters"), { id: "generator-parameters" });
  const fields = node("div", "generator-fields");
  parameters.element.append(fields);
  const regenerate = action(actionKey, { id: "tool-regenerate", glyph: "restore", run: refresh });
  const outputActions = resultActions(ctx, { copyKey, regenerate });
  const result = panel(t("toolGenerateResult"), {
    id: "tool-result-workspace",
    result: true,
    actions: outputActions.buttons,
  });
  mountPanes(ctx, parameters, result);
  return { fields, result, outputActions };
}

function fieldset(key, content) {
  const field = node("fieldset", "workbench-field");
  field.append(node("legend", "workbench-field-label", t(key)), content);
  return field;
}

export function mountId(ctx) {
  const [kindOption, countOption] = ctx.descriptor.controls;
  const { fields, result, outputActions } = generatorPanes(ctx, {
    actionKey: "toolIdRegenerate",
    copyKey: "toolCopyAll",
    refresh,
  });
  const kindList = node("div", "generator-id-kinds");
  const makeIds = node("ol", "generator-id-results");
  makeIds.id = "id-values";
  for (const [id] of kindOption.options) {
    const option = node("label", "generator-id-kind");
    const radio = node("input");
    radio.type = "radio";
    radio.name = "id-kind";
    radio.value = id;
    radio.checked = id === kindOption.defaultValue;
    radio.addEventListener("change", refresh);
    const text = node("span");
    text.append(node("strong", "", idKinds[id].label), node("small", "", t(idKinds[id].detail)));
    option.append(radio, text);
    kindList.append(option);
  }
  const count = segments(
    "id-count",
    t("toolIdCount"),
    countOption.options.map(([id, label]) => [id, t(label)]),
    countOption.defaultValue,
    refresh,
  );
  fields.append(fieldset("toolIdType", kindList), fieldset("toolIdCount", count.element));
  result.element.append(makeIds);

  function refresh() {
    const mode = kindList.querySelector("input:checked").value;
    const { output, metadata } = ctx.implementation.run({ options: { mode, count: count.value } });
    const values = output.split("\n");
    const kind = idKinds[mode];
    result.detail.textContent = `${kind.label} · ${
      t("toolIdResultCount", { count: metadata.count })
    }`;
    makeIds.replaceChildren(...values.map((value, index) => {
      const item = node("li");
      const row = copyRow(ctx, "toolCopyRow", "generator-id-row");
      const number = node("span", "generator-index", String(index + 1));
      number.setAttribute("aria-hidden", "true");
      row.set(value, number, node("code", "", value));
      item.append(row.element);
      return item;
    }));
    outputActions.set(output);
    ctx.status(`${t("toolIdCopyHint")} · Web Crypto CSPRNG`);
    ctx.stats(t("toolIdStats", { length: values[0].length, bits: kind.bits }));
  }
  return { refresh };
}

function coloredPassword(value) {
  const code = node("code", "password-text");
  const parts = value.match(/[A-Za-z]+|[0-9]+|[^A-Za-z0-9]+/g) ?? [];
  for (const part of parts) {
    const kind = /^[A-Za-z]/.test(part) ? "letter" : /^\d/.test(part) ? "digit" : "symbol";
    code.append(node("span", `password-${kind}`, part));
  }
  return code;
}

export function mountPassword(ctx) {
  const [lengthOption, symbolOption] = ctx.descriptor.controls;
  const { fields, result, outputActions } = generatorPanes(ctx, {
    actionKey: "toolPasswordRegenerate",
    copyKey: "toolCodecCopyShort",
    refresh,
  });
  const length = segments(
    "password-length",
    t("toolPasswordLength"),
    lengthOption.options.map(([id, label]) => [id, t(label)]),
    lengthOption.defaultValue,
    refresh,
  );
  const symbols = checkedInput(symbolOption.defaultValue, refresh);
  symbols.id = "password-symbols";
  const symbolsLabel = node("label", "generator-checkbox");
  symbolsLabel.append(symbols, node("span", "", t("toolPasswordSymbols")));
  const symbolSet = node(
    "code",
    "password-symbol-set",
    globalThis.BrowserToolboxGeneratorTools.PASSWORD_SYMBOLS,
  );
  const composition = node("div", "password-composition");
  composition.append(symbolsLabel, symbolSet);
  fields.append(
    fieldset("toolPasswordLength", length.element),
    fieldset("toolPasswordComposition", composition),
    node("p", "password-exclusions", t("toolPasswordExclusions")),
  );

  const main = node("div", "password-main");
  const mainValue = node("div", "password-main-value");
  const meter = node("div", "password-meter");
  const bars = node("span", "password-strength");
  bars.setAttribute("aria-hidden", "true");
  bars.replaceChildren(...Array.from({ length: 4 }, () => node("span")));
  const entropy = node("span", "password-entropy");
  entropy.id = "password-entropy";
  meter.append(bars, entropy);
  main.append(mainValue, meter);
  const alternativesHeading = node("div", "password-alternatives-heading");
  alternativesHeading.append(
    node("h3", "", t("toolPasswordAlternatives")),
    node("span", "", t("toolPasswordCopyHint")),
  );
  const alternatives = node("ul", "password-alternatives");
  alternatives.id = "password-alternatives";
  result.element.append(main, alternativesHeading, alternatives);

  function refresh() {
    const options = { length: length.value, symbols: symbols.checked };
    const { output, metadata } = ctx.implementation.run({ options });
    const entropyBits = Math.round(metadata.length * Math.log2(metadata.charsetSize));
    const level = entropyBits >= 90 ? 4 : entropyBits >= 70 ? 3 : entropyBits >= 50 ? 2 : 1;
    [...bars.children].forEach((bar, index) => bar.classList.toggle("filled", index < level));
    entropy.textContent = t("toolPasswordEntropy", {
      strength: t(`toolPasswordStrength${level}`),
      bits: entropyBits,
      size: metadata.charsetSize,
    });
    entropy.dataset.bits = String(entropyBits);
    entropy.dataset.charsetSize = String(metadata.charsetSize);
    symbolSet.classList.toggle("is-disabled", !symbols.checked);
    mainValue.dataset.length = length.value;
    mainValue.replaceChildren(coloredPassword(output));
    result.detail.textContent = t("toolPasswordResultLength", { count: metadata.length });
    alternatives.replaceChildren(...Array.from({ length: 3 }, () => {
      const value = ctx.implementation.run({ options }).output;
      const alternative = copyRow(ctx, "toolCodecCopyShort", "password-alternative");
      alternative.set(value, coloredPassword(value));
      const item = node("li");
      item.append(alternative.element);
      return item;
    }));
    outputActions.set(output);
    ctx.status(t("toolPasswordMemoryOnly"));
    ctx.stats("Web Crypto CSPRNG");
  }
  return { refresh };
}
