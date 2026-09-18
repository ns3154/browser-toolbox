// 重建固定版本的本地 YAML 模块；普通打包不需要执行此维护脚本。
import { build, stop } from "npm:esbuild@0.28.2";

const version = "2.9.1";
const integrity =
  "3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==";
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-yaml-" });
try {
  const response = await fetch(`https://registry.npmjs.org/yaml/-/yaml-${version}.tgz`);
  if (!response.ok) throw new Error(`下载失败：${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
  if (btoa(String.fromCharCode(...hash)) !== integrity) throw new Error("YAML 归档校验失败。");
  await Deno.writeFile(`${temporary}/yaml.tgz`, bytes);
  const extracted = await new Deno.Command("tar", {
    args: ["-xzf", `${temporary}/yaml.tgz`, "-C", temporary],
  }).output();
  if (!extracted.success) throw new Error("YAML 归档解压失败。");
  const license = await Deno.readTextFile(`${temporary}/package/LICENSE`);
  await Deno.mkdir("vendor", { recursive: true });
  await Deno.writeTextFile("LICENSES/ISC-yaml.txt", license);
  await build({
    entryPoints: [`${temporary}/package/browser/index.js`],
    outfile: "vendor/yaml.js",
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "inline",
    banner: {
      js:
        `/* yaml ${version}，本地打包；重建方式：deno run -A scripts/build_yaml_vendor.js\n${license}*/`,
    },
  });
  console.log(`已构建 yaml ${version}，归档 SHA-512 校验通过。`);
} finally {
  stop();
  await Deno.remove(temporary, { recursive: true });
}
