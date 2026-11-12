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
    '.rl-combo-list{padding:4px 0;overflow-y:auto;overscroll-behavior:contain}',
    '.rl-combo-opt{flex:none;padding:6px 10px;font-size:12px;cursor:pointer;color:var(--text);text-align:start}',
    '.rl-combo-opt.on{background:var(--surface-2);box-shadow:inset 3px 0 0 var(--accent)}',
    '[dir=rtl] .rl-combo-opt.on{box-shadow:inset -3px 0 0 var(--accent)}',
    '.rl-combo-row{display:flex;align-items:center;gap:6px;min-width:0}',
    '.rl-combo-person{flex-direction:column;align-items:flex-start;gap:1px}',
    '.rl-addrow .ov-row-save-btn:disabled{opacity:.35;cursor:default}',
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
  let snap = { config: 'loading', signedIn: false, directory: null, projects: {}, me: null, adding: null };
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

  /* The consultants header's "Add" (register editors only; the register refuses anyone else). It
     opens a row at the top of the table — RegisterLinkUI.AddContactRow — and closes it again. */
  function AddContact({ data }) {
    const s = useLinked(data);
    const id = data && data.registerProjectId;
    const ready = s.config === 'on' && s.signedIn && !!id;
    const haveMe = !!s.me;
    useEffect(() => { if (ready && !haveMe) loadMe(); }, [ready, haveMe]);
    if (!ready || !(s.me && s.me.state === 'ok' && RL.canEditRegister(s.me.data.role))) return null;
    const open = s.adding === id;
    return h('button', {
      type: 'button', className: 'ov-sec-add-btn', style: { opacity: 1 }, 'aria-expanded': open,
      onClick: () => set({ adding: open ? null : id }),
    }, 'הוספה');
  }

  /* The consultants table's ×: takes a row's people off the project in the register (they stay
     in the directory), then reads the project again. For the register's editors only — null for
     anyone else, so the page shows no ×. Resolves to an error sentence, or null when it worked;
     someone already gone (404) counts as done. */
  function useRemoveConsultant(data) {
    const s = useLinked(data);
    const id = data && data.registerProjectId;
    const ready = s.config === 'on' && s.signedIn && !!id;
    const haveMe = !!s.me;
    useEffect(() => { if (ready && !haveMe) loadMe(); }, [ready, haveMe]);
    if (!ready || !(s.me && s.me.state === 'ok' && RL.canEditRegister(s.me.data.role))) return null;
    return row => {
      const ids = RL.removalOf(row, []).personIds;
      return Promise.all(ids.map(pid => client.send('DELETE', '/api/projects/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(pid))
        .catch(() => ({ state: 'unreachable' }))))
        .then(rs => {
          if (rs.some(r => r.state === 'signed-out')) recheck();
          reloadProject(id);
          const bad = rs.find(r => r.state !== 'ok' && r.state !== 'not-found');
          return bad ? RL.writeErrorOf(bad).text : null;
        });
    };
  }

  /* One field of the add row: an input whose list opens on focus, narrows as you type, and takes
     its first entry on Enter (the arrows move through it). `label` is the pick's text, `onQuery`
     hands the search to the caller, who narrows `options`; `onDone` follows a pick (the next
     field), `onEscape` an Escape with the list shut. The list is fixed to the window, above the
     field when there is no room below, since the table's box clips what overflows it. */
  function Combo({ label, options, keyOf, textOf, renderOption, onPick, onClear, onQuery, onDone, onEscape, placeholder, inputRef }) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState('');
    const [pos, setPos] = useState(null);
    const [hi, setHi] = useState(0);
    const own = useRef(null);
    const list = useRef(null);
    const ref = inputRef || own;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
      const rtl = getComputedStyle(el).direction === 'rtl';
      const left = Math.max(8, Math.min(rtl ? r.right - width : r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 8;
      const up = below < 200 && r.top - 8 > below;
      setPos(up
        ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(300, r.top - 12) }
        : { left, width, top: r.bottom + 4, maxHeight: Math.min(300, below - 4) });
    };
    const shut = () => { setPos(null); setEditing(false); onQuery(''); };
    // A scroll outside the list (the page, the table, or focus() bringing the field into view)
    // moves the list with its field; it shuts only once the field has left the window.
    const isOpen = !!pos;
    useEffect(() => {
      if (!isOpen) return undefined;
      const scrolled = e => {
        if (list.current && e.target instanceof Node && list.current.contains(e.target)) return;
        const r = ref.current && ref.current.getBoundingClientRect();
        if (!r || r.bottom < 0 || r.top > window.innerHeight) shut(); else place();
      };
      window.addEventListener('resize', shut);
      window.addEventListener('scroll', scrolled, true);
      return () => { window.removeEventListener('resize', shut); window.removeEventListener('scroll', scrolled, true); };
    }, [isOpen]);
    useEffect(() => { setHi(0); }, [options.length]);
    useEffect(() => {
      const el = list.current && list.current.querySelector('[aria-selected="true"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }, [hi]);
    const pick = o => { onPick(o); shut(); if (onDone) onDone(o); };
    const onKeyDown = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!pos) { place(); return; }
        const n = options.length;
        if (n) setHi(i => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pos && options.length) pick(options[Math.min(hi, options.length - 1)]);
        else if (!pos && label && onDone) onDone(null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (pos) shut(); else if (onEscape) onEscape();
      } else if (e.key === 'Tab') {
        shut();
      }
    };
    return h(React.Fragment, null,
      h('input', {
        ref, className: 'ov-edit-input rl-combo', value: editing ? text : label, placeholder,
        role: 'combobox', 'aria-expanded': !!pos, 'aria-autocomplete': 'list', autoComplete: 'off',
        onFocus: e => { e.target.select(); place(); },
        onClick: () => { if (!pos) place(); },
        onBlur: shut,
        onChange: e => {
          const v = e.target.value;
          setText(v); setEditing(true); onQuery(v); setHi(0);
          if (!pos) place();
          if (!v.trim() && label) onClear();
        },
        onKeyDown,
      }),
      pos ? ReactDOM.createPortal(h('div', {
        ref: list, className: 'rl-add-pop rl-combo-list', role: 'listbox',
        style: { left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight },
        // a press in the list must not blur the field before the click lands
        onMouseDown: e => e.preventDefault(),
      },
      options.length ? options.map((o, i) => h('div', {
        key: keyOf(o), role: 'option', 'aria-selected': i === hi,
        className: 'rl-combo-opt' + (i === hi ? ' on' : ''),
        onMouseEnter: () => setHi(i), onClick: () => pick(o),
      }, renderOption ? renderOption(o) : h('span', { 'data-i18n-skip': '' }, textOf(o))))
        : h('div', { className: 'rl-muted' }, 'אין תוצאות')), document.body) : null);
  }

  /* The add row: a discipline, an office and a name, each list narrowed by the other two picks
     (RL.addRowOptions). Picking a name fills its office, and its discipline when it has just one;
     ✓ puts that person on the project in the register, and the row empties for the next one. */
  function AddContactRow({ data, hubDisciplines, colSpan }) {
    const s = useLinked(data);
    const id = data && data.registerProjectId;
    const open = !!id && s.adding === id;
    const [pk, setPk] = useState({});
    const [qs, setQs] = useState({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const refs = { discipline: useRef(null), firm: useRef(null), person: useRef(null), save: useRef(null) };
    const p = id ? s.projects[id] : null;
    const d = s.directory;
    const ok = !!(p && p.state === 'ok' && d && d.state === 'ok');
    const optionsFor = q => RL.addRowOptions(d.data.persons, d.data.firms, d.data.tags, p.data.members, hubDisciplines, pk, q);
    const base = useMemo(() => (open && ok ? optionsFor({}) : null), [open, ok, p, d, hubDisciplines, pk]);
    const opts = useMemo(() => (open && ok ? optionsFor(qs) : null), [open, ok, p, d, hubDisciplines, pk, qs]);
    useEffect(() => { if (!open) { setPk({}); setQs({}); setError(null); setBusy(false); } }, [open]);
    useEffect(() => { if (open && ok && refs.discipline.current) refs.discipline.current.focus(); }, [open, ok]);
    if (!open) return null;
    const cols = colSpan || 6;
    const close = () => set({ adding: null });
    if (!ok) {
      const readFailed = [p, d].some(e => e && e.state !== 'ok');
      return h('tr', { className: 'ov-row-editing' }, h('td', { colSpan: cols, className: 'rl-cell' }, readFailed
        ? line('המאגר לא עונה', button('נסה שוב', () => retry(id)), button('ביטול', close))
        : line('טוען…')));
    }
    const query = key => v => setQs(q => Object.assign({}, q, { [key]: v }));
    const focus = key => () => setTimeout(() => { if (refs[key].current) refs[key].current.focus(); }, 0);
    const disc = base.disciplines.find(x => x.code === pk.discipline) || null;
    const firm = base.firms.find(x => x.id === pk.firmId) || null;
    const person = base.people.find(x => x.id === pk.personId) || null;
    const discText = x => (x.hubCode ? x.hubCode + ' · ' : '') + x.nameHe;
    const chip = x => (k => ({ background: 'var(--disc-' + k + '-bg)', color: 'var(--disc-' + k + ')' }))(x.hubCode || RL.paletteFor(x.color));
    const add = () => {
      if (!person || busy) return;
      setBusy(true); setError(null);
      client.send('PUT', '/api/projects/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(person.id), null)
        .then(r => {
          setBusy(false);
          if (r.state === 'signed-out') recheck();
          if (r.state === 'ok') { setPk({}); setQs({}); reloadProject(id); focus('discipline')(); return; }
          setError(RL.writeErrorOf(r).text);
        }, () => { setBusy(false); setError(RL.writeErrorOf({ state: 'unreachable' }).text); });
    };
    const skip = { 'data-i18n-skip': '' };
    return h(React.Fragment, null,
      h('tr', { className: 'ov-row-editing rl-addrow' },
        h('td', null, h(Combo, {
          inputRef: refs.discipline, placeholder: 'תחום', label: disc ? discText(disc) : '',
          options: opts.disciplines, keyOf: x => x.code, textOf: discText,
          renderOption: x => h('span', Object.assign({ className: 'rl-combo-row' }, skip),
            h('span', { className: 'ov-con-disc-chip', style: chip(x) }, x.hubCode || x.nameHe),
            x.hubCode ? h('span', null, x.nameHe) : null,
            x.nameEn ? h('span', { className: 'rl-add-firm' }, x.nameEn) : null),
          onPick: x => setPk(v => Object.assign({}, v, { discipline: x.code })),
          onClear: () => setPk(v => Object.assign({}, v, { discipline: null })),
          onQuery: query('discipline'), onDone: focus('firm'), onEscape: close,
        })),
        h('td', null, h(Combo, {
          inputRef: refs.firm, placeholder: 'משרד', label: firm ? firm.name : '',
          options: opts.firms, keyOf: x => x.id, textOf: x => x.name,
          onPick: x => setPk(v => Object.assign({}, v, { firmId: x.id })),
          // a name belongs to its office: clearing the office clears the name too
          onClear: () => setPk(v => Object.assign({}, v, { firmId: null, personId: null })),
          onQuery: query('firm'), onDone: focus('person'), onEscape: close,
        })),
        h('td', null, h(Combo, {
          inputRef: refs.person, placeholder: 'שם', label: person ? person.name : '',
          options: opts.people, keyOf: x => x.id, textOf: x => x.name,
          renderOption: x => h('span', Object.assign({ className: 'rl-combo-row rl-combo-person' }, skip),
            h('span', null, x.name), x.firm ? h('span', { className: 'rl-add-firm' }, x.firm) : null),
          onPick: x => setPk(v => Object.assign({}, v, {
            personId: x.id, firmId: x.firmId,
            discipline: v.discipline || (x.disciplines.length === 1 ? x.disciplines[0] : null),
          })),
          onClear: () => setPk(v => Object.assign({}, v, { personId: null })),
          onQuery: query('person'), onDone: focus('save'), onEscape: close,
        })),
        h('td', null, h('div', Object.assign({ className: 'ov-con-sub' }, skip), person && person.mobile ? person.mobile : '—')),
        h('td', null, h('div', Object.assign({ className: 'ov-con-sub' }, skip), person && person.email ? person.email : '—')),
        h('td', { className: 'ov-row-actions' },
          h('button', {
            ref: refs.save, type: 'button', className: 'ov-row-save-btn', disabled: !person || busy,
            title: busy ? 'מוסיף…' : 'הוספה לפרויקט', 'aria-label': 'הוספה לפרויקט', onClick: add,
            onKeyDown: e => { if (e.key === 'Escape') close(); },
          }, '✓'),
          h('button', { type: 'button', className: 'ov-row-del-btn', title: 'ביטול', 'aria-label': 'ביטול', onClick: close }, '×'))),
      error ? h('tr', null, h('td', { colSpan: cols }, h('div', { className: 'rl-add-error', role: 'alert' }, error))) : null);
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
    useConsultantRows, useRemoveConsultant, FactsCard, ConsultantsNotice, EditInHub, AddContact, AddContactRow, AutoLink, DisciplineMatch,
    useDirectory, directoryStatus, DirectoryNotice, write, hubLink, retryMe,
  };
  boot();
})();
