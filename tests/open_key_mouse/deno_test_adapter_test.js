import * as shoulda from "../vendor/shoulda.js";

const testDirectory = new URL("../unit_tests/open_key_mouse/", import.meta.url);
const testFiles = [];
for await (const entry of Deno.readDir(testDirectory)) {
  if (entry.isFile && entry.name.endsWith("_test.js")) {
    testFiles.push(entry.name);
  }
}

for (const fileName of testFiles.sort()) {
  await import(new URL(fileName, testDirectory).href);
}

Deno.test("OpenKeyMouse shoulda 单元测试适配入口", async () => {
  const passed = await shoulda.run();
  if (!passed) {
    const stats = shoulda.getStats();
    throw new Error(`OpenKeyMouse 单元测试失败：${stats.failed}/${stats.run}`);
  }
});
