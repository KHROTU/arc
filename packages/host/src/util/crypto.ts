import { createCipheriv, createDecipheriv, randomBytes, type CipherKey } from "node:crypto";
export interface AesGcmEnvelope {
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
}
export function aesGcmEncrypt(key: CipherKey, plaintext: Buffer): AesGcmEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}
export function aesGcmDecrypt(key: CipherKey, env: AesGcmEnvelope): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, env.iv);
  decipher.setAuthTag(env.tag);
  return Buffer.concat([decipher.update(env.data), decipher.final()]);
}