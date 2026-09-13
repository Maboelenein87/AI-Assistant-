/* ============================================================
   Prep Desk — AI Teacher Assistant
   Classes, lessons, and reflections sync across devices via
   Firebase Auth + Firestore. The AI API key stays local
   to each device (never synced) and generation calls go
   directly from this browser to the AI provider's free tier.
   ============================================================ */

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, arrayUnion, query
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const LOCAL_APIKEY_KEY = "prepdesk_apikey_v1";
const GEMINI_MODEL = "gemini-2.5-flash";

const SUBJECT_YEAR_NOTES = {
  "Year 1": "ages ~5-6, very short attention spans (5-8 min per activity), lots of movement, picture-based, minimal reading/writing",
  "Year 2": "ages ~6-7, short attention spans (8-10 min per activity), simple sentences, heavy use of pictures and hands-on activities",
  "Year 3": "ages ~7-8, can sustain 10-15 min per activity, starting simple independent writing, still needs visual/hands-on support",
  "Year 4": "ages ~8-9, can sustain 15-20 min per activity, more independent work possible, still benefits from visuals and games"
};

/* ---------- State ---------- */
let currentUser = null;
let unsubscribers = [];

let state = {
  teacher: { name: "", curriculum: "american" },
  apiKey: localStorage.getItem(LOCAL_APIKEY_KEY) || "",
  classes: [],
  lessons: [],
  reflections: []
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- Firestore path helpers ---------- */
function userDocRef() { return doc(db, "prepdesk_users", currentUser.uid); }
function classesCol() { return collection(userDocRef(), "classes"); }
function lessonsCol() { return collection(userDocRef(), "lessons"); }
function reflectionsCol() { return collection(userDocRef(), "reflections"); }

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  wireGlobalEvents();
  onAuthStateChanged(auth, user => {
    detachListeners();
    if (user) {
      currentUser = user;
      attachListeners();
    } else {
      currentUser = null;
      document.getElementById("loading-screen").style.display = "none";
      showLogin();
    }
  });
});

function detachListeners() {
  unsubscribers.forEach(fn => fn());
  unsubscribers = [];
}

function attachListeners() {
  let profileLoaded = false;
  let classesLoaded = false;

  const unsubProfile = onSnapshot(userDocRef(), snap => {
    if (snap.exists()) {
      const data = snap.data();
      state.teacher.name = data.name || "";
      state.teacher.curriculum = data.curriculum || "american";
    }
    profileLoaded = true;
    afterFirstLoad();
  });

  const unsubClasses = onSnapshot(query(classesCol()), snap => {
    state.classes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    classesLoaded = true;
    afterFirstLoad();
    refreshAllViews();
  });

  const unsubLessons = onSnapshot(query(lessonsCol()), snap => {
    state.lessons = snap.docs.map(d => ({ id: d.id, ...d.data(), materials: d.data().materials || [] }));
    refreshAllViews();
  });

  const unsubReflections = onSnapshot(query(reflectionsCol()), snap => {
    state.reflections = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshAllViews();
  });

  unsubscribers = [unsubProfile, unsubClasses, unsubLessons, unsubReflections];

  function afterFirstLoad() {
    if (!profileLoaded || !classesLoaded) return;
    document.getElementById("loading-screen").style.display = "none";
    if (!state.teacher.name || state.classes.length === 0) {
      showSetup();
    } else {
      showMainApp();
    }
  }
}

/* ---------- Screens ---------- */
function hideAllScreens() {
  ["loading-screen", "login-screen", "setup-screen", "main-app"].forEach(id => {
    document.getElementById(id).style.display = "none";
  });
}

function showLogin() {
  hideAllScreens();
  document.getElementById("login-screen").style.display = "flex";
}

function showSetup() {
  hideAllScreens();
  document.getElementById("setup-screen").style.display = "flex";
  document.getElementById("setup-name").value = state.teacher.name || "";
  document.getElementById("setup-curriculum").value = state.teacher.curriculum || "american";
  document.getElementById("setup-apikey").value = state.apiKey || "";
}

function showMainApp() {
  hideAllScreens();
  document.getElementById("main-app").style.display = "flex";
  document.getElementById("teacher-name-display").textContent = state.teacher.name || "";
  refreshAllViews();
  maybeShowWelcome();
}

const WELCOME_LOCAL_KEY = "prepdesk_welcome_last_shown_v1";
function todayLocalString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function maybeShowWelcome() {
  const today = todayLocalString();
  if (localStorage.getItem(WELCOME_LOCAL_KEY) === today) return;
  localStorage.setItem(WELCOME_LOCAL_KEY, today);
  document.getElementById("welcome-overlay").style.display = "flex";
}

