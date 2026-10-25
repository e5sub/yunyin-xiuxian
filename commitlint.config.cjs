/** 提交信息(husky + CI)与 PR 标题(CI)的 conventional 闸门:只卡 `<type>(<scope>): <subject>` 的形,不卡长度 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 中文标题偏长(近 60 条中位 97、P90 117 字符),200 只是上限
    'header-max-length': [2, 'always', 200],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    // 标题常带首字母大写的拉丁词(CI / Sourcery / vitest / PWA…),sentence-case 会误红
    'subject-case': [0]
  }
}
