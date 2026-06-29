"use strict";

const STORAGE_KEY = "dayPlannerPwa.v1";
const APP_VERSION = "20260630c";
const DAY_MS = 24 * 60 * 60 * 1000;

const app = document.getElementById("app");
const modalRoot = document.getElementById("modal-root");
const toastRoot = document.getElementById("toast-root");

const TYPE_META = {
  task: { label: "Задача", color: "#5b9cff", icon: "check" },
  habit: { label: "Привычка", color: "#63c59b", icon: "leaf" },
  routine: { label: "Рутина", color: "#efb753", icon: "repeat" },
  event: { label: "Событие", color: "#a997ff", icon: "calendar" },
  rest: { label: "Отдых", color: "#62c8df", icon: "pause" },
  sleep: { label: "Сон", color: "#7e8aa8", icon: "moon" }
};

const COLORS = ["#5b9cff", "#63c59b", "#efb753", "#a997ff", "#ff8c74", "#62c8df", "#7e8aa8"];
const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const WEEKDAY_VALUES = [0, 1, 2, 3, 4, 5, 6];

const SECTION_META = [
  { id: "night", label: "Ночь", from: 0, to: 6 * 60, color: "#7e8aa8" },
  { id: "morning", label: "Утро", from: 6 * 60, to: 12 * 60, color: "#efb753" },
  { id: "day", label: "День", from: 12 * 60, to: 18 * 60, color: "#5b9cff" },
  { id: "evening", label: "Вечер", from: 18 * 60, to: 24 * 60, color: "#a997ff" }
];

const defaultState = () => ({
  version: APP_VERSION,
  activeView: "day",
  selectedDate: todayKey(),
  setupComplete: false,
  settings: {
    userName: "",
    theme: "light",
    wakeRules: [{ from: "1970-01-01", time: "09:00" }],
    sleepRules: [{ from: "1970-01-01", time: "01:00" }],
    routineOverrides: {},
    hiddenSystem: {}
  },
  items: [],
  habits: [],
  habitCompletions: {},
  templates: [],
  dayOrder: {}
});

let state = defaultState();
let draggingId = null;
let toastTimer = null;
let appEventsBound = false;

document.addEventListener("DOMContentLoaded", initApp);

function initApp() {
  state = loadFromStorage();
  seedDemoDataIfEmpty();
  renderApp();
  registerServiceWorker();
  if (!state.setupComplete) {
    setTimeout(openSetupModal, 180);
  }
}

function renderApp() {
  const title = getViewTitle();
  const subtitle = formatLongDate(state.selectedDate);

  app.className = "app-shell";
  app.innerHTML = `
    <header class="app-header">
      <div class="header-row">
        <div class="header-copy">
          <span class="eyebrow">${escapeHtml(getGreeting())}</span>
          <h1>${escapeHtml(title)}</h1>
        </div>
        <button class="today-chip" type="button" data-action="go-today">${escapeHtml(subtitle)}</button>
      </div>
    </header>
    <main class="view-root" id="viewRoot">
      ${renderCurrentView()}
    </main>
    ${state.activeView === "day" ? `<button class="fab" type="button" data-action="new-item" aria-label="Добавить">${icon("plus")}</button>` : ""}
    ${renderBottomNav()}
  `;

  bindAppEvents();
  if (state.activeView === "day") {
    centerSelectedDate();
    handleDragAndDrop();
  }
}

function renderCurrentView() {
  if (state.activeView === "habits") return renderHabits();
  if (state.activeView === "templates") return renderTemplates();
  if (state.activeView === "settings") return renderSettings();
  return `
    ${renderCalendarStrip()}
    <div class="quick-actions">
      <button class="secondary-button" type="button" data-action="copy-day">${icon("copy")}Копировать</button>
      <button class="secondary-button" type="button" data-action="save-template">${icon("archive")}Шаблон</button>
    </div>
    ${renderDaySchedule()}
  `;
}

function renderCalendarStrip() {
  const selected = parseDateKey(state.selectedDate);
  const days = [];
  for (let offset = -14; offset <= 14; offset += 1) {
    const date = addDays(selected, offset);
    const key = dateKey(date);
    days.push(`
      <button class="date-pill ${key === state.selectedDate ? "is-selected" : ""} ${key === todayKey() ? "is-today" : ""}"
        type="button"
        data-action="select-date"
        data-date="${key}"
        aria-label="${escapeHtml(formatLongDate(key))}">
        <span>${WEEKDAYS[date.getDay()]}</span>
        <strong>${date.getDate()}</strong>
      </button>
    `);
  }
  return `<div class="calendar-strip" id="calendarStrip">${days.join("")}</div>`;
}

function renderDaySchedule() {
  const schedule = getScheduleForDate(state.selectedDate);
  if (!schedule.length) {
    return `
      <section class="empty-state">
        <div>
          <strong>День свободен</strong>
          <span>Добавьте первый блок</span>
        </div>
      </section>
    `;
  }

  let previousSection = "";
  const cards = schedule.map((item) => {
    const section = getDaySection(item.startTime);
    const heading = section.id !== previousSection
      ? `<div class="period-title" style="--period-color:${section.color}">${section.label}</div>`
      : "";
    previousSection = section.id;
    return `${heading}${renderScheduleItem(item)}`;
  });

  return `<section class="schedule-stack" id="scheduleList">${cards.join("")}</section>`;
}

