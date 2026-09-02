import { WEEKDAYS, nextDates, repeatRuleTitle, toDateInputValue } from "./recurrence.js";

const STORAGE_KEY = "personalized-clock.alarms.v1";
const SNOOZE_STORAGE_KEY = "personalized-clock.snoozes.v1";
const PERSONALIZATION_KEY = "personalized-clock.personalization.v1";
const ASSET_DB_NAME = "personalized-clock-assets";
const ASSET_STORE_NAME = "assets";
const MAX_SOUND_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const SOUND_OPTIONS = {
  dawn: {
    title: "晨光",
    description: "渐进和弦",
    cycleMs: 4_200,
    notes: [[523.25, 0, 1.15, .08, "sine"], [659.25, .42, 1.15, .075, "sine"], [783.99, .84, 1.25, .07, "sine"], [1046.5, 1.28, 1.45, .055, "sine"]]
  },
  spring: {
    title: "清泉",
    description: "清亮钟音",
    cycleMs: 3_800,
    notes: [[880, 0, .9, .075, "triangle"], [1174.66, .5, 1.05, .065, "sine"], [987.77, 1.02, 1.2, .06, "triangle"]]
  },
  breeze: {
    title: "微风",
    description: "柔和琶音",
    cycleMs: 4_600,
    notes: [[392, 0, 1.2, .065, "sine"], [493.88, .36, 1.2, .06, "sine"], [587.33, .72, 1.25, .058, "sine"], [739.99, 1.08, 1.35, .052, "sine"], [587.33, 1.5, 1.45, .045, "sine"]]
  },
  classic: {
    title: "经典",
    description: "清晰双音",
    cycleMs: 2_800,
    notes: [[659.25, 0, .5, .11, "sine"], [880, .24, .62, .1, "sine"]]
  }
};

function soundOption(id) {
  if (id === "custom") return { title: "本地音频", description: "自定义文件", cycleMs: 0, notes: [] };
  return SOUND_OPTIONS[id] ?? SOUND_OPTIONS.dawn;
}

function alarmSoundTitle(alarm) {
  return alarm.sound === "custom" ? alarm.soundName || "本地音频" : soundOption(alarm.sound).title;
}

/** Stores user-selected media in IndexedDB so large files do not exceed localStorage limits. */
function openAssetDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("当前浏览器不支持保存本地媒体"));
    const request = indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地媒体存储"));
  });
}

async function assetRequest(mode, action) {
  const database = await openAssetDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = action(database.transaction(ASSET_STORE_NAME, mode).objectStore(ASSET_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("本地媒体存储失败"));
    });
  } finally { database.close(); }
}

const getAsset = id => assetRequest("readonly", store => store.get(id));
const putAsset = asset => assetRequest("readwrite", store => store.put(asset));
const deleteAsset = id => assetRequest("readwrite", store => store.delete(id));
const $ = selector => document.querySelector(selector);
const alarmList = $("#alarm-list");
const alarmCount = $("#alarm-count");
const greetingTitle = $("#greeting-title");
const greetingSymbol = $("#greeting-symbol");
const nextOverview = $(".next-overview");
const nextAlarmTime = $("#next-alarm-time");
const nextAlarmLabel = $("#next-alarm-label");
const addButton = $("#add-alarm");
const dialog = $("#alarm-editor");
const form = $("#alarm-form");
const cancelButton = $("#cancel-edit");
const deleteButton = $("#delete-alarm");
const timeInput = $("#alarm-time");
const labelInput = $("#alarm-label");
const repeatTypeInput = $("#repeat-type");
const startDateInput = $("#start-date");
const startDateRow = $("#start-date-row");
const weekdayFields = $("#weekday-fields");
const weekdayButtons = $("#weekday-buttons");
const specificDateFields = $("#specific-date-fields");
const openDatePickerButton = $("#open-date-picker");
const selectedDateSummary = $("#selected-date-summary");
const intervalFields = $("#interval-fields");
const intervalDaysInput = $("#interval-days");
const workRestFields = $("#work-rest-fields");
const workDaysInput = $("#work-days");
const restDaysInput = $("#rest-days");
const datePreview = $("#date-preview");
const validationMessage = $("#validation-message");
const snoozeEnabledInput = $("#snooze-enabled");
const snoozeMinutesInput = $("#snooze-minutes");
const snoozeMinutesRow = $("#snooze-minutes-row");
const alarmSoundInput = $("#alarm-sound");
const previewSoundButton = $("#preview-sound");
const customSoundFields = $("#custom-sound-fields");
const customSoundFileInput = $("#custom-sound-file");
const customSoundStatus = $("#custom-sound-status");
const datePicker = $("#date-picker");
const cancelDatePickerButton = $("#cancel-date-picker");
const confirmDatePickerButton = $("#confirm-date-picker");
const previousMonthButton = $("#previous-month");
const nextMonthButton = $("#next-month");
const calendarMonthLabel = $("#calendar-month");
const calendarGrid = $("#calendar-grid");
const calendarSelectionStatus = $("#calendar-selection-status");
const customBackground = $("#custom-background");
const openPersonalizationButton = $("#open-personalization");
const personalizationDialog = $("#personalization-dialog");
const closePersonalizationButton = $("#close-personalization");
const backgroundFileInput = $("#background-file");
const backgroundOpacityInput = $("#background-opacity");
const backgroundOpacityValue = $("#background-opacity-value");
const backgroundPreview = $("#background-preview");
const backgroundStatus = $("#background-status");
const removeBackgroundButton = $("#remove-background");

