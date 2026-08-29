/** 最小类型声明：sm-crypto / aes-js 均为无内置类型的纯 JS 库 */
declare module "sm-crypto" {
  export const sm2: {
    doEncrypt(msg: string, publicKey: string, cipherMode?: 0 | 1): string;
    doDecrypt(encryptData: string, privateKey: string, cipherMode?: 0 | 1): string;
    doSignature(msg: string, privateKey: string, options?: { hash?: boolean; der?: boolean }): string;
    doVerifySignature(msg: string, signHex: string, publicKey: string, options?: { hash?: boolean }): boolean;
    generateKeyPairHex(): { publicKey: string; privateKey: string };
  };
  export const sm3: { sm3(msg: string): string };
  export const sm4: {
    encrypt(msg: string, key: string, options?: { padding?: string }): string;
    decrypt(cipher: string, key: string, options?: { padding?: string }): string;
  };
}

declare module "aes-js" {
  const aesjs: {
    utils: {
      hex: { toBytes(hex: string): Uint8Array; fromBytes(bytes: Uint8Array): string };
      utf8: { toBytes(text: string): Uint8Array; fromBytes(bytes: Uint8Array): string };
    };
    ModeOfOperation: {
      cbc: new (key: Uint8Array, iv: Uint8Array) => { encrypt(p: Uint8Array): Uint8Array; decrypt(c: Uint8Array): Uint8Array };
      cfb: new (key: Uint8Array, iv: Uint8Array, segmentSize?: number) => { encrypt(p: Uint8Array): Uint8Array; decrypt(c: Uint8Array): Uint8Array };
      ctr: new (key: Uint8Array, iv: Uint8Array) => { encrypt(p: Uint8Array): Uint8Array; decrypt(c: Uint8Array): Uint8Array };
      ofb: new (key: Uint8Array, iv: Uint8Array) => { encrypt(p: Uint8Array): Uint8Array; decrypt(c: Uint8Array): Uint8Array };
      ecb: new (key: Uint8Array) => { encrypt(p: Uint8Array): Uint8Array; decrypt(c: Uint8Array): Uint8Array };
    };
    padding: {
      pkcs7: { pad(bytes: Uint8Array): Uint8Array; strip(bytes: Uint8Array): Uint8Array };
    };
  };
  export default aesjs;
}
