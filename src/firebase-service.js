import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use persistent multi-tab cache in browser for seamless offline storage & instant loading
export const db = typeof window !== 'undefined'
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    }, firebaseConfig.firestoreDatabaseId || undefined)
  : getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);

let currentUser = null;
const listeners = new Set();

onAuthStateChanged(auth, user => {
  currentUser = user;
  listeners.forEach(fn => fn(user));
});

export function onUserChanged(fn) {
  listeners.add(fn);
  if (currentUser !== undefined) fn(currentUser);
  return () => listeners.delete(fn);
}

function getLocalUid() {
  try {
    const key = 'empire_persistent_uid';
    let id = localStorage.getItem(key);
    if (!id) {
      id = 'corvin_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'corvin_sovereign';
  }
}

export async function ensureAuth() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch {
    // If anonymous sign-in is disabled in Cloud Console, fallback smoothly to the sovereign device ID
    return { uid: getLocalUid(), isAnonymous: true, email: null };
  }
}

export async function loginWithEmail(email, password) {
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}

export async function registerWithEmail(email, password) {
  return (await createUserWithEmailAndPassword(auth, email, password)).user;
}

export async function logoutUser() {
  return signOut(auth);
}

export function getCurrentUser() {
  return auth.currentUser || currentUser || { uid: getLocalUid(), isAnonymous: true };
}

export async function saveEmpireDocument(collectionName, data) {
  try {
    const user = await ensureAuth();
    const uid = user?.uid || getLocalUid();
    const docRef = doc(db, 'users', uid, 'empire', collectionName);
    await setDoc(docRef, {
      data,
      updatedAt: serverTimestamp(),
      ownerId: uid,
      version: crypto.randomUUID(),
    }, { merge: true });
    return docRef.id;
  } catch (err) {
    // Local persistence will keep state safe
    return null;
  }
}

export async function loadEmpireDocument(collectionName) {
  try {
    const user = await ensureAuth();
    const uid = user?.uid || getLocalUid();
    const docRef = doc(db, 'users', uid, 'empire', collectionName);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data()?.data || null;
  } catch {
    return null;
  }
}

export function subscribeEmpireDocument(collectionName, onUpdate) {
  let unsubscribe = null;
  ensureAuth().then(user => {
    const uid = user?.uid || getLocalUid();
    const docRef = doc(db, 'users', uid, 'empire', collectionName);
    unsubscribe = onSnapshot(docRef, snap => {
      if (snap.exists()) {
        const payload = snap.data();
        if (payload?.data) onUpdate(payload.data);
      }
    }, () => {});
  }).catch(() => {});

  return () => {
    if (unsubscribe) unsubscribe();
  };
}
