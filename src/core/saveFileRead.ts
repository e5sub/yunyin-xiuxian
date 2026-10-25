/**
 * 读取用户选择的存档文件。
 * 回调可能在组件卸载后到达;调用方卸载时 abort 句柄,之后不再回调。
 */
export interface SaveFileReadHandle {
  abort(): void
}

export function readSaveFile(
  file: File,
  onLoad: (text: string) => void,
  onError: () => void,
  createReader: () => FileReader = () => new FileReader()
): SaveFileReadHandle {
  const reader = createReader()
  let settled = false

  reader.onload = () => {
    if (settled) return
    settled = true
    onLoad(String(reader.result ?? ''))
  }
  reader.onerror = () => {
    if (settled) return
    settled = true
    onError()
  }
  reader.readAsText(file)

  return {
    abort() {
      if (settled) return
      settled = true
      try {
        reader.abort()
      } catch {
        // 已完成的读取无法中止;settled 已挡住后续回调
      }
    }
  }
}
