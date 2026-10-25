/**
 * 典籍志 —— 境界名背后的中国传统典籍
 *
 * 所述皆本原典大意,不取后世附会;成书与作者可考者注,存疑者存疑。
 * 网文一脉无原典可引,单列为「网文」。
 */

export type ClassicSchool = '丹道' | '道家' | '道教' | '佛道' | '网文'

export interface ClassicDef {
  id: string
  /** 书名(或篇名) */
  title: string
  /** 作者 / 成书年代 */
  source: string
  school: ClassicSchool
  /** 一句话:讲了什么、在这里用在哪 */
  gist: string
  /** 相涉的境界(REALMS 的 id);空数组表示「旁证」,不直接对应某境 */
  realms: string[]
}

export const CLASSICS: ClassicDef[] = [
  {
    id: 'cantongqi',
    title: '周易参同契',
    source: '东汉 · 魏伯阳',
    school: '丹道',
    gist: '丹经之祖,借《易》象讲炉火药物火候。「筑基炼己」之说本于此,故筑基一境由此立名。',
    realms: ['zhuji']
  },
  {
    id: 'wuzhenpian',
    title: '悟真篇',
    source: '北宋 · 张伯端',
    school: '丹道',
    gist: '以诗词丹诀述内丹,以「金丹」为药、性命双修 —— 金丹一境的直系出处。',
    realms: ['jindan']
  },
  {
    id: 'xingmingguizhi',
    title: '性命圭旨',
    source: '明代(撰人不详)',
    school: '丹道',
    gist: '立「炼精化气、炼气化神、炼神还虚」三段工夫:婴儿现形为元婴,化神、炼虚皆承此序。',
    realms: ['yuanying', 'huashen', 'lianxu']
  },
  {
    id: 'yunjiqiqian',
    title: '云笈七签',
    source: '北宋 · 张君房',
    school: '道教',
    gist: '道教类书,收雷法与劫运之说 —— 「九重雷海、向死而生」的渡劫想象多源于此类典籍。',
    realms: ['dujie']
  },
  {
    id: 'zhonglv',
    title: '钟吕传道集',
    source: '唐 · 施肩吾(传)',
    school: '道教',
    gist: '钟离权授吕洞宾之道,分仙为鬼、人、地、神、天五等;真仙居天仙之上,故飞升之后第一境为真仙。',
    realms: ['zhenxian']
  },
  {
    id: 'daodejing',
    title: '道德经',
    source: '春秋 · 老子',
    school: '道家',
    gist: '「玄之又玄」「道生一」——玄仙之「玄」、道祖之「道」皆本于此。',
    realms: ['xuanxian', 'hundundaozu']
  },
  {
    id: 'zhuangzi',
    title: '庄子 · 逍遥游',
    source: '战国 · 庄周',
    school: '道家',
    gist: '「藐姑射之山,有神人居焉」——超脱形骸、不食五谷的最初神人形象,故神界之首为神人。',
    realms: ['shenren']
  },
  {
    id: 'sanwuliji',
    title: '三五历纪',
    source: '三国 · 徐整',
    school: '道家',
    gist: '「天地混沌如鸡子,盘古生其中」——开天辟地的宇宙生成传说,混沌真灵与混沌神魔由此取名。',
    realms: ['hundunling', 'hundunshenmo']
  },
  {
    id: 'baopuzi',
    title: '抱朴子',
    source: '东晋 · 葛洪',
    school: '道教',
    gist: '论神仙可学、金丹可成 —— 「凡人可以修仙」最早的体系化主张,整条修行路的底气。',
    realms: []
  },
  {
    id: 'huangting',
    title: '黄庭经',
    source: '魏晋(撰人不详)',
    school: '道教',
    gist: '以脏腑神名与存思之术言养生,内视、内景一路的源头。',
    realms: []
  },
  {
    id: 'webnovel_immortal_ranks',
    title: '网文仙阶(无原典)',
    source: '当代网络文学',
    school: '网文',
    gist: '玄仙、金仙、太乙、大罗,以及神将、神王、神帝诸阶,是当代仙侠最常用的阶位序列 —— 取自约定俗成,不攀经书。',
    realms: ['jinxian', 'taiyi', 'daluo', 'shenjiang', 'shenwang', 'shendi']
  }
]

/** 已列入路线、尚未实装的门类;空数组是正常状态 */
export const PLANNED_SCHOOLS: { name: string; note: string }[] = []

const BY_ID = new Map(CLASSICS.map(c => [c.id, c]))

export function classicDef(id: string): ClassicDef | undefined {
  return BY_ID.get(id)
}

/** 与该境界相涉的典籍 */
export function classicsForRealm(realmId: string): ClassicDef[] {
  return CLASSICS.filter(c => c.realms.includes(realmId))
}
