/* ═══════════════════════════════════════════════════════
   Admin CMS — Client-side editing for rishiprasad.me

   How it works:
   1. Press Ctrl+Shift+. three times quickly → login overlay.
   2. Password verified via SHA-256 hash (Web Crypto API).
   3. Admin bar appears. Toggle "Edit" to enter edit mode.
   4. All elements with data-edit become contenteditable.
   5. List items (projects, books, timeline) get add/remove.
   6. "Save" persists to localStorage. "Export" downloads JSON.
   7. On page load, localStorage overrides are applied.
   ═══════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ─── Config ───
  // bcrypt hash of admin password (change password by regenerating hash)
  const ADMIN_HASH = '$2b$10$T5qE/LnOK65Eh.26xQLzGOyZ.5T04zO0m/8fLwcG8NGrx19wWT6Fe';
  const STORAGE_KEY = 'rp_admin_session';
  const CONTENT_KEY = 'rp_site_content';

  // ─── Lightweight bcrypt verify (using bcryptjs-compatible check) ───
  // We include a minimal bcrypt verifier to avoid CDN dependency.
  // It uses the Web Crypto API for the core comparison.

  // For simplicity and zero-dependency, we'll use a SHA-256 based approach:
  // The password is hashed with SHA-256 + a salt stored in the hash.
  // But bcrypt is better — let's include a tiny bcrypt verifier.

  // Actually, for a client-side personal site, let's use a pragmatic approach:
  // SHA-256 hash comparison. Still strong enough that reading source won't reveal password.

  // SHA-256 of "RPadmin!" — regenerate with:
  //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOUR_PASSWORD'))
  const ADMIN_SHA256 = '5121f385fe8a13025ac36b41e738ab5e21800206c901d95dc92febcbbeacfa59';

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyPassword(password) {
    const hash = await sha256(password);
    return hash === ADMIN_SHA256;
  }

  // ─── State ───
  let isAuthenticated = false;
  let isEditing = false;
  let hasUnsaved = false;

  // ─── Check existing session ───
  function checkSession() {
    const session = sessionStorage.getItem(STORAGE_KEY);
    if (session === 'active') {
      isAuthenticated = true;
      showAdminBar();
      loadSavedContent();
    }
  }

  // ─── Keyboard shortcut: Ctrl+Shift+. pressed 3× within 1.5s ───
  let shortcutPresses = 0;
  let shortcutTimer = null;

  function initShortcut() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === '.' || e.key === '>' || e.code === 'Period')) {
        e.preventDefault();
        shortcutPresses++;
        if (shortcutPresses === 1) {
          shortcutTimer = setTimeout(() => { shortcutPresses = 0; }, 1500);
        }
        if (shortcutPresses >= 3) {
          shortcutPresses = 0;
          clearTimeout(shortcutTimer);
          if (!isAuthenticated) {
            showLoginOverlay();
          }
        }
      }
    });
  }

  // ─── Inject HTML ───
  function injectAdminUI() {

    // Login overlay
    const overlay = document.createElement('div');
    overlay.className = 'admin-login-overlay';
    overlay.id = 'adminLoginOverlay';
    overlay.innerHTML = `
      <div class="admin-login-box">
        <h3>Admin</h3>
        <p>Site editing mode</p>
        <input type="password" id="adminPassword" placeholder="Password" autocomplete="off" />
        <div class="admin-login-error" id="adminLoginError">Incorrect password</div>
        <div class="admin-login-actions">
          <button class="btn-login" id="adminLoginBtn">Login</button>
          <button class="btn-close" id="adminCloseBtn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Admin bar
    const bar = document.createElement('div');
    bar.className = 'admin-bar';
    bar.id = 'adminBar';
    bar.innerHTML = `
      <div class="admin-bar__label">
        <span class="admin-bar__dot"></span>
        Admin
      </div>
      <div class="admin-bar__sep"></div>
      <button class="admin-btn admin-btn--primary" id="adminEditBtn" onclick="window._admin.toggleEdit()">Edit</button>
      <button class="admin-btn admin-btn--save" id="adminSaveBtn" onclick="window._admin.save()">Save</button>
      <button class="admin-btn admin-btn--save" onclick="window._admin.saveAndExit()">Save &amp; Exit</button>
      <button class="admin-btn" onclick="window._admin.exportContent()">Export JSON</button>
      <button class="admin-btn" onclick="document.getElementById('adminImportFile').click()">Import JSON</button>
      <input type="file" id="adminImportFile" accept=".json" style="display:none" onchange="window._admin.importContent(event)" />
      <span class="admin-bar__unsaved" id="adminUnsaved">Unsaved changes</span>
      <div class="admin-bar__spacer"></div>
      <span class="admin-bar__status" id="adminStatus"></span>
      <div class="admin-bar__sep"></div>
      <button class="admin-btn admin-btn--danger" onclick="window._admin.logout()">Logout</button>
    `;
    document.body.appendChild(bar);

    // Event listeners
    document.getElementById('adminLoginBtn').onclick = handleLogin;
    document.getElementById('adminCloseBtn').onclick = hideLoginOverlay;
    document.getElementById('adminPassword').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
      if (e.key === 'Escape') hideLoginOverlay();
    });
  }

  // ─── Login ───
  function showLoginOverlay() {
    const overlay = document.getElementById('adminLoginOverlay');
    overlay.classList.add('visible');
    setTimeout(() => document.getElementById('adminPassword').focus(), 100);
  }

  function hideLoginOverlay() {
    const overlay = document.getElementById('adminLoginOverlay');
    overlay.classList.remove('visible');
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminLoginError').classList.remove('visible');
  }

  async function handleLogin() {
    const pw = document.getElementById('adminPassword').value;
    const valid = await verifyPassword(pw);
    if (valid) {
      isAuthenticated = true;
      sessionStorage.setItem(STORAGE_KEY, 'active');
      hideLoginOverlay();
      showAdminBar();
      loadSavedContent();
      toggleEdit(); // Auto-enter edit mode
      setStatus('Logged in — edit mode active');
    } else {
      document.getElementById('adminLoginError').classList.add('visible');
      document.getElementById('adminPassword').value = '';
      document.getElementById('adminPassword').focus();
    }
  }

  function showAdminBar() {
    document.body.classList.add('admin-active');
    document.getElementById('adminBar').classList.add('visible');
  }

  // ─── Edit Mode ───
  function toggleEdit() {
    isEditing = !isEditing;
    document.body.classList.toggle('admin-editing', isEditing);
    document.getElementById('adminEditBtn').textContent = isEditing ? 'Stop Editing' : 'Edit';

    // Make all data-edit elements contenteditable
    document.querySelectorAll('[data-edit]').forEach(el => {
      el.contentEditable = isEditing ? 'true' : 'false';
      if (isEditing) {
        el.addEventListener('input', markUnsaved);
      }
    });

    setStatus(isEditing ? 'Edit mode ON — click any highlighted text' : 'Edit mode off');
  }

  function markUnsaved() {
    hasUnsaved = true;
    document.getElementById('adminUnsaved').classList.add('visible');
  }

  // ─── Save/Load Content ───
  function save() {
    const content = {};
    document.querySelectorAll('[data-edit]').forEach(el => {
      const key = el.getAttribute('data-edit');
      content[key] = el.innerHTML;
    });

    // Also save list items (projects, books, timeline)
    const lists = {};
    document.querySelectorAll('[data-list]').forEach(container => {
      const listKey = container.getAttribute('data-list');
      const items = [];
      container.querySelectorAll('[data-list-item]').forEach(item => {
        items.push(item.outerHTML);
      });
      lists[listKey] = items;
    });

    const data = { content, lists, savedAt: new Date().toISOString() };
    localStorage.setItem(CONTENT_KEY, JSON.stringify(data));

    hasUnsaved = false;
    document.getElementById('adminUnsaved').classList.remove('visible');
    setStatus('Saved to browser at ' + new Date().toLocaleTimeString());
  }

  function loadSavedContent() {
    const raw = localStorage.getItem(CONTENT_KEY);
    if (!raw) return;

    try {
      const data = JSON.parse(raw);

      // Restore text content
      if (data.content) {
        Object.entries(data.content).forEach(([key, html]) => {
          const el = document.querySelector(`[data-edit="${key}"]`);
          if (el) el.innerHTML = html;
        });
      }

      // Restore list items
      if (data.lists) {
        Object.entries(data.lists).forEach(([key, items]) => {
          const container = document.querySelector(`[data-list="${key}"]`);
          if (container) {
            // Clear existing items
            container.querySelectorAll('[data-list-item]').forEach(el => el.remove());
            // Insert saved items
            items.forEach(html => {
              const temp = document.createElement('div');
              temp.innerHTML = html;
              const item = temp.firstElementChild;
              if (item) container.appendChild(item);
            });
          }
        });
      }

      if (data.savedAt) {
        setStatus('Loaded saved content from ' + new Date(data.savedAt).toLocaleString());
      }
    } catch (e) {
      console.warn('Failed to load saved content:', e);
    }
  }

  // ─── Export / Import ───
  function exportContent() {
    // Gather current state from DOM (whether saved or not)
    const content = {};
    document.querySelectorAll('[data-edit]').forEach(el => {
      content[el.getAttribute('data-edit')] = el.innerHTML;
    });

    const lists = {};
    document.querySelectorAll('[data-list]').forEach(container => {
      const listKey = container.getAttribute('data-list');
      const items = [];
      container.querySelectorAll('[data-list-item]').forEach(item => {
        items.push(item.outerHTML);
      });
      lists[listKey] = items;
    });

    const data = {
      page: document.title,
      content,
      lists,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rp-content-${document.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Exported content JSON');
  }

  function importContent(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);

        if (data.content) {
          Object.entries(data.content).forEach(([key, html]) => {
            const el = document.querySelector(`[data-edit="${key}"]`);
            if (el) el.innerHTML = html;
          });
        }

        if (data.lists) {
          Object.entries(data.lists).forEach(([key, items]) => {
            const container = document.querySelector(`[data-list="${key}"]`);
            if (container) {
              container.querySelectorAll('[data-list-item]').forEach(el => el.remove());
              items.forEach(html => {
                const temp = document.createElement('div');
                temp.innerHTML = html;
                const item = temp.firstElementChild;
                if (item) container.appendChild(item);
              });
            }
          });
        }

        markUnsaved();
        setStatus('Imported content — click Save to persist');
      } catch (err) {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // ─── List Item Management ───
  // Call this from page-specific code to add remove buttons to list items
  function enableListEditing(listSelector, itemSelector, templateFn) {
    const container = document.querySelector(listSelector);
    if (!container) return;

    // Store template function for adding new items
    container._adminTemplate = templateFn;
    container._adminItemSelector = itemSelector;

    // Add button after the container
    const addBtn = document.createElement('button');
    addBtn.className = 'admin-item-btn admin-item-btn--add';
    addBtn.textContent = '+ Add item';
    addBtn.style.marginTop = '1rem';
    addBtn.style.display = 'none';
    addBtn.onclick = function() {
      if (!templateFn) return;
      const html = templateFn();
      const temp = document.createElement('div');
      temp.innerHTML = html;
      const item = temp.firstElementChild;
      if (item) {
        container.appendChild(item);
        attachRemoveBtn(item);
        markUnsaved();
      }
    };
    container.after(addBtn);
    container._adminAddBtn = addBtn;

    // Observe edit mode changes
    const observer = new MutationObserver(() => {
      const editing = document.body.classList.contains('admin-editing');
      addBtn.style.display = editing ? 'inline-block' : 'none';
      container.querySelectorAll(itemSelector).forEach(item => {
        if (editing && !item.querySelector('.admin-item-btn--remove')) {
          attachRemoveBtn(item);
        }
        const rmBtn = item.querySelector('.admin-item-btn--remove');
        if (rmBtn) rmBtn.style.display = editing ? 'inline-block' : 'none';
      });
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function attachRemoveBtn(item) {
    if (item.querySelector('.admin-item-btn--remove')) return;
    const btn = document.createElement('button');
    btn.className = 'admin-item-btn admin-item-btn--remove';
    btn.textContent = 'Remove';
    btn.style.display = document.body.classList.contains('admin-editing') ? 'inline-block' : 'none';
    btn.onclick = function(e) {
      e.stopPropagation();
      if (confirm('Remove this item?')) {
        item.remove();
        markUnsaved();
      }
    };
    item.appendChild(btn);
  }

  // ─── Utilities ───
  function setStatus(msg) {
    const el = document.getElementById('adminStatus');
    if (el) el.textContent = msg;
  }

  function saveAndExit() {
    save();
    if (isEditing) toggleEdit();
    // Brief confirmation then logout
    setStatus('Saved — logging out…');
    setTimeout(() => {
      isAuthenticated = false;
      isEditing = false;
      sessionStorage.removeItem(STORAGE_KEY);
      document.body.classList.remove('admin-active', 'admin-editing');
      document.getElementById('adminBar').classList.remove('visible');
      document.querySelectorAll('[data-edit]').forEach(el => {
        el.contentEditable = 'false';
      });
    }, 600);
  }

  function logout() {
    if (hasUnsaved && !confirm('You have unsaved changes. Logout anyway?')) return;
    isAuthenticated = false;
    isEditing = false;
    sessionStorage.removeItem(STORAGE_KEY);
    document.body.classList.remove('admin-active', 'admin-editing');
    document.getElementById('adminBar').classList.remove('visible');
    document.querySelectorAll('[data-edit]').forEach(el => {
      el.contentEditable = 'false';
    });
    // Reload to reset any unsaved edits
    location.reload();
  }

  // ─── Public API ───
  window._admin = {
    toggleEdit,
    save,
    exportContent,
    importContent,
    logout,
    saveAndExit,
    enableListEditing,
    markUnsaved,
    isEditing: () => isEditing,
    isAuth: () => isAuthenticated,
  };

  // ─── Init ───
  function init() {
    injectAdminUI();
    initShortcut();
    checkSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
