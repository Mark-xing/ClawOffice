import { TILE_SIZE, MATRIX_EFFECT_DURATION, CharacterState, Direction } from '../types'
import type { Character, Seat, FurnitureInstance, TileType as TileTypeVal, OfficeLayout, PlacedFurniture } from '../types'
import { createCharacter, updateCharacter } from './characters'
import { matrixEffectSeeds } from './matrixEffect'
import { isWalkable, getWalkableTiles, findPath } from '../layout/tileMap'
import {
  createDefaultLayout,
  layoutToTileMap,
  layoutToFurnitureInstances,
  layoutToSeats,
  getBlockedTiles,
} from '../layout/layoutSerializer'
import { getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog'
import {
  PALETTE_COUNT,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  WAITING_BUBBLE_DURATION_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  SPEECH_BUBBLE_DURATION_SEC,
  SPEECH_BUBBLE_MAX_CHARS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  TALK_DURATION_SEC,
} from '../constants'
import type { AgentStatus } from '@office/shared'

/**
 * Bridge between our Zustand store (string agentIds) and the pixel-agents
 * engine (numeric Character.id). Manages the office layout, characters,
 * seat assignments, and matrix effects.
 */
export class OfficeState {
  layout: OfficeLayout
  backgroundImage: HTMLImageElement | null = null
  tileMap: TileTypeVal[][]
  seats: Map<string, Seat>
  blockedTiles: Set<string>
  furniture: FurnitureInstance[]
  walkableTiles: Array<{ col: number; row: number }>
  characters: Map<number, Character> = new Map()
  selectedCharId: number | null = null
  hoveredCharId: number | null = null
  /** Scale factor for characters relative to default map size */
  characterScale = 1
  /** Dirty flag — set to true when scene changes and needs re-render */
  dirty = true
  /** Keep the game loop alive (timers ticking) without forcing a render */
  needsTick = false
  /** Optional callback to wake the game loop from sleep */
  onDirty: (() => void) | null = null

  // ── Cached character list (avoid Array.from each frame) ─────
  private _cachedChars: Character[] = []
  private _charListDirty = true

  /** Mark scene as dirty and wake the render loop if sleeping */
  private markDirty(): void {
    this.dirty = true
    this.onDirty?.()
  }

  // ── Agent ID mapping ──────────────────────────────────────────
  private agentIdToCharId = new Map<string, number>()
  private charIdToAgentId = new Map<number, string>()
  private nextCharId = 1

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout()
    this.tileMap = layoutToTileMap(this.layout)
    this.seats = layoutToSeats(this.layout.furniture)
    this.blockedTiles = getBlockedTiles(this.layout.furniture)
    this.furniture = layoutToFurnitureInstances(this.layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.characterScale = this.computeCharacterScale()
  }

  private computeCharacterScale(): number {
    const defaultSize = Math.max(DEFAULT_COLS, DEFAULT_ROWS)
    const currentSize = Math.max(this.layout.cols, this.layout.rows)
    if (currentSize <= defaultSize) return 1
    return Math.pow(currentSize / defaultSize, 0.75)
  }

  /** Set background image (from room ZIP import) */
  setBackgroundImage(img: HTMLImageElement | null): void {
    this.backgroundImage = img
    this.markDirty()
  }

  /** Hot-replace layout: rebuild tileMap, seats, furniture, reassign characters */
  setLayout(layout: OfficeLayout): void {
    this.layout = layout
    this.tileMap = layoutToTileMap(layout)
    this.characterScale = this.computeCharacterScale()
    this.seats = layoutToSeats(layout.furniture)
    this.blockedTiles = getBlockedTiles(layout.furniture)
    this.furniture = layoutToFurnitureInstances(layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)

    // Reassign characters to seats and relocate to valid positions
    for (const ch of this.characters.values()) {
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) {
          seat.assigned = true
        } else {
          // Old seat no longer exists — try to find a new one
          ch.seatId = null
          const newSeatId = this.findFreeSeat()
          if (newSeatId) {
            const newSeat = this.seats.get(newSeatId)!
            newSeat.assigned = true
            ch.seatId = newSeatId
          }
        }
      }

      // Relocate character to a valid position in the new layout
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)!
        ch.tileCol = seat.seatCol
        ch.tileRow = seat.seatRow
        ch.dir = seat.facingDir
      } else if (this.walkableTiles.length > 0) {
        const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
        ch.tileCol = spawn.col
        ch.tileRow = spawn.row
      }
      ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2
      ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2
      ch.path = []
      ch.moveProgress = 0
    }
    this.rebuildFurnitureInstances()
    this.markDirty()
  }

  // ── Public API (string agentId) ───────────────────────────────

  addCharacter(agentId: string, _name: string, palette?: number, isExternal?: boolean, label?: string, labelColor?: string): void {
    if (this.agentIdToCharId.has(agentId)) return

    const charId = this.nextCharId++
    this.agentIdToCharId.set(agentId, charId)
    this.charIdToAgentId.set(charId, agentId)

    const { palette: pickedPalette, hueShift } = palette !== undefined
      ? { palette, hueShift: 0 }
      : this.pickDiversePalette()

    // All agents start idle and wandering — work seats are assigned only when they become active
    const spawn = this.walkableTiles.length > 0
      ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
      : { col: 1, row: 1 }
    const ch = createCharacter(charId, pickedPalette, null, null, hueShift, CharacterState.IDLE)
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
    ch.tileCol = spawn.col
    ch.tileRow = spawn.row

    // Mark as external if applicable
    if (isExternal) {
      ch.isExternal = true
    }
    if (label) ch.label = label
    if (labelColor) ch.labelColor = labelColor

    // Matrix spawn effect
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()

    this.characters.set(charId, ch)
    this._charListDirty = true
    this.markDirty()
  }

  removeCharacter(agentId: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return

    const ch = this.characters.get(charId)
    if (!ch) return
    if (ch.matrixEffect === 'despawn') return // already despawning

    // Free seat
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId)
      if (seat) seat.assigned = false
    }

    if (this.selectedCharId === charId) this.selectedCharId = null

    // Start despawn animation
    ch.matrixEffect = 'despawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    ch.bubbleType = null
    this.markDirty()
  }

  updateCharacterStatus(agentId: string, status: AgentStatus, keepSeat?: boolean): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    this.markDirty()

    const wasActive = ch.isActive
    const isNowActive = status === 'working' || status === 'waiting_approval'

    ch.isActive = isNowActive

    // Team members always need a seat — assign one if they don't have one yet,
    // regardless of current status. This avoids a race condition where the bridge
    // misses a brief "working" transition (leader finishes delegation in seconds).
    if (keepSeat && !ch.seatId) {
      if (ch.restSeatId) {
        const rs = this.seats.get(ch.restSeatId)
        if (rs) rs.assigned = false
        ch.restSeatId = null
        ch.seatTimer = 0
      }
      const seatId = this.findFreeSeat()
      if (seatId) {
        const seat = this.seats.get(seatId)!
        seat.assigned = true
        ch.seatId = seatId
      }
      this.rebuildFurnitureInstances()
    }

    if (!isNowActive && wasActive) {
      if (keepSeat) {
        // Team member: keep their seat between tasks
      } else {
        // Solo agent: release work seat so others can use it
        if (ch.seatId) {
          const seat = this.seats.get(ch.seatId)
          if (seat) seat.assigned = false
          ch.seatId = null
        }
        ch.seatTimer = -1
        ch.path = []
        ch.moveProgress = 0
      }
      this.rebuildFurnitureInstances()
    } else if (isNowActive && !wasActive) {
      // Just became active — find a free work seat
      if (!ch.seatId) {
        // Release rest seat if sitting on one
        if (ch.restSeatId) {
          const rs = this.seats.get(ch.restSeatId)
          if (rs) rs.assigned = false
          ch.restSeatId = null
          ch.seatTimer = 0
        }
        const seatId = this.findFreeSeat()
        if (seatId) {
          const seat = this.seats.get(seatId)!
          seat.assigned = true
          ch.seatId = seatId
        }
      }
      this.rebuildFurnitureInstances()
    }
  }

  selectCharacter(agentId: string | null): void {
    const prev = this.selectedCharId
    if (agentId === null) {
      this.selectedCharId = null
    } else {
      const charId = this.agentIdToCharId.get(agentId)
      this.selectedCharId = charId ?? null
    }
    if (this.selectedCharId !== prev) this.markDirty()
  }

  showBubble(agentId: string, type: 'permission' | 'working' | 'waiting'): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return

    if (type === 'permission' || type === 'working') {
      ch.bubbleType = type
      ch.bubbleTimer = 0  // persistent, no countdown
    } else {
      ch.bubbleType = 'waiting'
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC
    }
    this.markDirty()
  }

  clearBubble(agentId: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    if (ch.bubbleType === 'permission' || ch.bubbleType === 'working') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    } else if (ch.bubbleType === 'waiting') {
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC)
    }
    this.markDirty()
  }

  showSpeechBubble(agentId: string, text: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    const truncated = text.length > SPEECH_BUBBLE_MAX_CHARS
      ? text.slice(0, SPEECH_BUBBLE_MAX_CHARS) + '...'
      : text
    ch.speechText = truncated
    ch.speechTimer = SPEECH_BUBBLE_DURATION_SEC
    this.markDirty()
  }

  /**
   * Start a face-to-face conversation between two agents.
   * Agent A walks toward Agent B's position. When A arrives at an adjacent tile,
   * both agents face each other and enter TALK state.
   */
  startConversation(fromAgentId: string, toAgentId: string): void {
    const fromCharId = this.agentIdToCharId.get(fromAgentId)
    const toCharId = this.agentIdToCharId.get(toAgentId)
    if (fromCharId === undefined || toCharId === undefined) return
    const fromCh = this.characters.get(fromCharId)
    const toCh = this.characters.get(toCharId)
    if (!fromCh || !toCh) return
    // Don't start if either is already in a conversation or mid-walk to one
    if (fromCh.state === CharacterState.TALK) return
    if (toCh.state === CharacterState.TALK) return
    // Don't interrupt matrix effects
    if (fromCh.matrixEffect || toCh.matrixEffect) return

    // Find a walkable tile near the target (try adjacent first, then 2 tiles away)
    const targetCol = toCh.tileCol
    const targetRow = toCh.tileRow

    // Temporarily unblock seat tiles so we can pathfind near seated agents
    const tempUnblocked: string[] = []
    for (const ch of [fromCh, toCh]) {
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) {
          const key = `${seat.seatCol},${seat.seatRow}`
          if (this.blockedTiles.has(key)) {
            this.blockedTiles.delete(key)
            tempUnblocked.push(key)
          }
        }
      }
    }

    let meetTile: { col: number; row: number } | null = null
    // Search in expanding rings: distance 1, then 2
    for (let dist = 1; dist <= 2 && !meetTile; dist++) {
      const offsets: Array<{ dc: number; dr: number }> = []
      for (let d = -dist; d <= dist; d++) {
        offsets.push({ dc: d, dr: -dist })
        offsets.push({ dc: d, dr: dist })
        if (d !== -dist && d !== dist) {
          offsets.push({ dc: -dist, dr: d })
          offsets.push({ dc: dist, dr: d })
        }
      }
      for (const { dc, dr } of offsets) {
        const nc = targetCol + dc
        const nr = targetRow + dr
        if (nc === fromCh.tileCol && nr === fromCh.tileRow) {
          meetTile = { col: nc, row: nr }
          break
        }
        if (isWalkable(nc, nr, this.tileMap, this.blockedTiles)) {
          meetTile = { col: nc, row: nr }
          break
        }
      }
    }

    // Restore blocked tiles
    for (const key of tempUnblocked) {
      this.blockedTiles.add(key)
    }

    if (!meetTile) return

    // Set up conversation targets
    fromCh.talkTarget = toCharId
    toCh.talkTarget = fromCharId

    // If sender was typing at a seat, save state and stand up
    const fromWasActive = fromCh.isActive

    if (fromCh.tileCol === meetTile.col && fromCh.tileRow === meetTile.row) {
      // Already at meet point — face each other immediately
      this.faceEachOther(fromCh, toCh)
      fromCh.state = CharacterState.TALK
      fromCh.talkTimer = TALK_DURATION_SEC
      fromCh.frame = 0
      fromCh.frameTimer = 0
      toCh.state = CharacterState.TALK
      toCh.talkTimer = TALK_DURATION_SEC
      toCh.frame = 0
      toCh.frameTimer = 0
    } else {
      // Temporarily unblock for pathfinding
      for (const key of tempUnblocked) {
        this.blockedTiles.delete(key)
      }
      const path = findPath(fromCh.tileCol, fromCh.tileRow, meetTile.col, meetTile.row, this.tileMap, this.blockedTiles)
      for (const key of tempUnblocked) {
        this.blockedTiles.add(key)
      }

      if (path.length > 0) {
        fromCh.path = path
        fromCh.moveProgress = 0
        fromCh.state = CharacterState.WALK
        fromCh.frame = 0
        fromCh.frameTimer = 0
      } else {
        // Can't pathfind — just face each other in place
        this.faceEachOther(fromCh, toCh)
        fromCh.state = CharacterState.TALK
        fromCh.talkTimer = TALK_DURATION_SEC
        fromCh.frame = 0
        fromCh.frameTimer = 0
      }
      // Receiver faces sender and waits
      this.faceToward(toCh, fromCh.tileCol, fromCh.tileRow)
      toCh.state = CharacterState.TALK
      toCh.talkTimer = TALK_DURATION_SEC + 3
      toCh.frame = 0
      toCh.frameTimer = 0
    }
    this.markDirty()
  }

  /** Make two characters face each other */
  private faceEachOther(a: Character, b: Character): void {
    this.faceToward(a, b.tileCol, b.tileRow)
    this.faceToward(b, a.tileCol, a.tileRow)
  }

  /** Make a character face toward a tile */
  private faceToward(ch: Character, targetCol: number, targetRow: number): void {
    const dc = targetCol - ch.tileCol
    const dr = targetRow - ch.tileRow
    if (Math.abs(dc) >= Math.abs(dr)) {
      ch.dir = dc > 0 ? Direction.RIGHT : Direction.LEFT
    } else {
      ch.dir = dr > 0 ? Direction.DOWN : Direction.UP
    }
  }

  /** End TALK state for a character and return to normal activity */
  private endTalk(ch: Character): void {
    if (ch.state !== CharacterState.TALK) return
    ch.talkTarget = null
    ch.talkTimer = 0
    ch.state = CharacterState.IDLE
    ch.frame = 0
    ch.frameTimer = 0
    // isActive agents will auto-pathfind to seat in the next IDLE update cycle
  }

  // ── Getters for renderer ──────────────────────────────────────

  getCharacters(): Character[] {
    if (this._charListDirty) {
      this._cachedChars = Array.from(this.characters.values())
      this._charListDirty = false
    }
    return this._cachedChars
  }

  getLayout(): OfficeLayout {
    return this.layout
  }

  getSelectedCharId(): number | null {
    return this.selectedCharId
  }

  getHoveredCharId(): number | null {
    return this.hoveredCharId
  }

  /** Get the string agentId for a character (numeric) id */
  getAgentId(charId: number): string | null {
    return this.charIdToAgentId.get(charId) ?? null
  }

  /** Get character at pixel position (for hit testing). Returns agentId or null. */
  getAgentAtPixel(worldX: number, worldY: number): string | null {
    const s = this.characterScale
    // Iterate characters sorted by descending Y (frontmost first) without allocating a new array
    const chars = this.getCharacters()
    let hitId: string | null = null
    let hitY = -Infinity
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH * s
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH * s
      const top = anchorY - CHARACTER_HIT_HEIGHT * s
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        // Pick the frontmost (highest Y) hit
        if (ch.y > hitY) {
          hitY = ch.y
          hitId = this.charIdToAgentId.get(ch.id) ?? null
        }
      }
    }
    return hitId
  }

  /** Set hovered character by numeric id (for outline rendering) */
  setHoveredCharAtPixel(worldX: number, worldY: number): void {
    const prev = this.hoveredCharId
    const s = this.characterScale
    const chars = this.getCharacters()
    let bestId: number | null = null
    let bestY = -Infinity
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH * s
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH * s
      const top = anchorY - CHARACTER_HIT_HEIGHT * s
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        if (ch.y > bestY) { bestY = ch.y; bestId = ch.id }
      }
    }
    this.hoveredCharId = bestId
    if (this.hoveredCharId !== prev) this.markDirty()
  }

  // ── Update loop ───────────────────────────────────────────────

  update(dt: number): void {
    this.needsTick = false
    const toDelete: number[] = []
    for (const ch of this.characters.values()) {
      // Snapshot visual state before update
      const prevX = ch.x
      const prevY = ch.y
      const prevState = ch.state
      const prevFrame = ch.frame
      const prevDir = ch.dir
      const prevBubble = ch.bubbleType
      const prevSpeech = ch.speechText
      const prevMatrix = ch.matrixEffect
      const prevMatrixTimer = ch.matrixEffectTimer

      // Handle matrix effect animation
      if (ch.matrixEffect) {
        ch.matrixEffectTimer += dt
        if (ch.matrixEffectTimer >= MATRIX_EFFECT_DURATION) {
          if (ch.matrixEffect === 'spawn') {
            ch.matrixEffect = null
            ch.matrixEffectTimer = 0
            ch.matrixEffectSeeds = []
          } else {
            toDelete.push(ch.id)
          }
        }
        // Matrix effect always animates
        this.dirty = true
        continue
      }

      // Active character without a work seat — try to claim one
      if (ch.isActive && !ch.seatId && ch.state === CharacterState.IDLE) {
        const seatId = this.findFreeSeat()
        if (seatId) {
          const seat = this.seats.get(seatId)!
          seat.assigned = true
          ch.seatId = seatId
        }
      }

      // Temporarily unblock own seat so character can pathfind to it
      this.withOwnSeatUnblocked(ch, () =>
        updateCharacter(ch, dt, this.walkableTiles, this.seats, this.tileMap, this.blockedTiles, this.characterScale, () => this.findFreeRestSeat())
      )

      // Tick bubble timer
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null
          ch.bubbleTimer = 0
        }
      }

      // Tick speech bubble timer
      if (ch.speechText) {
        ch.speechTimer -= dt
        if (ch.speechTimer <= 0) {
          ch.speechText = null
          ch.speechTimer = 0
        }
      }

      // Ensure TALK characters face their partner
      if (ch.state === CharacterState.TALK && ch.talkTarget !== null) {
        const partner = this.characters.get(ch.talkTarget)
        if (partner) {
          this.faceToward(ch, partner.tileCol, partner.tileRow)
        }

        // Synchronized exit: a TALK character only exits when BOTH conditions are met:
        // 1. Its own talkTimer has expired
        // 2. Its partner is no longer walking toward it (partner is also in TALK with timer ≤ 0, or partner is gone)
        if (ch.talkTimer <= 0) {
          const partnerDone = !partner ||
            partner.talkTarget !== ch.id ||
            (partner.state === CharacterState.TALK && partner.talkTimer <= 0) ||
            partner.state !== CharacterState.TALK
          if (partnerDone) {
            this.endTalk(ch)
            if (partner && partner.talkTarget === ch.id) {
              this.endTalk(partner)
            }
          }
        }
      }
      // Fallback: catch IDLE with talkTarget (edge case from WALK completion)
      if (ch.state === CharacterState.IDLE && ch.talkTarget !== null) {
        const partner = this.characters.get(ch.talkTarget)
        if (partner) {
          this.faceToward(ch, partner.tileCol, partner.tileRow)
        }
        ch.state = CharacterState.TALK
        ch.talkTimer = TALK_DURATION_SEC
        ch.frame = 0
        ch.frameTimer = 0
      }

      // Mark dirty if anything visual changed
      if (ch.x !== prevX || ch.y !== prevY ||
          ch.state !== prevState || ch.frame !== prevFrame || ch.dir !== prevDir ||
          ch.bubbleType !== prevBubble || ch.speechText !== prevSpeech ||
          ch.matrixEffect !== prevMatrix || ch.matrixEffectTimer !== prevMatrixTimer) {
        this.dirty = true
      }

      // Keep the loop alive (but skip rendering) while any timer is counting down.
      // Without this the loop sleeps and timers never decrement.
      if (!this.needsTick) {
        if ((ch.state === CharacterState.IDLE && (ch.wanderTimer > 0 || ch.seatTimer > 0)) ||
            (ch.state === CharacterState.TYPE && !ch.isActive && ch.seatTimer > 0) ||
            (ch.state === CharacterState.TALK && ch.talkTimer > 0) ||
            (ch.bubbleType === 'waiting' && ch.bubbleTimer > 0) ||
            (ch.speechText && ch.speechTimer > 0)) {
          this.needsTick = true
        }
      }
    }

    // Remove characters that finished despawn
    if (toDelete.length > 0) {
      this.dirty = true
      this._charListDirty = true
    }
    for (const id of toDelete) {
      const agentId = this.charIdToAgentId.get(id)
      this.characters.delete(id)
      if (agentId) {
        this.agentIdToCharId.delete(agentId)
        this.charIdToAgentId.delete(id)
      }
    }
  }

  // ── Test helpers ─────────────────────────────────────────────

  /** Spawn test characters to fill all work seats (for layout testing) */
  spawnTestCharacters(): void {
    // Clear existing test characters
    this.clearTestCharacters()

    let idx = 0
    for (const [uid, seat] of this.seats) {
      if (seat.isRest || seat.assigned) continue
      const agentId = `__test_${idx}`
      const charId = this.nextCharId++
      this.agentIdToCharId.set(agentId, charId)
      this.charIdToAgentId.set(charId, agentId)

      const palette = idx % PALETTE_COUNT
      seat.assigned = true
      const ch = createCharacter(charId, palette, uid, seat, 0, CharacterState.TYPE)
      ch.isActive = true
      this.characters.set(charId, ch)
      idx++
    }
    this._charListDirty = true
    this.rebuildFurnitureInstances()
  }

  /** Remove all test characters */
  clearTestCharacters(): void {
    const toRemove: string[] = []
    for (const [agentId, charId] of this.agentIdToCharId) {
      if (!agentId.startsWith('__test_')) continue
      const ch = this.characters.get(charId)
      if (ch?.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) seat.assigned = false
      }
      this.characters.delete(charId)
      this.charIdToAgentId.delete(charId)
      toRemove.push(agentId)
    }
    for (const id of toRemove) this.agentIdToCharId.delete(id)
    if (toRemove.length > 0) {
      this._charListDirty = true
      this.rebuildFurnitureInstances()
    }
  }

  /** Check if test characters are active */
  hasTestCharacters(): boolean {
    for (const agentId of this.agentIdToCharId.keys()) {
      if (agentId.startsWith('__test_')) return true
    }
    return false
  }


  // ── Private helpers ───────────────────────────────────────────

  private findFreeSeat(): string | null {
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned && !seat.isRest) return uid
    }
    return null
  }

  /** Find a free rest seat (sofa, etc.) for idle characters */
  findFreeRestSeat(): string | null {
    const restSeats = [...this.seats.entries()].filter(([, s]) => s.isRest && !s.assigned)
    if (restSeats.length === 0) return null
    // Pick a random one
    const [uid] = restSeats[Math.floor(Math.random() * restSeats.length)]
    return uid
  }

  private pickDiversePalette(): { palette: number; hueShift: number } {
    const counts = new Array(PALETTE_COUNT).fill(0) as number[]
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue
      counts[ch.palette]++
    }
    const minCount = Math.min(...counts)
    const available: number[] = []
    for (let i = 0; i < PALETTE_COUNT; i++) {
      if (counts[i] === minCount) available.push(i)
    }
    const palette = available[Math.floor(Math.random() * available.length)]
    let hueShift = 0
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG)
    }
    return { palette, hueShift }
  }

  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null
    const seat = this.seats.get(ch.seatId)
    if (!seat) return null
    return `${seat.seatCol},${seat.seatRow}`
  }

  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch)
    // Also unblock rest seat target if character is heading to one
    const restKey = ch.restSeatId ? (() => {
      const rs = this.seats.get(ch.restSeatId!)
      return rs ? `${rs.seatCol},${rs.seatRow}` : null
    })() : null
    if (key) this.blockedTiles.delete(key)
    if (restKey) this.blockedTiles.delete(restKey)
    const result = fn()
    if (key) this.blockedTiles.add(key)
    if (restKey) this.blockedTiles.add(restKey)
    return result
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    const autoOnTiles = new Set<string>()
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue
      const seat = this.seats.get(ch.seatId)
      if (!seat) continue
      const dCol = seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        autoOnTiles.add(`${seat.seatCol + dCol * d},${seat.seatRow + dRow * d}`)
      }
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d
        const baseRow = seat.seatRow + dRow * d
        if (dCol !== 0) {
          autoOnTiles.add(`${baseCol},${baseRow - 1}`)
          autoOnTiles.add(`${baseCol},${baseRow + 1}`)
        } else {
          autoOnTiles.add(`${baseCol - 1},${baseRow}`)
          autoOnTiles.add(`${baseCol + 1},${baseRow}`)
        }
      }
    }

    if (autoOnTiles.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture)
      return
    }

    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type)
      if (!entry) return item
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            const onType = getOnStateType(item.type)
            if (onType !== item.type) {
              return { ...item, type: onType }
            }
            return item
          }
        }
      }
      return item
    })

    this.furniture = layoutToFurnitureInstances(modifiedFurniture)
  }
}
