<template>
  <div class="stagger-in space-y-4 px-4 pb-6 pt-4">
    <SectionTitle title="道友" />

    <div class="grid grid-cols-3 rounded-lg border border-ink/15 p-1">
      <button
        v-for="t in TABS"
        :key="t.id"
        class="rounded-md py-1.5 text-[13px] tracking-[0.2em]"
        :class="tab === t.id ? 'bg-cinnabar text-paper' : 'text-ink-faint'"
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 聊天 -->
    <template v-if="tab === 'chat'">
      <div ref="chatBox" class="card-ink h-96 space-y-2 overflow-y-auto px-3 py-3">
        <p v-if="messages.length === 0" class="text-center text-[12px] text-ink-faint">暂无消息</p>
        <div v-for="(m, i) in messages" :key="m.id ?? `live-${i}`" class="text-[12px] leading-relaxed">
          <span class="text-ink-faint tabular">{{ formatClock(m.at) }}</span>
          <span class="ml-1.5 font-kai" :class="m.self ? 'text-cinnabar' : 'text-azure'">{{ m.self ? '我' : (m.from?.name ?? m.name ?? '') }}</span>
          <span class="ml-1.5 text-ink-soft">{{ m.content }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <input
          v-model.trim="draft"
          maxlength="120"
          placeholder="说点什么"
          class="flex-1 rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
          @keydown.enter="send"
        />
        <button class="btn-ghost !px-4" @click="send">发送</button>
      </div>
      <p class="text-[11px] text-ink-faint">在线 {{ online.length }}</p>
    </template>

    <!-- 好友 -->
    <template v-else-if="tab === 'friends'">
      <div class="card-ink flex gap-2 px-3 py-3">
        <input
          v-model.trim="friendName"
          maxlength="12"
          placeholder="道号"
          class="flex-1 rounded-lg border border-ink/15 bg-paper-deep/60 px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:border-cinnabar/60 focus:outline-none"
        />
        <button class="btn-ghost !px-4" :disabled="adding" @click="addFriend">加好友</button>
      </div>

      <div v-if="friends.incoming.length" class="card-ink space-y-2 px-3 py-3">
        <p class="text-[11px] text-ink-faint">待回应</p>
        <div v-for="r in friends.incoming" :key="r.requestId" class="flex items-center gap-2">
          <span class="flex-1 font-kai text-[14px] text-ink">{{ r.user.name }}</span>
          <button class="btn-ghost !px-3 !text-[12px]" @click="respond(r.requestId, true)">同意</button>
          <button class="btn-ghost !px-3 !text-[12px]" @click="respond(r.requestId, false)">拒绝</button>
        </div>
      </div>

      <div class="card-ink space-y-2 px-3 py-3">
        <p v-if="friends.accepted.length === 0" class="text-center text-[12px] text-ink-faint">暂无道友</p>
        <div v-for="f in friends.accepted" :key="f.id" class="flex items-center gap-2">
          <span class="h-2 w-2 shrink-0 rounded-full" :class="f.online ? 'bg-jade' : 'bg-ink/20'" />
          <span class="font-kai text-[14px] text-ink">{{ f.name }}</span>
          <span class="flex-1 text-[11px] text-ink-faint">{{ f.profile?.realmLabel ?? '' }}</span>
          <button class="btn-ghost !px-3 !text-[12px]" :disabled="dueling === f.id" @click="duel(f.id)">切磋</button>
          <button class="btn-ghost !px-2 !text-[12px] !text-cinnabar" @click="removeFriend(f.id)">删</button>
        </div>
      </div>
    </template>

    <!-- 榜单 -->
    <template v-else>
      <div class="card-ink space-y-2 px-3 py-3">
        <p v-if="board.length === 0" class="text-center text-[12px] text-ink-faint">暂无上榜</p>
        <div v-for="row in board" :key="row.id" class="flex items-center gap-2">
          <span class="w-6 text-center tabular text-[12px]" :class="row.rank <= 3 ? 'text-cinnabar' : 'text-ink-faint'">{{ row.rank }}</span>
          <span class="font-kai text-[14px] text-ink">{{ row.name }}</span>
          <span class="flex-1 text-[11px] text-ink-faint">{{ row.realmLabel }}</span>
          <span class="tabular text-[11px] text-ink-soft">{{ powerLabel(row) }}</span>
          <button v-if="row.id !== auth.userId" class="btn-ghost !px-3 !text-[12px]" :disabled="dueling === row.id" @click="duel(row.id)">切磋</button>
        </div>
      </div>
    </template>

    <BaseModal :open="duelOpen" title="切磋" @close="duelOpen = false">
      <p v-if="duelResult" class="text-[13px] leading-relaxed text-ink-soft">
        {{ duelResult.winner === 'me' ? '胜' : '负' }} · {{ duelResult.rounds }}回合
      </p>
      <div v-if="duelResult" class="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-md bg-paper-deep/60 px-3 py-2">
        <p v-for="(line, i) in duelResult.log" :key="i" class="text-[11px] leading-relaxed text-ink-faint">{{ line }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost w-full" @click="duelOpen = false">知道了</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
  import { nextTick, onUnmounted, ref, watch } from 'vue'
  import SectionTitle from '@/components/common/SectionTitle.vue'
  import BaseModal from '@/components/common/BaseModal.vue'
  import { useAuthStore } from '@/stores/auth'
  import { useUiStore } from '@/stores/ui'
  import {
    cloudApi,
    onCloudWs,
    sendChat,
    type ChatMsg,
    type CloudWsMsg,
    type FriendsData,
    type LeaderRow
  } from '@/services/cloud'
  import { type GNum } from '@/types'
  import { formatClock, formatGN } from '@/utils/format'

  const TABS = [
    { id: 'chat', label: '论道' },
    { id: 'friends', label: '好友' },
    { id: 'board', label: '榜单' }
  ] as const
  type TabId = (typeof TABS)[number]['id']

  const auth = useAuthStore()
  const ui = useUiStore()

  const tab = ref<TabId>('chat')
  const messages = ref<ChatMsg[]>([])
  const online = ref<Array<{ id: number; name: string }>>([])
  const friends = ref<FriendsData>({ incoming: [], outgoing: [], accepted: [] })
  const board = ref<LeaderRow[]>([])
  const draft = ref('')
  const friendName = ref('')
  const adding = ref(false)
  const dueling = ref<number | null>(null)
  const duelOpen = ref(false)
  const duelResult = ref<{ winner: 'me' | 'target'; rounds: number; log: string[] } | null>(null)
  const chatBox = ref<HTMLElement | null>(null)

  function powerLabel(row: LeaderRow): string {
    const p: GNum = { m: row.powerM, e: row.powerE }
    return formatGN(p)
  }

  function scrollToBottom(): void {
    void nextTick(() => {
      if (chatBox.value) chatBox.value.scrollTop = chatBox.value.scrollHeight
    })
  }

  function pushMessage(m: ChatMsg): void {
    messages.value.push(m)
    if (messages.value.length > 200) messages.value.splice(0, messages.value.length - 200)
    scrollToBottom()
  }

  const unsubWs = onCloudWs((msg: CloudWsMsg) => {
    if (msg.type === 'chat') {
      pushMessage({ from: msg.from, content: msg.content, at: msg.at, self: msg.from.id === auth.userId })
    } else if (msg.type === 'presence') {
      online.value = msg.online
    } else if (msg.type === 'friendRequest') {
      ui.toast('收到好友请求', 'info')
      void loadFriends()
    } else if (msg.type === 'friendAccepted') {
      ui.toast('请求已通过', 'success')
      void loadFriends()
    }
  })

  // 首次进页 + 切页时按需拉数据
  async function loadChat(): Promise<void> {
    try {
      const res = await cloudApi.chatHistory()
      messages.value = res.messages.map(m => ({
        id: m.id,
        from: m.user_id !== undefined ? { id: m.user_id, name: m.name ?? '' } : m.from,
        content: m.content,
        at: m.created_at ?? m.at,
        self: m.user_id === auth.userId
      }))
      scrollToBottom()
    } catch {
      // 下次切页重拉
    }
  }

  watch(tab, t => {
    if (t === 'chat') {
      void loadChat()
    } else if (t === 'friends') {
      void loadFriends()
    } else {
      void cloudApi
        .leaderboard()
        .then(res => {
          board.value = res.board
        })
        .catch(() => undefined)
    }
  })

  // 默认 tab 就是「论道」:挂载时必须拉一次历史,否则刷新后只有 WS 增量、旧消息全空
  void loadChat()

  async function loadFriends(): Promise<void> {
    try {
      friends.value = await cloudApi.friends()
    } catch {
      // 下次切页重拉
    }
  }

  function send(): void {
    const text = draft.value
    if (text === '') return
    if (!sendChat(text)) {
      ui.toast('未连接', 'warn')
      return
    }
    draft.value = ''
    // 自己的发言由服务端广播回来,不本地先插(顺序与时间都以服务器为准)
  }

  async function addFriend(): Promise<void> {
    if (friendName.value === '' || adding.value) return
    adding.value = true
    try {
      await cloudApi.friendRequest(friendName.value)
      friendName.value = ''
      await loadFriends()
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '请求失败', 'warn')
    } finally {
      adding.value = false
    }
  }

  async function respond(requestId: number, accept: boolean): Promise<void> {
    try {
      await cloudApi.friendRespond(requestId, accept)
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '请求失败', 'warn')
    }
    await loadFriends()
  }

  async function removeFriend(id: number): Promise<void> {
    try {
      await cloudApi.friendRemove(id)
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '请求失败', 'warn')
    }
    await loadFriends()
  }

  async function duel(targetId: number): Promise<void> {
    if (dueling.value !== null) return
    dueling.value = targetId
    try {
      duelResult.value = await cloudApi.pvp(targetId)
      duelOpen.value = true
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : '请求失败', 'warn')
    } finally {
      dueling.value = null
    }
  }

  // 进入页面默认拉聊天历史
  void loadChat()

  onUnmounted(unsubWs)

</script>
