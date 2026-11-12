/* Project Hub ↔ the register (KKarcDB on Supabase). Reads projects, people, firms and tags; writes
   consultants and firms only (docs/superpowers/specs/2026-10-07-settings-consultants-firms-design.md).
   Spec: docs/superpowers/specs/2026-10-04-register-link-design.md.
   Pure functions first — tests/register-link.test.js requires this file under Node. The client
   at the end needs supabase-js and, for the sign-in round trip, a browser. */
(function (root) {
  'use strict';

  /* Hub discipline code → the register's discipline tag code (spec §5). TNDR's `tender` is
     added to the register from KK Hub's Setup; until then no register firm carries it. */
  const REGISTER_DISCIPLINE = {
    ARCH: 'architecture', STRC: 'structural', ELEC: 'electrical', PLUM: 'plumbing', HVAC: 'hvac',
    LAND: 'landscape', SAFE: 'safety', FIRE: 'fire', ACSS: 'accessibility', TRAF: 'traffic',
    GR: 'green', HYDR: 'hydrology', LIFT: 'elevators', AGRO: 'agronomy', ENVI: 'environment',
    PM: 'project_mgmt', TNDR: 'tender',
  };

  const NO_DISCIPLINE = 'ללא תחום';
  const STATUS_HE = { active: 'פעיל', proposal: 'הצעה', inactive: 'לא פעיל', complete: 'הסתיים', cancelled: 'בוטל' };

  const upper = v => String(v == null ? '' : v).trim().toUpperCase();

  /* The register projects a hub code names — by initials or by year-sequence code, case
     ignored. The caller links only when there is exactly one (spec §2). */
  function matchProjects(hubCode, candidates) {
    const code = upper(hubCode);
    if (!code) return [];
    return (candidates || []).filter(p => upper(p.initials) === code || upper(p.code) === code);
  }

  /* The register discipline a hub discipline option stands for. The office can set it on the
     option (`registerCode`; '' means none); an option without one falls back to the map above. */
  function registerCodeOf(opt) {
    if (!opt) return null;
    if (Object.prototype.hasOwnProperty.call(opt, 'registerCode')) return opt.registerCode || null;
    return REGISTER_DISCIPLINE[opt.id] || null;
  }

  /* The hub discipline a register discipline maps to, if this project's list still has it. */
  function hubDisciplineFor(registerCode, hubDisciplines) {
    if (!registerCode) return null;
    const d = (hubDisciplines || []).find(o => registerCodeOf(o) === registerCode);
    return d ? d.id : null;
  }

  /* The match table under Settings → Fields → Discipline: each hub option beside the register
     discipline it stands for, then the register disciplines no option claims. A register
     discipline belongs to the first option that names it, as in hubDisciplineFor. */
  function disciplineMatchRows(hubDisciplines, tags) {
    const discs = (tags || []).filter(t => t.typeCode === 'discipline').slice()
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.code).localeCompare(String(b.code)));
    const byCode = new Map(discs.map(t => [t.code, t]));
    const claimed = new Set();
    const rows = (hubDisciplines || []).filter(o => o && o.id).map(o => {
      const code = registerCodeOf(o);
      const first = !!code && !claimed.has(code);
      if (code) claimed.add(code);
      return { id: o.id, label: o.label || o.id, color: o.color || null, registerCode: code, tag: (code && byCode.get(code)) || null, duplicate: !!code && !first };
    });
    return { rows, unmatched: discs.filter(t => !claimed.has(t.code)) };
  }

  /* The consultants table's rows (spec §4): the project's non-staff members, one row per
     (firm, discipline), in the hub's row shape. The firm's disciplines decide; a person's own
     count only when the firm has none, or there is no firm. */
  function buildConsultantRows(members, persons, firms, tags, hubDisciplines) {
    const personById = new Map((persons || []).map(p => [p.id, p]));
    const firmById = new Map((firms || []).map(f => [f.id, f]));
    const discTag = new Map((tags || []).filter(t => t.typeCode === 'discipline').map(t => [t.code, t]));
    const hubOrder = new Map((hubDisciplines || []).map((d, i) => [d.id, i]));
    const disciplinesOf = x => ((x && x.tags) || {}).discipline || [];
    const rows = new Map();
    for (const m of members || []) {
      if (m.isStaff) continue;
      const person = personById.get(m.personId) || {};
      const firm = person.firmId ? firmById.get(person.firmId) || null : null;
      const owner = firm ? 'f:' + firm.id : 'p:' + m.personId;
      const own = disciplinesOf(firm).length ? disciplinesOf(firm) : disciplinesOf(person);
      const contact = {
        personId: m.personId,
        name: person.nameHe || person.name || m.name || '',
        mobile: person.mobile || '',
        phone: person.phone || '',
        email: person.email || '',
      };
      for (const reg of own.length ? own : [null]) {
        const id = owner + '|' + (reg || '-');
        let row = rows.get(id);
        if (!row) {
          const tag = reg ? discTag.get(reg) : null;
          const discCode = reg ? hubDisciplineFor(reg, hubDisciplines) : null;
          row = {
            id,
            discCode,
            discipline: reg ? (tag && (tag.nameHe || tag.nameEn)) || reg : NO_DISCIPLINE,
            color: (tag && tag.color) || null,
            firm: firm ? firm.nameHe || firm.name || '' : m.firmName || '',
            firmId: firm ? firm.id : null,
            registerDiscipline: reg,
            contacts: [],
            rank: discCode ? hubOrder.get(discCode) : reg ? 1000 + (tag ? tag.sortOrder : 99999) : 1e9,
          };
          rows.set(id, row);
        }
        row.contacts.push(contact);
      }
    }
    return [...rows.values()]
      .sort((a, b) => a.rank - b.rank || a.firm.localeCompare(b.firm, 'he'))
      .map(({ rank, ...row }) => row);
  }

  /* A discipline the hub has no code for is shown by its register name, in a chip coloured like
     the hub discipline of the same hue: the register names one of ten colours per tag (KKarcDB
     migration 022), none meaning grey. Gives the hub discipline whose --disc-* colours to use. */
  const TAG_PALETTE = {
    gray: 'LIFT', brown: 'GR', orange: 'LAND', yellow: 'ELEC', green: 'SAFE',
    teal: 'PLUM', blue: 'ARCH', purple: 'TRAF', pink: 'ACSS', red: 'FIRE',
  };
  function paletteFor(color) {
    return Object.prototype.hasOwnProperty.call(TAG_PALETTE, color) ? TAG_PALETTE[color] : 'LIFT';
  }

  /* Whether the consultants table has anything from the register: every non-staff member
     yields at least one row, so a project without one gets a line saying so instead. */
  function hasConsultants(project) {
    return ((project && project.members) || []).some(m => !m.isStaff);
  }

  const dash = v => (v === null || v === undefined || v === '' ? '—' : String(v));
  const num = v => Number(v).toLocaleString('he-IL');
  const day = v => (v ? String(v).replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3.$2.$1') : '—');
  const COSTS = [['predicted', 'עלות צפויה'], ['evaluated', 'עלות מוערכת'], ['contractor', 'עלות קבלן'], ['real', 'עלות בפועל']];

  /* The "From the register" card's rows (spec §3). `data` marks a value that is the register's
     own text, which the page's translator must leave alone; the area is a number and a unit, so
     the unit is translated. Costs only when the API sent them:
     it sends null to whoever may not see them. */
  function projectFacts(p) {
    const facts = [
      { label: 'קוד', value: dash([p.code, p.initials].filter(Boolean).join(' · ')), data: true },
      { label: 'שם בעברית', value: dash(p.nameHe), data: true },
      { label: 'שם באנגלית', value: dash(p.name), data: true },
      { label: 'סטטוס', value: STATUS_HE[p.status] || dash(p.status), data: false },
      { label: 'לקוח', value: dash(p.clientName), data: true },
      { label: 'כתובת הפרויקט', value: dash(p.address), data: true },
      { label: 'שטח', value: p.areaM2 == null ? '—' : num(p.areaM2) + ' מ״ר', data: false },
      { label: 'שנת סיום', value: dash(p.endYear), data: true },
      { label: 'היתר', value: day(p.permitDate), data: true },
      { label: 'טופס 4', value: day(p.tofes4Date), data: true },
    ];
    if (p.costs) {
      COSTS.forEach(([k, label]) => facts.push({ label, value: p.costs[k] == null ? '—' : num(p.costs[k]) + ' ₪', data: true }));
    }
    return facts;
  }

  /* The token's subject — what an administrator enrols. Shown when the register refuses
     someone, since "ask an administrator" is not actionable without it. */
  function subjectOf(token) {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    try {
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      const sub = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))).sub;
      return typeof sub === 'string' ? sub : null;
    } catch (e) {
      return null;
    }
  }

  /* After Microsoft sends a sign-in back (spec §1): the address the page had before, without
     the one-time `code` or an error report. Null when the address carries none of them. */
  const RETURN_PARAMS = ['code', 'error', 'error_code', 'error_description'];
  function tidyReturnAddress(href, savedSearch) {
    const url = new URL(href);
    if (!RETURN_PARAMS.some(k => url.searchParams.has(k))) return null;
    if (typeof savedSearch === 'string') return url.pathname + savedSearch + url.hash;
    RETURN_PARAMS.forEach(k => url.searchParams.delete(k));
    const rest = url.searchParams.toString();
    return url.pathname + (rest ? '?' + rest : '') + url.hash;
  }

  /* A store entry after an answer (spec §7). A failed refetch keeps the data already shown —
     a blip while the tab sat in the background must not blank the page — and keeps its old
     `at`, so the next focus tries again. */
  function nextEntry(old, answer, now) {
    if (answer.state === 'ok') return { state: 'ok', data: answer.data, at: now };
    if (old && old.state === 'ok') return Object.assign({}, old, { lastError: answer.state });
    return { state: answer.state, subject: answer.subject, at: now };
  }

  /* ── Settings: the register's consultants and firms (2026-10-07 design §2) ── */
  const tagsOf = (x, type) => ((x && x.tags) || {})[type] || [];
  const locale = lang => (lang === 'en' ? 'en' : 'he');

  /* A person or a firm the register calls a consultant. */
  const isConsultant = x => tagsOf(x, 'kind').includes('consultant');
  const consultantFirms = firms => (firms || []).filter(isConsultant);

  /* The name for the page's language, the other one when that is missing. */
  function nameIn(x, lang) {
    const v = lang === 'en' ? x && (x.name || x.nameHe) : x && (x.nameHe || x.name);
    return String(v || '').trim();
  }

  function tagLabel(tag, lang) {
    return (lang === 'en' ? tag.nameEn || tag.nameHe : tag.nameHe || tag.nameEn) || tag.code;
  }

  const EDIT_ROLES = ['editor', 'manager', 'admin'];
  function canEditRegister(role, officeRole) {
    return EDIT_ROLES.includes(role) && officeRole !== 'viewer';
  }

  /* A register user is not a contact: the API edits users only on its admin pages. */
  function editablePerson(person, canEdit) {
    return !!canEdit && !!person && person.isContact !== false;
  }

  /* The discipline checklist: the firm's disciplines first, then the rest, each part in the
     register's order. */
  function disciplineChoices(tags, firm, lang) {
    const mine = new Set(tagsOf(firm, 'discipline'));
    const all = (tags || []).filter(t => t.typeCode === 'discipline').slice()
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.code).localeCompare(String(b.code)));
    const choice = t => ({ code: t.code, label: tagLabel(t, lang), ofFirm: mine.has(t.code) });
    return all.filter(t => mine.has(t.code)).concat(all.filter(t => !mine.has(t.code))).map(choice);
  }

  /* The firm list's choices: the consultant firms, and the current firm when it is not one, so
     the list can always hold the value it shows. */
  function firmChoices(firms, currentFirmId, lang) {
    const list = consultantFirms(firms);
    const current = currentFirmId && !list.some(f => f.id === currentFirmId)
      ? (firms || []).find(f => f.id === currentFirmId) : null;
    return (current ? list.concat([current]) : list)
      .map(f => ({ id: f.id, label: nameIn(f, lang) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale(lang)));
  }

  function firmConsultantCount(firmId, persons) {
    return (persons || []).filter(p => p.firmId === firmId && isConsultant(p)).length;
  }

  const needleOf = q => String(q == null ? '' : q).trim().toLowerCase();
  const hit = (needle, values) => !needle || values.some(v => String(v == null ? '' : v).toLowerCase().includes(needle));
  function disciplineWords(x, tags) {
    const codes = new Set(tagsOf(x, 'discipline'));
    return (tags || []).filter(t => t.typeCode === 'discipline' && codes.has(t.code)).flatMap(t => [t.code, t.nameHe, t.nameEn]);
  }

  function filterConsultants(persons, firms, tags, opts) {
    const { q, firmId, lang } = opts || {};
    const firmById = new Map((firms || []).map(f => [f.id, f]));
    const needle = needleOf(q);
    return (persons || [])
      .filter(p => isConsultant(p) && (!firmId || p.firmId === firmId))
      .filter(p => {
        const firm = firmById.get(p.firmId) || {};
        return hit(needle, [p.name, p.nameHe, firm.name, firm.nameHe, p.firmName, p.phone, p.mobile, p.email]
          .concat(disciplineWords(p, tags)));
      })
      .sort((a, b) => nameIn(a, lang).localeCompare(nameIn(b, lang), locale(lang)));
  }

  function filterFirms(firms, tags, opts) {
    const { q, lang } = opts || {};
    const needle = needleOf(q);
    return consultantFirms(firms)
      .filter(f => hit(needle, [f.name, f.nameHe, f.phone, f.email, f.address].concat(disciplineWords(f, tags))))
      .sort((a, b) => nameIn(a, lang).localeCompare(nameIn(b, lang), locale(lang)));
  }

  /* The list behind a project's consultants "Add": the register's contacts who are not on the
     project, not the office's own people (the table leaves those out) and not bare sign-ins.
     A search finds Hebrew or English names whatever the page's language; each is shown by its
     Hebrew name, the English one only when it has none, and so is its firm. */
  function addableContacts(persons, firms, members, q) {
    const firmById = new Map((firms || []).map(f => [f.id, f]));
    const onProject = new Set((members || []).map(m => m.personId));
    const needle = needleOf(q);
    return (persons || [])
      .filter(p => p.isContact !== false && !tagsOf(p, 'kind').includes('internal') && !onProject.has(p.id) && nameIn(p, 'he'))
      .filter(p => {
        const firm = firmById.get(p.firmId) || {};
        return hit(needle, [p.name, p.nameHe, firm.name, firm.nameHe, p.firmName, p.email, p.phone, p.mobile]);
      })
      .map(p => {
        const firm = firmById.get(p.firmId);
        return { id: p.id, name: nameIn(p, 'he'), firm: firm ? nameIn(firm, 'he') : String(p.firmName || '').trim() };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }

  /* What the consultants table's × takes off the project: the row's people (they stay in the
     directory), their names, and the other rows that share them — those rows go too, since a row
     is a firm's discipline and the register lists people, not rows. */
  function removalOf(row, rows) {
    const contacts = ((row && row.contacts) || []).filter(c => c && c.personId);
    const personIds = [...new Set(contacts.map(c => c.personId))];
    const ids = new Set(personIds);
    return {
      personIds,
      names: [...new Set(contacts.map(c => c.name).filter(Boolean))],
      alsoIn: (rows || []).filter(r => r && r !== row && (!row || r.id !== row.id) && (r.contacts || []).some(c => ids.has(c.personId))),
    };
  }

  /* The consultants table's add row: a discipline, an office and a name, each a list narrowed by
     what is picked in the other two and by its own search. `pick` = { discipline (register code),
     firmId, personId }; `qs` = the three searches. Only contacts addableContacts would offer count.
     A contact's disciplines are its firm's, its own when the firm has none — as in the table. The
     disciplines come in the table's order: the hub's codes in the hub's order, then the rest in
     the register's. Names are Hebrew first, as in the table; searches find either language. */
  function addRowOptions(persons, firms, tags, members, hubDisciplines, pick, qs) {
    const pk = pick || {};
    const q = qs || {};
    const firmById = new Map((firms || []).map(f => [f.id, f]));
    const onProject = new Set((members || []).map(m => m.personId));
    const discTags = (tags || []).filter(t => t.typeCode === 'discipline');
    const tagByCode = new Map(discTags.map(t => [t.code, t]));
    const hubOrder = new Map((hubDisciplines || []).map((d, i) => [d.id, i]));
    const contacts = (persons || [])
      .filter(p => p.isContact !== false && !tagsOf(p, 'kind').includes('internal') && !onProject.has(p.id) && nameIn(p, 'he'))
      .map(p => {
        const firm = (p.firmId && firmById.get(p.firmId)) || null;
        return { p, firm, discs: tagsOf(firm, 'discipline').length ? tagsOf(firm, 'discipline') : tagsOf(p, 'discipline') };
      });
    const fits = (c, skip) => (skip === 'discipline' || !pk.discipline || c.discs.includes(pk.discipline))
      && (skip === 'firm' || !pk.firmId || (c.firm && c.firm.id) === pk.firmId)
      && (skip === 'person' || !pk.personId || c.p.id === pk.personId);

    const codes = new Set();
    contacts.filter(c => fits(c, 'discipline')).forEach(c => c.discs.forEach(d => codes.add(d)));
    const needleD = needleOf(q.discipline);
    const disciplines = [...codes].map(code => {
      const tag = tagByCode.get(code) || null;
      const hubCode = hubDisciplineFor(code, hubDisciplines);
      return {
        code, hubCode,
        nameHe: (tag && (tag.nameHe || tag.nameEn)) || code,
        nameEn: (tag && tag.nameEn) || '',
        color: (tag && tag.color) || null,
        rank: hubCode ? hubOrder.get(hubCode) : 1000 + (tag ? tag.sortOrder || 0 : 99999),
      };
    })
      .filter(d => hit(needleD, [d.code, d.hubCode, d.nameHe, d.nameEn]))
      .sort((a, b) => a.rank - b.rank || a.nameHe.localeCompare(b.nameHe, 'he'))
      .map(({ rank, ...d }) => d);

    const firmSeen = new Map();
    contacts.filter(c => c.firm && fits(c, 'firm')).forEach(c => firmSeen.set(c.firm.id, c.firm));
    const needleF = needleOf(q.firm);
    const firmList = [...firmSeen.values()]
      .filter(f => hit(needleF, [f.name, f.nameHe]))
      .map(f => ({ id: f.id, name: nameIn(f, 'he') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));

    const needleP = needleOf(q.person);
    const people = contacts.filter(c => fits(c, 'person'))
      .filter(c => hit(needleP, [c.p.name, c.p.nameHe, c.p.email, c.p.phone, c.p.mobile]))
      .map(c => ({
        id: c.p.id, name: nameIn(c.p, 'he'),
        firm: c.firm ? nameIn(c.firm, 'he') : String(c.p.firmName || '').trim(), firmId: c.firm ? c.firm.id : null,
        disciplines: c.discs.slice(), mobile: c.p.mobile || c.p.phone || '', email: c.p.email || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));

    return { disciplines, firms: firmList, people };
  }

  const blank = v => {
    const s = String(v == null ? '' : v).trim();
    return s === '' ? null : s;
  };

  /* What + New consultant and + New firm send: trimmed, blanks as null, and the consultant Kind. */
  function newContactBody(form) {
    return {
      name: blank(form.name), firmId: form.firmId || null, email: blank(form.email), mobile: blank(form.mobile),
      tags: { kind: ['consultant'], discipline: (form.disciplines || []).slice() },
    };
  }
  function newFirmBody(form) {
    return { name: blank(form.name), tags: { kind: ['consultant'], discipline: (form.disciplines || []).slice() } };
  }

  /* The directory with one record changed as the register now has it — shown at once while the
     re-read is on its way. */
  function withEdit(data, list, id, patch) {
    if (!data || !Array.isArray(data[list])) return data;
    return Object.assign({}, data, { [list]: data[list].map(x => (x.id === id ? Object.assign({}, x, patch) : x)) });
  }

  /* The line a failed write shows (spec §2), a template for the page's translator. */
  const WRITE_TEXT = {
    changed: 'השדה שונה בינתיים על ידי מישהו אחר. הערך עכשיו: {value}',
    not_a_contact: 'זה משתמש במאגר, לא איש קשר — עריכה ב-KK Hub',
    invalid_value: 'המאגר לא קיבל את הערך',
    rejected: 'המאגר סירב לשינוי',
    'not-found': 'הרשומה לא נמצאה במאגר — ייתכן שמוזגה',
    refused: 'אין הרשאה לשנות את המאגר',
    'signed-out': 'החיבור למאגר פג — התחבר שוב',
    unreachable: 'המאגר לא עונה — השינוי לא נשמר',
  };
  /* `format` puts the other person's value in words (a firm id → its name, codes → labels);
     `who` names the record, since the line sits above a long table. */
  function writeErrorOf(answer, format, who) {
    if (!answer || answer.state === 'ok') return null;
    const named = o => Object.assign(o, { who: who || null });
    if (answer.state === 'changed') {
      const c = answer.current;
      const empty = c == null || c === '' || (Array.isArray(c) && !c.length);
      const value = empty ? '—' : format ? format(c) : Array.isArray(c) ? c.join(', ') : String(c);
      return named({ text: WRITE_TEXT.changed, vars: { value }, detail: null });
    }
    if (answer.state === 'rejected') {
      if (answer.code === 'not_a_contact') return named({ text: WRITE_TEXT.not_a_contact, vars: null, detail: null });
      const text = answer.code === 'invalid_value' ? WRITE_TEXT.invalid_value : WRITE_TEXT.rejected;
      return named({ text, vars: null, detail: answer.error || null });
    }
    return named({ text: WRITE_TEXT[answer.state] || WRITE_TEXT.unreachable, vars: null, detail: null });
  }

  const RETURN_KEY = 'register-return';

  /* The register, through KKarcDB.Api, as the signed-in person (spec §1). `createSupabase` is
     supabase-js's createClient and `fetchImpl` the browser's fetch — parameters so the tests can
     stand in for both. Every answer is { state, data?, subject? }, state one of ok, signed-out,
     refused, not-found, unreachable (spec §6). get reads; send writes, with POST, PATCH, PUT or DELETE. */
  function createRegisterClient(config, createSupabase, fetchImpl) {
    const doFetch = fetchImpl || ((url, init) => root.fetch(url, init));
    // The address as the page opened, read before supabase-js runs: on a successful return it
    // removes ?code= itself, which would hide that this load is a return at all.
    const openedAt = typeof location === 'undefined' ? null : location.href;
    const sb = createSupabase(config.supabaseUrl, config.supabaseAnonKey, { auth: { flowType: 'pkce' } });
    const api = String(config.api).replace(/\/+$/, '');
    const accessToken = r => (r && r.data && r.data.session && r.data.session.access_token) || null;

    // getSession waits for supabase-js to exchange a returning sign-in's code; then the address
    // is put back to what it was before Microsoft (browser only). The saved address is used once:
    // any load clears it, so an abandoned sign-in cannot leak it into a later return.
    const ready = Promise.resolve(sb.auth.getSession()).then(() => {
      if (openedAt === null || typeof history === 'undefined') return;
      let saved = null;
      try {
        saved = sessionStorage.getItem(RETURN_KEY);
        sessionStorage.removeItem(RETURN_KEY);
      } catch (e) { /* storage blocked */ }
      const next = tidyReturnAddress(openedAt, saved);
      if (next !== null) history.replaceState(history.state, '', next);
    }).catch(() => {});

    async function token() {
      await ready;
      return accessToken(await sb.auth.getSession());
    }

    // One request with the token, refreshed and retried once on 401. Gives the response, or the
    // answer that ends it: signed-out, refused, not-found or unreachable.
    async function call(path, init) {
      let t = await token();
      if (!t) return { answer: { state: 'signed-out' } };
      for (let attempt = 0; ; attempt++) {
        let res;
        try {
          const headers = Object.assign({ Authorization: 'Bearer ' + t, Accept: 'application/json' }, init && init.headers);
          res = await doFetch(api + path, Object.assign({}, init, { headers }));
        } catch (e) {
          return { answer: { state: 'unreachable' } };
        }
        if (res.status === 401 && attempt === 0) {
          t = accessToken(await sb.auth.refreshSession());
          if (!t) return { answer: { state: 'signed-out' } };
          continue;
        }
        if (res.status === 401 || res.status === 403) return { answer: { state: 'refused', subject: subjectOf(t) } };
        if (res.status === 404) return { answer: { state: 'not-found' } };
        return { res };
      }
    }

    async function get(path) {
      const { res, answer } = await call(path);
      if (answer) return answer;
      if (!res.ok) return { state: 'unreachable' };
      try {
        return { state: 'ok', data: await res.json() };
      } catch (e) {
        return { state: 'unreachable' };
      }
    }

    /* A write (2026-10-07 design §1): POST, PATCH or PUT, and DELETE (a project's member only:
       the consultants table's ×), which carries no body. A 409 `changed` brings what the other
       person saved; another 409 or a 400 is the register refusing the value. */
    const WRITES = ['POST', 'PATCH', 'PUT', 'DELETE'];
    async function send(method, path, body) {
      if (!WRITES.includes(method)) throw new Error('register-link: only POST, PATCH, PUT and DELETE are sent, not ' + method);
      const { res, answer } = await call(path, method === 'DELETE' ? { method } : {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body === undefined ? null : body),
      });
      if (answer) return answer;
      if (res.ok) {
        let data = null;
        try { data = await res.json(); } catch (e) { /* 204: nothing to read */ }
        return { state: 'ok', data };
      }
      if (res.status === 409 || res.status === 400) {
        let b = null;
        try { b = await res.json(); } catch (e) { /* no body */ }
        b = b || {};
        if (res.status === 409 && b.code === 'changed') return { state: 'changed', current: b.current === undefined ? null : b.current };
        return { state: 'rejected', code: b.code || null, error: b.error || null };
      }
      return { state: 'unreachable' };
    }

    async function signIn() {
      try { sessionStorage.setItem(RETURN_KEY, location.search); } catch (e) { /* storage blocked */ }
      const r = await sb.auth.signInWithOAuth({
        provider: 'azure',
        options: { scopes: 'openid profile email', redirectTo: location.origin + location.pathname },
      });
      return r && r.error ? r.error.message : null;
    }

    return {
      ready,
      token,
      get,
      send,
      signIn,
      signOut: () => sb.auth.signOut(),
      // supabase-js must not be called from inside its own callback; listeners run a tick later.
      onChange: listener => { sb.auth.onAuthStateChange(() => { setTimeout(listener, 0); }); },
    };
  }

  const api = {
    REGISTER_DISCIPLINE, NO_DISCIPLINE, STATUS_HE,
    matchProjects, registerCodeOf, hubDisciplineFor, disciplineMatchRows, buildConsultantRows, paletteFor, projectFacts, subjectOf, tidyReturnAddress,
    nextEntry, hasConsultants, createRegisterClient,
    isConsultant, consultantFirms, nameIn, tagLabel, canEditRegister, editablePerson, disciplineChoices,
    firmChoices, firmConsultantCount, filterConsultants, filterFirms, addableContacts, addRowOptions, removalOf,
    blank, newContactBody, newFirmBody, withEdit, writeErrorOf,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegisterLink = api;
})(typeof window !== 'undefined' ? window : globalThis);
