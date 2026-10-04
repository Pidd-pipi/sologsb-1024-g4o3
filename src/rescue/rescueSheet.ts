import { recalculatePlans } from '../data';
import type { Cue, LightingPlan, Scene } from '../types';

export const RESCUE_ITEM_LIMIT = 30;

export interface RescueSheet {
  title?: string;
  channelReplacements: { from: string; to: string }[];
  items: Record<string, unknown>[];
}

export interface ParsedRescueSheet {
  sheet: RescueSheet;
  errors: string[];
}

export interface RescueView {
  index: number;
  scene: Scene;
  cue: Cue;
  blocked: boolean;
  blockReason?: string;
  order?: number;
  changes: string[];
}

export interface BrokenFollow {
  scene: Scene;
  follower: Cue;
  target?: Cue;
  reason: string;
  blocked: boolean;
  autoCleared: boolean;
}

export interface AffectedCueView {
  scene: Scene;
  cue: Cue;
  reason: string;
  resetToDraft: boolean;
  confirmedLocked: boolean;
  key: string;
}

export interface ChannelHit {
  from: string;
  to: string;
  scene: Scene;
  cue: Cue;
  blocked: boolean;
}

export interface RescuePreview {
  errors: string[];
  views: RescueView[];
  brokenFollows: BrokenFollow[];
  affected: AffectedCueView[];
  channelHits: ChannelHit[];
  writableCount: number;
  blockedCount: number;
  oldPlanDuration: number;
  newPlanDuration: number;
  draftPlan?: LightingPlan;
}

interface ResolvedItem {
  raw: Record<string, unknown>;
  scene: Scene;
  cue: Cue;
  order?: number;
}