let alarms = loadAlarms();
let pendingSnoozes = loadPendingSnoozes();
let editingID = null;
let editingWeekdays = new Set([1, 2, 3, 4, 5]);
let editingDates = new Set();
let editingSoundAssetID;
let editingSoundName;
let calendarDraftDates = new Set();
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarGesture;
let backgroundObjectURL;
let swipeGesture;
let openSwipeRow;
let suppressCardClick = false;
const SWIPE_REVEAL_PX = 82;

function loadAlarms() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(value)) return [];
    return value.map(alarm => ({
      ...alarm,
      sound: alarm.sound === "custom" && alarm.soundAssetID ? "custom" : SOUND_OPTIONS[alarm.sound] ? alarm.sound : "dawn",
      snoozeEnabled: alarm.snoozeEnabled !== false,
      // Version 1 used a hidden nine-minute default, so migrate it to the visible five-minute default.
      snoozeMinutes: alarm.snoozeMinutes === 9 ? 5 : Math.min(60, Math.max(1, Number(alarm.snoozeMinutes) || 5))
    }));
  } catch { return []; }
}

function saveAlarms() { localStorage.setItem(STORAGE_KEY, JSON.stringify(alarms)); }
function loadPendingSnoozes() {
  try {
    const value = JSON.parse(localStorage.getItem(SNOOZE_STORAGE_KEY));
    return Array.isArray(value) ? value.filter(item => item?.alarm && Number.isFinite(item.dueAt)) : [];
  } catch { return []; }
}
function savePendingSnoozes() { localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(pendingSnoozes)); }
function createID() { return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

function loadPersonalization() {
  try {
    const value = JSON.parse(localStorage.getItem(PERSONALIZATION_KEY));
    return { assetID: value?.assetID, opacity: Math.min(45, Math.max(8, Number(value?.opacity) || 18)) };
  } catch { return { assetID: undefined, opacity: 18 }; }
}

function savePersonalization(value) {
  localStorage.setItem(PERSONALIZATION_KEY, JSON.stringify(value));
}

async function applyPersonalization() {
  const settings = loadPersonalization();
  backgroundOpacityInput.value = settings.opacity;
  backgroundOpacityValue.textContent = `${settings.opacity}%`;
  removeBackgroundButton.disabled = !settings.assetID;
  customBackground.style.opacity = String(settings.opacity / 100);
  backgroundPreview.style.opacity = String(settings.opacity / 100);
  if (backgroundObjectURL) URL.revokeObjectURL(backgroundObjectURL);
  backgroundObjectURL = undefined;
  customBackground.style.backgroundImage = "";
  backgroundPreview.style.backgroundImage = "";
  document.body.classList.remove("has-custom-background");
  if (!settings.assetID) return;
  try {
    const asset = await getAsset(settings.assetID);
    if (!asset?.blob) throw new Error("背景照片已不可用，请重新选择");
    backgroundObjectURL = URL.createObjectURL(asset.blob);
    const image = `url("${backgroundObjectURL}")`;
    customBackground.style.backgroundImage = image;
    backgroundPreview.style.backgroundImage = image;
    document.body.classList.add("has-custom-background");
  } catch (error) {
    backgroundStatus.textContent = error.message || "无法读取背景照片。";
  }
}

function defaultAlarm() {
  const now = new Date(Date.now() + 5 * 60_000);
  return {
    id: createID(),
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    startDate: toDateInputValue(now),
    label: "闹钟",
    sound: "dawn",
    repeatRule: { type: "once" },
    isEnabled: true,
    snoozeEnabled: true,
    snoozeMinutes: 5
  };
}

function escapeHTML(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Updates the greeting and its day/night symbol from the device's local hour. */
function updateGreeting(now = new Date()) {
  const hour = now.getHours();
  const isDay = hour >= 5 && hour < 18;
  greetingTitle.textContent = hour >= 5 && hour < 12 ? "早上好" : hour >= 12 && hour < 18 ? "下午好" : "晚上好";
  greetingSymbol.dataset.period = isDay ? "day" : "night";
}

function nextSummary(alarm) {
  if (!alarm.isEnabled) return "已关闭";
  try {
    const next = nextDates(alarm, new Date(), 1)[0];
    return next ? `下一次：${formatDate(next)}` : "所选时间已经过去";
  } catch (error) { return error.message; }
}

function updateOverview() {
  const enabledCount = alarms.filter(alarm => alarm.isEnabled).length;
  alarmCount.textContent = `${enabledCount} 个已启用`;
  const candidates = alarms.filter(alarm => alarm.isEnabled).flatMap(alarm => {
    try {
      const date = nextDates(alarm, new Date(), 1)[0];
      return date ? [{ alarm, date, snoozed: false }] : [];
    } catch { return []; }
  });
  const pending = pendingSnoozes[0];
  if (pending) candidates.push({ alarm: pending.alarm, date: new Date(pending.dueAt), snoozed: true });
  candidates.sort((left, right) => left.date - right.date);
  const next = candidates[0];
  if (!next) {
    nextOverview.hidden = true;
    nextAlarmTime.textContent = "";
    nextAlarmLabel.textContent = "";
    return;
  }
  nextOverview.hidden = false;
  nextAlarmTime.textContent = next.date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  nextAlarmLabel.textContent = `${next.alarm.label || "闹钟"}${next.snoozed ? " · 稍后提醒" : ""} · ${formatDate(next.date)}`;
}

function render() {
  updateOverview();
  openSwipeRow = undefined;
  swipeGesture = undefined;
  if (!alarms.length) {
    alarmList.innerHTML = `<div class="empty-state"><div class="empty-icon">＋</div><p>还没有闹钟</p><small>点击右上角加号，创建你的第一个自定义闹钟</small></div>`;
    return;
  }
  alarmList.innerHTML = alarms.map(alarm => `
    <div class="alarm-swipe-row" data-id="${escapeHTML(alarm.id)}">
      <button class="swipe-delete" data-action="swipe-delete" type="button" aria-label="删除 ${escapeHTML(alarm.label || "闹钟")}" aria-hidden="true" tabindex="-1">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>
      </button>
      <article class="alarm-card ${alarm.isEnabled ? "" : "disabled"}" data-id="${escapeHTML(alarm.id)}" tabindex="0">
        <div class="alarm-card-copy">
          <p class="alarm-time">${escapeHTML(alarm.time)}</p>
          <p class="alarm-details">${escapeHTML(alarm.label?.trim() || "闹钟")}</p>
          <div class="alarm-tags"><span>${escapeHTML(repeatRuleTitle(alarm.repeatRule))}</span><span>♪ ${escapeHTML(alarmSoundTitle(alarm))}</span>${alarm.snoozeEnabled ? `<span>稍后 ${alarm.snoozeMinutes ?? 5} 分钟</span>` : ""}</div>
        </div>
        <label class="switch" aria-label="启用 ${escapeHTML(alarm.label || "闹钟")}"><input data-action="toggle" type="checkbox" ${alarm.isEnabled ? "checked" : ""}><span></span></label>
        <div class="alarm-next">${escapeHTML(nextSummary(alarm))}</div>
      </article>
    </div>`).join("");
}

function ruleFromForm() {
  switch (repeatTypeInput.value) {
    case "selectedWeekdays": return { type: "selectedWeekdays", weekdays: [...editingWeekdays].sort() };
    case "specificDates": return { type: "specificDates", dates: [...editingDates].sort() };
    case "intervalDays": return { type: "intervalDays", days: Number(intervalDaysInput.value) };
    case "workRest": return { type: "workRest", workDays: Number(workDaysInput.value), restDays: Number(restDaysInput.value) };
    default: return { type: repeatTypeInput.value };
  }
}

function alarmFromForm() {
  const previous = alarms.find(alarm => alarm.id === editingID);
  return {
    id: editingID ?? createID(), time: timeInput.value, startDate: startDateInput.value,
    label: labelInput.value.trim() || "闹钟", sound: alarmSoundInput.value, repeatRule: ruleFromForm(),
    soundAssetID: alarmSoundInput.value === "custom" ? editingSoundAssetID : undefined,
    soundName: alarmSoundInput.value === "custom" ? editingSoundName : undefined,
    isEnabled: previous?.isEnabled ?? true, snoozeEnabled: snoozeEnabledInput.checked,
    snoozeMinutes: Number(snoozeMinutesInput.value)
  };
}

function updateConditionalFields() {
  const type = repeatTypeInput.value;
  startDateRow.hidden = !["once", "intervalDays", "workRest"].includes(type);
  weekdayFields.hidden = type !== "selectedWeekdays";
  specificDateFields.hidden = type !== "specificDates";
  intervalFields.hidden = type !== "intervalDays";
  workRestFields.hidden = type !== "workRest";
  customSoundFields.hidden = alarmSoundInput.value !== "custom";
  selectedDateSummary.textContent = editingDates.size ? `已选 ${editingDates.size} 天` : "尚未选择";
}

function renderWeekdayButtons() {
  weekdayButtons.innerHTML = WEEKDAYS.map(day => `<button class="weekday-button ${editingWeekdays.has(day.id) ? "selected" : ""}" type="button" data-weekday="${day.id}" aria-pressed="${editingWeekdays.has(day.id)}">${day.shortName}</button>`).join("");
}

function updateCalendarSelectionStatus() {
  calendarSelectionStatus.textContent = calendarDraftDates.size ? `已选择 ${calendarDraftDates.size} 个日期` : "尚未选择日期";
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  calendarMonthLabel.textContent = `${year} 年 ${month + 1} 月`;
  const leadingDays = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: leadingDays }, () => '<span class="calendar-spacer"></span>');
  for (let day = 1; day <= dayCount; day += 1) {
    const value = toDateInputValue(new Date(year, month, day));
    const selected = calendarDraftDates.has(value);
    cells.push(`<button type="button" role="gridcell" data-date="${value}" class="calendar-day ${selected ? "selected" : ""}" aria-selected="${selected}">${day}</button>`);
  }
  calendarGrid.innerHTML = cells.join("");
  updateCalendarSelectionStatus();
}

