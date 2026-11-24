(() => {
  "use strict";

  const MELBOURNE_TZ = "Australia/Melbourne";
  const firebaseConfig = {
    apiKey: "AIzaSyDdCnhyt6cDli3_17Lf3rDyb7iftGom3uM",
    authDomain: "daily-data-18890.firebaseapp.com",
    projectId: "daily-data-18890",
    storageBucket: "daily-data-18890.firebasestorage.app",
    messagingSenderId: "298053802834",
    appId: "1:298053802834:web:9f7a0b94032291a17cb88b"
  };
  const firebaseApp = firebase.initializeApp(firebaseConfig);
  const auth = firebaseApp.auth();
  const firestore = firebaseApp.firestore();
  auth.languageCode = "en";
  let currentUser = null;
  let cloudReady = false;
  let authMode = "signin";
  let authBusy = false;
  let saveVersion = 0;
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const LONG_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const GOAL_COLOURS = [
    { id: "green", name: "Green", hex: "#39ce91" },
    { id: "blue", name: "Blue", hex: "#69a9ff" },
    { id: "purple", name: "Purple", hex: "#b69aff" },
    { id: "pink", name: "Pink", hex: "#f28ab2" },
    { id: "orange", name: "Orange", hex: "#f2a65a" },
    { id: "yellow", name: "Yellow", hex: "#e6c85c" },
    { id: "cyan", name: "Cyan", hex: "#59c8d8" },
    { id: "red", name: "Red", hex: "#ed7777" }
  ];
  const HOME_SECTIONS = [
    { id: "progress", label: "Today's progress" },
    { id: "goals", label: "Daily goals" },
    { id: "weeklyGoals", label: "Weekly goals" },
    { id: "week", label: "This week" }
  ];
  function normaliseDashboard() {
    if (!data.dashboard || typeof data.dashboard !== "object") data.dashboard = {};
    const valid = HOME_SECTIONS.map(x => x.id);
    const order = Array.isArray(data.dashboard.order) ? data.dashboard.order.filter(x => valid.includes(x)) : [];
    data.dashboard.order = [...order, ...valid.filter(x => !order.includes(x))];
    if (!Array.isArray(data.dashboard.hidden)) data.dashboard.hidden = [];
    data.dashboard.hidden = data.dashboard.hidden.filter(x => valid.includes(x));
  }
  function goalColour(goal) {
    return GOAL_COLOURS.find(c => c.id === goal.colour)?.hex || GOAL_COLOURS[0].hex;
  }
  function colourOptions(selected = "green") {
    return GOAL_COLOURS.map(c => `<option value="${c.id}" ${selected === c.id ? "selected" : ""}>${c.name}</option>`).join("");
  }
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
  let data = defaultData();
  normaliseDashboard();
  let activeTab = "home";
  let statsGoalId = "";
  let statsPeriod = "daily";
  let periodOffset = 0;
  let calendarMonth = localDateKey().slice(0, 7);
  let toastTimer = null;
  let saveTimer = null;

  function setSaveLabel(label, saving = false, error = false) {
    const indicator = $("#save-indicator");
    if (!indicator) return;
    indicator.classList.toggle("saving", saving);
    indicator.classList.toggle("save-error", error);
    indicator.lastChild.textContent = ` ${label}`;
  }

  function userDataRef(user = currentUser) {
    if (!user) throw new Error("No signed-in user.");
    return firestore.collection("users").doc(user.uid).collection("appData").doc("main");
  }

  async function loadCloudData(user) {
    cloudReady = false;
    setSaveLabel("Loading…", true);
    const ref = userDataRef(user);
    const snapshot = await ref.get();
    if (auth.currentUser?.uid !== user.uid) return;
    if (snapshot.exists && snapshot.data()?.data) {
      data = { ...defaultData(), ...snapshot.data().data };
    } else {
      // Each account starts fresh. No previous browser data is imported.
      data = defaultData();
      await ref.set({ data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    normaliseDashboard();
    data.goals.forEach(g => { if (!GOAL_COLOURS.some(c => c.id === g.colour)) g.colour = "green"; });
    cloudReady = true;
    setSaveLabel("Saved");
    renderAll();
    showWeeklyReport();
  }

  function saveData() {
    if (!cloudReady || !currentUser) return;
    const version = ++saveVersion;
    setSaveLabel("Saving…", true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const user = currentUser;
      if (!user || !cloudReady) return;
      try {
        await userDataRef(user).set({
          data: JSON.parse(JSON.stringify(data)),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (version === saveVersion && currentUser?.uid === user.uid) setSaveLabel("Saved");
      } catch (err) {
        console.error("Daily Data cloud save failed:", err);
        if (version === saveVersion) setSaveLabel("Save error", false, true);
        showToast("Couldn't sync your data. Check your connection and try again.");
      }
    }, 350);
  }

  function authErrorMessage(error) {
    const messages = {
      "auth/email-already-in-use": "That email already has an account. Try signing in instead.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/weak-password": "Choose a stronger password with at least 6 characters.",
      "auth/user-not-found": "We couldn't find an account with that email.",
      "auth/wrong-password": "That email and password combination doesn't match.",
      "auth/invalid-credential": "That email and password combination doesn't match.",
      "auth/too-many-requests": "Too many attempts. Please wait a little before trying again.",
      "auth/network-request-failed": "Connection problem. Check your internet and try again.",
      "auth/operation-not-allowed": "Email/password sign-in hasn't been enabled in Firebase yet.",
      "auth/unauthorized-domain": "This website domain hasn't been authorised in Firebase yet."
    };
    return messages[error?.code] || "Something went wrong. Please try again.";
  }

  function showAuthScreen(mode = "signin", message = "") {
    authMode = mode;
    const screen = $("#auth-screen");
    const appShell = $(".app-shell");
    screen.classList.remove("hidden");
    appShell.classList.add("app-hidden");
    const emailValue = $("#auth-email")?.value || "";
    const titles = {
      signin: ["Welcome back.", "Sign in to open your Daily Data."],
      signup: ["Create your account.", "Your goals and progress, saved wherever you go."],
      verify: ["Check your inbox.", "Verify your email address before entering Daily Data."],
      loading: ["Loading your data.", "Connecting securely to your account…"]
    };
    const [title, subtitle] = titles[mode];
    let content = `<div class="auth-brand">daily data<span>.</span></div><div class="auth-card"><div class="eyebrow">Your personal progress space</div><h1>${title}</h1><p class="subtitle">${subtitle}</p>`;
    if (mode === "loading") {
      content += `<div class="auth-loading"><span class="auth-spinner"></span><span>One moment…</span></div>`;
    } else if (mode === "verify") {
      content += `<div class="auth-notice"><strong>Verification email sent to</strong><br>${escapeHtml(currentUser?.email || "your email address")}</div><p class="auth-help">Open the email from Firebase and click its verification link. If you can't see it, check your junk or spam folder.</p><div class="auth-actions"><button class="btn full" id="check-verification">I've verified my email</button><button class="btn secondary full" id="resend-verification">Resend verification email</button><button class="text-button" id="auth-signout">Use a different email / sign out</button></div>`;
    } else {
      content += `<form id="auth-form" class="auth-form"><div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required value="${escapeHtml(emailValue)}" placeholder="you@example.com"></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" minlength="6" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required placeholder="At least 6 characters"></div>${mode === "signup" ? `<div class="auth-small-note">You'll need to verify your email before using Daily Data.</div>` : `<button type="button" class="text-button auth-forgot" id="forgot-password">Forgot password?</button>`}<button class="btn full" type="submit" ${authBusy ? "disabled" : ""}>${mode === "signup" ? "Create account" : "Sign in"}</button></form><div class="auth-switch">${mode === "signup" ? `Already have an account? <button class="text-button" id="show-signin">Sign in</button>` : `New to Daily Data? <button class="text-button" id="show-signup">Create an account</button>`}</div>`;
    }
    if (message) content += `<div class="auth-message" role="alert">${escapeHtml(message)}</div>`;
    content += `</div><p class="auth-footnote">Your account keeps your Daily Data private and in sync.</p>`;
    screen.innerHTML = content;
    screen.querySelector("#auth-form")?.addEventListener("submit", handleAuthSubmit);
    screen.querySelector("#show-signup")?.addEventListener("click", () => showAuthScreen("signup"));
    screen.querySelector("#show-signin")?.addEventListener("click", () => showAuthScreen("signin"));
    screen.querySelector("#forgot-password")?.addEventListener("click", handlePasswordReset);
    screen.querySelector("#resend-verification")?.addEventListener("click", resendVerification);
    screen.querySelector("#check-verification")?.addEventListener("click", checkVerification);
    screen.querySelector("#auth-signout")?.addEventListener("click", () => auth.signOut());
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (authBusy) return;
    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const requestedMode = authMode;
    authBusy = true;
    showAuthScreen("loading");
    try {
      if (requestedMode === "signup") {
        const credential = await auth.createUserWithEmailAndPassword(email, password);
        currentUser = credential.user;
        await credential.user.sendEmailVerification({ url: window.location.origin + window.location.pathname });
        showAuthScreen("verify", "Your account has been created. We've sent a verification email.");
      } else {
        const credential = await auth.signInWithEmailAndPassword(email, password);
        currentUser = credential.user;
        if (!credential.user.emailVerified) showAuthScreen("verify", "Your email hasn't been verified yet. Check your inbox for the link.");
      }
    } catch (error) {
      console.error("Authentication error:", error);
      showAuthScreen(requestedMode, authErrorMessage(error));
    } finally {
      authBusy = false;
    }
  }

  async function resendVerification() {
    if (!currentUser) return;
    try {
      await currentUser.sendEmailVerification({ url: window.location.origin + window.location.pathname });
      showAuthScreen("verify", "Another verification email has been sent.");
    } catch (error) {
      showAuthScreen("verify", authErrorMessage(error));
    }
  }

  async function checkVerification() {
    if (!auth.currentUser) return;
    try {
      await auth.currentUser.reload();
      currentUser = auth.currentUser;
      if (currentUser.emailVerified) {
        // Refresh the ID token so Firestore sees the updated email_verified claim.
        await currentUser.getIdToken(true);
        showAuthScreen("loading");
        await loadCloudData(currentUser);
        $("#auth-screen").classList.add("hidden");
        $(".app-shell").classList.remove("app-hidden");
      } else {
        showAuthScreen("verify", "Firebase hasn't confirmed verification yet. Open the email link, then try again.");
      }
    } catch (error) {
      showAuthScreen("verify", authErrorMessage(error));
    }
  }

  async function handlePasswordReset() {
    const email = $("#auth-email")?.value.trim();
    if (!email) {
      showAuthScreen("signin", "Enter your email address first, then choose Forgot password.");
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      showAuthScreen("signin", "If an account exists for that address, a password reset email has been sent.");
    } catch (error) {
      showAuthScreen("signin", authErrorMessage(error));
    }
  }

  auth.onAuthStateChanged(async user => {
    currentUser = user;
    cloudReady = false;
    clearTimeout(saveTimer);
    if (!user) {
      data = defaultData();
      showAuthScreen("signin");
      return;
    }
    if (!user.emailVerified) {
      showAuthScreen("verify");
      return;
    }
    showAuthScreen("loading");
    try {
      // Ensure Firestore security rules receive the latest verified-email claim.
      await user.getIdToken(true);
      await loadCloudData(user);
      if (auth.currentUser?.uid === user.uid) {
        $("#auth-screen").classList.add("hidden");
        $(".app-shell").classList.remove("app-hidden");
      }
    } catch (error) {
      console.error("Could not load account data:", error);
      showAuthScreen("signin", "We couldn't load your account data. Check your connection and try again.");
      await auth.signOut();
    }
  });

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
    if (data.goals.length >= 3) unlock("three-goals");
    if (data.goals.length >= 5) unlock("five-goals");
    if (data.goals.length >= 10) unlock("ten-goals");
    const totalEntries = Object.values(data.entries).reduce((sum, day) => sum + Object.keys(day).length, 0);
    const activeDays = Object.values(data.entries).filter(day => Object.keys(day).length > 0).length;
    if (totalEntries >= 7) unlock("seven-records");
    if (totalEntries >= 30) unlock("thirty-records");
    if (totalEntries >= 50) unlock("fifty-records");
    if (totalEntries >= 100) unlock("hundred-records");
    if (totalEntries >= 250) unlock("twofifty-records");
    if (activeDays >= 7) unlock("seven-active-days");
    if (activeDays >= 30) unlock("thirty-active-days");
    if (data.goals.some(g => g.type === "number") && data.goals.some(g => g.type === "boolean")) unlock("mix-it-up");
    data.goals.forEach(g => {
      const stats = goalStats(g);
      const streak = currentStreak(g);
      if (g.type === "number" && stats.total >= 100) unlock("hundred-units");
      if (g.type === "number" && stats.total >= 1000) unlock("thousand-units");
      if (g.type === "boolean" && stats.total >= 25) unlock("twentyfive-checks");
      if (streak >= 3) unlock("three-streak");
      if (streak >= 7) unlock("seven-streak");
      if (streak >= 30) unlock("thirty-streak");
      if (streak >= 100) unlock("hundred-streak");
    });
    // A completed week means every scheduled daily goal and every weekly target was met.
    const thisMonday = mondayOf(localDateKey());
    const lastMonday = addDays(thisMonday, -7);
    const lastWeek = dateRange(lastMonday, 7);
    const scheduled = data.goals.filter(g => g.schedule?.type === "weekly" || lastWeek.some(k => isGoalScheduled(g, k)));
    if (scheduled.length && scheduled.every(g => g.schedule?.type === "weekly"
      ? weeklyCount(g, lastMonday) >= Number(g.schedule.times || 1)
      : lastWeek.filter(k => isGoalScheduled(g, k)).every(k => goalCompleted(g, k)))) unlock("perfect-week");
    if (changed) saveData();
  }

  function renderHome() {
    normaliseDashboard();
    const root = $("#home-view");
    const today = localDateKey();
    const dailyGoals = data.goals.filter(g => g.schedule?.type !== "weekly" && isGoalScheduled(g, today));
    const weeklyGoals = data.goals.filter(g => g.schedule?.type === "weekly");
    const done = dailyGoals.filter(g => completedToday(g, today)).length;
    const percent = dailyGoals.length ? Math.round(done / dailyGoals.length * 100) : 0;
    const time = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, hour: "numeric", minute: "2-digit" }).format(new Date());
    const weekStart = mondayOf(today);
    const sections = {
      progress: `<div class="card progress-card"><div class="progress-top"><strong>Daily progress</strong><span class="progress-number">${done} / ${dailyGoals.length}</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><div class="progress-caption">${dailyGoals.length ? `${percent}% completed` : "Create a daily goal to get started"}</div></div>`,
      goals: `<div class="card"><div class="card-heading"><h2>Daily Goals</h2><span class="muted small">${dailyGoals.length} ${dailyGoals.length === 1 ? "goal" : "goals"}</span></div>${dailyGoals.length ? `<div class="goal-list">${dailyGoals.map(g => renderGoalRow(g, today)).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">✳</div><h3>No daily goals yet</h3><p class="small">Create a daily goal to build your routine.</p><button class="btn" data-go-new>＋ Create a goal</button></div>`}</div>`,
      weeklyGoals: `<div class="card"><div class="card-heading"><h2>Weekly Goals</h2><span class="muted small">${weeklyGoals.length} ${weeklyGoals.length === 1 ? "goal" : "goals"}</span></div>${weeklyGoals.length ? `<div class="weekly-goal-list">${weeklyGoals.map(g => renderGoalRow(g, today)).join("")}</div>` : `<div class="empty-state"><p class="small">No weekly goals yet. Create one and choose Weekly goal.</p></div>`}</div>`,
      week: `<div class="card"><div class="card-heading"><h2>This week</h2><span class="muted small">${formatDate(weekStart,{day:"numeric",month:"short"})} – ${formatDate(addDays(weekStart,6),{day:"numeric",month:"short"})}</span></div><div class="stat-grid"><div class="stat-tile"><div class="stat-label">Daily goals completed today</div><div class="stat-value">${done}/${dailyGoals.length}</div></div><div class="stat-tile"><div class="stat-label">Weekly targets met</div><div class="stat-value">${weeklyGoals.filter(g => weeklyCount(g, weekStart) >= Number(g.schedule.times || 1)).length}/${weeklyGoals.length}</div></div></div><p class="muted small" style="margin:13px 0 0">Your week runs Monday to Sunday.</p></div>`
    };
    const ordered = data.dashboard.order.filter(id => !data.dashboard.hidden.includes(id)).map(id => sections[id]).join("");
    root.innerHTML = `<div class="eyebrow">${escapeHtml(formatDate(today, { weekday:"long", day:"numeric", month:"long" }))} · ${escapeHtml(time)} Melbourne</div><h1>Your day, your data.</h1><p class="subtitle">A little progress adds up.</p>${ordered}<button class="text-button dashboard-shortcut" data-open-dashboard>Customise home dashboard ↗</button>`;
  }

  function renderGoalRow(goal, key) {
    const entry = getEntry(goal.id, key);
    const isWeekly = goal.schedule?.type === "weekly";
    const done = completedToday(goal, key);
    const meta = isWeekly ? `${weeklyCount(goal, mondayOf(key))}/${goal.schedule.times} times this week` :
      goal.type === "number" ? `Target: ${goal.target} ${goal.unit || ""}` : "Yes / No";
    if (goal.type === "boolean") {
      return `<div class="goal-row ${done ? "completed" : ""}" style="--goal-colour:${goalColour(goal)}">
        <button class="check-button ${entry?.value === true ? "checked" : ""}" data-toggle="${goal.id}" data-date="${key}" aria-label="Toggle ${escapeHtml(goal.name)}">${entry?.value === true ? "✓" : ""}</button>
        <div class="goal-info"><div class="goal-name">${escapeHtml(goal.name)}</div><div class="goal-meta">${meta}</div></div>
        ${done ? `<span class="muted small">Done</span>` : ""}
      </div>`;
    }
    return `<div class="goal-row ${done ? "completed" : ""}" style="--goal-colour:${goalColour(goal)}">
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
      return `<div class="chart-column"><div class="bar-wrap"><div class="bar ${v===null?"empty":below?"below":""}" style="height:${h}%;--bar-colour:${goalColour(goal)}">${v!==null?`<span class="bar-value">${formatNumber(v)}</span>`:""}</div></div><span class="chart-label">${labels[i]}</span></div>`;
    }).join("");
    const unit = goal.type === "number" ? ` ${escapeHtml(goal.unit || "")}` : "";
    const consistencyStart = addDays(currentMonday,-27), consistencyEnd=today;
    root.innerHTML = `
      <div class="eyebrow">Your progress</div><h1>Stats</h1><p class="subtitle">See the patterns. Celebrate the progress.</p>
      <div class="card">
        <div class="field"><label for="stats-goal">Choose a goal</label><select id="stats-goal">${data.goals.map(g=>`<option value="${g.id}" ${g.id===goal.id?"selected":""}>${escapeHtml(g.name)}</option>`).join("")}</select></div>
        <div class="controls"><div class="segmented" id="period-switch"><button data-period="daily" class="${statsPeriod==="daily"?"active":""}">Daily</button><button data-period="weekly" class="${statsPeriod==="weekly"?"active":""}">Weekly</button><button data-period="monthly" class="${statsPeriod==="monthly"?"active":""}">Monthly</button></div></div>
        <div class="period-nav"><button class="arrow-btn" data-period-shift="-1" aria-label="Previous period">‹</button><strong>${escapeHtml(title)}</strong><button class="arrow-btn" data-period-shift="1" aria-label="Next period" ${periodOffset>=0?"disabled":""}>›</button></div>
        <div class="card-heading"><h3><span class="goal-colour-dot" style="background:${goalColour(goal)}"></span>${escapeHtml(goal.name)}</h3><span class="muted small">${goal.type==="number"?`Target: ${goal.target}${unit}`:"Completed"}</span></div>
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
      cells.push(`<div class="calendar-cell ${inMonth?"":"outside"} ${key===localDateKey()?"today":""}" title="${formatDate(key)}${entry?`: ${escapeHtml(entry.value)}`:""}"><span>${dateFromKey(key).getDate()}</span>${done?`<i class="calendar-dot" style="background:${goalColour(goal)}"></i>`:""}</div>`);
    }
    return `<div class="card-heading"><strong>${new Date(y,m-1,1).toLocaleDateString("en-AU",{month:"long",year:"numeric"})}</strong></div><div class="calendar-grid">${DAY_NAMES.map(d=>`<div class="calendar-day-label">${d[0]}</div>`).join("")}${cells.join("")}</div><p class="muted small" style="margin:12px 0 0">Green dots mark days where this goal reached its target.</p>`;
  }
  function renderAchievements() {
    const items=[
      ["first-goal","🌱","First step","Create your first goal."],
      ["three-goals","🎯","Triple threat","Have 3 goals in your routine."],
      ["five-goals","🧩","Routine builder","Track 5 goals at once."],
      ["ten-goals","🏡","Life in progress","Track 10 goals at once."],
      ["seven-records","🗓️","Getting consistent","Record 7 goal results."],
      ["thirty-records","📈","Building momentum","Record 30 goal results."],
      ["fifty-records","📚","Data enthusiast","Record 50 goal results."],
      ["hundred-records","💯","Data collector","Record 100 goal results."],
      ["twofifty-records","🗃️","Data library","Record 250 goal results."],
      ["seven-active-days","🌤️","A week of showing up","Record something on 7 different days."],
      ["thirty-active-days","🌿","A month of progress","Record something on 30 different days."],
      ["mix-it-up","🎨","A bit of everything","Create both numerical and yes/no goals."],
      ["hundred-units","🔢","Triple digits","Reach 100 total units on a numerical goal."],
      ["thousand-units","🚀","Four digits","Reach 1,000 total units on a numerical goal."],
      ["twentyfive-checks","🐾","Making it a habit","Complete a yes/no goal 25 times."],
      ["three-streak","✨","Three in a row","Reach a 3-day streak."],
      ["seven-streak","🔥","One whole week","Reach a 7-day streak."],
      ["thirty-streak","🏆","A month of momentum","Reach a 30-day streak."],
      ["hundred-streak","👑","Unstoppable","Reach a 100-day streak."],
      ["perfect-week","🌟","Perfect week","Meet every goal target for a full Monday–Sunday week."]
    ];
    const unlocked = items.filter(([id]) => data.achievements[id]).length;
    return `<div class="achievement-summary"><strong>${unlocked} / ${items.length}</strong><span>achievements unlocked</span><div class="progress-track"><div class="progress-fill" style="width:${unlocked/items.length*100}%"></div></div></div><div class="achievement-list">${items.map(([id,icon,title,desc])=>`<div class="achievement ${data.achievements[id]?"unlocked":"locked"}"><div class="achievement-icon">${icon}</div><div class="achievement-copy"><strong>${title}</strong><span>${desc}</span></div><span class="small">${data.achievements[id]?"✓":"🔒"}</span></div>`).join("")}</div>`;
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
          <div class="field"><label for="goal-colour">Goal colour</label><select id="goal-colour" name="colour">${colourOptions()}</select></div>
          <div class="field full-width"><label>Goal schedule</label><div class="segmented"><button type="button" class="active" data-schedule-choice="daily">Daily goal</button><button type="button" data-schedule-choice="weekly">Weekly goal</button></div><input type="hidden" name="frequency" value="daily"></div>
          <div class="field full-width" data-field="daily-options"><label>Daily schedule</label><div class="segmented"><button type="button" class="active" data-frequency="daily">Every day</button><button type="button" data-frequency="days">Selected days</button></div></div>
          <div class="field full-width hidden-field" data-field="days"><label>Choose days</label><div class="day-picker">${DAY_NAMES.map((d,i)=>`<button type="button" class="day-chip ${i<5?"selected":""}" data-day="${i}">${d}</button>`).join("")}</div></div>
          <div class="field hidden-field" data-field="times"><label for="goal-times">Times per week</label><input id="goal-times" name="times" type="number" min="1" max="7" value="3"></div>
        </div>
        <button class="btn full" style="margin-top:20px" type="submit">＋ Create goal</button>
      </form>
      <div class="card"><div class="card-heading"><h2>Your goals</h2><span class="muted small">${data.goals.length} total</span></div>${data.goals.length?`<div class="goal-management-list">${data.goals.map(g=>`<div class="manage-goal"><div class="goal-info"><div class="goal-name"><span class="goal-colour-dot" style="background:${goalColour(g)}"></span>${escapeHtml(g.name)}</div><div class="goal-meta">${g.type==="number"?`${escapeHtml(g.target)} ${escapeHtml(g.unit||"")} · `:""}${frequencyLabel(g)}</div></div><div class="manage-actions"><button class="mini-button" data-edit="${g.id}">Edit</button><button class="mini-button" data-delete="${g.id}">Delete</button></div></div>`).join("")}</div>`:`<div class="empty-state"><p class="small">Your goals will appear here.</p></div>`}</div>`;
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
      <div class="settings-row"><div><strong>Signed in as</strong><div class="muted small">${escapeHtml(currentUser?.email || "")}</div></div><span class="small" style="color:var(--green)">Verified</span></div>
      <div class="settings-row"><div><strong>Data storage</strong><div class="muted small">Saved securely to your account in the cloud</div></div><span class="small" style="color:var(--green)">On</span></div>
      <div class="settings-row"><div><strong>Home dashboard</strong><div class="muted small">Choose which sections appear and their order</div></div><button class="btn secondary" data-dashboard-settings>Customise</button></div>
      <div class="settings-row"><div><strong>Achievement collection</strong><div class="muted small">See all milestones and locked achievements in Stats</div></div><button class="btn secondary" data-achievements-settings>View</button></div>
      <div class="settings-row"><div><strong>Timezone</strong><div class="muted small">Australia / Melbourne</div></div></div>
      <div class="settings-row"><div><strong>Week starts</strong><div class="muted small">Monday</div></div></div>
      <div class="settings-row"><div><strong>Export your data</strong><div class="muted small">Download a backup of goals and results</div></div><button class="btn secondary" data-export>Export</button></div>
      <div class="settings-row"><div><strong>Import backup</strong><div class="muted small">Restore a previously exported backup</div></div><button class="btn secondary" data-import>Import</button></div>
      <div class="settings-row"><div><strong>Sign out</strong><div class="muted small">Your cloud data will remain saved</div></div><button class="btn danger" data-signout>Sign out</button></div>
      <div class="modal-actions"><button class="btn secondary" data-close>Close</button></div>`);
  }
  function renderDashboardSettings() {
    normaliseDashboard();
    const rows = data.dashboard.order.map((id, index) => {
      const section = HOME_SECTIONS.find(x => x.id === id);
      return `<div class="dashboard-setting-row"><label><input type="checkbox" data-dashboard-visible="${id}" ${data.dashboard.hidden.includes(id)?"":"checked"}> ${section.label}</label><div class="manage-actions"><button class="mini-button" data-dashboard-move="${id}" data-direction="-1" ${index===0?"disabled":""}>↑</button><button class="mini-button" data-dashboard-move="${id}" data-direction="1" ${index===data.dashboard.order.length-1?"disabled":""}>↓</button></div></div>`;
    }).join("");
    openModal(`<div class="modal-header"><div><div class="eyebrow">Make it yours</div><h2>Home dashboard</h2><p class="muted small">Show, hide and reorder your home sections.</p></div><button class="modal-close" data-close>×</button></div><div class="dashboard-settings-list">${rows}</div><div class="modal-actions"><button class="btn secondary" data-dashboard-reset>Reset</button><button class="btn" data-close>Done</button></div>`);
  }
  function openAchievements() {
    openModal(`<div class="modal-header"><div><div class="eyebrow">Your milestones</div><h2>Achievement collection</h2></div><button class="modal-close" data-close>×</button></div>${renderAchievements()}<div class="modal-actions"><button class="btn" data-close>Done</button></div>`);
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
    if(dayIndex(today)!==0) return;
    const week=addDays(mondayOf(today),-7);
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
    const scheduleChoice=e.target.closest("[data-schedule-choice]");
    if(scheduleChoice){
      const form=scheduleChoice.closest("form");
      if(!form) return;
      const choice=scheduleChoice.dataset.scheduleChoice;
      form.elements.frequency.value=choice==="weekly"?"weekly":"daily";
      $$("[data-schedule-choice]",form).forEach(b=>b.classList.toggle("active",b===scheduleChoice));
      form.querySelector('[data-field="daily-options"]')?.classList.toggle("hidden-field",choice==="weekly");
      form.querySelector('[data-field="days"]')?.classList.add("hidden-field");
      form.querySelector('[data-field="times"]')?.classList.toggle("hidden-field",choice!=="weekly");
      return;
    }
    const freq=e.target.closest("[data-frequency]");
    if(freq){
      const form=freq.closest("form");
      if(!form) return;
      const frequency=freq.dataset.frequency;
      form.elements.frequency.value=frequency;
      $$("[data-frequency]",form).forEach(b=>b.classList.toggle("active",b===freq));
      form.querySelector('[data-field="days"]')?.classList.toggle("hidden-field",frequency!=="days");
      form.querySelector('[data-field="times"]')?.classList.toggle("hidden-field",frequency!=="weekly");
      return;
    }
    const day=e.target.closest("[data-day]");
    if(day){day.classList.toggle("selected");return;}
    const close=e.target.closest("[data-close]");
    if(close){closeModal();return;}
    if(e.target.closest("[data-open-dashboard]") || e.target.closest("[data-dashboard-settings]")){renderDashboardSettings();return;}
    if(e.target.closest("[data-achievements-settings]")){openAchievements();return;}
    const moveDashboard=e.target.closest("[data-dashboard-move]");
    if(moveDashboard){
      const order=data.dashboard.order, index=order.indexOf(moveDashboard.dataset.dashboardMove), next=index+Number(moveDashboard.dataset.direction);
      if(next>=0&&next<order.length){[order[index],order[next]]=[order[next],order[index]];saveData();renderDashboardSettings();}
      return;
    }
    if(e.target.closest("[data-dashboard-reset]")){data.dashboard={order:HOME_SECTIONS.map(x=>x.id),hidden:[]};saveData();renderDashboardSettings();return;}
    if(e.target.closest("[data-signout]")){closeModal();auth.signOut().catch(err=>showToast(authErrorMessage(err)));return;}
    if(e.target.closest("[data-export]")){exportData();return;}
    if(e.target.closest("[data-import]")){$("#import-file")?.click();return;}
    if(e.target.closest("[data-report-done]")){
      data.reportSeen[addDays(mondayOf(localDateKey()),-7)]=true;saveData();closeModal();return;
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
    if(e.target.matches("[data-dashboard-visible]")){
      const id=e.target.dataset.dashboardVisible;
      data.dashboard.hidden=data.dashboard.hidden.filter(x=>x!==id);
      if(!e.target.checked)data.dashboard.hidden.push(id);
      saveData();renderHome();renderDashboardSettings();return;
    }
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
    data.goals.push({id:uid(),name,type,target:type==="number"?target:null,unit:type==="number"?form.elements.unit.value.trim():"",colour:GOAL_COLOURS.some(c=>c.id===form.elements.colour.value)?form.elements.colour.value:"green",schedule,createdAt:localDateKey()});
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
          <div class="field"><label>Goal colour</label><select name="colour">${colourOptions(g.colour || "green")}</select></div>
          <div class="field full-width"><label>Goal type</label><div class="segmented"><button type="button" class="${g.type==="number"?"active":""}" data-type="number">Numerical</button><button type="button" class="${g.type==="boolean"?"active":""}" data-type="boolean">Yes / No</button></div><input type="hidden" name="type" value="${g.type}"></div>
          <div class="field ${g.type==="number"?"":"hidden-field"}" data-field="target"><label>Target</label><input name="target" type="number" min="0" step="any" value="${g.target??""}" ${g.type==="number"?"required":""}></div>
          <div class="field ${g.type==="number"?"":"hidden-field"}" data-field="unit"><label>Unit</label><input name="unit" maxlength="20" value="${escapeHtml(g.unit||"")}"></div>
          <div class="field full-width"><label>Goal schedule</label><div class="segmented"><button type="button" class="${frequency!=="weekly"?"active":""}" data-schedule-choice="daily">Daily goal</button><button type="button" class="${frequency==="weekly"?"active":""}" data-schedule-choice="weekly">Weekly goal</button></div><input type="hidden" name="frequency" value="${frequency}"></div>
          <div class="field full-width ${frequency==="weekly"?"hidden-field":""}" data-field="daily-options"><label>Daily schedule</label><div class="segmented"><button type="button" class="${frequency==="daily"?"active":""}" data-frequency="daily">Every day</button><button type="button" class="${frequency==="days"?"active":""}" data-frequency="days">Selected days</button></div></div>
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
    g.colour=GOAL_COLOURS.some(c=>c.id===form.elements.colour.value)?form.elements.colour.value:"green";
    g.schedule=schedule;
    saveData();closeModal();renderAll();showToast("Goal updated.");
  });

  $("#settings-button").addEventListener("click",renderSettings);
  $("#modal-backdrop").addEventListener("click",e=>{if(e.target.id==="modal-backdrop")closeModal();});

  // Add a hidden file input for restoring an exported backup.
  const importInput=document.createElement("input");
  importInput.type="file";importInput.id="import-file";importInput.accept="application/json";importInput.hidden=true;
  document.body.appendChild(importInput);

  // Firebase Authentication controls access; Firestore stores the signed-in user data.
  showAuthScreen("loading");
})();