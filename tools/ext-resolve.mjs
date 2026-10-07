/** 注册 ESM 扩展名兜底钩子：node --import ./tools/ext-resolve.mjs <script> */
import { register } from "node:module";

register("./ext-resolve-hooks.mjs", import.meta.url);