function setCalendarDate(value, shouldSelect) {
  if (!value) return;
  if (shouldSelect) calendarDraftDates.add(value); else calendarDraftDates.delete(value);
  const button = calendarGrid.querySelector(`[data-date="${value}"]`);
  button?.classList.toggle("selected", shouldSelect);
  button?.setAttribute("aria-selected", String(shouldSelect));
  updateCalendarSelectionStatus();
}

function openDatePicker() {
  calendarDraftDates = new Set(editingDates);
  const first = [...calendarDraftDates].sort()[0];
  const initial = first ? new Date(`${first}T00:00:00`) : new Date();
  calendarMonth = new Date(initial.getFullYear(), initial.getMonth(), 1);
  renderCalendar();
  datePicker.showModal();
  datePicker.focus({ preventScroll: true });
}

function updatePreview() {
  try {
    const upcoming = nextDates(alarmFromForm(), new Date(), 4);
    if (!upcoming.length) throw new RangeError("所选时间已经过去");
    datePreview.innerHTML = upcoming.map(date => `<li>${escapeHTML(formatDate(date))}</li>`).join("");
    validationMessage.textContent = "";
    return true;
  } catch (error) {
    datePreview.innerHTML = "";
    validationMessage.textContent = error.message;
    return false;
  }
}