/* ---------- Global events ---------- */
let isSignUpMode = false;

function wireGlobalEvents() {
  /* Login / signup */
  document.getElementById("login-toggle").addEventListener("click", () => {
    isSignUpMode = !isSignUpMode;
    document.getElementById("login-heading").textContent = isSignUpMode ? "Create your account" : "Sign in";
    document.getElementById("login-submit").textContent = isSignUpMode ? "Create account" : "Sign in";
    document.getElementById("login-toggle").textContent = isSignUpMode ? "Already have an account? Sign in" : "Don't have an account? Create one";
  });

  document.getElementById("login-submit").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    errorEl.style.display = "none";
    if (!email || !password) {
      errorEl.textContent = "Enter an email and password.";
      errorEl.style.display = "block";
      return;
    }
    try {
      if (isSignUpMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err);
      errorEl.style.display = "block";
    }
  });

  document.getElementById("sidebar-signout").addEventListener("click", () => signOut(auth));

  document.getElementById("welcome-close").addEventListener("click", () => {
    document.getElementById("welcome-overlay").style.display = "none";
  });

  /* Setup */
  document.getElementById("setup-continue").addEventListener("click", async () => {
    const name = document.getElementById("setup-name").value.trim();
    const curriculum = document.getElementById("setup-curriculum").value;
    const apiKey = document.getElementById("setup-apikey").value.trim();
    if (!name) { alert("Add your name to continue."); return; }

    localStorage.setItem(LOCAL_APIKEY_KEY, apiKey);
    state.apiKey = apiKey;

    await setDoc(userDocRef(), { name, curriculum }, { merge: true });

    if (state.classes.length === 0) {
      await addDoc(classesCol(), { year: "Year 1", subject: "English", section: "", createdAt: Date.now() });
    }
    switchView("settings");
    alert("You're set up. Add your real classes in Settings, then head to Lesson Builder.");
  });

  /* Nav */
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  document.getElementById("dash-add-class").addEventListener("click", () => switchView("settings"));
  document.getElementById("dash-new-lesson").addEventListener("click", () => switchView("builder"));

  document.getElementById("builder-generate").addEventListener("click", () => generateLesson());
  document.getElementById("builder-regenerate").addEventListener("click", () => generateLesson());
  document.getElementById("builder-save").addEventListener("click", saveLesson);

  document.getElementById("studio-generate").addEventListener("click", () => generateMaterial());
  document.getElementById("studio-regenerate").addEventListener("click", () => generateMaterial());
  document.getElementById("studio-save").addEventListener("click", saveMaterial);

  document.getElementById("reflect-lesson").addEventListener("change", renderReflectHistory);
  document.getElementById("reflect-save").addEventListener("click", saveReflection);

  document.getElementById("settings-save").addEventListener("click", saveSettingsProfile);
  document.getElementById("settings-add-class").addEventListener("click", addClassFromSettings);
  document.getElementById("settings-export").addEventListener("click", exportData);
  document.getElementById("settings-clear").addEventListener("click", clearAllData);
}

function friendlyAuthError(err) {
  const code = err.code || "";
  if (code.includes("email-already-in-use")) return "That email already has an account — try signing in instead.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Incorrect email or password.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("invalid-email")) return "That email address doesn't look right.";
  return "Something went wrong: " + err.message;
}

function switchView(viewName) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === viewName));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + viewName).classList.add("active");
  refreshAllViews();
}

function refreshAllViews() {
  if (document.getElementById("main-app").style.display === "none") return;
  renderDashboard();
  populateClassSelect(document.getElementById("builder-class"));
  populateLessonSelect(document.getElementById("studio-lesson"));
  populateLessonSelect(document.getElementById("reflect-lesson"));
  renderReflectHistory();
  renderPatterns();
  renderSettings();
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
  document.getElementById("dash-greeting").textContent = `Welcome back, ${state.teacher.name || "there"}`;
  const classesEl = document.getElementById("dash-classes");
  classesEl.innerHTML = "";
  if (state.classes.length === 0) {
    classesEl.innerHTML = `<span class="hint">No classes yet.</span>`;
  }
  state.classes.forEach(c => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = classLabel(c);
    classesEl.appendChild(chip);
  });

  const recentEl = document.getElementById("dash-recent-lessons");
  recentEl.innerHTML = "";
  const recent = [...state.lessons].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  if (recent.length === 0) {
    recentEl.innerHTML = `<span class="hint">No lessons planned yet.</span>`;
  }
  recent.forEach(l => {
    const c = state.classes.find(c => c.id === l.classId);
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `<div class="list-item-title">${escapeHtml(l.topic)}</div>
      <div class="list-item-meta">${c ? classLabel(c) : "Unknown class"} · ${new Date(l.createdAt).toLocaleDateString()}</div>`;
    recentEl.appendChild(item);
  });
}

