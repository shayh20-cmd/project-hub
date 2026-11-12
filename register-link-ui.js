/* Project Hub's register views (spec §§2–7): one store that every component showing register
   data shares, and those components. Loaded after React, supabase-js and register-link.js; the
   page reaches it as window.RegisterLinkUI. The project views are read-only: the one thing they
   save is the hub's own registerProjectId, through the page's save() — undefined means never
   linked, null means a person unlinked it (auto-linking leaves that alone). Settings' consultants
   and firms write through `write` below (2026-10-07 design). */
(function () {
  'use strict';
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef, useSyncExternalStore } = React;
  const RL = window.RegisterLink;
  const FRESH_MS = 5 * 60 * 1000;

  const css = document.createElement('style');
  css.textContent = [
    '.rl-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--text-2);padding:4px 0}',
    '.rl-cell{padding:10px 16px!important}',
    '.rl-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}',
    '.rl-btn:hover{border-color:var(--accent);color:var(--accent)}',
    '.rl-facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0 0 12px;font-size:13px}',
    '.rl-facts dt{color:var(--text-3)}',
    '.rl-facts dd{margin:0;color:var(--text)}',
    '.rl-actions{display:flex;gap:8px;flex-wrap:wrap}',
    '.rl-picker{display:flex;flex-direction:column;gap:8px;max-width:560px}',
    '.rl-picker-list{display:flex;flex-direction:column;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px}',
    '.rl-pick{font:inherit;font-size:13px;text-align:start;padding:7px 10px;border:0;border-bottom:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;display:flex;gap:8px;align-items:baseline}',
    '.rl-pick:hover{background:var(--surface-2)}',
    '.rl-muted{color:var(--text-3);font-size:12px;padding:6px 10px}',
    '.rl-add-pop{position:fixed;z-index:1000;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.28);overflow:hidden;font-weight:400}',
    '.rl-add-search{margin:8px;width:auto!important;box-sizing:border-box}',
    '.rl-add-list{flex:1;min-height:0;overflow:auto;border-top:1px solid var(--border)}',
    '.rl-add-item{width:100%;flex-direction:column;align-items:flex-start;gap:2px;font-size:12px}',
    '.rl-add-item:disabled{cursor:default;opacity:.7}',
    '.rl-add-firm{font-size:11px;color:var(--text-3)}',
    '.rl-add-error{margin:0 8px 8px;font-size:12px;color:var(--red,#dc2626)}',
    '.rl-dm{flex:none;margin-top:14px;border:1px solid var(--border);border-radius:8px;overflow:hidden;font-size:12px}',
    '.rl-dm-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 10px;font-weight:700;font-size:12px;color:var(--text)}',
    '.rl-dm-note{font-weight:400;font-size:11px;color:var(--text-3)}',
    '.rl-dm-tr{display:grid;grid-template-columns:76px minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center;padding:5px 10px;border-top:1px solid var(--border);text-align:start}',
    '.rl-dm-th{font-size:11px;font-weight:600;color:var(--text-3);background:var(--surface-2)}',
    '.rl-dm-sub{padding:8px 10px 4px;border-top:1px solid var(--border);font-size:11px;font-weight:600;color:var(--text-3)}',
    '.rl-dm-code{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--text)}',
    '.rl-dm-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--text-3)}',
    '.rl-dm-none{color:var(--text-3)}',
    '.rl-dm-sel{font:inherit;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);width:100%;min-width:0}',
    '.rl-dm .rl-line{padding:6px 10px}',
    '.rl-subject{font-family:ui-monospace,Consolas,monospace;font-size:11px;user-select:all;color:var(--text)}',
  ].join('\n');
  document.head.appendChild(css);

  /* ── the store ── */
  let client = null;
  let hubUrl = null;
  let recheck = () => Promise.resolve();
  let snap = { config: 'loading', signedIn: false, directory: null, projects: {}, me: null };
  const listeners = new Set();
  const set = patch => { snap = Object.assign({}, snap, patch); listeners.forEach(l => l()); };
  const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };
  const useStore = () => useSyncExternalStore(subscribe, () => snap);
  const stale = e => !!e && Date.now() - e.at > FRESH_MS;

  const inflight = {};
  function once(key, run) {
    if (!inflight[key]) inflight[key] = run().finally(() => { delete inflight[key]; });
    return inflight[key];
  }

  // persons, firms and tags: once per page load, shared by every project (spec §7).
  function loadDirectory() {
    return once('directory', () => Promise.all(['/api/persons', '/api/firms', '/api/tags'].map(p => client.get(p)))
      .then(([persons, firms, tags]) => {
        const bad = [persons, firms, tags].find(r => r.state !== 'ok');
        const answer = bad || { state: 'ok', data: { persons: persons.data, firms: firms.data, tags: tags.data } };
        set({ directory: RL.nextEntry(snap.directory, answer, Date.now()) });
      }));
  }

  // After a write: a read already on its way may predate it, so wait for it and read again.
  function reloadDirectory() {
    const pending = inflight.directory;
    return pending ? pending.then(loadDirectory, loadDirectory) : loadDirectory();
  }

  // Who is signed in, for whether Settings may edit (2026-10-07 design §1). Once per sign-in.
  function loadMe() {
    return once('me', () => client.get('/api/me').then(r => set({ me: RL.nextEntry(snap.me, r, Date.now()) })));
  }

  function loadProject(id) {
    return once('project:' + id, () => client.get('/api/projects/' + encodeURIComponent(id)).then(r => {
      set({ projects: Object.assign({}, snap.projects, { [id]: RL.nextEntry(snap.projects[id], r, Date.now()) }) });
    }));
  }

  // Forget the failed answers; the components' effects ask again.
  function retry(id) {
    const projects = Object.assign({}, snap.projects);
    if (id) delete projects[id];
    set({ projects, directory: snap.directory && snap.directory.state === 'ok' ? snap.directory : null });
  }

  function boot() {
    fetch('/api/register-config', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(cfg => {
        // A missing supabase-js or register-link.js turns the register off rather than leaving it loading.
        if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !cfg.api || !window.supabase || !RL) { set({ config: 'off' }); return; }
        hubUrl = cfg.hubUrl ? String(cfg.hubUrl).replace(/\/+$/, '') : null;
        client = RL.createRegisterClient(cfg, window.supabase.createClient);
        recheck = () => client.token().then(t => set(t
          ? { config: 'on', signedIn: true, me: snap.signedIn ? snap.me : null }
          : { config: 'on', signedIn: false, directory: null, projects: {}, me: null }));
        client.onChange(recheck);
        recheck();
      });
    window.addEventListener('focus', () => {
      if (snap.config !== 'on' || !snap.signedIn) return;
      if (stale(snap.directory)) loadDirectory();
      if (snap.me && snap.me.state !== 'ok') loadMe();
      Object.keys(snap.projects).forEach(id => { if (stale(snap.projects[id])) loadProject(id); });
    });
  }

  /* Starts the reads a linked project needs, once signed in, and re-renders with the store. */
  function useLinked(data) {
    const s = useStore();
    const id = data && data.registerProjectId;
    const haveProject = !!(id && s.projects[id]);
    const haveDirectory = !!s.directory;
    useEffect(() => {
      if (s.config !== 'on' || !s.signedIn || !id) return;
      if (!haveProject) loadProject(id);
      if (!haveDirectory) loadDirectory();
    }, [s.config, s.signedIn, id, haveProject, haveDirectory]);
    return s;
  }

  /* Which of spec §6's states a project is in. */
  function statusOf(s, id) {
    if (s.config === 'loading') return { kind: 'loading' };
    if (s.config === 'off') return { kind: 'off' };
    if (!s.signedIn) return { kind: 'signed-out' };
    if (!id) return { kind: 'unlinked' };
    const p = s.projects[id];
    const d = s.directory;
    for (const e of [p, d]) if (e && e.state !== 'ok') return { kind: e.state, subject: e.subject };
    if (!p || !d) return { kind: 'loading' };
    return { kind: 'ok', project: p.data };
  }

  /* The project's contacts are kept on the hub's server too, for filing email attachments from Outlook: the
     server cannot read the register itself. Once per page session per register project, and again only when
     they change. A copy counts as sent once the server kept it (or refused a viewer's, which is fine); one that
     failed is sent again on the next render. */
  const contactsSent = {}, contactsSending = {};
  function keepContacts(id, rows) {
    if (location.protocol === 'file:' || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return;
    const list = [];
    rows.forEach(r => r.contacts.forEach(c => { if (c.name) list.push({ name: c.name, role: r.discipline, firm: r.firm, emails: [c.email].filter(Boolean) }); }));
    const body = JSON.stringify(list.slice(0, 200));
    if (contactsSent[id] === body || contactsSending[id] === body) return;
    contactsSending[id] = body;
    fetch('/api/register-contacts/' + id, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body })
      .then(r => { if (r.ok || r.status === 403) contactsSent[id] = body; }, () => {})
      .then(() => { if (contactsSending[id] === body) delete contactsSending[id]; });
  }

  function useConsultantRows(data, hubDisciplines) {
    const s = useLinked(data);
    const id = data && data.registerProjectId;
    const p = id ? s.projects[id] : null;
    const d = s.directory;
    const ready = !!(s.config === 'on' && s.signedIn && p && p.state === 'ok' && d && d.state === 'ok');
    const rows = useMemo(() => (ready
      ? RL.buildConsultantRows(p.data.members, d.data.persons, d.data.firms, d.data.tags, hubDisciplines)
      : []), [ready, p, d, hubDisciplines]);
    useEffect(() => { if (ready) keepContacts(id, rows); }, [ready, id, rows]);
    return rows;
  }

  /* Settings' consultants and firms: the shared directory, and who is signed in. */
  function useDirectory() {
    const s = useStore();
    const haveDirectory = !!s.directory;
    const haveMe = !!s.me;
    useEffect(() => {
      if (s.config !== 'on' || !s.signedIn) return;
      if (!haveDirectory) loadDirectory();
      if (!haveMe) loadMe();
    }, [s.config, s.signedIn, haveDirectory, haveMe]);
    return s;
  }

  function directoryStatus(s) {
    if (s.config === 'loading') return { kind: 'loading' };
    if (s.config === 'off') return { kind: 'off' };
    if (!s.signedIn) return { kind: 'signed-out' };
    const d = s.directory;
    if (!d) return { kind: 'loading' };
    if (d.state !== 'ok') return { kind: d.state === 'refused' || d.state === 'signed-out' ? d.state : 'unreachable', subject: d.subject };
    return { kind: 'ok', data: d.data };
  }

  /* ── components ── */
  const projectLink = id => hubUrl + '/database/?open=' + encodeURIComponent(id);
  const line = (...children) => h('div', { className: 'rl-line' }, ...children);
  const button = (label, onClick) => h('button', { type: 'button', className: 'rl-btn', onClick }, label);

  function LinkPicker({ hubCode, onPick, onCancel }) {
    const [q, setQ] = useState(hubCode || '');
    const [res, setRes] = useState({ state: 'idle', list: [] });
    useEffect(() => {
      const term = q.trim();
      if (!term) { setRes({ state: 'idle', list: [] }); return undefined; }
      let live = true;
      const timer = setTimeout(() => {
        setRes(r => ({ state: 'loading', list: r.list }));
        client.get('/api/projects?q=' + encodeURIComponent(term) + '&limit=20').then(r => {
          if (live) setRes(r.state === 'ok' ? { state: 'ok', list: r.data } : { state: r.state, list: [] });
        });
      }, 300);
      return () => { live = false; clearTimeout(timer); };
    }, [q]);
    return h('div', { className: 'rl-picker' },
      h('input', {
        className: 'ov-edit-input', autoFocus: true, value: q,
        placeholder: 'חיפוש לפי שם, קוד או ראשי תיבות', onChange: e => setQ(e.target.value),
      }),
      h('div', { className: 'rl-picker-list' },
        res.state === 'loading' && !res.list.length ? h('div', { className: 'rl-muted' }, 'מחפש…') : null,
        res.state === 'ok' && !res.list.length ? h('div', { className: 'rl-muted' }, 'לא נמצאו פרויקטים') : null,
        ['unreachable', 'refused', 'signed-out', 'not-found'].includes(res.state) ? h('div', { className: 'rl-muted' }, 'המאגר לא עונה') : null,
        res.list.map(p => h('button', { key: p.id, type: 'button', className: 'rl-pick', onClick: () => onPick(p) },
          h('b', { 'data-i18n-skip': '' }, [p.code, p.initials].filter(Boolean).join(' · ')),
          h('span', { 'data-i18n-skip': '' }, p.nameHe || p.name),
          h('span', { className: 'rl-muted' }, RL.STATUS_HE[p.status] || p.status)))),
      h('div', null, button('ביטול', onCancel)));
  }

  function Notice({ data, save, hubCode, status }) {
    const [picking, setPicking] = useState(false);
    if (picking) {
      return h(LinkPicker, {
        hubCode,
        onCancel: () => setPicking(false),
        onPick: p => { setPicking(false); save(Object.assign({}, data, { registerProjectId: p.id })); },
      });
    }
    switch (status.kind) {
      case 'loading': return line('טוען מהמאגר…');
      case 'off': return line('המאגר לא הוגדר באתר הזה');
      case 'signed-out': return line('המאגר לא מחובר', button('התחברות למאגר', () => { client.signIn(); }));
      case 'refused': return line('אין הרשאה למאגר (KKarcDB) — מסור למנהל את המזהה:',
        h('span', { className: 'rl-subject', 'data-i18n-skip': '' }, status.subject || '—'));
      case 'unreachable': return line('המאגר לא עונה', button('נסה שוב', () => retry(data.registerProjectId)));
      case 'not-found': return line('הקישור למאגר שבור — הפרויקט לא נמצא', button('קישור מחדש', () => setPicking(true)));
      case 'unlinked': return line('הפרויקט לא מקושר למאגר', button('קישור למאגר', () => setPicking(true)));
      default: return null;
    }
  }

  function FactsCard({ data, save, hubCode }) {
    const s = useLinked(data);
    const status = statusOf(s, data.registerProjectId);
    if (status.kind === 'off') return null;
    const unlink = () => save(Object.assign({}, data, { registerProjectId: null }));
    return h('section', { className: 'pg-card' },
      h('h3', { className: 'pg-h' }, 'מהמאגר'),
      status.kind !== 'ok'
        ? h(Notice, { data, save, hubCode, status })
        : h(React.Fragment, null,
          h('dl', { className: 'rl-facts' }, RL.projectFacts(status.project).map(f => h(React.Fragment, { key: f.label },
            h('dt', null, f.label),
            h('dd', f.data ? { 'data-i18n-skip': '' } : null, f.value)))),
          h('div', { className: 'rl-actions' },
            hubUrl ? h('a', { className: 'rl-btn', href: projectLink(data.registerProjectId), target: '_blank', rel: 'noopener' }, 'פתיחה ב-KK Hub') : null,
            button('ביטול קישור', unlink))));
  }

  function ConsultantsNotice({ data, save, hubCode, colSpan }) {
    const s = useLinked(data);
    const status = statusOf(s, data.registerProjectId);
    if (status.kind === 'ok' && RL.hasConsultants(status.project)) return null;
    return h('tr', null, h('td', { colSpan, className: 'rl-cell' }, status.kind === 'ok'
      ? line('אין יועצים במאגר לפרויקט הזה')
      : h(Notice, { data, save, hubCode, status })));
  }

  function EditInHub({ data }) {
    const s = useStore();
    if (s.config !== 'on' || !hubUrl || !data.registerProjectId) return null;
    return h('a', { className: 'ov-sec-add-btn', href: projectLink(data.registerProjectId), target: '_blank', rel: 'noopener' }, 'עריכה ב-KK Hub');
  }

  // After a write to a project: a read already on its way may predate it, so wait for it and read again.
  function reloadProject(id) {
    const pending = inflight['project:' + id];
    return pending ? pending.then(() => loadProject(id), () => loadProject(id)) : loadProject(id);
  }

  /* The consultants header's "Add": every contact in the register not yet on the project, the
     search on the first line, and a pick puts that person on the project in the register. For
     the register's editors only (it refuses anyone else). The list is fixed to the window, since
     the section clips what overflows it. */
  function AddContact({ data }) {
    const s = useLinked(data);
    const id = data && data.registerProjectId;
    const [open, setOpen] = useState(null);
    const [q, setQ] = useState('');
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const wrap = useRef(null);
    const ready = s.config === 'on' && s.signedIn && !!id;
    const haveMe = !!s.me;
    useEffect(() => { if (ready && !haveMe) loadMe(); }, [ready, haveMe]);
    useEffect(() => {
      if (!open) return undefined;
      const away = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(null); };
      const esc = e => { if (e.key === 'Escape') setOpen(null); };
      const shut = () => setOpen(null);
      // The list is fixed to the window, so scrolling the page under it closes it; its own list scrolls.
      const scrolled = e => { if (!(wrap.current && e.target instanceof Node && wrap.current.contains(e.target))) setOpen(null); };
      document.addEventListener('mousedown', away);
      document.addEventListener('keydown', esc);
      window.addEventListener('resize', shut);
      window.addEventListener('scroll', scrolled, true);
      return () => {
        document.removeEventListener('mousedown', away);
        document.removeEventListener('keydown', esc);
        window.removeEventListener('resize', shut);
        window.removeEventListener('scroll', scrolled, true);
      };
    }, [open]);
    const p = id ? s.projects[id] : null;
    const d = s.directory;
    const list = useMemo(() => (open && p && p.state === 'ok' && d && d.state === 'ok'
      ? RL.addableContacts(d.data.persons, d.data.firms, p.data.members, q) : []), [open, p, d, q]);
    if (!ready || !(s.me && s.me.state === 'ok' && RL.canEditRegister(s.me.data.role))) return null;

    const toggle = e => {
      if (open) { setOpen(null); return; }
      const r = e.currentTarget.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 16);
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
      const left = Math.max(8, Math.min(rtl ? r.right - width : r.left, window.innerWidth - width - 8));
      const top = r.bottom + 4;
      setQ(''); setError(null);
      setOpen({ left, top, width, maxHeight: Math.max(160, Math.min(380, window.innerHeight - top - 8)) });
    };
    const pick = person => {
      if (busy) return;
      setBusy(person.id); setError(null);
      client.send('PUT', '/api/projects/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(person.id), null)
        .then(r => {
          setBusy(null);
          if (r.state === 'signed-out') recheck();
          if (r.state === 'ok') { setOpen(null); reloadProject(id); return; }
          setError(RL.writeErrorOf(r).text);
        }, () => { setBusy(null); setError(RL.writeErrorOf({ state: 'unreachable' }).text); });
    };
    const directoryReady = d && d.state === 'ok' && p && p.state === 'ok';
    const readFailed = [p, d].some(e => e && e.state !== 'ok');
    return h('span', { ref: wrap, style: { display: 'inline-flex' } },
      h('button', { type: 'button', className: 'ov-sec-add-btn', style: open ? { opacity: 1 } : null, onClick: toggle, 'aria-expanded': !!open }, 'הוספה'),
      open ? h('div', {
        className: 'rl-add-pop', role: 'dialog',
        style: { left: open.left, top: open.top, width: open.width, maxHeight: open.maxHeight },
      },
      h('input', {
        className: 'ov-edit-input rl-add-search', autoFocus: true, value: q, type: 'search',
        placeholder: 'חיפוש לפי שם או משרד', onChange: e => setQ(e.target.value),
      }),
      error ? h('div', { className: 'rl-add-error' }, error) : null,
      h('div', { className: 'rl-add-list' },
        readFailed ? h('div', { className: 'rl-line rl-muted' }, 'המאגר לא עונה', button('נסה שוב', () => retry(id))) : null,
        !directoryReady && !readFailed ? h('div', { className: 'rl-muted' }, 'טוען…') : null,
        directoryReady && !list.length ? h('div', { className: 'rl-muted' }, 'אין אנשי קשר תואמים') : null,
        list.map(c => h('button', {
          key: c.id, type: 'button', className: 'rl-pick rl-add-item', disabled: !!busy, onClick: () => pick(c),
        },
        h('span', { className: 'rl-add-name', 'data-i18n-skip': '' }, c.name),
        c.firm ? h('span', { className: 'rl-add-firm', 'data-i18n-skip': '' }, c.firm) : null,
        busy === c.id ? h('span', { className: 'rl-muted' }, 'מוסיף…') : null)))) : null);
  }

  /* Spec §2: a never-linked project whose code names exactly one register project is linked to
     it — once per code per page load, and never for someone who may not edit. */
  const tried = new Set();
  function AutoLink({ data, save, hubCode, canEdit }) {
    const s = useStore();
    const latest = useRef(null);
    latest.current = { data, save };
    const code = String(hubCode || '').trim();
    const neverLinked = !!data && data.registerProjectId === undefined;
    useEffect(() => {
      if (s.config !== 'on' || !s.signedIn || !canEdit || !neverLinked || !code || tried.has(code)) return;
      tried.add(code);
      client.get('/api/projects?q=' + encodeURIComponent(code) + '&limit=20').then(r => {
        if (r.state !== 'ok') return;
        const hits = RL.matchProjects(code, r.data);
        const cur = latest.current;
        if (hits.length === 1 && cur.data && cur.data.registerProjectId === undefined) {
          cur.save(Object.assign({}, cur.data, { registerProjectId: hits[0].id }));
        }
      });
    }, [s.config, s.signedIn, canEdit, neverLinked, code]);
    return null;
  }

  /* A write to the register (2026-10-07 design §2). `local` — { list, id, patch } — is applied at
     once on success, so a cell does not flick back while the directory is re-read. */
  function write(method, path, body, local) {
    if (!client) return Promise.resolve({ state: 'unreachable' });
    return client.send(method, path, body).then(r => {
      const d = snap.directory;
      if (r.state === 'ok' && local && d && d.state === 'ok') {
        set({ directory: Object.assign({}, d, { data: RL.withEdit(d.data, local.list, local.id, local.patch) }) });
      }
      if (r.state === 'signed-out') recheck();
      if (r.state === 'ok' || r.state === 'changed' || r.state === 'not-found') reloadDirectory();
      return r;
    });
  }

  /* Settings → Fields → Discipline: each hub code beside the register discipline it stands for,
     in Hebrew and in English, then the register disciplines no code claims. With canEdit the
     Hebrew cell is a picker; onPick(id, code) is the caller's ('' = no match); note overrides
     the line beside the title. A register
     discipline already claimed by another code can't be picked twice. */
  function DisciplineMatch({ list, canEdit, onPick, note }) {
    const s = useDirectory();
    const status = directoryStatus(s);
    const head = h('div', { className: 'rl-dm-head' }, 'התאמה ל-KKarcDB',
      h('span', { className: 'rl-dm-note' }, note || (canEdit ? 'ההתאמה משותפת לכל המשרד' : 'רק מנהל המשרד משנה את ההתאמה')));
    if (status.kind !== 'ok') return h('div', { className: 'rl-dm' }, head, h(DirectoryNotice, { status }));
    const { rows, unmatched } = RL.disciplineMatchRows(list, status.data.tags);
    const claimedBy = new Map();
    rows.forEach(r => { if (r.registerCode && !r.duplicate) claimedBy.set(r.registerCode, r.label); });
    const all = RL.disciplineChoices(status.data.tags, null, 'he');
    const byCode = new Map((status.data.tags || []).filter(t => t.typeCode === 'discipline').map(t => [t.code, t]));
    const he = t => (t && (t.nameHe || t.nameEn)) || '';
    const en = t => (t && (t.nameEn || '')) || '';
    const skip = { 'data-i18n-skip': '' };
    // <bdi> isolates the name's own direction while the cell stays aligned with the page.
    const cell = (text, extra) => h('span', Object.assign({ role: 'cell' }, skip, extra), h('bdi', null, text));
    const none = h('span', { role: 'cell', className: 'rl-dm-none' }, '—');
    const codeCell = r => h('span', { role: 'cell' }, h('span', Object.assign({ className: 'rl-dm-code' }, skip),
      h('span', { className: 'rl-dm-dot', style: r.color ? { background: r.color } : null }), r.label));
    const picker = r => h('span', { role: 'cell' }, h('select', {
      className: 'rl-dm-sel',
      value: r.registerCode && !r.duplicate ? r.registerCode : '',
      'aria-label': 'תחום ב-KKarcDB',
      onChange: e => onPick && onPick(r.id, e.target.value),
    }, h('option', { value: '' }, 'ללא התאמה'),
      all.map(c => {
        const owner = claimedBy.get(c.code);
        const taken = !!owner && c.code !== r.registerCode;
        return h('option', Object.assign({ key: c.code, value: c.code, disabled: taken }, skip),
          he(byCode.get(c.code)) + (taken ? ' · ' + owner : ''));
      }),
      r.registerCode && !r.tag && !r.duplicate ? h('option', Object.assign({ value: r.registerCode }, skip), r.registerCode) : null));
    const hebrew = r => r.tag ? cell(he(r.tag)) : r.registerCode ? cell(r.registerCode, { className: 'rl-dm-none' }) : none;
    const tr = (key, cells) => h('div', { key, className: 'rl-dm-tr', role: 'row' }, ...cells);
    return h('div', { className: 'rl-dm' }, head,
      h('div', { role: 'table', 'aria-label': 'התאמה ל-KKarcDB' },
        h('div', { className: 'rl-dm-tr rl-dm-th', role: 'row' },
          h('span', { role: 'columnheader' }, 'קוד'),
          h('span', { role: 'columnheader' }, 'שם בעברית'),
          h('span', { role: 'columnheader' }, 'שם באנגלית')),
        rows.map(r => tr(r.id, [
          codeCell(r),
          canEdit ? picker(r) : r.duplicate ? none : hebrew(r),
          r.tag && !r.duplicate ? cell(en(r.tag)) : none,
        ])),
        unmatched.length ? h('div', { className: 'rl-dm-sub', role: 'row' }, h('span', { role: 'cell' }, 'ללא קוד')) : null,
        unmatched.map(t => tr('u:' + t.code, [none, cell(he(t)), en(t) ? cell(en(t)) : none]))));
  }

  // The project notice, for the directory's states (loading, off, signed-out, refused, unreachable).
  function DirectoryNotice({ status }) {
    return h(Notice, { data: {}, save: () => {}, hubCode: '', status });
  }

  const hubLink = path => (hubUrl ? hubUrl + path : null);

  // A failed /api/me is forgotten, so useDirectory asks again (a cold start must not leave
  // Settings read-only until a reload).
  const retryMe = () => { if (snap.me && snap.me.state !== 'ok') set({ me: null }); };

  window.RegisterLinkUI = {
    useConsultantRows, FactsCard, ConsultantsNotice, EditInHub, AddContact, AutoLink, DisciplineMatch,
    useDirectory, directoryStatus, DirectoryNotice, write, hubLink, retryMe,
  };
  boot();
})();
