// ─────────────────────────────────────────────────────────────────────────────
// PASO 1: Reemplazá estos valores con los de TU proyecto Firebase
// Los encontrás en: Firebase Console → tu proyecto → ⚙️ → Configuración del proyecto
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyBhwLTN3kzsp8LkbTOMj8da1VPQAfxfqm8",
  authDomain:        "aldea-creative-hub.firebaseapp.com",
  projectId:         "aldea-creative-hub",
  storageBucket:     "aldea-creative-hub.firebasestorage.app",
  messagingSenderId: "811107787368",
  appId:             "1:811107787368:web:5ae4dc40653a5eaed451dd",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
