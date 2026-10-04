import { detectConflicts, recalculatePlans } from './data';
import type { Cue, CueConflict, LightingPlan, Scene, UserRole, Workspace } from './types';

export const RESCUE_ITEM_LIMIT = 30;

const STRING_FIELDS = ['number', 'label', 'position', 'channel', 'color', 'colorHex', 'targetNote', 'notes'] as const;
type StringField = (typeof STRING_FIELDS)[number];
const NUMBER_FIELDS = ['brightness', 'fadeIn', 'hold', 'fadeOut'] as const;
type NumberField = (typeof NUMBER_FIELDS)[number];

const FIELD_LABELS: Record<string, string> = {
  number: '提示编号',
  label: '提示名称',
  position: '灯位',
  channel: '通道',
  color: '颜色',
  colorHex: '色值',
  brightness: '亮度',
  fadeIn: '渐入',
  hold: '保持',
  fadeOut: '渐出',
  followCueId: '跟随目标',
  targetNote: '触发点',
  notes: '备注'
};

const FIELD_UNITS: Record<string, string> = {
  brightness: '%',
  fadeIn: 's',
  hold: 's',
  fadeOut: 's'
};

export const SAMPLE_RESCUE_SHEET = JSON.stringify(
  {
    title: '联排后紧急救援单',
    issuedBy: '灯光组',
    items: [
      { type: 'cue', scene: '序章 · 入梦', cue: 'Q3', brightness: 80, fadeIn: 3.5 },
      { type: 'cue', scene: '群舞 · 潮汐', cue: 'Q21', hold: 20 },
      { type: 'channel', from: 'Grand Master', to: 'Master Bus' },
      { type: 'reorder', scene: '独白 · 失语', order: ['Q11', 'Q10', 'Q12', 'Q13'] }
    ]
  },
  null,
  2
);

export interface RescueFieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface RescueCueChange {
  cueId: string;
  number: string;
  label: string;
  fields: RescueFieldChange[];
}

export interface RescueAppliedGroup {
  entryIndex: number;
  kind: 'cue' | 'channel' | 'reorder';
  title: string;
  sceneName: string;
  cueChanges: RescueCueChange[];
  newOrder?: string[];
}

export interface RescueBlockedItem {
  entryIndex: number;
  target: string;
  reason: string;
}

export interface RescueNotice {
  entryIndex: number;
  message: string;
}

export interface RescueFollowBreak {
  cueId: string;
  sceneName: string;
  cue: string;
  target: string;
  reason: string;
}

export interface RescueAffectedCue {
  sceneId: string;
  sceneName: string;
  cueId: string;
  number: string;
  label: string;
  reasons: string[];
}

export interface RescuePreview {
  title: string;
  issuedBy: string;
  itemCount: number;
  next: Workspace;
  appliedGroups: RescueAppliedGroup[];
  blocked: RescueBlockedItem[];
  notices: RescueNotice[];
  brokenFollows: RescueFollowBreak[];
  affected: RescueAffectedCue[];
  durationBefore: number;
  durationAfter: number;
  conflictsBefore: CueConflict[];
  conflictsAfter: CueConflict[];
  newConflicts: CueConflict[];
  resolvedConflictCount: number;
}

export type RescueParseResult = { ok: true; preview: RescuePreview } | { ok: false; errors: string[] };

