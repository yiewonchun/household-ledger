import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const gate = $('cloudGate');
const info = $('cloudMessage');
const signin = $('signInBtn');
const upload = $('uploadLocalBtn');
const blank = $('startBlankBtn');
const status = $('syncStatus');
let db, auth, docRef, stopListening, pendingTimer, initialized = false, dirty = false;
let lastRemoteData = null;
let ignoreNextLocal = false;
const show = (message, buttons=[]) => {
  gate.classList.remove('is-hidden');
  info.textContent=message;
  for (const [name,btn] of [['signin',signin],['upload',upload],['blank',blank]]) btn.hidden=!buttons.includes(name);
};
const setStatus = msg => {status.textContent='☁ '+msg;};
const useStore = data => {
  if (!data || !Array.isArray(data.budget) || !Array.isArray(data.actual)) throw new Error('Invalid ledger data');
  store = structuredClone(data);
  const repairedPeriods = normalizeBudgetPeriods(store);
  if (!Array.isArray(store.bills)) store.bills=[];
  if (!store.spending) store.spending={};
  if (!store.config) store.config={};
  if (!store.budget.length) store.budget=structuredClone(INITIAL.budget);
  for (const a of store.actual) {if (!Array.isArray(a.hysaTransactions)) a.hysaTransactions=[];for (const ac of a.accounts||[]) if (!ac.kind) ac.kind=guessKind(ac.name);}
  if (!store.budget.some(x=>x.id===selected)) selected=sorted().at(-1)?.id;
  localStorage.setItem(KEY,JSON.stringify(store));
  render();
  return repairedPeriods;
};
const serialize = data => JSON.stringify(data);
const begin = () => {
  initialized=true;
  gate.classList.add('is-hidden');
  $('signOutBtn').hidden=false;
  setStatus('동기화됨 / Synced');
  stopListening?.();
  stopListening=onSnapshot(docRef,snap=>{
    if(!snap.exists() || snap.metadata.hasPendingWrites)return;
    const remote=snap.data()?.ledger;
    if(!remote)return;
    lastRemoteData=serialize(remote);
    if(dirty)return;
    if(lastRemoteData!==serialize(store)){
      const repaired=useStore(remote);
      setStatus('다른 기기 변경 반영 / Updated');
      if(repaired)window.queueCloudSave?.(store);
    }
  },err=>setStatus('동기화 오류 / Sync error: '+err.code));
};
const uploadData = async data => {
  setStatus('업로드 중 / Uploading…');
  await setDoc(docRef,{ledger:structuredClone(data),updatedAt:serverTimestamp()});
  lastRemoteData=serialize(data);
  dirty=false;
  begin();
};
const startAuth = async user => {
  initialized=false;
  dirty=false;
  docRef=doc(db,'users',user.uid,'ledger','main');
  setStatus('불러오는 중 / Loading…');
  show('비공개 기록을 불러오는 중입니다 / Loading your private ledger…');
  try {
    const snap=await getDoc(docRef);
    if(snap.exists() && snap.data()?.ledger){
      const repaired=useStore(snap.data().ledger);
      begin();
      if(repaired)window.queueCloudSave?.(store);
    } else {
      const hasLocal=store.budget.some(p=>p.entries?.length) || store.actual.length>0 || store.bills.length>0 || Object.values(store.spending||{}).some(p=>p.transactions?.length);
      show(hasLocal ? '이 계정에 아직 가계부가 없습니다. 이 기기의 기존 V4 데이터를 올리거나 새로 시작하세요. / No cloud ledger yet. Upload local V4 records or start new.' : '처음 사용하는 계정입니다. 새 가계부를 만드세요. 기존 V4 기록은 로그인 후 JSON 백업을 가져올 수도 있습니다. / No cloud ledger yet. Start new or import your JSON backup.',hasLocal?['upload','blank']:['blank']);
    }
  } catch (e) {show('클라우드 접근 오류 / Cloud access error: '+(e.code||e.message)+'. Firebase 설정 및 Firestore 보안 규칙을 확인하세요.');setStatus('연결 실패 / Connection failed');}
};
const isConfigured=()=>firebaseConfig.apiKey&&!firebaseConfig.apiKey.includes('PASTE_')&&firebaseConfig.projectId&&!firebaseConfig.projectId.includes('PASTE_')&&firebaseConfig.appId&&!firebaseConfig.appId.includes('PASTE_');
if (!isConfigured()) {
  show('아직 Firebase 프로젝트 설정이 필요합니다. README의 안내에 따라 firebase-config.js를 작성하고 웹사이트를 게시하세요. / Firebase setup required. See README.');
  setStatus('설정 필요 / Setup required');
} else {
  try {
    const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
    $('signOutBtn').onclick=async()=>{stopListening?.();stopListening=null;initialized=false;dirty=false;clearTimeout(pendingTimer);await signOut(auth);};
    signin.onclick=async()=>{
      const provider=new GoogleAuthProvider();
      try{await signInWithPopup(auth,provider)}catch(e){
        if(['auth/popup-blocked','auth/popup-closed-by-user','auth/operation-not-supported-in-this-environment'].includes(e.code)){
          if(e.code!=='auth/popup-closed-by-user')await signInWithRedirect(auth,provider);
        } else show('로그인 오류 / Sign-in error: '+(e.code||e.message),['signin']);
      }
    };
    upload.onclick=async()=>{try{await uploadData(store)}catch(e){show('업로드 실패 / Upload failed: '+(e.code||e.message),['upload','blank'])}};
    blank.onclick=async()=>{if(store.actual.length||store.budget.some(p=>p.entries?.length)||store.bills.length){if(!confirm('새로 시작하면 이 기기의 기존 기록은 클라우드에 업로드되지 않습니다. 먼저 JSON 백업을 권장합니다. / Existing local records will not be uploaded. Continue?'))return;}try{useStore(INITIAL);await uploadData(store)}catch(e){show('생성 실패 / Creation failed: '+(e.code||e.message),['blank'])}};
    getRedirectResult(auth).catch(e=>{show('로그인 연결 오류 / Redirect error: '+(e.code||e.message),['signin'])});
    onAuthStateChanged(auth,user=>{
      stopListening?.();stopListening=null;
      if(user)startAuth(user);
      else{initialized=false;dirty=false;docRef=null;$('signOutBtn').hidden=true;setStatus('로그인 필요 / Sign in required');show('본인의 Google 계정으로 로그인하세요. / Sign in to access your private finances.',['signin']);}
    });
  } catch(e){show('Firebase 초기화 오류 / Firebase initialization error: '+e.message)}
}
// Called by V4's existing save() and kept separate from the actual app.
window.queueCloudSave=(newStore)=>{
  if(!initialized||!docRef) return;
  dirty=true;
  setStatus('저장 대기 / Saving…');
  clearTimeout(pendingTimer);
  const snapshot=structuredClone(newStore);
  pendingTimer=setTimeout(async()=>{
    try{
      await setDoc(docRef,{ledger:snapshot,updatedAt:serverTimestamp()});
      // If the user edited further while the request was pending, do not mark synced prematurely.
      if(serialize(snapshot)===serialize(store)){
        dirty=false;lastRemoteData=serialize(store);setStatus('저장 완료 / Saved');
      }
    } catch(e){setStatus('저장 실패 / Save failed: '+(e.code||e.message));show('저장 실패: JSON 백업으로 기록을 보호하세요. / Save failed: please export a JSON backup.',['signin']);}
  },700);
};