function renderScheduleItem(item) {
  const meta = TYPE_META[item.type] || TYPE_META.task;
  const endTime = addMinutesToTime(item.startTime, item.duration);
  const completed = item.kind === "habit" && isHabitCompleted(item.sourceId, state.selectedDate);
  const systemLabel = item.kind === "system" ? `<span class="meta-pill">постоянно</span>` : "";
  const repeatLabel = item.repeat && item.repeat.mode !== "none" ? `<span class="meta-pill">${escapeHtml(repeatLabelFor(item.repeat))}</span>` : "";

  return `
    <article class="schedule-card"
      draggable="true"
      data-instance-id="${escapeHtml(item.instanceId)}"
      data-kind="${escapeHtml(item.kind)}"
      style="--item-color:${escapeHtml(item.color || meta.color)}">
      <div class="time-box">
        <strong>${escapeHtml(item.startTime)}</strong>
        <span>${escapeHtml(endTime)} · ${escapeHtml(formatDuration(item.duration))}</span>
      </div>
      <div class="item-main">
        <div class="item-title-row">
          <span class="item-dot">${icon(item.icon || meta.icon)}</span>
          <span class="item-title">${escapeHtml(item.title)}</span>
        </div>
        <div class="item-meta">
          <span class="meta-pill">${escapeHtml(meta.label)}</span>
          ${systemLabel}
          ${repeatLabel}
        </div>
      </div>
      <div class="item-controls">
        ${item.kind === "habit" ? `<button class="complete-button ${completed ? "is-done" : ""}" type="button" data-action="toggle-habit" data-habit-id="${escapeHtml(item.sourceId)}" aria-label="Выполнено">${icon("check")}</button>` : ""}
        <button class="mini-button" type="button" data-action="edit-item" data-instance-id="${escapeHtml(item.instanceId)}" aria-label="Редактировать">${icon("edit")}</button>
        <button class="mini-button" type="button" data-action="delete-item" data-instance-id="${escapeHtml(item.instanceId)}" aria-label="Удалить">${icon("trash")}</button>
        <button class="drag-handle" type="button" aria-label="Перетащить">${icon("grip")}</button>
      </div>
    </article>
  `;
}

