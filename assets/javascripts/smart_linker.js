/**
 * smart_linker.js — Redmine Sublink: Smart Linker
 *
 * Trigger: >> (nach Leerzeichen oder Zeilenanfang)
 *
 * States: closed → project → items
 *
 * Tab   = Autocomplete (Projekt wählen → >>identifier[Leerzeichen]; Item → Text vervollständigen)
 * Enter = Link sofort einfügen
 * Esc   = Abbrechen (entfernt >>...)
 * ↑↓    = Navigation im Dropdown
 *
 * Alle eingefügten Links sind Standard-Redmine-Textile-Syntax.
 */
(function () {
  'use strict';

  /* ── Konfiguration ──────────────────────────────────────────────────────── */
  var PANEL_W        = 370;
  var MAX_PER_SEC    = 3;    // max items pro Sektion
  var ISSUE_DEBOUNCE = 250;  // ms

  /* ── State ──────────────────────────────────────────────────────────────── */
  var st          = 'closed';  // closed | project | items
  var activeTa    = null;
  var tStart      = -1;        // position of first '>' in >>
  var tEnd        = -1;        // current cursor position
  var curProj     = null;      // { id, identifier, name }
  var selIdx      = -1;        // index into li[data-idx] NodeList
  var currentItems = [];       // full items array incl. sections/disabled
  var itemsQ      = '';        // current query in items state
  var issueReqId  = 0;         // stale-request guard

  /* ── Aktuelles Projekt aus URL ──────────────────────────────────────────── */
  var urlProjId = (location.pathname.match(/\/projects\/([^\/]+)/) || [])[1] || null;

  /* ── Cache ──────────────────────────────────────────────────────────────── */
  var cache = {
    projects:    null,
    members:     {},   // keyed by project identifier
    wiki:        {},   // keyed by project identifier
    attachments: {},   // keyed by location.pathname
    issues:      {}    // keyed by 'projId:query'
  };

  /* ── DOM ────────────────────────────────────────────────────────────────── */
  var panel, pBack, pTitle, pList;
  var issTimer = null;

  /* ════════════════════════════════════════════════════════════════════════
   * Panel bauen (kein Suchfeld — Eingabe läuft über die Textarea)
   * ════════════════════════════════════════════════════════════════════════ */
  function buildPanel() {
    panel = mk('div', 'sl-panel');
    panel.style.cssText = 'display:none;position:fixed;z-index:100000;width:' + PANEL_W + 'px';
    panel.setAttribute('role', 'listbox');

    var hdr = mk('div', 'sl-header');

    pBack = mk('button', 'sl-back');
    pBack.type = 'button';
    pBack.innerHTML = '&#8592;';
    pBack.title = 'Zurück (Esc)';
    pBack.style.display = 'none';
    pBack.addEventListener('mousedown', function (e) {
      e.preventDefault();
      if (st === 'items') goBackToProject();
      else cancel();
    });

    pTitle = mk('span', 'sl-title');
    hdr.appendChild(pBack);
    hdr.appendChild(pTitle);
    panel.appendChild(hdr);

    pList = mk('ul', 'sl-list');
    panel.appendChild(pList);

    // Klick außerhalb → schließen
    document.addEventListener('mousedown', function (e) {
      if (st !== 'closed' && !panel.contains(e.target) && e.target !== activeTa) cancel();
    });

    document.body.appendChild(panel);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Cursor-Positionierung (Mirror-Div-Technik)
   * ════════════════════════════════════════════════════════════════════════ */
  function posPanel(ta) {
    var off = measureCursor(ta);
    var r   = ta.getBoundingClientRect();
    var top  = r.top  + off.top  + off.lineH + 4;
    var left = r.left + off.left;

    if (left + PANEL_W > window.innerWidth - 8) left = window.innerWidth - PANEL_W - 8;
    if (left < 4) left = 4;

    var dropH = panel.offsetHeight || 320;
    if (top + dropH > window.innerHeight - 8) top = r.top + off.top - dropH - 4;
    if (top < 4) top = 4;

    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  }

  function measureCursor(ta) {
    var cs    = window.getComputedStyle(ta);
    var props = ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing',
                 'lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft',
                 'borderTopWidth','borderLeftWidth','boxSizing','wordWrap','whiteSpace'];
    var m = document.createElement('div');
    props.forEach(function (p) { m.style[p] = cs[p]; });
    m.style.cssText += ';position:absolute;visibility:hidden;top:-9999px;left:-9999px;' +
                       'width:' + ta.clientWidth + 'px;height:auto;overflow:hidden;white-space:pre-wrap';
    m.textContent = ta.value.substring(0, ta.selectionStart);
    var sp = document.createElement('span');
    sp.textContent = '\u200b';
    m.appendChild(sp);
    document.body.appendChild(m);
    var lh = parseInt(cs.lineHeight) || parseInt(cs.fontSize) + 4;
    var res = {
      left:  sp.offsetLeft - ta.scrollLeft,
      top:   sp.offsetTop  - ta.scrollTop,
      lineH: lh
    };
    document.body.removeChild(m);
    return res;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Öffnen / Schließen
   * ════════════════════════════════════════════════════════════════════════ */
  function openPanel(ta) {
    activeTa = ta;
    panel.style.display = 'block';
    posPanel(ta);
  }

  function closePanel() {
    panel.style.display = 'none';
    st = 'closed'; curProj = null; selIdx = -1;
    currentItems = []; itemsQ = '';
    activeTa = null; tStart = tEnd = -1;
  }

  function cancel() {
    // Entfernt >>... aus der Textarea (nur wenn >> noch da steht)
    if (activeTa && tStart >= 0) {
      var v   = activeTa.value;
      var end = tEnd >= 0 ? tEnd : tStart + 2;
      if (v.substring(tStart, tStart + 2) === '>>') {
        activeTa.value = v.substring(0, tStart) + v.substring(end);
        activeTa.selectionStart = activeTa.selectionEnd = tStart;
        activeTa.dispatchEvent(new Event('input', { bubbles: true }));
      }
      activeTa.focus();
    }
    closePanel();
  }

  function goBackToProject() {
    // Im items-State: >>identifier query → >> (zurück zur Projektauswahl)
    if (activeTa && tStart >= 0) {
      var v = activeTa.value;
      activeTa.value = v.substring(0, tStart) + '>>' + v.substring(tEnd);
      tEnd = tStart + 2;
      activeTa.selectionStart = activeTa.selectionEnd = tEnd;
      activeTa.dispatchEvent(new Event('input', { bubbles: true }));
      activeTa.focus();
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Text nach >> parsen
   * ════════════════════════════════════════════════════════════════════════ */
  function parseAfter(raw) {
    var text = raw.replace(/^\s+/, ''); // führende Leerzeichen entfernen
    if (!text) return { level: 'project', query: '' };

    var sp = text.indexOf(' ');
    if (sp === -1) return { level: 'project', query: text };

    var potId     = text.substring(0, sp);
    var itemQuery = text.substring(sp + 1);

    // Nur in items-State wechseln wenn Identifier exakt einer geladenem Projekt entspricht
    if (cache.projects && cache.projects.some(function (p) { return p.identifier === potId; })) {
      return { level: 'items', projId: potId, query: itemQuery };
    }
    // Sonst: Leerzeichen ist Teil der Projektsuche
    return { level: 'project', query: text };
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 1 — Projekte
   * ════════════════════════════════════════════════════════════════════════ */
  function renderProjects(q) {
    pBack.style.display = 'none';
    pTitle.textContent  = '🔗\u2009Projekt wählen';
    curProj = null;

    if (!cache.projects) {
      renderList([{ label: 'Lade Projekte…', disabled: true }]);
      loadJSON('/projects.json?limit=100', function (d) {
        cache.projects = d.projects || [];
        renderProjects(q);
      }, function () {
        renderList([{ label: 'Fehler beim Laden', disabled: true }]);
      });
      return;
    }

    var lq       = q.toLowerCase();
    var filtered = q
      ? cache.projects.filter(function (p) {
          return p.name.toLowerCase().indexOf(lq) !== -1 ||
                 p.identifier.toLowerCase().indexOf(lq) !== -1;
        })
      : cache.projects.slice();

    filtered.sort(function (a, b) {
      if (a.identifier === urlProjId) return -1;
      if (b.identifier === urlProjId) return 1;
      return a.name.localeCompare(b.name);
    });

    renderList(filtered.length
      ? filtered.map(function (p) {
          return {
            icon:     p.identifier === urlProjId ? '✓' : '📁',
            label:    p.name,
            sub:      p.identifier,
            project:  p,
            autotext: p.identifier + ' '   // Tab: >>identifier[Leerzeichen]
          };
        })
      : [{ label: 'Kein Projekt gefunden', disabled: true }]);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Ebene 2 — kombinierte Items (Issues + Members + Wiki + Anhänge)
   * ════════════════════════════════════════════════════════════════════════ */
  function searchItems(q) {
    itemsQ = q;
    pBack.style.display = '';
    pTitle.textContent  = curProj.name;

    var pid  = curProj.identifier;
    var reqId = ++issueReqId;

    // Cache-Lücken befüllen
    if (!cache.members[pid])                   loadMembers(function () { if (itemsQ === q) renderCombined(q); });
    if (!cache.wiki[pid])                      loadWiki(function ()    { if (itemsQ === q) renderCombined(q); });
    if (!cache.attachments[location.pathname]) loadAttachments(function () { if (itemsQ === q) renderCombined(q); });

    // Sofort rendern mit was vorhanden ist
    renderCombined(q);

    // Issues per AJAX (debounced)
    clearTimeout(issTimer);
    issTimer = setTimeout(function () { fetchIssues(q, pid, reqId); }, q ? ISSUE_DEBOUNCE : 0);
  }

  function fetchIssues(q, pid, reqId) {
    var stripped = q.replace(/^#/, '').trim();
    var url = '/issues.json?project_id=' + enc(pid) + '&limit=' + MAX_PER_SEC;
    if (/^\d+$/.test(stripped))  url += '&issue_id=' + stripped;
    else if (stripped)           url += '&status_id=*&subject=~' + enc(stripped);
    else                         url += '&status_id=open&sort=updated_on:desc&limit=5';

    loadJSON(url, function (d) {
      if (reqId !== issueReqId || itemsQ !== q) return;
      cache.issues[pid + ':' + q] = d.issues || [];
      renderCombined(q);
    }, function () {
      if (reqId !== issueReqId || itemsQ !== q) return;
      cache.issues[pid + ':' + q] = [];
      renderCombined(q);
    });
  }

  function renderCombined(q) {
    var pid = curProj.identifier;
    var lq  = q.toLowerCase().trim();

    /* ── Issues ── */
    var issKey  = pid + ':' + q;
    var issItems = [];
    if (cache.issues[issKey] === undefined) {
      issItems = [{ label: 'Suche läuft…', disabled: true }];
    } else {
      issItems = (cache.issues[issKey] || []).slice(0, MAX_PER_SEC).map(function (i) {
        var short = pid === urlProjId ? '#' + i.id : pid + '#' + i.id;
        return {
          icon:     '#' + i.id,
          label:    i.subject,
          sub:      i.status ? i.status.name : '',
          autotext: '#' + i.id + ' ' + i.subject,
          link:     short
        };
      });
    }

    /* ── Mitglieder ── */
    var memberItems = (cache.members[pid] || [])
      .filter(function (m) {
        return !lq || m.name.toLowerCase().indexOf(lq) !== -1 || m.login.toLowerCase().indexOf(lq) !== -1;
      })
      .slice(0, MAX_PER_SEC)
      .map(function (m) {
        var mention = m.login || m.name.toLowerCase().replace(/\s+/g, '.');
        return { icon: '👤', label: m.name, sub: '@' + mention,
                 autotext: '@' + mention, link: '@' + mention };
      });

    /* ── Wiki ── */
    var wikiItems = (cache.wiki[pid] || [])
      .filter(function (p) { return !lq || p.title.toLowerCase().indexOf(lq) !== -1; })
      .slice(0, MAX_PER_SEC)
      .map(function (p) {
        var link = pid === urlProjId ? '[[' + p.title + ']]' : '[[' + pid + ':' + p.title + ']]';
        return { icon: '📄', label: p.title, sub: link, autotext: p.title, link: link };
      });

    /* ── Anhänge (aktuelle Seite) ── */
    var attachItems = (cache.attachments[location.pathname] || [])
      .filter(function (a) { return !lq || a.filename.toLowerCase().indexOf(lq) !== -1; })
      .slice(0, MAX_PER_SEC)
      .map(function (a) {
        var isImg = /^image\//i.test(a.content_type || '');
        var link  = isImg ? '!attachment:' + a.filename + '!' : 'attachment:' + a.filename;
        return { icon: isImg ? '🖼️' : '📎', label: a.filename, sub: link,
                 autotext: a.filename, link: link };
      });

    /* ── Zusammenbauen (Sektionen nur wenn Inhalt vorhanden) ── */
    var items = [];
    function addSection(title, list) {
      if (list.length) {
        items.push({ section: true, label: title });
        items = items.concat(list);
      }
    }
    addSection('Issues', issItems);
    addSection('Mitglieder', memberItems);
    addSection('Wiki', wikiItems);
    addSection('Anhänge', attachItems);

    if (!items.length) items = [{ label: 'Keine Ergebnisse', disabled: true }];
    renderList(items);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Daten laden
   * ════════════════════════════════════════════════════════════════════════ */
  function loadMembers(cb) {
    var pid = curProj.identifier;
    loadJSON('/users/auto_complete.json?term=&project_id=' + curProj.id,
      function (data) {
        cache.members[pid] = (Array.isArray(data) ? data : []).map(function (u) {
          return { id: u.id, name: u.value || u.name || '', login: u.login || '' };
        });
        cb();
      },
      function () {
        loadJSON('/projects/' + pid + '/memberships.json?limit=100',
          function (d) {
            cache.members[pid] = (d.memberships || []).filter(function (m) { return m.user; })
              .map(function (m) { return { id: m.user.id, name: m.user.name, login: '' }; });
            cb();
          },
          function () { cache.members[pid] = []; cb(); }
        );
      }
    );
  }

  function loadWiki(cb) {
    var pid = curProj.identifier;
    loadJSON('/projects/' + pid + '/wiki/index.json',
      function (d) { cache.wiki[pid] = d.wiki_pages || []; cb(); },
      function ()   { cache.wiki[pid] = [];               cb(); }
    );
  }

  function loadAttachments(cb) {
    var key = location.pathname;
    var m;
    m = location.pathname.match(/\/issues\/(\d+)/);
    if (m) {
      loadJSON('/issues/' + m[1] + '.json?include=attachments',
        function (d) { cache.attachments[key] = (d.issue && d.issue.attachments) || []; cb(); },
        function ()   { cache.attachments[key] = []; cb(); }
      );
      return;
    }
    m = location.pathname.match(/\/projects\/([^\/]+)\/wiki\/([^\/\?]+)/);
    if (m) {
      loadJSON('/projects/' + m[1] + '/wiki/' + m[2] + '.json',
        function (d) { cache.attachments[key] = (d.wiki_page && d.wiki_page.attachments) || []; cb(); },
        function ()   { cache.attachments[key] = []; cb(); }
      );
      return;
    }
    cache.attachments[key] = [];
    cb();
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Liste rendern
   * ════════════════════════════════════════════════════════════════════════ */
  function renderList(items) {
    currentItems = items;
    selIdx = -1;

    pList.innerHTML = (items || []).map(function (item, i) {
      if (item.section)  return '<li class="sl-section">'  + h(item.label) + '</li>';
      if (item.disabled) return '<li class="sl-disabled">' + h(item.label) + '</li>';
      return '<li data-idx="' + i + '" role="option">' +
             '<span class="sl-icon">'  + h(item.icon  || '') + '</span>' +
             '<span class="sl-label">' + h(item.label || '') + '</span>' +
             (item.sub ? '<span class="sl-sub">' + h(item.sub) + '</span>' : '') +
             '</li>';
    }).join('');

    pList.querySelectorAll('li[data-idx]').forEach(function (li) {
      li.addEventListener('mouseenter', function () {
        selIdx = parseInt(li.dataset.idx, 10);
        applyHL();
      });
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        selIdx = parseInt(li.dataset.idx, 10);
        handleEnter();
      });
    });

    if (activeTa) posPanel(activeTa);
  }

  function applyHL() {
    var lis = pList.querySelectorAll('li[data-idx]');
    lis.forEach(function (li, i) {
      li.classList.toggle('sl-selected', i === selIdx);
      li.setAttribute('aria-selected', String(i === selIdx));
    });
    if (lis[selIdx]) lis[selIdx].scrollIntoView({ block: 'nearest' });
  }

  function getSelectedItem() {
    var lis = pList.querySelectorAll('li[data-idx]');
    var li  = selIdx >= 0
      ? lis[selIdx]
      : lis.length === 1 ? lis[0] : null;
    if (!li) return null;
    return currentItems[parseInt(li.dataset.idx, 10)] || null;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Tab — Autocomplete
   * ════════════════════════════════════════════════════════════════════════ */
  function handleTab() {
    var item = getSelectedItem();
    if (!item || item.section || item.disabled) return;

    var ta = activeTa;
    var v  = ta.value;

    if (st === 'project') {
      // Projekt wählen: >>query → >>identifier[Leerzeichen]
      var proj = item.project;
      if (!proj) return;
      curProj = proj;
      st = 'items';
      var repl = '>>' + proj.identifier + ' ';
      ta.value = v.substring(0, tStart) + repl + v.substring(tEnd);
      tEnd = tStart + repl.length;
      ta.selectionStart = ta.selectionEnd = tEnd;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      // onTaInput parst den neuen Text und ruft searchItems auf

    } else if (st === 'items') {
      // Item-Text in Textarea vervollständigen (ohne Link einzufügen)
      if (!item.autotext) { handleEnter(); return; }
      var repl2 = '>>' + curProj.identifier + ' ' + item.autotext;
      ta.value = v.substring(0, tStart) + repl2 + v.substring(tEnd);
      tEnd = tStart + repl2.length;
      ta.selectionStart = ta.selectionEnd = tEnd;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Enter — Link einfügen
   * ════════════════════════════════════════════════════════════════════════ */
  function handleEnter() {
    var item = getSelectedItem();
    if (!item || item.section || item.disabled) {
      // Kein Element ausgewählt: bei einem Ergebnis direkt nehmen
      if (st === 'project') {
        var lis = pList.querySelectorAll('li[data-idx]');
        if (lis.length === 1) { selIdx = 0; handleTab(); }
      }
      return;
    }
    if (st === 'project') {
      // Auf Projektebene: Enter = Tab (Projekt wählen, zu Items wechseln)
      handleTab();
    } else if (st === 'items') {
      if (item.link) doInsert(item.link);
    }
  }

  function doInsert(linkText) {
    if (!activeTa || tStart < 0) { closePanel(); return; }
    var v   = activeTa.value;
    var end = tEnd >= 0 ? tEnd : tStart + 2;
    activeTa.value = v.substring(0, tStart) + linkText + v.substring(end);
    var np = tStart + linkText.length;
    activeTa.selectionStart = activeTa.selectionEnd = np;
    activeTa.dispatchEvent(new Event('input', { bubbles: true }));
    activeTa.focus();
    closePanel();
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Textarea: Input-Handler (Trigger-Erkennung + Live-Filter)
   * ════════════════════════════════════════════════════════════════════════ */
  function onTaInput(e) {
    var ta     = e.target;
    var pos    = ta.selectionStart;
    var before = ta.value.substring(0, pos);
    var m      = before.match(/(^|[\s\n])>>([^\n]*)$/);

    if (!m) {
      if (st !== 'closed') closePanel(); // Text wurde verändert/gelöscht → einfach schließen
      return;
    }

    tStart = pos - m[0].length + m[1].length;
    tEnd   = pos;

    if (panel.style.display === 'none') openPanel(ta);
    else posPanel(ta);

    var parsed = parseAfter(m[2]);

    if (parsed.level === 'project') {
      st = 'project';
      renderProjects(parsed.query);

    } else {
      // Items-Level: Projekt-Identifier eindeutig identifiziert
      var proj = cache.projects && cache.projects.filter(function (p) {
        return p.identifier === parsed.projId;
      })[0];

      if (proj) {
        curProj = proj;
        st = 'items';
        searchItems(parsed.query);
      } else {
        // Projekte noch nicht geladen
        renderList([{ label: 'Lade Projekte…', disabled: true }]);
        loadJSON('/projects.json?limit=100', function (d) {
          cache.projects = d.projects || [];
          var p = cache.projects.filter(function (p) { return p.identifier === parsed.projId; })[0];
          if (p) { curProj = p; st = 'items'; searchItems(parsed.query); }
          else { st = 'project'; renderProjects(parsed.query); }
        }, function () { renderList([{ label: 'Fehler beim Laden', disabled: true }]); });
      }
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Textarea: Keydown-Handler (Navigation, Tab, Enter, Esc)
   * ════════════════════════════════════════════════════════════════════════ */
  function onTaKeydown(e) {
    if (st === 'closed' || panel.style.display === 'none') return;

    var lis = pList.querySelectorAll('li[data-idx]');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selIdx = Math.min(selIdx + 1, lis.length - 1);
      applyHL();

    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selIdx = Math.max(selIdx - 1, 0);
      applyHL();

    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleTab();

    } else if (e.key === 'Enter') {
      if (lis.length > 0) {
        e.preventDefault();
        handleEnter();
      }

    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  /* ════════════════════════════════════════════════════════════════════════
   * Textareas anbinden
   * ════════════════════════════════════════════════════════════════════════ */
  function bindTa(ta) {
    if (ta._slBound) return;
    ta._slBound = true;
    ta.addEventListener('input',   onTaInput);
    ta.addEventListener('keydown', onTaKeydown);
    ta.addEventListener('scroll',  function () { if (st !== 'closed') posPanel(this); });
    ta.addEventListener('blur', function () {
      setTimeout(function () {
        if (st === 'closed') return;
        if (panel && panel.contains(document.activeElement)) return;
        cancel();
      }, 150);
    });
  }

  function bindAll(root) {
    var sel = 'textarea.wiki-edit, textarea[id$="_notes"], textarea[id="notes"], textarea[name="notes"]';
    if (root.querySelectorAll) root.querySelectorAll(sel).forEach(bindTa);
    if (root.matches && root.matches(sel)) bindTa(root);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * AJAX
   * ════════════════════════════════════════════════════════════════════════ */
  function loadJSON(url, ok, err) {
    fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(ok).catch(err || function () {});
  }

  /* ── Hilfsfunktionen ── */
  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function h(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function enc(s){ return encodeURIComponent(s); }

  /* ════════════════════════════════════════════════════════════════════════
   * Init
   * ════════════════════════════════════════════════════════════════════════ */
  function init() {
    buildPanel();
    bindAll(document);

    // Projekte nach 1,5 s vorladen (kein Delay beim ersten >>)
    setTimeout(function () {
      if (!cache.projects) {
        loadJSON('/projects.json?limit=100', function (d) { cache.projects = d.projects || []; });
      }
    }, 1500);

    // Neue Textareas (AJAX-geladene Inhalte) beobachten
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (node) { if (node.nodeType === 1) bindAll(node); });
      });
    }).observe(document.body, { childList: true, subtree: true });

    // Fallback-Polling für 5 Sekunden
    var n = 0, t = setInterval(function () { bindAll(document); if (++n >= 5) clearInterval(t); }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
