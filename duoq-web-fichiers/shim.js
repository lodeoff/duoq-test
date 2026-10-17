// Adaptateur : fournit à DuoQ la même interface que claude.ai (window.claude.use("db"|"user"|"sample"|"downloads"))
// branchée sur Supabase. Script classique (pas de build) : supabase-js est chargé à la demande depuis un CDN épinglé.
(function () {
  "use strict";
  var cfg = window.DUOQ_CONFIG;
  var SB_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
  var apiP = null;
  function build(createClient) {
const sb = createClient(cfg.url, cfg.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
});
const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/* ---------- connexion (écran minimal, dans le thème) ---------- */
let sessionP = null;
function loginScreen() {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px;background:#08051a;color:#f6f2ff;font-family:Figtree,system-ui,sans-serif";
    box.innerHTML =
      '<form style="width:min(380px,100%);display:grid;gap:12px">' +
      '<h1 style="font-family:\'Chakra Petch\',sans-serif;margin:0;font-size:2rem;color:#ff4fc3;text-shadow:0 0 14px #ff4fc3">DuoQ</h1>' +
      '<p id="lm" style="margin:0;color:#b9b0e6">Connecte-toi pour retrouver tes matchs.</p>' +
      '<input id="le" type="email" autocomplete="email" placeholder="E-mail" required style="padding:14px;border-radius:10px;border:1px solid #6a58c8;background:#150f3a;color:#fff;font-size:16px">' +
      '<input id="lp" type="password" autocomplete="current-password" minlength="8" placeholder="Mot de passe (8 caractères min.)" required style="padding:14px;border-radius:10px;border:1px solid #6a58c8;background:#150f3a;color:#fff;font-size:16px">' +
      '<button id="lb" type="submit" style="padding:14px;border-radius:10px;border:0;background:#2ef2ff;color:#031f26;font-weight:700;font-size:16px">Se connecter</button>' +
      '<button id="ls" type="button" style="padding:12px;border-radius:10px;border:1px solid #6a58c8;background:transparent;color:#f6f2ff;font-size:15px">Créer un compte</button>' +
      '<button id="lr" type="button" style="padding:8px;border:0;background:transparent;color:#b9b0e6;font-size:14px;text-decoration:underline">Mot de passe oublié</button>' +
      '</form>';
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s), msg = (t) => ($("#lm").textContent = t);
    const done = (s) => { box.remove(); resolve(s); };
    const creds = () => ({ email: $("#le").value.trim(), password: $("#lp").value });
    $("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { data, error } = await sb.auth.signInWithPassword(creds());
      if (error) msg("E-mail ou mot de passe incorrect."); else done(data.session);
    });
    $("#ls").addEventListener("click", async () => {
      const c = creds();
      if (!c.email || c.password.length < 8) { msg("Indique un e-mail et un mot de passe de 8 caractères minimum."); return; }
      const { data, error } = await sb.auth.signUp(c);
      if (error) msg("Création impossible : " + error.message);
      else if (data.session) done(data.session);
      else msg("Compte créé. Clique sur le lien reçu par e-mail, puis reviens te connecter.");
    });
    $("#lr").addEventListener("click", async () => {
      const em = $("#le").value.trim();
      if (!em) { msg("Écris d'abord ton e-mail."); return; }
      await sb.auth.resetPasswordForEmail(em);
      msg("Si ce compte existe, un e-mail de réinitialisation vient d'être envoyé.");
    });
  });
}
function session() {
  if (!sessionP) {
    sessionP = sb.auth.getSession().then(({ data }) => data.session || loginScreen());
  }
  return sessionP;
}

/* ---------- base de données (interface type Firestore sur la table public.docs) ---------- */
const split = (path) => { const i = path.lastIndexOf("/"); return { coll: path.slice(0, i), id: path.slice(i + 1) }; };
const snapDoc = (row) => ({ id: row.id, data: () => row.data });
const mkErr = (e) => {
  const x = new Error((e && e.message) || "erreur");
  x.code = e && (e.code === "42501" || e.status === 403) ? "permission_denied" : (e && e.code) || "error";
  return x;
};

const listeners = new Set(); // { coll, fn(type,row|path) }
let channel = null;
function startRealtime() {
  if (channel) return;
  channel = sb.channel("docs-all")
    .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (p) => {
      if (p.eventType === "DELETE") listeners.forEach((l) => l.fn("del", p.old.path));
      else listeners.forEach((l) => { if (l.coll === p.new.coll) l.fn("set", p.new); });
    })
    .subscribe();
}
async function fetchAll(coll) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from("docs").select("path,coll,id,data").eq("coll", coll).order("path").range(from, from + 999);
    if (error) throw mkErr(error);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}