function openEditor(alarm = defaultAlarm()) {
  editingID = alarms.some(item => item.id === alarm.id) ? alarm.id : null;
  timeInput.value = alarm.time; startDateInput.value = alarm.startDate; labelInput.value = alarm.label;
  repeatTypeInput.value = alarm.repeatRule.type;
  alarmSoundInput.value = alarm.sound === "custom" && alarm.soundAssetID ? "custom" : SOUND_OPTIONS[alarm.sound] ? alarm.sound : "dawn";
  editingSoundAssetID = alarm.soundAssetID;
  editingSoundName = alarm.soundName;
  customSoundStatus.textContent = editingSoundName || "支持手机“文件”中的音频，最大 12 MB。";
  editingWeekdays = new Set(alarm.repeatRule.weekdays ?? [1, 2, 3, 4, 5]);
  editingDates = new Set(alarm.repeatRule.dates ?? []);
  intervalDaysInput.value = alarm.repeatRule.days ?? 2;
  workDaysInput.value = alarm.repeatRule.workDays ?? 2; restDaysInput.value = alarm.repeatRule.restDays ?? 2;
  deleteButton.hidden = editingID === null;
  updateConditionalFields(); renderWeekdayButtons(); updatePreview(); dialog.showModal();
  dialog.focus({ preventScroll: true });
}

function closeEditor() { dialog.close(); editingID = null; }
addButton.addEventListener("click", () => openEditor());
cancelButton.addEventListener("click", closeEditor);

/** Removes an alarm and any pending snooze that belongs to it. */
function removeAlarm(alarmID) {
  alarms = alarms.filter(alarm => alarm.id !== alarmID);
  pendingSnoozes = pendingSnoozes.filter(item => item.alarm.id !== alarmID);
  savePendingSnoozes();
  saveAlarms();
  render();
}

function setSwipeRowOpen(row, shouldOpen) {
  if (!row) return;
  if (shouldOpen && openSwipeRow && openSwipeRow !== row) setSwipeRowOpen(openSwipeRow, false);
  row.classList.toggle("swiped", shouldOpen);
  row.style.setProperty("--swipe-x", shouldOpen ? `-${SWIPE_REVEAL_PX}px` : "0px");
  const deleteControl = row.querySelector(".swipe-delete");
  deleteControl.tabIndex = shouldOpen ? 0 : -1;
  deleteControl.setAttribute("aria-hidden", String(!shouldOpen));
  if (shouldOpen) openSwipeRow = row; else if (openSwipeRow === row) openSwipeRow = undefined;
}

alarmList.addEventListener("pointerdown", event => {
  const card = event.target.closest(".alarm-card");
  if (!card || event.pointerType === "mouse" || event.target.closest(".switch, button, a, input, select")) return;
  const row = card.closest(".alarm-swipe-row");
  if (openSwipeRow && openSwipeRow !== row) setSwipeRowOpen(openSwipeRow, false);
  swipeGesture = {
    pointerID: event.pointerId, row, startX: event.clientX, startY: event.clientY,
    baseX: row.classList.contains("swiped") ? -SWIPE_REVEAL_PX : 0,
    currentX: row.classList.contains("swiped") ? -SWIPE_REVEAL_PX : 0,
    horizontal: false, cancelled: false
  };
});

