// Session cache -- pola diporting dari csorder-main/js/auth.js + Marketplace-main/js/auth.js
let _currentUser = null;

async function getCurrentUser() {
  if (_currentUser) return _currentUser;
  const cached = sessionStorage.getItem('currentUser');
  if (cached) { _currentUser = JSON.parse(cached); return _currentUser; }

  const session = await sbGetSession();
  if (!session) return null;

  let profile = null;
  try { profile = await dbGetProfile(session.user.id); } catch {}

  if (!profile) {
    // Self-heal: rekonstruksi dari user_metadata kalau row profiles gak kebentuk
    // (gap yang sama pernah ditemukan di csorder-main -- dihindari di sini dengan fallback ini)
    const meta = session.user.user_metadata || {};
    profile = { id: session.user.id, email: session.user.email, name: meta.name || session.user.email, role: 'user' };
    try { await _sb.from('profiles').upsert(profile); } catch {}
  }

  _currentUser = { ...profile, email: session.user.email };
  sessionStorage.setItem('currentUser', JSON.stringify(_currentUser));
  return _currentUser;
}

async function requireAuth(allowedRoles) {
  const user = await getCurrentUser();
  if (!user) { window.location.href = 'index.html'; return null; }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    window.location.href = 'index.html'; return null;
  }
  return user;
}

function logout() {
  _currentUser = null;
  sessionStorage.clear();
  sbLogout();
}
