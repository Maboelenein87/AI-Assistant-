/* ============================================================
   Firebase configuration — Prep Desk

   1. Go to https://console.firebase.google.com
   2. Create a new project (a separate one from Shelf Pulse is
      recommended, to keep the two apps fully independent).
   3. In the project: Build → Authentication → Get started →
      enable the "Email/Password" sign-in method.
   4. In the project: Build → Firestore Database → Create database
      → start in production mode (rules are provided in the user
      guide — paste them into the Rules tab).
   5. Project settings (gear icon) → General → scroll to
      "Your apps" → click the </> (web) icon → register an app
      (any nickname) → Firebase will show you a firebaseConfig
      object exactly like the one below.
   6. Replace every "PASTE_..." value below with the matching
      value Firebase gave you, then save this file.

   Nothing else in the app needs to change once this file is filled in.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAvEKoTK0uuaYUgqAdGauVX5fWOXDTHETA",
  authDomain: "ai-assistant-d790a.firebaseapp.com",
  projectId: "ai-assistant-d790a",
  storageBucket: "ai-assistant-d790a.firebasestorage.app",
  messagingSenderId: "956548360429",
  appId: "1:956548360429:web:bf9953fa34dab96016c4e4"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
