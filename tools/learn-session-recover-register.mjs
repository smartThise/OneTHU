import { register } from "node:module";
register(new URL("./ts-resolve-loader.mjs", import.meta.url));
register(new URL("./sm-crypto-stub-loader.mjs", import.meta.url));