function classLabel(c) {
  return `${c.year} ${c.subject}${c.section ? " (" + c.section + ")" : ""}`;
}

function populateClassSelect(select) {
  const prev = select.value;
  select.innerHTML = "";
  state.classes.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = classLabel(c);
    select.appendChild(opt);
  });
  if (prev) select.value = prev;
}

function populateLessonSelect(select) {
  const prev = select.value;
  select.innerHTML = "";
  const sorted = [...state.lessons].sort((a, b) => b.createdAt - a.createdAt);
  sorted.forEach(l => {
    const c = state.classes.find(c => c.id === l.classId);
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = `${l.topic} — ${c ? classLabel(c) : "?"}`;
    select.appendChild(opt);
  });
  if (prev) select.value = prev;
}

/* ---------- AI generation (Google Gemini free tier) ---------- */
async function callAI(systemPrompt, userPrompt) {
  const apiKey = state.apiKey;
  if (!apiKey) {
    throw new Error("No AI API key set on this device. Add one in Settings.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: 3000 }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const msg = (data.error && data.error.message) ? data.error.message : JSON.stringify(data).slice(0, 300);
    if (response.status === 429) {
      throw new Error("Hit the free usage limit for a moment — wait about a minute and try again.");
    }
    throw new Error(`AI error (${response.status}): ${msg}`);
  }
  const candidate = data.candidates && data.candidates[0];
  const text = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts.map(p => p.text || "").join("")
    : "";
  if (!text) throw new Error("No content came back — try regenerating.");
  return text;
}

function buildPatternContext(classId) {
  const relevant = state.reflections
    .filter(r => {
      const lesson = state.lessons.find(l => l.id === r.lessonId);
      return lesson && lesson.classId === classId;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  if (relevant.length === 0) return "No past reflections for this class yet.";

  let text = "Notes from recent lessons with this class:\n";
  relevant.forEach(r => {
    const lesson = state.lessons.find(l => l.id === r.lessonId);
    text += `- Topic "${lesson ? lesson.topic : "?"}": `;
    if (r.worked) text += `worked well — ${r.worked}. `;
    if (r.struggled) text += `struggled with — ${r.struggled}.`;
    text += "\n";
  });
  return text;
}

/* ---------- Lesson Builder ---------- */
async function generateLesson() {
  const classId = document.getElementById("builder-class").value;
  const topic = document.getElementById("builder-topic").value.trim();
  const extraNotes = document.getElementById("builder-notes").value.trim();
  const cls = state.classes.find(c => c.id === classId);

  if (!cls) { alert("Add a class in Settings first."); return; }
  if (!topic) { alert("Add a topic."); return; }

  const loadingEl = document.getElementById("builder-loading");
  const resultEl = document.getElementById("builder-result");
  loadingEl.style.display = "flex";
  resultEl.style.display = "none";

  const patternContext = buildPatternContext(classId);
  const yearNote = SUBJECT_YEAR_NOTES[cls.year] || "";
  const curriculumLabel = state.teacher.curriculum === "british" ? "British curriculum (IGCSE track)" : "American curriculum";

  const systemPrompt = `You are an experienced early-years curriculum specialist helping a teacher in an Egyptian international school (${curriculumLabel}) prepare a lesson. The class is ${cls.year} ${cls.subject}. Developmental notes for this year group: ${yearNote}. Always favor short, concrete, highly visual and hands-on activities over long text or lecture-style teaching — this age group needs movement, pictures, games, and repetition. Write directly and practically, as notes a teacher can use immediately, not as marketing copy. Use plain section headers and short bullet points, no markdown symbols like # or **.`;

  const userPrompt = `Plan a lesson on: "${topic}"
${extraNotes ? "Teacher's specific request: " + extraNotes : ""}

${patternContext}
Take the above notes into account — if students struggled with something related before, address it; if an activity type worked well before, lean on similar approaches.

Structure the output with these sections:
Objective (one clear, simple sentence)
Materials needed (simple, easy to find in a classroom)
Lesson structure with timing (opening/hook, main teaching, activity, wrap-up — include at least one visual or hands-on activity with clear step-by-step instructions)
Differentiation (one easier tweak, one extra-challenge tweak)
Vocabulary (3-5 simple words to introduce, with a one-line kid-friendly explanation each)`;

  try {
    const text = await callAI(systemPrompt, userPrompt);
    document.getElementById("builder-output").value = text;
    resultEl.style.display = "block";
    resultEl.dataset.classId = classId;
    resultEl.dataset.topic = topic;
  } catch (err) {
    alert("Couldn't generate the lesson: " + err.message);
  } finally {
    loadingEl.style.display = "none";
  }
}

async function saveLesson() {
  const resultEl = document.getElementById("builder-result");
  const classId = resultEl.dataset.classId;
  const topic = resultEl.dataset.topic;
  const content = document.getElementById("builder-output").value;
  if (!classId || !content) return;

  await addDoc(lessonsCol(), {
    classId, topic, content, materials: [], createdAt: Date.now()
  });
  alert("Lesson saved and synced. You can now generate materials for it in Content Studio, or log a reflection after teaching it.");
}

/* ---------- Content Studio ---------- */
async function generateMaterial() {
  const lessonId = document.getElementById("studio-lesson").value;
  const type = document.getElementById("studio-type").value;
  const lesson = state.lessons.find(l => l.id === lessonId);
  if (!lesson) { alert("Save a lesson in Lesson Builder first."); return; }
  const cls = state.classes.find(c => c.id === lesson.classId);

  const loadingEl = document.getElementById("studio-loading");
  const resultEl = document.getElementById("studio-result");
  loadingEl.style.display = "flex";
  resultEl.style.display = "none";

  const yearNote = cls ? (SUBJECT_YEAR_NOTES[cls.year] || "") : "";
  const typeLabels = {
    "worksheet": "a simple, visual worksheet with 3-5 short tasks",
    "activity": "a classroom activity or game, with clear step-by-step instructions a teacher can run live",
    "homework": "a short homework sheet, light enough for a young child to do with a parent",
    "flashcards": "a set of 8-10 flashcards (front/back pairs described in text)",
    "exit-ticket": "a very short exit ticket — 2-3 quick checks a teacher can mark in seconds"
  };

  const systemPrompt = `You are an early-years teaching materials designer for an Egyptian international school. The class is ${cls ? cls.year + " " + cls.subject : "an early-years class"}. Developmental notes: ${yearNote}. Keep everything short, visual, and concrete — describe any images/drawings needed in [brackets] so a teacher knows what to sketch or find, since this is text-only output. Write plainly, no markdown symbols.`;

  const userPrompt = `Based on this lesson:
"""
${lesson.content}
"""

Create ${typeLabels[type]}. Include an answer key or expected responses at the end where relevant, clearly separated under a heading "Answer key".`;

  try {
    const text = await callAI(systemPrompt, userPrompt);
    document.getElementById("studio-output").value = text;
    resultEl.style.display = "block";
    resultEl.dataset.lessonId = lessonId;
    resultEl.dataset.type = type;
  } catch (err) {
    alert("Couldn't generate that: " + err.message);
  } finally {
    loadingEl.style.display = "none";
  }
}

async function saveMaterial() {
  const resultEl = document.getElementById("studio-result");
  const lessonId = resultEl.dataset.lessonId;
  const type = resultEl.dataset.type;
  const content = document.getElementById("studio-output").value;
  const lesson = state.lessons.find(l => l.id === lessonId);
  if (!lesson) return;

  const lessonRef = doc(lessonsCol(), lessonId);
  await updateDoc(lessonRef, {
    materials: arrayUnion({ id: uid(), type, content, createdAt: Date.now() })
  });
  alert("Saved and synced to the lesson.");
}

/* ---------- Reflection ---------- */
async function saveReflection() {
  const lessonId = document.getElementById("reflect-lesson").value;
  const worked = document.getElementById("reflect-worked").value.trim();
  const struggled = document.getElementById("reflect-struggled").value.trim();
  if (!lessonId) { alert("Save a lesson first."); return; }
  if (!worked && !struggled) { alert("Add at least one note."); return; }

  await addDoc(reflectionsCol(), { lessonId, worked, struggled, createdAt: Date.now() });
  document.getElementById("reflect-worked").value = "";
  document.getElementById("reflect-struggled").value = "";
  document.getElementById("reflect-confirm").style.display = "block";
  setTimeout(() => document.getElementById("reflect-confirm").style.display = "none", 4000);
}

function renderReflectHistory() {
  const lessonId = document.getElementById("reflect-lesson").value;
  const historyEl = document.getElementById("reflect-history");
  historyEl.innerHTML = "";
  const items = state.reflections.filter(r => r.lessonId === lessonId).sort((a, b) => b.createdAt - a.createdAt);
  if (items.length === 0) {
    historyEl.innerHTML = `<span class="hint">No reflections logged for this lesson yet.</span>`;
    return;
  }
  items.forEach(r => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<div class="list-item-meta">${new Date(r.createdAt).toLocaleDateString()}</div>
      ${r.worked ? `<div><strong>Worked:</strong> ${escapeHtml(r.worked)}</div>` : ""}
      ${r.struggled ? `<div><strong>Struggled:</strong> ${escapeHtml(r.struggled)}</div>` : ""}`;
    historyEl.appendChild(div);
  });
}

/* ---------- Patterns view ---------- */
function renderPatterns() {
  const listEl = document.getElementById("patterns-list");
  const emptyEl = document.getElementById("patterns-empty");
  listEl.innerHTML = "";

  const classesWithData = state.classes.filter(c =>
    state.reflections.some(r => {
      const lesson = state.lessons.find(l => l.id === r.lessonId);
      return lesson && lesson.classId === c.id;
    })
  );

  if (classesWithData.length === 0) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  classesWithData.forEach(c => {
    const relevantReflections = state.reflections.filter(r => {
      const lesson = state.lessons.find(l => l.id === r.lessonId);
      return lesson && lesson.classId === c.id;
    }).sort((a, b) => b.createdAt - a.createdAt);

    const card = document.createElement("div");
    card.className = "pattern-card";
    let rows = "";
    relevantReflections.slice(0, 6).forEach(r => {
      const lesson = state.lessons.find(l => l.id === r.lessonId);
      if (r.worked) rows += `<div class="pattern-row"><span class="tag">Worked</span>${escapeHtml(r.worked)} <span class="hint">(${lesson ? lesson.topic : ""})</span></div>`;
      if (r.struggled) rows += `<div class="pattern-row"><span class="tag">Struggled</span>${escapeHtml(r.struggled)} <span class="hint">(${lesson ? lesson.topic : ""})</span></div>`;
    });
    card.innerHTML = `<h4>${classLabel(c)}</h4>${rows}`;
    listEl.appendChild(card);
  });
}

/* ---------- Settings ---------- */
function renderSettings() {
  document.getElementById("settings-name").value = state.teacher.name || "";
  document.getElementById("settings-curriculum").value = state.teacher.curriculum || "american";
  document.getElementById("settings-apikey").value = state.apiKey || "";

  const listEl = document.getElementById("settings-classes");
  listEl.innerHTML = "";
  if (state.classes.length === 0) {
    listEl.innerHTML = `<span class="hint">No classes yet — add one below.</span>`;
  }
  state.classes.forEach(c => {
    const row = document.createElement("div");
    row.className = "class-row";
    row.innerHTML = `<span>${classLabel(c)}</span><button data-id="${c.id}">Remove</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      await deleteDoc(doc(classesCol(), c.id));
    });
    listEl.appendChild(row);
  });
}

