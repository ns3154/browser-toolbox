import { ExclusionRulesEditor } from "./exclusion_rules_editor.js";
import { KeyMappingsParser } from "../background_scripts/commands.js";
import * as userSearchEngines from "../background_scripts/user_search_engines.js";

const options = {
  filterLinkHints: "boolean",
  grabBackFocus: "boolean",
  hideHud: "boolean",
  ignoreKeyboardLayout: "boolean",
  keyMappings: "string",
  linkHintCharacters: "string",
  linkHintNumbers: "string",
  newTabCustomUrl: "string",
  newTabDestination: "option",
  nextPatterns: "string",
  openVomnibarOnNewTabPage: "boolean",
  previousPatterns: "string",
  regexFindMode: "boolean",
  scrollStepSize: "number",
  searchEngines: "string",
  settingsVersion: "string", // 隐藏字段用于保留备份版本。
  smoothScroll: "boolean",
  userDefinedLinkHintCss: "string",
  waitForEnterForFilteredHints: "boolean",
};

export function getOptionEl(optionName) {
  return document.querySelector(`*[name="${optionName}"]`);
}

// Invoked when the user clicks the "reset" button next to an option's text field.
function resetInputValue(event) {
  const parentDiv = event.target.parentNode.parentNode;
  console.assert(parentDiv?.tagName == "DIV", "Expected parent to be a div", event.target);
  const input = parentDiv.querySelector("input") || parentDiv.querySelector("textarea");
  const optionName = input.name;
  const defaultValue = Settings.defaultOptions[optionName];
  input.value = defaultValue;
  event.preventDefault();
}

function setFormFromSettings(settings) {
  for (const [optionName, optionType] of Object.entries(options)) {
    const el = getOptionEl(optionName);
    const value = settings[optionName];
    switch (optionType) {
      case "boolean":
        el.checked = value;
        break;
      case "number":
        el.value = value;
        break;
      case "string":
        el.value = value;
        break;
      case "option":
        const optionEl = document.querySelector(`input[name="${optionName}"][value="${value}"]`);
        optionEl.checked = true;
        break;
      default:
        throw new Error(`Unrecognized option type ${optionType}`);
    }
  }

  ExclusionRulesEditor.setForm(settings["exclusionRules"]);

  document.querySelector("#upload-backup").value = "";
  maintainLinkHintsView();
  maintainNewTabUrlView();
}

function getSettingsFromForm() {
  const settings = {};
  for (const [optionName, optionType] of Object.entries(options)) {
    const el = getOptionEl(optionName);
    let value;
    switch (optionType) {
      case "boolean":
        value = el.checked;
        break;
      case "number":
        value = parseFloat(el.value);
        break;
      case "string":
        value = el.value.trim();
        break;
      case "option":
        const optionEl = document.querySelector(`input[name="${optionName}"]:checked`);
        value = optionEl.value;
        break;
      default:
        throw new Error(`Unrecognized option type ${optionType}`);
    }
    if (value !== null) {
      settings[optionName] = value;
    }
  }
  if (settings["linkHintCharacters"] != null) {
    settings["linkHintCharacters"] = settings["linkHintCharacters"].toLowerCase();
  }
  settings["exclusionRules"] = ExclusionRulesEditor.getRules();
  return settings;
}

function getValidationErrors() {
  const results = {};
  let text, parsed;

  // keyMappings field.
  text = getOptionEl("keyMappings").value.trim();
  parsed = KeyMappingsParser.parse(text);
  if (parsed.validationErrors.length > 0) {
    results["keyMappings"] = parsed.validationErrors.join("\n");
  }

  // searchEngines field.
  text = getOptionEl("searchEngines").value.trim();
  parsed = userSearchEngines.parseConfig(text);
  if (parsed.validationErrors.length > 0) {
    results["searchEngines"] = parsed.validationErrors.join("\n");
  }

  // linkHintCharacters field.
  text = getOptionEl("linkHintCharacters").value.trim();
  if (text != removeDuplicateChars(text)) {
    results["linkHintCharacters"] = "This cannot contain duplicate characters.";
  } else if (text.length <= 1) {
    results["linkHintCharacters"] = "This must be at least two characters long.";
  }

  // linkHintNumbers field.
  text = getOptionEl("linkHintNumbers").value.trim();
  if (text != removeDuplicateChars(text)) {
    results["linkHintNumbers"] = "This cannot contain duplicate characters.";
  } else if (text.length <= 1) {
    results["linkHintNumbers"] = "This must be at least two characters long.";
  }

  return results;
}

