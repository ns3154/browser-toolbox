// 发布入口共用的产物构建器；构建只读取工作区，所有临时变换发生在独立目录。
import * as path from "@std/path";
import JSON5 from "npm:json5";
import { synchronizeCatalogs } from "./sync_i18n.js";

const runtimeDirectories = new Set([
  "_locales",
  "background_scripts",
  "content_scripts",
  "icons",
  "lib",
  "pages",
  "vendor",
  "resources",
  "LICENSES",
]);
const runtimeRootFiles = new Set(["manifest.json", "LICENSE"]);
const forbiddenDirectories = new Set([".git", "dist", "node_modules", "local-development"]);
const secretFilePattern = /(?:^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$)/i;

export function isRuntimeFile(file) {
  const parts = file.split("/");
  if (parts.some((part) => part.startsWith(".") || forbiddenDirectories.has(part))) return false;
  if (secretFilePattern.test(parts.at(-1))) return false;
  if (["reload.html", "reload.js"].includes(parts.at(-1))) return false;
  if (file.endsWith(".md")) return false;
  return runtimeRootFiles.has(file) || (parts.length > 1 && runtimeDirectories.has(parts[0]));
}

export function isSourceFile(file) {
  const parts = file.split("/");
  return !parts.some((part) => forbiddenDirectories.has(part) || part === ".DS_Store") &&
    !secretFilePattern.test(parts.at(-1));
}