alarmList.addEventListener("pointermove", event => {
  if (!swipeGesture || event.pointerId !== swipeGesture.pointerID || swipeGesture.cancelled) return;
  const deltaX = event.clientX - swipeGesture.startX;
  const deltaY = event.clientY - swipeGesture.startY;
  if (!swipeGesture.horizontal) {
    if (Math.abs(deltaX) < 7 && Math.abs(deltaY) < 7) return;
    if (Math.abs(deltaY) >= Math.abs(deltaX)) { swipeGesture.cancelled = true; return; }
    swipeGesture.horizontal = true;
    swipeGesture.row.classList.add("swiping");
  }
  event.preventDefault();
  swipeGesture.currentX = Math.max(-SWIPE_REVEAL_PX, Math.min(0, swipeGesture.baseX + deltaX));
  swipeGesture.row.style.setProperty("--swipe-x", `${swipeGesture.currentX}px`);
}, { passive: false });

function finishSwipe(event) {
  if (!swipeGesture || event.pointerId !== swipeGesture.pointerID) return;
  if (swipeGesture.horizontal) {
    setSwipeRowOpen(swipeGesture.row, swipeGesture.currentX <= -SWIPE_REVEAL_PX * .55);
    suppressCardClick = true;
    // iOS dispatches a delayed synthetic click after touchend; keep the guard
    // long enough that the revealed delete action does not immediately close.
    setTimeout(() => { suppressCardClick = false; }, 400);
  } else if (!swipeGesture.cancelled) {
    setSwipeRowOpen(swipeGesture.row, swipeGesture.baseX > 0);
  }
  swipeGesture = undefined;
}
alarmList.addEventListener("pointerup", finishSwipe);
alarmList.addEventListener("pointercancel", finishSwipe);

alarmList.addEventListener("change", event => {
  const toggle = event.target.closest('[data-action="toggle"]');
  if (!toggle) return;
  const card = toggle.closest(".alarm-card");
  const alarm = alarms.find(item => item.id === card?.dataset.id);
  if (!alarm) return;
  alarm.isEnabled = toggle.checked;
  saveAlarms();
  render();
  if (alarm.isEnabled) armPageReminders(false).catch(console.error);
});

alarmList.addEventListener("click", event => {
  const deleteControl = event.target.closest('[data-action="swipe-delete"]');
  if (deleteControl) {
    removeAlarm(deleteControl.closest(".alarm-swipe-row").dataset.id);
    return;
  }
  const card = event.target.closest(".alarm-card");
  if (!card || suppressCardClick) return;
  if (event.target.closest(".switch")) return;
  const row = card.closest(".alarm-swipe-row");
  if (row.classList.contains("swiped")) { setSwipeRowOpen(row, false); return; }
  const alarm = alarms.find(item => item.id === card.dataset.id);
  if (!alarm) return;
  openEditor(alarm);
});

document.addEventListener("click", event => {
  if (openSwipeRow && !event.target.closest(".alarm-swipe-row")) setSwipeRowOpen(openSwipeRow, false);
});

alarmList.addEventListener("keydown", event => {
  if (!(["Enter", " "].includes(event.key)) || event.target.matches("input")) return;
  event.preventDefault();
  const alarm = alarms.find(item => item.id === event.target.dataset.id);
  if (alarm) openEditor(alarm);
});

weekdayButtons.addEventListener("click", event => {
  const value = Number(event.target.closest("[data-weekday]")?.dataset.weekday);
  if (!value) return;
  if (editingWeekdays.has(value)) editingWeekdays.delete(value); else editingWeekdays.add(value);
  renderWeekdayButtons(); updatePreview();
});

openDatePickerButton.addEventListener("click", openDatePicker);
cancelDatePickerButton.addEventListener("click", () => datePicker.close());
confirmDatePickerButton.addEventListener("click", () => {
  editingDates = new Set(calendarDraftDates);
  selectedDateSummary.textContent = editingDates.size ? `已选 ${editingDates.size} 天` : "尚未选择";
  datePicker.close();
  updatePreview();
});
previousMonthButton.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});
nextMonthButton.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

