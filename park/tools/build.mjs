// 다이노 파크 코드를 한 파일(js/bundle.js)로 묶어요.
// 옛 아이패드(iPadOS 15)의 사파리도 알아듣는 문법으로 바꿔 줍니다.
// (import map, class static 블록 같은 새 기능은 iPadOS 16.4부터라서요)
// 사용: cd park/tools && npm install && npm run build
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const park = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(park, "vendor", "three");

// "three" 와 "three/addons/..." 를 vendor 폴더의 파일로 연결
const threeAlias = {
  name: "three-alias",
  setup(build) {
    build.onResolve({ filter: /^three$/ }, () => ({ path: path.join(vendor, "three.module.js") }));
    build.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: path.join(vendor, "addons", a.path.slice("three/addons/".length)) }));
  },
};

const result = await esbuild.build({
  entryPoints: [path.join(park, "js", "main.js")],
  outfile: path.join(park, "js", "bundle.js"),
  bundle: true,
  format: "iife",
  target: ["safari15", "ios15"],
  minify: true,
  legalComments: "eof",
  plugins: [threeAlias],
  logLevel: "info",
});
if (result.errors.length) process.exit(1);
