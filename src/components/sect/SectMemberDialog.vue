<template>
  <BaseModal :open="open" title="门人" wide @close="close()">
    <div class="space-y-3">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-kai text-[12px] tracking-wider text-ink-soft">
          {{ sect.isLeader ? '掌门' : '门人' }} · 三脉同门
        </span>
        <span class="shrink-0 text-[10px] tabular text-ink-faint">门中 {{ sect.memberCount }}/{{ sect.capacity }} 人</span>
      </div>

      <!-- 掌门才看得到候批;门人只有一页门册 -->
      <InkTabs v-if="sect.isLeader" v-model="tab" :tabs="tabs" />

      <template v-if="tab === 'member'">
        <div class="flex items-stretch gap-1.5">
          <label class="min-w-0 grow">
            <span class="sr-only">按道号查门人</span>
            <input
              v-model="draft"
              type="text"
              maxlength="12"
              placeholder="按道号查"
              class="w-full rounded-md border border-ink/15 bg-paper px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-cinnabar/40"
              @keyup.enter="search()"
            />
          </label>
          <button
            class="btn-ghost shrink-0 !px-3 !py-1.5 !text-[11px]"
            :disabled="sect.membersPending"
            :aria-label="sect.membersPending ? '读取中' : undefined"
            @click="search()"
          >
            查
          </button>
        </div>

        <p class="text-[10px] leading-relaxed text-ink-faint">
          共 {{ sect.memberTotal }} 人<span v-if="sect.memberQuery !== ''">,命中「{{ sect.memberQuery }}」</span>。按入门先后,掌门在首。
        </p>

        <p v-if="sect.memberRows.length === 0" class="rounded-md border border-ink/10 bg-paper-deep/40 px-3 py-4 text-center text-[11px] leading-relaxed text-ink-faint">
          {{ sect.memberQuery === '' ? '门册上只有你一人。' : '门册上无此人。' }}
        </p>

        <ul v-else class="space-y-1.5">
          <li v-for="m in sect.memberRows" :key="m.userId" class="flex items-center gap-2 rounded-md bg-paper-deep/40 px-2 py-1.5">
            <span class="grid h-6 w-6 shrink-0 place-items-center rounded" :class="m.role === 'leader' ? 'bg-ink/10 text-ink' : 'bg-ink/5 text-ink-faint'">
              <GameIcon :name="ROLE_ICON[m.role]" :size="12" />
            </span>
            <span class="min-w-0 grow truncate text-[12px]" :class="m.userId === myId ? 'text-ink' : 'text-ink-soft'">
              {{ m.name }}<span v-if="m.userId === myId" class="ml-1 text-[10px] text-ink-faint">(我)</span>
            </span>
            <span class="shrink-0 text-[10px] tabular text-ink-faint">
              {{ m.role === 'leader' ? '掌门' : `贡献 ${m.personal}` }}
            </span>
            <button
              v-if="sect.isLeader && m.userId !== myId"
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-faint ring-1 ring-inset ring-ink/20 active:text-cinnabar"
              :aria-label="`逐出 ${m.name}`"
              :disabled="sect.pending"
              :title="sect.pending ? '结算中' : undefined"
              @click="kick(m.userId)"
            >
              逐 出
            </button>
          </li>
        </ul>

        <div class="flex items-center gap-1.5">
          <button
            class="btn-ghost shrink-0 !px-2.5 !py-1.5 !text-[11px]"
            :disabled="sect.memberPage <= 1 || sect.membersPending"
            :aria-label="prevReason"
            @click="turn(-1)"
          >
            上一页
          </button>
          <span class="grow text-center text-[10px] tabular text-ink-faint">
            {{ sect.memberPage }}/{{ sect.memberPages }}
          </span>
          <button
            class="btn-ghost shrink-0 !px-2.5 !py-1.5 !text-[11px]"
            :disabled="sect.memberPage >= sect.memberPages || sect.membersPending"
            :aria-label="nextReason"
            @click="turn(1)"
          >
            下一页
          </button>
        </div>
      </template>

      <!-- 门外候着:只有掌门看得到(服务端也只发给他) -->
      <template v-else>
        <p v-if="sect.applies.length === 0" class="rounded-md border border-ink/10 bg-paper-deep/40 px-3 py-4 text-center text-[11px] leading-relaxed text-ink-faint">
          还没有人来投。门人名额随山门涨,升一级多一人。
        </p>
        <ul v-else class="space-y-1.5">
          <li v-for="a in sect.applies" :key="a.userId" class="rounded-md border border-ink/10 bg-paper-deep/40 px-2 py-1.5">
            <div class="flex items-center gap-2">
              <span class="min-w-0 grow truncate text-[12px] text-ink">{{ a.name }}</span>
              <span class="shrink-0 text-[10px] text-ink-faint">{{ a.realmLabel || '境界未明' }}</span>
            </div>
            <div class="mt-1.5 flex gap-1.5">
              <button
                class="btn-ghost grow !py-1 !text-[11px]"
                :disabled="sect.pending || full"
                :aria-label="full ? '门人已满,先升山门' : sect.pending ? '结算中' : undefined"
                @click="review(a.userId, true)"
              >
                {{ full ? '门人已满' : '准 入' }}
              </button>
              <button
                class="btn-ghost grow !py-1 !text-[11px]"
                :disabled="sect.pending"
                :aria-label="sect.pending ? '结算中' : undefined"
                @click="review(a.userId, false)"
              >
                谢 绝
              </button>
            </div>
          </li>
        </ul>
      </template>
    </div>

    <!-- 去留:门人退门(贡献清零),掌门解散(都要两段确认) -->
    <template #footer>
      <div class="border-t border-ink/10 pt-2.5">
        <button
          v-if="!sect.isLeader"
          class="btn-ghost w-full !py-1.5 !text-[12px]"
          :class="leaveArmed ? '!text-cinnabar' : ''"
          :disabled="sect.pending"
          :aria-label="sect.pending ? '结算中' : undefined"
          @click="pressLeave()"
        >
          {{ leaveArmed ? '再点一次 · 确认退出(贡献清零)' : '退出山门 · 个人贡献清零' }}
        </button>
        <template v-else>
          <p class="text-[10px] leading-relaxed text-ink-faint">
            掌门不能退出:要么把门传下去 —— 删档时自动转给最先入门者 —— 要么解散。
          </p>
          <button
            class="btn-ghost mt-1.5 w-full !py-1.5 !text-[12px]"
            :class="dissolveArmed ? '!text-cinnabar' : ''"
            :disabled="sect.pending"
            :aria-label="sect.pending ? '结算中' : undefined"
            @click="pressDissolve()"
          >
            {{ dissolveArmed ? '再点一次 · 确认解散' : '解散门派' }}
          </button>
        </template>
      </div>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import BaseModal from '@/components/common/BaseModal.vue'
  import GameIcon from '@/components/common/GameIcon.vue'
  import InkTabs from '@/components/common/InkTabs.vue'
  import { useAuthStore } from '@/stores/auth'
  import { useSectStore } from '@/stores/sect'

  const open = defineModel<boolean>('open', { required: true })

  const auth = useAuthStore()
  const sect = useSectStore()

  /** 门册上的小像:掌门戴冠,门人用普通人像(写成查表,别在模板里塞条件表达式) */
  const ROLE_ICON: Record<'leader' | 'member', string> = { leader: 'crown', member: 'user' }

  const myId = computed(() => auth.userId)
  /** 门已满:审批按钮直接改成「先升山门」 */
  const full = computed(() => sect.memberCount >= sect.capacity)

  /** 两页签:门册 / 候批(候批带红点,别让掌门非点进来才知道有人在等) */
  const tabs = computed<{ id: 'member' | 'apply'; label: string; dot?: boolean }[]>(() => [
    { id: 'member', label: '门册' },
    { id: 'apply', label: '候批', dot: sect.applyCount > 0 }
  ])
  const tab = ref<'member' | 'apply'>('member')

  /** 搜索框的草稿:回车或点「查」才落库,打字途中不逐字请求 */
  const draft = ref('')

  const prevReason = computed(() => {
    if (sect.membersPending) return '读取中'
    return sect.memberPage <= 1 ? '已是首页' : undefined
  })
  const nextReason = computed(() => {
    if (sect.membersPending) return '读取中'
    return sect.memberPage >= sect.memberPages ? '已是末页' : undefined
  })

  const leaveArmed = ref(false)
  const dissolveArmed = ref(false)

  function close(): void {
    open.value = false
  }

  function search(): void {
    if (sect.membersPending) return
    void sect.loadMembers(draft.value.trim(), 1)
  }

  function turn(step: number): void {
    if (sect.membersPending) return
    const page = Math.min(sect.memberPages, Math.max(1, sect.memberPage + step))
    if (page === sect.memberPage) return
    void sect.loadMembers(sect.memberQuery, page)
  }

  function review(user: number, approve: boolean): void {
    if (sect.pending) return
    void sect.review(user, approve)
  }

  function kick(user: number): void {
    if (sect.pending) return
    void sect.kick(user)
  }

  function pressLeave(): void {
    if (sect.pending) return
    if (!leaveArmed.value) {
      leaveArmed.value = true
      return
    }
    leaveArmed.value = false
    void sect.leave()
  }

  function pressDissolve(): void {
    if (sect.pending) return
    if (!dissolveArmed.value) {
      dissolveArmed.value = true
      return
    }
    dissolveArmed.value = false
    void sect.dissolve()
  }

  // 每次打开都从第一页读起:关窗期间有人入派/退门,留着上次那一页会错位
  watch(
    open,
    o => {
      if (o) {
        tab.value = 'member'
        draft.value = sect.memberQuery
        leaveArmed.value = false
        dissolveArmed.value = false
        void sect.loadMembers(sect.memberQuery, 1)
      } else {
        leaveArmed.value = false
        dissolveArmed.value = false
      }
    },
    { immediate: true }
  )

  // 名录会变(准入、逐出、退门):就地重读当前这一页,不必让玩家自己再点一次
  watch(
    () => [sect.memberCount, sect.applyCount] as const,
    () => {
      if (open.value) void sect.loadMembers(sect.memberQuery, sect.memberPage)
    }
  )
</script>
