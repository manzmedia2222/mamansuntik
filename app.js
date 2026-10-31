(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('id-ID');
  const money = (n, cur) => {
    const v = Number(n);
    if (!isFinite(v)) return '-';
    return v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + (cur ? ' ' + cur : '');
  };

  let services = [];
  let byId = new Map();
  let currency = '';
  let toastTimer;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem('ms_orders') || '[]'); } catch { return []; } },
    set(v) { try { localStorage.setItem('ms_orders', JSON.stringify(v)); } catch {} },
  };

  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.body ? 'POST' : 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Belum masuk'); }
    let data;
    try { data = await res.json(); } catch { data = { error: 'Respons tidak valid' }; }
    return data;
  }

  /* ---------- login ---------- */
  function showLogin() {
    el('app').hidden = true;
    el('login').hidden = false;
    el('pw').focus();
  }
  el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('loginErr').textContent = '';
    const r = await api('/api/login', { body: { password: el('pw').value } });
    if (r.error) { el('loginErr').textContent = r.error; return; }
    el('pw').value = '';
    start();
  });
  el('logout').addEventListener('click', async () => {
    await api('/api/logout', { body: {} });
    showLogin();
  });

  /* ---------- start ---------- */
  async function start() {
    const me = await fetch('/api/me', { credentials: 'same-origin' });
    if (!me.ok) return showLogin();
    el('login').hidden = true;
    el('app').hidden = false;
    loadBalance();
    await loadServices();
    route();
  }

  async function loadBalance() {
    try {
      const b = await api('/api/balance');
      if (b && b.balance !== undefined) {
        currency = b.currency || '';
        el('bal').textContent = 'Saldo ' + money(b.balance, currency);
      } else el('bal').textContent = '';
    } catch {}
  }

  async function loadServices() {
    const banner = el('banner');
    try {
      const data = await api('/api/services');
      if (!Array.isArray(data)) throw new Error(data && data.error ? data.error : 'Gagal memuat layanan');
      services = data;
      byId = new Map(services.map((s) => [String(s.service), s]));
      banner.hidden = true;
    } catch (e) {
      banner.className = 'banner bad';
      banner.textContent = 'Daftar layanan tidak bisa dimuat: ' + e.message + '. Periksa API_KEY di file .env.';
      banner.hidden = false;
    }
    fillCategories(el('cat'), false);
    fillCategories(el('qcat'), true);
    fillServices();
    renderServices();
  }

  const cats = () => [...new Set(services.map((s) => s.category))];
  function fillCategories(sel, withAll) {
    const prev = sel.value;
    sel.innerHTML = (withAll ? '<option value="">Semua kategori</option>' : '') +
      cats().map((c) => `<option>${esc(c)}</option>`).join('');
    if (prev && cats().includes(prev)) sel.value = prev;
  }

  /* ---------- routing ---------- */
  function route() {
    const v = (location.hash || '#pesan').slice(1);
    const view = ['pesan', 'layanan', 'pesanan'].includes(v) ? v : 'pesan';
    document.querySelectorAll('.view').forEach((s) => (s.hidden = s.id !== 'v-' + view));
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === view));
    if (view === 'pesanan') renderOrders();
  }
  window.addEventListener('hashchange', route);

  /* ---------- pesan ---------- */
  function fillServices(selectId) {
    const c = el('cat').value;
    const list = services.filter((s) => s.category === c);
    el('svc').innerHTML = list.map((s) => `<option value="${esc(s.service)}">${esc(s.service)} - ${esc(s.name)}</option>`).join('');
    if (selectId) el('svc').value = String(selectId);
    onService();
  }
  el('cat').addEventListener('change', () => fillServices());
  el('svc').addEventListener('change', onService);

  const kind = (s) => {
    const t = String((s && s.type) || 'Default').toLowerCase();
    if (t.includes('custom comments')) return 'comments';
    if (t.includes('package') || t.includes('subscription')) return 'package';
    if (t.includes('comment likes') || t.includes('mentions user') || t.includes('username')) return 'user';
    return 'default';
  };

  function curSvc() { return byId.get(el('svc').value); }

  function onService() {
    const s = curSvc();
    const k = kind(s);
    el('f-qty').hidden = k === 'comments' || k === 'package';
    el('f-comments').hidden = k !== 'comments';
    el('f-user').hidden = k !== 'user';
    el('drip').hidden = k !== 'default';
    el('svcInfo').innerHTML = s ? [
      ['Tipe', s.type || 'Default'],
      ['Minimum / maksimum', `${nf.format(s.min)} / ${nf.format(s.max)}`],
      ['Isi ulang', s.refill ? 'Ada' : 'Tidak ada'],
      ['Pembatalan', s.cancel ? 'Bisa' : 'Tidak bisa'],
    ].map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('') : '';
    el('qtyHint').textContent = s ? `Antara ${nf.format(s.min)} dan ${nf.format(s.max)}.` : '';
    el('cmHint').textContent = s ? `Antara ${nf.format(s.min)} dan ${nf.format(s.max)} baris.` : '';
    summary();
  }

  function quantity() {
    const s = curSvc();
    const k = kind(s);
    if (k === 'comments') return el('comments').value.split(/\r?\n/).filter((l) => l.trim()).length;
    if (k === 'package') return 1;
    return Number(el('qty').value) || 0;
  }

  function summary() {
    const s = curSvc();
    el('s-name').textContent = s ? s.name : '-';
    el('s-rate').textContent = s ? money(s.rate) : '-';
    const q = quantity();
    el('s-qty').textContent = s && q ? nf.format(q) : '-';
    el('s-total').textContent = s && q ? money((Number(s.rate) * q) / (kind(s) === 'package' ? 1 : 1000), currency) : '-';
  }
  ['qty', 'comments'].forEach((id) => el(id).addEventListener('input', summary));

  el('orderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = el('orderErr');
    err.textContent = '';
    const s = curSvc();
    if (!s) { err.textContent = 'Pilih layanan terlebih dahulu.'; return; }
    const k = kind(s);
    const link = el('link').value.trim();
    if (!/^https?:\/\/\S+$/i.test(link)) { err.textContent = 'Tautan harus diawali http:// atau https://'; return; }
    const q = quantity();
    if (k !== 'package' && (q < Number(s.min) || q > Number(s.max))) {
      err.textContent = `Jumlah harus antara ${nf.format(s.min)} dan ${nf.format(s.max)}.`; return;
    }
    const body = { service: s.service, link };
    if (k === 'comments') body.comments = el('comments').value.trim();
    else if (k !== 'package') body.quantity = q;
    if (k === 'user') {
      if (!el('uname').value.trim()) { err.textContent = 'Nama pengguna wajib diisi untuk layanan ini.'; return; }
      body.username = el('uname').value.trim().replace(/^@/, '');
    }
    if (k === 'default' && el('runs').value) {
      body.runs = el('runs').value;
      if (!el('interval').value) { err.textContent = 'Isi jeda jika memakai pengiriman bertahap.'; return; }
      body.interval = el('interval').value;
    }
    const btn = el('orderBtn');
    btn.disabled = true; btn.textContent = 'Mengirim...';
    try {
      const r = await api('/api/order', { body });
      if (r.error || !r.order) { err.textContent = r.error || 'Pesanan ditolak penyedia.'; return; }
      const list = store.get();
      list.unshift({ id: String(r.order), service: s.service, name: s.name, link, qty: q, at: Date.now() });
      store.set(list);
      toast(`Pesanan ${r.order} dibuat`);
      el('orderForm').reset();
      fillServices(s.service);
      loadBalance();
    } catch (e2) {
      err.textContent = 'Gagal mengirim pesanan.';
    } finally {
      btn.disabled = false; btn.textContent = 'Kirim pesanan';
    }
  });

  /* ---------- layanan ---------- */
  function renderServices() {
    const q = el('q').value.trim().toLowerCase();
    const c = el('qcat').value;
    const rows = services.filter((s) => (!c || s.category === c) &&
      (!q || String(s.service).includes(q) || String(s.name).toLowerCase().includes(q)));
    el('count').textContent = `${nf.format(rows.length)} layanan`;
    $('#svcTable tbody').innerHTML = rows.length ? rows.map((s) => `
      <tr>
        <td class="num nowrap">${esc(s.service)}</td>
        <td>${esc(s.name)}</td>
        <td>${esc(s.category)}</td>
        <td class="r num nowrap">${money(s.rate)}</td>
        <td class="r num">${nf.format(s.min)}</td>
        <td class="r num">${nf.format(s.max)}</td>
        <td class="nowrap">${s.refill ? '<span class="tag">Isi ulang</span>' : ''}${s.cancel ? '<span class="tag">Batal</span>' : ''}</td>
        <td class="r"><button class="btn ghost sm" data-pick="${esc(s.service)}" type="button">Pesan</button></td>
      </tr>`).join('') : '<tr><td colspan="8" class="empty">Tidak ada layanan yang cocok.</td></tr>';
  }
  el('q').addEventListener('input', renderServices);
  el('qcat').addEventListener('change', renderServices);
  el('svcTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const s = byId.get(b.dataset.pick);
    el('cat').value = s.category;
    fillServices(s.service);
    location.hash = '#pesan';
    el('link').focus();
  });

  /* ---------- pesanan ---------- */
  const statusMap = {
    pending: ['Menunggu', 'pending'], processing: ['Diproses', 'run'], 'in progress': ['Diproses', 'run'],
    completed: ['Selesai', 'done'], partial: ['Sebagian', 'bad'], canceled: ['Dibatalkan', 'bad'], cancelled: ['Dibatalkan', 'bad'],
    refunded: ['Dikembalikan', 'bad'], fail: ['Gagal', 'bad'], failed: ['Gagal', 'bad'],
  };
  const stat = (s) => {
    if (!s) return '<span class="st na">Belum dicek</span>';
    const [t, c] = statusMap[String(s).toLowerCase()] || [s, 'na'];
    return `<span class="st ${c}">${esc(t)}</span>`;
  };
  const shortLink = (l) => l.replace(/^https?:\/\/(www\.)?/, '');

  function renderOrders() {
    const list = store.get();
    el('ordEmpty').hidden = list.length > 0;
    el('ordTable').parentElement.hidden = list.length === 0;
    $('#ordTable tbody').innerHTML = list.map((o) => {
      const sv = byId.get(String(o.service));
      return `<tr>
        <td class="num nowrap">${esc(o.id)}</td>
        <td>${esc(o.name || '-')}</td>
        <td class="trunc" title="${esc(o.link)}">${esc(shortLink(o.link || ''))}</td>
        <td class="r num">${o.qty ? nf.format(o.qty) : '-'}</td>
        <td>${o.error ? `<span class="st bad">${esc(o.error)}</span>` : stat(o.status)}</td>
        <td class="r num">${o.remains !== undefined ? nf.format(o.remains) : '-'}</td>
        <td class="r num nowrap">${o.charge !== undefined ? money(o.charge, o.currency) : '-'}</td>
        <td><div class="acts">
          ${sv && sv.refill ? `<button class="btn ghost sm" data-refill="${esc(o.id)}" type="button">Isi ulang</button>` : ''}
          ${sv && sv.cancel ? `<button class="btn ghost sm" data-cancel="${esc(o.id)}" type="button">Batalkan</button>` : ''}
          <button class="btn ghost sm" data-remove="${esc(o.id)}" type="button">Hapus</button>
        </div></td></tr>`;
    }).join('');
  }

  async function refreshStatus() {
    const list = store.get();
    if (!list.length) return;
    const btn = el('refresh');
    btn.disabled = true;
    try {
      const ids = list.map((o) => o.id).join(',');
      const r = await api('/api/status?orders=' + encodeURIComponent(ids));
      list.forEach((o) => {
        const d = list.length === 1 && r.status !== undefined ? r : r[o.id];
        if (!d) return;
        if (d.error) { o.error = d.error; return; }
        delete o.error;
        o.status = d.status; o.remains = d.remains; o.charge = d.charge; o.currency = d.currency; o.start = d.start_count;
      });
      store.set(list);
      renderOrders();
    } catch {} finally { btn.disabled = false; }
  }
  el('refresh').addEventListener('click', refreshStatus);

  el('lookup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = el('lookId').value.replace(/\D/g, '');
    if (!id) return;
    const list = store.get();
    if (!list.some((o) => o.id === id)) {
      list.unshift({ id, name: 'Dilacak manual', link: '', at: Date.now() });
      store.set(list);
    }
    el('lookId').value = '';
    renderOrders();
    refreshStatus();
  });

  el('ordTable').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.remove) {
      store.set(store.get().filter((o) => o.id !== b.dataset.remove));
      renderOrders();
    } else if (b.dataset.refill) {
      b.disabled = true;
      const r = await api('/api/refill', { body: { order: b.dataset.refill } });
      toast(r.error ? 'Isi ulang ditolak: ' + (typeof r.error === 'string' ? r.error : 'tidak tersedia') : 'Permintaan isi ulang dikirim');
      b.disabled = false;
    } else if (b.dataset.cancel) {
      if (!confirm(`Batalkan pesanan ${b.dataset.cancel}?`)) return;
      b.disabled = true;
      const r = await api('/api/cancel', { body: { orders: b.dataset.cancel } });
      const item = Array.isArray(r) ? r[0] : r;
      const bad = !item || item.error || (item.cancel && item.cancel.error);
      toast(bad ? 'Pembatalan ditolak' : 'Permintaan pembatalan dikirim');
      b.disabled = false;
      if (!bad) refreshStatus();
    }
  });

  start();
})();
