import test from "node:test";
import assert from "node:assert/strict";
import { nextDates, repeatRuleTitle, toDateInputValue } from "../recurrence.js";

function alarm(repeatRule, overrides = {}) {
  return {
    time: "07:30",
    startDate: "2026-09-02",
    repeatRule,
    ...overrides
  };
}

test("每隔 X 天从开始日期计算", () => {
  const result = nextDates(
    alarm({ type: "intervalDays", days: 3 }),
    new Date(2026, 8, 3, 8),
    3
  );
  assert.deepEqual(result.map(toDateInputValue), ["2026-09-05", "2026-09-08", "2026-09-11"]);
});

test("上二休二只返回连续响铃区间", () => {
  const result = nextDates(
    alarm({ type: "workRest", workDays: 2, restDays: 2 }),
    new Date(2026, 8, 2, 8),
    5
  );
  assert.deepEqual(
    result.map(toDateInputValue),
    ["2026-09-03", "2026-09-06", "2026-09-07", "2026-09-10", "2026-09-11"]
  );
});

test("工作日跳过周末", () => {
  const result = nextDates(
    alarm({ type: "weekdays" }),
    new Date(2026, 8, 4, 8),
    3
  );
  assert.deepEqual(result.map(toDateInputValue), ["2026-09-07", "2026-09-08", "2026-09-09"]);
});

test("指定星期不能为空", () => {
  assert.throws(
    () => nextDates(alarm({ type: "selectedWeekdays", weekdays: [] }), new Date(2026, 8, 2), 1),
    /至少选择一个星期/
  );
});

test("间隔限制保持为 1 至 10000 天", () => {
  assert.throws(
    () => nextDates(alarm({ type: "intervalDays", days: 10_001 }), new Date(), 1),
    /1 到 10,000/
  );
});

test("规则标题保持一致", () => {
  assert.equal(repeatRuleTitle({ type: "intervalDays", days: 5 }), "每隔 5 天");
  assert.equal(repeatRuleTitle({ type: "workRest", workDays: 1, restDays: 1 }), "连响 1 天，停 1 天");
});