function openItemModal(item = null, options = {}) {
  const draft = normalizeModalDraft(item, options);
  const isSystem = draft.kind === "system";
  const isEdit = Boolean(item);
  const title = isEdit ? "Изменить блок" : "Новый блок";
  const repeat = draft.repeat || { mode: "none", days: [] };

  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="itemModalTitle" data-modal="item">
        <div class="modal-grabber"></div>
        <div class="modal-header">
          <h2 id="itemModalTitle">${title}</h2>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="Закрыть">${icon("x")}</button>
        </div>
        <form class="modal-body" id="itemForm">
          <input type="hidden" name="instanceId" value="${escapeHtml(draft.instanceId || "")}">
          <input type="hidden" name="kind" value="${escapeHtml(draft.kind || "item")}">
          <input type="hidden" name="systemType" value="${escapeHtml(draft.systemType || "")}">
          <div class="form-grid">
            <label class="field full">
              <span>Название</span>
              <input name="title" value="${escapeHtml(draft.title)}" ${isSystem ? "readonly" : ""} required maxlength="80">
            </label>
            <label class="field">
              <span>Дата</span>
              <input name="date" type="date" value="${escapeHtml(draft.date)}" required>
            </label>
            <label class="field">
              <span>Начало</span>
              <input name="startTime" type="time" value="${escapeHtml(draft.startTime)}" required>
            </label>
            <label class="field">
              <span>Длительность</span>
              <input name="duration" type="number" min="5" max="1440" step="5" value="${Number(draft.duration) || 30}" required>
            </label>
            <label class="field">
              <span>Тип</span>
              <select name="type" ${isSystem ? "disabled" : ""}>
                ${Object.entries(TYPE_META).map(([key, meta]) => `<option value="${key}" ${draft.type === key ? "selected" : ""}>${meta.label}</option>`).join("")}
              </select>
            </label>
            <label class="field full">
              <span>Иконка</span>
              <select name="icon" ${isSystem ? "disabled" : ""}>
                ${["check", "leaf", "repeat", "calendar", "pause", "moon", "sun", "book", "dumbbell", "coffee", "spark"].map((name) => `<option value="${name}" ${draft.icon === name ? "selected" : ""}>${iconName(name)}</option>`).join("")}
              </select>
            </label>
            <div class="field full">
              <span class="fieldset-label">Цвет</span>
              <div class="chips-row" data-color-picker>
                ${COLORS.map((color) => `<button class="swatch ${sameColor(draft.color, color) ? "is-selected" : ""}" style="--swatch:${color}" type="button" data-action="pick-color" data-color="${color}" aria-label="${color}"></button>`).join("")}
              </div>
              <input type="hidden" name="color" value="${escapeHtml(draft.color)}">
            </div>
            ${isSystem ? renderSystemScopeField(draft) : renderRepeatFields(repeat)}
          </div>
          <div class="modal-actions">
            ${isEdit ? `<button class="danger-button" type="button" data-action="delete-from-modal">${isSystem ? "Скрыть" : "Удалить"}</button>` : `<button class="secondary-button" type="button" data-action="close-modal">Отмена</button>`}
            <button class="primary-button" type="submit">${isEdit ? "Сохранить" : "Добавить"}</button>
          </div>
        </form>
      </section>
    </div>
  `;

  bindModalEvents();
}

function saveItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const kind = data.kind || "item";
  const type = data.type || form.querySelector("[name='type']")?.value || "task";
  const repeat = collectRepeatFromForm(form);
  const payload = {
    title: cleanText(data.title || "Новый блок"),
    date: data.date || state.selectedDate,
    startTime: data.startTime || "09:00",
    duration: clamp(Number(data.duration) || 30, 5, 1440),
    type,
    color: data.color || TYPE_META[type]?.color || TYPE_META.task.color,
    icon: data.icon || TYPE_META[type]?.icon || "check",
    repeat
  };

  if (kind === "system") {
    saveSystemRoutine(data.systemType, payload.date, payload.startTime, data.systemScope);
    state.selectedDate = payload.date;
    closeModal();
    showToast("Время обновлено");
    renderApp();
    return;
  }

  if (kind === "habit") {
    const habit = state.habits.find((entry) => entry.id === parseInstanceId(data.instanceId).sourceId);
    if (habit) {
      Object.assign(habit, payload, { repeat: normalizeRepeat(repeat) });
    }
    state.selectedDate = payload.date;
    saveToStorage();
    closeModal();
    renderApp();
    return;
  }

  const parsed = parseInstanceId(data.instanceId);
  const existing = state.items.find((entry) => entry.id === parsed.sourceId);
  if (existing) {
    Object.assign(existing, payload, { repeat: normalizeRepeat(repeat) });
  } else if (payload.type === "habit" || payload.repeat.mode !== "none") {
    createHabit(payload);
  } else {
    state.items.push({
      id: createId("item"),
      createdAt: new Date().toISOString(),
      ...payload,
      repeat: { mode: "none", days: [] }
    });
  }

  state.selectedDate = payload.date;
  saveToStorage();
  closeModal();
  renderApp();
}

function deleteItem(instanceId = null) {
  const id = instanceId || modalRoot.querySelector("[name='instanceId']")?.value;
  const parsed = parseInstanceId(id);
  if (!id) return;

  if (parsed.kind === "system") {
    const hidden = state.settings.hiddenSystem[state.selectedDate] || {};
    hidden[parsed.systemType] = true;
    state.settings.hiddenSystem[state.selectedDate] = hidden;
    showToast("Блок скрыт на выбранный день");
  } else if (parsed.kind === "habit") {
    state.habits = state.habits.filter((habit) => habit.id !== parsed.sourceId);
    Object.values(state.habitCompletions).forEach((day) => delete day[parsed.sourceId]);
  } else {
    state.items = state.items.filter((item) => item.id !== parsed.sourceId);
  }

  state.dayOrder[state.selectedDate] = (state.dayOrder[state.selectedDate] || []).filter((entry) => entry !== id);
  saveToStorage();
  closeModal();
  renderApp();
}

function handleDragAndDrop() {
  const list = document.getElementById("scheduleList");
  if (!list) return;

  list.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".schedule-card");
    if (!card) return;
    draggingId = card.dataset.instanceId;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggingId);
  });

  list.addEventListener("dragover", (event) => {
    event.preventDefault();
    const card = document.querySelector(".schedule-card.is-dragging");
    if (!card) return;
    const after = getDragAfterElement(list, event.clientY);
    if (after == null) {
      list.appendChild(card);
    } else {
      list.insertBefore(card, after);
    }
  });

  list.addEventListener("dragend", () => finishDragOrder(list));

  let pointerDrag = null;
  list.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".drag-handle");
    if (!handle) return;
    const card = handle.closest(".schedule-card");
    pointerDrag = {
      card,
      id: card.dataset.instanceId,
      startedAt: performance.now(),
      originalOrder: getDomOrder(list)
    };
    card.setPointerCapture?.(event.pointerId);
    card.classList.add("is-touch-dragging");
  });

  list.addEventListener("pointermove", (event) => {
    if (!pointerDrag) return;
    event.preventDefault();
    const after = getDragAfterElement(list, event.clientY);
    if (after == null) {
      list.appendChild(pointerDrag.card);
    } else if (after !== pointerDrag.card) {
      list.insertBefore(pointerDrag.card, after);
    }
  });

  list.addEventListener("pointerup", () => {
    if (!pointerDrag) return;
    pointerDrag.card.classList.remove("is-touch-dragging");
    finishDragOrder(list, pointerDrag.originalOrder);
    pointerDrag = null;
  });

  list.addEventListener("pointercancel", () => {
    if (!pointerDrag) return;
    pointerDrag.card.classList.remove("is-touch-dragging");
    pointerDrag = null;
  });
}

function createHabit(data) {
  const habit = {
    id: createId("habit"),
    createdAt: new Date().toISOString(),
    title: cleanText(data.title || "Новая привычка"),
    date: data.date || state.selectedDate,
    startTime: data.startTime || "09:00",
    duration: clamp(Number(data.duration) || 20, 5, 1440),
    type: data.type || "habit",
    color: data.color || TYPE_META.habit.color,
    icon: data.icon || "leaf",
    repeat: normalizeRepeat(data.repeat || { mode: "daily", days: [] }),
    active: true
  };
  state.habits.push(habit);
  return habit;
}

function renderHabits() {
  const habits = [...state.habits].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  const list = habits.length
    ? habits.map((habit) => `
      <article class="habit-card" style="--item-color:${escapeHtml(habit.color)}">
        <div class="card-row">
          <div class="card-title-group">
            <span class="item-dot">${icon(habit.icon || "leaf")}</span>
            <div>
              <h3>${escapeHtml(habit.title)}</h3>
              <p>${escapeHtml(habit.startTime)} · ${escapeHtml(formatDuration(habit.duration))} · ${escapeHtml(repeatLabelFor(habit.repeat))}</p>
            </div>
          </div>
          <button class="complete-button ${isHabitCompleted(habit.id, state.selectedDate) ? "is-done" : ""}" type="button" data-action="toggle-habit" data-habit-id="${escapeHtml(habit.id)}" aria-label="Выполнено">${icon("check")}</button>
        </div>
        <div class="habit-actions">
          <button class="secondary-button" type="button" data-action="edit-habit" data-habit-id="${escapeHtml(habit.id)}">${icon("edit")}Изменить</button>
          <button class="danger-button" type="button" data-action="delete-habit" data-habit-id="${escapeHtml(habit.id)}">${icon("trash")}Удалить</button>
        </div>
      </article>
    `).join("")
    : `<section class="empty-state"><div><strong>Привычек пока нет</strong><span>Добавьте первую</span></div></section>`;

  return `
    <section class="view-heading">
      <div>
        <h2>Привычки</h2>
        <p>${escapeHtml(formatLongDate(state.selectedDate))}</p>
      </div>
      <button class="icon-button" type="button" data-action="new-habit" aria-label="Добавить привычку">${icon("plus")}</button>
    </section>
    <div class="panel-list">${list}</div>
  `;
}

function renderTemplates() {
  const templates = state.templates;
  const list = templates.length
    ? templates.map((template) => `
      <article class="template-card">
        <div class="card-row">
          <div class="card-title-group">
            <span class="item-dot">${icon("archive")}</span>
            <div>
              <h3>${escapeHtml(template.name)}</h3>
              <p>${template.items.length} блоков · ${escapeHtml(template.createdAt.slice(0, 10))}</p>
            </div>
          </div>
        </div>
        <div class="template-actions">
          <button class="secondary-button" type="button" data-action="apply-template" data-template-id="${escapeHtml(template.id)}">${icon("calendar")}Применить</button>
          <button class="danger-button" type="button" data-action="delete-template" data-template-id="${escapeHtml(template.id)}">${icon("trash")}Удалить</button>
        </div>
      </article>
    `).join("")
    : `<section class="empty-state"><div><strong>Шаблонов пока нет</strong><span>Сохраните текущий день</span></div></section>`;

  return `
    <section class="view-heading">
      <div>
        <h2>Шаблоны</h2>
        <p>Для выбранной даты: ${escapeHtml(formatLongDate(state.selectedDate))}</p>
      </div>
      <button class="icon-button" type="button" data-action="save-template" aria-label="Сохранить шаблон">${icon("plus")}</button>
    </section>
    <div class="panel-list">${list}</div>
  `;
}

function saveTemplate() {
  const schedule = getScheduleForDate(state.selectedDate).filter((item) => item.kind !== "system");
  if (!schedule.length) {
    showToast("Нет блоков для шаблона");
    return;
  }

  const name = window.prompt("Название шаблона", "Рабочий день");
  if (!name) return;

  state.templates.unshift({
    id: createId("tpl"),
    name: cleanText(name),
    createdAt: new Date().toISOString(),
    items: schedule.map((item) => ({
      title: item.title,
      startTime: item.startTime,
      duration: item.duration,
      type: item.type,
      color: item.color,
      icon: item.icon,
      repeat: { mode: "none", days: [] }
    }))
  });
  saveToStorage();
  showToast("Шаблон сохранен");
  renderApp();
}

function applyTemplate(templateId, targetDate = state.selectedDate) {
  const template = state.templates.find((entry) => entry.id === templateId);
  if (!template) return;

  template.items.forEach((item) => {
    state.items.push({
      id: createId("item"),
      createdAt: new Date().toISOString(),
      date: targetDate,
      ...item,
      repeat: { mode: "none", days: [] }
    });
  });
  state.selectedDate = targetDate;
  state.activeView = "day";
  saveToStorage();
  showToast("Шаблон применен");
  renderApp();
}

function renderSettings() {
  const wakeTime = getRoutineTime("wake", state.selectedDate);
  const sleepTime = getRoutineTime("sleep", state.selectedDate);
  return `
    <section class="view-heading">
      <div>
        <h2>Настройки</h2>
        <p>Локальные данные и режим дня</p>
      </div>
    </section>
    <div class="panel-list">
      <section class="settings-card">
        <h3>Режим</h3>
        <div class="settings-grid">
          <div class="settings-row">
            <label for="settingsName">Имя</label>
            <input id="settingsName" name="userName" value="${escapeHtml(state.settings.userName || "")}" placeholder="Как обращаться">
          </div>
          <div class="settings-row">
            <label for="settingsWake">Подъем</label>
            <input id="settingsWake" name="wakeTime" type="time" value="${escapeHtml(wakeTime)}">
          </div>
          <div class="settings-row">
            <label for="settingsSleep">Сон</label>
            <input id="settingsSleep" name="sleepTime" type="time" value="${escapeHtml(sleepTime)}">
          </div>
          <div class="settings-row">
            <label for="settingsTheme">Тема</label>
            <select id="settingsTheme" name="theme">
              <option value="light" ${state.settings.theme === "light" ? "selected" : ""}>Светлая</option>
              <option value="milk" ${state.settings.theme === "milk" ? "selected" : ""}>Молочная</option>
            </select>
          </div>
        </div>
        <button class="primary-button" type="button" data-action="save-settings">${icon("check")}Сохранить</button>
      </section>
      <section class="data-card">
        <h3>Данные</h3>
        <p>Экспорт и импорт хранят полное состояние приложения.</p>
        <button class="secondary-button" type="button" data-action="export-data">${icon("download")}Экспортировать</button>
        <label class="secondary-button" for="importFile">${icon("upload")}Импортировать</label>
        <input id="importFile" type="file" accept="application/json" data-action="import-data" hidden>
      </section>
    </div>
  `;
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Storage save failed", error);
    showToast("Не удалось сохранить данные");
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return mergeState(defaultState(), JSON.parse(raw));
  } catch (error) {
    console.error("Storage load failed", error);
    return defaultState();
  }
}

function exportData() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `plan-day-${todayKey()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Экспорт готов");
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      state = mergeState(defaultState(), imported);
      saveToStorage();
      showToast("Данные импортированы");
      renderApp();
    } catch (error) {
      console.error("Import failed", error);
      showToast("Файл не распознан");
    }
  };
  reader.readAsText(file);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

