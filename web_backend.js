/* GitHub Pages 版のデータ保存（Firebase Firestore）。
 * ledger.html の MODE='web' から initWeb() が呼ばれる。
 * 帳簿は URL の #以降（推測できない長いID）で区別し、それを知っている人だけが読み書きできる。 */

const NAME_KEY = 'auec-web-name';
const CLIENT_ID = Math.random().toString(36).slice(2, 12);

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
  $('renameBtn').onclick = () => { try{ localStorage.removeItem(NAME_KEY); }catch(e){} location.reload(); };

  store.db = null;
  store.add = e => L.collection('entries').add(e);
  store.remove = id => L.collection('entries').doc(id).delete();
  store.setStart = v => L.set({startBalance:v}, {merge:true});
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
    settings = {startBalance: Number((s.data()||{}).startBalance) || 0};
    render();
  }, () => {});

  // 4) 接続中の表示（1分ごとに生存を書き込み、3分以内の人を表示）
  const P = L.collection('presence');
  const beat = () => P.doc(CLIENT_ID).set({name:me, at:firebase.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  beat(); setInterval(() => { if(document.visibilityState==='visible') beat(); }, 60000);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible') beat(); });
  addEventListener('pagehide', () => { P.doc(CLIENT_ID).delete().catch(()=>{}); });
  let peers = [];
  const drawPeers = () => {
    const now = Date.now();
    const on = [...new Set(peers.filter(p => p.at && now - p.at < 180000).map(p => p.name))];
    if(!on.includes(me)) on.unshift(me);
    $('peers').hidden = false;
    $('peers').innerHTML = '<span>接続中</span>' + on.map(n => `<span class="peer">${esc(n)}${n===me?'（あなた）':''}</span>`).join('');
  };
  P.onSnapshot(s => {
    peers = s.docs.map(d => { const x = d.data({serverTimestamps:'estimate'}); return {name:x.name, at:x.at ? x.at.toMillis() : 0}; });
    drawPeers();
  }, () => {});
  setInterval(drawPeers, 30000);
}
