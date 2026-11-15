// SPDX-License-Identifier: GPL-3.0-or-later
// 默认包编译为兼容方案；只有隔离构建器能启用成套 Canary，选择只保存到本机。
(function () {
  const COMPILED_CANARY = false;
  const COMPILED_FIND_CANARY = false;
  const COMPILED_VISUAL_CANARY = false;
  const COMPILED_HINTS_CANARY = false;
  const COMPILED_VOMNIBAR_CANARY = false;
  const COMPILED_MARKS_CANARY = false;
  const COMPILED_UI_CANARY = false;
  const COMPILED_PAGES_CANARY = false;
  const KEY = "browserToolboxRuntimePlan";
  const COMPAT_PLAN = Object.freeze({
    planVersion: 1,
    keyboardEngine: "vimium-compat",
    moduleImplementations: Object.freeze({
      input: "vimium-compat",
      hints: "vimium-compat",
      find: "vimium-compat",
      visual: "vimium-compat",
      ui: "vimium-compat",
    }),
  });
  const INPUT_CANARY_PLAN = Object.freeze({
    planVersion: 2,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      input: "browser-toolbox",
      scroll: "browser-toolbox",
      hints: "vimium-compat",
      find: "vimium-compat",
      visual: "vimium-compat",
      ui: "vimium-compat",
    }),
  });
  const FIND_CANARY_PLAN = Object.freeze({
    planVersion: 3,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      input: "browser-toolbox",
      scroll: "browser-toolbox",
      find: "browser-toolbox",
      hints: "vimium-compat",
      visual: "vimium-compat",
      ui: "vimium-compat",
    }),
  });
  const VISUAL_CANARY_PLAN = Object.freeze({
    planVersion: 4,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      input: "browser-toolbox",
      scroll: "browser-toolbox",
      find: "browser-toolbox",
      visual: "browser-toolbox",
      hints: "vimium-compat",
      ui: "vimium-compat",
    }),
  });
  const HINTS_CANARY_PLAN = Object.freeze({
    planVersion: 5,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      input: "browser-toolbox",
      scroll: "browser-toolbox",
      find: "browser-toolbox",
      visual: "browser-toolbox",
      hints: "browser-toolbox",
      ui: "vimium-compat",
    }),
  });
  const VOMNIBAR_CANARY_PLAN = Object.freeze({
    planVersion: 6,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      input: "browser-toolbox", scroll: "browser-toolbox", find: "browser-toolbox",
      visual: "browser-toolbox", hints: "browser-toolbox", vomnibar: "browser-toolbox",
      completers: "browser-toolbox", ui: "vimium-compat",
    }),
  });
  const MARKS_CANARY_PLAN = Object.freeze({
    planVersion: 7,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      ...VOMNIBAR_CANARY_PLAN.moduleImplementations,
      marks: "browser-toolbox",
    }),
  });
  const UI_CANARY_PLAN = Object.freeze({
    planVersion: 8,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      ...MARKS_CANARY_PLAN.moduleImplementations,
      ui: "browser-toolbox",
      frameFocus: "browser-toolbox",
    }),
  });
  const PAGES_CANARY_PLAN = Object.freeze({
    planVersion: 9,
    keyboardEngine: "browser-toolbox",
    moduleImplementations: Object.freeze({
      ...UI_CANARY_PLAN.moduleImplementations,
      help: "browser-toolbox",
      settingsPages: "browser-toolbox",
      newTab: "browser-toolbox",
    }),
  });
  const existing = (
    COMPILED_CANARY
      ? COMPILED_FIND_CANARY
        ? COMPILED_VISUAL_CANARY
          ? COMPILED_HINTS_CANARY
            ? [
              COMPAT_PLAN,
              INPUT_CANARY_PLAN,
              FIND_CANARY_PLAN,
              VISUAL_CANARY_PLAN,
              HINTS_CANARY_PLAN,
            ]
            : [COMPAT_PLAN, INPUT_CANARY_PLAN, FIND_CANARY_PLAN, VISUAL_CANARY_PLAN]
          : [COMPAT_PLAN, INPUT_CANARY_PLAN, FIND_CANARY_PLAN]
        : [COMPAT_PLAN, INPUT_CANARY_PLAN]
      : [COMPAT_PLAN]
  );
  const withVomnibar = COMPILED_CANARY && COMPILED_FIND_CANARY && COMPILED_VISUAL_CANARY &&
    COMPILED_HINTS_CANARY && COMPILED_VOMNIBAR_CANARY ? [...existing, VOMNIBAR_CANARY_PLAN] : existing;
  const withMarks = COMPILED_MARKS_CANARY && withVomnibar.includes(VOMNIBAR_CANARY_PLAN)
    ? [...withVomnibar, MARKS_CANARY_PLAN] : withVomnibar;
  const withUi = COMPILED_UI_CANARY && withMarks.includes(MARKS_CANARY_PLAN)
    ? [...withMarks, UI_CANARY_PLAN] : withMarks;
  const allowed = Object.freeze(COMPILED_PAGES_CANARY && withUi.includes(UI_CANARY_PLAN)
    ? [...withUi, PAGES_CANARY_PLAN] : withUi);
  function canonical(plan) {
    return allowed.find((item) =>
      item.planVersion === plan?.planVersion &&
      item.keyboardEngine === plan.keyboardEngine &&
      JSON.stringify(item.moduleImplementations) === JSON.stringify(plan.moduleImplementations)
    );
  }
  const planCaches = new WeakMap();
  function cacheState(api) {
    if (!api?.storage?.local?.get || !api?.storage?.onChanged?.addListener) return null;
    let state = planCaches.get(api);
    if (!state) {
      state = { generation: 0, plan: undefined };
      api.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes?.[KEY]) {
          state.generation++;
          state.plan = undefined;
        }
      });
      planCaches.set(api, state);
    }
    return state;
  }
  async function select(api) {
    if (!COMPILED_CANARY) return COMPAT_PLAN;
    const state = cacheState(api);
    if (state?.plan) return state.plan;
    const generation = state?.generation;
    const value = (await api.storage.local.get(KEY))[KEY];
    let selected;
    if (value == null) {
      if (allowed.includes(PAGES_CANARY_PLAN)) selected = PAGES_CANARY_PLAN;
      else if (COMPILED_UI_CANARY && allowed.includes(UI_CANARY_PLAN)) selected = UI_CANARY_PLAN;
      else if (COMPILED_MARKS_CANARY && allowed.includes(MARKS_CANARY_PLAN)) {
        selected = MARKS_CANARY_PLAN;
      } else {
        selected = COMPILED_VOMNIBAR_CANARY && allowed.includes(VOMNIBAR_CANARY_PLAN)
          ? VOMNIBAR_CANARY_PLAN
          : COMPILED_HINTS_CANARY
          ? HINTS_CANARY_PLAN
          : COMPILED_VISUAL_CANARY
          ? VISUAL_CANARY_PLAN
          : COMPILED_FIND_CANARY
          ? FIND_CANARY_PLAN
          : INPUT_CANARY_PLAN;
      }
    } else {
      if (
        value.formatVersion !== 1 || !allowed.some((plan) => plan.planVersion === value.planVersion)
      ) {
        throw new Error("UNVERIFIED_RUNTIME_PLAN");
      }
      selected = allowed.find((plan) => plan.planVersion === value.planVersion);
    }
    if (state && state.generation === generation) state.plan = selected;
    return selected;
  }
  async function restore(api) {
    if (COMPILED_CANARY) {
      const state = cacheState(api);
      if (state) {
        state.generation++;
        state.plan = undefined;
      }
      await api.storage.local.set({ [KEY]: { formatVersion: 1, planVersion: 1 } });
    }
  }
  globalThis.BrowserToolboxRuntimePlans = Object.freeze({
    COMPILED_CANARY,
    COMPILED_FIND_CANARY,
    COMPILED_VISUAL_CANARY,
    COMPILED_HINTS_CANARY,
    COMPILED_VOMNIBAR_CANARY,
    COMPILED_MARKS_CANARY,
    COMPILED_UI_CANARY,
    COMPILED_PAGES_CANARY,
    KEY,
    COMPAT_PLAN,
    INPUT_CANARY_PLAN,
    FIND_CANARY_PLAN,
    VISUAL_CANARY_PLAN,
    HINTS_CANARY_PLAN,
    VOMNIBAR_CANARY_PLAN,
    MARKS_CANARY_PLAN,
    UI_CANARY_PLAN,
    PAGES_CANARY_PLAN,
    allowed,
    canonical,
    select,
    restore,
  });
})();
