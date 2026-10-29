<template>
  <div class="stagger-in space-y-4 px-4 pb-6 pt-4">
    <SectionTitle title="多人副本" hint="结伴共修 · 每日各一次" />

    <!-- 房间卡 -->
    <div class="card-ink px-4 py-4">
      <div class="flex items-baseline justify-between">
        <span class="font-kai text-[13px] tracking-widest text-ink">结伴同行</span>
        <span class="text-[11px] text-ink-faint">至多 {{ maxSize }} 人</span>
      </div>

      <!-- 已在房:展示房间码与成员 -->
      <template v-if="room !== null">
        <div class="mt-3 flex items-center justify-between gap-2">
          <button
            class="min-w-0 text-left active:opacity-60"
            title="点按复制房间码"
            @click="copyRoomCode"
          >
            <p class="text-[11px] text-ink-faint">{{ dungeonName(room.dungeon) }} · 房间码(点按复制)</p>
            <p class="font-mono text-[22px] tracking-[0.3em] text-cinnabar tabular">{{ room.code }}</p>
          </button>
          <div class="flex shrink-0 flex-col gap-1.5">
            <button class="btn-ink px-3 py-1.5 text-[12px]" :disabled="running !== null" @click="startRun(room.dungeon, room.code)">
              结阵开拔
            </button>
            <button class="btn-ink px-3 py-1.5 text-[12px]" :disabled="running !== null" @click="leaveRoom">散伙</button>
          </div>
        </div>
        <table class="mt-3 w-full text-[12px]">
          <tbody>
            <tr v-for="m in room.members" :key="m.userId" class="border-t border-ink/15">
              <td class="py-1.5 text-ink">
                {{ m.name }}
                <span v-if="m.userId === room.leaderId" class="ml-1 text-[10px] text-gold-ink">房主</span>
              </td>
              <td class="py-1.5 text-right text-[11px] text-ink-faint">{{ m.userId === myId ? '我' : '' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="mt-2 text-[10px] leading-relaxed text-ink-faint">
          把房间码告诉道友,对方在「输入房间码」里填同一串即自动进房;开拔需全员今日次数未用,结算后自动散伙。
        </p>
      </template>

      <!-- 未在房:创建 / 凭码加入 -->
      <template v-else>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <select v-model="roomDungeon" class="rounded-md border border-ink/15 bg-paper-deep/60 px-2 py-1.5 text-[12px] text-ink">
            <option v-for="d in dungeons" :key="d.key" :value="d.key">{{ d.name }}</option>
          </select>
          <button class="btn-ink px-3 py-1.5 text-[12px]" :disabled="roomBusy" @click="createRoom">创建房间</button>
        </div>
        <div class="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            v-model="joinCode"
            placeholder="输入房间码"
            maxlength="6"
            class="w-36 rounded-md border border-ink/15 bg-paper-deep/60 px-2 py-1.5 font-mono text-[13px] uppercase tracking-widest text-ink placeholder:text-ink-faint"
            @keydown.enter="joinRoom"
          >
          <button class="btn-ink px-3 py-1.5 text-[12px]" :disabled="roomBusy || joinCode.trim().length < 4" @click="joinRoom">加入</button>
        </div>
        <p class="mt-2 text-[10px] leading-relaxed text-ink-faint">道友建房拿到房间码,输入同一串码即自动进房。</p>
      </template>
    </div>

    <!-- 各副本 -->
    <div v-for="d in dungeons" :key="d.key" class="card-ink px-4 py-4">
      <div class="flex items-baseline justify-between">
        <span class="font-kai text-[14px] tracking-widest" :class="usedUp(d) ? 'text-ink-faint' : 'text-ink'">{{ d.name }}</span>
        <span class="text-[11px] text-ink-faint tabular">{{ attemptsText(d) }}</span>
      </div>
      <p class="mt-1 text-[11px] leading-relaxed text-ink-soft">{{ d.desc }}</p>

      <button
        class="btn-ink mt-3 w-full"
        :disabled="usedUp(d) || running !== null"
        @click="startRun(d.key, room !== null && room.dungeon === d.key ? room.code : '')"
      >
        {{ runLabel(d) }}
      </button>

      <!-- 战报 -->
      <div
        v-if="results[d.key]"
        class="mt-3 max-h-56 overflow-y-auto rounded-md border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[12px] leading-relaxed text-ink-soft"
      >
        <p class="mb-1" :class="results[d.key]!.win ? 'text-jade' : 'text-cinnabar'">
          {{ results[d.key]!.name }} · {{ results[d.key]!.win ? '大有所获' : '止步于此' }}(房间 {{ results[d.key]!.roomSize }} 人)
        </p>
        <p v-for="(line, i) in results[d.key]!.log" :key="i">{{ line }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import SectionTitle from '@/components/common/SectionTitle.vue'
  import { useUiStore } from '@/stores/ui'
  import { usePlayerStore } from '@/stores/player'
  import { useResourcesStore } from '@/stores/resources'
  import { useAuthStore } from '@/stores/auth'
  import { cloudApi, onCloudWs, type DungeonBrief, type DungeonKey, type DungeonRunResult, type DungeonRoom } from '@/services/cloud'
  import { copyText } from '@/utils/clipboard'
  import { stoneByTier } from '@/core/formulas'
  import { tierOfMajor } from '@/core/secretRealm'

  const ui = useUiStore()
  const player = usePlayerStore()
  const resources = useResourcesStore()
  const auth = useAuthStore()

  const dungeons = ref<DungeonBrief[]>([])
  const maxSize = ref(5)
  const room = ref<DungeonRoom | null>(null)
  const results = ref<Record<string, DungeonRunResult | undefined>>({})
  const running = ref<DungeonKey | null>(null)
  const roomBusy = ref(false)
  const roomDungeon = ref<DungeonKey>('demon')
  const joinCode = ref('')
  const myId = computed(() => auth.userId)

  const unsubWs = onCloudWs(msg => {
    if (msg.type === 'room_join') {
      ui.toast(`${msg.name} 凭码入房`, 'info')
      void reload()
    } else if (msg.type === 'room_leave') {
      ui.toast(`${msg.name} 已退出房间`, 'info')
      void reload()
    } else if (msg.type === 'dungeon_result') {
      // 道友代开:奖励不重复入账(只由开拔者结算),刷新次数即可
      ui.toast(`${msg.name} · ${msg.win ? '告捷' : '止步'},道友共享战获`, msg.win ? 'success' : 'info')
      void reload()
    }
  })

  function dungeonName(key: DungeonKey): string {
    return dungeons.value.find(d => d.key === key)?.name ?? key
  }

  async function copyRoomCode(): Promise<void> {
    if (room.value === null) return
    const ok = await copyText(room.value.code)
    ui.toast(ok ? `房间码 ${room.value.code} 已复制` : '复制失败,请手动抄录', ok ? 'success' : 'warn')
  }

  function usedUp(d: DungeonBrief): boolean {
    return d.used >= d.max
  }

  function attemptsText(d: DungeonBrief): string {
    return `今日 ${Math.min(d.used, d.max)}/${d.max}`
  }

  function runLabel(d: DungeonBrief): string {
    if (running.value === d.key) return '斗法中……'
    if (usedUp(d)) return '今日已尽 · 明日再探'
    const inRoom = room.value !== null && room.value.dungeon === d.key
    return inRoom ? '与房间同往' : '独行入场'
  }

  async function reload(): Promise<void> {
    try {
      const o = await cloudApi.dungeonOverview()
      dungeons.value = o.dungeons
      maxSize.value = o.maxSize
      room.value = o.room
    } catch {
      // 云不可达时静默
    }
  }

  async function createRoom(): Promise<void> {
    if (roomBusy.value) return
    roomBusy.value = true
    try {
      const r = await cloudApi.dungeonRoomCreate(roomDungeon.value)
      room.value = r.room
      ui.toast(`房间已建 · 房间码 ${r.room.code}`, 'success')
    } catch (e) {
      ui.toast(errText(e, '建房失败'), 'warn')
    } finally {
      roomBusy.value = false
    }
  }

  async function joinRoom(): Promise<void> {
    if (roomBusy.value) return
    roomBusy.value = true
    try {
      const r = await cloudApi.dungeonRoomJoin(joinCode.value.trim())
      room.value = r.room
      joinCode.value = ''
      ui.toast(`已入房 · ${r.room.code}`, 'success')
      if (r.full) ui.toast('房间已满,可开拔', 'info')
    } catch (e) {
      ui.toast(errText(e, '进房失败'), 'warn')
    } finally {
      roomBusy.value = false
    }
  }

  async function leaveRoom(): Promise<void> {
    if (roomBusy.value) return
    roomBusy.value = true
    try {
      await cloudApi.dungeonRoomLeave()
      room.value = null
      ui.toast('已退出房间', 'info')
    } catch (e) {
      ui.toast(errText(e, '退出房间失败'), 'warn')
    } finally {
      roomBusy.value = false
    }
  }

  async function startRun(key: DungeonKey, code: string): Promise<void> {
    if (running.value !== null) return
    running.value = key
    try {
      const r = await cloudApi.dungeonRun(key, code)
      results.value = { ...results.value, [key]: r }
      // 奖励即时入账(数量单位按自身境界折算),随下次云同步落档
      resources.addStone(stoneByTier(tierOfMajor(Math.max(0, player.major)), r.reward.stone))
      resources.addSmall('herb', r.reward.herb)
      await reload()
    } catch (e) {
      ui.toast(errText(e, '开拔失败'), 'warn')
      await reload()
    } finally {
      running.value = null
    }
  }

  function errText(e: unknown, fallback: string): string {
    return e instanceof Error && e.message !== '' ? e.message : fallback
  }

  onMounted(() => {
    void reload()
  })
  onUnmounted(() => {
    unsubWs()
  })
</script>
