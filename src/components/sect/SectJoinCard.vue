<template>
  <div class="space-y-3">
    <!-- 已递申请:只报状态与撤回 -->
    <div v-if="sect.appliedTo !== null" class="rounded-md border border-amber-ink/30 bg-amber-ink/10 px-3 py-2.5">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-kai text-[13px] text-ink">{{ sect.appliedTo.name }}</span>
        <span class="shrink-0 text-[10px] text-ink-faint">候批复</span>
      </div>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
        申请已递至该派掌门,准许后即入门册。等不及可撤回,改投别家。
      </p>
      <button
        class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]"
        :disabled="sect.pending"
        :aria-label="sect.pending ? '结算中' : undefined"
        @click="cancel()"
      >
        撤 回
      </button>
    </div>

    <template v-else>
      <!-- 门槛:境界不够先说清,别让人翻完列表才发现投不了 -->
      <div class="rounded-md border border-ink/10 bg-paper-deep/50 px-3 py-2.5">
        <div class="flex items-center justify-between gap-2">
          <span class="font-kai text-[12px] tracking-wider text-ink-soft">投他山门</span>
          <span class="shrink-0 text-[10px] tabular" :class="realmOk ? 'text-jade' : 'text-cinnabar'">
            {{ realmOk ? '已达筑基' : `需${gateName}境` }}
          </span>
        </div>
        <p class="mt-1 text-[10px] leading-relaxed text-ink-faint">
          入一家的门,便能用门中三脉之法修行;捐献换个人贡献,技能归个人(换门随行),营造同门共推。
          申请递出后由掌门决定收不收。
        </p>
      </div>

      <p v-if="sect.sectList.length === 0" class="rounded-md border border-ink/10 bg-paper-deep/40 px-3 py-4 text-center text-[11px] leading-relaxed text-ink-faint">
        尚无门派开山立户。你若已至元婴,可自开一门(见「开宗立派」)。
      </p>

      <div v-else class="space-y-2">
        <div v-for="s in sect.sectList" :key="s.id" class="card-ink px-3 py-2.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-kai text-[14px] tracking-wider text-ink">{{ s.name }}</p>
              <p class="mt-0.5 text-[10px] text-ink-faint">
                掌门 {{ s.leader || '佚名' }} · 山门 {{ s.hall }} 级
              </p>
            </div>
            <span class="shrink-0 text-[10px] tabular" :class="s.members >= s.cap ? 'text-cinnabar' : 'text-ink-soft'">
              门人 {{ s.members }}/{{ s.cap }}
            </span>
          </div>
          <button
            class="btn-ghost mt-2 w-full !py-1.5 !text-[12px]"
            :disabled="s.members >= s.cap || !realmOk || sect.pending"
            :aria-label="blockOf(s) || undefined"
            @click="apply(s.id)"
          >
            {{ blockOf(s) || '递 申 请' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { REALMS } from '@/data/realms'
  import { SECT_JOIN_MAJOR } from '@/data/sect'
  import { canJoin } from '@/core/sectRules'
  import type { SectBriefView } from '@/services/cloud'
  import { usePlayerStore } from '@/stores/player'
  import { useSectStore } from '@/stores/sect'

  const player = usePlayerStore()
  const sect = useSectStore()

  const realmOk = computed(() => canJoin(player.major))
  const gateName = computed(() => REALMS[SECT_JOIN_MAJOR]?.name ?? '筑基')

  /** 按钮上的「为什么投不了」:满员 / 境界不够(与禁用条件同源) */
  function blockOf(s: SectBriefView): string {
    if (s.members >= s.cap) return '门人已满'
    if (!realmOk.value) return `需${gateName.value}境`
    return ''
  }

  function apply(id: number): void {
    if (sect.pending) return
    void sect.join(id)
  }

  function cancel(): void {
    if (sect.pending) return
    void sect.cancelApply()
  }
</script>
