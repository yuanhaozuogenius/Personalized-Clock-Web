export const WEEKDAYS = [
  { id: 1, shortName: "一", name: "周一" },
  { id: 2, shortName: "二", name: "周二" },
  { id: 3, shortName: "三", name: "周三" },
  { id: 4, shortName: "四", name: "周四" },
  { id: 5, shortName: "五", name: "周五" },
  { id: 6, shortName: "六", name: "周六" },
  { id: 7, shortName: "日", name: "周日" }
];

const DAY_MS = 86_400_000;
const MAX_DAYS = 10_000;

/** Parses YYYY-MM-DD as a date in the browser's local time zone. */
export function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Formats a local date without converting it to UTC. */
export function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Combines a local calendar day and HH:mm value. */
export function combineDateAndTime(day, time) {
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(day);
  result.setHours(hour, minute, 0, 0);
  return result;
}

function localDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function addCalendarDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function weekdayNumber(date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function validateDayCount(value, message) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DAYS) {
    throw new RangeError(message);
  }
}

/** Returns the user-facing title for a repeat rule. */
export function repeatRuleTitle(rule) {
  switch (rule.type) {
    case "once": return "仅一次";
    case "daily": return "每天";
    case "weekdays": return "工作日";
    case "weekends": return "周末";
    case "selectedWeekdays": {
      const selected = new Set(rule.weekdays ?? []);
      return WEEKDAYS.filter(day => selected.has(day.id)).map(day => day.name).join("、");
    }
    case "specificDates": return `指定 ${rule.dates?.length ?? 0} 天`;
    case "intervalDays": return `每隔 ${rule.days} 天`;
    case "workRest": return `连响 ${rule.workDays} 天，停 ${rule.restDays} 天`;
    default: return "未知规则";
  }
}

/**
 * Calculates future alarm dates strictly after `after` using local calendar days,
 * matching the iOS implementation across daylight-saving boundaries.
 */
export function nextDates(alarm, after = new Date(), count = 4) {
  if (count <= 0) return [];

  const anchor = parseLocalDate(alarm.startDate);
  const rule = alarm.repeatRule;

  if (rule.type === "once") {
    const candidate = combineDateAndTime(anchor, alarm.time);
    return candidate > after ? [candidate] : [];
  }

  if (rule.type === "specificDates") {
    const dates = [...new Set(rule.dates ?? [])]
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort();
    if (!dates.length) throw new RangeError("请至少选择一个日期");
    return dates
      .map(value => combineDateAndTime(parseLocalDate(value), alarm.time))
      .filter(candidate => candidate > after)
      .slice(0, count);
  }

  if (rule.type === "intervalDays") {
    validateDayCount(rule.days, "间隔天数必须在 1 到 10,000 之间");
    const elapsed = localDayNumber(after) - localDayNumber(anchor);
    let cycle = Math.max(0, Math.floor(elapsed / rule.days));
    const result = [];
    while (result.length < count) {
      const candidate = combineDateAndTime(addCalendarDays(anchor, cycle * rule.days), alarm.time);
      if (candidate > after) result.push(candidate);
      cycle += 1;
    }
    return result;
  }

  if (rule.type === "workRest") {
    validateDayCount(rule.workDays, "连续响铃天数必须在 1 到 10,000 之间");
    validateDayCount(rule.restDays, "停止响铃天数必须在 1 到 10,000 之间");
    const cycleDays = rule.workDays + rule.restDays;
    let offset = Math.max(0, localDayNumber(after) - localDayNumber(anchor));
    const result = [];
    while (result.length < count) {
      if (offset % cycleDays < rule.workDays) {
        const candidate = combineDateAndTime(addCalendarDays(anchor, offset), alarm.time);
        if (candidate > after) result.push(candidate);
      }
      offset += 1;
    }
    return result;
  }

  let selected;
  if (rule.type === "daily") selected = new Set(WEEKDAYS.map(day => day.id));
  if (rule.type === "weekdays") selected = new Set([1, 2, 3, 4, 5]);
  if (rule.type === "weekends") selected = new Set([6, 7]);
  if (rule.type === "selectedWeekdays") selected = new Set(rule.weekdays ?? []);
  if (!selected?.size) throw new RangeError("请至少选择一个星期");

  const result = [];
  let day = new Date(after.getFullYear(), after.getMonth(), after.getDate());
  while (result.length < count) {
    if (selected.has(weekdayNumber(day))) {
      const candidate = combineDateAndTime(day, alarm.time);
      if (candidate > after) result.push(candidate);
    }
    day = addCalendarDays(day, 1);
  }
  return result;
}
