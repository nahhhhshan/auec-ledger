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
  firebase.initializeApp(cfg);
  try{ await firebase.auth().signInAnonymously(); }
  catch(e){ webPanel('<h2>接続できませんでした</h2><p class="hint">Firebase の匿名ログインが有効か確認してください（'+esc(e.code||e.message)+'）。</p>'); return; }
  const fs = firebase.firestore();
  const L = fs.collection('ledgers').doc(lid);

  const shareUrl = location.href;
  webPanel(`<h2>共有URL <span class="hint" style="font-weight:400;letter-spacing:0">このURLを知っている人は誰でも読み書きできます。相手以外には教えないでください。</span></h2>
    <div class="row" style="align-items:center"><input type="text" id="shareUrl" readonly value="${esc(shareUrl)}" style="flex:1 1 260px">
    <button class="btn ghost" type="button" id="copyUrl">コピー</button>
    <button class="btn ghost" type="button" id="renameBtn">名前を変更（${esc(me)}）</button></div>`);
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
  // 名前の付け替え: ルールで記録の書き換えは禁止なので、新しい名前で複製 → 古い記録を削除の順（途中で止まっても記録は消えない）
  store.renamePerson = async (from, to) => {
    const olds = entries.filter(e => e.by === from);
    const tag = Date.now().toString(36);
    for(let i = 0; i < olds.length; i += 400){
      const b = fs.batch();
      for(const {id, ...e} of olds.slice(i, i + 400)) b.set(L.collection('entries').doc(id.split('~')[0] + '~' + tag), {...e, by: to});
      await b.commit();
    }
    for(let i = 0; i < olds.length; i += 400){
      const b = fs.batch();
      for(const e of olds.slice(i, i + 400)) b.delete(L.collection('entries').doc(e.id));
      await b.commit();
    }
    // 開始額（通算の「名前」と、期ごとの「名前@日付」）をまとめて移す
    const st = settings.starts || {}, FP = firebase.firestore.FieldPath, args = [];
    for(const k of Object.keys(st)){
      const [p, d] = splitKey(k); if(p !== from) continue;
      const nk = d ? `${to}@${d}` : to;
      args.push(new FP('starts', nk), (Number(st[nk])||0) + (Number(st[k])||0), new FP('starts', k), firebase.firestore.FieldValue.delete());
    }
    const hs = settings.handles || {};
    if(from in hs) args.push(new FP('handles', to), hs[from], new FP('handles', from), firebase.firestore.FieldValue.delete());
    if(args.length) await L.update(...args);
    if(from === me){ lsSet(NAME_KEY, to); me = to; beat(); const rb = document.getElementById('renameBtn'); if(rb) rb.textContent = `名前を変更（${to}）`; }
  };
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
  L.collection('entries').onSnapshot(snap => {
    if(!first){
      for(const c of snap.docChanges()) if(c.type==='added' && !c.doc.metadata.hasPendingWrites){
        const e = c.doc.data(); if(e.by && e.by!==me) toast(`${e.by} が ${typeOf(e.type).label} ${sfmt(e.amount)} を追加しました`);
      }
    }
    first = false;
    entries = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
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
