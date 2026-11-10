// Chinese words for when a schedule runs (ADR 0055). The core has English ones for the Herder;
// these are only for the 定时任务 page.

import type { SchedulesView } from "@agentherd/host/api";

export type Schedule = SchedulesView["schedules"][number];
export type ScheduleWhen = Schedule["when"];

/** Day 1 is Monday, 7 is Sunday, as in the core. */
const DAY = ["", "一", "二", "三", "四", "五", "六", "日"];

/** 「每天 09:00」「工作日 09:00」「每周一、三 09:00」「每 3 小时」「2026-11-12 09:00 一次」. */
export function whenText(when: ScheduleWhen): string {
  if (when.kind === "every") return `每 ${when.hours} 小时`;
  if (when.kind === "once") return `${when.at} 一次`;
  const days = when.days ?? [];
  if (days.length === 0 || days.length === 7) return `每天 ${when.at}`;
  if (days.join(",") === "1,2,3,4,5") return `工作日 ${when.at}`;
  if (days.join(",") === "6,7") return `周末 ${when.at}`;
  return `每周${days.map((d) => DAY[d] ?? String(d)).join("、")} ${when.at}`;
}

/** 「11月11日 09:00」 in the Mac's local time. */
export function momentText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 「下次：11月11日 09:00」, 「已暂停」, or 「已结束」 for a once schedule that ran. */
export function nextText(schedule: Schedule): string {
  if (schedule.paused) return "已暂停";
  if (schedule.nextAt === undefined) return "已结束";
  return `下次：${momentText(schedule.nextAt)}`;
}
