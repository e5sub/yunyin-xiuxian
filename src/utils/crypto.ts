/** 存档加密(AES,crypto-js);只防手改 localStorage/导出文件,非安全边界(密钥随包分发) */
import CryptoJS from 'crypto-js'

const SAVE_SECRET = 'yunyin-xiuxian::dao-in-the-clouds::v1'

export function encryptSave(plain: string): string {
  return CryptoJS.AES.encrypt(plain, SAVE_SECRET).toString()
}

/**
 * 解密失败返回 null。
 * 须先认密文头:crypto-js 的 Base64 解析跳过非法字符,明文 JSON 约 0.6% 会解出非空乱码。
 * encryptSave 产出带盐的 OpenSSL 格式,Base64 恒以 U2FsdGVkX1("Salted__")开头;不是它的按明文走。
 */
export function decryptSave(cipher: string): string | null {
  if (!cipher.startsWith('U2FsdGVkX1')) return null
  try {
    const wordArray = CryptoJS.AES.decrypt(cipher, SAVE_SECRET)
    if (wordArray.sigBytes === 0) return null
    const text = wordArray.toString(CryptoJS.enc.Utf8)
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

/** 读取存档文本:先按密文解,失败按旧版明文返回(向后兼容) */
export function readSaveText(raw: string): string {
  return decryptSave(raw) ?? raw
}
