<template>
  <div class="stagger-in space-y-4 px-4 pb-6 pt-4">
    <div class="card-ink relative flex items-center justify-between gap-2 px-4 py-3">
      <button class="-my-1.5 rounded px-2 py-1.5 text-left text-[12px] text-ink-faint ring-1 ring-inset ring-ink/20 active:text-ink" @click="goBack(router, { name: 'home' })">← 返回</button>
      <p class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-kai text-[15px] tracking-[0.3em] text-ink">
        {{ sect.founded ? sect.name : '门派' }}
      </p>
      <span v-if="sect.founded" class="shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ring-1 ring-inset ring-ink/20" :class="sect.isLeader ? 'text-cinnabar' : 'text-ink-faint'">
        {{ sect.roleLabel }}
      </span>
    </div>

    <!-- 未入派:投他山门 / 开宗立派 两条路 -->
    <template v-if="!sect.founded">
      <template v-if="sect.loaded">
        <InkTabs v-model="tab" :tabs="TABS" />
        <SectJoinCard v-if="tab === 'join'" />
        <SectFoundCard v-else />
      </template>
      <p v-else class="py-6 text-center text-[11px] text-ink-faint">未能读取门派存档 · 稍候再试</p>
    </template>

    <template v-else>
      <!-- 概览 -->
      <div class="rounded-md border border-ink/10 bg-paper-deep/50 px-3 py-2.5">
        <div class="flex items-center justify-between gap-2">
          <span class="font-kai text-[12px] tracking-wider text-ink-soft">{{ sect.roleLabel }} · 三脉同门</span>
          <span class="shrink-0 text-[10px] tabular" :class="sect.donationsLeft > 0 ? 'text-jade' : 'text-ink-faint'">
            今日捐献 {{ sect.donationsLeft }}/{{ quota }} 次
          </span>
        </div>
        <div class="mt-1.5 grid grid-cols-3 gap-1.5">
          <div class="rounded bg-paper-deep/60 px-1 py-1.5 text-center">
            <p class="text-[9px] text-ink-faint">个人贡献</p>
            <p class="tabular font-kai text-[14px] leading-tight text-gold-ink">{{ sect.personal }}</p>
            <p class="mt-0.5 text-[8px] leading-none text-ink-faint">修技能</p>
          </div>
          <div class="rounded bg-paper-deep/60 px-1 py-1.5 text-center">
            <p class="text-[9px] text-ink-faint">门派库</p>
            <p class="tabular font-kai text-[14px] leading-tight text-azure">{{ sect.pool }}</p>
            <p class="mt-0.5 text-[8px] leading-none text-ink-faint">营建筑</p>
          </div>
          <div class="rounded bg-paper-deep/60 px-1 py-1.5 text-center">
            <p class="text-[9px] text-ink-faint">门人</p>
            <p class="tabular font-kai text-[14px] leading-tight text-ink-soft">{{ sect.memberCount }}/{{ sect.capacity }}</p>
            <p class="mt-0.5 text-[8px] leading-none text-ink-faint">山门定员</p>
          </div>
        </div>
        <p class="mt-1.5 flex items-baseline justify-between text-[9px] text-ink-faint">
          <span>累计捐献贡献</span>
          <span class="tabular text-ink-soft">{{ sect.state.totalDonated }}</span>
        </p>
        <!-- 门人入口并进概览(1.74.1):门册/候批/去留都在弹窗里,概览卡点一下即达,不再单独占一张卡 -->
        <button class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]" @click="memberOpen = true">
          <span class="whitespace-nowrap">查看门人</span>
          <span v-if="sect.canReview && sect.applyCount > 0" class="whitespace-nowrap text-cinnabar">
            · 候批 {{ sect.applyCount }}
          </span>
        </button>
        <SectMemberDialog v-model:open="memberOpen" />
      </div>

      <SectDonateCard />

      <section>
        <SectionTitle title="营造" :hint="`山门 ${hallLevel} 级 · 队列 ${sect.state.build.length}/${sect.queueCap} · 有职者为之`" />
        <SectBuildingCard :def="hallDef" class="mt-2" />
        <div class="mt-2.5 grid grid-cols-1 gap-2.5 min-[320px]:grid-cols-2">
          <SectBuildingCard v-for="def in otherBuildings" :key="def.id" :def="def" />
        </div>
      </section>

      <section>
        <SectionTitle title="门派技能" :hint="`个人贡献 ${sect.personal} · 至多 ${sect.skillCap} 重`" />
        <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
          每门基础五重;山门每 20 级再开五重(20、40、60、80、100 级各一次,百级至三十重)。
        </p>
        <div v-for="[row, defs] in skillRows" :key="row" class="mt-2.5">
          <p class="text-[10px] leading-none text-ink-faint">第 {{ row }} 层 · 三脉各一门 + 门派绝学</p>
          <div class="mt-1.5 grid grid-cols-1 gap-2.5 min-[320px]:grid-cols-2">
            <SectSkillCard v-for="def in defs" :key="def.id" :def="def" />
            <SectArtCard :def="artOfRow(row)!" />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { goBack } from '@/router/goBack'
  import { SECT_ARTS, SECT_BUILDINGS, SECT_SKILLS, sectBuildingDef, type SectSkillDef } from '@/data/sect'
  import { donationQuota } from '@/core/sectRules'
  import { useAuthStore } from '@/stores/auth'
  import { useSectStore } from '@/stores/sect'
  import SectionTitle from '@/components/common/SectionTitle.vue'
  import InkTabs from '@/components/common/InkTabs.vue'
  import SectFoundCard from '@/components/sect/SectFoundCard.vue'
  import SectJoinCard from '@/components/sect/SectJoinCard.vue'
  import SectDonateCard from '@/components/sect/SectDonateCard.vue'
  import SectBuildingCard from '@/components/sect/SectBuildingCard.vue'
  import SectSkillCard from '@/components/sect/SectSkillCard.vue'
  import SectArtCard from '@/components/sect/SectArtCard.vue'
  import SectMemberDialog from '@/components/sect/SectMemberDialog.vue'

  const router = useRouter()
  const auth = useAuthStore()
  const sect = useSectStore()

  /** 门人册弹窗(入口在概览卡内) */
  const memberOpen = ref(false)

  /** 未入派时的两条路:先看别人开的门,再考虑自己开 */
  const TABS = [
    { id: 'join', label: '投他山门' },
    { id: 'found', label: '开宗立派' }
  ] as const
  const tab = ref<'join' | 'found'>('join')

  /** 每日捐献上限:常驻 3、VIP 5(与服务端限次同源) */
  const quota = computed(() => donationQuota(auth.isVip))

  /** 门派绝学:每层一门,与三脉技能同层并排(每层凑齐四门) */
  const artOfRow = (row: number) => SECT_ARTS.find(a => a.row === row)

  /** 三脉十五门按层分组:每层三门并排,看得清同层三选一 */
  const skillRows = computed<[number, SectSkillDef[]][]>(() => {
    const map = new Map<number, SectSkillDef[]>()
    for (const def of SECT_SKILLS) {
      const list = map.get(def.row) ?? []
      list.push(def)
      map.set(def.row, list)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  })

  const hallDef = computed(() => sectBuildingDef('hall')!)
  const otherBuildings = computed(() => SECT_BUILDINGS.filter(b => b.id !== 'hall'))
  const hallLevel = computed(() => sect.buildingLevel('hall'))

  onMounted(() => {
    // 进门派页必刷一次:状态只住服务端,别让面板停在上次读到的数
    void sect.load()
  })
</script>
