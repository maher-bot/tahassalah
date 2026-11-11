// أداء المنصة للإدارة: الطلبات والقطع والمحلات، بدون مبالغ.
import { sb, $, PLANS, KIND_ICON, friendlyError } from './lib.js';
import * as S from './stats-ui.js';

const show = id => ['v-loading', 'v-denied', 'v-app'].forEach(v => { $('#' + v).hidden = v !== id; });
const FUL = { delivery: 'توصيل', pickup: 'استلام من المحل', roundtrip: 'استلام وتسليم' };
const day = d => d ? new Date(d).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short' }) : '—';
let data = null, filter = 'all', q = '';

sb.auth.getSession().then(async ({ data: { session } }) => {
  const me = session?.user;
  $('#who').textContent = me?.email ?? ''; $('#logout').hidden = !me;
  if (!me) { location.href = 'admin.html'; return; }
  const { data: ok } = await sb.rpc('is_admin');
  if (!ok) return show('v-denied');
  show('v-app'); load();
});
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.href = 'admin.html'; });
$('#days').addEventListener('change', load);

async function load() {
  $('#body').replaceChildren(S.mk('p', 'hint', 'جارِ التحميل…'));
  const days = Number($('#days').value);
  const { data: d, error } = await sb.rpc('admin_stats', { days });
  if (error) return $('#body').replaceChildren(S.mk('p', 'err', friendlyError(error)));
  data = d;
  const rate = d.orders ? Math.round(d.done / d.orders * 100) : 0;
  $('#body').replaceChildren(
    S.kpis([
      ['الطلبات', S.nf(d.orders), `${S.nf(d.done)} مكتمل · ${rate}%`],
      ['القطع المباعة', S.nf(d.items_sold)],
      ['المشترين', S.nf(d.buyers), `${S.nf(d.new_buyers)} جديد · ${S.nf(d.repeat_buyers)} رجعوا`],
      ['محلات باعت', `${S.nf(d.stores_selling)} من ${S.nf(d.stores)}`, `${S.nf(d.new_stores)} محل جديد`],
      ['وقت القبول', S.mins(d.accept_min)],
      ['وقت التوصيل', S.mins(d.deliver_min)],
      ['مرفوض / ملغي', `${S.nf(d.rejected)} / ${S.nf(d.cancelled)}`],
    ]),
    S.section('الطلبات اليومية على المنصة', 'مرّر على العمود تشوف العدد.', S.dayCols(d.by_day || [], days)),
    S.section('🔥 أكثر المنتجات طلبًا على المنصة', 'يساعدك تعرف وش يطلبه الناس، وتدوّر محلات تبيعه.',
      S.bars((d.top_products || []).map(p => ({ label: p.name, value: p.qty, note: `${p.stores} محل` })))),
    S.section('حسب النشاط', 'الطلبات المكتملة، وعدد المحلات في كل نشاط.',
      S.bars((d.by_activity || []).map(a => ({ label: a.activity, value: a.orders, note: `${a.stores} محل` })))),
    S.section('حسب الحي', null, S.bars((d.by_district || []).map(a => ({ label: a.district, value: a.orders, note: `${a.stores} محل` })))),
    S.section('طريقة الاستلام', null, S.bars(Object.entries(d.by_fulfillment || {}).map(([k, v]) => ({ label: FUL[k] || k, value: v })))),
    storesBox(),
  );
}

function storesBox() {
  const box = S.section('🏪 أداء المحلات', 'بدون مبالغ. «بدون طلبات» يطلع لك المحلات اللي تحتاج تسويق أو متابعة.');
  const bar = S.mk('div', 'toolbar');
  const sel = S.mk('select'); sel.style.width = 'auto';
  [['all', 'كل المحلات'], ['selling', 'اللي باعت'], ['none', 'بدون طلبات'], ['few', 'أقل من 5 منتجات']].forEach(([v, t]) => sel.append(new Option(t, v)));
  sel.value = filter; sel.onchange = () => { filter = sel.value; draw(); };
  const s = S.mk('input'); s.type = 'search'; s.placeholder = 'ابحث بالاسم أو النشاط أو الحي'; s.value = q; s.oninput = () => { q = s.value.trim(); draw(); };
  bar.append(s, sel);
  const holder = S.mk('div');
  const draw = () => {
    const list = (data.store_list || []).filter(m => (filter === 'all' || (filter === 'selling' && m.done) || (filter === 'none' && !m.orders) || (filter === 'few' && m.products < 5))
      && (!q || [m.store_name, m.activity, m.district].join(' ').includes(q)));
    holder.replaceChildren(S.mk('div', 'hint', `${list.length} محل`), S.table(['المحل', 'النشاط', 'الحي', 'الباقة', 'منتجات ظاهرة', 'طلبات', 'مكتملة', 'مرفوضة', 'قطع مباعة', 'آخر طلب', 'الأكثر طلبًا'],
      list.map(m => [`${KIND_ICON[m.kind] || ''} ${m.store_name}`, m.activity, m.district, PLANS[m.plan] || m.plan,
        S.nf(m.products), S.nf(m.orders), S.nf(m.done), S.nf(m.rejected), S.nf(m.items_sold), day(m.last_order),
        (m.top || []).map(t => `${t.name} (${t.qty})`).join('، ') || '—'])));
  };
  draw(); box.append(bar, holder); return box;
}