function bindAppEvents() {
  if (!appEventsBound) {
    app.addEventListener("click", handleAppClick);
    appEventsBound = true;
  }

  const importInput = app.querySelector("[data-action='import-data']");
  if (importInput) {
    importInput.addEventListener("change", (event) => importData(event.target.files?.[0]));
  }
}

function handleAppClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "go-today") {
    state.selectedDate = todayKey();
    state.activeView = "day";
    saveToStorage();
    renderApp();
  }
  if (action === "select-date") {
    state.selectedDate = target.dataset.date;
    saveToStorage();
    renderApp();
  }
  if (action === "nav") {
    state.activeView = target.dataset.view;
    saveToStorage();
    renderApp();
  }
  if (action === "new-item") openItemModal();
  if (action === "new-habit") openItemModal(null, { type: "habit", repeat: { mode: "daily", days: [] } });
  if (action === "edit-item") openItemModal(findScheduleInstance(target.dataset.instanceId));
  if (action === "delete-item") deleteItem(target.dataset.instanceId);
  if (action === "toggle-habit") toggleHabit(target.dataset.habitId);
  if (action === "copy-day") openCopySheet();
  if (action === "save-template") saveTemplate();
  if (action === "edit-habit") {
    const habit = state.habits.find((entry) => entry.id === target.dataset.habitId);
    if (habit) openItemModal(habitToInstance(habit, state.selectedDate));
  }
  if (action === "delete-habit") {
    state.habits = state.habits.filter((habit) => habit.id !== target.dataset.habitId);
    saveToStorage();
    renderApp();
  }
  if (action === "apply-template") applyTemplate(target.dataset.templateId);
  if (action === "delete-template") {
    state.templates = state.templates.filter((template) => template.id !== target.dataset.templateId);
    saveToStorage();
    renderApp();
  }
  if (action === "save-settings") saveSettingsFromView();
  if (action === "export-data") exportData();
}

