const DEFAULT_SUBJECT_QUOTAS = {
  "subject1": { target: 3, hours: 1, minutes: 0, seconds: 0 },
  "subject2": { target: 3, hours: 1, minutes: 0, seconds: 0 },
  
};

// ===============================
// STORAGE & INITIAL STATE + DATA UPGRADE GUARD
// ===============================
function normalizeDurationConfig(rawValue) {
  if (typeof rawValue === 'number') {
    return { target: rawValue, hours: 1, minutes: 0, seconds: 0 };
  }

  if (rawValue && typeof rawValue === 'object') {
    if ('hours' in rawValue || 'minutes' in rawValue || 'seconds' in rawValue) {
      return {
        target: parseInt(rawValue.target, 10) || 0,
        hours: parseInt(rawValue.hours, 10) || 0,
        minutes: parseInt(rawValue.minutes, 10) || 0,
        seconds: parseInt(rawValue.seconds, 10) || 0
      };
    }

    if ('durationMin' in rawValue) {
      const totalMinutes = parseInt(rawValue.durationMin, 10) || 0;
      return {
        target: parseInt(rawValue.target, 10) || 0,
        hours: Math.floor(totalMinutes / 60),
        minutes: totalMinutes % 60,
        seconds: 0
      };
    }

    if ('target' in rawValue) {
      return {
        target: parseInt(rawValue.target, 10) || 0,
        hours: 1,
        minutes: 0,
        seconds: 0
      };
    }
  }

  return { target: 0, hours: 1, minutes: 0, seconds: 0 };
}

let rawStoredQuotas = JSON.parse(localStorage.getItem('targetQuotas'));
let targetQuotas = {};

if (rawStoredQuotas && typeof rawStoredQuotas === 'object') {
  Object.keys(rawStoredQuotas).forEach(key => {
    targetQuotas[key] = normalizeDurationConfig(rawStoredQuotas[key]);
  });
} else {
  targetQuotas = { ...DEFAULT_SUBJECT_QUOTAS };
}

let loggedSessions = JSON.parse(localStorage.getItem('loggedSessions')) || [];
let currentWeekOffset = 0;

function getSubjectDurationSeconds(subject) {
  const cfg = targetQuotas[subject];
  if (!cfg) return 3600;

  return (
    (parseInt(cfg.hours, 10) || 0) * 3600 +
    (parseInt(cfg.minutes, 10) || 0) * 60 +
    (parseInt(cfg.seconds, 10) || 0)
  ) || 3600;
}

// ===============================
// TIMER STATE
// ===============================
let activeTimerInterval = null;
let activeTimerSeconds = 0;
let activeDayTargetStr = null;
let activeSubjectSelected = null;
let activeTimerStartedAtMs = null;
let activeTimerAccumulatedSeconds = 0;

const ACTIVE_TIMER_STORAGE_KEY = 'activeTimerState';

// ===============================
// UI DOM ELEMENTS
// ===============================
const quotaDashboard = document.getElementById('quota-dashboard');
const btnToggleSummary = document.getElementById('btn-toggle-summary');
const btnEditQuotas = document.getElementById('btn-edit-quotas');
const quotaEditorDrawer = document.getElementById('quota-editor-drawer');
const quotaEditList = document.getElementById('quota-edit-list');
const btnSaveQuotas = document.getElementById('btn-save-quotas');
const calendarGrid = document.getElementById('calendar-grid');
const currentWeekRangeLabel = document.getElementById('current-week-range');
const btnPrevWeek = document.getElementById('btn-prev-week');
const btnNextWeek = document.getElementById('btn-next-week');

// ===============================
// INITIALIZATION
// ===============================
window.addEventListener('DOMContentLoaded', () => {
  restoreActiveTimerState();
  renderQuotaDashboard();
  renderWeekGrid();
  setupEventListeners();
});