export async function commandOutput(command, args, options = {}) {
  const result = await new Deno.Command(command, { args, ...options }).output();
  if (!result.success) {
    throw new Error(`${command} 退出码 ${result.code}：${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout);
}

export async function readManifest(root) {
  return JSON5.parse(await Deno.readTextFile(path.join(root, "manifest.json")));
}

export function createFirefoxManifest(source) {
  const manifest = structuredClone(source);
  manifest.permissions = manifest.permissions.filter((permission) => permission !== "favicon")
    .concat(["clipboardRead", "clipboardWrite"]);
  delete manifest.background.service_worker;
  manifest.background.scripts = ["background_scripts/main.js"];
  manifest.action.default_area = "navbar";
  manifest.browser_specific_settings = {
    gecko: {
      // 保留既有 Firefox 兼容标识；产物生成不代表已经取得 Firefox 发布验收。
      id: "{d7742d87-e61d-4b78-b8a1-b469842139fa}",
      strict_min_version: "112.0",
      data_collection_permissions: { required: ["none"] },
    },
  };
  manifest.icons = Object.fromEntries(
    [16, 32, 48, 64, 96, 128].map((size) => [size, "icons/icon.svg"]),
  );
  manifest.action.default_icon = "icons/action_disabled.svg";
  return manifest;
}

async function sourceFiles(root) {
  // 使用当前工作区内容；Git 的忽略规则保证本机资料和缓存不进入源码归档。
  const files =
    (await commandOutput("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
    })).split("\0").filter(Boolean);
  const present = [];
  for (const file of new Set(files)) {
    if (!isSourceFile(file)) continue;
    if (/[\r\n]/.test(file)) throw new Error(`文件名不能包含换行符：${JSON.stringify(file)}`);
    try {
      const stat = await Deno.lstat(path.join(root, file));
      if (stat.isSymlink) throw new Error(`发布输入不允许符号链接：${file}`);
      if (stat.isFile) present.push(file);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return present.sort();
}

export async function checkReleaseInputs(root = Deno.cwd()) {
  const manifest = await readManifest(root);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("版本号格式错误");
  if (manifest.name !== "__MSG_extensionName__") {
    throw new Error("manifest.name 未使用国际化消息键");
  }
  if (manifest.permissions.includes("notifications")) {
    throw new Error("不应恢复 notifications 权限");
  }
  if (manifest.permissions.includes("downloads")) throw new Error("downloads 权限需要单独 ADR");
  if (!(await Deno.readTextFile(path.join(root, "lib/utils.js"))).includes("debug: false")) {
    throw new Error("发布前必须关闭 lib/utils.js 的调试日志");
  }
  // 本地化生成器使用自身所在仓库；常规发布入口均指向该仓库。
  await synchronizeCatalogs({ check: true });
  const files =
    (await commandOutput("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root,
    })).split("\0").filter(Boolean);
  for (const file of files) {
    if (file.split("/").some((part) => forbiddenDirectories.has(part))) continue;
    if (secretFilePattern.test(path.basename(file))) {
      throw new Error(`发布输入包含疑似凭据文件：${file}`);
    }
  }
  return manifest;
}

async function copyFiles(root, destination, files, timestamp) {
  for (const file of files) {
    const target = path.join(destination, file);
    await Deno.mkdir(path.dirname(target), { recursive: true });
    await Deno.copyFile(path.join(root, file), target);
    const stat = await Deno.stat(path.join(root, file));
    if (stat.mode !== null) await Deno.chmod(target, stat.mode & 0o111 ? 0o755 : 0o644);
    await Deno.utime(target, timestamp, timestamp);
  }
}

async function writeManifest(directory, manifest, timestamp) {
  const file = path.join(directory, "manifest.json");
  await Deno.writeTextFile(file, JSON.stringify(manifest, null, 2) + "\n");
  await Deno.utime(file, timestamp, timestamp);
}

function checkManifestFiles(manifest, files) {
  const required = [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.options_page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(
      typeof manifest.action?.default_icon === "object" ? manifest.action.default_icon : {},
    ),
    typeof manifest.action?.default_icon === "string" ? manifest.action.default_icon : null,
    ...Object.values(manifest.chrome_url_overrides || {}),
    ...(manifest.content_scripts || []).flatMap((
      script,
    ) => [...(script.js || []), ...(script.css || [])]),
  ].filter(Boolean);
  for (const file of required) {
    if (!files.includes(file)) throw new Error(`manifest 引用的文件未进入产物：${file}`);
  }
  for (
    const resource of (manifest.web_accessible_resources || []).flatMap((entry) =>
      entry.resources || []
    )
  ) {
    // _favicon 是浏览器提供的虚拟资源，不对应扩展目录中的文件。
    if (resource === "_favicon/*") continue;
    const matcher = path.globToRegExp(resource);
    if (!files.some((file) => matcher.test(file))) {
      throw new Error(`可访问资源未进入产物：${resource}`);
    }
  }
}

async function archive(directory, destination, files) {
  await Deno.mkdir(path.dirname(destination), { recursive: true });
  await Deno.remove(destination).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  const child = new Deno.Command("zip", {
    args: ["-X", "-q", destination, "-@"],
    cwd: directory,
    env: { TZ: "UTC" },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(files.join("\n") + "\n"));
  await writer.close();
  const result = await child.output();
  if (!result.success) throw new Error(`ZIP 构建失败：${new TextDecoder().decode(result.stderr)}`);
  await commandOutput("unzip", ["-tqq", destination]);
  const entries = (await commandOutput("unzip", ["-Z1", destination])).trim().split("\n").sort();
  if (JSON.stringify(entries) !== JSON.stringify(files.toSorted())) {
    throw new Error(`ZIP 内容与构建清单不一致：${destination}`);
  }
  const bytes = await Deno.readFile(destination);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    size: bytes.length,
    sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    files: entries.length,
  };
}

export async function buildArtifacts({ root = Deno.cwd(), output = path.join(root, "dist") } = {}) {
  root = path.resolve(root);
  output = path.resolve(output);
  if (root === output || root.startsWith(output + path.SEPARATOR)) {
    throw new Error("产物目录不能覆盖源码目录或其父目录");
  }
  const manifest = await readManifest(root);
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("版本号格式错误，拒绝生成归档路径");
  const outputRelative = path.relative(root, output).split(path.SEPARATOR).join("/");
  const files = (await sourceFiles(root)).filter((file) =>
    file !== outputRelative && !file.startsWith(outputRelative + "/")
  );
  const runtimeFiles = files.filter(isRuntimeFile);
  for (
    const required of [
      "manifest.json",
      "LICENSE",
      "LICENSES/MIT-Vimium.txt",
      "LICENSES/MIT-shoulda.txt",
      "LICENSES/ISC-yaml.txt",
    ]
  ) {
    if (!runtimeFiles.includes(required)) throw new Error(`运行时包缺少必要文件：${required}`);
  }
  const epoch = Number(
    Deno.env.get("SOURCE_DATE_EPOCH") ||
      await commandOutput("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: root }),
  );
  if (!Number.isFinite(epoch) || epoch < 315532800) {
    throw new Error("SOURCE_DATE_EPOCH 必须为 1980 年以后的有效 Unix 秒时间戳");
  }
  const timestamp = new Date(Math.floor(epoch / 2) * 2000);
  const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-artifacts-" });
  const artifacts = [];
  try {
    const staging = path.join(temporary, "runtime");
    await copyFiles(root, staging, runtimeFiles, timestamp);
    const variants = [
      {
        kind: "chrome-store",
        file: `chrome-store/browser-toolbox-chrome-store-${version}.zip`,
        manifest,
      },
      {
        kind: "chrome-canary",
        file: `chrome-canary/browser-toolbox-canary-${version}.zip`,
        manifest: {
          ...manifest,
          name: "Browser Toolbox Canary",
          description: "Development build of Browser Toolbox.",
        },
      },
      {
        kind: "firefox",
        file: `firefox/browser-toolbox-firefox-${version}.zip`,
        manifest: createFirefoxManifest(manifest),
      },
    ];
    for (const variant of variants) {
      await writeManifest(staging, variant.manifest, timestamp);
      const entries = variant.kind === "firefox"
        ? runtimeFiles.filter((file) => !/^icons\/.*\.png$/.test(file))
        : runtimeFiles;
      checkManifestFiles(variant.manifest, entries);
      const destination = path.join(output, variant.file);
      const metadata = await archive(staging, destination, entries);
      const packaged = JSON.parse(
        await commandOutput("unzip", ["-p", destination, "manifest.json"]),
      );
      if (JSON.stringify(packaged) !== JSON.stringify(variant.manifest)) {
        throw new Error(`归档 manifest 不一致：${variant.file}`);
      }
      artifacts.push({ kind: variant.kind, file: variant.file, ...metadata });
    }
    await writeManifest(staging, manifest, timestamp);
    const runtimeDestination = path.join(output, "browser-toolbox");
    await Deno.remove(runtimeDestination, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
    await copyFiles(staging, runtimeDestination, runtimeFiles, timestamp);
    const sourceStaging = path.join(temporary, "source");
    await copyFiles(root, sourceStaging, files, timestamp);
    const sourceFile = `browser-toolbox-source-${version}.zip`;
    artifacts.push({
      kind: "source",
      file: sourceFile,
      ...await archive(sourceStaging, path.join(output, sourceFile), files),
    });
    const report = {
      version,
      commit: (await commandOutput("git", ["rev-parse", "HEAD"], { cwd: root })).trim(),
      workingTreeDirty: Boolean(
        (await commandOutput("git", ["status", "--porcelain"], { cwd: root })).trim(),
      ),
      sourceDateEpoch: Math.floor(epoch),
      artifacts,
    };
    await Deno.writeTextFile(
      path.join(output, "artifacts.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}