const cueKeys = ['brightness', 'fadeIn', 'hold', 'fadeOut', 'channel', 'followCueNumber'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/**
 * 仅做格式解析：结构、字段、取值范围与 30 项上限。
 * 任何一项不通过都拒绝整单，调用方必须放弃写入并允许用户重试。
 */
export function parseRescueSheet(raw: unknown): ParsedRescueSheet {
  const errors: string[] = [];
  const reject = (message: string) => errors.push(message);

  if (!isObject(raw)) {
    return { sheet: { channelReplacements: [], items: [] }, errors: ['救援单必须是 JSON 对象，例如 { "items": [...] }。'] };
  }

  const allowedKeys = new Set(['title', 'items', 'channelReplacements']);
  Object.keys(raw).forEach((key) => {
    if (!allowedKeys.has(key)) reject(`存在无法识别的顶层字段 "${key}"。`);
  });

  if (raw.title !== undefined && typeof raw.title !== 'string') reject('救援单标题 title 必须是字符串。');

  const channelReplacements: { from: string; to: string }[] = [];
  if (raw.channelReplacements !== undefined) {
    if (!Array.isArray(raw.channelReplacements)) {
      reject('channelReplacements 必须是数组。');
    } else {
      raw.channelReplacements.forEach((entry, index) => {
        const prefix = `通道替换第 ${index + 1} 项`;
        if (!isObject(entry)) {
          reject(`${prefix} 必须是对象。`);
          return;
        }
        const from = typeof entry.from === 'string' ? entry.from.trim() : '';
        const to = typeof entry.to === 'string' ? entry.to.trim() : '';
        if (!from) reject(`${prefix} 缺少原通道 from。`);
        if (!to) reject(`${prefix} 缺少新通道 to。`);
        if (from && to && from === to) reject(`${prefix} 原通道与新通道相同。`);
        if (from && to) channelReplacements.push({ from, to });
      });
    }
  }

  const items: Record<string, unknown>[] = [];
  if (!('items' in raw)) {
    reject('救援单缺少 items 数组。');
  } else if (!Array.isArray(raw.items)) {
    reject('items 必须是数组。');
  } else if (raw.items.length === 0) {
    reject('救援单 items 不能为空，至少包含一条调整。');
  } else if (raw.items.length > RESCUE_ITEM_LIMIT) {
    reject(`救援单共 ${raw.items.length} 项，超过 ${RESCUE_ITEM_LIMIT} 项上限，整单拒绝导入。`);
  } else {
    raw.items.forEach((entry, index) => {
      const prefix = `第 ${index + 1} 项`;
      if (!isObject(entry)) {
        reject(`${prefix} 必须是对象。`);
        return;
      }
      items.push(entry);

      if (entry.sceneName !== undefined && typeof entry.sceneName !== 'string') reject(`${prefix} sceneName 必须是字符串。`);
      if (entry.sceneOrder !== undefined && asNumber(entry.sceneOrder) === undefined) reject(`${prefix} sceneOrder 必须是数字。`);
      if (entry.sceneOrder === undefined && entry.sceneName === undefined) reject(`${prefix} 必须提供 sceneName 或 sceneOrder 定位场次。`);

      if (typeof entry.cueNumber !== 'string' || entry.cueNumber.trim() === '') reject(`${prefix} 必须提供字符串类型的 cueNumber 提示编号。`);

      if (entry.order !== undefined) {
        const order = asNumber(entry.order);
        if (order === undefined || !Number.isInteger(order) || order < 1) reject(`${prefix} order 必须是大于等于 1 的整数。`);
      }
      if (entry.channel !== undefined && (typeof entry.channel !== 'string' || entry.channel.trim() === '')) {
        reject(`${prefix} channel 必须是非空字符串。`);
      }
      if (entry.followCueNumber !== undefined && entry.followCueNumber !== null && typeof entry.followCueNumber !== 'string') {
        reject(`${prefix} followCueNumber 必须是提示编号字符串，或用 null 清除跟随。`);
      }

      const ranges: [string, number, number][] = [
        ['brightness', 0, 100],
        ['fadeIn', 0, 9999],
        ['hold', 0, 9999],
        ['fadeOut', 0, 9999]
      ];
      for (const [key, min, max] of ranges) {
        if (entry[key] !== undefined) {
          const value = asNumber(entry[key]);
          if (value === undefined || value < min || value > max) reject(`${prefix} ${key} 必须是 ${min}–${max} 之间的数字。`);
        }
      }

      const touched = cueKeys.some((key) => entry[key] !== undefined);
      if (!touched && entry.order === undefined) reject(`${prefix} 没有任何调整内容（顺序、参数或跟随）。`);
    });
  }

  return {
    sheet: { title: typeof raw.title === 'string' ? raw.title : undefined, channelReplacements, items },
    errors
  };
}

function describeItemChanges(entry: ResolvedItem): string[] {
  const changes: string[] = [];
  const raw = entry.raw;
  if (raw.order !== undefined) changes.push(`顺序调整为第 ${entry.order} 位`);
  if (raw.channel !== undefined) changes.push(`通道改为 ${String(raw.channel).trim()}`);
  if (raw.brightness !== undefined) changes.push(`亮度改为 ${asNumber(raw.brightness)}%`);
  if (raw.fadeIn !== undefined) changes.push(`渐入改为 ${asNumber(raw.fadeIn)}s`);
  if (raw.hold !== undefined) changes.push(`保持改为 ${asNumber(raw.hold)}s`);
  if (raw.fadeOut !== undefined) changes.push(`渐出改为 ${asNumber(raw.fadeOut)}s`);
  if (raw.followCueNumber === null) changes.push('清除跟随关系');
  else if (typeof raw.followCueNumber === 'string') changes.push(`跟随改为 ${raw.followCueNumber.trim()}`);
  return changes;
}

function findScene(plan: LightingPlan, value: unknown, name: unknown): Scene | undefined {
  if (value !== undefined) {
    const order = asNumber(value);
    return plan.scenes.find((scene) => scene.order === order);
  }
  const target = typeof name === 'string' ? name.trim() : '';
  return plan.scenes.find((scene) => scene.name === target);
}

/**
 * 在方案克隆上模拟整单应用，返回对照预览所需的全部结果。
 * errors 非空表示整单拒绝；此时克隆上的任何中间结果都不会被提交。
 */
export function simulateRescueSheet(plan: LightingPlan, sheet: RescueSheet): RescuePreview {
  const errors: string[] = [];
  const oldPlanDuration = (() => {
    const scenes = [...plan.scenes].sort((a, b) => a.order - b.order);
    return scenes.at(-1) ? Math.max(...scenes.flatMap((scene) => scene.cues.map((cue) => cue.endTime ?? 0))) : 0;
  })();

  // 先对原始方案建立跟随关系快照，用来区分“原本就坏”与“本次改坏”。
  // resolved 列表在同一个克隆上完成所有改动，模拟结束后再用原方案时间做跟随复核。

  const resolved: ResolvedItem[] = [];
  const seen = new Set<string>();
  const orderWanted = new Map<string, number[]>();

  sheet.items.forEach((raw, index) => {
    const prefix = `第 ${index + 1} 项`;
    const scene = findScene(plan, raw.sceneOrder, raw.sceneName);
    if (!scene) {
      errors.push(`${prefix} 定位不到场次（${raw.sceneName ? `名称“${String(raw.sceneName)}”` : `顺序 ${String(raw.sceneOrder)}`}），整单拒绝导入。`);
      return;
    }
    const cueNumber = typeof raw.cueNumber === 'string' ? raw.cueNumber.trim() : '';
    const cue = scene.cues.find((item) => item.number === cueNumber);
    if (!cue) {
      errors.push(`${prefix} 场次“${scene.name}”中没有编号为 ${cueNumber} 的提示，整单拒绝导入。`);
      return;
    }
    const key = `${scene.id}:${cue.id}`;
    if (seen.has(key)) {
      errors.push(`${prefix} 提示 ${cueNumber} 在同一救援单中被重复列出，请合并为一项。`);
      return;
    }
    seen.add(key);

    if (raw.followCueNumber !== undefined && raw.followCueNumber !== null) {
      const targetNumber = String(raw.followCueNumber).trim();
      const target = scene.cues.find((item) => item.number === targetNumber);
      if (!target) errors.push(`${prefix} 跟随目标 ${targetNumber} 不在场次“${scene.name}”中。`);
      else if (target.id === cue.id) errors.push(`${prefix} 提示 ${cueNumber} 不能跟随自己。`);
    }

    let order: number | undefined;
    if (raw.order !== undefined) {
      order = asNumber(raw.order);
      const wanted = orderWanted.get(scene.id) ?? [];
      if (order !== undefined && wanted.includes(order)) {
        errors.push(`${prefix} 场次“${scene.name}”内存在多条提示要求第 ${order} 位，目标位置冲突。`);
      }
      if (order !== undefined) wanted.push(order);
      orderWanted.set(scene.id, wanted);
    }

    resolved.push({ raw, scene, cue, order });
  });

  if (errors.length) {
    return failedPreview(errors, oldPlanDuration);
  }

  const draft = structuredClone(plan) as LightingPlan;
  const draftSceneById = new Map<string, Scene>();
  draft.scenes.forEach((scene) => draftSceneById.set(scene.id, scene));
  const draftCueById = new Map<string, Cue>();
  draft.scenes.forEach((scene) => scene.cues.forEach((cue) => draftCueById.set(cue.id, cue)));

  // 冻结场次/已确认提示不可越过：命中的条目整项阻断，不会部分写入。
  const views: RescueView[] = [];
  const blockedKeys = new Set<string>();
  for (const item of resolved) {
    const draftScene = draftSceneById.get(item.scene.id)!;
    const draftCue = draftCueById.get(item.cue.id)!;
    const changes = describeItemChanges({ ...item, scene: draftScene, cue: draftCue });
    const blockedReasons: string[] = [];
    if (draftScene.frozen) blockedReasons.push('场次已冻结');
    if (draftCue.status === 'confirmed') blockedReasons.push('提示已确认');
    const blocked = blockedReasons.length > 0;
    if (blocked) blockedKeys.add(`${item.scene.id}:${item.cue.id}`);
    views.push({
      index: views.length,
      scene: draftScene,
      cue: draftCue,
      blocked,
      blockReason: blocked ? blockedReasons.join('、') : undefined,
      order: item.order,
      changes
    });
  }

  // 全局通道替换：逐条命中展开；冻结场次与已确认提示只列为阻断命中。
  const channelHits: ChannelHit[] = [];
  if (sheet.channelReplacements.length) {
    for (const replacement of sheet.channelReplacements) {
      for (const scene of draft.scenes) {
        for (const cue of scene.cues) {
          if (cue.channel.trim() !== replacement.from) continue;
          const blocked = scene.frozen || cue.status === 'confirmed';
          channelHits.push({ from: replacement.from, to: replacement.to, scene, cue, blocked });
          if (!blocked) cue.channel = replacement.to;
        }
      }
    }
  }

  // 可写入条目：先应用参数与跟随，再统一重排（阻断条目保持原位）。
  for (const item of resolved) {
    if (blockedKeys.has(`${item.scene.id}:${item.cue.id}`)) continue;
    const cue = draftCueById.get(item.cue.id)!;
    const raw = item.raw;
    if (raw.channel !== undefined) cue.channel = String(raw.channel).trim();
    if (raw.brightness !== undefined) cue.brightness = asNumber(raw.brightness)!;
    if (raw.fadeIn !== undefined) cue.fadeIn = asNumber(raw.fadeIn)!;
    if (raw.hold !== undefined) cue.hold = asNumber(raw.hold)!;
    if (raw.fadeOut !== undefined) cue.fadeOut = asNumber(raw.fadeOut)!;
    if (raw.followCueNumber === null) {
      cue.followCueId = '';
    } else if (typeof raw.followCueNumber === 'string') {
      const followNumber = raw.followCueNumber.trim();
      const target = item.scene.cues.find((candidate) => candidate.number === followNumber);
      if (target) cue.followCueId = target.id;
    }
  }

  const movedKeys = new Set<string>();
  for (const item of resolved) {
    if (blockedKeys.has(`${item.scene.id}:${item.cue.id}`) || item.order === undefined) continue;
    const scene = draftSceneById.get(item.scene.id)!;
    const maxPosition = scene.cues.length;
    const wantedIndex = Math.max(0, Math.min(maxPosition - 1, item.order - 1));
    const currentIndex = scene.cues.findIndex((candidate) => candidate.id === item.cue.id);
    if (currentIndex < 0 || currentIndex === wantedIndex) continue;
    const [moved] = scene.cues.splice(currentIndex, 1);
    scene.cues.splice(wantedIndex, 0, moved);
    movedKeys.add(moved.id);
  }

  // 基于原方案判断哪些跟随会在本次改动后失效（原本就坏的不在本次清单内）。
  const validBefore = new Set<string>();
  for (const scene of plan.scenes) {
    for (const cue of scene.cues) {
      if (!cue.followCueId) continue;
      const target = scene.cues.find((item) => item.id === cue.followCueId);
      if (target && (target.startTime ?? 0) < (cue.startTime ?? 0)) validBefore.add(cue.id);
    }
  }

  const brokenFollows: BrokenFollow[] = [];
  const movedScenes = new Set<string>();
  movedKeys.forEach((cueId) => {
    for (const scene of draft.scenes) {
      if (scene.cues.some((cue) => cue.id === cueId)) movedScenes.add(scene.id);
    }
  });
  // 参数/通道改动也可能改变结束时间，所有含可写条目的场次都参与跟随复核。
  for (const item of resolved) {
    if (!blockedKeys.has(`${item.scene.id}:${item.cue.id}`)) movedScenes.add(item.scene.id);
  }

  recalculatePlans([draft]);

  for (const scene of draft.scenes) {
    if (!movedScenes.has(scene.id)) continue;
    for (const cue of scene.cues) {
      if (!cue.followCueId) continue;
      const target = scene.cues.find((item) => item.id === cue.followCueId);
      const wasValid = validBefore.has(cue.id);
      const reason = !target
        ? `跟随目标已不存在（原目标 ${cue.followCueId}）`
        : (target.startTime ?? 0) >= (cue.startTime ?? 0)
          ? `跟随目标 ${target.number} 将在其之后才完成，顺序已失效`
          : '';
      if (!reason || !wasValid) continue;

      const blocked = scene.frozen || cue.status === 'confirmed';
      brokenFollows.push({
        scene,
        follower: cue,
        target,
        reason,
        blocked,
        autoCleared: !blocked
      });
      if (!blocked) cue.followCueId = '';
    }
  }

  // 清除失效跟随后再次重算，保证写入结果与预览时间一致。
  if (brokenFollows.some((item) => !item.blocked)) recalculatePlans([draft]);

  // 相关提示：时间发生变化的未确认提示退回未完成；已确认/冻结仅登记为受影响、不被改写。
  const timingById = new Map<string, { start: number; end: number }>();
  for (const scene of plan.scenes) {
    for (const cue of scene.cues) timingById.set(cue.id, { start: cue.startTime ?? 0, end: cue.endTime ?? 0 });
  }

  const affectedMap = new Map<string, AffectedCueView>();
  const addAffected = (scene: Scene, cue: Cue, reason: string, forceReset = false) => {
    const key = `${scene.id}:${cue.id}`;
    const resetToDraft = forceReset || (!scene.frozen && cue.status !== 'confirmed');
    const previous = affectedMap.get(key);
    if (previous) {
      if (resetToDraft && !previous.resetToDraft) previous.resetToDraft = true;
      if (!previous.reason.includes(reason)) previous.reason = `${previous.reason}、${reason}`;
      return;
    }
    affectedMap.set(key, {
      scene,
      cue,
      reason,
      resetToDraft,
      confirmedLocked: scene.frozen || cue.status === 'confirmed',
      key
    });
  };

  for (const item of brokenFollows) {
    addAffected(item.scene, item.follower, item.blocked ? '跟随失效但受保护，需人工处理' : '失效跟随已解除并退回未完成', true);
  }
  for (const hit of channelHits) {
    addAffected(hit.scene, hit.cue, hit.blocked ? '通道替换命中但受保护' : '通道替换生效');
  }
  for (const item of resolved) {
    if (blockedKeys.has(`${item.scene.id}:${item.cue.id}`)) continue;
    const cue = draftCueById.get(item.cue.id)!;
    const scene = draftSceneById.get(item.scene.id)!;
    // 救援单直接命中的提示：参数/顺序/跟随一旦改动，一律退回未完成等待复核。
    addAffected(scene, cue, '救援单参数写入', true);
    const timing = timingById.get(cue.id);
    if (timing && (timing.start !== (cue.startTime ?? 0) || timing.end !== (cue.endTime ?? 0))) {
      addAffected(scene, cue, '时间随参数/顺序重算');
    }
  }
  // 下游联动：可写入场次中时间被动变化的提示同样退回未完成。
  for (const scene of draft.scenes) {
    for (const cue of scene.cues) {
      const timing = timingById.get(cue.id);
      if (!timing) continue;
      if (timing.start !== (cue.startTime ?? 0) || timing.end !== (cue.endTime ?? 0)) {
        const directlyTouched = resolved.some((item) => item.scene.id === scene.id && item.cue.id === cue.id && !blockedKeys.has(`${scene.id}:${cue.id}`));
        if (!directlyTouched) addAffected(scene, cue, '同场次时间联动变化');
      }
    }
  }

  const affected = [...affectedMap.values()].sort((a, b) => {
    if (a.scene.order !== b.scene.order) return a.scene.order - b.scene.order;
    return (a.cue.startTime ?? 0) - (b.cue.startTime ?? 0);
  });

  for (const item of affected) {
    if (item.resetToDraft && !item.confirmedLocked) item.cue.status = 'draft';
  }

  recalculatePlans([draft]);

  const scenesSorted = [...draft.scenes].sort((a, b) => a.order - b.order);
  const newPlanDuration = Math.max(0, ...scenesSorted.flatMap((scene) => scene.cues.map((cue) => cue.endTime ?? 0)));

  return {
    errors: [],
    views,
    brokenFollows,
    affected,
    channelHits,
    writableCount: views.filter((view) => !view.blocked).length,
    blockedCount: views.filter((view) => view.blocked).length,
    oldPlanDuration,
    newPlanDuration,
    draftPlan: draft
  };
}

function failedPreview(errors: string[], oldPlanDuration: number): RescuePreview {
  return {
    errors,
    views: [],
    brokenFollows: [],
    affected: [],
    channelHits: [],
    writableCount: 0,
    blockedCount: 0,
    oldPlanDuration,
    newPlanDuration: oldPlanDuration
  };
}

export function parseRescueSheetText(text: string): ParsedRescueSheet {
  try {
    const json = JSON.parse(text) as unknown;
    return parseRescueSheet(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sheet: { channelReplacements: [], items: [] },
      errors: [`JSON 解析失败：${message}。请检查逗号、引号与括号，原方案未做任何改动。`]
    };
  }
}