function setupEventListeners() {
  if (btnToggleSummary) {
    btnToggleSummary.addEventListener('click', () => {
      quotaDashboard.classList.toggle('summary-collapsed');
      btnToggleSummary.textContent = quotaDashboard.classList.contains('summary-collapsed') ? 'show more' : 'show less';
    });
  }

  if (btnEditQuotas) {
    btnEditQuotas.addEventListener('click', () => {
      quotaEditorDrawer.classList.toggle('hidden');
      if (!quotaEditorDrawer.classList.contains('hidden')) initQuotaEditor();
    });
  }

  if (btnSaveQuotas) btnSaveQuotas.addEventListener('click', saveQuotas);
  if (btnPrevWeek) btnPrevWeek.addEventListener('click', () => { currentWeekOffset--; renderWeekGrid(); renderQuotaDashboard(); });
  if (btnNextWeek) btnNextWeek.addEventListener('click', () => { currentWeekOffset++; renderWeekGrid(); renderQuotaDashboard(); });

  const btnAddCustomSubject = document.getElementById('btn-add-custom-subject');
  if (btnAddCustomSubject) {
    btnAddCustomSubject.addEventListener('click', addNewCustomSubjectCard);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncActiveTimerFromClock();
      renderWeekGrid();
    }
  });

  window.addEventListener('focus', () => {
    syncActiveTimerFromClock();
    renderWeekGrid();
  });

  window.addEventListener('pageshow', () => {
    syncActiveTimerFromClock();
    renderWeekGrid();
  });
}

// ===============================
// CORE UTILITIES
// ===============================
function getMondayOfOffsetWeek(offset) {
  const today = new Date();
  const currentDayIndex = today.getDay();
  const daysToMonday = currentDayIndex === 0 ? -6 : 1 - currentDayIndex;

  const targetMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysToMonday);
  targetMonday.setDate(targetMonday.getDate() + (offset * 7));
  targetMonday.setHours(0, 0, 0, 0);
  return targetMonday;
}

function formatDateISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatExactMS(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

function formatSessionRule(subject) {
  const cfg = targetQuotas[subject];
  if (!cfg) return '1h 0m 0s';

  const h = parseInt(cfg.hours, 10) || 0;
  const m = parseInt(cfg.minutes, 10) || 0;
  const s = parseInt(cfg.seconds, 10) || 0;

  return `${h}h ${m}m ${s}s`;
}

function formatTimerDigits(totalSeconds) {
  const hrs = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const secs = String(totalSeconds % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

function getActiveTimerElapsedSeconds() {
  if (activeTimerStartedAtMs === null) {
    return activeTimerAccumulatedSeconds || 0;
  }

  const elapsedFromStart = Math.floor((Date.now() - activeTimerStartedAtMs) / 1000);
  return Math.max(0, (activeTimerAccumulatedSeconds || 0) + elapsedFromStart);
}

function syncActiveTimerFromClock() {
  activeTimerSeconds = getActiveTimerElapsedSeconds();
}

function saveActiveTimerState() {
  if (activeTimerStartedAtMs === null || !activeDayTargetStr || !activeSubjectSelected) {
    localStorage.removeItem(ACTIVE_TIMER_STORAGE_KEY);
    return;
  }

  localStorage.setItem(ACTIVE_TIMER_STORAGE_KEY, JSON.stringify({
    date: activeDayTargetStr,
    subject: activeSubjectSelected,
    startedAtMs: activeTimerStartedAtMs,
    accumulatedSeconds: activeTimerAccumulatedSeconds
  }));
}

function restoreActiveTimerState() {
  const raw = JSON.parse(localStorage.getItem(ACTIVE_TIMER_STORAGE_KEY));

  if (!raw || typeof raw !== 'object') {
    return;
  }

  if (!raw.date || !raw.subject || typeof raw.startedAtMs !== 'number') {
    localStorage.removeItem(ACTIVE_TIMER_STORAGE_KEY);
    return;
  }

  activeDayTargetStr = raw.date;
  activeSubjectSelected = raw.subject;
  activeTimerStartedAtMs = raw.startedAtMs;
  activeTimerAccumulatedSeconds = Number(raw.accumulatedSeconds) || 0;
  syncActiveTimerFromClock();

  if (!activeTimerInterval) {
    activeTimerInterval = setInterval(() => {
      syncActiveTimerFromClock();
      const display = document.getElementById('inline-clock-display');
      if (display) {
        display.textContent = formatTimerDigits(activeTimerSeconds);
      }
    }, 1000);
  }
}

// ===============================
// DYNAMIC CARD STORAGE ENGINE
// ===============================
function addNewCustomSubjectCard() {
  const inputField = document.getElementById('new-subject-name');
  if (!inputField) return;

  const rawName = inputField.value.trim();
  if (!rawName) {
    alert('Please enter a valid activity name.');
    return;
  }

  const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  if (targetQuotas[formattedName] !== undefined) {
    alert('This activity card already exists!');
    return;
  }

  targetQuotas[formattedName] = {
    target: 1,
    hours: 0,
    minutes: 30,
    seconds: 0
  };

  localStorage.setItem('targetQuotas', JSON.stringify(targetQuotas));
  inputField.value = '';
  initQuotaEditor();
}

function deleteSubjectCard(subject) {
  if (confirm(`Are you sure you want to remove "${subject.toLowerCase()}"? This removes the dashboard card.`)) {
    delete targetQuotas[subject];
    localStorage.setItem('targetQuotas', JSON.stringify(targetQuotas));
    initQuotaEditor();
    renderQuotaDashboard();
    renderWeekGrid();
  }
}

// ===============================
// RENDERING FUNCTIONS
// ===============================
function renderQuotaDashboard() {
  if (!quotaDashboard) return;
  quotaDashboard.innerHTML = '';

  const currentMon = getMondayOfOffsetWeek(currentWeekOffset);
  const currentSun = new Date(currentMon);
  currentSun.setDate(currentSun.getDate() + 6);
  currentSun.setHours(23, 59, 59, 999);

  const weeklyAccumulatedSeconds = {};
  Object.keys(targetQuotas).forEach(sub => {
    weeklyAccumulatedSeconds[sub] = 0;
  });

  loggedSessions.forEach(session => {
    const sDate = new Date(session.date + 'T00:00:00');
    if (sDate >= currentMon && sDate <= currentSun && weeklyAccumulatedSeconds[session.subject] !== undefined) {
      if (session.durationSeconds && session.durationSeconds > 0) {
        weeklyAccumulatedSeconds[session.subject] += session.durationSeconds;
      }
    }
  });

  Object.keys(targetQuotas).forEach(subject => {
    const targetObj = targetQuotas[subject];
    const totalSecondsSpent = weeklyAccumulatedSeconds[subject];

    const cardSessionDurationSeconds = getSubjectDurationSeconds(subject);
    const loggedCount = Math.floor(totalSecondsSpent / cardSessionDurationSeconds);
    const remainingCount = targetObj.target - loggedCount < 0 ? 0 : targetObj.target - loggedCount;

    const timeFormatted = formatExactMS(totalSecondsSpent);
    const sessionLengthLabel = formatSessionRule(subject);

    const fullSessions = Math.floor(
      totalSecondsSpent / cardSessionDurationSeconds
    );

    const card = document.createElement('div');
    card.className = 'quota-item';

    card.innerHTML = `
  <div style="display:flex; justify-content:space-between; align-items:baseline;">
    <div class="subject-title">${subject.toLowerCase()}</div>
    <div style="font-size:0.72rem; color:var(--text-muted); opacity:0.75;">
      rule: ${sessionLengthLabel}
    </div>
  </div>

  <div class="stats-line">
    <span>
      remaining:
      <span class="remaining-count">
        ${remainingCount}/${targetObj.target}
      </span>
    </span>

    <span>
      time: ${timeFormatted}
    </span>

    <span>
      completed:
      <span class="remaining-count">
        ${fullSessions}
      </span>
    </span>
  </div>
`;

    quotaDashboard.appendChild(card);

  });
}


function initQuotaEditor() {
  if (!quotaEditList) return;
  quotaEditList.innerHTML = '';

  Object.keys(targetQuotas).forEach(subject => {
    const cfg = targetQuotas[subject];
    const h = cfg.hours || 0;
    const m = cfg.minutes || 0;
    const s = cfg.seconds || 0;

    const row = document.createElement('div');
    row.className = 'quota-edit-row';

    // The innerHTML structure matching the 6-column grid
    row.innerHTML = `
      <div class="cell name-cell">
        <button class="btn-delete-card" data-subject="${subject}">×</button>
        <span style="font-weight: 500; text-transform: capitalize;">${subject}</span>
      </div>

      <input class="input-target" type="text" inputmode="numeric" value="${cfg.target}" data-subject="${subject}">
      
      <div class="spacer"></div>

      <input class="input-h" type="text" inputmode="numeric" value="${h}">
      <input class="input-m" type="text" inputmode="numeric" value="${m}">
      <input class="input-s" type="text" inputmode="numeric" value="${s}">
    `;

    row.querySelector('.btn-delete-card').onclick = (e) => {
      deleteSubjectCard(e.target.getAttribute('data-subject'));
    };

    quotaEditList.appendChild(row);
  });
}


function saveQuotas() {
  const rows = quotaEditList.querySelectorAll('.quota-edit-row');
  let hasError = false;

  rows.forEach(row => {
    row.style.background = "#ffffff";
    row.style.border = "1px solid rgba(0,0,0,0.05)";
  });


  rows.forEach(row => {
    const targetInput = row.querySelector('.input-target');

    const h = Number(row.querySelector('.input-h').value) || 0;
    const m = Number(row.querySelector('.input-m').value) || 0;
    const s = Number(row.querySelector('.input-s').value) || 0;

    const totalSeconds = (h * 3600) + (m * 60) + s;


    if (totalSeconds <= 0) {
      hasError = true;

      row.style.background = "#fff1f2";
      row.style.border = "1px solid #fecaca";

      return;
    }


    const subject = targetInput.getAttribute('data-subject');

    targetQuotas[subject] = {
      target: Number(targetInput.value) || 0,
      hours: h,
      minutes: m,
      seconds: s
    };

  });


  if (hasError) {
    console.log("Please set a duration greater than 0 for all activities.");
    return;
  }


  localStorage.setItem(
    'targetQuotas',
    JSON.stringify(targetQuotas)
  );


  quotaEditorDrawer.classList.add('hidden');

  renderQuotaDashboard();
  renderWeekGrid();
}


function deleteSessionRecord(sessionId) {
  loggedSessions = loggedSessions.filter(session => session.id !== sessionId);
  localStorage.setItem('loggedSessions', JSON.stringify(loggedSessions));
  renderQuotaDashboard();
  renderWeekGrid();
}

function renderWeekGrid() {
  if (!calendarGrid) return;
  calendarGrid.innerHTML = '';

  syncActiveTimerFromClock();

  const monday = getMondayOfOffsetWeek(currentWeekOffset);
  const daysOfWeek = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  const endOfWeek = new Date(monday);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  currentWeekRangeLabel.textContent = `${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} (2026)`;

  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const dateStr = formatDateISO(targetDate);
    const dayLabelText = daysOfWeek[i];

    const dayColumn = document.createElement('div');
    dayColumn.className = 'day-column';

    const dayHeader = document.createElement('div');
    dayHeader.className = 'day-header';
    dayHeader.innerHTML = `<span>${dayLabelText}${targetDate.getDate()}</span>`;
    dayColumn.appendChild(dayHeader);

    const sessionsListContainer = document.createElement('div');
    sessionsListContainer.className = 'day-sessions-list';

    const daySessions = loggedSessions.filter(s => s.date === dateStr);
    daySessions.forEach(session => {
      const currentSubjectRuleSeconds = getSubjectDurationSeconds(session.subject);

      const badge = document.createElement('div');
      badge.className = 'session-badge';

      const timeFormatted = formatExactMS(session.durationSeconds || 0);
      const fullSessions = Math.floor((session.durationSeconds || 0) / currentSubjectRuleSeconds);

      badge.innerHTML = `
        <span class="subject-name">${session.subject.toLowerCase()}</span>
        <div class="session-block-details">
          <span>${fullSessions} full session${fullSessions === 1 ? '' : 's'} • ${timeFormatted}</span>
        </div>
        <button class="btn-delete-session" title="remove session">x</button>
      `;

      badge.querySelector('.btn-delete-session').onclick = (e) => {
        e.stopPropagation();
        deleteSessionRecord(session.id);
      };

      sessionsListContainer.appendChild(badge);
    });

    dayColumn.appendChild(sessionsListContainer);

    if (activeDayTargetStr === dateStr) {
      const timerModule = document.createElement('div');
      timerModule.className = 'inline-timer-card';

      const headerRow = document.createElement('div');
      headerRow.style.display = 'flex';
      headerRow.style.justifyContent = 'space-between';
      headerRow.style.alignItems = 'center';

      const title = document.createElement('h4');
      title.textContent = `${dayLabelText} activity timer`;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.padding = '2px 8px';

      closeBtn.onclick = () => {
        if (activeTimerInterval) {
          clearInterval(activeTimerInterval);
          activeTimerInterval = null;
        }
        activeDayTargetStr = null;
        activeSubjectSelected = null;
        activeTimerStartedAtMs = null;
        activeTimerAccumulatedSeconds = 0;
        activeTimerSeconds = 0;
        localStorage.removeItem(ACTIVE_TIMER_STORAGE_KEY);
        renderWeekGrid();
      };

      headerRow.appendChild(title);
      headerRow.appendChild(closeBtn);

      timerModule.appendChild(headerRow);


      const select = document.createElement('select');
      select.id = 'inline-subject-select';

      Object.keys(targetQuotas).forEach(subject => {
        const option = document.createElement('option');
        option.value = subject;
        option.textContent = subject.toLowerCase();
        if (activeSubjectSelected === subject) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      select.onchange = (e) => {
        activeSubjectSelected = e.target.value;
        saveActiveTimerState();
      };

      if (!activeSubjectSelected) {
        activeSubjectSelected = select.value;
        saveActiveTimerState();
      }

      timerModule.appendChild(select);

      const clockDisplay = document.createElement('div');
      clockDisplay.className = 'clock-readout';
      clockDisplay.id = 'inline-clock-display';
      clockDisplay.textContent = formatTimerDigits(activeTimerSeconds);
      timerModule.appendChild(clockDisplay);

      const actionsWrapper = document.createElement('div');
      actionsWrapper.className = 'timer-actions';

      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = activeTimerInterval ? 'stop' : 'start';
      toggleBtn.className = activeTimerInterval ? 'btn-trigger-stop' : 'btn-trigger-start';
      toggleBtn.onclick = () => { handleInlineTimerToggle(dateStr, select.value); };

      actionsWrapper.appendChild(toggleBtn);
      timerModule.appendChild(actionsWrapper);
      dayColumn.appendChild(timerModule);
    } else {
      const btnAdd = document.createElement('button');
      btnAdd.className = 'btn-add-session';
      btnAdd.innerText = '+';
      btnAdd.onclick = () => {
        if (activeTimerInterval) {
          alert('please stop your current tracking timer first');
          return;
        }
        activeDayTargetStr = dateStr;
        activeSubjectSelected = null;
        activeTimerStartedAtMs = null;
        activeTimerAccumulatedSeconds = 0;
        activeTimerSeconds = 0;
        renderWeekGrid();
      };
      dayColumn.appendChild(btnAdd);
    }

    calendarGrid.appendChild(dayColumn);
  }
}

// ===============================
// CORE TRACKER OPERATIONAL LOGIC
// ===============================
function handleInlineTimerToggle(dateStr, subjectValue) {
  if (activeTimerInterval) {
    syncActiveTimerFromClock();
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;

    if (activeTimerSeconds > 0) {
      loggedSessions.push({
        id: Date.now().toString(),
        subject: activeSubjectSelected || subjectValue,
        date: dateStr,
        durationSeconds: activeTimerSeconds
      });
      localStorage.setItem('loggedSessions', JSON.stringify(loggedSessions));
    }

    activeTimerStartedAtMs = null;
    activeTimerAccumulatedSeconds = 0;
    activeTimerSeconds = 0;
    localStorage.removeItem(ACTIVE_TIMER_STORAGE_KEY);
    activeDayTargetStr = null;
    activeSubjectSelected = null;
    renderQuotaDashboard();
    renderWeekGrid();
  } else {
    activeSubjectSelected = subjectValue;
    activeDayTargetStr = dateStr;
    activeTimerAccumulatedSeconds = 0;
    activeTimerStartedAtMs = Date.now();
    syncActiveTimerFromClock();
    saveActiveTimerState();

    activeTimerInterval = setInterval(() => {
      syncActiveTimerFromClock();
      const display = document.getElementById('inline-clock-display');
      if (display) {
        display.textContent = formatTimerDigits(activeTimerSeconds);
      }
    }, 1000);

    renderWeekGrid();
  }
}