calendarGrid.addEventListener("pointerdown", event => {
  const button = event.target.closest("[data-date]");
  if (!button) return;
  event.preventDefault();
  const shouldSelect = !calendarDraftDates.has(button.dataset.date);
  calendarGesture = { pointerID: event.pointerId, shouldSelect, visited: new Set(), lastValue: button.dataset.date };
  calendarGesture.visited.add(button.dataset.date);
  setCalendarDate(button.dataset.date, shouldSelect);
  try { calendarGrid.setPointerCapture?.(event.pointerId); } catch { /* Synthetic and older touch events may not be capturable. */ }
});
calendarGrid.addEventListener("pointermove", event => {
  if (!calendarGesture || event.pointerId !== calendarGesture.pointerID) return;
  event.preventDefault();
  const button = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-date]");
  const value = button?.dataset.date;
  if (!value || value === calendarGesture.lastValue) return;
  const buttons = [...calendarGrid.querySelectorAll("[data-date]")];
  const from = buttons.findIndex(item => item.dataset.date === calendarGesture.lastValue);
  const to = buttons.findIndex(item => item.dataset.date === value);
  if (from >= 0 && to >= 0) {
    const step = from <= to ? 1 : -1;
    for (let index = from + step; index !== to + step; index += step) {
      const crossed = buttons[index].dataset.date;
      if (!calendarGesture.visited.has(crossed)) {
        calendarGesture.visited.add(crossed);
        setCalendarDate(crossed, calendarGesture.shouldSelect);
      }
    }
  }
  calendarGesture.lastValue = value;
});
const finishCalendarGesture = event => {
  if (calendarGesture && event.pointerId === calendarGesture.pointerID) calendarGesture = undefined;
};
calendarGrid.addEventListener("pointerup", finishCalendarGesture);
calendarGrid.addEventListener("pointercancel", finishCalendarGesture);
calendarGrid.addEventListener("click", event => {
  if (event.detail !== 0) return;
  const value = event.target.closest("[data-date]")?.dataset.date;
  if (value) setCalendarDate(value, !calendarDraftDates.has(value));
});

repeatTypeInput.addEventListener("change", () => { updateConditionalFields(); updatePreview(); });
alarmSoundInput.addEventListener("change", () => { updateConditionalFields(); updatePreview(); });
customSoundFileInput.addEventListener("change", async () => {
  const file = customSoundFileInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("audio/")) {
    customSoundStatus.textContent = "请选择有效的音频文件。";
    customSoundFileInput.value = "";
    return;
  }
  if (file.size > MAX_SOUND_BYTES) {
    customSoundStatus.textContent = "音频超过 12 MB，请选择更小的文件。";
    customSoundFileInput.value = "";
    return;
  }
  try {
    const id = `sound-${createID()}`;
    await putAsset({ id, kind: "sound", name: file.name, type: file.type, blob: file });
    editingSoundAssetID = id;
    editingSoundName = file.name;
    customSoundStatus.textContent = `已选择：${file.name}`;
    updatePreview();
  } catch (error) {
    customSoundStatus.textContent = error.message || "无法保存这个音频文件。";
  }
});
[timeInput, startDateInput, intervalDaysInput, workDaysInput, restDaysInput, snoozeMinutesInput].forEach(input => input.addEventListener("input", updatePreview));
snoozeEnabledInput.addEventListener("change", () => { snoozeMinutesRow.hidden = !snoozeEnabledInput.checked; });

form.addEventListener("submit", event => {
  event.preventDefault();
  if (alarmSoundInput.value === "custom" && !editingSoundAssetID) {
    customSoundStatus.textContent = "请先选择一个本地音频文件。";
    customSoundFileInput.focus();
    return;
  }
  if (!form.reportValidity() || !updatePreview()) return;
  const updated = alarmFromForm();
  const index = alarms.findIndex(alarm => alarm.id === editingID);
  if (index >= 0) alarms[index] = updated; else alarms.push(updated);
  saveAlarms(); render();
  armPageReminders(false).catch(console.error);
  closeEditor();
});

deleteButton.addEventListener("click", () => {
  if (!editingID || !window.confirm("确定删除这个闹钟吗？")) return;
  removeAlarm(editingID);
  closeEditor();
});

openPersonalizationButton.addEventListener("click", () => {
  personalizationDialog.showModal();
  personalizationDialog.focus({ preventScroll: true });
});
closePersonalizationButton.addEventListener("click", () => personalizationDialog.close());
backgroundOpacityInput.addEventListener("input", () => {
  const opacity = Number(backgroundOpacityInput.value);
  backgroundOpacityValue.textContent = `${opacity}%`;
  customBackground.style.opacity = String(opacity / 100);
  backgroundPreview.style.opacity = String(opacity / 100);
  const settings = loadPersonalization();
  savePersonalization({ ...settings, opacity });
});
backgroundFileInput.addEventListener("change", async () => {
  const file = backgroundFileInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    backgroundStatus.textContent = "请选择有效的照片文件。";
    backgroundFileInput.value = "";
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    backgroundStatus.textContent = "照片超过 15 MB，请选择更小的文件。";
    backgroundFileInput.value = "";
    return;
  }
  try {
    const assetID = "background-image";
    await putAsset({ id: assetID, kind: "image", name: file.name, type: file.type, blob: file });
    savePersonalization({ assetID, opacity: Number(backgroundOpacityInput.value) });
    backgroundStatus.textContent = `已使用：${file.name}`;
    await applyPersonalization();
  } catch (error) {
    backgroundStatus.textContent = error.message || "无法保存这张照片。";
  }
});
removeBackgroundButton.addEventListener("click", async () => {
  try { await deleteAsset("background-image"); } catch { /* Clearing settings still removes the visible background. */ }
  savePersonalization({ opacity: Number(backgroundOpacityInput.value) });
  backgroundFileInput.value = "";
  backgroundStatus.textContent = "已移除背景照片。";
  await applyPersonalization();
});