async function saveSettingsProfile() {
  const name = document.getElementById("settings-name").value.trim();
  const curriculum = document.getElementById("settings-curriculum").value;
  const apiKey = document.getElementById("settings-apikey").value.trim();

  await setDoc(userDocRef(), { name, curriculum }, { merge: true });
  localStorage.setItem(LOCAL_APIKEY_KEY, apiKey);
  state.apiKey = apiKey;
  document.getElementById("teacher-name-display").textContent = name;
  alert("Saved.");
}

async function addClassFromSettings() {
  const year = document.getElementById("settings-new-year").value;
  const subject = document.getElementById("settings-new-subject").value;
  const section = document.getElementById("settings-new-section").value.trim();
  await addDoc(classesCol(), { year, subject, section, createdAt: Date.now() });
  document.getElementById("settings-new-section").value = "";
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "prepdesk-backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAllData() {
  if (!confirm("This will permanently delete all your classes, lessons, and reflections from your account (all devices). Continue?")) return;
  const deletions = [
    ...state.classes.map(c => deleteDoc(doc(classesCol(), c.id))),
    ...state.lessons.map(l => deleteDoc(doc(lessonsCol(), l.id))),
    ...state.reflections.map(r => deleteDoc(doc(reflectionsCol(), r.id)))
  ];
  await Promise.all(deletions);
  await setDoc(userDocRef(), { name: "", curriculum: "american" });
}

/* ---------- Utils ---------- */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
