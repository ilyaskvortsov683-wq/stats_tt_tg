/* Рендер отчёта stats_tt_tg из модели report.v1 (встроена в страницу как JSON).
 * Любая сводка пересчитывается за выбранный период: глобальный (шапка) или свой у сводки.
 * Без внешних библиотек; графики — SVG. Цвета — только CSS-переменные токенов. */
(function () {
  'use strict';

  var M = JSON.parse(document.getElementById('report-data').textContent);
  var meta = M.meta;
  var D = M.days.n;
  var P = meta.participants;
  var S = M.series;
  var CFG = meta.config;
  var sp = M.days.start.split('-').map(Number);
  var START = Date.UTC(sp[0], sp[1] - 1, sp[2]);

  var MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

  // ---------------------------------------------------------------- утилиты
  function dateOf(i) { return new Date(START + i * 864e5); }
  function wdOf(i) { return (dateOf(i).getUTCDay() + 6) % 7; }
  function isoOf(i) { return dateOf(i).toISOString().slice(0, 10); }
  function idxOfIso(s) { return Math.round((Date.parse(s + 'T00:00:00Z') - START) / 864e5); }
  function fmtN(n) { return Math.round(n).toLocaleString('ru-RU'); }
  function fmt1(n) { return (Math.round(n * 10) / 10).toLocaleString('ru-RU'); }
  function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '—'; }
  function fmtDate(i) { var d = dateOf(i); return d.getUTCDate() + ' ' + MON_GEN[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function fmtShort(i) { var d = dateOf(i); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function fmtDur(sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + ' с';
    var m = Math.floor(sec / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 2) return d + ' дн ' + (h % 24) + ' ч';
    if (h >= 1) return h + ' ч ' + (m % 60) + ' мин';
    return m + ' мин';
  }
  var tsFmt;
  try {
    tsFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: meta.tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    tsFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtTs(ts) { return tsFmt.format(new Date(ts * 1000)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function color(p) { return 'var(--s' + ((p % 8) + 1) + ')'; }
  function pname(p) { return P[p] ? P[p].name : '—'; }
  function sumRange(arr, a, b) { var s = 0; if (!arr) return 0; for (var i = a; i <= b; i++) s += arr[i] || 0; return s; }
  function seriesTotal(name, a, b) {
    var rows = S[name] || [], s = 0;
    for (var p = 0; p < rows.length; p++) s += sumRange(rows[p], a, b);
    return s;
  }
  function seriesByP(name, a, b) {
    return (S[name] || []).map(function (row) { return sumRange(row, a, b); });
  }
  function dayTotals(name, a, b) {
    var rows = S[name] || [], out = [];
    for (var i = a; i <= b; i++) { var s = 0; for (var p = 0; p < rows.length; p++) s += rows[p][i] || 0; out.push(s); }
    return out;
  }
  function inRange(d, a, b) { return d >= a && d <= b; }

  // ---------------------------------------------------------------- периоды
  var state = { global: [0, D - 1], local: {} };
  try {
    var saved = JSON.parse(localStorage.getItem('report-period:' + meta.generated_at) || 'null');
    if (saved && saved.global) state = saved;
  } catch (e) { /* хранилище недоступно — работаем без него */ }
  function saveState() { try { localStorage.setItem('report-period:' + meta.generated_at, JSON.stringify(state)); } catch (e) { /* пусто */ } }
  function rangeOf(sec) { return state.local[sec] || state.global; }

  /** Корзины: дни (≤ 62), недели (≤ 400), месяцы. */
  function buckets(a, b) {
    var len = b - a + 1, items = [], unit;
    if (len <= 62) {
      unit = 'day';
      for (var i = a; i <= b; i++) items.push({ a: i, b: i, label: fmtShort(i), weekend: wdOf(i) >= 5 });
    } else if (len <= 400) {
      unit = 'week';
      var s = a;
      while (s <= b) {
        var e = Math.min(b, s + (6 - wdOf(s)));
        items.push({ a: s, b: e, label: fmtShort(s) });
        s = e + 1;
      }
    } else {
      unit = 'month';
      var s2 = a;
      while (s2 <= b) {
        var d = dateOf(s2);
        var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
        var e2 = Math.min(b, Math.round((next - START) / 864e5) - 1);
        items.push({ a: s2, b: e2, label: MON[d.getUTCMonth()] + (d.getUTCMonth() === 0 || s2 === a ? ' ' + String(d.getUTCFullYear()).slice(2) : '') });
        s2 = e2 + 1;
      }
    }
    return { unit: unit, items: items };
  }
  var UNIT_TITLE = { day: 'по дням', week: 'по неделям', month: 'по месяцам' };

  // ---------------------------------------------------------------- графики (SVG/HTML-строки)
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  /** Столбцы; stacks — массив серий [{values, color, label}] одинаковой длины. */
  function bars(stacks, labels, opts) {
    opts = opts || {};
    var W = 720, H = opts.height || 200, padL = 44, padB = 26, padT = 10;
    var n = labels.length;
    if (!n) return '<p class="empty">Нет данных за период</p>';
    var totals = labels.map(function (_, i) { return stacks.reduce(function (s, st) { return s + (st.values[i] || 0); }, 0); });
    var max = niceMax(Math.max.apply(null, totals));
    var bw = (W - padL) / n;
    var gap = Math.min(bw * 0.2, 4);
    var out = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria || 'График') + '">'];
    for (var g = 0; g <= 4; g++) {
      var y = padT + (H - padT - padB) * (1 - g / 4);
      out.push('<line class="grid" x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/>');
      out.push('<text class="axis" x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + fmtShortNum(max * g / 4, opts.fmt) + '</text>');
    }
    for (var i = 0; i < n; i++) {
      var x = padL + i * bw + gap / 2, acc = 0;
      for (var k = 0; k < stacks.length; k++) {
        var v = stacks[k].values[i] || 0;
        if (!v) continue;
        var h = (H - padT - padB) * (v / max);
        var yv = H - padB - (H - padT - padB) * ((acc + v) / max);
        var c = typeof stacks[k].color === 'function' ? stacks[k].color(i) : stacks[k].color;
        out.push('<rect x="' + x.toFixed(1) + '" y="' + yv.toFixed(1) + '" width="' + Math.max(bw - gap, 0.8).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + c + '"><title>' + esc(labels[i] + ' — ' + (stacks[k].label ? stacks[k].label + ': ' : '') + fmtValue(v, opts.fmt)) + '</title></rect>');
        acc += v;
      }
    }
    var step = Math.max(1, Math.ceil(n / 8));
    for (var j = 0; j < n; j += step) {
      out.push('<text class="axis" x="' + (padL + j * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(labels[j]) + '</text>');
    }
    out.push('</svg>');
    var legend = stacks.length > 1 ? '<div class="legend">' + stacks.map(function (st) {
      return '<span><i style="background:' + st.color + '"></i>' + esc(st.label) + '</span>';
    }).join('') + '</div>' : '';
    return out.join('') + legend;
  }
  function fmtValue(v, kind) { return kind === 'dur' ? fmtDur(v) : fmtN(v); }
  function fmtShortNum(v, kind) {
    if (kind === 'dur') return v >= 3600 ? Math.round(v / 3600) + 'ч' : Math.round(v / 60) + 'м';
    return v >= 1e6 ? fmt1(v / 1e6) + 'М' : v >= 1e4 ? Math.round(v / 1e3) + 'к' : fmtN(v);
  }

  /** Горизонтальные полосы: [{label, value, color, note}]. */
  function hbars(rows, kind) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    return '<div class="hbars">' + rows.map(function (r) {
      return '<div class="hbar"><div class="hbar-label">' + esc(r.label) + '</div><div class="hbar-track"><div class="hbar-fill" style="width:' +
        (100 * r.value / max).toFixed(1) + '%;background:' + (r.color || 'var(--s1)') + '"></div></div><div class="hbar-value">' +
        fmtValue(r.value, kind) + (r.note ? ' <span class="muted">' + esc(r.note) + '</span>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  /** Тепловая карта день недели × час. */
  function heatmap(grid) {
    var max = 0;
    grid.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    var cell = 26, padL = 30, padT = 18, W = padL + 24 * cell, H = padT + 7 * cell;
    var out = ['<svg class="chart heat" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Тепловая карта: день недели × час">'];
    for (var h = 0; h < 24; h += 3) out.push('<text class="axis" x="' + (padL + h * cell + cell / 2) + '" y="12" text-anchor="middle">' + h + '</text>');
    for (var d = 0; d < 7; d++) {
      out.push('<text class="axis" x="' + (padL - 6) + '" y="' + (padT + d * cell + cell / 2 + 4) + '" text-anchor="end">' + WD[d] + '</text>');
      for (var hh = 0; hh < 24; hh++) {
        var v = grid[d][hh], lvl = max ? Math.min(8, Math.ceil((v / max) * 8)) : 0;
        out.push('<rect x="' + (padL + hh * cell + 1) + '" y="' + (padT + d * cell + 1) + '" width="' + (cell - 2) + '" height="' + (cell - 2) + '" rx="3" fill="var(--seq-' + lvl + ')"><title>' + WD[d] + ', ' + hh + ':00 — ' + fmtN(v) + '</title></rect>');
      }
    }
    out.push('</svg>');
    return out.join('');
  }

  function kpis(items) {
    return '<div class="kpis">' + items.map(function (k) {
      return '<div class="kpi"><div class="kpi-value">' + k.v + '</div><div class="kpi-label">' + esc(k.l) + '</div></div>';
    }).join('') + '</div>';
  }
  function table(head, rows) {
    return '<div class="table-wrap"><table><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function frame(title, sub, body) {
    return '<figure class="frame"><figcaption><h3>' + title + '</h3>' + (sub ? '<p class="muted">' + esc(sub) + '</p>' : '') + '</figcaption>' + body + '</figure>';
  }
  function empty(msg) { return '<p class="empty">' + esc(msg || 'В выбранном периоде нет данных для этой сводки') + '</p>'; }

  // ---------------------------------------------------------------- агрегации
  function hoursGrid(a, b, group) {
    var grid = [], d, h, i;
    for (d = 0; d < 7; d++) grid.push(new Array(24).fill(0));
    var src = M.hours || [];
    var groups = group == null ? src.map(function (_, g) { return g; }) : [group];
    for (i = a; i <= b; i++) {
      var w = wdOf(i);
      groups.forEach(function (g) { for (h = 0; h < 24; h++) grid[w][h] += (src[g] || [])[i * 24 + h] || 0; });
    }
    return grid;
  }
  function hoursFlat(arr, a, b) {
    var out = new Array(24).fill(0);
    for (var i = a; i <= b; i++) for (var h = 0; h < 24; h++) out[h] += arr[i * 24 + h] || 0;
    return out;
  }
  function bucketSums(rowsOrRow, bk) {
    return bk.items.map(function (it) { return sumRange(rowsOrRow, it.a, it.b); });
  }
  function stacksFor(name, bk) {
    return (S[name] || []).map(function (row, p) {
      return { values: bucketSums(row, bk), color: color(p), label: pname(p) };
    });
  }
  function sparseSum(list, a, b, keyFn) {
    var acc = {};
    (list || []).forEach(function (r) { if (inRange(r[0], a, b)) { var k = keyFn(r); acc[k] = (acc[k] || 0) + r[r.length - 1]; } });
    return acc;
  }
  function topEntries(obj, n) {
    return Object.keys(obj).map(function (k) { return [k, obj[k]]; }).sort(function (x, y) { return y[1] - x[1]; }).slice(0, n);
  }
  function medianFromBins(bins) {
    var total = bins.reduce(function (s, v) { return s + v; }, 0);
    if (!total) return null;
    var half = total / 2, acc = 0, E = CFG.reply_edges;
    for (var i = 0; i < bins.length; i++) {
      if (acc + bins[i] >= half) {
        var frac = bins[i] ? (half - acc) / bins[i] : 0;
        return E[i] + frac * (E[i + 1] - E[i]);
      }
      acc += bins[i];
    }
    return E[E.length - 1];
  }

  // ---------------------------------------------------------------- сводки
  var SECTIONS = {};

  SECTIONS['tg.overview'] = {
    title: 'Общее',
    render: function (a, b) {
      var by = seriesByP('msgs', a, b), total = by.reduce(function (s, v) { return s + v; }, 0);
      if (!total) return empty();
      var active = dayTotals('msgs', a, b).filter(Boolean).length;
      var rows = by.map(function (v, p) { return { label: pname(p), value: v, color: color(p), note: pct(v, total) }; })
        .sort(function (x, y) { return y.value - x.value; }).slice(0, 30);
      var lead = rows.length > 1 ? (rows[0].label + ' пишет больше всех — ' + rows[0].note + ' сообщений') : 'Все сообщения — от одного участника';
      return kpis([
        { v: fmtN(total), l: 'сообщений' },
        { v: fmtN(b - a + 1), l: 'дней в периоде' },
        { v: fmtN(active), l: 'активных дней' },
        { v: fmt1(total / Math.max(active, 1)), l: 'сообщений в активный день' },
      ]) + frame(esc(lead), 'Сообщения по участникам', hbars(rows));
    },
  };

  SECTIONS['tg.rhythm'] = {
    title: 'Ритм',
    render: function (a, b) {
      var bk = buckets(a, b), totals = dayTotals('msgs', a, b), all = dayTotals('msgs', 0, D - 1);
      if (!totals.some(Boolean)) return empty();
      var stacks = bk.unit === 'day'
        ? [{ values: bucketSums(all, bk), color: function (i) { return bk.items[i].weekend ? 'var(--weekend)' : 'var(--weekday)'; }, label: '' }]
        : stacksFor('msgs', bk);
      var best = bk.items.map(function (it, i) { return [it, stacks.reduce(function (s, st) { return s + st.values[i]; }, 0)]; })
        .sort(function (x, y) { return y[1] - x[1]; })[0];
      var cum = [], run = 0;
      bk.items.forEach(function (it) { run += sumRange(all, it.a, it.b); cum.push(run); });
      var top = totals.map(function (v, i) { return [a + i, v]; }).sort(function (x, y) { return y[1] - x[1]; }).slice(0, 10);
      var byP = function (d) { return (S.msgs || []).map(function (row) { return fmtN(row[d]); }); };
      var head = ['Дата', 'Всего'].concat(P.length <= 4 ? P.map(function (_, p) { return pname(p); }) : []);
      var last = [];
      for (var d = Math.max(a, b - 13); d <= b; d++) last.push([fmtShort(d) + ', ' + WD[wdOf(d)], fmtN(totals[d - a])].concat(P.length <= 4 ? byP(d) : []));
      var sorted = totals.slice().sort(function (x, y) { return x - y; });
      var activeVals = sorted.filter(Boolean);
      var median = activeVals.length ? activeVals[Math.floor(activeVals.length / 2)] : 0;
      return kpis([
        { v: fmt1(totals.reduce(function (s, v) { return s + v; }, 0) / Math.max(activeVals.length, 1)), l: 'в среднем за активный день' },
        { v: fmtN(median), l: 'медиана за активный день' },
      ]) +
        frame('Пик — ' + esc(best[0].label) + ': ' + fmtN(best[1]) + ' сообщ.', 'Сообщения ' + UNIT_TITLE[bk.unit] + (bk.unit === 'day' ? '; выходные выделены' : ''), bars(stacks, bk.items.map(function (x) { return x.label; }))) +
        frame('Накопительно — ' + fmtN(cum[cum.length - 1] || 0), 'Сообщения нарастающим итогом', bars([{ values: cum, color: 'var(--s1)', label: '' }], bk.items.map(function (x) { return x.label; }), { height: 140 })) +
        frame('Топ-10 дней', '', table(['Дата', 'Сообщений'], top.map(function (t) { return [fmtDate(t[0]) + ', ' + WD[wdOf(t[0])], fmtN(t[1])]; }))) +
        frame('Последние 14 дней периода', '', table(head, last));
    },
  };

  SECTIONS['tg.clock'] = SECTIONS['tt.views_rhythm'] = {
    title: 'Часы и дни',
    render: function (a, b, id) {
      var grid = hoursGrid(a, b);
      var byHour = new Array(24).fill(0), byWd = new Array(7).fill(0), total = 0;
      grid.forEach(function (row, w) { row.forEach(function (v, h) { byHour[h] += v; byWd[w] += v; total += v; }); });
      if (!total) return empty();
      var peak = byHour.indexOf(Math.max.apply(null, byHour));
      var evening = sumRange(byHour, 18, 23), day = sumRange(byHour, 9, 17);
      var lead = id === 'tt.views_rhythm' ? 'Больше всего смотрите в ' + peak + ':00' : 'Пик активности — ' + peak + ':00';
      var html = '';
      if (id === 'tt.views_rhythm') {
        var bk = buckets(a, b);
        html += frame('Просмотров за период — ' + fmtN(total), 'Просмотры ' + UNIT_TITLE[bk.unit], bars([{ values: bucketSums(S.views[0], bk), color: bk.unit === 'day' ? function (i) { return bk.items[i].weekend ? 'var(--weekend)' : 'var(--weekday)'; } : 'var(--s1)', label: '' }], bk.items.map(function (x) { return x.label; })));
      }
      html += frame(esc(lead), day ? 'Вечером (18–24) в ' + fmt1(evening / day) + ' раза больше, чем днём (9–18)' : '', bars([{ values: byHour, color: 'var(--s1)', label: '' }], byHour.map(function (_, h) { return h + ':00'; }), { height: 160 }));
      html += frame('По дням недели', '', bars([{ values: byWd, color: function (i) { return i >= 5 ? 'var(--weekend)' : 'var(--weekday)'; }, label: '' }], WD, { height: 140 }));
      html += frame('День недели × час', 'Чем темнее клетка, тем больше', heatmap(grid));
      if (M.hours_by_participant && P.length > 1 && id === 'tg.clock') {
        var rows = P.map(function (_, p) {
          var g = hoursGrid(a, b, p), night = 0, all = 0;
          g.forEach(function (row) { row.forEach(function (v, h) { all += v; if (h < 5) night += v; }); });
          return { label: pname(p), value: all ? Math.round(100 * night / all) : 0, color: color(p), note: '%' };
        });
        html += frame('«Ночные совы»: доля сообщений с 00 до 05', '', hbars(rows));
      }
      return html;
    },
  };

  SECTIONS['tg.dialog'] = {
    title: 'Диалог',
    render: function (a, b) {
      var html = '';
      var firsts = (M.firsts || []).map(function (row) { return sumRange(row, a, b); });
      var ftotal = firsts.reduce(function (s, v) { return s + v; }, 0);
      if (ftotal) {
        var lead = firsts.indexOf(Math.max.apply(null, firsts));
        html += frame(esc(pname(lead)) + ' начинает разговор в ' + pct(firsts[lead], ftotal) + ' случаев', 'Кто пишет первым после паузы от ' + CFG.pause_hours + ' ч',
          hbars(firsts.map(function (v, p) { return { label: pname(p), value: v, color: color(p), note: pct(v, ftotal) }; })));
      }
      if (M.reply_bins && M.reply_bins.length) {
        var NB = CFG.reply_edges.length - 1;
        var rows = M.reply_bins.map(function (flat, p) {
          var bins = new Array(NB).fill(0);
          for (var i = a; i <= b; i++) for (var k = 0; k < NB; k++) bins[k] += flat[i * NB + k] || 0;
          return [pname(p), medianFromBins(bins), bins.reduce(function (s, v) { return s + v; }, 0)];
        });
        html += frame('Скорость ответа', 'Медиана: половина ответов быстрее этого времени (оценка по интервалам)',
          table(['Участник', 'Медиана ответа', 'Ответов'], rows.map(function (r) { return [esc(r[0]), r[1] == null ? '—' : '≈ ' + fmtDur(r[1]), fmtN(r[2])]; })));
      }
      var totals = dayTotals('msgs', a, b), best = 0, cur = 0, run = 0, bestEnd = a;
      totals.forEach(function (v, i) { run = v ? run + 1 : 0; if (run > best) { best = run; bestEnd = a + i; } });
      for (var j = totals.length - 1; j >= 0 && totals[j]; j--) cur++;
      var hot = totals.indexOf(Math.max.apply(null, totals));
      var gaps = (M.gaps || []).filter(function (g) { return g.d0 >= a && g.d1 <= b; }).slice(0, 5);
      html += kpis([
        { v: fmtN(best) + ' ' + plural(best, 'день', 'дня', 'дней'), l: 'самая длинная серия дней подряд' + (best ? ' (до ' + fmtShort(bestEnd) + ')' : '') },
        { v: fmtN(cur), l: 'дней подряд в конце периода' },
        { v: hot >= 0 && totals[hot] ? fmtShort(a + hot) : '—', l: 'самый «жаркий» день' + (totals[hot] ? ' — ' + fmtN(totals[hot]) + ' сообщ.' : '') },
      ]);
      if (gaps.length) {
        html += frame('Самые долгие перерывы', '', table(['С', 'По', 'Длительность'], gaps.map(function (g) { return [fmtTs(g.from), fmtTs(g.to), fmtDur(g.to - g.from)]; })));
      }
      return html || empty();
    },
  };

  function momentButton(kind, it) {
    return '<button class="link-btn" data-moment="' + kind + '" data-i0="' + it.i0 + '" data-i1="' + it.i1 + '">Текст</button>';
  }
  SECTIONS['tg.moments'] = {
    title: 'Монологи и диалоги',
    render: function (a, b) {
      var mono = (M.monologues || []).filter(function (m) { return inRange(m.d, a, b); });
      var dlg = (M.dialogs || []).filter(function (m) { return inRange(m.d, a, b); });
      if (!mono.length && !dlg.length) return empty();
      var html = '<p class="note">Кнопка «Текст» показывает сообщения, если отчёт открыт в приложении и файл чата загружен — текст не хранится на сервере. Понравившиеся моменты можно сохранить отдельно.</p>';
      function top(list, key, n) { return list.slice().sort(function (x, y) { return y[key] - x[key]; }).slice(0, n); }
      if (mono.length) {
        var byMsgs = top(mono, 'msgs', 5), byWords = top(mono, 'words', 5);
        html += frame('Самый длинный монолог — ' + fmtN(byMsgs[0].msgs) + ' сообщений подряд', esc(pname(byMsgs[0].p)) + ', ' + fmtTs(byMsgs[0].from),
          table(['Кто', 'Когда', 'Сообщений', 'Слов', ''], byMsgs.map(function (m) { return [esc(pname(m.p)), fmtTs(m.from), fmtN(m.msgs), fmtN(m.words), momentButton('monologue', m)]; })));
        html += frame('Самый «многословный» монолог — ' + fmtN(byWords[0].words) + ' слов', 'Подряд идущие сообщения одного человека, перерывы не больше ' + CFG.monologue_gap_min + ' мин',
          table(['Кто', 'Когда', 'Слов', 'Сообщений', ''], byWords.map(function (m) { return [esc(pname(m.p)), fmtTs(m.from), fmtN(m.words), fmtN(m.msgs), momentButton('monologue', m)]; })));
      }
      if (dlg.length) {
        var byDur = top(dlg, 'dur', 5), byM = top(dlg, 'msgs', 5), byW = top(dlg, 'words', 5);
        var row = function (m) { return [fmtTs(m.from), fmtDur(m.dur), fmtN(m.msgs), fmtN(m.words), momentButton('dialog', m)]; };
        var head = ['Начало', 'Длительность', 'Сообщений', 'Слов', ''];
        html += frame('Самый долгий разговор — ' + fmtDur(byDur[0].dur), 'Переписка без перерывов дольше ' + CFG.dialog_gap_min + ' мин', table(head, byDur.map(row)));
        html += frame('Больше всего сообщений за разговор — ' + fmtN(byM[0].msgs), '', table(head, byM.map(row)));
        html += frame('Больше всего слов за разговор — ' + fmtN(byW[0].words), '', table(head, byW.map(row)));
      }
      return html;
    },
  };

  SECTIONS['tg.media'] = {
    title: 'Медиа',
    render: function (a, b) {
      var cols = [['voice_n', 'Голосовые'], ['vnote_n', 'Кружки'], ['sticker', 'Стикеры'], ['photo', 'Фото'], ['video', 'Видео'], ['gif', 'GIF'], ['file', 'Файлы'], ['link', 'Ссылки'], ['fwd', 'Пересланные']];
      var rows = P.slice(0, 30).map(function (_, p) {
        return [esc(pname(p))].concat(cols.map(function (c) {
          var v = sumRange((S[c[0]] || [])[p], a, b);
          if (c[0] === 'voice_n' || c[0] === 'vnote_n') {
            var sec = sumRange((S[c[0] === 'voice_n' ? 'voice_sec' : 'vnote_sec'] || [])[p], a, b);
            return fmtN(v) + (v ? ' · ' + fmtDur(sec) : '');
          }
          return fmtN(v);
        }));
      });
      var html = frame('Голосовые, кружки и вложения', '', table(['Участник'].concat(cols.map(function (c) { return c[1]; })), rows));
      var calls = sumRange((S.calls_n || [[]])[0], a, b);
      if (calls) html += kpis([{ v: fmtN(calls), l: 'звонков' }, { v: fmtDur(sumRange(S.calls_sec[0], a, b)), l: 'суммарно на звонках' }]);
      var bk = buckets(a, b);
      if (seriesTotal('voice_n', a, b)) html += frame('Голосовые ' + UNIT_TITLE[bk.unit], '', bars(stacksFor('voice_n', bk), bk.items.map(function (x) { return x.label; }), { height: 150 }));
      var src = sparseSum(M.fwd_src, a, b, function (r) { return r[1]; });
      var topSrc = topEntries(src, 10);
      if (topSrc.length) html += frame('Откуда пересылают', '', hbars(topSrc.map(function (e) { return { label: M.forward_sources[+e[0]] || '—', value: e[1], color: 'var(--s3)' }; })));
      return html;
    },
  };

  SECTIONS['tg.words'] = {
    title: 'Слова',
    render: function (a, b) {
      var html = '<p class="note">Топ слов пересчитывается по целым месяцам, попавшим в период.</p>';
      var fromM = isoOf(a).slice(0, 7), toM = isoOf(b).slice(0, 7);
      var perP = {};
      Object.keys(M.words_by_month || {}).forEach(function (month) {
        if (month < fromM || month > toM) return;
        var byP = M.words_by_month[month];
        Object.keys(byP).forEach(function (pk) {
          perP[pk] = perP[pk] || {};
          byP[pk].forEach(function (wc) { perP[pk][wc[0]] = (perP[pk][wc[0]] || 0) + wc[1]; });
        });
      });
      var any = false;
      P.slice(0, 6).forEach(function (_, p) {
        var top = topEntries(perP['p' + p] || {}, 15);
        if (!top.length) return;
        any = true;
        html += frame('Любимые слова: ' + esc(pname(p)), '', hbars(top.map(function (e) { return { label: e[0], value: e[1], color: color(p) }; })));
      });
      var pats = M.custom_patterns || [];
      if (pats.length) {
        var acc = {};
        (M.custom || []).forEach(function (r) { if (inRange(r[0], a, b)) { var k = r[2] + ':' + r[1]; acc[k] = (acc[k] || 0) + r[3]; } });
        var rows = pats.map(function (pt, k) {
          return [esc(pt)].concat(P.slice(0, 4).map(function (_, p) { return fmtN(acc[k + ':' + p] || 0); }));
        });
        html += frame('Ваши слова и маски', '* — любые буквы', table(['Слово'].concat(P.slice(0, 4).map(function (_, p) { return pname(p); })), rows));
        any = true;
        Object.keys(M.mask_words || {}).forEach(function (k) {
          var list = M.mask_words[k];
          if (list.length > 1) html += frame('Что подошло под «' + esc(pats[+k]) + '»', 'За всё время', hbars(list.slice(0, 10).map(function (e) { return { label: e[0], value: e[1], color: 'var(--s5)' }; })));
        });
      }
      return any ? html : empty();
    },
  };

  SECTIONS['tg.laugh_swear'] = {
    title: 'Смех и мат',
    render: function (a, b) {
      var msgs = seriesByP('msgs', a, b), laugh = seriesByP('laugh', a, b), swear = seriesByP('swear', a, b);
      var lt = laugh.reduce(function (s, v) { return s + v; }, 0), st = swear.reduce(function (s, v) { return s + v; }, 0);
      if (!lt && !st) return empty('Ни смеха, ни мата в этом периоде — удивительно');
      var html = kpis([{ v: fmtN(lt), l: 'сообщений со смехом' }, { v: fmtN(st), l: 'матерных слов' }]);
      html += frame('Кто смеётся чаще', 'Сообщений со смехом на 100 сообщений', hbars(laugh.map(function (v, p) { return { label: pname(p), value: msgs[p] ? Math.round(100 * v / msgs[p]) : 0, color: color(p), note: '(' + fmtN(v) + ')' }; })));
      if ((M.laugh_forms || []).length) html += frame('Как смеются', 'За всё время', hbars(M.laugh_forms.slice(0, 8).map(function (e) { return { label: e[0], value: e[1], color: 'var(--s4)' }; })));
      if (st) {
        html += frame('Мат на 1000 сообщений', '', hbars(swear.map(function (v, p) { return { label: pname(p), value: msgs[p] ? Math.round(1000 * v / msgs[p]) : 0, color: color(p), note: '(' + fmtN(v) + ')' }; })));
        var bk = buckets(a, b);
        html += frame('Мат ' + UNIT_TITLE[bk.unit], '', bars(stacksFor('swear', bk), bk.items.map(function (x) { return x.label; }), { height: 150 }));
        var roots = topEntries(sparseSum(M.swear_roots, a, b, function (r) { return r[2]; }), 8);
        html += frame('Самые частые', 'Слова показаны с маской', hbars(roots.map(function (e) { return { label: (M.swear_labels || {})[e[0]] || '***', value: e[1], color: 'var(--s2)' }; })));
      }
      return html;
    },
  };

  SECTIONS['tg.names'] = {
    title: 'Имена',
    render: function (a, b) {
      var acc = {};
      (M.names || []).forEach(function (r) { if (inRange(r[0], a, b)) { acc[r[2]] = acc[r[2]] || {}; acc[r[2]][r[1]] = (acc[r[2]][r[1]] || 0) + r[3]; } });
      var ids = Object.keys(acc).sort(function (x, y) { return sum(acc[y]) - sum(acc[x]); }).slice(0, 25);
      function sum(o) { return Object.keys(o).reduce(function (s, k) { return s + o[k]; }, 0); }
      if (!ids.length) return empty('Имена в этом периоде не упоминались');
      var cols = P.slice(0, 4);
      return frame('Чаще всего упоминается: ' + esc((M.name_labels || {})[ids[0]] || ids[0]), 'Во всех формах: Саша, Сашка, Александру…',
        table(['Имя', 'Всего'].concat(cols.map(function (_, p) { return pname(p); })), ids.map(function (id) {
          return [esc((M.name_labels || {})[id] || id), fmtN(sum(acc[id]))].concat(cols.map(function (_, p) { return fmtN(acc[id][p] || 0); }));
        })));
    },
  };

  SECTIONS['tg.reactions'] = SECTIONS['tt.emoji'] = {
    title: 'Реакции, эмодзи, стикеры',
    render: function (a, b, id) {
      var html = '';
      if (id === 'tg.reactions') {
        var emo = topEntries(sparseSum(M.reaction_emoji, a, b, function (r) { return r[1]; }), 10);
        var total = emo.reduce(function (s, e) { return s + e[1]; }, 0);
        if (total) {
          html += frame('Всего реакций — ' + fmtN(total), '', hbars(emo.map(function (e) { return { label: e[0].indexOf('custom:') === 0 ? 'своя' : e[0], value: e[1], color: 'var(--s2)', note: pct(e[1], total) }; })));
          var recv = seriesByP('reactions_recv', a, b);
          html += frame('Кто собирает реакции', '', hbars(recv.map(function (v, p) { return { label: pname(p), value: v, color: color(p) }; })));
          var ww = sparseSum(M.who_whom, a, b, function (r) { return r[1] + '→' + r[2]; });
          var pairs = topEntries(ww, 10);
          if (pairs.length) html += frame('Кто кому ставит реакции', 'Оценка: Telegram сохраняет только последние реакции', table(['Кто', 'Кому', 'Реакций'], pairs.map(function (e) { var x = e[0].split('→'); return [esc(pname(+x[0])), esc(pname(+x[1])), fmtN(e[1])]; })));
        }
      }
      P.slice(0, 4).forEach(function (_, p) {
        var top = topEntries(sparseSum((M.emoji_text || []).filter(function (r) { return r[1] === p; }), a, b, function (r) { return r[2]; }), 8);
        if (top.length) html += frame('Эмодзи в сообщениях: ' + esc(pname(p)), '', hbars(top.map(function (e) { return { label: e[0], value: e[1], color: color(p) }; })));
      });
      var stk = topEntries(sparseSum(M.stickers, a, b, function (r) { return r[2]; }), 10);
      if (stk.length) html += frame('Любимые стикеры', '', hbars(stk.map(function (e) { return { label: e[0].split('#')[0], value: e[1], color: 'var(--s6)' }; })));
      return html || empty();
    },
  };

  SECTIONS['tg.group_life'] = {
    title: 'Жизнь беседы',
    render: function (a, b) {
      var ev = M.events || [];
      var titles = ev.filter(function (e) { return e.action === 'title' && e.title; });
      var html = '';
      if (titles.length) {
        var endTs = Date.parse(isoOf(D - 1) + 'T23:59:59Z') / 1000;
        var lived = titles.map(function (t, i) { return { t: t, dur: (titles[i + 1] ? titles[i + 1].ts : endTs) - t.ts }; })
          .filter(function (x) { return inRange(x.t.d, a, b); });
        if (lived.length) {
          html += frame('Названия беседы — ' + fmtN(lived.length), 'Кто и когда менял', table(['Когда', 'Кто', 'Название', 'Прожило'], lived.map(function (x) { return [fmtTs(x.t.ts), esc(x.t.actor == null ? '—' : pname(x.t.actor)), esc(x.t.title), fmtDur(x.dur)]; })));
          var longest = lived.slice().sort(function (x, y) { return y.dur - x.dur; }).slice(0, 10);
          html += frame('Дольше всего жили', '', hbars(longest.map(function (x) { return { label: x.t.title, value: x.dur, color: 'var(--s5)' }; }), 'dur'));
        }
      }
      var inv = ev.filter(function (e) { return (e.action === 'invite' || e.action === 'join_link') && inRange(e.d, a, b); });
      if (inv.length) {
        var bk = buckets(a, b);
        var vals = bk.items.map(function (it) { return inv.filter(function (e) { return inRange(e.d, it.a, it.b); }).reduce(function (s, e) { return s + (e.count || 1); }, 0); });
        html += frame('Новые участники — ' + fmtN(vals.reduce(function (s, v) { return s + v; }, 0)), UNIT_TITLE[bk.unit], bars([{ values: vals, color: 'var(--s4)', label: '' }], bk.items.map(function (x) { return x.label; }), { height: 140 }));
      }
      return html || empty();
    },
  };

  SECTIONS['tt.views_total'] = {
    title: 'Просмотры — итог',
    render: function (a, b) {
      var v = sumRange(S.views[0], a, b);
      if (!v) return empty();
      var active = S.views[0].slice(a, b + 1).filter(Boolean).length;
      return kpis([{ v: fmtN(v), l: 'просмотров' }, { v: fmtN(b - a + 1), l: 'дней в периоде' }, { v: fmtN(v / Math.max(active, 1)), l: 'в среднем за день с TikTok' }]);
    },
  };

  SECTIONS['tt.sessions'] = {
    title: 'Сессии и экранное время',
    render: function (a, b) {
      var ss = (M.sessions || []).filter(function (s) { return inRange(s[3], a, b); });
      if (!ss.length) return empty();
      var durs = ss.map(function (s) { return s[1] - s[0]; }).sort(function (x, y) { return x - y; });
      var screen = sumRange(S.screen_sec[0], a, b);
      var active = S.screen_sec[0].slice(a, b + 1).filter(Boolean).length;
      var top = ss.slice().sort(function (x, y) { return (y[1] - y[0]) - (x[1] - x[0]); });
      var bk = buckets(a, b);
      var html = kpis([
        { v: fmtDur(screen), l: 'экранное время' },
        { v: fmtDur(screen / Math.max(active, 1)), l: 'в среднем в день' },
        { v: fmtN(ss.length), l: 'сессий' },
        { v: fmtDur(durs[Math.floor(durs.length / 2)]), l: 'медианная сессия' },
      ]);
      html += frame('Самое долгое «залипание» — ' + fmtDur(top[0][1] - top[0][0]), fmtTs(top[0][0]) + ', ' + fmtN(top[0][2]) + ' видео',
        bars([{ values: bucketSums(S.screen_sec[0], bk), color: 'var(--s1)', label: '' }], bk.items.map(function (x) { return x.label; }), { fmt: 'dur' }));
      html += frame('В какие часы', 'Экранное время по часам суток', bars([{ values: hoursFlat(M.screen_hours, a, b), color: 'var(--s2)', label: '' }], new Array(24).fill(0).map(function (_, h) { return h + ':00'; }), { height: 150, fmt: 'dur' }));
      html += frame('Топ-20 сессий', 'Новая сессия — после перерыва больше ' + CFG.tt_session_gap_min + ' мин', table(['Начало', 'Длительность', 'Видео'], top.slice(0, 20).map(function (s) { return [fmtTs(s[0]), fmtDur(s[1] - s[0]), fmtN(s[2])]; })));
      return html;
    },
  };

  SECTIONS['tt.activity'] = {
    title: 'Лайки, избранное, входы',
    render: function (a, b) {
      var bk = buckets(a, b), labels = bk.items.map(function (x) { return x.label; });
      var l = sumRange((S.likes || [[]])[0], a, b), f = sumRange((S.favorites || [[]])[0], a, b), g = sumRange((S.logins || [[]])[0], a, b);
      if (!l && !f && !g) return empty();
      var html = kpis([{ v: fmtN(l), l: 'лайков' }, { v: fmtN(f), l: 'в избранном' }, { v: fmtN(g), l: 'входов в аккаунт' }]);
      if (l) html += frame('Лайки ' + UNIT_TITLE[bk.unit], '', bars([{ values: bucketSums(S.likes[0], bk), color: 'var(--s2)', label: '' }], labels, { height: 150 }));
      if (f) html += frame('Избранное ' + UNIT_TITLE[bk.unit], '', bars([{ values: bucketSums(S.favorites[0], bk), color: 'var(--s4)', label: '' }], labels, { height: 150 }));
      if (g) html += frame('Входы по часам', '', bars([{ values: hoursFlat(M.login_hours, a, b), color: 'var(--s3)', label: '' }], new Array(24).fill(0).map(function (_, h) { return h + ':00'; }), { height: 140 }));
      return html;
    },
  };

  SECTIONS['tt.chat_deep'] = {
    title: 'Разбор чата',
    render: function (a, b) {
      if (!S.chat_msgs) return empty('Чат для разбора не выбран');
      var sh = seriesByP('chat_shares', a, b), tx = seriesByP('chat_text', a, b);
      var bk = buckets(a, b);
      var lead = P.length >= 2 ? esc(pname(0)) + ' прислал(а) ' + fmtN(sh[0]) + ' тиктоков, ' + esc(pname(1)) + ' — ' + fmtN(sh[1]) : 'Тиктоки в чате';
      return frame(lead, 'Тиктоки ' + UNIT_TITLE[bk.unit], bars(stacksFor('chat_shares', bk), bk.items.map(function (x) { return x.label; }))) +
        frame('Сообщения', '', table(['Участник', 'Тиктоков', 'Текстом', 'Всего'], P.map(function (_, p) { return [esc(pname(p)), fmtN(sh[p] || 0), fmtN(tx[p] || 0), fmtN(sumRange(S.chat_msgs[p], a, b))]; })));
    },
  };

  SECTIONS['tt.content'] = {
    title: 'Содержание просмотренного (бета)',
    render: function () { return '<p class="note">' + esc((M.content || {}).note || 'Скоро') + '</p>'; },
  };

  // ---------------------------------------------------------------- период: разметка и события
  var PRESETS = [['all', 'Весь период'], ['365', 'Год'], ['90', '3 месяца'], ['30', '30 дней']];
  function presetRange(key) { return key === 'all' ? [0, D - 1] : [Math.max(0, D - Number(key)), D - 1]; }
  function periodControls(scope, r) {
    return '<div class="period" data-scope="' + scope + '">' +
      PRESETS.map(function (p) { return '<button type="button" data-preset="' + p[0] + '">' + p[1] + '</button>'; }).join('') +
      '<label>с <input type="date" data-edge="0" min="' + isoOf(0) + '" max="' + isoOf(D - 1) + '" value="' + isoOf(r[0]) + '"></label>' +
      '<label>по <input type="date" data-edge="1" min="' + isoOf(0) + '" max="' + isoOf(D - 1) + '" value="' + isoOf(r[1]) + '"></label>' +
      (scope !== 'global' ? '<button type="button" data-preset="inherit">Как у отчёта</button>' : '') + '</div>';
  }
  function periodLabel(r) { return fmtDate(r[0]) + ' — ' + fmtDate(r[1]); }

  function renderSection(id) {
    var def = SECTIONS[id];
    var el = document.getElementById('sec-' + id.replace('.', '-'));
    if (!def || !el) return;
    var r = rangeOf(id);
    var own = !!state.local[id];
    var body;
    try { body = def.render(r[0], r[1], id); } catch (e) { body = '<p class="empty">Не удалось построить сводку: ' + esc(e.message) + '</p>'; }
    el.innerHTML = '<header class="sec-head"><h2>' + esc(def.title) + '</h2><details class="sec-period"><summary>' + (own ? 'Свой период: ' : 'Период: ') + esc(periodLabel(r)) + '</summary>' + periodControls(id, r) + '</details></header>' + body;
  }
  function renderAll() {
    document.getElementById('global-period').innerHTML = periodControls('global', state.global);
    document.getElementById('global-label').textContent = periodLabel(state.global);
    meta.sections.forEach(renderSection);
    saveState();
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.matches && t.matches('[data-preset]')) {
      var scope = t.closest('.period').getAttribute('data-scope');
      var key = t.getAttribute('data-preset');
      if (scope === 'global') { state.global = presetRange(key); state.local = {}; renderAll(); }
      else { if (key === 'inherit') delete state.local[scope]; else state.local[scope] = presetRange(key); renderSection(scope); saveState(); }
    }
    if (t.matches && t.matches('[data-moment]')) {
      var msg = { type: 'stats:moment', kind: t.getAttribute('data-moment'), i0: +t.getAttribute('data-i0'), i1: +t.getAttribute('data-i1') };
      if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
      else alert('Текст доступен, когда отчёт открыт в приложении и загружен файл чата: тексты сообщений не хранятся на сервере.');
    }
    if (t.matches && t.matches('[data-mode-set]')) setTheme(t.getAttribute('data-mode-set'), null);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.matches && t.matches('.period input[type=date]')) {
      var scope = t.closest('.period').getAttribute('data-scope');
      var edge = +t.getAttribute('data-edge');
      var r = (scope === 'global' ? state.global : rangeOf(scope)).slice();
      r[edge] = Math.min(D - 1, Math.max(0, idxOfIso(t.value)));
      if (r[0] > r[1]) r = [r[1], r[0]];
      if (scope === 'global') { state.global = r; renderAll(); } else { state.local[scope] = r; renderSection(scope); saveState(); }
    }
    if (t.id === 'palette') setTheme(null, t.value);
  });

  // ---------------------------------------------------------------- тема
  function setTheme(mode, palette) {
    var html = document.documentElement;
    if (mode) html.setAttribute('data-mode', mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode);
    if (palette) html.setAttribute('data-palette', palette);
    try { localStorage.setItem('report-theme', JSON.stringify({ mode: html.getAttribute('data-mode'), palette: html.getAttribute('data-palette') })); } catch (e) { /* пусто */ }
  }
  (function initTheme() {
    var params = new URLSearchParams(location.search);
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('report-theme') || 'null'); } catch (e) { /* пусто */ }
    setTheme(params.get('mode') || (saved && saved.mode) || 'system', params.get('palette') || (saved && saved.palette) || 'paper');
    var sel = document.getElementById('palette');
    if (sel) sel.value = document.documentElement.getAttribute('data-palette');
  })();

  renderAll();
  document.documentElement.classList.add('ready');
})();