type ParsedEntry =
  | { kind: 'cue'; index: number; scene: Scene; cue: Cue; patch: Partial<Cue> }
  | { kind: 'channel'; index: number; scenes: Scene[]; from: string; to: string }
  | { kind: 'reorder'; index: number; scene: Scene; orderedIds: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cueRef(scene: Scene, ref: string): Cue | undefined {
  return scene.cues.find((item) => item.id === ref) ?? scene.cues.find((item) => item.number === ref);
}

function resolveScene(plan: LightingPlan, ref: string): Scene | undefined {
  const matches = plan.scenes.filter((scene) => scene.id === ref || scene.name === ref);
  return matches.length === 1 ? matches[0] : undefined;
}

function findCueAcrossPlan(plan: LightingPlan, ref: string): { scene: Scene; cue: Cue }[] {
  const found: { scene: Scene; cue: Cue }[] = [];
  for (const scene of plan.scenes) {
    const cue = cueRef(scene, ref);
    if (cue) found.push({ scene, cue });
  }
  return found;
}

function planTotal(plan: LightingPlan): number {
  return Math.max(0, ...plan.scenes.flatMap((scene) => scene.cues.map((cue) => cue.endTime ?? 0)));
}

function brokenFollowMap(plan: LightingPlan): Map<string, { target: Cue }> {
  const broken = new Map<string, { target: Cue }>();
  for (const scene of plan.scenes) {
    for (const cue of scene.cues) {
      if (!cue.followCueId) continue;
      const target = scene.cues.find((item) => item.id === cue.followCueId);
      if (target && (target.startTime ?? 0) >= (cue.startTime ?? 0)) {
        broken.set(cue.id, { target });
      }
    }
  }
  return broken;
}

function formatValue(field: string, value: unknown, scene: Scene): string {
  if (field === 'followCueId') {
    if (!value) return '不跟随，按顺序触发';
    const target = scene.cues.find((item) => item.id === value);
    return target ? `${target.number} · ${target.label}` : String(value);
  }
  if (value === '') return '（清空）';
  return `${String(value)}${FIELD_UNITS[field] ?? ''}`;
}

/**
 * 解析救援单并在工作区副本上模拟全部改动。
 * 格式问题整体拒绝；冻结场次 / 已确认提示 / 角色限制在应用阶段拦截，不写入。
 */
export function parseRescueSheet(rawText: string, workspace: Workspace): RescueParseResult {
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      return { ok: false, errors: [`JSON 格式有误，无法解析：${error instanceof Error ? error.message : String(error)}`] };
    }
    if (!isObject(parsed)) return { ok: false, errors: ['救援单必须是 JSON 对象，包含 items 数组。'] };

    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : '未命名救援单';
    const issuedBy = typeof parsed.issuedBy === 'string' ? parsed.issuedBy.trim() : '';
    const items = parsed.items;
    if (!Array.isArray(items)) return { ok: false, errors: ['缺少 items 数组，救援单无法识别。'] };
    if (items.length === 0) return { ok: false, errors: ['救援单没有任何条目。'] };
    if (items.length > RESCUE_ITEM_LIMIT) {
      return {
        ok: false,
        errors: [`救援单共 ${items.length} 项，超过 ${RESCUE_ITEM_LIMIT} 项上限，已整体拒绝导入。请拆分为多张救援单后重试。`]
      };
    }

    const plan = workspace.plans.find((item) => item.id === workspace.activePlanId) ?? workspace.plans[0];
    if (!plan) return { ok: false, errors: ['当前没有可导入的灯光方案。'] };

    const errors: string[] = [];
    const channelFroms = new Set<string>();
    const parsedEntries: ParsedEntry[] = [];

    items.forEach((rawEntry, entryIndex) => {
      const where = `第 ${entryIndex + 1} 项`;
      if (!isObject(rawEntry)) {
        errors.push(`${where}：必须是 JSON 对象。`);
        return;
      }
      const type = rawEntry.type;
      if (type !== 'cue' && type !== 'channel' && type !== 'reorder') {
        errors.push(`${where}：type 必须是 cue、channel 或 reorder。`);
        return;
      }
      if ('status' in rawEntry) {
        errors.push(`${where}：救援单不允许直接修改执行状态；受影响提示会由系统统一退回未完成。`);
        return;
      }

      if (type === 'channel') {
        const from = typeof rawEntry.from === 'string' ? rawEntry.from.trim() : '';
        const to = typeof rawEntry.to === 'string' ? rawEntry.to.trim() : '';
        if (!from || !to) {
          errors.push(`${where}：通道替换必须包含非空的 from 与 to。`);
          return;
        }
        if (from === to) {
          errors.push(`${where}：通道替换的 from 与 to 不能相同（${from}）。`);
          return;
        }
        if (channelFroms.has(from)) {
          errors.push(`${where}：通道 ${from} 在救援单中出现了多次替换，目标不唯一。`);
          return;
        }
        channelFroms.add(from);
        let scenes = plan.scenes;
        const sceneRef = rawEntry.sceneId ?? rawEntry.scene;
        if (sceneRef !== undefined) {
          if (typeof sceneRef !== 'string' || !sceneRef.trim()) {
            errors.push(`${where}：场次标识必须是字符串。`);
            return;
          }
          const scene = resolveScene(plan, sceneRef.trim());
          if (!scene) {
            errors.push(`${where}：找不到场次「${sceneRef}」。`);
            return;
          }
          scenes = [scene];
        }
        parsedEntries.push({ kind: 'channel', index: entryIndex + 1, scenes, from, to });
        return;
      }

      const sceneRef = rawEntry.sceneId ?? rawEntry.scene;
      let scene: Scene | undefined;
      if (sceneRef !== undefined) {
        if (typeof sceneRef !== 'string' || !sceneRef.trim()) {
          errors.push(`${where}：场次标识必须是字符串。`);
          return;
        }
        scene = resolveScene(plan, sceneRef.trim());
        if (!scene) {
          errors.push(`${where}：找不到场次「${sceneRef}」。`);
          return;
        }
      }

      if (type === 'reorder') {
        if (!scene) {
          errors.push(`${where}：顺序调整必须指定 scene 或 sceneId。`);
          return;
        }
        const order = rawEntry.order;
        if (!Array.isArray(order) || !order.length) {
          errors.push(`${where}：order 必须是提示编号或 ID 的数组。`);
          return;
        }
        if (order.some((ref) => typeof ref !== 'string' || !ref.trim())) {
          errors.push(`${where}：order 中每一项都必须是提示编号或 ID。`);
          return;
        }
        const orderedIds: string[] = [];
        for (const ref of order as string[]) {
          const target = cueRef(scene, ref.trim());
          if (!target) {
            errors.push(`${where}：场次「${scene.name}」中找不到提示「${ref}」。`);
          } else if (orderedIds.includes(target.id)) {
            errors.push(`${where}：提示 ${target.number} 在 order 中重复。`);
          } else {
            orderedIds.push(target.id);
          }
        }
        const sceneIds = new Set(scene.cues.map((cue) => cue.id));
        const missing = scene.cues.filter((cue) => !orderedIds.includes(cue.id)).map((cue) => cue.number);
        const extra = orderedIds.filter((id) => !sceneIds.has(id));
        if (missing.length) errors.push(`${where}：order 缺少该场次的提示 ${missing.join('、')}。`);
        if (extra.length) errors.push(`${where}：order 包含不属于该场次的提示。`);
        // 存在格式问题时最终会整体拒绝；这里先按已解析的 ID 入栈即可。
        parsedEntries.push({ kind: 'reorder', index: entryIndex + 1, scene, orderedIds });
        return;
      }

      // type === 'cue'
      const cueRefValue = rawEntry.cueId ?? rawEntry.cue;
      if (typeof cueRefValue !== 'string' || !cueRefValue.trim()) {
        errors.push(`${where}：提示调整必须包含 cueId 或 cue（提示编号）。`);
        return;
      }
      let targetCue: Cue | undefined;
      if (scene) {
        targetCue = cueRef(scene, cueRefValue.trim());
        if (!targetCue) errors.push(`${where}：场次「${scene.name}」中找不到提示「${cueRefValue}」。`);
      } else {
        const matches = findCueAcrossPlan(plan, cueRefValue.trim());
        if (matches.length === 0) {
          errors.push(`${where}：当前方案找不到提示「${cueRefValue}」，请补充 scene 字段。`);
          return;
        }
        if (matches.length > 1) {
          errors.push(`${where}：提示编号「${cueRefValue}」在多个场次出现，必须用 scene 或 cueId 明确指定。`);
          return;
        }
        scene = matches[0].scene;
        targetCue = matches[0].cue;
      }
      if (!targetCue || !scene) return;

      const patch: Partial<Cue> = {};
      let fieldCount = 0;
      let fieldError = false;
      for (const field of STRING_FIELDS) {
        if (!(field in rawEntry)) continue;
        const value = rawEntry[field];
        if (typeof value !== 'string') {
          errors.push(`${where}：${FIELD_LABELS[field]}必须是文本。`);
          fieldError = true;
          continue;
        }
        if (field === 'number' && !value.trim()) {
          errors.push(`${where}：提示编号不能为空白。`);
          fieldError = true;
          continue;
        }
        if (field === 'colorHex' && !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
          errors.push(`${where}：色值必须是 #RRGGBB 形式（例如 #0EA5E9）。`);
          fieldError = true;
          continue;
        }
        patch[field] = field === 'colorHex' ? value.trim() : value;
        fieldCount += 1;
      }
      for (const field of NUMBER_FIELDS) {
        if (!(field in rawEntry)) continue;
        const value = rawEntry[field];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`${where}：${FIELD_LABELS[field]}必须是数字。`);
          fieldError = true;
          continue;
        }
        if (field === 'brightness' && (value < 0 || value > 100)) {
          errors.push(`${where}：亮度必须在 0–100 之间。`);
          fieldError = true;
          continue;
        }
        if (field !== 'brightness' && value < 0) {
          errors.push(`${where}：${FIELD_LABELS[field]}时间不能为负。`);
          fieldError = true;
          continue;
        }
        patch[field] = value;
        fieldCount += 1;
      }
      const followValue = (rawEntry.follow ?? rawEntry.followCueId) as unknown;
      if (rawEntry.follow !== undefined || rawEntry.followCueId !== undefined) {
        if (typeof followValue !== 'string') {
          errors.push(`${where}：跟随目标必须是提示编号、ID 或空字符串。`);
          fieldError = true;
        } else if (followValue.trim()) {
          const followTarget = cueRef(scene, followValue.trim());
          if (!followTarget) {
            errors.push(`${where}：跟随目标「${followValue}」不在同一场次「${scene.name}」中。`);
            fieldError = true;
          } else if (followTarget.id === targetCue.id) {
            errors.push(`${where}：提示不能跟随自身。`);
            fieldError = true;
          } else {
            patch.followCueId = followTarget.id;
            fieldCount += 1;
          }
        } else {
          patch.followCueId = '';
          fieldCount += 1;
        }
      }
      if (fieldError) return;
      if (fieldCount === 0) {
        errors.push(`${where}：没有任何可应用的提示参数字段。`);
        return;
      }
      parsedEntries.push({ kind: 'cue', index: entryIndex + 1, scene, cue: targetCue, patch });
    });

    if (errors.length) return { ok: false, errors };

    // ---- 在工作区副本上模拟应用，供舞台监督对照确认 ----
    const next: Workspace = structuredClone(workspace);
    const nextPlan = next.plans.find((item) => item.id === plan.id)!;
    const nextSceneById = new Map(nextPlan.scenes.map((scene) => [scene.id, scene]));

    const appliedGroups: RescueAppliedGroup[] = [];
    const blocked: RescueBlockedItem[] = [];
    const notices: RescueNotice[] = [];
    const seeds = new Map<string, Set<string>>();
    const seedReasons = new Map<string, Set<string>>();

    function markSeed(sceneId: string, cueId: string, reason: string) {
      if (!seeds.has(sceneId)) seeds.set(sceneId, new Set());
      seeds.get(sceneId)!.add(cueId);
      const key = `${sceneId}:${cueId}`;
      if (!seedReasons.has(key)) seedReasons.set(key, new Set());
      seedReasons.get(key)!.add(reason);
    }

    for (const entry of parsedEntries) {
      if (entry.kind === 'cue') {
        const scene = nextSceneById.get(entry.scene.id)!;
        const cue = scene.cues.find((item) => item.id === entry.cue.id)!;
        if (scene.frozen) {
          blocked.push({ entryIndex: entry.index, target: `${cue.number} ${cue.label}`, reason: `场次「${scene.name}」已冻结，参数不可越过冻结修改。` });
          continue;
        }
        if (cue.status === 'confirmed') {
          blocked.push({ entryIndex: entry.index, target: `${cue.number} ${cue.label}`, reason: '提示已确认，确认状态不允许救援单直接覆盖。' });
          continue;
        }
        const fields: RescueFieldChange[] = [];
        for (const [field, value] of Object.entries(entry.patch)) {
          fields.push({
            field,
            label: FIELD_LABELS[field] ?? field,
            from: formatValue(field, cue[field as keyof Cue], scene),
            to: formatValue(field, value, scene)
          });
          (cue as unknown as Record<string, unknown>)[field] = value;
        }
        appliedGroups.push({
          entryIndex: entry.index,
          kind: 'cue',
          title: `调整提示 ${cue.number} 参数`,
          sceneName: scene.name,
          cueChanges: [{ cueId: cue.id, number: cue.number, label: cue.label, fields }]
        });
        markSeed(scene.id, cue.id, '直接修改');
        continue;
      }

      if (entry.kind === 'channel') {
        const cueChanges: RescueCueChange[] = [];
        let matched = 0;
        for (const sourceScene of entry.scenes) {
          const scene = nextSceneById.get(sourceScene.id)!;
          for (const cue of scene.cues) {
            if (cue.channel !== entry.from) continue;
            matched += 1;
            if (scene.frozen) {
              blocked.push({ entryIndex: entry.index, target: `${cue.number} ${cue.label}（${entry.from}）`, reason: `场次「${scene.name}」已冻结，通道替换被跳过。` });
              continue;
            }
            if (cue.status === 'confirmed') {
              blocked.push({ entryIndex: entry.index, target: `${cue.number} ${cue.label}（${entry.from}）`, reason: '提示已确认，通道替换被跳过。' });
              continue;
            }
            const fields: RescueFieldChange[] = [{ field: 'channel', label: '通道', from: entry.from, to: entry.to }];
            cue.channel = entry.to;
            cueChanges.push({ cueId: cue.id, number: cue.number, label: cue.label, fields });
            markSeed(scene.id, cue.id, '通道替换');
          }
        }
        if (matched === 0) {
          notices.push({ entryIndex: entry.index, message: `没有提示使用通道 ${entry.from}，该替换无需应用。` });
        }
        if (cueChanges.length) {
          appliedGroups.push({
            entryIndex: entry.index,
            kind: 'channel',
            title: `通道替换 ${entry.from} → ${entry.to}`,
            sceneName: entry.scenes.length === 1 ? entry.scenes[0].name : '全场次范围',
            cueChanges
          });
        }
        continue;
      }

      // reorder
      const scene = nextSceneById.get(entry.scene.id)!;
      if (scene.frozen) {
        blocked.push({ entryIndex: entry.index, target: `场次「${scene.name}」顺序调整`, reason: '场次已冻结，提示顺序保持只读。' });
        continue;
      }
      const confirmed = scene.cues.filter((cue) => cue.status === 'confirmed');
      if (confirmed.length) {
        blocked.push({
          entryIndex: entry.index,
          target: `场次「${scene.name}」顺序调整`,
          reason: `含已确认提示 ${confirmed.map((cue) => cue.number).join('、')}，顺序调整不能越过已确认提示。`
        });
        continue;
      }
      const byId = new Map(scene.cues.map((cue) => [cue.id, cue]));
      scene.cues = entry.orderedIds.map((id) => byId.get(id)!);
      for (const cue of scene.cues) markSeed(scene.id, cue.id, '顺序调整');
      appliedGroups.push({
        entryIndex: entry.index,
        kind: 'reorder',
        title: `重排「${scene.name}」提示顺序`,
        sceneName: scene.name,
        cueChanges: [],
        newOrder: scene.cues.map((cue) => cue.number)
      });
    }

    // 跟随连带：跟随目标被改动 / 顺序调整的未确认提示，沿跟随链传递退回未完成
    let changed = true;
    while (changed) {
      changed = false;
      for (const scene of nextPlan.scenes) {
        const set = seeds.get(scene.id);
        if (!set) continue;
        for (const cue of scene.cues) {
          if (cue.status === 'confirmed' || !cue.followCueId || set.has(cue.id)) continue;
          if (set.has(cue.followCueId)) {
            markSeed(scene.id, cue.id, '跟随连带');
            changed = true;
          }
        }
      }
    }
    for (const scene of nextPlan.scenes) {
      const set = seeds.get(scene.id);
      if (!set) continue;
      for (const cue of scene.cues) {
        if (set.has(cue.id) && cue.status !== 'confirmed') cue.status = 'draft';
      }
    }

    const durationBefore = planTotal(plan);
    const conflictsBefore = detectConflicts(workspace.plans).filter((item) => item.planId === plan.id);
    const brokenBefore = brokenFollowMap(plan);

    // 重排后数组顺序已变，需丢弃旧时间再重算，避免后移的跟随目标被沿用上一次 endTime。
    for (const scene of nextPlan.scenes) {
      for (const cue of scene.cues) {
        cue.startTime = undefined;
        cue.duration = undefined;
        cue.endTime = undefined;
      }
    }
    recalculatePlans(next.plans);
    const durationAfter = planTotal(nextPlan);
    const conflictsAfter = detectConflicts(next.plans).filter((item) => item.planId === nextPlan.id);
    const brokenAfter = brokenFollowMap(nextPlan);

    const brokenFollows: RescueFollowBreak[] = [];
    for (const scene of nextPlan.scenes) {
      for (const cue of scene.cues) {
        if (cue.followCueId && brokenAfter.has(cue.id) && !brokenBefore.has(cue.id)) {
          const target = brokenAfter.get(cue.id)!.target;
          brokenFollows.push({
            cueId: cue.id,
            sceneName: scene.name,
            cue: `${cue.number} ${cue.label}`,
            target: `${target.number} ${target.label}`,
            reason: '调整后跟随目标不再先于本提示完成，跟随时序失效。'
          });
        }
      }
    }

    const beforeIds = new Set(conflictsBefore.map((item) => item.id));
    const afterIds = new Set(conflictsAfter.map((item) => item.id));
    const newConflicts = conflictsAfter.filter((item) => !beforeIds.has(item.id));
    const resolvedConflictCount = conflictsBefore.filter((item) => !afterIds.has(item.id)).length;

    const affected: RescueAffectedCue[] = [];
    for (const scene of nextPlan.scenes) {
      const set = seeds.get(scene.id);
      if (!set) continue;
      for (const cue of scene.cues) {
        if (!set.has(cue.id)) continue;
        affected.push({
          sceneId: scene.id,
          sceneName: scene.name,
          cueId: cue.id,
          number: cue.number,
          label: cue.label,
          reasons: [...(seedReasons.get(`${scene.id}:${cue.id}`) ?? [])]
        });
      }
    }

    return {
      ok: true,
      preview: {
        title,
        issuedBy,
        itemCount: items.length,
        next,
        appliedGroups,
        blocked,
        notices,
        brokenFollows,
        affected,
        durationBefore,
        durationAfter,
        conflictsBefore,
        conflictsAfter,
        newConflicts,
        resolvedConflictCount
      }
    };
  } catch (error) {
    return { ok: false, errors: [`救援单处理失败：${error instanceof Error ? error.message : String(error)}。原方案未改动，可修改后重试。`] };
  }
}

export function canConfirmRescue(role: UserRole): boolean {
  return role === 'stage-manager' || role === 'designer';
}
