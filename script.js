(() => {
  "use strict";

  const STORAGE_KEY = "dailyData_v1";
  const MELBOURNE_TZ = "Australia/Melbourne";
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const LONG_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function localDateKey(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: MELBOURNE_TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  }
  function dateFromKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }
  function addDays(key, amount) {
    const d = dateFromKey(key);
    d.setDate(d.getDate() + amount);
    return keyFromDate(d);
  }
  function keyFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  function mondayOf(key) {
    const d = dateFromKey(key);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return keyFromDate(d);
  }
  function dayIndex(key) {
    return (dateFromKey(key).getDay() + 6) % 7;
  }
  function formatDate(key, options = { day: "numeric", month: "long", year: "numeric" }) {
    return new Intl.DateTimeFormat("en-AU", { ...options, timeZone: MELBOURNE_TZ }).format(dateFromKey(key));
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }
  function defaultData() {
    return { version: 1, goals: [], entries: {}, achievements: {}, reportSeen: {}, createdAt: localDateKey() };
  }
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.goals) || typeof parsed.entries !== "object") return defaultData();
      return { ...defaultData(), ...parsed };
    } catch (err) {
      console.error("Could not read Daily Data storage:", err);
      return defaultData();
    }
  }

  let data = loadData();
  let activeTab = "home";
  let statsGoalId = "";
  let statsPeriod = "daily";
  let periodOffset = 0;
  let calendarMonth = localDateKey().slice(0, 7);
  let toastTimer = null;
  let saveTimer = null;

  function saveData() {
    const indicator = $("#save-indicator");
    indicator?.classList.add("saving");
    indicator && (indicator.lastChild.textContent = " Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        indicator?.classList.remove("saving");
        indicator && (indicator.lastChild.textContent = " Saved");
      } catch (err) {
        console.error("Daily Data could not save:", err);
        showToast("Couldn't save. Your browser storage may be full.");
        indicator && (indicator.lastChild.textContent = " Save error");
      }
    }, 120);
  }
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
  }
  function getEntry(goalId, dateKey) {
    return data.entries[dateKey]?.[goalId] ?? null;
  }
  function setEntry(goalId, dateKey, value) {
    if (!data.entries[dateKey]) data.entries[dateKey] = {};
    if (value === null || value === undefined || value === "") {
      delete data.entries[dateKey][goalId];
      if (!Object.keys(data.entries[dateKey]).length) delete data.entries[dateKey];
    } else {
      data.entries[dateKey][goalId] = { value, updatedAt: new Date().toISOString() };
    }
    saveData();
  }
  function isGoalScheduled(goal, key) {
    const schedule = goal.schedule || { type: "daily" };
    if (schedule.type === "daily") return true;
    if (schedule.type === "days") return (schedule.days || []).includes(dayIndex(key));
    if (schedule.type === "weekly") return true;
    return true;
  }
  function goalCompleted(goal, key) {
    const entry = getEntry(goal.id, key);
    if (!entry) return false;
    if (goal.type === "boolean") return entry.value === true;
    return Number.isFinite(Number(entry.value)) && Number(entry.value) >= Number(goal.target || 0);
  }
  function weeklyCount(goal, weekStart) {
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const key = addDays(weekStart, i);
      const entry = getEntry(goal.id, key);
      if (!entry) continue;
      if (goal.type === "boolean" ? entry.value === true : Number(entry.value) > 0) count++;
    }
    return count;
  }
  function isDueToday(goal, key) {
    if (goal.schedule?.type === "weekly") return true;
    return isGoalScheduled(goal, key);
  }
  function goalMetForSchedule(goal, key) {
    if (goal.schedule?.type === "weekly") {
      return weeklyCount(goal, mondayOf(key)) >= Number(goal.schedule.times || 1);
    }
    return goalCompleted(goal, key);
  }
  function todaysGoals() {
    const today = localDateKey();
    return data.goals.filter(g => isDueToday(g, today));
  }
  function completedToday(goal, key = localDateKey()) {
    // A weekly-frequency goal is still completed day by day. Its weekly target
    // is tracked separately, so one check-in makes that day count as complete.
    return goalCompleted(goal, key);
  }
  function dateRange(start, length) {
    return Array.from({ length }, (_, i) => addDays(start, i));
  }
  function allRecordedValues(goal, keys) {
    return keys.map(k => getEntry(goal.id, k)).filter(Boolean).map(e => e.value);
  }
  function goalStats(goal) {
    const values = [];
    Object.entries(data.entries).forEach(([key, entries]) => {
      const entry = entries[goal.id];
      if (entry) values.push({ key, value: entry.value });
    });
    values.sort((a,b) => a.key.localeCompare(b.key));
    const numerical = values.filter(v => goal.type === "number" && Number.isFinite(Number(v.value))).map(v => Number(v.value));
    const total = goal.type === "number" ? numerical.reduce((a,b)=>a+b,0) : values.filter(v=>v.value===true).length;
    return { values, numerical, total, count: values.length, best: numerical.length ? Math.max(...numerical) : null };
  }
  function currentStreak(goal) {
    let cursor = localDateKey();
    let streak = 0;
    // A streak counts completed scheduled days. A weekly-frequency goal counts successful weeks.
    if (goal.schedule?.type === "weekly") {
      let week = mondayOf(cursor);
      for (let i = 0; i < 520; i++) {
        if (weeklyCount(goal, week) >= Number(goal.schedule.times || 1)) streak++;
        else if (i > 0 || localDateKey() > addDays(week, 6)) break;
        else break;
        week = addDays(week, -7);
      }
      return streak;
    }
    if (!goalCompleted(goal, cursor) && isGoalScheduled(goal, cursor)) cursor = addDays(cursor, -1);
    for (let i = 0; i < 1000; i++) {
      if (!isGoalScheduled(goal, cursor)) { cursor = addDays(cursor, -1); continue; }
      if (goalCompleted(goal, cursor)) streak++;
      else break;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }
  function longestStreak(goal) {
    if (goal.schedule?.type === "weekly") return 0;
    const keys = Object.keys(data.entries).sort();
    if (!keys.length) return 0;
    let start = keys[0], end = localDateKey(), best = 0, run = 0;
    for (let k = start; k <= end; k = addDays(k, 1)) {
      if (!isGoalScheduled(goal, k)) continue;
      if (goalCompleted(goal, k)) { run++; best = Math.max(best, run); }
      else run = 0;
    }
    return best;
  }
  function consistency(goal, start, end) {
    let due = 0, met = 0;
    for (let k = start; k <= end; k = addDays(k, 1)) {
      if (goal.schedule?.type === "weekly") continue;
      if (isGoalScheduled(goal, k)) { due++; if (goalCompleted(goal, k)) met++; }
    }
    if (goal.schedule?.type === "weekly") {
      let week = mondayOf(start);
      while (week <= end) {
        due++;
        if (weeklyCount(goal, week) >= Number(goal.schedule.times || 1)) met++;
        week = addDays(week, 7);
      }
    }
    return due ? Math.round(met / due * 100) : 0;
  }
  function updateAchievements() {
    let changed = false;
    const unlock = (id) => { if (!data.achievements[id]) { data.achievements[id] = new Date().toISOString(); changed = true; } };
    if (data.goals.length >= 1) unlock("first-goal");
    const totalEntries = Object.values(data.entries).reduce((sum, day) => sum + Object.keys(day).length, 0);
    if (totalEntries >= 7) unlock("seven-records");
    if (totalEntries >= 30) unlock("thirty-records");
    if (totalEntries >= 100) unlock("hundred-records");
    data.goals.forEach(g => {
      const s = goalStats(g);
      if (g.type === "number" && s.total >= 100) unlock("hundred-units");
      if (g.type === "number" && s.total >= 1000) unlock("thousand-units");
      if (g.type === "boolean" && s.total >= 25) unlock("twentyfive-checks");
      if (currentStreak(g) >= 7) unlock("seven-streak");
      if (currentStreak(g) >= 30) unlock("thirty-streak");
    });
    if (changed) saveData();
  }

  function renderHome() {
    const root = $("#home-view");
    const today = localDateKey();
    const goals = todaysGoals();
    const done = goals.filter(g => completedToday(g, today)).length;
    const percent = goals.length ? Math.round(done / goals.length * 100) : 0;
    const time = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, hour: "numeric", minute: "2-digit" }).format(new Date());
    root.innerHTML = `
      <div class="eyebrow">${escapeHtml(formatDate(today, { weekday:"long", day:"numeric", month:"long" }))} · ${escapeHtml(time)} Melbourne</div>
      <h1>Your day, your data.</h1>
      <p class="subtitle">A little progress adds up.</p>
      <div class="card progress-card">
        <div class="progress-top"><strong>Today's progress</strong><span class="progress-number">${done} / ${goals.length}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="progress-caption">${goals.length ? `${percent}% completed` : "Create your first goal to get started"}</div>
      </div>
      <div class="card">
        <div class="card-heading"><h2>Today's goals</h2><span class="muted small">${goals.length} ${goals.length === 1 ? "goal" : "goals"}</span></div>
        ${goals.length ? `<div class="goal-list">${goals.map(g => renderGoalRow(g, today)).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">✳</div><h3>No goals yet</h3><p class="small">Add a goal and start building your daily data.</p><button class="btn" data-go-new>＋ Create a goal</button></div>`}
      </div>
      <div class="card">
        <div class="card-heading"><h2>This week</h2><span class="muted small">${formatDate(mondayOf(today),{day:"numeric",month:"short"})} – ${formatDate(addDays(mondayOf(today),6),{day:"numeric",month:"short"})}</span></div>
        <div class="stat-grid">
          <div class="stat-tile"><div class="stat-label">Goals completed today</div><div class="stat-value">${done}/${goals.length}</div></div>
          <div class="stat-tile"><div class="stat-label">Goals you're tracking</div><div class="stat-value">${data.goals.length}</div></div>
        </div>
        <p class="muted small" style="margin:13px 0 0">Your week runs Monday to Sunday.</p>
      </div>`;
  }

  function renderGoalRow(goal, key) {
    const entry = getEntry(goal.id, key);
    const isWeekly = goal.schedule?.type === "weekly";
    const done = completedToday(goal, key);
    const meta = isWeekly ? `${weeklyCount(goal, mondayOf(key))}/${goal.schedule.times} times this week` :
      goal.type === "number" ? `Target: ${goal.target} ${goal.unit || ""}` : "Yes / No";
    if (goal.type === "boolean") {
      return `<div class="goal-row ${done ? "completed" : ""}">
        <button class="check-button ${entry?.value === true ? "checked" : ""}" data-toggle="${goal.id}" data-date="${key}" aria-label="Toggle ${escapeHtml(goal.name)}">${entry?.value === true ? "✓" : ""}</button>
        <div class="goal-info"><div class="goal-name">${escapeHtml(goal.name)}</div><div class="goal-meta">${meta}</div></div>
        ${done ? `<span class="muted small">Done</span>` : ""}
      </div>`;
    }
    return `<div class="goal-row ${done ? "completed" : ""}">
      <div class="goal-info"><div class="goal-name">${escapeHtml(goal.name)}</div><div class="goal-meta">${meta}</div></div>
      <div class="number-entry"><input type="number" min="0" step="any" inputmode="decimal" data-number="${goal.id}" data-date="${key}" value="${entry ? escapeHtml(entry.value) : ""}" placeholder="—" aria-label="Actual ${escapeHtml(goal.name)}"><span class="unit">${escapeHtml(goal.unit || "")}</span></div>
    </div>`;
  }

  function renderStats() {
    const root = $("#stats-view");
    if (!data.goals.length) {
      root.innerHTML = `<div class="eyebrow">Your progress</div><h1>Stats</h1><p class="subtitle">Your progress, brought to life.</p><div class="card empty-state"><div class="empty-icon">▥</div><h3>Your data will appear here</h3><p class="small">Create a goal and start recording results to see your statistics.</p><button class="btn" data-go-new>＋ Create a goal</button></div>`;
      return;
    }
    if (!data.goals.some(g => g.id === statsGoalId)) statsGoalId = data.goals[0].id;
    const goal = data.goals.find(g => g.id === statsGoalId);
    const today = localDateKey();
    const currentMonday = mondayOf(today);
    let start, keys, title, labels;
    if (statsPeriod === "daily") {
      start = addDays(currentMonday, periodOffset * 7);
      keys = dateRange(start, 7);
      title = `${formatDate(start,{day:"numeric",month:"short"})} – ${formatDate(addDays(start,6),{day:"numeric",month:"short",year:"numeric"})}`;
      labels = DAY_NAMES;
    } else if (statsPeriod === "weekly") {
      const monthDate = dateFromKey(today);
      monthDate.setDate(1);
      const first = mondayOf(keyFromDate(monthDate));
      const monthShift = new Date(monthDate.getFullYear(), monthDate.getMonth() + periodOffset, 1);
      const monthStart = mondayOf(keyFromDate(monthShift));
      const monthEnd = keyFromDate(new Date(monthShift.getFullYear(), monthShift.getMonth()+1, 0));
      keys = [];
      for (let w = monthStart, i = 0; w <= monthEnd && i < 6; w = addDays(w,7), i++) keys.push(w);
      title = monthShift.toLocaleDateString("en-AU",{month:"long",year:"numeric"});
      labels = keys.map((k,i)=>`W${i+1}`);
    } else {
      const d = dateFromKey(today);
      const year = d.getFullYear() + periodOffset;
      keys = Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,"0")}-01`);
      title = String(year);
      labels = ["J","F","M","A","M","J","J","A","S","O","N","D"];
    }
    const values = keys.map(k => {
      if (statsPeriod === "daily") {
        const e = getEntry(goal.id,k);
        return e ? (goal.type === "boolean" ? (e.value ? 1 : 0) : Number(e.value)) : null;
      }
      if (statsPeriod === "weekly") {
        return dateRange(k,7).reduce((sum,day)=> {
          const e = getEntry(goal.id,day);
          return sum + (e ? (goal.type === "boolean" ? (e.value ? 1 : 0) : Number(e.value)) : 0);
        },0);
      }
      const month = k.slice(0,7);
      return Object.entries(data.entries).reduce((sum,[day,entries])=>{
        if (day.slice(0,7)!==month || !entries[goal.id]) return sum;
        const v=entries[goal.id].value;
        return sum+(goal.type==="boolean"?(v?1:0):Number(v));
      },0);
    });
    const maxObserved = Math.max(1, ...values.filter(v=>v!==null).map(v=>v||0));
    const target = goal.type === "number" ? Number(goal.target || 0) : 1;
    const scaleMax = Math.max(maxObserved, target, 1) * 1.18;
    const averageValues = values.filter(v=>v!==null);
    const average = averageValues.length ? averageValues.reduce((a,b)=>a+b,0)/averageValues.length : null;
    const stat = goalStats(goal);
    const best = goal.type === "number" ? stat.best : null;
    const barHtml = values.map((v,i)=>{
      const h = v === null ? 2 : Math.max(v === 0 ? 2 : 5, v/scaleMax*100);
      const below = v !== null && v < target;
      return `<div class="chart-column"><div class="bar-wrap"><div class="bar ${v===null?"empty":below?"below":""}" style="height:${h}%">${v!==null?`<span class="bar-value">${formatNumber(v)}</span>`:""}</div></div><span class="chart-label">${labels[i]}</span></div>`;
    }).join("");
    const unit = goal.type === "number" ? ` ${escapeHtml(goal.unit || "")}` : "";
    const consistencyStart = addDays(currentMonday,-27), consistencyEnd=today;
    root.innerHTML = `
      <div class="eyebrow">Your progress</div><h1>Stats</h1><p class="subtitle">See the patterns. Celebrate the progress.</p>
      <div class="card">
        <div class="field"><label for="stats-goal">Choose a goal</label><select id="stats-goal">${data.goals.map(g=>`<option value="${g.id}" ${g.id===goal.id?"selected":""}>${escapeHtml(g.name)}</option>`).join("")}</select></div>
        <div class="controls"><div class="segmented" id="period-switch"><button data-period="daily" class="${statsPeriod==="daily"?"active":""}">Daily</button><button data-period="weekly" class="${statsPeriod==="weekly"?"active":""}">Weekly</button><button data-period="monthly" class="${statsPeriod==="monthly"?"active":""}">Monthly</button></div></div>
        <div class="period-nav"><button class="arrow-btn" data-period-shift="-1" aria-label="Previous period">‹</button><strong>${escapeHtml(title)}</strong><button class="arrow-btn" data-period-shift="1" aria-label="Next period" ${periodOffset>=0?"disabled":""}>›</button></div>
        <div class="card-heading"><h3>${escapeHtml(goal.name)}</h3><span class="muted small">${goal.type==="number"?`Target: ${goal.target}${unit}`:"Completed"}</span></div>
        <div class="chart">${barHtml}</div>
        ${goal.type==="number"?`<div class="chart-legend"><span><i class="legend-dot green"></i>At / above target</span><span><i class="legend-dot amber"></i>Below target</span><span><i class="legend-dot" style="background:#363a43"></i>No entry</span></div>`:""}
      </div>
      <div class="stat-grid">
        <div class="stat-tile"><div class="stat-label">${statsPeriod==="daily"?"Average per recorded day":"Average per period"}</div><div class="stat-value">${average===null?"—":formatNumber(average)+(goal.type==="number"?unit:"")}</div></div>
        <div class="stat-tile"><div class="stat-label">All-time total</div><div class="stat-value">${formatNumber(stat.total)}${goal.type==="number"?unit:""}</div></div>
        <div class="stat-tile"><div class="stat-label">Current streak</div><div class="stat-value">${currentStreak(goal)} <span class="small muted"> ${goal.schedule?.type==="weekly"?"weeks":"days"}</span></div></div>
        <div class="stat-tile"><div class="stat-label">${goal.type==="number"?"Personal record":"Longest streak"}</div><div class="stat-value">${goal.type==="number"?(best===null?"—":formatNumber(best)+unit):`${longestStreak(goal)} days`}</div></div>
      </div>
      <div class="card section-gap"><div class="card-heading"><h2>Consistency</h2><span class="muted small">Last 4 weeks</span></div><div class="stat-value">${consistency(goal,consistencyStart,consistencyEnd)}%</div><div class="progress-track"><div class="progress-fill" style="width:${consistency(goal,consistencyStart,consistencyEnd)}%"></div></div><p class="muted small" style="margin:10px 0 0">Based on scheduled days or weekly targets achieved.</p></div>
      <div class="card section-gap"><div class="card-heading"><h2>Calendar</h2><div class="manage-actions"><button class="arrow-btn" data-month-shift="-1">‹</button><button class="arrow-btn" data-month-shift="1">›</button></div></div>${renderCalendar(goal)}</div>
      <div class="card"><div class="card-heading"><h2>Achievements</h2><span class="muted small">${Object.keys(data.achievements).length} unlocked</span></div>${renderAchievements()}</div>`;
  }

  function formatNumber(n) { return Number(n).toLocaleString("en-AU",{maximumFractionDigits:1}); }
  function renderCalendar(goal) {
    const [y,m]=calendarMonth.split("-").map(Number);
    const firstKey=`${calendarMonth}-01`;
    const start=mondayOf(firstKey);
    const daysInMonth=new Date(y,m,0).getDate();
    const cells=[];
    for(let i=0;i<42;i++){
      const key=addDays(start,i);
      const inMonth=key.slice(0,7)===calendarMonth;
      const entry=getEntry(goal.id,key);
      const done=goalCompleted(goal,key);
      cells.push(`<div class="calendar-cell ${inMonth?"":"outside"} ${key===localDateKey()?"today":""}" title="${formatDate(key)}${entry?`: ${escapeHtml(entry.value)}`:""}"><span>${dateFromKey(key).getDate()}</span>${done?'<i class="calendar-dot"></i>':""}</div>`);
    }
    return `<div class="card-heading"><strong>${new Date(y,m-1,1).toLocaleDateString("en-AU",{month:"long",year:"numeric"})}</strong></div><div class="calendar-grid">${DAY_NAMES.map(d=>`<div class="calendar-day-label">${d[0]}</div>`).join("")}${cells.join("")}</div><p class="muted small" style="margin:12px 0 0">Green dots mark days where this goal reached its target.</p>`;
  }
  function renderAchievements() {
    const items=[
      ["first-goal","🌱","First step","Create your first goal."],
      ["seven-records","🗓️","Getting consistent","Record 7 goal results."],
      ["thirty-records","📈","Building momentum","Record 30 goal results."],
      ["hundred-records","💯","Data collector","Record 100 goal results."],
      ["hundred-units","🔢","Triple digits","Reach 100 total units on a numerical goal."],
      ["thousand-units","🚀","Four digits","Reach 1,000 total units on a numerical goal."],
      ["twentyfive-checks","🐾","Making it a habit","Complete a yes/no goal 25 times."],
      ["seven-streak","🔥","One whole week","Reach a 7-day streak."],
      ["thirty-streak","🏆","A month of momentum","Reach a 30-day streak."]
    ];
    return `<div class="achievement-list">${items.map(([id,icon,title,desc])=>`<div class="achievement ${data.achievements[id]?"":"locked"}"><div class="achievement-icon">${icon}</div><div class="achievement-copy"><strong>${title}</strong><span>${desc}</span></div><span class="small">${data.achievements[id]?"✓":"🔒"}</span></div>`).join("")}</div>`;
  }

  function renderNew() {
    const root=$("#new-view");
    root.innerHTML=`
      <div class="eyebrow">Build your routine</div><h1>New goal</h1><p class="subtitle">Choose what matters. We'll help you track it.</p>
      <form class="card" id="goal-form">
        <div class="form-grid">
          <div class="field full-width"><label for="goal-name">Goal name</label><input id="goal-name" name="name" maxlength="48" placeholder="e.g. Push-ups" required></div>
          <div class="field full-width"><label>Goal type</label><div class="segmented"><button type="button" class="active" data-type="number">Numerical</button><button type="button" data-type="boolean">Yes / No</button></div><input type="hidden" name="type" value="number"></div>
          <div class="field" data-field="target"><label for="goal-target">Target</label><input id="goal-target" name="target" type="number" min="0" step="any" placeholder="e.g. 20"></div>
          <div class="field" data-field="unit"><label for="goal-unit">Unit</label><input id="goal-unit" name="unit" maxlength="20" placeholder="e.g. push-ups"></div>
          <div class="field full-width"><label>Frequency</label><div class="segmented"><button type="button" class="active" data-frequency="daily">Every day</button><button type="button" data-frequency="days">Selected days</button><button type="button" data-frequency="weekly">Times per week</button></div><input type="hidden" name="frequency" value="daily"></div>
          <div class="field full-width hidden-field" data-field="days"><label>Choose days</label><div class="day-picker">${DAY_NAMES.map((d,i)=>`<button type="button" class="day-chip ${i<5?"selected":""}" data-day="${i}">${d}</button>`).join("")}</div></div>
          <div class="field hidden-field" data-field="times"><label for="goal-times">Times per week</label><input id="goal-times" name="times" type="number" min="1" max="7" value="3"></div>
        </div>
        <button class="btn full" style="margin-top:20px" type="submit">＋ Create goal</button>
      </form>
      <div class="card"><div class="card-heading"><h2>Your goals</h2><span class="muted small">${data.goals.length} total</span></div>${data.goals.length?`<div class="goal-management-list">${data.goals.map(g=>`<div class="manage-goal"><div class="goal-info"><div class="goal-name">${escapeHtml(g.name)}</div><div class="goal-meta">${g.type==="number"?`${escapeHtml(g.target)} ${escapeHtml(g.unit||"")} · `:""}${frequencyLabel(g)}</div></div><div class="manage-actions"><button class="mini-button" data-edit="${g.id}">Edit</button><button class="mini-button" data-delete="${g.id}">Delete</button></div></div>`).join("")}</div>`:`<div class="empty-state"><p class="small">Your goals will appear here.</p></div>`}</div>`;
  }
  function frequencyLabel(g) {
    if(g.schedule?.type==="daily") return "Every day";
    if(g.schedule?.type==="days") return (g.schedule.days||[]).map(i=>DAY_NAMES[i]).join(", ");
    return `${g.schedule.times} times per week`;
  }

  function openModal(content) {
    $("#modal").innerHTML=content;
    $("#modal-backdrop").classList.remove("hidden");
  }
  function closeModal() { $("#modal-backdrop").classList.add("hidden"); }
  function renderSettings() {
    openModal(`<div class="modal-header"><div><div class="eyebrow">Preferences</div><h2>Settings</h2></div><button class="modal-close" data-close>×</button></div>
      <div class="settings-row"><div><strong>Data storage</strong><div class="muted small">Saved automatically in this browser</div></div><span class="small" style="color:var(--green)">On</span></div>
      <div class="settings-row"><div><strong>Timezone</strong><div class="muted small">Australia / Melbourne</div></div></div>
      <div class="settings-row"><div><strong>Week starts</strong><div class="muted small">Monday</div></div></div>
      <div class="settings-row"><div><strong>Export your data</strong><div class="muted small">Download a backup of goals and results</div></div><button class="btn secondary" data-export>Export</button></div>
      <div class="settings-row"><div><strong>Import backup</strong><div class="muted small">Restore a previously exported backup</div></div><button class="btn secondary" data-import>Import</button></div>
      <div class="modal-actions"><button class="btn secondary" data-close>Close</button></div>`);
  }
  function exportData() {
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`daily-data-backup-${localDateKey()}.json`; a.click();
    URL.revokeObjectURL(url); showToast("Backup downloaded.");
  }
  function importData(file) {
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const imported=JSON.parse(reader.result);
        if(!imported||!Array.isArray(imported.goals)||typeof imported.entries!=="object") throw new Error("Invalid backup");
        if(!confirm("Importing replaces the data currently stored in this browser. Continue?")) return;
        data={...defaultData(),...imported}; saveData(); closeModal(); renderAll(); showToast("Backup imported.");
      }catch(e){showToast("That file doesn't look like a Daily Data backup.");}
    };
    reader.readAsText(file);
  }

  function showWeeklyReport() {
    const today=localDateKey();
    if(dayIndex(today)!==6) return;
    const week=mondayOf(today);
    if(data.reportSeen[week]) return;
    const weekKeys=dateRange(week,7);
    const rows=data.goals.map(g=>{
      const due=g.schedule?.type==="weekly"?1:weekKeys.filter(k=>isGoalScheduled(g,k)).length;
      const met=g.schedule?.type==="weekly"?(weeklyCount(g,week)>=Number(g.schedule.times||1)?1:0):weekKeys.filter(k=>goalCompleted(g,k)).length;
      const vals=allRecordedValues(g,weekKeys);
      const total=g.type==="number"?vals.reduce((s,v)=>s+Number(v),0):vals.filter(v=>v===true).length;
      return {g,due,met,total};
    });
    const dueTotal=rows.reduce((s,r)=>s+r.due,0);
    const metTotal=rows.reduce((s,r)=>s+r.met,0);
    const pct=dueTotal?Math.round(metTotal/dueTotal*100):0;
    openModal(`<div class="modal-header"><div><div class="eyebrow">Your week in review</div><h2>Weekly report</h2><div class="muted small">${formatDate(week,{day:"numeric",month:"short"})} – ${formatDate(addDays(week,6),{day:"numeric",month:"short",year:"numeric"})}</div></div><button class="modal-close" data-close>×</button></div>
      <div class="report-highlight"><span class="muted small">Overall completion</span><strong>${pct}%</strong><span class="muted small">${metTotal} of ${dueTotal} scheduled goal targets achieved</span></div>
      ${rows.length?rows.map(r=>`<div class="settings-row"><div><strong>${escapeHtml(r.g.name)}</strong><div class="muted small">${r.met}/${r.due} target${r.due===1?"":"s"} achieved</div></div><strong>${r.g.type==="number"?formatNumber(r.total)+" "+escapeHtml(r.g.unit||""):r.total+" completed"}</strong></div>`).join(""):`<p class="muted small">You haven't created any goals yet.</p>`}
      <div class="modal-actions"><button class="btn" data-report-done>Done</button></div>`);
  }

  function renderAll() {
    updateAchievements();
    renderHome(); renderStats(); renderNew();
    $$(".view").forEach(v=>v.classList.toggle("active",v.id===`${activeTab}-view`));
    $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===activeTab));
  }
  function switchTab(tab) {
    activeTab=tab;
    renderAll();
  }

  document.addEventListener("click", e=>{
    const nav=e.target.closest("[data-tab]");
    if(nav){switchTab(nav.dataset.tab);return;}
    if(e.target.closest("[data-go-new]")){switchTab("new");return;}
    const toggle=e.target.closest("[data-toggle]");
    if(toggle){
      const id=toggle.dataset.toggle,key=toggle.dataset.date;
      const current=getEntry(id,key);
      setEntry(id,key,current?.value===true?null:true);
      renderAll(); return;
    }
    const period=e.target.closest("[data-period]");
    if(period){statsPeriod=period.dataset.period;periodOffset=0;renderStats();return;}
    const shift=e.target.closest("[data-period-shift]");
    if(shift){periodOffset=Math.min(0,periodOffset+Number(shift.dataset.periodShift));renderStats();return;}
    const monthShift=e.target.closest("[data-month-shift]");
    if(monthShift){const [y,m]=calendarMonth.split("-").map(Number);const d=new Date(y,m-1+Number(monthShift.dataset.monthShift),1);calendarMonth=keyFromDate(d).slice(0,7);renderStats();return;}
    const type=e.target.closest("[data-type]");
    if(type){
      const form=type.closest("form");
      if(!form) return;
      $$("[data-type]",form).forEach(b=>b.classList.toggle("active",b===type));
      form.elements.type.value=type.dataset.type;
      const showNumber=type.dataset.type==="number";
      form.querySelector('[data-field="target"]')?.classList.toggle("hidden-field",!showNumber);
      form.querySelector('[data-field="unit"]')?.classList.toggle("hidden-field",!showNumber);
      const targetInput=form.elements.target;
      if(targetInput) targetInput.required=showNumber;
      return;
    }
    const freq=e.target.closest("[data-frequency]");
    if(freq){
      const form=freq.closest("form");
      if(!form) return;
      $$("[data-frequency]",form).forEach(b=>b.classList.toggle("active",b===freq));
      form.elements.frequency.value=freq.dataset.frequency;
      form.querySelector('[data-field="days"]')?.classList.toggle("hidden-field",freq.dataset.frequency!=="days");
      form.querySelector('[data-field="times"]')?.classList.toggle("hidden-field",freq.dataset.frequency!=="weekly");
      return;
    }
    const day=e.target.closest("[data-day]");
    if(day){day.classList.toggle("selected");return;}
    const close=e.target.closest("[data-close]");
    if(close){closeModal();return;}
    if(e.target.closest("[data-export]")){exportData();return;}
    if(e.target.closest("[data-import]")){$("#import-file")?.click();return;}
    if(e.target.closest("[data-report-done]")){
      data.reportSeen[mondayOf(localDateKey())]=true;saveData();closeModal();return;
    }
    const del=e.target.closest("[data-delete]");
    if(del){
      const goal=data.goals.find(g=>g.id===del.dataset.delete);
      if(!goal||!confirm(`Delete "${goal.name}" and all its recorded results? This cannot be undone unless you have an export backup.`))return;
      data.goals=data.goals.filter(g=>g.id!==goal.id);
      Object.keys(data.entries).forEach(k=>{delete data.entries[k][goal.id];if(!Object.keys(data.entries[k]).length)delete data.entries[k];});
      saveData();renderAll();showToast("Goal deleted.");return;
    }
    const edit=e.target.closest("[data-edit]");
    if(edit){editGoal(edit.dataset.edit);return;}
  });

  document.addEventListener("change", e=>{
    if(e.target.id==="stats-goal"){statsGoalId=e.target.value;renderStats();return;}
    if(e.target.matches("[data-number]")){
      const val=e.target.value;
      setEntry(e.target.dataset.number,e.target.dataset.date,val===""?null:Number(val));
      renderHome();renderStats();renderNew();
      return;
    }
    if(e.target.id==="import-file"&&e.target.files[0])importData(e.target.files[0]);
  });
  document.addEventListener("input", e=>{
    if(e.target.matches("[data-number]")){
      const id=e.target.dataset.number,key=e.target.dataset.date,val=e.target.value;
      if(val==="") { setEntry(id,key,null); }
      else if(Number.isFinite(Number(val)) && Number(val)>=0) setEntry(id,key,Number(val));
    }
  });

  document.addEventListener("submit", e=>{
    if(e.target.id!=="goal-form") return;
    e.preventDefault();
    const form=e.target;
    const name=form.elements.name.value.trim();
    const type=form.elements.type.value;
    const frequency=form.elements.frequency.value;
    if(!name){showToast("Give your goal a name.");return;}
    const target=Number(form.elements.target.value);
    if(type==="number"&&(!form.elements.target.value||!Number.isFinite(target)||target<0)){showToast("Enter a valid numerical target.");return;}
    const schedule=readSchedule(form);
    if(!schedule) return;
    data.goals.push({id:uid(),name,type,target:type==="number"?target:null,unit:type==="number"?form.elements.unit.value.trim():"",schedule,createdAt:localDateKey()});
    saveData();showToast("Goal created.");switchTab("home");
  });

  function readSchedule(form) {
    const frequency=form.elements.frequency.value;
    if(frequency==="days"){
      const days=$$("[data-day].selected",form).map(b=>Number(b.dataset.day));
      if(!days.length){showToast("Choose at least one day.");return null;}
      return {type:"days",days};
    }
    if(frequency==="weekly"){
      const times=Number(form.elements.times.value);
      if(!Number.isInteger(times)||times<1||times>7){showToast("Choose between 1 and 7 times per week.");return null;}
      return {type:"weekly",times};
    }
    return {type:"daily"};
  }

  function editGoal(id) {
    const g=data.goals.find(x=>x.id===id); if(!g)return;
    const schedule=g.schedule||{type:"daily"};
    const frequency=schedule.type||"daily";
    const selectedDays=frequency==="days"?(schedule.days||[]):[0,1,2,3,4];
    openModal(`<div class="modal-header"><div><div class="eyebrow">Goal settings</div><h2>Edit goal</h2></div><button class="modal-close" data-close>×</button></div>
      <form id="edit-form" data-id="${g.id}">
        <div class="form-grid">
          <div class="field full-width"><label>Goal name</label><input name="name" maxlength="48" required value="${escapeHtml(g.name)}"></div>
          <div class="field full-width"><label>Goal type</label><div class="segmented"><button type="button" class="${g.type==="number"?"active":""}" data-type="number">Numerical</button><button type="button" class="${g.type==="boolean"?"active":""}" data-type="boolean">Yes / No</button></div><input type="hidden" name="type" value="${g.type}"></div>
          <div class="field ${g.type==="number"?"":"hidden-field"}" data-field="target"><label>Target</label><input name="target" type="number" min="0" step="any" value="${g.target??""}" ${g.type==="number"?"required":""}></div>
          <div class="field ${g.type==="number"?"":"hidden-field"}" data-field="unit"><label>Unit</label><input name="unit" maxlength="20" value="${escapeHtml(g.unit||"")}"></div>
          <div class="field full-width"><label>Frequency</label><div class="segmented"><button type="button" class="${frequency==="daily"?"active":""}" data-frequency="daily">Every day</button><button type="button" class="${frequency==="days"?"active":""}" data-frequency="days">Selected days</button><button type="button" class="${frequency==="weekly"?"active":""}" data-frequency="weekly">Times per week</button></div><input type="hidden" name="frequency" value="${frequency}"></div>
          <div class="field full-width ${frequency==="days"?"":"hidden-field"}" data-field="days"><label>Choose days</label><div class="day-picker">${DAY_NAMES.map((d,i)=>`<button type="button" class="day-chip ${selectedDays.includes(i)?"selected":""}" data-day="${i}">${d}</button>`).join("")}</div></div>
          <div class="field ${frequency==="weekly"?"":"hidden-field"}" data-field="times"><label>Times per week</label><input name="times" type="number" min="1" max="7" value="${frequency==="weekly"?schedule.times:3}"></div>
        </div>
        <p class="muted small" style="margin-top:12px">Changing the goal type converts existing records to preserve whether each day was completed.</p>
        <div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save changes</button></div>
      </form>`);
  }
  document.addEventListener("submit",e=>{
    if(e.target.id!=="edit-form")return;
    e.preventDefault();
    const form=e.target;
    const g=data.goals.find(x=>x.id===form.dataset.id);if(!g)return;
    const name=form.elements.name.value.trim();
    const type=form.elements.type.value;
    if(!name){showToast("Give your goal a name.");return;}
    const target=Number(form.elements.target.value);
    if(type==="number"&&(!form.elements.target.value||!Number.isFinite(target)||target<0)){showToast("Enter a valid numerical target.");return;}
    const schedule=readSchedule(form);if(!schedule)return;
    if(type!==g.type){
      Object.values(data.entries).forEach(day=>{
        const entry=day[g.id];if(!entry)return;
        if(type==="number") entry.value=entry.value===true?target:0;
        else entry.value=Number(entry.value)>=Number(g.target||0);
      });
    }
    g.name=name;g.type=type;g.target=type==="number"?target:null;
    g.unit=type==="number"?form.elements.unit.value.trim():"";
    g.schedule=schedule;
    saveData();closeModal();renderAll();showToast("Goal updated.");
  });

  $("#settings-button").addEventListener("click",renderSettings);
  $("#modal-backdrop").addEventListener("click",e=>{if(e.target.id==="modal-backdrop")closeModal();});

  // Add a hidden file input for restoring an exported backup.
  const importInput=document.createElement("input");
  importInput.type="file";importInput.id="import-file";importInput.accept="application/json";importInput.hidden=true;
  document.body.appendChild(importInput);

  // Ensure the local save is written when the page is closed or backgrounded.
  window.addEventListener("pagehide",()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(e){console.error(e);}});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(e){console.error(e);}}});

  renderAll();
  showWeeklyReport();
})();