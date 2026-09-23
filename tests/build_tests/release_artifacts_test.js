import * as path from "@std/path";
import {
  buildArtifacts,
  commandOutput,
  isRuntimeFile,
  isSourceFile,
} from "../../scripts/release_artifacts.js";

function assert(value, message) {
  if (!value) throw new Error(message);
}

Deno.test("运行时和源码归档排除本机资料、凭据与开发脚本", () => {
  for (
    const file of [
      "local-development/tracking/report.md",
      "lib/local-development/data.json",
      "dist/archive.zip",
      ".git/config",
      ".env",
      ".env.local",
      "secret.pem",
      "node_modules/pkg/index.js",
    ]
  ) {
    assert(!isSourceFile(file) && !isRuntimeFile(file), `敏感或本机文件未被排除：${file}`);
  }
  for (
    const file of [
      "build_scripts/build.js",
      "pages/reload.html",
      "background_scripts/reload.js",
      "scripts/verify.js",
      "tests/test.js",
    ]
  ) {
    assert(isSourceFile(file) && !isRuntimeFile(file), `开发文件误入运行时包：${file}`);
  }
  for (
    const file of [
      "manifest.json",
      "LICENSE",
      "LICENSES/MIT-Vimium.txt",
      "vendor/yaml.js",
      "pages/tools/index.html",
    ]
  ) {
    assert(isRuntimeFile(file), `运行时文件被误排除：${file}`);
  }
});

Deno.test("四种发布归档规范化 manifest、保留源码并能重复生成相同哈希", async () => {
  const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-build-test-" });
  const root = path.join(temporary, "source");
  try {
    const files = {
      "manifest.json":
        '{\n// 源码允许注释，商店包必须是标准 JSON\n"manifest_version":3,"version":"0.1.2","name":"__MSG_extensionName__","permissions":["storage","favicon"],"background":{"service_worker":"background_scripts/main.js","type":"module"},"action":{"default_icon":"icons/icon.svg"}}',
      "LICENSE": "GPL-3.0-or-later",
      "LICENSES/MIT-Vimium.txt": "MIT",
      "LICENSES/MIT-shoulda.txt": "MIT",
      "LICENSES/ISC-yaml.txt": "ISC",
      "background_scripts/main.js": "// 测试入口\n",
      "icons/icon.svg": "<svg/>",
      "icons/action_disabled.svg": "<svg/>",
      "icons/icon16.png": "测试图标",
      "pages/reload.html": "开发页",
      "background_scripts/reload.js": "// 开发脚本\n",
      "build_scripts/build.js": "// 构建脚本\n",
      "README.md": "源码说明",
      "local-development/secret-note.md": "禁止归档",
      "node_modules/cache/data.txt": "禁止归档",
    };
    for (const [file, content] of Object.entries(files)) {
      await Deno.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await Deno.writeTextFile(path.join(root, file), content);
    }
    await commandOutput("git", ["init", "-q"], { cwd: root });
    await commandOutput("git", ["add", "."], { cwd: root });
    await commandOutput("git", [
      "-c",
      "user.name=构建测试",
      "-c",
      "user.email=build@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "构建测试输入",
    ], { cwd: root });
    const firstOutput = path.join(temporary, "first");
    const first = await buildArtifacts({ root, output: firstOutput });
    const second = await buildArtifacts({ root, output: path.join(temporary, "second") });
    assert(first.artifacts.length === 4, "应生成商店、开发、Firefox、源码四种产物");
    assert(
      JSON.stringify(first.artifacts) === JSON.stringify(second.artifacts),
      "相同工作区重复构建的哈希不一致",
    );
    for (const artifact of first.artifacts) {
      const zip = path.join(firstOutput, artifact.file);
      const entries = (await commandOutput("unzip", ["-Z1", zip])).split("\n");
      assert(
        !entries.some((file) => /local-development|node_modules/.test(file)),
        "本机目录进入产物",
      );
      const manifestText = await commandOutput("unzip", ["-p", zip, "manifest.json"]);
      if (artifact.kind === "source") {
        assert(
          manifestText === files["manifest.json"] && entries.includes("README.md"),
          "源码归档应保留原始源码",
        );
      } else {
        const manifest = JSON.parse(manifestText);
        assert(manifest.version === "0.1.2", "运行时版本不一致");
        assert(
          !entries.some((file) => file.includes("reload.") || file.startsWith("build_scripts/")),
          "开发脚本误入运行时产物",
        );
        if (artifact.kind === "chrome-canary") {
          assert(manifest.name === "Browser Toolbox Canary", "开发包名称错误");
        }
        if (artifact.kind === "firefox") {
          assert(
            !manifest.background.service_worker && manifest.background.scripts.length === 1,
            "Firefox manifest 未转换",
          );
        }
      }
    }
    const installedManifest = JSON.parse(
      await Deno.readTextFile(path.join(firstOutput, "browser-toolbox/manifest.json")),
    );
    assert(installedManifest.name === "__MSG_extensionName__", "可加载目录应保留正式 manifest");
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
});
