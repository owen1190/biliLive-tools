import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// TODO:显然其他类型打包还有问题
const cli_node_modules = path.resolve(__dirname, "../lib/node_modules");
const package_node_modules = path.resolve(__dirname, "../node_modules");
const pnpm_node_modules = path.resolve(__dirname, "../../../node_modules");

// console.log("__dirname", __dirname, pnpm_node_modules);

function copyPackage(packageName) {
  const candidates = [
    path.join(package_node_modules, packageName),
    path.join(pnpm_node_modules, packageName),
  ];
  const src = candidates.find((item) => fs.existsSync(item));
  if (!src) {
    throw new Error(`Cannot find package ${packageName} in ${candidates.join(", ")}`);
  }
  fs.cpSync(src, path.join(cli_node_modules, packageName), {
    recursive: true,
  });
}

function main() {
  // 找到@napi-rs相关包，复制到cli_node_modules,这个路径可能不存在，不存在则创建
  if (!fs.existsSync(cli_node_modules)) {
    fs.mkdirSync(cli_node_modules, { recursive: true });
  }
  // 复制canvas相关文件
  copyPackage("@napi-rs");
  // 复制ntsuspend相关文件，
  copyPackage("ntsuspend");
  // 复制font-list相关文件，
  copyPackage("font-ls");
  // 复制better-sqlite3相关文件，
  copyPackage("better-sqlite3");
  // 复制music-segment-detector相关文件，
  copyPackage("music-segment-detector");
  // 复制meyda相关文件，
  copyPackage("meyda");
  // 复制shazamio-core相关文件，
  copyPackage("shazamio-core");
  copyPackage("file-uri-to-path");
  copyPackage("bindings");
}

main();
