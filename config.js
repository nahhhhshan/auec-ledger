/* Firebase コンソールの「プロジェクトの設定 → マイアプリ → SDK の設定と構成（構成）」の値を貼り付ける。
 * この値はブラウザに公開される前提のもので、秘密情報ではない（守りは firestore.rules が担う）。 */
window.FIREBASE_CONFIG = {
  apiKey: "ここに apiKey",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
