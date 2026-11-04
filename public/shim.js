/* Ironmind fora do claude.ai.
   Este arquivo recria os serviços que o app usava dentro do claude.ai
   (window.claude.use("db" | "user" | "downloads")) usando:
   - Supabase: login por e-mail, banco de dados e perfis;
   - download direto pelo navegador.
   O app (app.js) só é carregado depois do login. */
(function () {
  const CFG = window.IRONMIND_CONFIG || {};
  const VER = (document.currentScript && document.currentScript.src.split("v=")[1]) || "1";
  const SHARED = ["liga", "desafios", "feed", "curtidas", "clubes"];
  const $ = s => document.querySelector(s);
  const auth = $("#auth"), msg = $("#auth-msg");
  const say = (t, bad) => { msg.textContent = t; msg.className = "auth-msg" + (bad ? " bad" : ""); };

  if (!CFG.supabaseUrl || CFG.supabaseUrl.includes("COLE_AQUI") || !window.supabase) {
    auth.hidden = false; $("#auth-form").hidden = true;
    say("Falta configurar o arquivo config.js com os dados do Supabase. Veja o LEIA-ME.", true);
    return;
  }
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
  });

  /* ---------- cache local (para abrir sem internet) ---------- */
  const CK = "im:cache:";
  const cacheGet = k => { try { return JSON.parse(localStorage.getItem(CK + k)); } catch { return null; } };
  const cacheSet = (k, v) => { try { v == null ? localStorage.removeItem(CK + k) : localStorage.setItem(CK + k, JSON.stringify(v)); } catch {} };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

  /* ---------- banco: coleções e documentos ---------- */
  let USER = null;
  const watchers = new Map(); // coleção -> Set de funções que recarregam
  function poke(col) { (watchers.get(col) || []).forEach(f => f()); }

  function snapDoc(id, data) { return { id, exists: data != null, data: () => clone(data) }; }
  async function listCol(col) {
    const { data, error } = await sb.from("docs").select("id,data").eq("col", col);
    if (error) { const c = cacheGet("col:" + col); if (c) return c; throw error; }
    const rows = data.map(r => ({ id: r.id, data: r.data }));
    cacheSet("col:" + col, rows);
    return rows;
  }
  function makeDoc(col, id) {
    return {
      id,
      async get() {
        const { data, error } = await sb.from("docs").select("data").eq("col", col).eq("id", id).maybeSingle();
        if (error) { const c = cacheGet("doc:" + col + "/" + id); if (c !== null) return snapDoc(id, c.v); throw error; }
        cacheSet("doc:" + col + "/" + id, { v: data ? data.data : null });
        return snapDoc(id, data ? data.data : null);
      },
      async set(v) {
        const { error } = await sb.from("docs").upsert({ col, id, owner: USER.id, data: v, updated_at: new Date().toISOString() });
        if (error) throw error;
        cacheSet("doc:" + col + "/" + id, { v });
        poke(col);
      },
      async delete() {
        const { error } = await sb.from("docs").delete().eq("col", col).eq("id", id);
        if (error) throw error;
        cacheSet("doc:" + col + "/" + id, { v: null });
        poke(col);
      }
    };
  }
  function makeCol(col) {
    return {
      doc: id => makeDoc(col, id),
      async get() { const rows = await listCol(col); return { docs: rows.map(r => snapDoc(r.id, r.data)) }; },
      onSnapshot(cb, onErr) {
        let alive = true, busy = false;
        const load = async () => {
          if (!alive || busy) return; busy = true;
          try { const rows = await listCol(col); if (alive) cb({ docs: rows.map(r => snapDoc(r.id, r.data)) }); }
          catch (e) { onErr && onErr(e); }
          finally { busy = false; }
        };
        if (!watchers.has(col)) watchers.set(col, new Set());
        watchers.get(col).add(load);
        load();
        const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
        const vis = () => { if (document.visibilityState === "visible") load(); };
        document.addEventListener("visibilitychange", vis);
        // tempo real: atualiza quando um amigo muda algo nesta coleção
        let ch = null;
        if (SHARED.includes(col)) {
          try { ch = sb.channel("rt-" + col + "-" + Math.random().toString(36).slice(2))
            .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "col=eq." + col }, () => load())
            .subscribe(); } catch {}
        }
        return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); watchers.get(col)?.delete(load); if (ch) sb.removeChannel(ch); };
      }
    };
  }
  const db = {
    collection: path => makeCol(path),
    doc: path => { const i = path.lastIndexOf("/"); return makeDoc(path.slice(0, i), path.slice(i + 1)); }
  };

  /* ---------- usuário e perfis ---------- */
  const profCache = {};
  const user = {
    id: async () => USER?.id || null,
    async profiles(ids) {
      ids = [...new Set(ids)].filter(Boolean);
      const need = ids.filter(i => !profCache[i]);
      if (need.length) {
        const { data } = await sb.from("profiles").select("id,name").in("id", need);
        (data || []).forEach(r => { profCache[r.id] = { name: r.name || "Atleta" }; });
      }
      return Object.fromEntries(ids.map(i => [i, profCache[i] || { name: "Atleta" }]));
    }
  };

  /* ---------- downloads ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
      if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { if (e?.name === "AbortError") return; }
      }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  };

  window.claude = { async use(n) { return { db, user, downloads }[n] || null; } }; // sem IA nesta versão

  /* ---------- login ---------- */
  async function ensureProfile(u) {
    const want = (localStorage.getItem("im:nome") || u.user_metadata?.name || (u.email || "").split("@")[0] || "Atleta").trim().slice(0, 40);
    const { data } = await sb.from("profiles").select("name").eq("id", u.id).maybeSingle();
    if (!data) await sb.from("profiles").upsert({ id: u.id, name: want });
  }
  let started = false;
  async function startApp(u) {
    if (started) return; started = true; USER = u;
    try { localStorage.setItem("im:uid", u.id); } catch {}
    auth.hidden = true; $("#app").hidden = false;
    ensureProfile(u).catch(() => {});
    const s = document.createElement("script"); s.src = "app.js?v=" + VER; document.body.appendChild(s);
  }
  $("#auth-form").onsubmit = async e => {
    e.preventDefault();
    const email = $("#auth-email").value.trim(), nome = $("#auth-name").value.trim();
    if (!email) return;
    try { if (nome) localStorage.setItem("im:nome", nome); } catch {}
    $("#auth-send").disabled = true; say("Enviando…");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, data: nome ? { name: nome } : undefined } });
    $("#auth-send").disabled = false;
    if (error) say("Não consegui enviar: " + error.message, true);
    else say("Pronto! Abra o e-mail que enviamos para " + email + " e toque no link para entrar.");
  };
  window.ironmindSignOut = async () => { try { await sb.auth.signOut(); } catch {} try { Object.keys(localStorage).filter(k => k.startsWith(CK) || k.startsWith("forja:")).forEach(k => localStorage.removeItem(k)); } catch {} location.reload(); };

  sb.auth.onAuthStateChange((_ev, session) => { if (session?.user) startApp(session.user); });
  sb.auth.getSession().then(({ data }) => {
    if (data.session?.user) startApp(data.session.user);
    else { auth.hidden = false; $("#auth-email").focus(); }
  });

  /* ---------- instalação e offline ---------- */
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  let deferred = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; document.querySelectorAll("[data-install]").forEach(b => b.hidden = false); });
  window.ironmindInstall = async () => { if (!deferred) return false; deferred.prompt(); await deferred.userChoice; deferred = null; document.querySelectorAll("[data-install]").forEach(b => b.hidden = true); return true; };
})();
