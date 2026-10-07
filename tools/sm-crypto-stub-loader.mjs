/** 把裸包 sm-crypto 指向替身（见 ./stubs/sm-crypto-stub.mjs 的说明）。 */
export async function resolve(specifier, context, next) {
  if (specifier === "sm-crypto") {
    return { url: new URL("./stubs/sm-crypto-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