function bindModalEvents() {
  modalRoot.addEventListener("click", onModalClick, { once: true });
  const form = modalRoot.querySelector("#itemForm");
  if (form) form.addEventListener("submit", saveItem);
}

function onModalClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  const sheet = event.target.closest(".modal-sheet");
  if ((actionTarget?.classList.contains("modal-backdrop") && sheet) || (!actionTarget && sheet)) {
    modalRoot.addEventListener("click", onModalClick, { once: true });
    return;
  }

  const action = actionTarget?.dataset.action;
  if (action === "close-modal") closeModal();
  if (action === "pick-color") {
    event.preventDefault();
    const form = modalRoot.querySelector("#itemForm");
    form.color.value = actionTarget.dataset.color;
    modalRoot.querySelectorAll(".swatch").forEach((swatch) => swatch.classList.toggle("is-selected", swatch === actionTarget));
    modalRoot.addEventListener("click", onModalClick, { once: true });
  }
  if (action === "toggle-weekday") {
    event.preventDefault();
    actionTarget.classList.toggle("is-selected");
    modalRoot.addEventListener("click", onModalClick, { once: true });
  }
  if (action === "delete-from-modal") deleteItem();
  if (action === "copy-filter") {
    copyCurrentDay(actionTarget.dataset.filter);
    closeModal();
  }
  if (action === "confirm-rebuild") {
    rebuildTimes(state.selectedDate);
    closeModal();
    renderApp();
  }
  if (action === "confirm-keep-time") closeModal();
}

function renderBottomNav() {
  const items = [
    ["day", "День", "calendar"],
    ["habits", "Привычки", "leaf"],
    ["templates", "Шаблоны", "archive"],
    ["settings", "Настройки", "settings"]
  ];
  return `
    <nav class="bottom-nav" aria-label="Основная навигация">
      ${items.map(([view, label, iconNameValue]) => `
        <button class="nav-button ${state.activeView === view ? "is-active" : ""}" type="button" data-action="nav" data-view="${view}">
          ${icon(iconNameValue)}
          <span>${label}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function openSetupModal() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal-sheet" role="dialog" aria-modal="true">
        <div class="modal-grabber"></div>
        <div class="modal-header">
          <h2>Режим дня</h2>
        </div>
        <form class="modal-body" id="setupForm">
          <div class="setup-card">
            <p>Задайте базовые точки дня. Их можно изменить позже.</p>
            <div class="form-grid">
              <label class="field">
                <span>Подъем</span>
                <input name="wakeTime" type="time" value="${escapeHtml(getRoutineTime("wake", state.selectedDate))}" required>
              </label>
              <label class="field">
                <span>Сон</span>
                <input name="sleepTime" type="time" value="${escapeHtml(getRoutineTime("sleep", state.selectedDate))}" required>
              </label>
            </div>
          </div>
          <div class="modal-actions">
            <button class="primary-button" type="submit">Начать</button>
          </div>
        </form>
      </section>
    </div>
  `;
  modalRoot.querySelector("#setupForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    state.settings.wakeRules = [{ from: "1970-01-01", time: data.wakeTime || "09:00" }];
    state.settings.sleepRules = [{ from: "1970-01-01", time: data.sleepTime || "01:00" }];
    state.setupComplete = true;
    saveToStorage();
    closeModal();
    renderApp();
  });
}

function openCopySheet() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-sheet" role="dialog" aria-modal="true">
        <div class="modal-grabber"></div>
        <div class="modal-header">
          <h2>Копировать день</h2>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="Закрыть">${icon("x")}</button>
        </div>
        <div class="modal-body">
          <div class="copy-grid">
            <button class="secondary-button" type="button" data-action="copy-filter" data-filter="all">${icon("copy")}Весь день</button>
            <button class="secondary-button" type="button" data-action="copy-filter" data-filter="task">${icon("check")}Только задачи</button>
            <button class="secondary-button" type="button" data-action="copy-filter" data-filter="habit">${icon("leaf")}Только привычки</button>
            <button class="secondary-button" type="button" data-action="copy-filter" data-filter="routine">${icon("repeat")}Только рутина</button>
          </div>
        </div>
      </section>
    </div>
  `;
  modalRoot.addEventListener("click", onModalClick, { once: true });
}

