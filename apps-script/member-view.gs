/**
 * 무브앤플레이 회원용 화면(me/) API
 *
 * 회원 전용 링크의 t 값으로 그 회원의 이용권·다음 예약·최근 출석·숙제·목표만 돌려줘요.
 * - t 값은 관리자 앱(회원 → 이름 → 회원 링크)에서 만들고 Firestore memberLinks/{t} 에 { name } 으로 저장돼요.
 * - 이 스크립트는 배포한 사람(Firebase 프로젝트 소유자)의 권한으로 Firestore REST API를 읽어요.
 *   그래서 Firestore 보안 규칙은 관리자만 허용해 둔 그대로 두면 돼요.
 *
 * 배포: 확장 프로그램 → Apps Script 새 프로젝트 → 이 파일과 appsscript.json 붙여넣기
 *      → 배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자) → 나온 주소를 me/index.html 의 API 에 넣기
 */
const PROJECT = 'moveplay-suncheon';
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';
const TZ = 'Asia/Seoul';

function doGet(e) {
  const t = String((e && e.parameter && e.parameter.t) || '').trim();
  try {
    return json_(lookup_(t));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, code: 'error', msg: '잠시 후 다시 열어 주세요' });
  }
}

function lookup_(t) {
  if (!/^[A-Za-z0-9]{16,40}$/.test(t)) return { ok: false, code: 'link' };
  const link = get_('memberLinks/' + t);
  if (!link || !link.name) return { ok: false, code: 'link' };
  const name = link.name;
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const since = Utilities.formatDate(new Date(Date.now() - 60 * 86400000), TZ, 'yyyy-MM-dd');

  const passes = where_('passes', 'name', name)
    .filter(function (p) { return !p.archived; })
    .map(function (p) {
      const total = p.total || 0, used = (p.usedBefore || 0) + (p.usedAfter || 0);
      return {
        label: p.label || '', cls: p.cls || '', kind: p.kind || '',
        total: total, left: total - used,
        balance: p.balance || 0, spent: p.spent || 0, priceP: p.priceP || 0, priceG: p.priceG || 0,
      };
    });

  const days = unique_(where_('attendance', 'name', name)
    .map(function (a) { return a.date; })
    .filter(function (d) { return d && d >= since; }))
    .sort().reverse();

  const next = where_('bookings', 'name', name)
    .filter(function (b) { return b.date >= today; })
    .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })
    .slice(0, 5)
    .map(function (b) { return { date: b.date, time: b.time || '', slot: b.slot || '' }; });

  const hw = where_('workouts', 'member', name)
    .filter(function (w) { return w.homework; })
    .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); })[0];

  const prof = get_('profiles/' + encodeURIComponent(name));

  return {
    ok: true, name: name, passes: passes, next: next, days: days,
    homework: hw ? { date: hw.date || '', text: hw.homework } : null,
    goal: (prof && prof.goal) || '',
  };
}

/* ---------- Firestore REST ---------- */
function call_(method, path, body) {
  const res = UrlFetchApp.fetch(BASE + path, {
    method: method,
    contentType: 'application/json',
    payload: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ': ' + res.getContentText());
  return JSON.parse(res.getContentText());
}
// 문서 하나 → 보통 객체 (없으면 null)
function get_(path) {
  const doc = call_('get', '/' + path);
  return doc ? fields_(doc.fields || {}) : null;
}
// field == value 인 문서들
function where_(collection, field, value) {
  const res = call_('post', ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
    },
  }) || [];
  return res.filter(function (r) { return r.document; }).map(function (r) { return fields_(r.document.fields || {}); });
}
function fields_(f) {
  const o = {};
  Object.keys(f).forEach(function (k) { o[k] = value_(f[k]); });
  return o;
}
function value_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(value_);
  if ('mapValue' in v) return fields_(v.mapValue.fields || {});
  return null;
}
function unique_(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
