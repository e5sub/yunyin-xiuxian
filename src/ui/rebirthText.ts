/** 转世去留文案;逐行取自 HERITAGE 同表(结算弹窗也读它),界面不另写一份 */
import { HERITAGE, type HeritageMode } from '@/core/samsaraAudit'

function row(id: string) {
  return HERITAGE.find(r => r.id === id)
}

/** 兵解按钮上方的一行去留标签(以 · 分隔);兵解门槛只写在按钮置灰文案上 */
export function rebirthDecisionHint(): string {
  const keep = [row('daoFruit'), row('talents')].filter(r => r?.mode === 'full').map(r => r!.name)
  const artifacts = row('artifacts')
  const parts = [
    artifacts?.mode === 'reset' ? `${artifacts.name}归零` : '',
    '功法层数回一层 · 顶阶宿慧留一门满层',
    keep.length ? `${keep.join('、')}保留` : ''
  ].filter(Boolean)
  return parts.join(' · ')
}

/** 转世去留一览的一行 */
export interface HeritageViewRow {
  id: string
  name: string
  mode: HeritageMode
  modeLabel: string
  cls: string
}

function modeMeta(mode: HeritageMode): { label: string; cls: string } {
  if (mode === 'full') return { label: '保留', cls: 'text-jade' }
  if (mode === 'partial') return { label: '部分保留', cls: 'text-gold-ink' }
  return { label: '归零', cls: 'text-ink-faint' }
}

export function heritageViewRows(): HeritageViewRow[] {
  return HERITAGE.map(r => {
    const m = modeMeta(r.mode)
    return { id: r.id, name: r.name, mode: r.mode, modeLabel: m.label, cls: m.cls }
  })
}