updateGreeting();
setInterval(updateGreeting, 60_000);
render();
applyPersonalization();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}

const reminderStatus = $("#reminder-status");
const enableRemindersButton = $("#enable-reminders");
const testReminderButton = $("#test-reminder");
const shareButton = $("#share-app");
const ringingOverlay = $("#ringing-overlay");
const ringingTime = $("#ringing-time");
const ringingLabel = $("#ringing-label");
const ringingSound = $("#ringing-sound");
const stopAlarmButton = $("#stop-alarm");
const snoozeAlarmButton = $("#snooze-alarm");
const snoozeSummary = $("#snooze-summary");
const snoozeStatus = $("#snooze-status");
const cancelSnoozeButton = $("#cancel-snooze");
let audioContext;
let soundTimer;
let customAudioSource;
let activeRingingAlarm;
let remindersEnabled = false;
const firedOccurrences = new Set();

function ensureAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持网页声音");
  audioContext ??= new AudioContextClass();
  return audioContext.resume();
}

/** Plays an original, short synthesized pattern without shipping copyrighted audio files. */
function soundPulse(soundID = "dawn") {
  if (!audioContext) return;
  const pattern = soundOption(soundID);
  const start = audioContext.currentTime + .02;
  for (const [frequency, offset, duration, volume, type] of pattern.notes) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start + offset);
    gain.gain.setValueAtTime(.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(volume, start + offset + .035);
    gain.gain.exponentialRampToValueAtTime(.0001, start + offset + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + duration + .05);
  }
}

function stopCustomAudio() {
  try { customAudioSource?.stop(); } catch { /* The source may already have ended. */ }
  customAudioSource = undefined;
}

async function playCustomAudio(assetID, shouldLoop) {
  if (!assetID) throw new Error("请重新选择本地音频文件");
  const asset = await getAsset(assetID);
  if (!asset?.blob) throw new Error("找不到本地音频，请重新选择文件");
  await ensureAudio();
  const buffer = await audioContext.decodeAudioData(await asset.blob.arrayBuffer());
  stopCustomAudio();
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = shouldLoop;
  source.connect(audioContext.destination);
  source.start();
  customAudioSource = source;
  source.addEventListener("ended", () => { if (customAudioSource === source) customAudioSource = undefined; });
}

async function showWebNotification(alarm) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(alarm.label || "闹钟", {
    body: `${alarm.time} · ${repeatRuleTitle(alarm.repeatRule)} · ${alarmSoundTitle(alarm)}`,
    icon: "icon.svg",
    tag: `alarm-${alarm.id}`,
    renotify: true
  });
}

async function triggerRinging(alarm) {
  activeRingingAlarm = alarm;
  ringingTime.textContent = alarm.time;
  ringingLabel.textContent = alarm.label || "闹钟";
  ringingSound.textContent = alarm.sound === "custom"
    ? `${alarmSoundTitle(alarm)} · 本地音频`
    : `${soundOption(alarm.sound).title} · ${soundOption(alarm.sound).description}`;
  snoozeAlarmButton.hidden = alarm.snoozeEnabled === false;
  snoozeAlarmButton.textContent = `${alarm.snoozeMinutes ?? 5} 分钟后提醒`;
  ringingOverlay.hidden = false;
  try {
    await ensureAudio();
    clearInterval(soundTimer);
    soundTimer = undefined;
    if (alarm.sound === "custom") {
      await playCustomAudio(alarm.soundAssetID, true);
    } else {
      stopCustomAudio();
      soundPulse(alarm.sound);
      soundTimer = setInterval(() => soundPulse(alarm.sound), soundOption(alarm.sound).cycleMs);
    }
  } catch (error) {
    stopCustomAudio();
    soundPulse("dawn");
    clearInterval(soundTimer);
    soundTimer = setInterval(() => soundPulse("dawn"), soundOption("dawn").cycleMs);
    ringingSound.textContent = "本地音频不可用 · 已改用晨光";
    reminderStatus.textContent = `${error.message}，本次已改用内置铃声`;
  }
  showWebNotification(alarm).catch(console.error);
}

function stopRinging() {
  clearInterval(soundTimer);
  soundTimer = undefined;
  stopCustomAudio();
  ringingOverlay.hidden = true;
}

/** Arms local audio from a user gesture; browsers require this again after a page reload. */
async function armPageReminders(requestNotifications) {
  remindersEnabled = true;
  enableRemindersButton.textContent = "已启用";
  enableRemindersButton.dataset.enabled = "true";
  reminderStatus.textContent = "响铃已启用";
  await ensureAudio();
  let notificationsGranted = "Notification" in window && Notification.permission === "granted";
  if (requestNotifications && "Notification" in window && Notification.permission === "default") {
    notificationsGranted = await Notification.requestPermission() === "granted";
  }
  reminderStatus.textContent = notificationsGranted
    ? "响铃和通知已启用"
    : "响铃已启用";
}

function disableReminders() {
  remindersEnabled = false;
  enableRemindersButton.textContent = "启用提醒";
  enableRemindersButton.dataset.enabled = "false";
  reminderStatus.textContent = "提醒未启用";
}

