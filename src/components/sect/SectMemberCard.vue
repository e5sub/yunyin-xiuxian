<template>
  <div class="card-ink px-3 py-3">
    <div class="flex items-baseline justify-between gap-2">
      <span class="font-kai text-[12px] tracking-wider text-ink-soft">门人</span>
      <span class="shrink-0 text-[10px] tabular text-ink-faint">{{ sect.memberCount }}/{{ sect.capacity }}</span>
    </div>

    <!-- 门册:掌门在首,其余按入门先后 -->
    <ul class="mt-2 space-y-1.5">
      <li v-for="m in sect.members" :key="m.userId" class="flex items-center gap-2 rounded-md bg-paper-deep/40 px-2 py-1.5">
        <span class="grid h-6 w-6 shrink-0 place-items-center rounded" :class="m.role === 'leader' ? 'bg-ink/10 text-ink' : 'bg-ink/5 text-ink-faint'">
          <GameIcon :name="ROLE_ICON[m.role]" :size="12" />
        </span>
        <span class="min-w-0 grow truncate text-[12px]" :class="m.userId === myId ? 'text-ink' : 'text-ink-soft'">
          {{ m.name }}<span v-if="m.userId === myId" class="ml-1 text-[10px] text-ink-faint">(我)</span>
        </span>
        <span class="shrink-0 text-[10px] tabular text-ink-faint">{{ m.role === 'leader' ? '掌门' : `贡献 ${m.personal}` }}</span>
        <button
          v-if="sect.isLeader && m.userId !== myId"
          class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-faint ring-1 ring-inset ring-ink/20 active:text-cinnabar"
          :aria-label="`逐出 ${m.name}`"
          :disabled="sect.pending"
          @click="kick(m.userId)"
        >
          逐 出
        </button>
      </li>
    </ul>

    <!-- 待审申请:只有掌门看得到 -->
    <template v-if="sect.isLeader">
      <div class="mt-3 flex items-baseline justify-between gap-2">
        <span class="font-kai text-[12px] tracking-wider text-ink-soft">门外候着</span>
        <span class="shrink-0 text-[10px] tabular" :class="sect.applyCount > 0 ? 'text-cinnabar' : 'text-ink-faint'">
          {{ sect.applyCount }} 人
        </span>
      </div>
      <p v-if="sect.applies.length === 0" class="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
        还没有人来投。门人名额随山门涨,升一级多一人。
      </p>
      <ul v-else class="mt-1.5 space-y-1.5">
        <li v-for="a in sect.applies" :key="a.userId" class="rounded-md border border-ink/10 bg-paper-deep/40 px-2 py-1.5">
          <div class="flex items-center gap-2">
            <span class="min-w-0 grow truncate text-[12px] text-ink">{{ a.name }}</span>
            <span class="shrink-0 text-[10px] text-ink-faint">{{ a.realmLabel || '境界未明' }}</span>
          </div>
          <div class="mt-1.5 flex gap-1.5">
            <button class="btn-ghost grow !py-1 !text-[11px]" :disabled="sect.pending || full" :aria-label="full ? '门人已满,先升山门' : sect.pending ? '结算中' : undefined" @click="review(a.userId, true)">
              {{ full ? '门人已满' : '准 入' }}
            </button>
            <button class="btn-ghost grow !py-1 !text-[11px]" :disabled="sect.pending" :aria-label="sect.pending ? '结算中' : undefined" @click="review(a.userId, false)">谢 绝</button>
          </div>
        </li>
      </ul>
    </template>

    <!-- 去留:门人退门(贡献清零),掌门解散(两段确认) -->
    <div class="mt-3 border-t border-ink/10 pt-2.5">
      <button
        v-if="!sect.isLeader"
        class="btn-ghost w-full !py-1.5 !text-[12px]"
        :disabled="sect.pending"
        :aria-label="sect.pending ? '结算中' : undefined"
        @click="leave()"
      >
        退出山门 · 个人贡献清零
      </button>
      <template v-else>
        <p v-if="!dissolveArmed" class="text-[10px] leading-relaxed text-ink-faint">
          掌门不能退出:要么把门传下去 —— 删档时自动转给最先入门者 —— 要么解散。
        </p>
        <button
          class="btn-ghost mt-1.5 w-full !py-1.5 !text-[12px]"
          :class="dissolveArmed ? '!text-cinnabar' : ''"
          :disabled="sect.pending"
          @click="pressDissolve()"
        >
          {{ dissolveArmed ? '再点一次 · 确认解散' : '解散门派' }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import GameIcon from '@/components/common/GameIcon.vue'
  import { useAuthStore } from '@/stores/auth'
  import { useSectStore } from '@/stores/sect'

  const auth = useAuthStore()
  const sect = useSectStore()

  /** 门册上的小像:掌门戴冠,门人用普通人像(写成查表,别在模板里塞条件表达式) */
  const ROLE_ICON: Record<'leader' | 'member', string> = { leader: 'crown', member: 'user' }

  const myId = computed(() => auth.userId)
  /** 门已满:审批按钮直接改成「先升山门」 */
  const full = computed(() => sect.memberCount >= sect.capacity)
  /** 解散要两段确认:误触一下就把一整个门派散了,没有回头路 */
  const dissolveArmed = ref(false)

  function review(user: number, approve: boolean): void {
    if (sect.pending) return
    void sect.review(user, approve)
  }

  function kick(user: number): void {
    if (sect.pending) return
    void sect.kick(user)
  }

  function leave(): void {
    if (sect.pending) return
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
</script>
