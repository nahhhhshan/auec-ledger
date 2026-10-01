/* GitHub Pages 版のデータ保存（Firebase Firestore）。
 * ledger.html の MODE='web' から initWeb() が呼ばれる。
 * 帳簿は URL の #以降（推測できない長いID）で区別し、それを知っている人だけが読み書きできる。 */

const NAME_KEY = 'auec-web-name';
// 接続中の表示に使う、このブラウザ固定の番号（読み込み直しても同じ記録を上書きし、増えないように）
const CLIENT_ID = (() => { let id = lsGet('auec-web-client'); if(!/^[a-z0-9]{10}$/.test(id)){ id = Math.random().toString(36).slice(2, 12).padEnd(10, '0'); lsSet('auec-web-client', id); } return id; })();

function newLedgerId(){
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('') + 'x' + Date.now().toString(36);
}
function lsGet(k){ try{ return localStorage.getItem(k) || ''; }catch(e){ return ''; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }

function webPanel(html){
  let p = document.getElementById('webPanel');
  if(!p){
    p = document.createElement('section');
    p.id = 'webPanel'; p.className = 'panel';
    document.querySelector('.wrap').insertBefore(p, document.querySelector('.tiles'));
  }
  p.innerHTML = html; p.hidden = !html;
  return p;
}

async function initWeb(){
  // 共有帳簿に接続するまでは保存させない（以前はこの間の記録がブラウザの中だけに保存されていた）
  const notReady = () => Promise.reject({code:'not-connected'});
  for(const k of ['add','addMany','remove','clearAll','setStart','setPersonStart','setHandle','dropPerson','moveLegacy']) store[k] = notReady;
  const cfg = window.FIREBASE_CONFIG || {};
  if(!cfg.apiKey || String(cfg.apiKey).startsWith('ここに')){
    $('storeNote').innerHTML = '保存先: <b>未設定</b>';
    webPanel('<h2>Firebase の設定が必要です</h2><p class="hint">config.js に Firebase の設定を貼り付けてから、もう一度開いてください。</p>');
    render(); return;
  }

  // 1) 帳簿ID（URLの#）
  let lid = location.hash.replace(/^#/, '');
  if(!/^[a-z0-9]{20,64}$/.test(lid)){
    render();
    const p = webPanel(`<h2>共有帳簿を始める</h2>
      <p class="hint">新しい帳簿を作ると専用のURLが発行されます。そのURLを相手に送れば、二人で同じ帳簿を使えます。すでに相手からURLをもらっている場合は、そのURLを開いてください。</p>
      <div style="margin-top:12px"><button class="btn" type="button" id="mkLedger">新しい帳簿を作る</button></div>`);
    p.querySelector('#mkLedger').onclick = () => { location.hash = newLedgerId(); location.reload(); };
    $('storeNote').innerHTML = '保存先: <b>帳簿が未選択</b>';
    return;
  }

  // 2) 自分の名前
  let myName = lsGet(NAME_KEY);
  if(!myName){
    $('storeNote').innerHTML = '保存先: <b>未接続</b>（名前を入れると共有帳簿に接続します）';
    render();
    await new Promise(done => {
      const p = webPanel(`<h2>あなたの名前</h2>
        <p class="hint">記録者として表示されます。ゲーム内の名前やニックネームで大丈夫です。</p>
        <form id="nameForm" class="row" style="margin-top:10px;align-items:end">
          <label><span class="lab">名前</span><input type="text" id="myName" maxlength="20" required></label>
          <button class="btn" type="submit">決定</button></form>`);
      p.querySelector('#nameForm').onsubmit = ev => {
        ev.preventDefault();
        const v = p.querySelector('#myName').value.trim();
        if(!v) return;
        lsSet(NAME_KEY, v); myName = v; done();
      };
    });
  }
  me = myName;

  // 3) Firebase
  $('storeNote').innerHTML = '保存先: <b>共有帳簿に接続中…</b>';
  const fail = msg => {
    $('storeNote').innerHTML = '保存先: <b class="neg">接続できません</b>';
    webPanel('<h2>共有帳簿に接続できませんでした</h2><p class="hint">' + msg + '</p><p class="hint">この状態では記録を保存できません。ページを読み込み直しても直らないときは、広告ブロックなどの拡張機能を一時的に止めて試してください。</p>');
  };
  if(typeof firebase === 'undefined'){ fail('接続用のプログラム（Firebase）を読み込めませんでした。'); return; }
  let fs;
  try{
    firebase.initializeApp(cfg);
    await firebase.auth().signInAnonymously();
    fs = firebase.firestore();
  }catch(e){ fail('ログインできませんでした（' + esc(e.code || e.message || e) + '）。'); return; }
  const L = fs.collection('ledgers').doc(lid);

  const shareUrl = location.href;
  // 共有URLは普段は隠し、右上の「共有URL」ボタンで開く
  const sp = webPanel(`<h2>共有URL <span class="hint" style="font-weight:400;letter-spacing:0">このURLを知っている人は誰でも読み書きできます。相手以外には教えないでください。</span>
      <button class="btn ghost" type="button" id="closeShare" style="padding:3px 10px;font-size:12px">閉じる</button></h2>
    <div class="row" style="align-items:center"><input type="text" id="shareUrl" readonly value="${esc(shareUrl)}" style="flex:1 1 260px">
    <button class="btn ghost" type="button" id="copyUrl">コピー</button>
    <button class="btn ghost" type="button" id="renameBtn">名前を変更（${esc(me)}）</button></div>`);
  sp.hidden = true;
  const hs = $('hdrShare');
  const toggleShare = open => { sp.hidden = !open; hs.setAttribute('aria-expanded', String(open)); };
  hs.hidden = false;
  hs.onclick = () => toggleShare(sp.hidden);
  $('closeShare').onclick = () => toggleShare(false);
  $('copyUrl').onclick = async () => {
    try{ await navigator.clipboard.writeText(shareUrl); toast('URLをコピーしました'); }
    catch(e){ $('shareUrl').select(); toast('選択したのでコピーしてください'); }
  };

  store.db = null;
  store.add = e => L.collection('entries').add(e);
  store.remove = id => L.collection('entries').doc(id).delete();
  store.addMany = async (list, onProgress) => {
    for(let i = 0; i < list.length; i += 400){
      const b = fs.batch();
      for(const {id, ...e} of list.slice(i, i + 400)) b.set(L.collection('entries').doc(id), e);
      await b.commit();
      onProgress && onProgress(Math.min(i + 400, list.length));
    }
  };
  store.clearAll = async () => {
    const ids = entries.map(e => e.id);
    for(let i = 0; i < ids.length; i += 400){
      const b = fs.batch();
      for(const id of ids.slice(i, i + 400)) b.delete(L.collection('entries').doc(id));
      await b.commit();
    }
  };
  store.setStart = v => L.set({startBalance:v}, {merge:true});
  store.setPersonStart = (k, v) => L.set({starts:{[k]:v}}, {merge:true});
  store.dropPerson = k => {
    const args = [];
    for(const key of Object.keys(settings.starts || {})) if(splitKey(key)[0] === k) args.push(new firebase.firestore.FieldPath('starts', key), firebase.firestore.FieldValue.delete());
    if(k in (settings.handles || {})) args.push(new firebase.firestore.FieldPath('handles', k), firebase.firestore.FieldValue.delete());
    return args.length ? L.update(...args) : Promise.resolve();
  };
  store.setHandle = (k, h) => h ? L.set({handles:{[k]:h}}, {merge:true})
    : ((k in (settings.handles || {})) ? L.update(new firebase.firestore.FieldPath('handles', k), firebase.firestore.FieldValue.delete()) : Promise.resolve());
  store.moveLegacy = k => L.set({startBalance:0, starts:{[k]:(Number((settings.starts||{})[k])||0) + (settings.startBalance||0)}}, {merge:true});
  $('storeNote').innerHTML = '保存先: <b>共有クラウド（Firebase）</b>';
  entries = []; render();

  let first = true;
  // 以前の不具合で、このブラウザの中だけに保存されていた記録があれば共有帳簿へ移す
  const migrateLocal = async () => {
    let local = [];
    try{ local = (JSON.parse(localStorage.getItem(LS_KEY) || '{}').entries) || []; }catch(e){}
    if(!local.length) return;
    const have = new Set(entries.map(e => e.src || e.id));
    const list = local.filter(e => !have.has(e.src || e.id)).map(e => ({...e, id: e.id || ('l' + Date.now() + Math.random().toString(36).slice(2, 6)), by: e.by || me}));
    try{
      if(list.length) await store.addMany(list);
      try{ localStorage.removeItem(LS_KEY); }catch(e){}
      if(list.length) toast(`このブラウザの中だけに保存されていた ${list.length}件を共有帳簿に移しました`);
    }catch(e){ toast('このブラウザの中の記録を共有帳簿に移せませんでした（' + (e.code || e) + '）'); }
  };
  L.collection('entries').onSnapshot(snap => {
    if(!first){
      for(const c of snap.docChanges()) if(c.type==='added' && !c.doc.metadata.hasPendingWrites){
        const e = c.doc.data(); if(e.by && e.by!==me) toast(`${e.by} が ${typeOf(e.type).label} ${sfmt(e.amount)} を追加しました`);
      }
    }
    const wasFirst = first;
    first = false;
    entries = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
    if(wasFirst && !snap.metadata.fromCache) migrateLocal();
  }, err => toast('記録を読み込めませんでした（'+err.code+'）'));
  L.onSnapshot(s => {
    const d = s.data() || {};
    settings = {startBalance: Number(d.startBalance) || 0, starts: d.starts || {}, handles: d.handles || {}};
    render();
  }, () => {});

  // 4) 接続中の表示（1分ごとに生存を書き込み、3分以内の人を表示）
  const P = L.collection('presence');
  const beat = () => P.doc(CLIENT_ID).set({name:me, at:firebase.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  beat(); setInterval(() => { if(document.visibilityState==='visible') beat(); }, 60000);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible') beat(); });
  addEventListener('pagehide', () => { P.doc(CLIENT_ID).delete().catch(()=>{}); });
  // 名前の変更: 古い名前の接続記録を消してから読み込み直す
  $('renameBtn').onclick = async () => {
    $('renameBtn').disabled = true;
    try{ await P.doc(CLIENT_ID).delete(); }catch(e){}
    try{ localStorage.removeItem(NAME_KEY); }catch(e){}
    location.reload();
  };
  let peers = [];
  const drawPeers = () => {
    const now = Date.now();
    const on = [...new Set(peers.filter(p => p.at && now - p.at < 180000).map(p => p.name))];
    if(!on.includes(me)) on.unshift(me);
    $('peers').hidden = false;
    $('peers').innerHTML = '<span>接続中</span>' + on.map(n => `<span class="peer">${esc(n)}${n===me?'（あなた）':''}</span>`).join('');
  };
  let swept = false;
  P.onSnapshot(s => {
    peers = s.docs.map(d => { const x = d.data({serverTimestamps:'estimate'}); return {id:d.id, name:x.name, at:x.at ? x.at.toMillis() : 0}; });
    // 閉じ損ねて残った古い接続記録（10分以上更新なし）を一度だけ掃除する
    if(!swept && !s.metadata.fromCache){
      swept = true;
      const old = peers.filter(p => p.id !== CLIENT_ID && (!p.at || Date.now() - p.at > 600000));
      for(let i = 0; i < old.length; i += 400){ const b = fs.batch(); for(const p of old.slice(i, i + 400)) b.delete(P.doc(p.id)); b.commit().catch(()=>{}); }
    }
    drawPeers();
  }, () => {});
  setInterval(drawPeers, 30000);
}
