/** Tailwind v3 须经 PostCSS 接入;autoprefixer 不可省,否则 Android WebView 与旧版 Safari 上 backdrop-filter、mask 等属性失效 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