async function enableReminders() {
  if (remindersEnabled) {
    disableReminders();
    return;
  }
  try {
    await armPageReminders(true);
  } catch (error) {
    disableReminders();
    reminderStatus.textContent = error.message;
  }
}

enableRemindersButton.addEventListener("click", enableReminders);
previewSoundButton.addEventListener("click", async () => {
  await armPageReminders(false).catch(() => {});
  try {
    clearInterval(soundTimer);
    if (alarmSoundInput.value === "custom") await playCustomAudio(editingSoundAssetID, false);
    else { stopCustomAudio(); soundPulse(alarmSoundInput.value); }
  } catch (error) {
    customSoundStatus.textContent = error.message || "无法播放这个音频文件。";
    return;
  }
  previewSoundButton.textContent = `正在试听：${alarmSoundInput.value === "custom" ? editingSoundName || "本地音频" : soundOption(alarmSoundInput.value).title}`;
  setTimeout(() => { previewSoundButton.textContent = "试听当前铃声"; }, 1800);
});
testReminderButton.addEventListener("click", async () => {
  await armPageReminders(false).catch(() => {});
  triggerRinging({ id: "test", time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), label: "测试闹钟", sound: "dawn", repeatRule: { type: "once" }, snoozeEnabled: true, snoozeMinutes: 5 });
});
stopAlarmButton.addEventListener("click", stopRinging);
function renderSnoozeSummary() {
  pendingSnoozes.sort((left, right) => left.dueAt - right.dueAt);
  const pending = pendingSnoozes[0];
  snoozeSummary.hidden = !pending;
  updateOverview();
  if (!pending) return;
  const remainingSeconds = Math.max(0, Math.ceil((pending.dueAt - Date.now()) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  const dueTime = new Date(pending.dueAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  snoozeStatus.textContent = `${pending.alarm.label || "闹钟"} · ${dueTime} 再响（${minutes}:${seconds}）`;
}

snoozeAlarmButton.addEventListener("click", () => {
  const alarm = activeRingingAlarm;
  stopRinging();
  if (!alarm || alarm.snoozeEnabled === false) return;
  const minutes = Math.min(60, Math.max(1, Number(alarm.snoozeMinutes) || 5));
  pendingSnoozes = pendingSnoozes.filter(item => item.alarm.id !== alarm.id);
  pendingSnoozes.push({ id: createID(), dueAt: Date.now() + minutes * 60_000, alarm: { ...alarm, snoozeMinutes: minutes } });
  savePendingSnoozes();
  renderSnoozeSummary();
  reminderStatus.textContent = `已稍后提醒，将在 ${minutes} 分钟后再次响铃`;
});

cancelSnoozeButton.addEventListener("click", () => {
  const pending = pendingSnoozes.sort((left, right) => left.dueAt - right.dueAt)[0];
  if (!pending) return;
  pendingSnoozes = pendingSnoozes.filter(item => item.id !== pending.id);
  savePendingSnoozes();
  renderSnoozeSummary();
  reminderStatus.textContent = "已取消稍后提醒";
});

function checkDueAlarms() {
  if (!remindersEnabled || !ringingOverlay.hidden) return;
  const now = new Date();
  const dueSnooze = pendingSnoozes.sort((left, right) => left.dueAt - right.dueAt)[0];
  if (dueSnooze?.dueAt <= now.getTime()) {
    pendingSnoozes = pendingSnoozes.filter(item => item.id !== dueSnooze.id);
    savePendingSnoozes();
    renderSnoozeSummary();
    const dueTime = new Date(dueSnooze.dueAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    triggerRinging({ ...dueSnooze.alarm, time: dueTime });
    return;
  }

  for (const alarm of alarms.filter(item => item.isEnabled)) {
    try {
      const due = nextDates(alarm, new Date(now.getTime() - 65_000), 1)[0];
      if (!due || due > now) continue;
      const key = `${alarm.id}-${due.getTime()}`;
      if (firedOccurrences.has(key)) continue;
      firedOccurrences.add(key);
      triggerRinging(alarm);
      break;
    } catch { /* Invalid alarms are already shown in the editor. */ }
  }
}

renderSnoozeSummary();
setInterval(renderSnoozeSummary, 1_000);
setInterval(checkDueAlarms, 2_000);

document.addEventListener("visibilitychange", () => {
  if (remindersEnabled && document.hidden) reminderStatus.textContent = "页面在后台，响铃可能延迟";
});

shareButton.addEventListener("click", async () => {
  // Share the stable app address without cache-busting query parameters.
  const appUrl = new URL("./", location.href).href;
  const shareData = { title: "个性闹钟", text: "试试支持自定义周期的个性闹钟", url: appUrl };
  if (navigator.share) {
    await navigator.share(shareData).catch(() => {});
  } else {
    await navigator.clipboard.writeText(appUrl);
    shareButton.textContent = "链接已复制";
    setTimeout(() => { shareButton.textContent = "分享"; }, 1600);
  }
});