function openRebuildSheet() {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal-sheet" role="dialog" aria-modal="true">
        <div class="modal-grabber"></div>
        <div class="modal-header">
          <h2>Обновить время?</h2>
        </div>
        <div class="modal-body">
          <p class="card-title-group">Порядок изменен.</p>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="confirm-keep-time">Оставить</button>
            <button class="primary-button" type="button" data-action="confirm-rebuild">Перестроить</button>
          </div>
        </div>
      </section>
    </div>
  `;
  modalRoot.addEventListener("click", onModalClick, { once: true });
}

function renderRepeatFields(repeat) {
  return `
    <label class="field full">
      <span>Повтор</span>
      <select name="repeatMode">
        ${[
          ["none", "Без повтора"],
          ["daily", "Каждый день"],
          ["weekdays", "Будние дни"],
          ["weekends", "Выходные"],
          ["days", "По дням недели"],
          ["custom", "Пользовательский"]
        ].map(([value, label]) => `<option value="${value}" ${repeat.mode === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <div class="field full">
      <span class="fieldset-label">Дни недели</span>
      <div class="chips-row">
        ${WEEKDAY_VALUES.map((day) => `<button class="weekday-chip ${(repeat.days || []).map(Number).includes(day) ? "is-selected" : ""}" type="button" data-action="toggle-weekday" data-day="${day}">${WEEKDAYS[day]}</button>`).join("")}
      </div>
    </div>
  `;
}

function renderSystemScopeField() {
  return `
    <label class="field full">
      <span>Применить изменение</span>
      <select name="systemScope">
        <option value="day">Только на этот день</option>
        <option value="future">Для всех будущих дней</option>
      </select>
    </label>
  `;
}

function getScheduleForDate(date) {
  const entries = [];
  const hidden = state.settings.hiddenSystem[date] || {};

  if (!hidden.wake) {
    entries.push({
      instanceId: `system:wake:${date}`,
      kind: "system",
      sourceId: "wake",
      systemType: "wake",
      title: "Подъем",
      date,
      startTime: getRoutineTime("wake", date),
      duration: 15,
      type: "routine",
      color: "#efb753",
      icon: "sun"
    });
  }

  if (!hidden.sleep) {
    entries.push({
      instanceId: `system:sleep:${date}`,
      kind: "system",
      sourceId: "sleep",
      systemType: "sleep",
      title: "Сон",
      date,
      startTime: getRoutineTime("sleep", date),
      duration: getSleepDuration(date),
      type: "sleep",
      color: "#7e8aa8",
      icon: "moon"
    });
  }

  state.items.forEach((item) => {
    if (item.date === date || repeatApplies(item.repeat, date, item.date)) {
      entries.push(itemToInstance(item, date));
    }
  });

  state.habits.filter((habit) => habit.active !== false && repeatApplies(habit.repeat, date, habit.date)).forEach((habit) => {
    entries.push(habitToInstance(habit, date));
  });

  return orderSchedule(entries, date);
}

function orderSchedule(entries, date) {
  const saved = state.dayOrder[date] || [];
  const byId = new Map(entries.map((entry) => [entry.instanceId, entry]));
  const ordered = saved.map((id) => byId.get(id)).filter(Boolean);
  const leftovers = entries
    .filter((entry) => !saved.includes(entry.instanceId))
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  return [...ordered, ...leftovers];
}

function itemToInstance(item, date) {
  return {
    ...item,
    date,
    kind: "item",
    sourceId: item.id,
    instanceId: `item:${item.id}:${date}`
  };
}

function habitToInstance(habit, date) {
  return {
    ...habit,
    date,
    kind: "habit",
    sourceId: habit.id,
    instanceId: `habit:${habit.id}:${date}`
  };
}

function findScheduleInstance(instanceId) {
  return getScheduleForDate(state.selectedDate).find((item) => item.instanceId === instanceId);
}

function normalizeModalDraft(item, options) {
  const type = options.type || item?.type || "task";
  const meta = TYPE_META[type] || TYPE_META.task;
  return {
    instanceId: item?.instanceId || "",
    kind: item?.kind || "item",
    systemType: item?.systemType || "",
    title: item?.title || "",
    date: item?.date || state.selectedDate,
    startTime: item?.startTime || roundTimeToStep(new Date(), 15),
    duration: item?.duration || (type === "habit" ? 20 : 30),
    type,
    color: item?.color || meta.color,
    icon: item?.icon || meta.icon,
    repeat: options.repeat || item?.repeat || { mode: "none", days: [] }
  };
}

function collectRepeatFromForm(form) {
  const mode = form.repeatMode?.value || "none";
  const days = [...form.querySelectorAll(".weekday-chip.is-selected")].map((button) => Number(button.dataset.day));
  return normalizeRepeat({ mode, days });
}

function normalizeRepeat(repeat) {
  const mode = repeat?.mode || "none";
  let days = Array.isArray(repeat?.days) ? repeat.days.map(Number) : [];
  if (mode === "weekdays") days = [1, 2, 3, 4, 5];
  if (mode === "weekends") days = [0, 6];
  if (mode === "daily") days = [0, 1, 2, 3, 4, 5, 6];
  return { mode, days };
}

function repeatApplies(repeat, date, startDate = "1970-01-01") {
  if (date < startDate) return false;
  const normalized = normalizeRepeat(repeat || { mode: "none", days: [] });
  if (normalized.mode === "none") return false;
  if (normalized.mode === "daily") return true;
  const day = parseDateKey(date).getDay();
  return normalized.days.includes(day);
}

function repeatLabelFor(repeat) {
  const normalized = normalizeRepeat(repeat);
  if (normalized.mode === "none") return "без повтора";
  if (normalized.mode === "daily") return "каждый день";
  if (normalized.mode === "weekdays") return "будни";
  if (normalized.mode === "weekends") return "выходные";
  return normalized.days.length ? normalized.days.map((day) => WEEKDAYS[day]).join(", ") : "выборочно";
}

function saveSystemRoutine(systemType, date, time, scope) {
  if (scope === "future") {
    const key = systemType === "wake" ? "wakeRules" : "sleepRules";
    state.settings[key] = [
      ...(state.settings[key] || []).filter((rule) => rule.from !== date),
      { from: date, time }
    ].sort((a, b) => a.from.localeCompare(b.from));
    if (state.settings.routineOverrides[date]) {
      delete state.settings.routineOverrides[date][`${systemType}Time`];
    }
    return;
  }

  const override = state.settings.routineOverrides[date] || {};
  override[`${systemType}Time`] = time;
  state.settings.routineOverrides[date] = override;
}

function getRoutineTime(systemType, date) {
  const override = state.settings.routineOverrides[date]?.[`${systemType}Time`];
  if (override) return override;
  const rules = systemType === "wake" ? state.settings.wakeRules : state.settings.sleepRules;
  const sorted = [...(rules || [])].sort((a, b) => a.from.localeCompare(b.from));
  const rule = sorted.filter((entry) => entry.from <= date).at(-1);
  return rule?.time || (systemType === "wake" ? "09:00" : "01:00");
}

function getSleepDuration(date) {
  const sleep = timeToMinutes(getRoutineTime("sleep", date));
  const wake = timeToMinutes(getRoutineTime("wake", date));
  const diff = wake > sleep ? wake - sleep : wake + 24 * 60 - sleep;
  return clamp(diff, 15, 24 * 60);
}

function toggleHabit(habitId) {
  const date = state.selectedDate;
  state.habitCompletions[date] = state.habitCompletions[date] || {};
  state.habitCompletions[date][habitId] = !state.habitCompletions[date][habitId];
  saveToStorage();
  renderApp();
}

function isHabitCompleted(habitId, date) {
  return Boolean(state.habitCompletions[date]?.[habitId]);
}

function copyCurrentDay(filter) {
  const nextDate = dateKey(addDays(parseDateKey(state.selectedDate), 1));
  const schedule = getScheduleForDate(state.selectedDate).filter((item) => {
    if (item.kind === "system") return filter === "all";
    if (filter === "all") return true;
    return item.type === filter;
  });

  schedule.forEach((item) => {
    if (item.kind === "system") {
      saveSystemRoutine(item.systemType, nextDate, item.startTime, "day");
      return;
    }
    state.items.push({
      id: createId("item"),
      createdAt: new Date().toISOString(),
      title: item.title,
      date: nextDate,
      startTime: item.startTime,
      duration: item.duration,
      type: item.type,
      color: item.color,
      icon: item.icon,
      repeat: { mode: "none", days: [] }
    });
  });

  state.selectedDate = nextDate;
  state.activeView = "day";
  saveToStorage();
  showToast("День скопирован");
  renderApp();
}

function finishDragOrder(list, oldOrder = null) {
  const card = document.querySelector(".schedule-card.is-dragging");
  if (card) card.classList.remove("is-dragging");
  const newOrder = getDomOrder(list);
  const previous = oldOrder || state.dayOrder[state.selectedDate] || getScheduleForDate(state.selectedDate).map((item) => item.instanceId);
  if (newOrder.join("|") === previous.join("|")) return;

  state.dayOrder[state.selectedDate] = newOrder;
  saveToStorage();
  const hasTimedItems = getScheduleForDate(state.selectedDate).some((item) => item.startTime);
  if (hasTimedItems) openRebuildSheet();
}

function rebuildTimes(date) {
  const schedule = getScheduleForDate(date);
  let cursor = timeToMinutes(schedule[0]?.startTime || "09:00");
  schedule.forEach((entry) => {
    if (entry.kind !== "system") {
      const target = entry.kind === "habit"
        ? state.habits.find((habit) => habit.id === entry.sourceId)
        : state.items.find((item) => item.id === entry.sourceId);
      if (target) target.startTime = minutesToTime(cursor);
    }
    cursor += Number(entry.duration) || 30;
  });
  saveToStorage();
  showToast("Время перестроено");
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll(".schedule-card:not(.is-dragging):not(.is-touch-dragging)")];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getDomOrder(list) {
  return [...list.querySelectorAll(".schedule-card")].map((card) => card.dataset.instanceId);
}

function saveSettingsFromView() {
  const root = document.getElementById("viewRoot");
  const userName = root.querySelector("[name='userName']").value;
  const wakeTime = root.querySelector("[name='wakeTime']").value;
  const sleepTime = root.querySelector("[name='sleepTime']").value;
  const theme = root.querySelector("[name='theme']").value;
  state.settings.userName = cleanText(userName);
  state.settings.theme = theme;
  saveSystemRoutine("wake", state.selectedDate, wakeTime, "future");
  saveSystemRoutine("sleep", state.selectedDate, sleepTime, "future");
  state.setupComplete = true;
  saveToStorage();
  showToast("Настройки сохранены");
  renderApp();
}

function centerSelectedDate() {
  requestAnimationFrame(() => {
    document.querySelector(".date-pill.is-selected")?.scrollIntoView({ inline: "center", block: "nearest" });
  });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function showToast(message) {
  clearTimeout(toastTimer);
  toastRoot.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  toastTimer = setTimeout(() => {
    toastRoot.innerHTML = "";
  }, 2200);
}

function seedDemoDataIfEmpty() {
  if (state.items.length || state.habits.length || state.templates.length) return;
  const date = todayKey();
  state.items.push(
    {
      id: createId("item"),
      createdAt: new Date().toISOString(),
      title: "Планирование дня",
      date,
      startTime: "09:20",
      duration: 25,
      type: "routine",
      color: TYPE_META.routine.color,
      icon: "repeat",
      repeat: { mode: "none", days: [] }
    },
    {
      id: createId("item"),
      createdAt: new Date().toISOString(),
      title: "Фокус-блок",
      date,
      startTime: "11:00",
      duration: 90,
      type: "task",
      color: TYPE_META.task.color,
      icon: "check",
      repeat: { mode: "none", days: [] }
    },
    {
      id: createId("item"),
      createdAt: new Date().toISOString(),
      title: "Прогулка",
      date,
      startTime: "19:00",
      duration: 45,
      type: "rest",
      color: TYPE_META.rest.color,
      icon: "pause",
      repeat: { mode: "none", days: [] }
    }
  );
  createHabit({
    title: "Чтение",
    date,
    startTime: "22:20",
    duration: 30,
    type: "habit",
    color: TYPE_META.habit.color,
    icon: "book",
    repeat: { mode: "daily", days: [] }
  });
  saveToStorage();
}

function mergeState(base, imported) {
  const merged = { ...base, ...imported };
  merged.settings = { ...base.settings, ...(imported.settings || {}) };
  merged.settings.wakeRules = merged.settings.wakeRules?.length ? merged.settings.wakeRules : base.settings.wakeRules;
  merged.settings.sleepRules = merged.settings.sleepRules?.length ? merged.settings.sleepRules : base.settings.sleepRules;
  merged.settings.routineOverrides = merged.settings.routineOverrides || {};
  merged.settings.hiddenSystem = merged.settings.hiddenSystem || {};
  merged.items = Array.isArray(merged.items) ? merged.items : [];
  merged.habits = Array.isArray(merged.habits) ? merged.habits : [];
  merged.templates = Array.isArray(merged.templates) ? merged.templates : [];
  merged.habitCompletions = merged.habitCompletions || {};
  merged.dayOrder = merged.dayOrder || {};
  merged.selectedDate = merged.selectedDate || todayKey();
  merged.activeView = merged.activeView || "day";
  return merged;
}

function parseInstanceId(instanceId = "") {
  const [kind, sourceId, date] = instanceId.split(":");
  if (kind === "system") return { kind, systemType: sourceId, sourceId, date };
  return { kind, sourceId, date };
}

function getViewTitle() {
  if (state.activeView === "habits") return "Привычки";
  if (state.activeView === "templates") return "Шаблоны";
  if (state.activeView === "settings") return "Настройки";
  return "План дня";
}

function getGreeting() {
  const name = state.settings.userName ? `, ${state.settings.userName}` : "";
  return `Сегодня${name}`;
}

function getDaySection(time) {
  const minutes = timeToMinutes(time);
  return SECTION_META.find((section) => minutes >= section.from && minutes < section.to) || SECTION_META[0];
}

function formatLongDate(key) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(parseDateKey(key));
}

function formatDuration(minutes) {
  const value = Number(minutes) || 0;
  if (value < 60) return `${value} мин`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function todayKey() {
  return dateKey(new Date());
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function timeToMinutes(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function minutesToTime(total) {
  const minutes = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function addMinutesToTime(time, minutes) {
  return minutesToTime(timeToMinutes(time) + Number(minutes || 0));
}

function roundTimeToStep(date, step) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const rounded = Math.ceil(minutes / step) * step;
  return minutesToTime(rounded);
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sameColor(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function iconName(name) {
  const labels = {
    check: "Галочка",
    leaf: "Лист",
    repeat: "Повтор",
    calendar: "Календарь",
    pause: "Пауза",
    moon: "Луна",
    sun: "Солнце",
    book: "Книга",
    dumbbell: "Тренировка",
    coffee: "Кофе",
    spark: "Искра"
  };
  return labels[name] || name;
}

function icon(name) {
  const paths = {
    plus: `<path d="M12 5v14M5 12h14"/>`,
    x: `<path d="m18 6-12 12M6 6l12 12"/>`,
    check: `<path d="m5 12 4 4L19 6"/>`,
    edit: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"/>`,
    trash: `<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/>`,
    grip: `<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>`,
    copy: `<path d="M8 8h10v12H8z"/><path d="M6 16H4V4h12v2"/>`,
    archive: `<path d="M4 7h16v13H4z"/><path d="M2 4h20v3H2z"/><path d="M9 12h6"/>`,
    calendar: `<path d="M7 3v4M17 3v4"/><path d="M4 7h16v13H4z"/><path d="M4 11h16"/>`,
    leaf: `<path d="M5 19C14 19 20 13 20 4 11 4 5 10 5 19Z"/><path d="M5 19c3-5 7-8 12-10"/>`,
    repeat: `<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>`,
    pause: `<path d="M8 5v14M16 5v14"/>`,
    moon: `<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"/>`,
    sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>`,
    book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"/>`,
    dumbbell: `<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>`,
    coffee: `<path d="M5 8h12v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8Z"/><path d="M17 9h1a3 3 0 0 1 0 6h-1"/><path d="M8 2v2M12 2v2"/>`,
    spark: `<path d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2Z"/>`,
    settings: `<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.08.08a2 2 0 1 1-3.84 0L10 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.08-.08a2 2 0 1 1 0-3.84L4 10a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.08-.08a2 2 0 1 1 3.84 0L14 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.25.3.45.63.6 1l.08.08a2 2 0 1 1 0 3.84L20 14c-.15.37-.35.7-.6 1Z"/>`,
    download: `<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>`,
    upload: `<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>`
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.check}</svg>`;
}
