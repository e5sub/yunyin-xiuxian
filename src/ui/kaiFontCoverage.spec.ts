/* eslint-disable no-console */
/**
 * 楷体子集 · 覆盖验收。安卓不带楷体,三端统一用随包的霞鹜文楷(GB 屏幕阅读版)子集;
 * 生成脚本:scripts/fonts/build-kai-font.py。子集只留生成那一刻源码里出现的字 + GB2312 全字集,
 * 按用法频次切成二十来片(每片一段 unicode-range)。
 *
 * 三条判据(红了就重跑生成脚本):
 *   一 源码与模板里用到的每个字符,要么在字体真实的 cmap 里,要么在「交给系统字体画」名单里;
 *   二 每一片字体文件本身要与记账对得上(sha256 + 字数);
 *   三 kai-subset.css 里每一片的 unicode-range 与记账逐字相同,且没有孤儿:
 *      产物目录里的每一片都在记账里,记账里的每一片都在声明里。
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const CHARS_FILE = resolve(ROOT, "scripts/fonts/kai-subset.chars.txt");
const META_FILE = resolve(ROOT, "scripts/fonts/kai-subset.meta.json");
const FONT_DIR = resolve(ROOT, "src/assets/fonts");
const CSS_FILE = join(FONT_DIR, "kai-subset.css");

interface ChunkMeta {
  file: string;
  chars: number;
  bytes: number;
  sha256: string;
  unicode_range: string;
}

/** src 下所有 .ts/.vue/.js(跳过 *.spec.ts)+ 入口 index.html 里出现过的字符;须与生成脚本的 needed_chars() 同一条规则。 */
function sourceChars(): Set<string> {
  const chars = new Set<string>();
  const eat = (text: string) => {
    for (const c of text) if (!/\s/.test(c)) chars.add(c);
  };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|vue|js)$/.test(entry.name) && !entry.name.endsWith(".spec.ts"))
        eat(readFileSync(path, "utf-8"));
    }
  };
  walk(resolve(ROOT, "src"));
  eat(readFileSync(resolve(ROOT, "index.html"), "utf-8"));
  return chars;
}

describe("楷体子集 · 覆盖", () => {
  it("源码与模板里用到的每个字,要么字体画得出,要么在「交给系统字体」名单里", () => {
    // 字表是生成脚本从产物读回来的真实 cmap,不是「要求包含的字」
    const subset = new Set(readFileSync(CHARS_FILE, "utf-8"));
    const meta = JSON.parse(readFileSync(META_FILE, "utf-8")) as {
      delegated_to_system?: string;
      subset_chars: number;
    };
    const delegated = new Set(meta.delegated_to_system ?? "");
    const missing = [...sourceChars()].filter((c) => !subset.has(c) && !delegated.has(c));
    if (missing.length > 0) {
      console.log(
        `子集缺字 ${missing.length} 个:${missing.slice(0, 40).join("")}${missing.length > 40 ? " …" : ""}`,
      );
    }
    expect(missing.join("")).toBe("");
  });

  it("字体文件与记账文件对得上(换了字体就得重跑生成脚本)", () => {
    const meta = JSON.parse(readFileSync(META_FILE, "utf-8")) as {
      subset_chars: number;
      chunks: ChunkMeta[];
    };
    // spread 逐码点清点字符数,与 needed_chars 同口径
    expect([...readFileSync(CHARS_FILE, "utf-8")].length).toBe(meta.subset_chars);
    expect(meta.chunks.length, "切片少得不像话 —— 生成脚本或记账被改坏了").toBeGreaterThan(1);
    let total = 0;
    for (const chunk of meta.chunks) {
      const file = join(FONT_DIR, chunk.file);
      const bytes = readFileSync(file);
      total += bytes.length;
      expect(createHash("sha256").update(bytes).digest("hex"), `${chunk.file} 与记账对不上`).toBe(
        chunk.sha256,
      );
      expect(bytes.length, `${chunk.file} 的体积与记账对不上`).toBe(chunk.bytes);
    }
    // 切片合计在 2MB 量级,长到几 MB 说明裁剪范围被改坏了
    expect(total).toBeLessThan(6 * 1024 * 1024);
    expect(meta.chunks.reduce((n, c) => n + c.chars, 0)).toBeGreaterThanOrEqual(meta.subset_chars);
  });

  it("每一片的 @font-face 与它的 unicode-range 逐字对得上,而且没有孤儿片", () => {
    const meta = JSON.parse(readFileSync(META_FILE, "utf-8")) as { chunks: ChunkMeta[] };
    const css = readFileSync(CSS_FILE, "utf-8");
    const declared = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
      const body = m[1]!;
      const file = /url\(["']\.\/([^"']+)["']\)/.exec(body)?.[1] ?? "";
      const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
      return { file, range };
    });
    expect(declared.length, "CSS 里的 @font-face 条数与切片数对不上").toBe(meta.chunks.length);
    for (const chunk of meta.chunks) {
      const row = declared.find((d) => d.file === chunk.file);
      expect(row, `${chunk.file} 没有对应的 @font-face 声明`).toBeTruthy();
      expect(row!.range, `${chunk.file} 的 unicode-range 与记账不一致(重跑生成脚本)`).toBe(
        chunk.unicode_range.replace(/\s+/g, " ").trim(),
      );
    }
    const files = readdirSync(FONT_DIR).filter((f) => f.endsWith(".woff2"));
    const known = new Set(meta.chunks.map((c) => c.file));
    expect(
      files.filter((f) => !known.has(f)),
      "有切片没进记账",
    ).toEqual([]);
  });
});
