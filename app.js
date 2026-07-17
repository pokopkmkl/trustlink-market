async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  opts.credentials = 'include';
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString();
}

function badgeClass(status) {
  return {
    pending_payment: 'badge-pending',
    submitted: 'badge-submitted',
    completed: 'badge-completed',
    rejected: 'badge-rejected',
    active: 'badge-active',
    sold: 'badge-sold',
    reserved: 'badge-reserved',
  }[status] || 'badge-pending';
}

function statusLabel(status) {
  return {
    pending_payment: 'Awaiting payment',
    submitted: 'Payment submitted',
    completed: 'Completed',
    rejected: 'Rejected',
    active: 'Active',
    sold: 'Sold',
    reserved: 'Reserved',
  }[status] || status;
}

async function renderNav() {
  const el = document.getElementById('nav');
  if (!el) return;
  let user = null;
  try {
    const data = await api('/api/me');
    user = data.user;
  } catch (e) {}

  let links = `<a href="/index.html">Browse</a>`;
  if (!user) {
    links += `<a href="/login.html" class="pill">Log in</a>`;
  } else {
    if (user.role === 'seller') links += `<a href="/seller.html">My shop</a>`;
    if (user.role === 'buyer') links += `<a href="/orders.html">My orders</a>`;
    if (user.role === 'admin') links += `<a href="/admin.html">Admin</a>`;
    links += `<span class="muted small">${escapeHtml(user.username)} (${user.role})</span>`;
    links += `<a href="#" class="pill" id="logoutBtn">Log out</a>`;
  }

  el.innerHTML = `
    <div class="inner">
      <a href="/index.html" class="brand"><span class="dot"></span>TrustLink Market</a>
      <div class="navlinks">${links}</div>
    </div>`;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/api/logout', { method: 'POST' });
      window.location.href = '/index.html';
    });
  }
  return user;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
