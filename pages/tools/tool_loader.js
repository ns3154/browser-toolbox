// 工具加载器：工具 ID 到本地实现的映射是静态代码，禁止动态 import、eval 和远程资源。
(function () {
  const LOADERS = Object.freeze({
    "json.format": () => {
      const tool = globalThis.BrowserToolboxJsonTool;
      return {
        run({ input, options, state, confirm, confirmMessage }) {
          let working = input;
          if (options.repair && !state.repairApplied) {
            const candidate = tool.repair(input);
            if (
              candidate.changed &&
              confirm?.(`${confirmMessage}\n\n${candidate.previewBefore}\n→\n${candidate.previewAfter}`)
            ) {
              working = candidate.value;
              state.repairApplied = true;
              state.workingInput = working;
            }
          }
          if (state.repairApplied) working = state.workingInput;
          return tool.run(working, {
            operation: options.operation,
            indent: options.indent === "tab" ? "\t" : undefined,
            indentSize: options.indent === "tab" ? 2 : Number(options.indent),
            sortOrder: options.sortOrder,
            compact: options.compact,
            expandEscaped: options.expandEscaped,
          });
        },
      };
    },
    "text.diff": () => ({
      run: ({ input, rightInput }) => globalThis.BrowserToolboxDiffTool.run(input, rightInput),
    }),
    "codec.transform": () => ({
      run: ({ input, options }) => globalThis.BrowserToolboxCodecTool.run(input, options),
    }),
    "time.convert": () => ({
      run: ({ input, options }) => globalThis.BrowserToolboxTimeTool.run(input, options),
    }),
    "id.generate": () => ({
      run: ({ options }) => globalThis.BrowserToolboxGeneratorTools.generateId({
        mode: options.mode,
        count: Number(options.count),
      }),
    }),
    "password.generate": () => ({
      run: ({ options }) => globalThis.BrowserToolboxGeneratorTools.generatePassword({
        length: Number(options.length),
        symbols: options.symbols,
      }),
    }),
    "table.convert": () => ({
      run: ({ input, options }) => globalThis.BrowserToolboxTableTool.run(input, options),
    }),
  });

  const loaderIds = Object.keys(LOADERS).sort();
  const registryIds = globalThis.BrowserToolboxToolRegistry.TOOL_IDS.slice().sort();
  if (loaderIds.length !== registryIds.length || loaderIds.some((id, index) => id !== registryIds[index])) {
    throw new Error("工具注册表与静态加载器不一致。");
  }

  function load(toolId) {
    const descriptor = globalThis.BrowserToolboxToolRegistry.get(toolId);
    const loader = descriptor && LOADERS[descriptor.entry];
    const implementation = loader?.();
    if (!implementation) throw new Error("工具实现不存在。");
    return implementation;
  }

  globalThis.BrowserToolboxToolLoader = Object.freeze({ LOADERS, load });
})();