function query(coll, orderField) {
  const sorted = (rows) => {
    const r = rows.slice();
    if (orderField) r.sort((a, b) => ((a.data || {})[orderField] || 0) - ((b.data || {})[orderField] || 0));
    return r;
  };
  const mkSnap = (rows) => ({ docs: sorted(rows).map(snapDoc), metadata: { fromCache: false }, size: rows.length });
  return {
    orderBy(f) { return query(coll, f); },
    async get() { return mkSnap(await fetchAll(coll)); },
    async add(obj) {
      const id = rid();
      const { error } = await sb.from("docs").insert({ path: coll + "/" + id, coll, id, data: obj });
      if (error) throw mkErr(error);
      return { id };
    },
    onSnapshot(cb, errcb) {
      const map = new Map(); let dead = false;
      const emit = () => { if (!dead) cb(mkSnap(Array.from(map.values()))); };
      const l = { coll, fn: (t, v) => { if (t === "del") map.delete(v); else map.set(v.path, v); emit(); } };
      const reload = () => fetchAll(coll).then((rows) => { map.clear(); rows.forEach((r) => map.set(r.path, r)); emit(); }, (e) => errcb && errcb(mkErr(e)));
      listeners.add(l); startRealtime(); reload();
      const vis = () => { if (document.visibilityState === "visible") reload(); };
      document.addEventListener("visibilitychange", vis);
      const poll = setInterval(reload, 45000); // filet de sécurité si le temps réel décroche
      return () => { dead = true; listeners.delete(l); clearInterval(poll); document.removeEventListener("visibilitychange", vis); };
    }
  };
}
const dbApi = {
  collection: (coll) => query(coll),
  doc(path) {
    const { coll, id } = split(path);
    return {
      async get() {
        const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
        if (error) throw mkErr(error);
        return { exists: !!data, id, data: () => (data ? data.data : undefined) };
      },
      async set(obj) {
        const { error } = await sb.from("docs").upsert({ path, coll, id, data: obj, at: Date.now() });
        if (error) throw mkErr(error);
      },
      async update(obj) {
        const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
        if (error) throw mkErr(error);
        if (!data) { const e = new Error("not_found"); e.code = "not_found"; throw e; }
        const { error: e2 } = await sb.from("docs").update({ data: Object.assign({}, data.data, obj), at: Date.now() }).eq("path", path);
        if (e2) throw mkErr(e2);
      },
      async delete() {
        const { error } = await sb.from("docs").delete().eq("path", path);
        if (error) throw mkErr(error);
      }
    };
  }
};

/* ---------- utilisateur ---------- */
const userApi = (s) => ({
  id: async () => s.user.id,
  me: async () => ({ id: s.user.id }),
  can: async () => true,
  canEdit: () => false,
  isOwner: async () => {
    const { data } = await sb.auth.getUser();
    return !!(data && data.user && data.user.app_metadata && data.user.app_metadata.role === "admin");
  }
});

/* ---------- Pixel (IA) : appel d'une fonction serveur, la clé API n'est jamais dans l'app ---------- */
async function sample(prompt) {
  const { data, error } = await sb.functions.invoke("pixel", { body: { prompt: String(prompt).slice(0, 4000) } });
  if (error || !data || typeof data.text !== "string") throw new Error("pixel_unavailable");
  return { text: data.text, truncated: false };
}

/* ---------- export de données ---------- */
const downloads = native ? null : {
  async save({ filename, data }) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  }
};


    var claude = {
      async use(name) {
        if (name === "user") return userApi(await session());
        if (name === "db") { await session(); return dbApi; }
        if (name === "sample") return cfg.pixel === false ? null : sample;
        if (name === "downloads") return downloads;
        return null;
      }
    };
    window.DUOQ = {
      native,
      async signOut() { await sb.auth.signOut(); location.reload(); },
      async deleteAccount() {
        const { error } = await sb.rpc("delete_my_account");
        if (error) throw mkErr(error);
        await sb.auth.signOut();
      }
    };
    return claude;
  }
  window.claude = {
    use: function (name) {
      if (!apiP) apiP = import(SB_URL).then(function (m) { return build(m.createClient); });
      return apiP.then(function (c) { return c.use(name); });
    }
  };
})();