function addValidationMessage(el, message) {
  el.classList.add("validation-error");
  const exampleEl = el.nextElementSibling;
  const messageEl = document.createElement("div");
  messageEl.classList.add("validation-message");
  messageEl.textContent = message;
  exampleEl.after(messageEl);
}

// 只有主动保存时才定位错误，避免输入或失焦校验打断用户操作。
function showValidationErrors({ reveal = false } = {}) {
  // Remove all previous validation errors.
  let els = document.querySelectorAll(".validation-error");
  for (const el of els) {
    el.classList.remove("validation-error");
  }
  els = document.querySelectorAll(".validation-message");
  for (const el of els) {
    el.remove();
  }

  const errors = getValidationErrors();
  for (const [optionName, message] of Object.entries(errors)) {
    const el = getOptionEl(optionName);
    addValidationMessage(el, message);
  }
  // Some options can be hidden in the UI. If they have validation errors, force them to be shown.
  if (errors["linkHintCharacters"]) {
    showElement(document.querySelector("#link-hint-characters-container"), true);
  }
  if (errors["linkHintNumbers"]) {
    showElement(document.querySelector("#link-hint-numbers-container"), true);
  }
  const hasErrors = Object.keys(errors).length > 0;
  if (hasErrors && reveal) {
    const firstError = document.querySelector(".validation-error");
    firstError.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
    firstError.focus({ preventScroll: true });
  }
  return hasErrors;
}

function removeDuplicateChars(str) {
  const seen = new Set();
  let result = "";
  for (let char of str) {
    if (!seen.has(char)) {
      result += char;
      seen.add(char);
    }
  }
  return result;
}

function showElement(el, visible) {
  el.style.display = visible ? null : "none";
}

// Hide or show extra form elements depending on which radio button is selected for
// newTabDestination.
function maintainNewTabUrlView() {
  const destination = document.querySelector("[name=newTabDestination]:checked").value;
  showElement(
    document.querySelector("#openVomnibarContainer"),
    destination == Settings.newTabDestinations.vimiumNewTabPage,
  );
  showElement(
    document.querySelector("[name=newTabCustomUrl]"),
    destination == Settings.newTabDestinations.customUrl,
  );
}

// Display the UI for link hint numbers vs. characters, depending upon the value of
// "filterLinkHints".
function maintainLinkHintsView() {
  const errors = getValidationErrors();
  const isFilteredLinkhints = getOptionEl("filterLinkHints").checked;
  showElement(
    document.querySelector("#link-hint-characters-container"),
    !isFilteredLinkhints || errors["linkHintCharacters"],
  );
  showElement(
    document.querySelector("#link-hint-numbers-container"),
    isFilteredLinkhints || errors["linkHintNumbers"],
  );
  showElement(
    document.querySelector("#wait-for-enter"),
    isFilteredLinkhints,
  );
}

export function bindOptionsForm(onUpdated) {
  for (const el of document.querySelectorAll("input, textarea")) {
    // 文件选择不是表单设置的编辑，不能将导入操作本身计为未保存草稿。
    if (el.type === "file") continue;
    // We want to immediately enable the save button when a setting is changed, so we want to use
    // the HTML element's "input" event here rather than the "change" event.
    el.addEventListener("input", () => onUpdated());
    el.addEventListener("blur", () => {
      showValidationErrors();
    });
  }

  getOptionEl("filterLinkHints").addEventListener(
    "click",
    () => maintainLinkHintsView(),
  );

  for (const el of document.querySelectorAll(".reset-link a")) {
    el.addEventListener("click", (event) => {
      resetInputValue(event);
      showValidationErrors();
      onUpdated();
    });
  }

  ExclusionRulesEditor.init();
  ExclusionRulesEditor.addEventListener("input", onUpdated);
}

export { getSettingsFromForm, maintainNewTabUrlView, setFormFromSettings, showValidationErrors };
