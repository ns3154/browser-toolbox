// OpenKeyMouse 配置逐级迁移。每一步只增加或转换已知结构，不静默删除未知字段。
(function () {
  const schema = globalThis.OpenKeyMouseSettingsSchema;

  function migrate0To1(input) {
    const next = schema.mergeSettings(input);
    next.schemaVersion = 1;
    if (input?.gestureBindings && !input.mouse?.bindings) {
      next.mouse.bindings = input.gestureBindings;
    }
    delete next.gestureBindings;
    return next;
  }

  function migrate1To2(input) {
    const next = schema.mergeSettings(input);
    next.schemaVersion = 2;
    next.general ||= {};
    next.general.language ||= "auto";
    next.superDrag ||= schema.clone(schema.DEFAULT_SETTINGS.superDrag);
    next.wheel ||= schema.clone(schema.DEFAULT_SETTINGS.wheel);
    next.rocker ||= schema.clone(schema.DEFAULT_SETTINGS.rocker);
    return next;
  }

  function migrate2To3(input) {
    const next = schema.mergeSettings(input);
    next.schemaVersion = 3;
    next.privacy = { telemetry: false, remoteConfig: false, backgroundNetwork: false };
    next.cursor ||= schema.clone(schema.DEFAULT_SETTINGS.cursor);
    return next;
  }

  function migrate(input) {
    let current = schema.clone(input || {});
    let version = Number.isInteger(current.schemaVersion) ? current.schemaVersion : 0;
    while (version < schema.CURRENT_SCHEMA_VERSION) {
      if (version === 0) current = migrate0To1(current);
      else if (version === 1) current = migrate1To2(current);
      else if (version === 2) current = migrate2To3(current);
      else throw new Error(`Unsupported settings schema: ${version}`);
      version = current.schemaVersion;
    }
    return schema.mergeSettings(current);
  }

  globalThis.OpenKeyMouseSettingsMigrations = Object.freeze({
    migrate0To1,
    migrate1To2,
    migrate2To3,
    migrate,
  });
})();
