const mealTypes = ['breakfast', 'lunch', 'dinner'];
const restaurantCuisineOptions = ['American', 'Asian', 'BBQ', 'Chinese', 'German', 'Italian', 'Japanese', 'Korean', 'Mexican'];
const accentColorOptions = ['#4A13F0', '#F0134A', '#B913F0', '#F0B913', '#4AF013'];
const defaultAccentColor = '#4A13F0';
const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const plannerWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const plannerDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const plannerRangeDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' });

const state = {
  token: getStoredToken(),
  user: null,
  household: null,
  page: 'planner',
  weekStart: startOfWeek(new Date()),
  plannerView: localStorage.getItem('mealPlannerView') || '2weeks',
  plannerDisplay: localStorage.getItem('mealPlannerDisplay') || 'cards',
  plannerPreviousWeek: localStorage.getItem('mealPlannerPreviousWeek') === '1',
  plannerCenterToday: localStorage.getItem('mealPlannerCenterToday') !== '0',
  historyViewMode: localStorage.getItem('mealPlannerHistoryViewMode') || 'amount',
  historyAmount: localStorage.getItem('mealPlannerHistoryAmount') || '5',
  historyDays: localStorage.getItem('mealPlannerHistoryDays') || '30',
  recipes: [],
  cookbooks: [],
  activeRecipeCookbookId: localStorage.getItem('mealPlannerActiveCookbook') || 'all',
  recipeSearch: '',
  recipeSort: localStorage.getItem('mealPlannerRecipeSort') || 'name-asc',
  restaurants: [],
  customMealFavorites: [],
  planner: { dates: [], plans: [] },
  grocery: [],
  history: [],
  stats: null,
  suggestions: [],
  restaurantSort: localStorage.getItem('mealPlannerRestaurantSort') || 'favorite',
  restaurantListView: localStorage.getItem('mealPlannerRestaurantListView') || 'saved',
  editingRestaurantId: '',
  openRestaurantMenuId: '',
  openPlannerMealMenuId: '',
  mobileRecipeDetailId: '',
  openMobileRecipeMenuId: '',
  desktopRecipeCookbookId: '',
  socket: null,
  realtimeRefreshTimer: null,
  realtimeRefreshInFlight: false,
  realtimeRefreshQueued: false
};

let recipeImportScan = { dataUrl: '', name: '', type: '' };
let recipeImportAiMeta = null;
let recipeImportOcrInFlight = false;
let recipeImportOcrRequestId = 0;

const $ = selector => document.querySelector(selector);
const pageRoot = $('#page-root');
const toast = $('#toast');
const authScreen = $('#auth-screen');
const appShell = $('#app-shell');

init();

function init() {
  applyTheme('light');
  applyAccentColor(defaultAccentColor);
  bindAuth();
  bindShell();
  bindTactileSounds();
  initializeMobileWebSidebar();

  if (state.token) {
    bootApp().catch(() => logout());
  }
}

function bindAuth() {
  const authTabs = document.querySelector('.auth-tabs');
  const setAuthMode = mode => {
    const nextMode = mode === 'signup' ? 'signup' : 'login';
    authTabs?.setAttribute('data-auth-mode', nextMode);
    document.querySelectorAll('[data-auth-tab]').forEach(tab => {
      const isActive = tab.dataset.authTab === nextMode;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('[data-auth-panel]').forEach(panel => {
      const isOpen = panel.dataset.authPanel === nextMode;
      panel.classList.toggle('open', isOpen);
      panel.setAttribute('aria-hidden', String(!isOpen));
      panel.querySelectorAll('input, button, select, textarea').forEach(control => {
        control.tabIndex = isOpen ? 0 : -1;
      });
    });
    $('#auth-error').textContent = '';
  };

  document.querySelectorAll('[data-auth-tab]').forEach(button => {
    button.addEventListener('click', () => setAuthMode(button.dataset.authTab));
  });
  setAuthMode(authTabs?.dataset.authMode || 'login');

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('#auth-error').textContent = '';
    const loginFormData = new FormData(event.currentTarget);
    const rememberMe = loginFormData.get('rememberMe') === 'on';
    const data = Object.fromEntries(loginFormData);
    delete data.rememberMe;
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: data, auth: false });
      setSession(result, rememberMe);
      await bootApp();
    } catch (error) {
      $('#auth-error').textContent = error.message;
    }
  });

  $('#signup-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('#auth-error').textContent = '';
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.inviteCode) delete data.inviteCode;
    try {
      const result = await api('/api/auth/signup', { method: 'POST', body: data, auth: false });
      setSession(result);
      await bootApp();
    } catch (error) {
      $('#auth-error').textContent = error.message;
    }
  });
}

function bindShell() {
  $('#logout-btn')?.addEventListener('click', logout);
  $('#user-avatar-btn')?.addEventListener('click', async () => {
    closeMobileWebSidebarForModal();
    await openSettingsPage('profile');
  });


  $('#recipe-cookbook-select')?.addEventListener('change', event => {
    state.activeRecipeCookbookId = event.currentTarget.value || 'all';
    localStorage.setItem('mealPlannerActiveCookbook', state.activeRecipeCookbookId);
    renderMobileRecipeResults();
  });

  $('#manage-recipe-cookbooks')?.addEventListener('click', openRecipeCookbookManager);

  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', async () => {
      state.page = button.dataset.page;
      if (state.page === 'recipes') {
        state.mobileRecipeDetailId = '';
        state.openMobileRecipeMenuId = '';
        state.desktopRecipeCookbookId = '';
      }
      document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === state.page));
      setMobileWebSidebarOpen(false);
      await renderCurrentPage();
    });
  });

  document.addEventListener('click', event => {
    let shouldRenderPlanner = false;
    let shouldRenderRestaurants = false;

    if (state.openPlannerMealMenuId && !event.target.closest('.meal-menu-wrap, [data-plan-menu], .meal-action-menu')) {
      state.openPlannerMealMenuId = '';
      shouldRenderPlanner = state.page === 'planner';
    }

    if (state.openRestaurantMenuId && !event.target.closest('.restaurant-menu-wrap, [data-restaurant-menu], .restaurant-action-menu')) {
      state.openRestaurantMenuId = '';
      shouldRenderRestaurants = state.page === 'restaurants';
    }

    if (shouldRenderPlanner) renderPlanner();
    if (shouldRenderRestaurants) renderRestaurants();
  }, true);

  document.addEventListener('click', event => {
    if (!state.openMobileRecipeMenuId || event.target.closest('.mobile-recipe-menu-wrap')) return;
    closeMobileRecipeActionMenus();
  });

}

async function bootApp() {
  const me = await api('/api/me');
  state.user = me.user;
  state.household = me.household;
  connectRealtime();
  syncUserAvatarUI();
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  setActiveNav(state.page);
  await loadBaseData();
  await renderCurrentPage();
}


function connectRealtime() {
  if (!state.token || typeof window.io !== 'function') return;

  if (state.socket) {
    state.socket.off('household:update', scheduleRealtimeRefresh);
    state.socket.disconnect();
  }

  state.socket = window.io({ auth: { token: state.token } });
  state.socket.on('household:update', scheduleRealtimeRefresh);
  state.socket.on('connect_error', () => {
    // Keep the app usable if realtime is temporarily unavailable.
  });
}

function disconnectRealtime() {
  if (state.realtimeRefreshTimer) {
    clearTimeout(state.realtimeRefreshTimer);
    state.realtimeRefreshTimer = null;
  }
  state.realtimeRefreshQueued = false;
  state.realtimeRefreshInFlight = false;
  if (state.socket) {
    state.socket.off('household:update', scheduleRealtimeRefresh);
    state.socket.disconnect();
    state.socket = null;
  }
}

function scheduleRealtimeRefresh() {
  if (!state.token) return;

  if (state.realtimeRefreshInFlight) {
    state.realtimeRefreshQueued = true;
    return;
  }

  clearTimeout(state.realtimeRefreshTimer);
  state.realtimeRefreshTimer = null;
  runRealtimeRefresh();
}

async function runRealtimeRefresh() {
  if (!state.token || state.realtimeRefreshInFlight) return;

  state.realtimeRefreshInFlight = true;
  try {
    const me = await api('/api/me');
    state.user = me.user;
    state.household = me.household;
    syncUserAvatarUI();
    await loadBaseData();
    await renderCurrentPage();
  } catch (error) {
    console.warn('Realtime refresh failed', error);
  } finally {
    state.realtimeRefreshInFlight = false;
    if (state.realtimeRefreshQueued) {
      state.realtimeRefreshQueued = false;
      queueMicrotask(runRealtimeRefresh);
    }
  }
}

async function openSettingsPage(focusSection = '') {
  state.page = 'settings';
  setActiveNav('settings');
  await renderCurrentPage();
  if (focusSection === 'household') {
    const card = document.querySelector('[data-settings-section="household"]');
    card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    card?.classList.add('setting-card-pulse');
    setTimeout(() => card?.classList.remove('setting-card-pulse'), 900);
  }
  if (focusSection === 'profile') {
    const card = document.querySelector('[data-settings-section="profile"]');
    card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
}

async function loadBaseData() {
  await Promise.all([
    loadRecipes(),
    loadCookbooks(),
    loadRestaurants(),
    loadCustomMealFavorites(),
    loadPlanner(),
    loadGrocery(),
    loadHistory(),
    loadStats(),
    loadSuggestions({ mealType: 'dinner' })
  ]);
}

async function renderCurrentPage() {
  appShell.dataset.page = state.page;
  $('#page-title').textContent = titleCase(state.page === 'grocery' ? 'Grocery List' : state.page);
  updateRecipeMobileToolbarVisibility();
  if (state.page === 'dashboard') return renderDashboard();
  if (state.page === 'planner') return renderPlanner();
  if (state.page === 'recipes') return renderRecipes();
  if (state.page === 'restaurants') return renderRestaurants();
  if (state.page === 'grocery') return renderGrocery();
  if (state.page === 'history') return renderHistory();
  if (state.page === 'stats') return renderStats();
  if (state.page === 'settings') return renderSettings();
}

function updateRecipeMobileToolbarVisibility() {
  const toolbar = $('#recipe-mobile-cookbook-toolbar');
  appShell.dataset.recipeDetail = state.page === 'recipes' && state.mobileRecipeDetailId ? 'true' : 'false';
  if (!toolbar) return;
  toolbar.hidden = state.page !== 'recipes' || Boolean(state.mobileRecipeDetailId);
  if (state.page === 'recipes' && !state.mobileRecipeDetailId) syncRecipeCookbookToolbar();
}

function setActiveNav(page) {
  appShell.dataset.page = page;
  document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  $('#page-title').textContent = titleCase(page === 'grocery' ? 'Grocery List' : page);
  updateRecipeMobileToolbarVisibility();
}

function getStoredToken() {
  return localStorage.getItem('mealPlannerToken') || sessionStorage.getItem('mealPlannerToken') || '';
}

function setSession(result, remember = true) {
  state.token = result.token;
  state.user = result.user;
  state.household = result.household;
  const storage = remember ? localStorage : sessionStorage;
  const otherStorage = remember ? sessionStorage : localStorage;
  otherStorage.removeItem('mealPlannerToken');
  storage.setItem('mealPlannerToken', result.token);
}

function logout() {
  disconnectRealtime();
  state.token = '';
  state.user = null;
  state.household = null;
  localStorage.removeItem('mealPlannerToken');
  sessionStorage.removeItem('mealPlannerToken');
  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (options.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.auth !== false && state.socket?.id) headers['X-Socket-Id'] = state.socket.id;

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function getFormCheckboxChecked(form, name) {
  const field = form?.elements?.[name];
  if (!field) return false;
  if (typeof RadioNodeList !== 'undefined' && field instanceof RadioNodeList) return Boolean([...field].find(item => item.checked));
  return Boolean(field.checked);
}

async function withSaveFeedback(form, action, successMessage = 'Saved.') {
  const submitButton = form?.querySelector?.('[type="submit"]');
  const originalHtml = submitButton?.innerHTML;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.innerHTML = 'Saving...';
  }

  try {
    const result = await action();
    if (successMessage) showToast(successMessage);
    return result;
  } catch (error) {
    showToast(error.message || 'Save failed. Please try again.');
    return null;
  } finally {
    if (submitButton?.isConnected) {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      submitButton.innerHTML = originalHtml;
    }
  }
}

async function loadRecipes() {
  state.recipes = await api('/api/recipes');
}

async function loadCookbooks() {
  state.cookbooks = await api('/api/cookbooks');
  if (state.activeRecipeCookbookId !== 'all' && !state.cookbooks.some(cookbook => String(cookbook._id) === String(state.activeRecipeCookbookId))) {
    state.activeRecipeCookbookId = 'all';
    localStorage.setItem('mealPlannerActiveCookbook', 'all');
  }
}

async function loadRestaurants() {
  state.restaurants = await api('/api/restaurants');
}

async function loadCustomMealFavorites() {
  state.customMealFavorites = await api('/api/custom-meal-favorites');
}

async function loadPlanner() {
  const query = new URLSearchParams({
    weekStart: getPlannerRangeStart(),
    days: String(getPlannerDisplayDays())
  }).toString();
  state.planner = await api(`/api/planner?${query}`);
}

async function loadGrocery() {
  state.grocery = await api('/api/grocery');
}

async function loadHistory() {
  state.history = await api('/api/history');
}

async function loadStats() {
  state.stats = await api('/api/stats');
}

async function loadSuggestions(params = {}) {
  const query = new URLSearchParams(params).toString();
  state.suggestions = await api(`/api/suggestions${query ? `?${query}` : ''}`);
}

function renderDashboard() {
  const today = dateISO(new Date());
  const todayPlans = state.planner.plans.filter(plan => plan.date === today);
  const stats = state.stats?.totals || {};

  pageRoot.innerHTML = `
    <section class="grid three">
      ${kpiCard('Meals Planned', stats.planned || 0, `${stats.eaten || 0} eaten`)}
      ${kpiCard('Open Groceries', stats.groceryOpen || 0, `${stats.groceryTotal || 0} total items`)}
      ${kpiCard('Completion', `${stats.planningCompletion || 0}%`, 'planned meals eaten')}
    </section>

    <section class="grid two">
      <article class="card">
        <h3>Today</h3>
        <div class="list">
          ${todayPlans.length ? todayPlans.map(plan => mealPlanSummary(plan)).join('') : '<div class="empty">No meals planned for today yet.</div>'}
        </div>
      </article>
      <article class="card">
        <h3>Dinner Suggestions</h3>
        <div class="list">
          ${state.suggestions.length ? state.suggestions.slice(0, 5).map(item => suggestionItem(item)).join('') : '<div class="empty">Add recipes or restaurants to unlock suggestions.</div>'}
        </div>
      </article>
    </section>

    <section class="grid two">
      <article class="card">
        <h3>Recently Eaten</h3>
        <div class="list">
          ${state.history.length ? state.history.slice(0, 5).map(historyItem).join('') : '<div class="empty">Meal history appears here after you mark meals as eaten.</div>'}
        </div>
      </article>
      <article class="card">
        <h3>Quick Actions</h3>
        <div class="action-row">
          <button class="primary" data-go="planner">Plan This Week</button>
          <button class="secondary" data-go="recipes">Add Recipe</button>
          <button class="secondary" data-go="restaurants">Add Restaurant</button>
          <button class="secondary" data-go="grocery">Open Grocery List</button>
        </div>
      </article>
    </section>
  `;

  pageRoot.querySelectorAll('[data-go]').forEach(button => {
    button.addEventListener('click', async () => {
      setMobileWebSidebarOpen(false);
      state.page = button.dataset.go;
      setActiveNav(state.page);
      await renderCurrentPage();
    });
  });
}

function isMobilePlannerViewport() {
  return window.matchMedia('(max-width: 980px)').matches;
}

function getPlannerDatesForDisplay() {
  const dates = [...(state.planner?.dates || [])];
  if (!isMobilePlannerViewport()) return dates;

  const today = dateISO(new Date());
  const todayIndex = dates.indexOf(today);
  if (todayIndex <= 0) return dates;

  return [
    dates[todayIndex],
    ...dates.slice(todayIndex + 1),
    ...dates.slice(0, todayIndex)
  ];
}

function openPlannerDisplayOptionsModal() {
  closeMobileWebSidebarForModal();
  document.querySelector('.planner-display-options-overlay')?.remove();

  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay planner-display-options-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card planner-display-options-card" role="dialog" aria-modal="true" aria-labelledby="planner-display-options-title">
      <header class="time-modal-header">
        <div>
          <h3 id="planner-display-options-title">Display Options</h3>
          <p class="muted">${escapeHtml(getPlannerRangeLabel())}</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-planner-display-options aria-label="Close display options">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner planner-display-options-body">
          <div class="planner-display-options-select-row">
            <label class="planner-control">Range
              <select id="planner-modal-view-select">
                ${option('1week', '1 Week', state.plannerView)}
                ${option('2weeks', '2 Weeks', state.plannerView)}
                ${option('3weeks', '3 Weeks', state.plannerView)}
                ${option('month', 'Month', state.plannerView)}
              </select>
            </label>
            <label class="planner-control">Display
              <select id="planner-modal-display-select">
                ${option('cards', 'Daily Cards', state.plannerDisplay)}
                ${option('full-calendar', 'Calendar', state.plannerDisplay)}
              </select>
            </label>
          </div>

          <div class="planner-display-options-toggle-row">
            <label class="checkbox-line planner-previous-toggle">
              <input id="planner-modal-previous-week" type="checkbox" ${state.plannerPreviousWeek ? 'checked' : ''} /> Previous Week
            </label>
            <label class="checkbox-line planner-center-toggle ${state.plannerDisplay === 'full-calendar' ? 'is-disabled' : ''}" title="Keep today in the center position of the first seven-day row">
              <input id="planner-modal-center-today" type="checkbox" ${state.plannerCenterToday ? 'checked' : ''} ${state.plannerDisplay === 'full-calendar' ? 'disabled' : ''} /> Center Today
            </label>
          </div>

          <div class="planner-display-options-nav">
            <button class="secondary" id="planner-modal-prev" type="button">Previous</button>
            <button class="ghost" id="planner-modal-current" type="button">Current</button>
            <button class="secondary" id="planner-modal-next" type="button">Next</button>
          </div>

          <button class="primary full" id="planner-modal-generate-grocery" type="button">Generate Grocery List</button>
        </div>
      </div>
    </article>
  `;

  const close = () => {
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    window.setTimeout(() => overlay.remove(), 190);
  };

  const refreshPlannerBehindModal = async () => {
    await loadPlanner();
    renderPlanner();
    const rangeCopy = overlay.querySelector('.time-modal-header .muted');
    if (rangeCopy) rangeCopy.textContent = getPlannerRangeLabel();
  };

  overlay.querySelectorAll('[data-close-planner-display-options]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });

  overlay.querySelector('#planner-modal-view-select')?.addEventListener('change', async event => {
    state.plannerView = event.currentTarget.value;
    localStorage.setItem('mealPlannerView', state.plannerView);
    await refreshPlannerBehindModal();
  });

  overlay.querySelector('#planner-modal-display-select')?.addEventListener('change', async event => {
    state.plannerDisplay = event.currentTarget.value;
    localStorage.setItem('mealPlannerDisplay', state.plannerDisplay);
    await refreshPlannerBehindModal();

    const centerLabel = overlay.querySelector('.planner-center-toggle');
    const centerInput = overlay.querySelector('#planner-modal-center-today');
    const isCalendar = state.plannerDisplay === 'full-calendar';
    centerLabel?.classList.toggle('is-disabled', isCalendar);
    if (centerInput) centerInput.disabled = isCalendar;
  });

  overlay.querySelector('#planner-modal-previous-week')?.addEventListener('change', async event => {
    state.plannerPreviousWeek = event.currentTarget.checked;
    if (state.plannerPreviousWeek) {
      state.plannerCenterToday = false;
      localStorage.setItem('mealPlannerCenterToday', '0');
      const centerInput = overlay.querySelector('#planner-modal-center-today');
      if (centerInput) centerInput.checked = false;
    }
    localStorage.setItem('mealPlannerPreviousWeek', state.plannerPreviousWeek ? '1' : '0');
    await refreshPlannerBehindModal();
  });

  overlay.querySelector('#planner-modal-center-today')?.addEventListener('change', async event => {
    state.plannerCenterToday = event.currentTarget.checked;
    if (state.plannerCenterToday) {
      state.plannerPreviousWeek = false;
      state.weekStart = startOfWeek(new Date());
      localStorage.setItem('mealPlannerPreviousWeek', '0');
      const previousInput = overlay.querySelector('#planner-modal-previous-week');
      if (previousInput) previousInput.checked = false;
    }
    localStorage.setItem('mealPlannerCenterToday', state.plannerCenterToday ? '1' : '0');
    await refreshPlannerBehindModal();
  });

  overlay.querySelector('#planner-modal-prev')?.addEventListener('click', async () => {
    state.plannerCenterToday = false;
    localStorage.setItem('mealPlannerCenterToday', '0');
    movePlannerPeriod(-1);
    await loadPlanner();
    close();
    renderPlanner();
  });

  overlay.querySelector('#planner-modal-next')?.addEventListener('click', async () => {
    state.plannerCenterToday = false;
    localStorage.setItem('mealPlannerCenterToday', '0');
    movePlannerPeriod(1);
    await loadPlanner();
    close();
    renderPlanner();
  });

  overlay.querySelector('#planner-modal-current')?.addEventListener('click', async () => {
    state.weekStart = startOfWeek(new Date());
    state.plannerPreviousWeek = false;
    state.plannerCenterToday = true;
    localStorage.setItem('mealPlannerPreviousWeek', '0');
    localStorage.setItem('mealPlannerCenterToday', '1');
    await loadPlanner();
    close();
    renderPlanner();
  });

  overlay.querySelector('#planner-modal-generate-grocery')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Generating…';
    try {
      const result = await api('/api/grocery/generate-from-plan', { method: 'POST', body: { weekStart: getPlannerRangeStart(), days: getPlannerDisplayDays() } });
      await loadGrocery();
      showToast(`Added ${result.createdCount} grocery item${result.createdCount === 1 ? '' : 's'} from planned recipes.`);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('#planner-modal-view-select')?.focus();
}

function renderPlanner() {
  const mealOrder = new Map(mealTypes.map((type, index) => [type, index]));
  const sortedPlans = [...state.planner.plans].sort((a, b) => {
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate) return byDate;
    const byTime = String(a.time || '').localeCompare(String(b.time || ''));
    if (byTime) return byTime;
    return (mealOrder.get(a.mealType) ?? 99) - (mealOrder.get(b.mealType) ?? 99);
  });
  const plansByDate = groupBy(sortedPlans, plan => plan.date);
  const fullCalendar = state.plannerDisplay === 'full-calendar';
  const rangeLabel = getPlannerRangeLabel();
  const plannerDates = getPlannerDatesForDisplay();

  pageRoot.innerHTML = `
    <section class="form-card planner-toolbar planner-toolbar-desktop">
      <div class="planner-toolbar-copy">
        <h3>Meal Planner</h3>
        <p class="muted">${escapeHtml(rangeLabel)}</p>
      </div>
      <div class="planner-controls" aria-label="Planner display controls">
        <label class="planner-control">Range
          <select id="planner-view-select">
            ${option('1week', '1 Week', state.plannerView)}
            ${option('2weeks', '2 Weeks', state.plannerView)}
            ${option('3weeks', '3 Weeks', state.plannerView)}
            ${option('month', 'Month', state.plannerView)}
          </select>
        </label>
        <label class="planner-control">Display
          <select id="planner-display-select">
            ${option('cards', 'Daily Cards', state.plannerDisplay)}
            ${option('full-calendar', 'Calendar', state.plannerDisplay)}
          </select>
        </label>
        <label class="checkbox-line planner-previous-toggle">
          <input id="planner-previous-week" type="checkbox" ${state.plannerPreviousWeek ? 'checked' : ''} /> Previous Week
        </label>
        <label class="checkbox-line planner-center-toggle ${fullCalendar ? 'is-disabled' : ''}" title="Keep today in the center position of the first seven-day row">
          <input id="planner-center-today" type="checkbox" ${state.plannerCenterToday ? 'checked' : ''} ${fullCalendar ? 'disabled' : ''} /> Center Today
        </label>
      </div>
      <div class="toolbar">
        <button class="secondary" id="prev-week">Previous</button>
        <button class="ghost" id="this-week">Current</button>
        <button class="secondary" id="next-week">Next</button>
        <button class="primary" id="generate-grocery">Generate Grocery List</button>
      </div>
    </section>
    <button class="secondary planner-display-options-button" id="planner-display-options-button" type="button">
      <i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>
      <span>Display Options</span>
    </button>
    <section class="calendar-grid ${fullCalendar ? 'full-calendar-grid' : 'daily-planner-grid'}" aria-label="${fullCalendar ? 'Full meal calendar' : 'Daily meal planner'}">
      ${fullCalendar ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => `<div class="full-calendar-weekday">${day}</div>`).join('') : ''}
      ${plannerDates.map(date => plannerDayCard(date, plansByDate[date] || [], fullCalendar)).join('')}
    </section>
  `;

  $('#planner-display-options-button')?.addEventListener('click', openPlannerDisplayOptionsModal);

  $('#prev-week').addEventListener('click', async () => {
    state.plannerCenterToday = false;
    localStorage.setItem('mealPlannerCenterToday', '0');
    movePlannerPeriod(-1);
    await loadPlanner();
    renderPlanner();
  });

  $('#next-week').addEventListener('click', async () => {
    state.plannerCenterToday = false;
    localStorage.setItem('mealPlannerCenterToday', '0');
    movePlannerPeriod(1);
    await loadPlanner();
    renderPlanner();
  });

  $('#this-week').addEventListener('click', async () => {
    state.weekStart = startOfWeek(new Date());
    state.plannerPreviousWeek = false;
    state.plannerCenterToday = true;
    localStorage.setItem('mealPlannerPreviousWeek', '0');
    localStorage.setItem('mealPlannerCenterToday', '1');
    await loadPlanner();
    renderPlanner();
  });

  $('#planner-view-select')?.addEventListener('change', async event => {
    state.plannerView = event.currentTarget.value;
    localStorage.setItem('mealPlannerView', state.plannerView);
    await loadPlanner();
    renderPlanner();
  });

  $('#planner-display-select')?.addEventListener('change', async event => {
    state.plannerDisplay = event.currentTarget.value;
    localStorage.setItem('mealPlannerDisplay', state.plannerDisplay);
    await loadPlanner();
    renderPlanner();
  });

  $('#planner-previous-week')?.addEventListener('change', async event => {
    state.plannerPreviousWeek = event.currentTarget.checked;
    if (state.plannerPreviousWeek) {
      state.plannerCenterToday = false;
      localStorage.setItem('mealPlannerCenterToday', '0');
    }
    localStorage.setItem('mealPlannerPreviousWeek', state.plannerPreviousWeek ? '1' : '0');
    await loadPlanner();
    renderPlanner();
  });

  $('#planner-center-today')?.addEventListener('change', async event => {
    state.plannerCenterToday = event.currentTarget.checked;
    if (state.plannerCenterToday) {
      state.plannerPreviousWeek = false;
      state.weekStart = startOfWeek(new Date());
      localStorage.setItem('mealPlannerPreviousWeek', '0');
    }
    localStorage.setItem('mealPlannerCenterToday', state.plannerCenterToday ? '1' : '0');
    await loadPlanner();
    renderPlanner();
  });

  $('#generate-grocery').addEventListener('click', async () => {
    const result = await api('/api/grocery/generate-from-plan', { method: 'POST', body: { weekStart: getPlannerRangeStart(), days: getPlannerDisplayDays() } });
    await loadGrocery();
    showToast(`Added ${result.createdCount} grocery item${result.createdCount === 1 ? '' : 's'} from planned recipes.`);
  });

  pageRoot.querySelectorAll('[data-add-date]').forEach(button => {
    button.addEventListener('click', () => openCalendarMealForm(button.dataset.addDate));
  });

  pageRoot.querySelectorAll('[data-plan-menu]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const planId = button.dataset.planMenu;
      state.openPlannerMealMenuId = String(state.openPlannerMealMenuId) === String(planId) ? '' : planId;
      renderPlanner();
    });
  });

  pageRoot.querySelectorAll('[data-plan-item]').forEach(item => {
    item.addEventListener('dblclick', event => {
      if (event.target.closest('[data-plan-menu], .meal-action-menu')) return;
      const plan = state.planner.plans.find(planItem => String(planItem._id) === String(item.dataset.planItem));
      state.openPlannerMealMenuId = '';
      if (plan) openCalendarMealForm(plan.date, plan);
    });
  });


  pageRoot.querySelectorAll('[data-toggle-plan-eaten]').forEach(input => {
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('change', async event => {
      const plan = state.planner.plans.find(planItem => String(planItem._id) === String(input.dataset.togglePlanEaten));
      if (!plan) return;
      const nextStatus = input.checked ? 'eaten' : 'planned';
      try {
        await api('/api/planner/slot', {
          method: 'PUT',
          body: {
            date: plan.date,
            mealType: plan.mealType,
            time: plan.time || '',
            sourceType: plan.sourceType || 'custom',
            sourceId: plan.sourceId || '',
            customName: plan.customName || '',
            customProtein: plan.customProtein || '',
            customSides: plan.customSides || [],
            status: nextStatus,
            notes: plan.notes || ''
          }
        });
        await Promise.all([loadPlanner(), loadHistory(), loadStats()]);
        showToast(nextStatus === 'eaten' ? 'Meal marked eaten.' : 'Meal marked planned.');
        renderPlanner();
      } catch (error) {
        input.checked = !input.checked;
        showToast(error.message || 'Could not update meal status.');
      }
    });
  });

  pageRoot.querySelectorAll('[data-edit-plan]').forEach(button => {
    button.addEventListener('click', () => {
      const plan = state.planner.plans.find(item => String(item._id) === String(button.dataset.editPlan));
      state.openPlannerMealMenuId = '';
      if (plan) openCalendarMealForm(plan.date, plan);
    });
  });

  pageRoot.querySelectorAll('[data-delete-plan]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/planner/${button.dataset.deletePlan}`, { method: 'DELETE' });
      state.openPlannerMealMenuId = '';
      await loadPlanner();
      showToast('Meal deleted.');
      renderPlanner();
    });
  });
}

function plannerDayCard(date, plans, fullCalendar = false) {
  const todayIso = dateISO(new Date());
  const isToday = date === todayIso;
  const isPast = date < todayIso;
  return `
    <article class="calendar-day ${fullCalendar ? 'full-calendar-day' : ''} ${isToday ? 'today' : ''} ${isPast ? 'past-day' : ''}" data-date="${date}">
      <header class="calendar-day-header">
        <div>
          <span class="calendar-day-name">${plannerWeekdayFormatter.format(new Date(`${date}T12:00:00`))}</span>
          <span class="calendar-day-date">${plannerDateFormatter.format(new Date(`${date}T12:00:00`))}</span>
        </div>
        ${isPast ? '' : `<button class="calendar-add-btn" type="button" data-add-date="${date}" aria-label="Add meal for ${date}">+</button>`}
      </header>
      <div class="calendar-meals">
        ${plans.length ? plans.map(plannerMealItem).join('') : '<div class="empty compact">No meals planned.</div>'}
      </div>
    </article>
  `;
}

function openCalendarMealForm(date, plan = null) {
  closeMobileWebSidebarForModal();
  closeCalendarMealModal(true);

  const modal = document.createElement('div');
  modal.className = 'time-modal-overlay';
  modal.id = 'meal-time-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', `${plan ? 'Edit' : 'Add'} meal for ${date}`);
  modal.innerHTML = `
    <div class="time-modal-card">
      <header class="time-modal-header">
        <div>
          <h3>${plan ? 'Edit Meal' : 'Add Meal'}</h3>
          <p class="muted">${dayFormatter.format(new Date(`${date}T12:00:00`))} · ${date}</p>
        </div>
        <button class="small-btn modal-close-btn" type="button" data-close-meal-modal aria-label="Close meal form">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          ${calendarMealForm(date, plan)}
        </div>
      </div>
    </div>
  `;

  document.body.classList.add('modal-open');
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));

  const form = modal.querySelector('.slot-form');
  const sourceTypeSelect = form.querySelector('[name="sourceType"]');
  const mealTypeSelect = form.querySelector('[name="mealType"]');
  const timeInput = form.querySelector('[name="time"]');
  let manualTime = Boolean(plan?.time);
  let previousSourceType = sourceTypeSelect.value === 'favorites' ? 'custom' : sourceTypeSelect.value;

  const close = () => closeCalendarMealModal();

  const syncSourceFields = () => {
    const type = sourceTypeSelect.value;
    form.querySelectorAll('[data-source-field]').forEach(field => {
      field.classList.toggle('open', field.dataset.sourceField === type);
    });
  };

  sourceTypeSelect.addEventListener('change', () => {
    if (sourceTypeSelect.value === 'favorites') {
      sourceTypeSelect.value = previousSourceType || 'custom';
      syncSourceFields();
      openFavoriteMealModal(form);
      return;
    }
    previousSourceType = sourceTypeSelect.value;
    syncSourceFields();
  });

  form.querySelector('[data-add-custom-side]')?.addEventListener('click', () => {
    const list = form.querySelector('[data-custom-sides-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', customSideRow());
  });

  form.addEventListener('click', event => {
    const removeButton = event.target.closest('[data-remove-custom-side]');
    if (!removeButton) return;
    const rows = [...form.querySelectorAll('[data-custom-side-row]')];
    if (rows.length <= 1) {
      const row = removeButton.closest('[data-custom-side-row]');
      row.querySelector('[name="sideQuantity"]').value = '';
      row.querySelector('[name="sideName"]').value = '';
      return;
    }
    removeButton.closest('[data-custom-side-row]')?.remove();
  });
  timeInput.addEventListener('input', () => {
    manualTime = true;
  });
  mealTypeSelect.addEventListener('change', () => {
    if (!manualTime) timeInput.value = getDefaultMealTime(mealTypeSelect.value);
  });

  modal.querySelectorAll('[data-close-meal-modal], [data-cancel-meal-form]').forEach(button => {
    button.addEventListener('click', close);
  });

  modal.addEventListener('pointerdown', event => {
    if (event.target === modal) close();
  });

  const escapeHandler = event => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', escapeHandler, { once: true });
  modal.dataset.escapeBound = '1';

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withSaveFeedback(formElement, async () => {
      const data = Object.fromEntries(new FormData(formElement));
      const customSides = readCustomSides(formElement);
      const customName = data.sourceType === 'custom'
        ? String(data.customName || '').trim() || buildCustomMealName(data.customProtein, customSides)
        : data.sourceType === 'leftovers'
          ? String(data.leftoversName || '').trim() || 'Leftovers'
          : '';
      const body = {
        date: data.date,
        mealType: data.mealType,
        time: data.time || getDefaultMealTime(data.mealType),
        sourceType: data.sourceType === 'favorites' ? 'custom' : data.sourceType,
        sourceId: data.sourceType === 'recipe' ? data.recipeId : data.sourceType === 'restaurant' ? data.restaurantId : null,
        customName,
        customProtein: data.sourceType === 'custom' ? data.customProtein : '',
        customSides: data.sourceType === 'custom' ? customSides : [],
        status: data.status,
        notes: data.notes
      };

      await api('/api/planner/slot', { method: 'PUT', body });
      if (data.sourceType === 'custom' && data.saveCustomFavorite === 'on') {
        await api('/api/custom-meal-favorites', {
          method: 'POST',
          body: {
            name: customName,
            protein: data.customProtein || '',
            sides: customSides,
            mealType: data.mealType,
            notes: data.notes || ''
          }
        });
        await loadCustomMealFavorites();
      }
      if (data.planId && data.originalMealType && data.originalMealType !== data.mealType) {
        await api(`/api/planner/${data.planId}`, { method: 'DELETE' });
      }
      await Promise.all([loadPlanner(), loadHistory(), loadStats(), loadRecipes(), loadRestaurants(), loadCustomMealFavorites()]);
      closeCalendarMealModal(true);
      renderPlanner();
    }, 'Meal saved.');
  });

  syncSourceFields();
  setTimeout(() => mealTypeSelect.focus(), 180);
}

function closeCalendarMealModal(removeImmediately = false) {
  const modal = document.querySelector('#meal-time-modal');
  if (!modal) {
    document.body.classList.remove('modal-open');
    return;
  }
  if (removeImmediately) {
    modal.remove();
    document.body.classList.remove('modal-open');
    return;
  }
  modal.classList.remove('open');
  modal.classList.add('closing');
  setTimeout(() => {
    modal.remove();
    document.body.classList.remove('modal-open');
  }, 180);
}

function calendarMealForm(date, plan = null) {
  const sourceType = plan?.sourceType || 'custom';
  const selectedRecipeId = sourceType === 'recipe' ? String(plan?.sourceId || '') : '';
  const selectedRestaurantId = sourceType === 'restaurant' ? String(plan?.sourceId || '') : '';
  const selectedLeftoversName = sourceType === 'leftovers' ? (plan?.customName || 'Leftovers') : '';
  const selectedMealType = plan?.mealType || 'dinner';
  const selectedTime = plan?.time || getDefaultMealTime(selectedMealType);
  const customSides = Array.isArray(plan?.customSides) && plan.customSides.length ? plan.customSides : [{ quantity: '', name: '' }];

  return `
    <form class="slot-form calendar-meal-form">
      <input type="hidden" name="date" value="${date}" />
      <input type="hidden" name="planId" value="${escapeAttr(plan?._id || '')}" />
      <input type="hidden" name="originalMealType" value="${escapeAttr(plan?.mealType || '')}" />
      <div class="form-grid compact-form-grid">
        <label>Meal Label
          <select name="mealType">
            ${mealTypes.map(type => option(type, titleCase(type), selectedMealType)).join('')}
          </select>
        </label>
        <label>Time
          <input name="time" type="time" value="${escapeAttr(selectedTime)}" />
        </label>
        <label class="wide">Meal Source
          <select name="sourceType">
            ${option('custom', 'Custom', sourceType)}
            ${option('leftovers', 'Leftovers', sourceType)}
            ${option('recipe', 'Recipe', sourceType)}
            ${option('restaurant', 'Restaurant', sourceType)}
            <option value="favorites">Favorites</option>
          </select>
        </label>
      </div>
      <div class="source-field-expander ${sourceType === 'recipe' ? 'open' : ''}" data-source-field="recipe">
        <div class="source-field-inner">
          <select name="recipeId" data-recipe-select>
            <option value="">Select recipe</option>
            ${state.recipes.map(recipe => option(recipe._id, recipe.name, selectedRecipeId)).join('')}
          </select>
        </div>
      </div>
      <div class="source-field-expander ${sourceType === 'restaurant' ? 'open' : ''}" data-source-field="restaurant">
        <div class="source-field-inner">
          <select name="restaurantId" data-restaurant-select>
            <option value="">Select restaurant</option>
            ${state.restaurants.map(restaurant => option(restaurant._id, restaurant.name, selectedRestaurantId)).join('')}
          </select>
        </div>
      </div>
      <div class="source-field-expander ${sourceType === 'leftovers' ? 'open' : ''}" data-source-field="leftovers">
        <div class="source-field-inner custom-meal-fields">
          <input name="leftoversName" placeholder="Leftovers description" value="${escapeAttr(selectedLeftoversName)}" />
        </div>
      </div>
      <div class="source-field-expander ${sourceType === 'custom' ? 'open' : ''}" data-source-field="custom">
        <div class="source-field-inner custom-meal-fields">
          <input name="customName" data-custom-input placeholder="Custom meal name" value="${escapeAttr(plan?.customName || '')}" />
          <input name="customProtein" placeholder="Protein" value="${escapeAttr(plan?.customProtein || '')}" />
          <div class="custom-side-section">
            <div class="custom-side-header">
              <span>Sides</span>
              <button class="small-btn" type="button" data-add-custom-side>+ Side</button>
            </div>
            <div class="custom-side-list" data-custom-sides-list>
              ${customSides.map(side => customSideRow(side)).join('')}
            </div>
          </div>
          <label class="checkbox-line custom-favorite-toggle">
            <input type="checkbox" name="saveCustomFavorite" /> Save Custom Meal To Favorites
          </label>
        </div>
      </div>
      <label>Status
        <select name="status">
          ${option('planned', 'Planned', plan?.status || 'planned')}
          ${option('eaten', 'Eaten', plan?.status || 'planned')}
          ${option('skipped', 'Skipped', plan?.status || 'planned')}
        </select>
      </label>
      <textarea name="notes" placeholder="Notes">${escapeHtml(plan?.notes || '')}</textarea>
      <div class="action-row modal-actions">
        <button class="primary" type="submit">Save Meal</button>
        <button class="ghost" type="button" data-cancel-meal-form>Cancel</button>
      </div>
    </form>
  `;
}

function customSideRow(side = {}) {
  return `
    <div class="custom-side-row" data-custom-side-row>
      <input name="sideName" placeholder="Side" value="${escapeAttr(side.name || '')}" aria-label="Side name" />
      <button class="small-btn custom-side-remove" type="button" data-remove-custom-side aria-label="Remove side">×</button>
    </div>
  `;
}

function readCustomSides(form) {
  const names = [...form.querySelectorAll('[name="sideName"]')].map(input => input.value.trim());
  return names
    .map(name => ({ name, quantity: '' }))
    .filter(side => side.name);
}

function buildCustomMealName(protein, sides = []) {
  const parts = [String(protein || '').trim(), ...sides.map(side => side.name)].filter(Boolean);
  return parts.join(' + ') || 'Custom meal';
}

function customMealDetailsMarkup(plan) {
  if (!plan || plan.sourceType !== 'custom') return '';
  const details = [];
  if (plan.customProtein) details.push(`Protein: ${escapeHtml(plan.customProtein)}`);
  if (Array.isArray(plan.customSides) && plan.customSides.length) {
    const sides = plan.customSides.map(side => escapeHtml(side.name)).join(', ');
    const sideLabel = plan.customSides.length === 1 ? 'Side' : 'Sides';
    details.push(`${sideLabel}: ${sides}`);
  }
  return details.length ? `<p class="custom-meal-details">${details.join(' · ')}</p>` : '';
}

function getFavoriteMealOptions() {
  const favoriteRecipes = state.recipes
    .filter(recipe => recipe.favorite)
    .map(recipe => ({ type: 'recipe', id: recipe._id, name: recipe.name, meta: [recipe.cuisine, 'Recipe'].filter(Boolean).join(' · ') }));
  const customFavorites = state.customMealFavorites
    .map(meal => ({
      type: 'custom',
      id: meal._id,
      name: meal.name,
      meta: ['Custom', meal.protein ? `Protein: ${meal.protein}` : ''].filter(Boolean).join(' · '),
      protein: meal.protein || '',
      sides: Array.isArray(meal.sides) ? meal.sides : []
    }));
  return [...customFavorites, ...favoriteRecipes].sort((a, b) => a.name.localeCompare(b.name));
}

function openFavoriteMealModal(form) {
  closeFavoriteMealModal(true);
  const favorites = getFavoriteMealOptions();
  const modal = document.createElement('div');
  modal.className = 'favorite-meal-modal-overlay';
  modal.id = 'favorite-meal-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Choose a favorite meal');
  modal.innerHTML = `
    <div class="favorite-meal-modal-card">
      <header class="time-modal-header">
        <div>
          <h3>Favorite Meals</h3>
          <p class="muted">Choose a saved favorite to fill this meal.</p>
        </div>
        <button class="small-btn modal-close-btn" type="button" data-close-favorite-modal aria-label="Close favorite meals">×</button>
      </header>
      <div class="favorite-meal-list">
        ${favorites.length ? favorites.map(favorite => `
          <button class="favorite-meal-option" type="button" data-favorite-type="${favorite.type}" data-favorite-id="${favorite.id}">
            <strong>${escapeHtml(favorite.name)}</strong>
            <span>${escapeHtml(favorite.meta || titleCase(favorite.type))}</span>
          </button>
        `).join('') : '<div class="empty compact">No favorite recipes or custom meals saved yet.</div>'}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('open'));

  modal.querySelectorAll('[data-close-favorite-modal]').forEach(button => {
    button.addEventListener('click', () => closeFavoriteMealModal());
  });

  modal.addEventListener('pointerdown', event => {
    if (event.target === modal) closeFavoriteMealModal();
  });

  modal.querySelectorAll('[data-favorite-type]').forEach(button => {
    button.addEventListener('click', () => {
      const favorite = favorites.find(item => item.type === button.dataset.favoriteType && String(item.id) === String(button.dataset.favoriteId));
      if (!favorite) return;
      applyFavoriteMealToForm(form, favorite);
      closeFavoriteMealModal();
    });
  });
}

function closeFavoriteMealModal(removeImmediately = false) {
  const modal = document.querySelector('#favorite-meal-modal');
  if (!modal) return;
  if (removeImmediately) {
    modal.remove();
    return;
  }
  modal.classList.remove('open');
  setTimeout(() => modal.remove(), 160);
}

function applyFavoriteMealToForm(form, favorite) {
  const sourceSelect = form.querySelector('[name="sourceType"]');
  if (!sourceSelect) return;
  sourceSelect.value = favorite.type;
  form.querySelectorAll('[data-source-field]').forEach(field => {
    field.classList.toggle('open', field.dataset.sourceField === favorite.type);
  });

  if (favorite.type === 'recipe') {
    const select = form.querySelector('[name="recipeId"]');
    if (select) select.value = favorite.id;
  }


  if (favorite.type === 'custom') {
    const customName = form.querySelector('[name="customName"]');
    const customProtein = form.querySelector('[name="customProtein"]');
    const sideList = form.querySelector('[data-custom-sides-list]');
    if (customName) customName.value = favorite.name || '';
    if (customProtein) customProtein.value = favorite.protein || '';
    if (sideList) {
      const sides = favorite.sides?.length ? favorite.sides : [{ quantity: '', name: '' }];
      sideList.innerHTML = sides.map(side => customSideRow(side)).join('');
    }
  }
}

function plannerMealItem(plan) {
  const isMenuOpen = String(state.openPlannerMealMenuId) === String(plan._id);
  return `
    <article class="calendar-meal" data-plan-item="${plan._id}">
      <div class="calendar-meal-top">
        <div class="calendar-meal-main">
          <div class="badge-row">
            <span class="badge accent">${escapeHtml(plan.mealType)}</span>
            ${plan.time ? `<span class="badge">${formatMealTime(plan.time)}</span>` : ''}
          </div>
          <div class="calendar-meal-name-row">
            <strong>${escapeHtml(getPlanName(plan))}</strong>
            <label class="meal-eaten-toggle" title="Mark meal eaten">
              <input type="checkbox" data-toggle-plan-eaten="${plan._id}" ${plan.status === 'eaten' ? 'checked' : ''} />
              <span>${plan.status === 'eaten' ? '✓' : ''}</span>
            </label>
          </div>
          ${customMealDetailsMarkup(plan)}
          ${plan.notes ? `<p class="muted">${escapeHtml(plan.notes)}</p>` : ''}
        </div>
        <div class="meal-menu-wrap">
          <button class="meal-kebab-btn" type="button" data-plan-menu="${plan._id}" aria-label="Meal actions" aria-expanded="${isMenuOpen ? 'true' : 'false'}">
            <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
          </button>
          <div class="meal-action-menu ${isMenuOpen ? 'open' : ''}">
            <button type="button" data-edit-plan="${plan._id}">Edit</button>
            <button class="danger-menu-item" type="button" data-delete-plan="${plan._id}">Delete</button>
          </div>
        </div>
      </div>
      ${plan.status === 'skipped' ? `<div class="calendar-meal-actions">${plannerStatusMarkup(plan.status)}</div>` : ''}
    </article>
  `;
}

function syncRecipeCookbookToolbar() {
  const select = $('#recipe-cookbook-select');
  if (!select) return;

  const options = [
    '<option value="all">Cookbooks</option>',
    ...state.cookbooks.map(cookbook => `<option value="${escapeAttr(cookbook._id)}">${escapeHtml(cookbook.name)}</option>`)
  ];
  select.innerHTML = options.join('');
  select.value = state.activeRecipeCookbookId;
  if (!select.value) {
    state.activeRecipeCookbookId = 'all';
    select.value = 'all';
  }
}

function getActiveRecipeCookbook() {
  if (state.activeRecipeCookbookId === 'all') return null;
  return state.cookbooks.find(cookbook => String(cookbook._id) === String(state.activeRecipeCookbookId)) || null;
}

function getVisibleMobileRecipes() {
  const activeCookbook = getActiveRecipeCookbook();
  const cookbookRecipeIds = activeCookbook
    ? new Set((activeCookbook.recipeIds || []).map(recipeId => String(recipeId)))
    : null;
  const query = String(state.recipeSearch || '').trim().toLowerCase();

  const recipes = state.recipes.filter(recipe => {
    if (cookbookRecipeIds && !cookbookRecipeIds.has(String(recipe._id))) return false;
    if (!query) return true;
    const searchable = [
      recipe.name,
      recipe.cuisine,
      ...(recipe.mealTypes || []),
      ...(recipe.tags || []),
      ...(recipe.ingredients || []).map(ingredient => ingredient.name)
    ].join(' ').toLowerCase();
    return searchable.includes(query);
  });

  return recipes.sort((a, b) => {
    if (state.recipeSort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''));
    if (state.recipeSort === 'rating-desc') return (Number(b.rating) || 0) - (Number(a.rating) || 0) || String(a.name || '').localeCompare(String(b.name || ''));
    if (state.recipeSort === 'cooked-desc') return (Number(b.timesCooked) || 0) - (Number(a.timesCooked) || 0) || String(a.name || '').localeCompare(String(b.name || ''));
    if (state.recipeSort === 'newest') return new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function mobileRecipeActionMenuPanel(recipe, { includeScan = false } = {}) {
  const recipeId = String(recipe._id);
  return `
    <div class="mobile-recipe-action-menu" role="menu">
      <button type="button" role="menuitem" data-toggle-recipe-favorite="${escapeAttr(recipeId)}">
        <i class="ti ${recipe.favorite ? 'ti-heart-off' : 'ti-heart'}" aria-hidden="true"></i>
        <span>${recipe.favorite ? 'Remove Favorite' : 'Favorite'}</span>
      </button>
      <button type="button" role="menuitem" data-move-recipe="${escapeAttr(recipeId)}">
        <i class="ti ti-books" aria-hidden="true"></i>
        <span>Move To Cookbook</span>
      </button>
      <button type="button" role="menuitem" data-add-recipe-tags="${escapeAttr(recipeId)}">
        <i class="ti ti-tags" aria-hidden="true"></i>
        <span>Add Tags</span>
      </button>
      ${includeScan && recipe.originalScan ? `
        <button type="button" role="menuitem" data-view-recipe-scan="${escapeAttr(recipeId)}">
          <i class="ti ti-photo" aria-hidden="true"></i>
          <span>View Scan</span>
        </button>
      ` : ''}
      <button class="danger-menu-item" type="button" role="menuitem" data-delete-mobile-recipe="${escapeAttr(recipeId)}">
        <i class="ti ti-trash" aria-hidden="true"></i>
        <span>Delete</span>
      </button>
    </div>
  `;
}

function mobileRecipeActionMenu(recipe, { detail = false, desktop = false } = {}) {
  const recipeId = String(recipe._id);
  const isMenuOpen = state.openMobileRecipeMenuId === recipeId;

  return `
    <div class="mobile-recipe-menu-wrap${detail ? ' mobile-recipe-detail-menu-wrap' : ''}${desktop ? ' desktop-recipe-menu-wrap' : ''}">
      <button class="mobile-recipe-kebab-btn" type="button" data-mobile-recipe-menu="${escapeAttr(recipeId)}" ${desktop ? 'data-recipe-menu-context="desktop"' : ''} aria-label="Recipe actions for ${escapeAttr(recipe.name)}" aria-expanded="${isMenuOpen ? 'true' : 'false'}">
        <i class="ti ti-dots-vertical" aria-hidden="true"></i>
      </button>
      ${isMenuOpen ? mobileRecipeActionMenuPanel(recipe, { includeScan: desktop }) : ''}
    </div>
  `;
}

function mobileRecipeCard(recipe) {
  const mealTypes = (recipe.mealTypes || []).slice(0, 2);
  const ingredientPreview = (recipe.ingredients || []).slice(0, 3).map(item => item.name).filter(Boolean);
  const recipeId = String(recipe._id);

  return `
    <article class="mobile-recipe-card" data-open-mobile-recipe="${escapeAttr(recipeId)}" role="button" tabindex="0" aria-label="Open ${escapeAttr(recipe.name)} recipe">
      <div class="mobile-recipe-card-top">
        <div class="mobile-recipe-card-title-wrap">
          <h3>${escapeHtml(recipe.name)}</h3>
          ${recipe.favorite ? '<span class="mobile-recipe-favorite" title="Favorite" aria-label="Favorite recipe"><i class="ti ti-heart-filled"></i></span>' : ''}
        </div>
        ${mobileRecipeActionMenu(recipe)}
      </div>
      <div class="mobile-recipe-card-badges">
        ${mealTypes.map(type => `<span class="badge accent">${escapeHtml(type)}</span>`).join('')}
        ${recipe.cuisine ? `<span class="badge">${escapeHtml(recipe.cuisine)}</span>` : ''}
      </div>
      <p class="mobile-recipe-card-time">${formatDurationMinutes(recipe.prepTime || 0)} prep · ${formatDurationMinutes(recipe.cookTime || 0)} cook</p>
      ${ingredientPreview.length ? `<p class="mobile-recipe-card-preview">${ingredientPreview.map(escapeHtml).join(', ')}${(recipe.ingredients || []).length > 3 ? '…' : ''}</p>` : '<p class="mobile-recipe-card-preview muted">No ingredients listed.</p>'}
    </article>
  `;
}

function desktopRecipeCard(recipe) {
  const primaryMealType = (recipe.mealTypes || [])[0];
  const ingredientPreview = (recipe.ingredients || [])
    .slice(0, 4)
    .map(formatRecipeIngredient)
    .filter(Boolean)
    .join(', ');

  return `
    <article class="desktop-recipe-card">
      <div class="desktop-recipe-card-top">
        <h3>${escapeHtml(recipe.name)}</h3>
        ${mobileRecipeActionMenu(recipe, { desktop: true })}
      </div>
      <div class="desktop-recipe-card-body">
        <div class="desktop-recipe-card-badges">
          ${primaryMealType ? `<span class="badge accent">${escapeHtml(primaryMealType)}</span>` : ''}
          ${recipe.favorite ? '<span class="desktop-recipe-favorite" title="Favorite recipe" aria-label="Favorite recipe"><i class="ti ti-heart-filled"></i></span>' : ''}
        </div>
        <p class="desktop-recipe-card-time">${formatDurationMinutes(recipe.prepTime || 0)} prep · ${formatDurationMinutes(recipe.cookTime || 0)} cook</p>
        <p class="desktop-recipe-card-preview${ingredientPreview ? '' : ' muted'}">${ingredientPreview ? escapeHtml(ingredientPreview) : 'No ingredients listed.'}</p>
      </div>
    </article>
  `;
}

function formatRecipeIngredient(recipeIngredient) {
  const quantity = String(recipeIngredient?.quantity || '').trim();
  const unit = String(recipeIngredient?.unit || '').trim();
  const name = String(recipeIngredient?.name || '').trim();
  return [quantity, unit, name].filter(Boolean).join(' ') || 'Unnamed ingredient';
}

function mobileRecipeDetailPage(recipe) {
  const instructions = String(recipe.instructions || '').trim();
  const tags = (recipe.tags || []).filter(Boolean);
  const ingredients = (recipe.ingredients || []).filter(ingredient => ingredient?.name || ingredient?.quantity || ingredient?.unit);

  return `
    <section class="mobile-recipe-detail-page" data-mobile-recipe-detail="${escapeAttr(recipe._id)}">
      <button class="mobile-recipe-detail-back" id="mobile-recipe-detail-back" type="button">
        <i class="ti ti-chevron-left" aria-hidden="true"></i>
        <span>Cookbooks</span>
      </button>

      <article class="mobile-recipe-detail-card">
        <header class="mobile-recipe-detail-header">
          <div>
            <div class="mobile-recipe-detail-title-row">
              <h2>${escapeHtml(recipe.name)}</h2>
              ${recipe.favorite ? '<span class="mobile-recipe-detail-favorite" title="Favorite"><i class="ti ti-heart-filled"></i></span>' : ''}
            </div>
            <div class="mobile-recipe-detail-badges">
              ${(recipe.mealTypes || []).map(type => `<span class="badge accent">${escapeHtml(type)}</span>`).join('')}
              ${recipe.cuisine ? `<span class="badge">${escapeHtml(recipe.cuisine)}</span>` : ''}
              ${recipe.difficulty ? `<span class="badge">${escapeHtml(recipe.difficulty)}</span>` : ''}
            </div>
          </div>
          ${mobileRecipeActionMenu(recipe, { detail: true })}
        </header>

        ${recipe.originalScan ? `<button class="secondary small-btn mobile-recipe-view-scan" type="button" data-view-recipe-scan="${escapeAttr(recipe._id)}"><i class="ti ti-photo"></i>View Scan</button>` : ''}

        <div class="mobile-recipe-detail-stats" aria-label="Recipe timing and rating">
          <div><span>Prep</span><strong>${escapeHtml(formatDurationMinutes(recipe.prepTime || 0))}</strong></div>
          <div><span>Cook</span><strong>${escapeHtml(formatDurationMinutes(recipe.cookTime || 0))}</strong></div>
          <div><span>Rating</span><strong>${starRating(recipe.rating || 0)}</strong></div>
        </div>

        ${tags.length ? `<div class="mobile-recipe-detail-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}

        <section class="mobile-recipe-detail-section">
          <h3>Ingredients</h3>
          ${ingredients.length ? `
            <ul class="mobile-recipe-ingredient-list">
              ${ingredients.map(ingredient => `<li>${escapeHtml(formatRecipeIngredient(ingredient))}</li>`).join('')}
            </ul>
          ` : '<p class="muted">No ingredients listed.</p>'}
        </section>

        <section class="mobile-recipe-detail-section">
          <h3>Instructions</h3>
          ${instructions ? `<div class="mobile-recipe-instructions">${escapeHtml(instructions).replace(/\n/g, '<br>')}</div>` : '<p class="muted">No instructions listed.</p>'}
        </section>
      </article>
    </section>
  `;
}

function openMobileRecipeDetail(recipeId) {
  const recipe = state.recipes.find(item => String(item._id) === String(recipeId));
  if (!recipe) return;
  state.mobileRecipeDetailId = String(recipe._id);
  state.openMobileRecipeMenuId = '';
  updateRecipeMobileToolbarVisibility();
  renderRecipes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeMobileRecipeDetail() {
  state.mobileRecipeDetailId = '';
  state.openMobileRecipeMenuId = '';
  updateRecipeMobileToolbarVisibility();
  renderRecipes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderMobileRecipeResults() {
  const grid = pageRoot.querySelector('.mobile-recipe-grid');
  const count = pageRoot.querySelector('[data-mobile-recipe-count]');
  if (!grid) return;

  const recipes = getVisibleMobileRecipes();
  const activeCookbook = getActiveRecipeCookbook();
  grid.innerHTML = recipes.length
    ? recipes.map(mobileRecipeCard).join('')
    : `<div class="mobile-recipe-empty"><i class="ti ti-books"></i><strong>No recipes found</strong><span>${activeCookbook ? `Add recipes to ${escapeHtml(activeCookbook.name)} or change the search.` : 'Import a recipe or change the search.'}</span></div>`;

  if (count) {
    const label = activeCookbook?.name || 'All recipes';
    count.textContent = `${label} · ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`;
  }
  bindRecipeListActions(grid);
}

function closeMobileRecipeActionMenus() {
  state.openMobileRecipeMenuId = '';
  document.querySelectorAll('.mobile-recipe-action-menu').forEach(menu => menu.remove());
  document.querySelectorAll('[data-mobile-recipe-menu]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function bindMobileRecipeActionItems(root) {
  root.querySelectorAll('[data-view-recipe-scan]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const recipe = state.recipes.find(item => String(item._id) === String(button.dataset.viewRecipeScan));
      openRecipeScan(recipe);
    });
  });

  root.querySelectorAll('[data-move-recipe], [data-organize-recipe]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const recipeId = button.dataset.moveRecipe || button.dataset.organizeRecipe;
      const recipe = state.recipes.find(item => String(item._id) === String(recipeId));
      closeMobileRecipeActionMenus();
      if (recipe) openRecipeCookbookAssignment(recipe);
    });
  });

  root.querySelectorAll('[data-add-recipe-tags]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const recipe = state.recipes.find(item => String(item._id) === String(button.dataset.addRecipeTags));
      closeMobileRecipeActionMenus();
      if (recipe) openRecipeTagsModal(recipe);
    });
  });

  root.querySelectorAll('[data-toggle-recipe-favorite]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const recipe = state.recipes.find(item => String(item._id) === String(button.dataset.toggleRecipeFavorite));
      if (!recipe) return;
      closeMobileRecipeActionMenus();
      await api(`/api/recipes/${recipe._id}/organize`, { method: 'PATCH', body: { favorite: !recipe.favorite } });
      await loadRecipes();
      renderRecipes();
      showToast(recipe.favorite ? 'Removed from favorites.' : 'Recipe favorited.');
    });
  });

  root.querySelectorAll('[data-delete-mobile-recipe]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const recipe = state.recipes.find(item => String(item._id) === String(button.dataset.deleteMobileRecipe));
      closeMobileRecipeActionMenus();
      if (recipe) openDeleteRecipeConfirmation(recipe);
    });
  });

  root.querySelectorAll('[data-delete-recipe]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const recipeId = button.dataset.deleteRecipe;
      await api(`/api/recipes/${recipeId}`, { method: 'DELETE' });
      await Promise.all([loadRecipes(), loadCookbooks(), loadPlanner(), loadStats()]);
      showToast('Recipe deleted.');
      renderRecipes();
    });
  });
}

function bindRecipeListActions(root = pageRoot) {
  root.querySelectorAll('[data-open-mobile-recipe]').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('button, a, input, select, textarea, .mobile-recipe-action-menu')) return;
      openMobileRecipeDetail(card.dataset.openMobileRecipe);
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openMobileRecipeDetail(card.dataset.openMobileRecipe);
    });
  });

  root.querySelectorAll('[data-mobile-recipe-menu]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const recipeId = String(button.dataset.mobileRecipeMenu || '');
      const recipe = state.recipes.find(item => String(item._id) === recipeId);
      const shouldOpen = state.openMobileRecipeMenuId !== recipeId;
      closeMobileRecipeActionMenus();
      if (!shouldOpen || !recipe) return;

      state.openMobileRecipeMenuId = recipeId;
      button.setAttribute('aria-expanded', 'true');
      const includeScan = button.dataset.recipeMenuContext === 'desktop';
      button.insertAdjacentHTML('afterend', mobileRecipeActionMenuPanel(recipe, { includeScan }));
      bindMobileRecipeActionItems(button.parentElement);
    });
  });

  bindMobileRecipeActionItems(root);
}

function openDeleteRecipeConfirmation(recipe) {
  closeMobileWebSidebarForModal();
  document.querySelector('.recipe-delete-confirm-overlay')?.remove();
  document.querySelectorAll('.mobile-recipe-action-menu').forEach(menu => menu.remove());
  document.querySelectorAll('[data-mobile-recipe-menu]').forEach(button => button.setAttribute('aria-expanded', 'false'));

  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay recipe-delete-confirm-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card recipe-delete-confirm-card" role="dialog" aria-modal="true" aria-labelledby="recipe-delete-confirm-title">
      <header class="time-modal-header">
        <div>
          <h3 id="recipe-delete-confirm-title">Delete Recipe?</h3>
          <p class="muted">This action cannot be undone.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-recipe-delete-confirm aria-label="Close delete confirmation">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <p class="recipe-delete-confirm-copy">Are you sure you want to delete <strong>${escapeHtml(recipe.name)}</strong>?</p>
          <div class="modal-actions action-row">
            <button class="secondary" type="button" data-close-recipe-delete-confirm>Cancel</button>
            <button class="danger" type="button" data-confirm-recipe-delete>Delete Recipe</button>
          </div>
        </div>
      </div>
    </article>
  `;

  let isDeleting = false;
  const close = () => {
    if (isDeleting) return;
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    window.setTimeout(() => overlay.remove(), 190);
  };

  overlay.querySelectorAll('[data-close-recipe-delete-confirm]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  overlay.querySelector('[data-confirm-recipe-delete]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    isDeleting = true;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      await api(`/api/recipes/${recipe._id}`, { method: 'DELETE' });
      state.openMobileRecipeMenuId = '';
      if (String(state.mobileRecipeDetailId) === String(recipe._id)) state.mobileRecipeDetailId = '';
      await Promise.all([loadRecipes(), loadCookbooks(), loadPlanner(), loadStats()]);
      overlay.remove();
      document.body.classList.remove('modal-open');
      renderRecipes();
      showToast('Recipe deleted.');
    } catch (error) {
      isDeleting = false;
      button.disabled = false;
      button.textContent = 'Delete Recipe';
      showToast(error.message || 'Could not delete recipe.');
    }
  });

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('[data-confirm-recipe-delete]')?.focus();
}

function openRecipeTagsModal(recipe) {
  closeMobileWebSidebarForModal();
  document.querySelector('.recipe-tags-overlay')?.remove();

  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay recipe-tags-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card recipe-tags-card" role="dialog" aria-modal="true" aria-labelledby="recipe-tags-title">
      <header class="time-modal-header">
        <div>
          <h3 id="recipe-tags-title">Add Tags</h3>
          <p class="muted">${escapeHtml(recipe.name)}</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-recipe-tags aria-label="Close tag editor">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <form id="recipe-tags-form">
            <label>Tags
              <input name="tags" type="text" value="${escapeAttr((recipe.tags || []).join(', '))}" placeholder="quick, family favorite, weeknight" autocomplete="off" />
            </label>
            <p class="muted recipe-tags-help">Separate tags with commas.</p>
            <div class="modal-actions action-row">
              <button class="secondary" type="button" data-close-recipe-tags>Cancel</button>
              <button class="primary" type="submit">Save Tags</button>
            </div>
          </form>
        </div>
      </div>
    </article>
  `;

  const close = () => {
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    window.setTimeout(() => overlay.remove(), 190);
  };

  overlay.querySelectorAll('[data-close-recipe-tags]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  overlay.querySelector('#recipe-tags-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const tags = String(new FormData(event.currentTarget).get('tags') || '').trim();
    await withSaveFeedback(event.currentTarget, async () => {
      await api(`/api/recipes/${recipe._id}/organize`, { method: 'PATCH', body: { tags } });
      await loadRecipes();
      state.openMobileRecipeMenuId = '';
      renderRecipes();
      close();
    }, 'Recipe tags updated.');
  });

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('input[name="tags"]')?.focus();
}
function sortedRecipeCookbooks() {
  return [...state.cookbooks].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
}

function desktopCookbookRecipes(cookbookId) {
  if (String(cookbookId) === 'all') return [...state.recipes];
  const cookbook = state.cookbooks.find(item => String(item._id) === String(cookbookId));
  if (!cookbook) return [];
  const recipeIds = new Set((cookbook.recipeIds || []).map(String));
  return state.recipes.filter(recipe => recipeIds.has(String(recipe._id)));
}

function desktopCookbookCard(cookbook, { system = false } = {}) {
  const cookbookId = system ? 'all' : String(cookbook._id);
  const recipes = system ? state.recipes : desktopCookbookRecipes(cookbookId);
  const previewNames = recipes
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
    .slice(0, 3)
    .map(recipe => recipe.name);
  return `
    <button class="desktop-cookbook-card" type="button" data-open-desktop-cookbook="${escapeAttr(cookbookId)}" aria-label="Open ${escapeAttr(cookbook.name)} cookbook">
      <span class="desktop-cookbook-card-icon"><i class="ti ${system ? 'ti-books' : 'ti-book-2'}" aria-hidden="true"></i></span>
      <span class="desktop-cookbook-card-copy">
        <strong>${escapeHtml(cookbook.name)}</strong>
        <small>${recipes.length} recipe${recipes.length === 1 ? '' : 's'}</small>
        <span class="desktop-cookbook-preview${previewNames.length ? '' : ' muted'}">${previewNames.length ? previewNames.map(escapeHtml).join(' · ') : 'No recipes added yet.'}</span>
      </span>
      <i class="ti ti-chevron-right desktop-cookbook-card-arrow" aria-hidden="true"></i>
    </button>
  `;
}

function desktopCookbookIndex() {
  const cookbooks = sortedRecipeCookbooks();
  return `
    <section class="desktop-recipes-index" aria-label="Recipe cookbooks">
      <div class="desktop-recipes-primary-action">
        <button class="primary" id="desktop-open-add-recipe" type="button"><i class="ti ti-plus"></i>Add Recipe</button>
      </div>
      <div class="desktop-cookbook-grid">
        <button class="desktop-cookbook-card desktop-cookbook-add-card" id="desktop-add-cookbook" type="button">
          <span class="desktop-cookbook-add-icon"><i class="ti ti-plus" aria-hidden="true"></i></span>
          <span>
            <strong>Add Cookbook</strong>
            <small>Create a new recipe collection</small>
          </span>
        </button>
        ${desktopCookbookCard({ name: 'All Recipes' }, { system: true })}
        ${cookbooks.map(cookbook => desktopCookbookCard(cookbook)).join('')}
      </div>
    </section>
  `;
}

function desktopCookbookDetail(cookbookId) {
  const isAllRecipes = String(cookbookId) === 'all';
  const cookbook = isAllRecipes
    ? { _id: 'all', name: 'All Recipes', recipeIds: state.recipes.map(recipe => recipe._id) }
    : state.cookbooks.find(item => String(item._id) === String(cookbookId));

  if (!cookbook) {
    state.desktopRecipeCookbookId = '';
    return desktopCookbookIndex();
  }

  const recipes = desktopCookbookRecipes(cookbook._id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

  return `
    <section class="desktop-cookbook-detail" data-desktop-cookbook-detail="${escapeAttr(cookbook._id)}">
      <button class="secondary desktop-cookbook-back" id="desktop-cookbook-back" type="button"><i class="ti ti-arrow-left"></i>Cookbooks</button>
      <header class="desktop-cookbook-detail-header">
        <div>
          <p class="desktop-cookbook-eyebrow">Cookbook</p>
          <h2>${escapeHtml(cookbook.name)}</h2>
          <p class="muted">${recipes.length} recipe${recipes.length === 1 ? '' : 's'}</p>
        </div>
        <div class="desktop-cookbook-detail-actions">
          <button class="primary" id="desktop-add-recipe-to-cookbook" type="button"><i class="ti ti-plus"></i>Add Recipe</button>
          ${isAllRecipes ? '' : `
            <button class="secondary" id="desktop-edit-cookbook-name" type="button"><i class="ti ti-pencil"></i>Edit Name</button>
            <button class="secondary" id="desktop-edit-cookbook-recipes" type="button"><i class="ti ti-list-check"></i>Edit Recipes</button>
          `}
        </div>
      </header>
      <div class="desktop-recipe-library-meta">${escapeHtml(cookbook.name)} · ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}</div>
      <div class="desktop-recipe-grid desktop-cookbook-recipe-grid">
        ${recipes.length ? recipes.map(desktopRecipeCard).join('') : '<div class="empty desktop-recipe-empty">This cookbook is empty. Add a new recipe or use Edit Recipes to add saved recipes.</div>'}
      </div>
    </section>
  `;
}

function closeDesktopRecipeOverlay(overlay) {
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.classList.add('closing');
  window.setTimeout(() => {
    overlay.remove();
    if (!document.querySelector('.time-modal-overlay.open')) document.body.classList.remove('modal-open');
  }, 180);
}

async function addRecipeToCookbook(cookbookId, recipeId) {
  if (!cookbookId || String(cookbookId) === 'all') return;
  const cookbook = state.cookbooks.find(item => String(item._id) === String(cookbookId));
  if (!cookbook) return;
  const recipeIds = [...new Set([...(cookbook.recipeIds || []).map(String), String(recipeId)])];
  await api(`/api/cookbooks/${cookbook._id}`, { method: 'PUT', body: { recipeIds } });
}

function openDesktopRecipeModal({ cookbookId = '' } = {}) {
  closeMobileWebSidebarForModal();
  document.querySelector('.desktop-recipe-editor-overlay')?.remove();
  const cookbooks = sortedRecipeCookbooks();
  const selectedCookbookId = cookbooks.some(cookbook => String(cookbook._id) === String(cookbookId)) ? String(cookbookId) : '';

  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay desktop-recipe-editor-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card desktop-recipe-editor-card" role="dialog" aria-modal="true" aria-labelledby="desktop-recipe-editor-title">
      <header class="time-modal-header">
        <div>
          <h3 id="desktop-recipe-editor-title">Add Recipe</h3>
          <p class="muted">Create a recipe manually or switch this window to the recipe importer.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-desktop-recipe-editor aria-label="Close add recipe">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <div class="desktop-recipe-modal-switch-row">
            <button class="secondary" id="desktop-switch-to-import" type="button"><i class="ti ti-camera"></i>Import Recipe</button>
          </div>
          <form id="desktop-recipe-form" class="calendar-meal-form desktop-recipe-form">
            <div class="form-grid">
              <label>Name<input name="name" required placeholder="Smoked paprika chicken" /></label>
              <label>Cuisine<input name="cuisine" placeholder="American, Mexican, Italian" /></label>
              <label>Meal Types<input name="mealTypes" placeholder="dinner, lunch" /></label>
              <label>Tags<input name="tags" placeholder="quick, cheap, healthy" /></label>
              <label>Prep Time
                <span class="duration-clock" aria-label="Prep time duration">
                  <input name="prepHours" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="00" aria-label="Prep time hours" />
                  <span class="duration-separator" aria-hidden="true">:</span>
                  <input name="prepMinutes" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="10" aria-label="Prep time minutes" />
                </span>
              </label>
              <label>Cook Time<input name="cookTime" type="number" min="0" value="25" /></label>
              <label>Difficulty<select name="difficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
              <label>Rating<select name="rating">${recipeRatingOptions()}</select></label>
              <label class="wide">Ingredients <span class="optional">one per line, or quantity | unit | name | category</span><textarea name="ingredientsText" placeholder="2 | lb | chicken thighs | Meat&#10;1 | tsp | smoked paprika | Pantry"></textarea></label>
              <label class="wide">Instructions<textarea name="instructions" placeholder="Cook steps"></textarea></label>
              <label class="wide">Cookbook
                <select name="cookbookId">
                  <option value="">No custom cookbook</option>
                  ${cookbooks.map(cookbook => `<option value="${escapeAttr(cookbook._id)}" ${String(cookbook._id) === selectedCookbookId ? 'selected' : ''}>${escapeHtml(cookbook.name)}</option>`).join('')}
                </select>
              </label>
              <label class="wide checkbox-line"><input type="checkbox" name="favorite" /> Favorite</label>
            </div>
            <div class="modal-actions action-row desktop-recipe-editor-actions">
              <button class="secondary" type="button" data-close-desktop-recipe-editor>Cancel</button>
              <button class="primary" type="submit">Save Recipe</button>
            </div>
          </form>
        </div>
      </div>
    </article>
  `;

  const close = () => closeDesktopRecipeOverlay(overlay);
  overlay.querySelectorAll('[data-close-desktop-recipe-editor]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  overlay.querySelector('#desktop-switch-to-import')?.addEventListener('click', () => openRecipeImportModal(overlay));
  overlay.querySelector('#desktop-recipe-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withSaveFeedback(formElement, async () => {
      const body = formToBody(formElement);
      const targetCookbookId = String(body.cookbookId || '');
      delete body.cookbookId;
      body.prepTime = durationInputsToMinutes(formElement, 'prep');
      delete body.prepHours;
      delete body.prepMinutes;
      body.favorite = getFormCheckboxChecked(formElement, 'favorite');
      const recipe = await api('/api/recipes', { method: 'POST', body });
      await addRecipeToCookbook(targetCookbookId, recipe._id);
      await Promise.all([loadRecipes(), loadCookbooks(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);
      close();
      renderRecipes();
    }, 'Recipe saved.');
  });

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('input[name="name"]')?.focus();
}

function openDesktopCreateCookbookModal() {
  closeMobileWebSidebarForModal();
  document.querySelector('.desktop-cookbook-create-overlay')?.remove();
  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay desktop-cookbook-create-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card desktop-cookbook-edit-card" role="dialog" aria-modal="true" aria-labelledby="desktop-cookbook-create-title">
      <header class="time-modal-header">
        <div>
          <h3 id="desktop-cookbook-create-title">Add Cookbook</h3>
          <p class="muted">Create a custom collection for your recipes.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-desktop-cookbook-create aria-label="Close add cookbook">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <form id="desktop-cookbook-create-form">
            <label>Cookbook Name<input name="name" maxlength="80" required placeholder="Weeknight Favorites" /></label>
            <div class="modal-actions action-row">
              <button class="secondary" type="button" data-close-desktop-cookbook-create>Cancel</button>
              <button class="primary" type="submit">Add Cookbook</button>
            </div>
          </form>
        </div>
      </div>
    </article>
  `;
  const close = () => closeDesktopRecipeOverlay(overlay);
  overlay.querySelectorAll('[data-close-desktop-cookbook-create]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  overlay.querySelector('#desktop-cookbook-create-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    await withSaveFeedback(form, async () => {
      const name = String(new FormData(form).get('name') || '').trim();
      const cookbook = await api('/api/cookbooks', { method: 'POST', body: { name } });
      await loadCookbooks();
      state.desktopRecipeCookbookId = String(cookbook._id);
      close();
      renderRecipes();
    }, 'Cookbook created.');
  });
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('input[name="name"]')?.focus();
}

function openDesktopEditCookbookNameModal(cookbook) {
  if (!cookbook) return;
  document.querySelector('.desktop-cookbook-name-overlay')?.remove();
  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay desktop-cookbook-name-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card desktop-cookbook-edit-card" role="dialog" aria-modal="true" aria-labelledby="desktop-cookbook-name-title">
      <header class="time-modal-header">
        <div>
          <h3 id="desktop-cookbook-name-title">Edit Cookbook Name</h3>
          <p class="muted">Rename this cookbook without changing its recipes.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-desktop-cookbook-name aria-label="Close cookbook name editor">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <form id="desktop-cookbook-name-form">
            <label>Cookbook Name<input name="name" maxlength="80" required value="${escapeAttr(cookbook.name)}" /></label>
            <div class="modal-actions action-row">
              <button class="secondary" type="button" data-close-desktop-cookbook-name>Cancel</button>
              <button class="primary" type="submit">Save Name</button>
            </div>
          </form>
        </div>
      </div>
    </article>
  `;
  const close = () => closeDesktopRecipeOverlay(overlay);
  overlay.querySelectorAll('[data-close-desktop-cookbook-name]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  overlay.querySelector('#desktop-cookbook-name-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    await withSaveFeedback(form, async () => {
      const name = String(new FormData(form).get('name') || '').trim();
      await api(`/api/cookbooks/${cookbook._id}`, { method: 'PUT', body: { name } });
      await loadCookbooks();
      close();
      renderRecipes();
    }, 'Cookbook renamed.');
  });
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  const input = overlay.querySelector('input[name="name"]');
  input?.focus();
  input?.select();
}

function openDesktopEditCookbookRecipesModal(cookbook) {
  if (!cookbook) return;
  document.querySelector('.desktop-cookbook-recipes-overlay')?.remove();
  const selectedRecipeIds = new Set((cookbook.recipeIds || []).map(String));
  const recipes = [...state.recipes].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay desktop-cookbook-recipes-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card desktop-cookbook-recipes-card" role="dialog" aria-modal="true" aria-labelledby="desktop-cookbook-recipes-title">
      <header class="time-modal-header">
        <div>
          <h3 id="desktop-cookbook-recipes-title">Edit Recipes</h3>
          <p class="muted">Choose which saved recipes belong in ${escapeHtml(cookbook.name)}.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-desktop-cookbook-recipes aria-label="Close recipe editor">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <form id="desktop-cookbook-recipes-form">
            <div class="desktop-cookbook-recipe-picker">
              ${recipes.length ? recipes.map(recipe => `
                <label class="desktop-cookbook-recipe-option">
                  <input type="checkbox" name="recipeIds" value="${escapeAttr(recipe._id)}" ${selectedRecipeIds.has(String(recipe._id)) ? 'checked' : ''} />
                  <span>
                    <strong>${escapeHtml(recipe.name)}</strong>
                    <small>${escapeHtml((recipe.mealTypes || [])[0] ? titleCase(recipe.mealTypes[0]) : 'Recipe')}${recipe.cuisine ? ` · ${escapeHtml(recipe.cuisine)}` : ''}</small>
                  </span>
                </label>
              `).join('') : '<div class="empty">No saved recipes yet. Add a recipe first.</div>'}
            </div>
            <div class="modal-actions action-row">
              <button class="secondary" type="button" data-close-desktop-cookbook-recipes>Cancel</button>
              <button class="primary" type="submit">Save Recipes</button>
            </div>
          </form>
        </div>
      </div>
    </article>
  `;
  const close = () => closeDesktopRecipeOverlay(overlay);
  overlay.querySelectorAll('[data-close-desktop-cookbook-recipes]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  overlay.querySelector('#desktop-cookbook-recipes-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    await withSaveFeedback(form, async () => {
      const recipeIds = new FormData(form).getAll('recipeIds').map(String);
      await api(`/api/cookbooks/${cookbook._id}`, { method: 'PUT', body: { recipeIds } });
      await loadCookbooks();
      close();
      renderRecipes();
    }, 'Cookbook recipes updated.');
  });
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function bindDesktopRecipePage() {
  $('#desktop-open-add-recipe')?.addEventListener('click', () => openDesktopRecipeModal());
  $('#desktop-add-cookbook')?.addEventListener('click', openDesktopCreateCookbookModal);
  document.querySelectorAll('[data-open-desktop-cookbook]').forEach(button => {
    button.addEventListener('click', () => {
      state.desktopRecipeCookbookId = String(button.dataset.openDesktopCookbook || '');
      state.openMobileRecipeMenuId = '';
      renderRecipes();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  $('#desktop-cookbook-back')?.addEventListener('click', () => {
    state.desktopRecipeCookbookId = '';
    state.openMobileRecipeMenuId = '';
    renderRecipes();
  });

  const activeCookbook = state.cookbooks.find(cookbook => String(cookbook._id) === String(state.desktopRecipeCookbookId));
  $('#desktop-add-recipe-to-cookbook')?.addEventListener('click', () => openDesktopRecipeModal({ cookbookId: activeCookbook?._id || '' }));
  $('#desktop-edit-cookbook-name')?.addEventListener('click', () => openDesktopEditCookbookNameModal(activeCookbook));
  $('#desktop-edit-cookbook-recipes')?.addEventListener('click', () => openDesktopEditCookbookRecipesModal(activeCookbook));
}

function renderRecipes() {
  const visibleMobileRecipes = getVisibleMobileRecipes();
  let mobileRecipeDetail = state.mobileRecipeDetailId
    ? state.recipes.find(recipe => String(recipe._id) === String(state.mobileRecipeDetailId))
    : null;
  if (state.mobileRecipeDetailId && !mobileRecipeDetail) {
    state.mobileRecipeDetailId = '';
    mobileRecipeDetail = null;
  }
  updateRecipeMobileToolbarVisibility();
  pageRoot.innerHTML = `
    <section class="recipes-desktop-layout">
      ${state.desktopRecipeCookbookId ? desktopCookbookDetail(state.desktopRecipeCookbookId) : desktopCookbookIndex()}
    </section>

    <section class="recipes-mobile-layout" aria-label="${mobileRecipeDetail ? 'Recipe details' : 'Recipe cookbooks'}">
      ${mobileRecipeDetail ? mobileRecipeDetailPage(mobileRecipeDetail) : `
        <div class="mobile-recipe-search-sort">
          <label class="mobile-recipe-search">
            <i class="ti ti-search" aria-hidden="true"></i>
            <input id="mobile-recipe-search" type="search" value="${escapeAttr(state.recipeSearch)}" placeholder="Search recipes" aria-label="Search recipes" />
          </label>
          <label class="mobile-recipe-sort">
            <span class="visually-hidden">Sort recipes</span>
            <span class="mobile-recipe-sort-label" aria-hidden="true">Sort</span>
            <select id="mobile-recipe-sort" aria-label="Sort recipes">
              <option value="name-asc" ${state.recipeSort === 'name-asc' ? 'selected' : ''}>A–Z</option>
              <option value="name-desc" ${state.recipeSort === 'name-desc' ? 'selected' : ''}>Z–A</option>
              <option value="newest" ${state.recipeSort === 'newest' ? 'selected' : ''}>Newest</option>
              <option value="rating-desc" ${state.recipeSort === 'rating-desc' ? 'selected' : ''}>Rating</option>
              <option value="cooked-desc" ${state.recipeSort === 'cooked-desc' ? 'selected' : ''}>Most Cooked</option>
            </select>
            <i class="ti ti-arrows-sort" aria-hidden="true"></i>
          </label>
        </div>
        <button class="primary mobile-recipe-import-button" id="mobile-open-recipe-import" type="button"><i class="ti ti-camera"></i>Import Recipe</button>
        <div class="mobile-recipe-list-meta">
          <span data-mobile-recipe-count>${getActiveRecipeCookbook()?.name || 'All recipes'} · ${visibleMobileRecipes.length} recipe${visibleMobileRecipes.length === 1 ? '' : 's'}</span>
        </div>
        <div class="mobile-recipe-grid">
          ${visibleMobileRecipes.length ? visibleMobileRecipes.map(mobileRecipeCard).join('') : '<div class="mobile-recipe-empty"><i class="ti ti-books"></i><strong>No recipes found</strong><span>Import a recipe or change the search.</span></div>'}
        </div>
      `}
    </section>
  `;

  if (!mobileRecipeDetail) syncRecipeCookbookToolbar();
  $('#mobile-recipe-detail-back')?.addEventListener('click', closeMobileRecipeDetail);
  $('#mobile-open-recipe-import')?.addEventListener('click', openRecipeImportModal);

  $('#mobile-recipe-search')?.addEventListener('input', event => {
    state.recipeSearch = event.currentTarget.value;
    renderMobileRecipeResults();
  });

  $('#mobile-recipe-sort')?.addEventListener('change', event => {
    state.recipeSort = event.currentTarget.value;
    localStorage.setItem('mealPlannerRecipeSort', state.recipeSort);
    renderMobileRecipeResults();
  });

  bindDesktopRecipePage();
  bindRecipeListActions(pageRoot);
}

function openRecipeCookbookManager() {
  closeMobileWebSidebarForModal();
  document.querySelector('.cookbook-manager-overlay')?.remove();
  const lockedScrollY = window.scrollY;

  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay cookbook-manager-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card cookbook-manager-card" role="dialog" aria-modal="true" aria-labelledby="cookbook-manager-title">
      <header class="time-modal-header">
        <div>
          <h3 id="cookbook-manager-title">Manage Cookbooks</h3>
          <p class="muted">Create custom recipe groups and rename them at any time.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-cookbook-manager aria-label="Close cookbook manager">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <form class="cookbook-create-form" id="cookbook-create-form">
            <label>New Cookbook Name<input name="name" maxlength="80" required placeholder="Weeknight Favorites" /></label>
            <button class="primary" type="submit"><i class="ti ti-plus"></i>Create</button>
          </form>
          <div class="cookbook-manager-list" data-cookbook-manager-list></div>
        </div>
      </div>
    </article>
  `;

  const close = () => {
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('top');
    window.scrollTo(0, lockedScrollY);
    window.setTimeout(() => overlay.remove(), 190);
  };

  const renderList = () => {
    const list = overlay.querySelector('[data-cookbook-manager-list]');
    if (!list) return;
    list.innerHTML = state.cookbooks.length
      ? state.cookbooks.map(cookbook => `
          <div class="cookbook-manager-row" data-cookbook-row="${cookbook._id}">
            <label>
              <span class="visually-hidden">Cookbook name</span>
              <input data-cookbook-name="${cookbook._id}" maxlength="80" value="${escapeAttr(cookbook.name)}" />
            </label>
            <span class="cookbook-recipe-count">${(cookbook.recipeIds || []).length} recipe${(cookbook.recipeIds || []).length === 1 ? '' : 's'}</span>
            <button class="secondary small-btn" type="button" data-save-cookbook="${cookbook._id}" aria-label="Save ${escapeAttr(cookbook.name)}"><i class="ti ti-check"></i></button>
            <button class="danger small-btn" type="button" data-delete-cookbook="${cookbook._id}" aria-label="Delete ${escapeAttr(cookbook.name)}"><i class="ti ti-trash"></i></button>
          </div>
        `).join('')
      : '<div class="empty cookbook-manager-empty">Create your first cookbook to group recipes.</div>';

    const saveCookbookName = async row => {
      const button = row?.querySelector('[data-save-cookbook]');
      const input = row?.querySelector('[data-cookbook-name]');
      const cookbookId = String(row?.dataset.cookbookRow || '');
      const name = String(input?.value || '').trim();
      if (!cookbookId || !input || !button) return;
      if (!name) {
        input.focus();
        return showToast('Enter a cookbook name.');
      }

      const originalHtml = button.innerHTML;
      button.disabled = true;
      input.disabled = true;
      button.innerHTML = '<i class="ti ti-loader-2 cookbook-save-spinner" aria-hidden="true"></i>';
      try {
        await api(`/api/cookbooks/${cookbookId}`, { method: 'PUT', body: { name } });
        await loadCookbooks();
        syncRecipeCookbookToolbar();
        renderList();
        renderMobileRecipeResults();
        showToast('Cookbook renamed.');
      } catch (error) {
        button.disabled = false;
        input.disabled = false;
        button.innerHTML = originalHtml;
        input.focus();
        input.select();
        showToast(error.message || 'Could not rename cookbook.');
      }
    };

    list.querySelectorAll('[data-save-cookbook]').forEach(button => {
      button.addEventListener('click', () => saveCookbookName(button.closest('[data-cookbook-row]')));
    });

    list.querySelectorAll('[data-cookbook-name]').forEach(input => {
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        saveCookbookName(input.closest('[data-cookbook-row]'));
      });
    });

    list.querySelectorAll('[data-delete-cookbook]').forEach(button => {
      button.addEventListener('click', async () => {
        const cookbook = state.cookbooks.find(item => String(item._id) === String(button.dataset.deleteCookbook));
        if (!cookbook || !window.confirm(`Delete "${cookbook.name}"? Recipes will not be deleted.`)) return;
        await api(`/api/cookbooks/${cookbook._id}`, { method: 'DELETE' });
        if (String(state.activeRecipeCookbookId) === String(cookbook._id)) {
          state.activeRecipeCookbookId = 'all';
          localStorage.setItem('mealPlannerActiveCookbook', 'all');
        }
        await loadCookbooks();
        syncRecipeCookbookToolbar();
        renderList();
        renderMobileRecipeResults();
        showToast('Cookbook deleted.');
      });
    });
  };

  overlay.querySelector('[data-close-cookbook-manager]')?.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  overlay.querySelector('#cookbook-create-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) return;
    const cookbook = await api('/api/cookbooks', { method: 'POST', body: { name } });
    state.activeRecipeCookbookId = String(cookbook._id);
    localStorage.setItem('mealPlannerActiveCookbook', state.activeRecipeCookbookId);
    form.reset();
    await loadCookbooks();
    syncRecipeCookbookToolbar();
    renderList();
    renderMobileRecipeResults();
    showToast('Cookbook created.');
  });

  document.body.appendChild(overlay);
  document.body.style.setProperty('top', `-${lockedScrollY}px`, 'important');
  document.body.classList.add('modal-open');
  renderList();
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('input')?.focus();
}

function openRecipeCookbookAssignment(recipe) {
  closeMobileWebSidebarForModal();
  document.querySelector('.recipe-cookbook-assignment-overlay')?.remove();

  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay recipe-cookbook-assignment-overlay';
  const currentCookbook = state.cookbooks.find(cookbook =>
    (cookbook.recipeIds || []).some(recipeId => String(recipeId) === String(recipe._id))
  );
  const cookbookOptions = `
    <label class="cookbook-assignment-option">
      <input type="radio" name="cookbookId" value="" ${currentCookbook ? '' : 'checked'} />
      <span>
        <strong>No Custom Cookbook</strong>
        <small>Keep this recipe only in All Recipes</small>
      </span>
    </label>
    ${state.cookbooks.map(cookbook => `
      <label class="cookbook-assignment-option">
        <input type="radio" name="cookbookId" value="${escapeAttr(cookbook._id)}" ${String(currentCookbook?._id || '') === String(cookbook._id) ? 'checked' : ''} />
        <span>
          <strong>${escapeHtml(cookbook.name)}</strong>
          <small>${(cookbook.recipeIds || []).length} recipe${(cookbook.recipeIds || []).length === 1 ? '' : 's'}</small>
        </span>
      </label>
    `).join('')}
  `;

  overlay.innerHTML = `
    <article class="time-modal-card recipe-cookbook-assignment-card" role="dialog" aria-modal="true" aria-labelledby="recipe-cookbook-assignment-title">
      <header class="time-modal-header">
        <div>
          <h3 id="recipe-cookbook-assignment-title">Move To Cookbook</h3>
          <p class="muted">${escapeHtml(recipe.name)}</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-recipe-cookbook-assignment aria-label="Close cookbook selection">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          ${state.cookbooks.length ? `
            <form id="recipe-cookbook-assignment-form">
              <div class="cookbook-assignment-list">${cookbookOptions}</div>
              <div class="modal-actions action-row">
                <button class="secondary" type="button" data-close-recipe-cookbook-assignment>Cancel</button>
                <button class="primary" type="submit">Move Recipe</button>
              </div>
            </form>
          ` : `
            <div class="cookbook-assignment-empty">
              <i class="ti ti-books"></i>
              <strong>No cookbooks yet</strong>
              <p class="muted">Create a cookbook first, then move this recipe into it.</p>
              <button class="primary" type="button" data-open-cookbook-manager>Create Cookbook</button>
            </div>
          `}
        </div>
      </div>
    </article>
  `;

  const close = () => {
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    window.setTimeout(() => overlay.remove(), 190);
  };

  overlay.querySelectorAll('[data-close-recipe-cookbook-assignment]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  overlay.querySelector('[data-open-cookbook-manager]')?.addEventListener('click', () => {
    close();
    window.setTimeout(openRecipeCookbookManager, 200);
  });
  overlay.querySelector('#recipe-cookbook-assignment-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const selectedCookbookId = String(new FormData(event.currentTarget).get('cookbookId') || '');
    await Promise.all(state.cookbooks.map(cookbook => {
      const currentIds = (cookbook.recipeIds || []).map(String);
      const shouldInclude = String(cookbook._id) === selectedCookbookId;
      const nextIds = shouldInclude
        ? [...new Set([...currentIds, String(recipe._id)])]
        : currentIds.filter(recipeId => recipeId !== String(recipe._id));
      if (nextIds.length === currentIds.length && nextIds.every((recipeId, index) => recipeId === currentIds[index])) return Promise.resolve();
      return api(`/api/cookbooks/${cookbook._id}`, { method: 'PUT', body: { recipeIds: nextIds } });
    }));
    await loadCookbooks();
    syncRecipeCookbookToolbar();
    renderRecipes();
    close();
    showToast(selectedCookbookId ? 'Recipe moved.' : 'Recipe removed from custom cookbooks.');
  });

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function openRecipeImportModal(existingOverlay = null) {
  closeMobileWebSidebarForModal();
  recipeImportScan = { dataUrl: '', name: '', type: '' };
  recipeImportAiMeta = null;
  recipeImportOcrInFlight = false;
  recipeImportOcrRequestId += 1;
  const reuseOverlay = Boolean(existingOverlay?.isConnected);
  if (!reuseOverlay) document.querySelector('.recipe-import-overlay')?.remove();
  document.body.classList.add('modal-open');

  const overlay = reuseOverlay ? existingOverlay : document.createElement('section');
  overlay.className = 'time-modal-overlay recipe-import-overlay';
  if (reuseOverlay) overlay.classList.add('open');
  overlay.innerHTML = `
    <article class="time-modal-card recipe-import-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-import-title">
      <header class="time-modal-header">
        <div>
          <h3 id="recipe-import-title">Import Printed Recipe</h3>
          <p class="muted">Upload or take a photo to extract the recipe text automatically, then use AI to create an editable draft.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-recipe-import aria-label="Close import modal">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <form id="recipe-import-form" class="calendar-meal-form recipe-import-form">
            <div class="recipe-import-upload">
              <div class="recipe-import-source-picker">
                <span class="recipe-import-source-label">Recipe Photo or PDF</span>
                <div class="recipe-import-source-actions">
                  <button class="secondary" id="recipe-import-camera" type="button"><i class="ti ti-camera"></i>Take Photo</button>
                  <button class="secondary" id="recipe-import-upload" type="button"><i class="ti ti-photo-up"></i>Choose Photo or PDF</button>
                </div>
                <p class="muted recipe-import-source-help">Photos are optimized automatically before text extraction.</p>
                <input id="recipe-import-camera-file" class="visually-hidden" type="file" accept="image/*" capture="environment" />
                <input id="recipe-import-file" class="visually-hidden" name="recipeFile" type="file" accept="image/*,application/pdf" />
              </div>
              <div id="recipe-import-preview" class="recipe-import-preview empty">No scan selected.</div>
              <div class="recipe-ocr-controls recipe-import-scan-dependent hidden">
                <button class="secondary recipe-ocr-button" id="recipe-import-ocr" type="button" disabled><i class="ti ti-scan"></i>Extract Text From Scan</button>
                <p id="recipe-import-ocr-status" class="recipe-ocr-status muted" aria-live="polite">Choose a photo or PDF to extract its text.</p>
              </div>
            </div>
            <label class="wide recipe-import-scan-dependent hidden">Extracted or Typed Text <span class="optional">review the extracted text before AI cleanup; nothing saves automatically</span><textarea name="importText" maxlength="15000" placeholder="Extracted recipe text will appear here automatically, or you can paste or type it."></textarea></label>
            <section class="recipe-ai-callout recipe-import-scan-dependent hidden" aria-labelledby="recipe-ai-title">
              <div>
                <strong id="recipe-ai-title"><i class="ti ti-sparkles"></i>AI Recipe Cleanup</strong>
                <p>Turn messy OCR text into an editable recipe draft. Review every field before saving.</p>
              </div>
              <button class="primary recipe-ai-button" id="recipe-import-ai" type="button"><i class="ti ti-sparkles"></i>Clean Up With AI</button>
            </section>
            <div id="recipe-import-ai-review" class="recipe-ai-review hidden" aria-live="polite"></div>
            <div class="action-row recipe-import-actions recipe-import-scan-dependent hidden">
              <button class="secondary" id="recipe-import-parse" type="button"><i class="ti ti-wand"></i>Fill From Text</button>
              <button class="secondary" id="recipe-import-clear-scan" type="button"><i class="ti ti-trash"></i>Clear Scan</button>
            </div>
            <div class="form-grid compact-form-grid recipe-import-fields recipe-import-scan-dependent hidden">
              <label>Name<input name="name" required placeholder="Grandma's lasagna" /></label>
              <label>Cuisine<input name="cuisine" placeholder="Italian, Southern, American" /></label>
              <label>Meal Types<input name="mealTypes" placeholder="dinner, lunch" value="dinner" /></label>
              <label>Tags<input name="tags" placeholder="family favorite, binder, comfort food" value="printed, family" /></label>
              <label>Prep Time
                <span class="duration-clock" aria-label="Prep time duration">
                  <input name="importPrepHours" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="00" aria-label="Prep time hours" />
                  <span class="duration-separator" aria-hidden="true">:</span>
                  <input name="importPrepMinutes" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="10" aria-label="Prep time minutes" />
                </span>
              </label>
              <label>Cook Time<input name="cookTime" type="number" min="0" value="25" /></label>
              <label>Difficulty<select name="difficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
              <label>Rating<select name="rating">${recipeRatingOptions()}</select></label>
              <label class="wide recipe-import-ingredients-field">Ingredients<textarea name="ingredientsText" rows="9" placeholder="One ingredient per line"></textarea></label>
              <label class="wide">Instructions<textarea name="instructions" placeholder="Recipe steps"></textarea></label>
              <label class="wide">Import Notes<textarea name="importNotes" placeholder="Binder page, handwritten note, source, servings, temperature, etc."></textarea></label>
              <label class="wide checkbox-line"><input type="checkbox" name="favorite" /> Favorite</label>
            </div>
            <div class="modal-actions action-row recipe-import-scan-dependent hidden">
              <button class="secondary" type="button" data-close-recipe-import>Cancel</button>
              <button class="secondary" type="submit" data-recipe-import-save data-save-another="1">Save & Import Another</button>
              <button class="primary" type="submit" data-recipe-import-save>Save Imported Recipe</button>
            </div>
          </form>
        </div>
      </div>
    </article>
  `;

  if (!reuseOverlay) {
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeRecipeImportModal();
  });
  overlay.querySelectorAll('[data-close-recipe-import]').forEach(button => button.addEventListener('click', closeRecipeImportModal));
  overlay.querySelector('#recipe-import-camera')?.addEventListener('click', () => overlay.querySelector('#recipe-import-camera-file')?.click());
  overlay.querySelector('#recipe-import-upload')?.addEventListener('click', () => overlay.querySelector('#recipe-import-file')?.click());
  overlay.querySelector('#recipe-import-camera-file')?.addEventListener('change', handleRecipeImportFile);
  overlay.querySelector('#recipe-import-file')?.addEventListener('change', handleRecipeImportFile);
  overlay.querySelector('#recipe-import-clear-scan')?.addEventListener('click', clearRecipeImportScan);
  overlay.querySelector('#recipe-import-ocr')?.addEventListener('click', () => extractRecipeTextFromScan(overlay.querySelector('#recipe-import-form')));
  overlay.querySelector('#recipe-import-parse')?.addEventListener('click', () => fillRecipeImportFromText(overlay.querySelector('#recipe-import-form')));
  overlay.querySelector('#recipe-import-ai')?.addEventListener('click', () => cleanRecipeImportWithAi(overlay.querySelector('#recipe-import-form')));
  overlay.querySelector('#recipe-import-form')?.addEventListener('submit', saveImportedRecipe);
}

function closeRecipeImportModal() {
  recipeImportAiMeta = null;
  recipeImportOcrInFlight = false;
  recipeImportOcrRequestId += 1;
  const overlay = document.querySelector('.recipe-import-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.classList.add('closing');
  window.setTimeout(() => {
    overlay.remove();
    if (!document.querySelector('.time-modal-overlay.open')) document.body.classList.remove('modal-open');
  }, 180);
}

function setRecipeImportScanDependentVisibility(form, visible) {
  form?.querySelectorAll?.('.recipe-import-scan-dependent').forEach(element => {
    element.classList.toggle('hidden', !visible);
  });
}

async function handleRecipeImportFile(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const preview = document.querySelector('#recipe-import-preview');
  const form = document.querySelector('#recipe-import-form');
  updateRecipeOcrControls(form, { state: 'loading', message: 'Preparing and optimizing the scan…' });
  try {
    recipeImportScan = await recipeSourceFileToDataUrl(file);
    setRecipeImportScanDependentVisibility(form, true);
    if (preview) {
      preview.classList.remove('empty');
      preview.innerHTML = recipeImportScan.type.startsWith('image/')
        ? `<img src="${escapeAttr(recipeImportScan.dataUrl)}" alt="Uploaded recipe scan" /><span>${escapeHtml(recipeImportScan.name)}</span>`
        : `<div><i class="ti ti-file-type-pdf"></i><strong>${escapeHtml(recipeImportScan.name)}</strong><p class="muted">PDF scan attached.</p></div>`;
    }
    const nameInput = form?.elements?.name;
    if (nameInput && !nameInput.value.trim()) nameInput.value = titleFromFileName(file.name);
    updateRecipeOcrControls(form, { state: 'ready', message: 'Scan ready. Extracting text automatically…' });
    await extractRecipeTextFromScan(form, { automatic: true });
  } catch (error) {
    recipeImportScan = { dataUrl: '', name: '', type: '' };
    setRecipeImportScanDependentVisibility(form, false);
    if (preview) {
      preview.classList.add('empty');
      preview.textContent = 'No scan selected.';
    }
    updateRecipeOcrControls(form, { state: 'error', message: error.message || 'Unable to read recipe scan.' });
    showToast(error.message || 'Unable to read recipe scan.');
  }
}

function clearRecipeImportScan() {
  recipeImportScan = { dataUrl: '', name: '', type: '' };
  recipeImportOcrInFlight = false;
  recipeImportOcrRequestId += 1;
  const fileInput = document.querySelector('#recipe-import-file');
  const cameraInput = document.querySelector('#recipe-import-camera-file');
  const preview = document.querySelector('#recipe-import-preview');
  const form = document.querySelector('#recipe-import-form');
  setRecipeImportScanDependentVisibility(form, false);
  if (fileInput) fileInput.value = '';
  if (cameraInput) cameraInput.value = '';
  if (preview) {
    preview.classList.add('empty');
    preview.textContent = 'No scan selected.';
  }
  updateRecipeOcrControls(form, { state: 'empty', message: 'Choose a photo or PDF to extract its text.' });
}

function updateRecipeOcrControls(form, { state = 'ready', message = '' } = {}) {
  const button = form?.querySelector?.('#recipe-import-ocr');
  const status = form?.querySelector?.('#recipe-import-ocr-status');
  const hasScan = Boolean(recipeImportScan.dataUrl);
  const isLoading = state === 'loading';

  if (button) {
    button.disabled = !hasScan || isLoading;
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    button.innerHTML = isLoading
      ? '<i class="ti ti-loader-2 recipe-ai-spinner"></i>Extracting Text…'
      : '<i class="ti ti-scan"></i>Extract Text From Scan';
  }
  if (status) {
    status.className = `recipe-ocr-status ${state}`;
    status.textContent = message;
  }
}

async function extractRecipeTextFromScan(form, { automatic = false } = {}) {
  if (!form || recipeImportOcrInFlight) return;
  if (!recipeImportScan.dataUrl) {
    showToast('Choose a recipe photo or PDF first.');
    return;
  }

  recipeImportOcrInFlight = true;
  const requestId = ++recipeImportOcrRequestId;
  const scanSnapshot = { ...recipeImportScan };
  updateRecipeOcrControls(form, {
    state: 'loading',
    message: scanSnapshot.type === 'application/pdf'
      ? 'Reading the PDF and extracting its recipe text…'
      : 'Reading the photo and extracting its recipe text…'
  });

  try {
    const result = await api('/api/recipes/import/ocr', {
      method: 'POST',
      body: {
        scanData: scanSnapshot.dataUrl,
        filename: scanSnapshot.name,
        mimeType: scanSnapshot.type
      }
    });
    if (requestId !== recipeImportOcrRequestId || scanSnapshot.dataUrl !== recipeImportScan.dataUrl) return;
    const rawText = String(result.rawText || '').trim();
    if (!rawText) throw new Error('No readable recipe text was returned.');
    if (form.elements.importText) form.elements.importText.value = rawText;
    recipeImportAiMeta = null;
    resetRecipeAiReview(form);
    updateRecipeOcrControls(form, {
      state: 'success',
      message: 'Text extracted. Review it below, then select Clean Up With AI.'
    });
    showToast('Recipe text extracted. Review it before AI cleanup.');
  } catch (error) {
    if (requestId !== recipeImportOcrRequestId) return;
    updateRecipeOcrControls(form, {
      state: 'error',
      message: error.message || 'Text extraction failed. Try a clearer photo or paste the text manually.'
    });
    if (!automatic) showToast(error.message || 'Recipe text extraction failed.');
    else showToast('Text extraction failed. You can retry or paste the recipe text manually.');
  } finally {
    if (requestId !== recipeImportOcrRequestId) return;
    recipeImportOcrInFlight = false;
    const status = form.querySelector('#recipe-import-ocr-status');
    const statusState = status?.classList.contains('success') ? 'success' : status?.classList.contains('error') ? 'error' : 'ready';
    updateRecipeOcrControls(form, {
      state: statusState,
      message: status?.textContent || 'Scan ready.'
    });
  }
}

function fillRecipeImportFromText(form) {
  if (!form) return;
  recipeImportAiMeta = null;
  resetRecipeAiReview(form);
  const text = form.elements.importText?.value || '';
  const parsed = parseImportedRecipeText(text, recipeImportScan.name);
  if (parsed.name && !form.elements.name.value.trim()) form.elements.name.value = parsed.name;
  if (parsed.ingredientsText && !form.elements.ingredientsText.value.trim()) form.elements.ingredientsText.value = parsed.ingredientsText;
  if (parsed.instructions && !form.elements.instructions.value.trim()) form.elements.instructions.value = parsed.instructions;
  if (parsed.prepTime) setDurationInputs(form, 'importPrep', parsed.prepTime);
  if (parsed.cookTime && !Number(form.elements.cookTime.value)) form.elements.cookTime.value = parsed.cookTime;
  showToast('Import fields filled from text. Review before saving.');
}

async function saveImportedRecipe(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const keepOpen = event.submitter?.dataset.saveAnother === '1';
  const saveButtons = [...formElement.querySelectorAll('[data-recipe-import-save]')];
  const originalButtonHtml = saveButtons.map(button => button.innerHTML);

  saveButtons.forEach(button => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = 'Saving...';
  });

  try {
    const body = formToBody(formElement);
    delete body.recipeFile;
    delete body.importText;
    body.prepTime = durationInputsToMinutes(formElement, 'importPrep');
    delete body.importPrepHours;
    delete body.importPrepMinutes;
    body.favorite = getFormCheckboxChecked(formElement, 'favorite');
    body.originalScan = recipeImportScan.dataUrl;
    body.originalScanName = recipeImportScan.name;
    body.importSource = 'printed';
    body.ocrText = String(formElement.elements.importText?.value || '').trim().slice(0, 15000);
    body.aiCleaned = Boolean(recipeImportAiMeta);
    body.aiModel = recipeImportAiMeta?.model || '';
    body.aiConfidence = Number(recipeImportAiMeta?.confidence || 0);
    body.aiWarnings = recipeImportAiMeta?.warnings || [];
    body.aiUnclearFields = recipeImportAiMeta?.unclearFields || [];

    if (!String(body.ingredientsText || '').trim() && !String(body.instructions || '').trim()) {
      throw new Error('Add at least one ingredient or instruction before saving.');
    }

    await api('/api/recipes', { method: 'POST', body });
    await Promise.all([loadRecipes(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);

    if (keepOpen) {
      resetRecipeImportForm(formElement);
      showToast('Recipe imported. Ready for the next binder page.');
    } else {
      closeRecipeImportModal();
      renderRecipes();
      showToast('Printed recipe imported.');
    }
  } catch (error) {
    showToast(error.message || 'Recipe import failed. Please try again.');
  } finally {
    saveButtons.forEach((button, index) => {
      if (!button.isConnected) return;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = originalButtonHtml[index];
    });
  }
}

function resetRecipeImportForm(form) {
  if (!form) return;
  form.reset();
  recipeImportAiMeta = null;
  clearRecipeImportScan();
  resetRecipeAiReview(form);
  form.elements.importText?.focus();
}

function resetRecipeAiReview(form) {
  const review = form?.querySelector?.('#recipe-import-ai-review') || document.querySelector('#recipe-import-ai-review');
  if (!review) return;
  review.classList.add('hidden');
  review.innerHTML = '';
}

async function cleanRecipeImportWithAi(form) {
  if (!form) return;
  const rawText = String(form.elements.importText?.value || '').trim();
  if (rawText.length < 20) {
    showToast('Paste at least a few lines of recipe text before using AI cleanup.');
    form.elements.importText?.focus();
    return;
  }

  const button = form.querySelector('#recipe-import-ai');
  const review = form.querySelector('#recipe-import-ai-review');
  const originalHtml = button?.innerHTML;
  recipeImportAiMeta = null;

  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<i class="ti ti-loader-2 recipe-ai-spinner"></i>Cleaning Recipe...';
  }
  if (review) {
    review.classList.remove('hidden');
    review.innerHTML = '<div class="recipe-ai-loading"><i class="ti ti-sparkles"></i><span>Reading the recipe and building an editable draft…</span></div>';
  }

  try {
    const preferredMealType = String(form.elements.mealTypes?.value || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .find(value => ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'].includes(value)) || '';

    const result = await api('/api/recipes/import/ai-cleanup', {
      method: 'POST',
      body: {
        rawText,
        notes: form.elements.importNotes?.value || '',
        preferredMealType
      }
    });

    applyAiRecipeDraftToForm(form, result.draft || {});
    recipeImportAiMeta = {
      model: result.model || '',
      confidence: Number(result.confidence || 0),
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      unclearFields: Array.isArray(result.unclearFields) ? result.unclearFields : []
    };
    renderRecipeAiReview(review, recipeImportAiMeta);
    showToast(recipeImportAiMeta.confidence < 0.65
      ? 'AI cleanup finished with uncertainties. Review the warnings before saving.'
      : 'AI cleanup finished. Review the draft before saving.');
  } catch (error) {
    recipeImportAiMeta = null;
    if (review) {
      review.classList.remove('hidden');
      review.innerHTML = `<div class="recipe-ai-error"><i class="ti ti-alert-circle"></i><div><strong>AI cleanup unavailable</strong><p>${escapeHtml(error.message || 'Try again or use Fill From Text.')}</p></div></div>`;
    }
    showToast(error.message || 'AI cleanup failed.');
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.innerHTML = originalHtml;
    }
  }
}

function normalizedRecipeNameForComparison(value) {
  return String(value || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function aiRecipeNameMatchesScanFilename(name, filename) {
  const normalizedName = normalizedRecipeNameForComparison(name);
  const normalizedFilename = normalizedRecipeNameForComparison(filename);
  return Boolean(normalizedName && normalizedFilename && normalizedName === normalizedFilename);
}

function applyAiRecipeDraftToForm(form, draft) {
  if (!form) return;
  const aiRecipeName = String(draft.name || '').trim();
  if (form.elements.name && aiRecipeName && !aiRecipeNameMatchesScanFilename(aiRecipeName, recipeImportScan.name)) {
    form.elements.name.value = aiRecipeName;
  }
  if (form.elements.cuisine) form.elements.cuisine.value = draft.cuisine || '';
  if (form.elements.mealTypes) form.elements.mealTypes.value = (draft.mealTypes || []).join(', ') || 'dinner';
  if (form.elements.tags) form.elements.tags.value = (draft.tags || []).join(', ');
  setDurationInputs(form, 'importPrep', draft.prepTimeMinutes || 0);
  if (form.elements.cookTime) form.elements.cookTime.value = String(Math.max(0, Math.round(Number(draft.cookTimeMinutes) || 0)));
  if (form.elements.difficulty) form.elements.difficulty.value = String(draft.difficulty || 'Easy').toLowerCase();

  if (form.elements.ingredientsText) {
    const aiIngredientText = (draft.ingredients || []).map(formatAiIngredientLine).filter(Boolean).join('\n');
    const sourceFallback = aiIngredientText
      ? ''
      : parseImportedRecipeText(form.elements.importText?.value || '', '').ingredientsText;
    form.elements.ingredientsText.value = aiIngredientText || sourceFallback || '';
  }
  if (form.elements.instructions) {
    form.elements.instructions.value = (draft.instructions || [])
      .filter(step => String(step?.text || '').trim())
      .map((step, index) => `${Number(step.stepNumber) || index + 1}. ${String(step.text || '').trim()}`)
      .join('\n');
  }
  if (form.elements.importNotes) {
    const details = [
      draft.description ? `Description: ${draft.description}` : '',
      draft.servings ? `Servings: ${draft.servings}` : '',
      draft.temperature ? `Temperature: ${draft.temperature}` : '',
      draft.notes || ''
    ].filter(Boolean);
    form.elements.importNotes.value = details.join('\n');
  }
}

function formatAiIngredientLine(ingredient) {
  const raw = String(ingredient?.raw || '').trim();
  const item = String(ingredient?.item || '').trim();
  if (!item) return raw.replace(/\s*\|\s*Other\s*$/i, '').replace(/\s*\|\s*/g, ' ').trim();
  const quantity = String(ingredient?.quantity || '').trim();
  const unit = String(ingredient?.unit || '').trim();
  const notes = String(ingredient?.notes || '').trim();
  const namedItem = notes ? `${item} (${notes})` : item;
  return [quantity, unit, namedItem].filter(Boolean).join(' ');
}

function renderRecipeAiReview(review, meta) {
  if (!review) return;
  const confidence = Math.max(0, Math.min(100, Math.round((Number(meta.confidence) || 0) * 100)));
  const warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
  const unclearFields = Array.isArray(meta.unclearFields) ? meta.unclearFields : [];
  const confidenceClass = confidence >= 80 ? 'good' : confidence >= 60 ? 'medium' : 'low';

  review.classList.remove('hidden');
  review.innerHTML = `
    <div class="recipe-ai-review-head">
      <div>
        <strong><i class="ti ti-sparkles"></i>AI Draft Ready</strong>
        <p>Review and edit every field before saving.</p>
      </div>
      <span class="recipe-ai-confidence ${confidenceClass}">${confidence}% confidence</span>
    </div>
    ${warnings.length ? `<div class="recipe-ai-warning-block"><strong>AI Warnings</strong><ul>${warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>` : '<p class="recipe-ai-no-warnings"><i class="ti ti-circle-check"></i>No specific transcription warnings were returned.</p>'}
    ${unclearFields.length ? `<p class="recipe-ai-unclear"><strong>Check these fields:</strong> ${unclearFields.map(escapeHtml).join(', ')}</p>` : ''}
  `;
}

async function recipeSourceFileToDataUrl(file) {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isImage && !isPdf) throw new Error('Please choose an image or PDF file.');

  if (isPdf) {
    if (file.size > 1200000) throw new Error('PDF scan is too large. Please upload a smaller file or use a photo.');
    return { dataUrl: await fileToDataUrl(file), name: file.name, type: file.type || 'application/pdf' };
  }

  const rawDataUrl = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const source = new Image();
    source.onload = () => resolve(source);
    source.onerror = () => reject(new Error('Unable to process this image format. Try choosing a JPG, PNG, or a new camera photo.'));
    source.src = rawDataUrl;
  });

  const sourceWidth = image.naturalWidth || image.width || 1;
  const sourceHeight = image.naturalHeight || image.height || 1;
  const targetDataUrlLength = 1450000;
  const edgeSteps = [1800, 1600, 1400, 1200, 1000, 850, 700];
  const qualitySteps = [0.84, 0.74, 0.64, 0.54, 0.46];
  let smallestResult = '';

  for (const maxEdge of edgeSteps) {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) break;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of qualitySteps) {
      let optimized = canvas.toDataURL('image/webp', quality);
      if (!optimized || optimized === 'data:,') optimized = canvas.toDataURL('image/jpeg', quality);
      if (!optimized || optimized === 'data:,') continue;
      if (!smallestResult || optimized.length < smallestResult.length) smallestResult = optimized;
      if (optimized.length <= targetDataUrlLength) {
        const optimizedType = optimized.match(/^data:([^;,]+)[;,]/i)?.[1] || 'image/jpeg';
        return { dataUrl: optimized, name: file.name, type: optimizedType };
      }
    }
  }

  if (smallestResult && smallestResult.length <= 1600000) {
    const optimizedType = smallestResult.match(/^data:([^;,]+)[;,]/i)?.[1] || 'image/jpeg';
    return { dataUrl: smallestResult, name: file.name, type: optimizedType };
  }

  throw new Error('HomePlate could not optimize this photo enough for upload. Try cropping tightly around the recipe or choose a lower-resolution copy.');
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function parseImportedRecipeText(text, fileName = '') {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const title = lines.find(line => !isRecipeSectionLabel(line) && !isRecipeMetaLine(line)) || titleFromFileName(fileName);
  const ingredientIndex = lines.findIndex(line => /^ingredients?[:]?$/i.test(line));
  const instructionIndex = lines.findIndex(line => /^(instructions?|directions?|method|preparation|steps)[:]?$/i.test(line));
  let ingredientLines = [];
  let instructionLines = [];

  if (ingredientIndex >= 0) {
    const end = instructionIndex > ingredientIndex ? instructionIndex : lines.length;
    ingredientLines = lines.slice(ingredientIndex + 1, end);
  }

  if (instructionIndex >= 0) {
    instructionLines = lines.slice(instructionIndex + 1);
  }

  if (!ingredientLines.length && !instructionLines.length) {
    const numberedIndex = lines.findIndex(line => /^\d+[.)]\s+/.test(line));
    if (numberedIndex > 1) {
      ingredientLines = lines.slice(1, numberedIndex);
      instructionLines = lines.slice(numberedIndex);
    }
  }

  const prepTime = findRecipeDuration(lines, /prep(?:aration)?\s*time/i);
  const cookTime = findRecipeDuration(lines, /cook(?:ing)?\s*time/i);

  return {
    name: title,
    ingredientsText: ingredientLines.filter(line => !isRecipeSectionLabel(line) && !isRecipeMetaLine(line)).join('\n'),
    instructions: instructionLines.filter(line => !isRecipeSectionLabel(line)).join('\n'),
    prepTime,
    cookTime
  };
}

function isRecipeSectionLabel(line) {
  return /^(ingredients?|instructions?|directions?|method|preparation|steps)[:]?$/i.test(String(line || '').trim());
}

function isRecipeMetaLine(line) {
  return /^(prep|cook|total|serves|servings|yield)\b/i.test(String(line || '').trim());
}

function findRecipeDuration(lines, labelPattern) {
  const line = lines.find(item => labelPattern.test(item));
  if (!line) return 0;
  const hoursMatch = line.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const minutesMatch = line.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  const plainMatch = line.match(/:\s*(\d+)\b/);
  const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
  const minutes = minutesMatch ? Number(minutesMatch[1]) : plainMatch ? Number(plainMatch[1]) : 0;
  return Math.max(0, (hours * 60) + minutes);
}

function setDurationInputs(form, prefix, totalMinutes) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hoursInput = form.querySelector(`[name="${prefix}Hours"]`);
  const minutesInput = form.querySelector(`[name="${prefix}Minutes"]`);
  if (hoursInput) hoursInput.value = String(Math.floor(total / 60)).padStart(2, '0');
  if (minutesInput) minutesInput.value = String(total % 60).padStart(2, '0');
}

function titleFromFileName(fileName) {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function openRecipeScan(recipe) {
  if (!recipe?.originalScan) {
    showToast('No original scan is attached to this recipe.');
    return;
  }

  closeMobileWebSidebarForModal();
  document.querySelector('.recipe-scan-viewer-overlay')?.remove();

  const fileName = String(recipe.originalScanName || '').trim();
  const isPdf = /^data:application\/pdf(?:;|,)/i.test(recipe.originalScan) || /\.pdf$/i.test(fileName);
  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay recipe-scan-viewer-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card recipe-scan-viewer-card" role="dialog" aria-modal="true" aria-labelledby="recipe-scan-viewer-title">
      <header class="time-modal-header">
        <div>
          <h3 id="recipe-scan-viewer-title">${escapeHtml(recipe.name || 'Recipe Scan')}</h3>
          <p class="muted">Original recipe scan</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-recipe-scan-viewer aria-label="Close recipe scan">×</button>
      </header>
      <div class="recipe-scan-viewer-body" data-recipe-scan-viewer-body></div>
    </article>
  `;

  const viewerBody = overlay.querySelector('[data-recipe-scan-viewer-body]');
  const viewer = document.createElement(isPdf ? 'iframe' : 'img');
  viewer.className = isPdf ? 'recipe-scan-viewer-pdf' : 'recipe-scan-viewer-image';
  viewer.src = isPdf ? `${recipe.originalScan}#toolbar=0&navpanes=0` : recipe.originalScan;
  viewer.title = `${recipe.name || 'Recipe'} original scan`;
  if (!isPdf) viewer.alt = `${recipe.name || 'Recipe'} original scan`;
  viewerBody?.appendChild(viewer);

  const close = () => {
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    window.setTimeout(() => overlay.remove(), 190);
  };

  overlay.querySelectorAll('[data-close-recipe-scan-viewer]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.querySelector('[data-close-recipe-scan-viewer]')?.focus();
}

function renderRestaurants() {
  document.querySelectorAll('body > [data-slot-tag-modal]').forEach(modal => modal.remove());
  document.body.classList.remove('slot-tag-modal-open');

  const savedRestaurants = state.restaurants.filter(restaurant => !restaurant.wantToGo);
  const wantToGoRestaurants = state.restaurants
    .filter(restaurant => restaurant.wantToGo)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  const sortedRestaurants = getSortedRestaurants(savedRestaurants);
  const showingWantToGo = state.restaurantListView === 'want';
  const visibleCount = showingWantToGo ? wantToGoRestaurants.length : sortedRestaurants.length;
  const hasHomeLocation = hasHouseholdHomeCoordinates();

  pageRoot.innerHTML = `
    <section class="grid two">
      <form id="restaurant-form" class="form-card">
        <h3>Add Restaurant</h3>
        <div class="form-grid">
          <label>Name<input name="name" required placeholder="Favorite taco spot" /></label>
          ${restaurantCuisinePicker('', 'add-restaurant')}
          <label>Price<select name="priceLevel"><option>$</option><option selected>$$</option><option>$$$</option><option>$$$$</option></select></label>
          <label>Rating<select name="rating">${ratingOptions()}</select></label>
          <label class="wide">Address<input name="location" placeholder="Street address or area" autocomplete="street-address" list="address-autocomplete-options" /></label>
          <label class="wide">Link<input name="link" type="url" placeholder="Website, menu, Google Maps, DoorDash link" /></label>
          <label>Favorite Dishes<input name="favoriteDishes" placeholder="wings, tacos, ramen" /></label>
          <label>Tags<input name="tags" placeholder="late night, cheap, delivery" /></label>
          <label class="wide checkbox-line restaurant-favorite"><input type="checkbox" name="favorite" /> Favorite</label>
          <label class="wide checkbox-line restaurant-want-to-go"><input type="checkbox" name="wantToGo" /> Want To Go</label>
        </div>
        <button class="primary full" type="submit">Save Restaurant</button>
      </form>
      <article class="card random-restaurant-card" id="random-form">
        <div class="slot-machine-head">
          <div>
            <h3>Random Restaurant Selector</h3>
            <p class="muted">Set your filters and spin for dinner.</p>
          </div>
        </div>
        <form id="random-restaurant-form" class="slot-machine-form">
          <div class="slot-select-stack">
            <label class="slot-select-control">Max Price
              <select name="maxPrice">
                <option value="">Any</option>
                <option value="$">$</option>
                <option value="$$">$$</option>
                <option value="$$$">$$$</option>
                <option value="$$$$">$$$$</option>
              </select>
            </label>
            <label class="slot-select-control">Minimum Rating
              <select name="minRating">
                <option value="0">Any</option>
                <option value="1">★+</option>
                <option value="2">★★+</option>
                <option value="3">★★★+</option>
                <option value="4">★★★★+</option>
                <option value="5">★★★★★</option>
              </select>
            </label>
            <label class="slot-select-control">Max Distance
              <select name="maxDistance" ${hasHomeLocation ? '' : 'disabled'}>
                <option value="">${hasHomeLocation ? 'Any' : 'Add home address'}</option>
                <option value="5">5 miles</option>
                <option value="10">10 miles</option>
                <option value="15">15 miles</option>
                <option value="25">25 miles</option>
                <option value="50">50 miles</option>
              </select>
            </label>
          </div>
          ${restaurantRandomFilterGroups()}
        </form>
        <div id="random-result" class="slot-machine-result">
          ${slotMachinePlaceholder()}
        </div>
      </article>
      ${addressAutocompleteDatalist()}
    </section>
    <section class="card restaurant-list-section">
      <div class="section-head restaurant-list-head">
        <div class="restaurant-list-heading-block">
          <div class="restaurant-list-title-row">
            <h3>Saved Restaurants</h3>
            <div class="restaurant-view-toggle ${showingWantToGo ? 'want-active' : 'saved-active'}" role="group" aria-label="Restaurant list view" data-restaurant-list-toggle data-current-view="${showingWantToGo ? 'want' : 'saved'}">
              <button class="${showingWantToGo ? '' : 'active'}" type="button" data-restaurant-list-view="saved">Saved</button>
              <button class="${showingWantToGo ? 'active' : ''}" type="button" data-restaurant-list-view="want">Want To</button>
            </div>
          </div>
          <p class="muted">${visibleCount} ${showingWantToGo ? 'want-to' : 'saved'} ${visibleCount === 1 ? 'spot' : 'spots'}</p>
        </div>
        <div class="restaurant-list-tools">
          ${showingWantToGo ? '' : `
            <label class="compact-control restaurant-sort-control">Sort
              <select id="restaurant-sort-select" name="restaurantSort">
                ${restaurantSortOptions()}
              </select>
            </label>
          `}
        </div>
      </div>
      ${showingWantToGo ? `
        <div class="want-to-go-list">
          ${wantToGoRestaurants.length
            ? wantToGoRestaurants.map(restaurant => String(state.editingRestaurantId) === String(restaurant._id) ? restaurantEditCard(restaurant) : wantToGoRestaurantItem(restaurant)).join('')
            : '<div class="empty compact">Mark restaurants as Want To Go to build this list.</div>'}
        </div>
      ` : `
        <div class="restaurant-card-grid">
          ${sortedRestaurants.length ? sortedRestaurants.map(restaurantItem).join('') : '<div class="empty">Add a saved restaurant or switch to Want To.</div>'}
        </div>
      `}
    </section>
  `;

  $('#restaurant-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withSaveFeedback(formElement, async () => {
      const body = formToBody(formElement);
      body.cuisine = collectRestaurantCuisines(formElement);
      body.favorite = getFormCheckboxChecked(formElement, 'favorite');
      body.wantToGo = getFormCheckboxChecked(formElement, 'wantToGo');
      await api('/api/restaurants', { method: 'POST', body });
      formElement.reset();
      state.editingRestaurantId = '';
      await Promise.all([loadRestaurants(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);
      renderRestaurants();
    }, 'Restaurant saved.');
  });

  const randomRestaurantForm = $('#random-restaurant-form');
  const randomResult = $('#random-result');
  const triggerRestaurantSpin = () => spinRandomRestaurant(randomRestaurantForm);
  randomRestaurantForm.addEventListener('submit', event => {
    event.preventDefault();
    triggerRestaurantSpin();
  });
  randomResult?.addEventListener('click', event => {
    if (event.target.closest('[data-spin-slot]')) triggerRestaurantSpin();
  });
  randomResult?.addEventListener('keydown', event => {
    if (!event.target.closest('[data-spin-slot]') || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    triggerRestaurantSpin();
  });
  bindSlotTagFilterModal(randomRestaurantForm);

  pageRoot.querySelector('[data-restaurant-list-toggle]')?.addEventListener('click', event => {
    const toggle = event.currentTarget;
    if (toggle.dataset.switching === '1') return;
    const currentView = toggle.dataset.currentView === 'want' ? 'want' : 'saved';
    const nextView = currentView === 'want' ? 'saved' : 'want';

    toggle.dataset.switching = '1';
    toggle.dataset.currentView = nextView;
    toggle.classList.toggle('want-active', nextView === 'want');
    toggle.classList.toggle('saved-active', nextView !== 'want');
    toggle.querySelectorAll('[data-restaurant-list-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.restaurantListView === nextView);
    });

    window.setTimeout(() => {
      state.restaurantListView = nextView === 'want' ? 'want' : 'saved';
      localStorage.setItem('mealPlannerRestaurantListView', state.restaurantListView);
      state.editingRestaurantId = '';
      state.openRestaurantMenuId = '';
      renderRestaurants();
    }, 230);
  });

  $('#restaurant-sort-select')?.addEventListener('change', event => {
    state.restaurantSort = event.currentTarget.value;
    localStorage.setItem('mealPlannerRestaurantSort', state.restaurantSort);
    renderRestaurants();
  });

  pageRoot.querySelectorAll('[data-favorite-restaurant]').forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      button.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.28)' },
        { transform: 'scale(0.94)' },
        { transform: 'scale(1)' }
      ], { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      const restaurant = state.restaurants.find(item => String(item._id) === String(button.dataset.favoriteRestaurant));
      if (!restaurant) return;
      button.disabled = true;
      try {
        await api(`/api/restaurants/${restaurant._id}`, { method: 'PUT', body: restaurantUpdateBody(restaurant, { favorite: !restaurant.favorite }) });
        await Promise.all([loadRestaurants(), loadPlanner(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);
        renderRestaurants();
      } catch (error) {
        showToast(error.message || 'Unable to update favorite.');
        button.disabled = false;
      }
    });
  });

  pageRoot.querySelectorAll('[data-restaurant-menu]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const restaurantId = button.dataset.restaurantMenu;
      state.openRestaurantMenuId = String(state.openRestaurantMenuId) === String(restaurantId) ? '' : restaurantId;
      renderRestaurants();
    });
  });

  pageRoot.querySelectorAll('[data-restaurant-card]').forEach(card => {
    card.addEventListener('dblclick', event => {
      if (event.target.closest('button, a, input, select, textarea, .restaurant-action-menu')) return;
      state.editingRestaurantId = card.dataset.restaurantCard;
      state.openRestaurantMenuId = '';
      renderRestaurants();
    });
  });

  pageRoot.querySelectorAll('[data-edit-restaurant]').forEach(button => {
    button.addEventListener('click', () => {
      state.editingRestaurantId = button.dataset.editRestaurant;
      state.openRestaurantMenuId = '';
      renderRestaurants();
    });
  });

  pageRoot.querySelectorAll('[data-cancel-restaurant-edit]').forEach(button => {
    button.addEventListener('click', () => {
      state.editingRestaurantId = '';
      state.openRestaurantMenuId = '';
      renderRestaurants();
    });
  });

  pageRoot.querySelectorAll('[data-restaurant-edit-form]').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const restaurantId = formElement.dataset.restaurantEditForm;
      await withSaveFeedback(formElement, async () => {
        const body = formToBody(formElement);
        body.cuisine = collectRestaurantCuisines(formElement);
        body.favorite = getFormCheckboxChecked(formElement, 'favorite');
        body.wantToGo = getFormCheckboxChecked(formElement, 'wantToGo');
        await api(`/api/restaurants/${restaurantId}`, { method: 'PUT', body });
        state.editingRestaurantId = '';
        state.openRestaurantMenuId = '';
        await Promise.all([loadRestaurants(), loadPlanner(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);
        renderRestaurants();
      }, 'Restaurant updated.');
    });
  });

  pageRoot.querySelectorAll('[data-delete-restaurant]').forEach(button => {
    button.addEventListener('click', async () => {
      const restaurant = state.restaurants.find(item => String(item._id) === String(button.dataset.deleteRestaurant));
      const name = restaurant?.name || 'this restaurant';
      if (!window.confirm(`Delete ${name}? This will also remove it from planned meals.`)) return;
      await api(`/api/restaurants/${button.dataset.deleteRestaurant}`, { method: 'DELETE' });
      state.openRestaurantMenuId = '';
      await Promise.all([loadRestaurants(), loadPlanner(), loadStats()]);
      showToast('Restaurant deleted.');
      renderRestaurants();
    });
  });
}

function renderGrocery() {
  const grouped = groupBy(state.grocery, item => item.category || 'Other');

  pageRoot.innerHTML = `
    <section class="grid two">
      <form id="grocery-form" class="form-card">
        <h3>Add Grocery Item</h3>
        <div class="form-grid">
          <label>Name<input name="name" required placeholder="Chicken thighs" /></label>
          <label>Category<input name="category" placeholder="Meat, Produce, Pantry" /></label>
          <label>Quantity<input name="quantity" placeholder="2" /></label>
          <label>Unit<input name="unit" placeholder="lb, bag, box" /></label>
        </div>
        <button class="primary full" type="submit">Add Item</button>
      </form>
      <article class="card">
        <h3>Grocery Controls</h3>
        <div class="action-row">
          <button class="secondary" id="generate-grocery-here">Generate From This Week</button>
          <button class="danger" id="clear-checked">Clear Checked</button>
        </div>
      </article>
    </section>
    <section class="card">
      <h3>Shared Grocery List</h3>
      <div class="list">
        ${state.grocery.length ? Object.entries(grouped).map(([category, items]) => groceryGroup(category, items)).join('') : '<div class="empty">No grocery items yet.</div>'}
      </div>
    </section>
  `;

  $('#grocery-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withSaveFeedback(formElement, async () => {
      await api('/api/grocery', { method: 'POST', body: formToBody(formElement) });
      formElement.reset();
      await Promise.all([loadGrocery(), loadStats()]);
      renderGrocery();
    }, 'Grocery item added.');
  });

  $('#generate-grocery-here').addEventListener('click', async () => {
    const result = await api('/api/grocery/generate-from-plan', { method: 'POST', body: { weekStart: getPlannerRangeStart(), days: getPlannerDisplayDays() } });
    await Promise.all([loadGrocery(), loadStats()]);
    showToast(`Added ${result.createdCount} grocery item${result.createdCount === 1 ? '' : 's'} from planned recipes.`);
    renderGrocery();
  });

  $('#clear-checked').addEventListener('click', async () => {
    const result = await api('/api/grocery/clear-checked', { method: 'POST', body: {} });
    await Promise.all([loadGrocery(), loadStats()]);
    showToast(`Cleared ${result.deleted} checked item${result.deleted === 1 ? '' : 's'}.`);
    renderGrocery();
  });

  pageRoot.querySelectorAll('[data-check-grocery]').forEach(input => {
    input.addEventListener('change', async () => {
      const item = state.grocery.find(entry => entry._id === input.dataset.checkGrocery);
      if (!item) return;
      await api(`/api/grocery/${item._id}`, { method: 'PUT', body: { ...item, checked: input.checked } });
      await Promise.all([loadGrocery(), loadStats()]);
      renderGrocery();
    });
  });

  pageRoot.querySelectorAll('[data-delete-grocery]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/grocery/${button.dataset.deleteGrocery}`, { method: 'DELETE' });
      await Promise.all([loadGrocery(), loadStats()]);
      showToast('Grocery item deleted.');
      renderGrocery();
    });
  });
}

function renderHistory() {
  const sortedHistory = [...state.history].sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate) return byDate;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  const visibleHistory = getVisibleHistory(sortedHistory);
  const historySummary = visibleHistory.length === sortedHistory.length
    ? `Showing all ${sortedHistory.length} meal${sortedHistory.length === 1 ? '' : 's'}.`
    : `Showing ${visibleHistory.length} of ${sortedHistory.length} meals.`;

  pageRoot.innerHTML = `
    <section class="grid two">
      <form id="history-form" class="form-card">
        <h3>Add Meal History</h3>
        <div class="form-grid">
          <label>Date<input name="date" type="date" value="${dateISO(new Date())}" required /></label>
          <label>Meal Type<select name="mealType">${mealTypes.map(type => option(type, titleCase(type), 'dinner')).join('')}</select></label>
          <label>Name<input name="name" required placeholder="Chicken pasta" /></label>
          <label>Cuisine<input name="cuisine" placeholder="Italian" /></label>
          <label>Rating<select name="rating">${ratingOptions()}</select></label>
          <label>Cost<input name="cost" type="number" min="0" step="0.01" value="0" /></label>
          <label class="wide">Notes<textarea name="notes" placeholder="Would make again, needs more spice, etc."></textarea></label>
        </div>
        <button class="primary full" type="submit">Save History</button>
      </form>
      <article class="card history-card">
        <div class="history-card-header">
          <div>
            <h3>Meal History</h3>
            <p class="muted">${historySummary}</p>
          </div>
          <div class="history-display-controls" aria-label="Meal history display options">
            <label>Show By
              <select id="history-view-mode">
                ${option('amount', 'Amount', state.historyViewMode)}
                ${option('date', 'Date', state.historyViewMode)}
              </select>
            </label>
            <label class="history-amount-control ${state.historyViewMode === 'amount' ? '' : 'hidden'}">Meals
              <select id="history-amount">
                ${option('5', '5', state.historyAmount)}
                ${option('10', '10', state.historyAmount)}
                ${option('20', '20', state.historyAmount)}
                ${option('50', '50', state.historyAmount)}
                ${option('all', 'All', state.historyAmount)}
              </select>
            </label>
            <label class="history-date-control ${state.historyViewMode === 'date' ? '' : 'hidden'}">Date Range
              <select id="history-days">
                ${option('7', 'Last 7 Days', state.historyDays)}
                ${option('30', 'Last 30 Days', state.historyDays)}
                ${option('90', 'Last 90 Days', state.historyDays)}
                ${option('365', 'Last Year', state.historyDays)}
                ${option('all', 'All Dates', state.historyDays)}
              </select>
            </label>
          </div>
        </div>
        <div class="list">${visibleHistory.length ? visibleHistory.map(historyItem).join('') : '<div class="empty">No meals match the selected history view.</div>'}</div>
      </article>
    </section>
  `;

  $('#history-view-mode')?.addEventListener('change', event => {
    state.historyViewMode = event.currentTarget.value === 'date' ? 'date' : 'amount';
    localStorage.setItem('mealPlannerHistoryViewMode', state.historyViewMode);
    renderHistory();
  });

  $('#history-amount')?.addEventListener('change', event => {
    state.historyAmount = event.currentTarget.value;
    localStorage.setItem('mealPlannerHistoryAmount', state.historyAmount);
    renderHistory();
  });

  $('#history-days')?.addEventListener('change', event => {
    state.historyDays = event.currentTarget.value;
    localStorage.setItem('mealPlannerHistoryDays', state.historyDays);
    renderHistory();
  });

  $('#history-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withSaveFeedback(formElement, async () => {
      const body = { ...formToBody(formElement), sourceType: 'custom' };
      await api('/api/history', { method: 'POST', body });
      formElement.reset();
      await Promise.all([loadHistory(), loadStats(), loadSuggestions({ mealType: 'dinner' })]);
      renderHistory();
    }, 'Meal history saved.');
  });

  pageRoot.querySelectorAll('[data-delete-history]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/history/${button.dataset.deleteHistory}`, { method: 'DELETE' });
      await Promise.all([loadHistory(), loadStats()]);
      showToast('History item deleted.');
      renderHistory();
    });
  });
}

function getVisibleHistory(sortedHistory) {
  if (state.historyViewMode === 'date') {
    if (state.historyDays === 'all') return sortedHistory;
    const days = Math.max(1, Number(state.historyDays) || 30);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    return sortedHistory.filter(item => {
      const itemDate = new Date(`${item.date}T12:00:00`);
      return Number.isFinite(itemDate.getTime()) && itemDate >= cutoff;
    });
  }

  if (state.historyAmount === 'all') return sortedHistory;
  const amount = Math.max(1, Number(state.historyAmount) || 5);
  return sortedHistory.slice(0, amount);
}

function renderStats() {
  const stats = state.stats || { totals: {}, cuisineCounts: {}, mealTypeCounts: {}, topRecipes: [], topRestaurants: [] };
  const cuisineMax = Math.max(1, ...Object.values(stats.cuisineCounts || {}));
  const mealMax = Math.max(1, ...Object.values(stats.mealTypeCounts || {}));

  pageRoot.innerHTML = `
    <section class="grid three">
      ${kpiCard('Recipes', stats.totals.recipes || 0, 'saved')}
      ${kpiCard('Restaurants', stats.totals.restaurants || 0, 'saved')}
      ${kpiCard('Home vs Out', `${stats.totals.homeCooked || 0}/${stats.totals.restaurantMeals || 0}`, 'recipe meals / restaurant meals')}
    </section>
    <section class="grid two">
      <article class="card">
        <h3>Cuisine Breakdown</h3>
        <div class="chart-row">
          ${Object.entries(stats.cuisineCounts || {}).length ? Object.entries(stats.cuisineCounts).map(([name, count]) => statBar(name, count, cuisineMax)).join('') : '<div class="empty">No cuisine data yet.</div>'}
        </div>
      </article>
      <article class="card">
        <h3>Meal Type Breakdown</h3>
        <div class="chart-row">
          ${Object.entries(stats.mealTypeCounts || {}).length ? Object.entries(stats.mealTypeCounts).map(([name, count]) => statBar(titleCase(name), count, mealMax)).join('') : '<div class="empty">No meal type data yet.</div>'}
        </div>
      </article>
    </section>
    <section class="grid two">
      <article class="card">
        <h3>Most Cooked Recipes</h3>
        <div class="list">${stats.topRecipes?.length ? stats.topRecipes.map(item => `<div class="list-item"><strong>${escapeHtml(item.name)}</strong><span class="muted">${item.timesCooked} cooked • ${item.rating}/5</span></div>`).join('') : '<div class="empty">Cook recipe meals to populate this.</div>'}</div>
      </article>
      <article class="card">
        <h3>Most Visited Restaurants</h3>
        <div class="list">${stats.topRestaurants?.length ? stats.topRestaurants.map(item => `<div class="list-item"><strong>${escapeHtml(item.name)}</strong><span class="muted">${item.timesVisited} visits • ${item.rating}/5</span></div>`).join('') : '<div class="empty">Mark restaurant meals eaten to populate this.</div>'}</div>
      </article>
    </section>
  `;
}

async function renderSettings() {
  const data = await api('/api/household');
  pageRoot.innerHTML = `
    <section class="grid two">
      <article class="card">
        <h3>Profile</h3>
        <p class="muted">Add a personal avatar for your household account.</p>
        <div class="profile-settings-row">
          ${avatarMarkup(state.user, 'profile')}
          <div class="profile-settings-copy">
            <strong>${escapeHtml(state.user?.name || 'User')}</strong>
            <span class="muted">${escapeHtml(state.user?.email || '')}</span>
            <div class="profile-actions">
              <input id="avatar-upload" class="visually-hidden" type="file" accept="image/*" />
              <button id="avatar-upload-btn" class="secondary" type="button"><i class="ti ti-upload"></i>${state.user?.profilePic ? 'Update Avatar' : 'Upload Avatar'}</button>
              <button id="avatar-remove-btn" class="ghost" type="button"><i class="ti ti-trash"></i>Remove</button>
            </div>
          </div>
        </div>
      </article>
      <article class="card" data-settings-section="household">
        <h3>Household</h3>
        <p class="muted">Share this invite code with your wife or anyone else you want in the meal planner.</p>
        <div class="invite-code-row">
          <div class="kpi invite-code" aria-label="Household invite code">${formatInviteCode(data.household.inviteCode)}</div>
          <button class="secondary copy-invite-btn" type="button" data-copy-invite="${escapeHtml(String(data.household.inviteCode || '').toUpperCase())}"><i class="ti ti-copy"></i>Copy</button>
        </div>
        <form id="household-name-form" class="invite-form household-name-form">
          <label>Household Name<input name="name" type="text" maxlength="80" required value="${escapeAttr(data.household.name || '')}" /></label>
          <label>Home Address<input name="homeAddress" type="text" maxlength="220" placeholder="Street, city, state, ZIP" autocomplete="street-address" list="address-autocomplete-options" value="${escapeAttr(data.household.homeAddress || '')}" /></label>
          <p class="muted household-distance-help">Used to calculate approximate distance to saved restaurants.</p>
          <button class="secondary full" type="submit"><i class="ti ti-home-edit"></i>Save Household Details</button>
        </form>
      </article>
      <article class="card">
        <h3>Email Invite</h3>
        <p class="muted">Send an invite to a specific email. They can create an account and use the household invite code to join.</p>
        <form id="email-invite-form" class="invite-form">
          <label>Recipient Email<input name="email" type="email" placeholder="name@example.com" required /></label>
          <button class="primary full" type="submit"><i class="ti ti-mail-plus"></i>Send Invite</button>
        </form>
        <div class="list invite-list">
          ${(data.invites || []).length ? (data.invites || []).map(invite => `
            <div class="list-item invite-list-item">
              <div>
                <strong>${escapeHtml(invite.email)}</strong>
                <span class="muted">${escapeHtml(titleCase(invite.status || 'pending'))} • Code ${formatInviteCode(invite.inviteCode || data.household.inviteCode)}</span>
              </div>
            </div>
          `).join('') : '<div class="empty compact">No email invites sent yet.</div>'}
        </div>
      </article>
      <article class="card">
        <h3>Join Household</h3>
        <p class="muted">Already have an account? Enter an invite code here to switch this account into another shared household.</p>
        <form id="join-household-form" class="invite-form">
          <label>Invite Code<input name="inviteCode" type="text" placeholder="Enter household invite code" autocomplete="off" required /></label>
          <button class="secondary full" type="submit"><i class="ti ti-users-plus"></i>Join Household</button>
        </form>
      </article>
      <article class="card">
        <h3>Members</h3>
        <div class="list">
          ${data.members.map(member => `<div class="list-item member-list-item"><div class="member-identity">${avatarMarkup(member, 'member')}<div><strong>${escapeHtml(member.name)}</strong><span class="muted">${escapeHtml(member.email)} • ${member.role}</span></div></div></div>`).join('')}
        </div>
      </article>
      <article class="card settings-export-card">
        <h3>Manual Backup</h3>
        <p class="muted">Export your account and household data as a JSON backup.</p>
        <button id="export-user-data-btn" class="secondary" type="button"><i class="ti ti-download"></i>Export User Data</button>
      </article>
      <article class="card settings-logout-card">
        <h3>Session</h3>
        <p class="muted">Log out of this HomePlate account on this device.</p>
        <button id="settings-logout-btn" class="ghost logout-btn" type="button"><i class="ti ti-logout"></i>Log Out</button>
      </article>
      ${addressAutocompleteDatalist()}
    </section>
  `;

  pageRoot.querySelector('#avatar-upload-btn')?.addEventListener('click', () => pageRoot.querySelector('#avatar-upload')?.click());
  pageRoot.querySelector('#avatar-upload')?.addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const profilePic = await imageFileToOptimizedDataUrl(file);
      await updateAccount({ profilePic });
      showToast('Avatar updated.');
      await renderSettings();
    } catch (error) {
      showToast(error.message || 'Unable to update avatar.');
    } finally {
      event.currentTarget.value = '';
    }
  });

  pageRoot.querySelector('#avatar-remove-btn')?.addEventListener('click', async () => {
    try {
      await updateAccount({ profilePic: '' });
      showToast('Avatar removed.');
      await renderSettings();
    } catch (error) {
      showToast(error.message || 'Unable to remove avatar.');
    }
  });


  pageRoot.querySelector('#settings-logout-btn')?.addEventListener('click', logout);

  pageRoot.querySelector('#export-user-data-btn')?.addEventListener('click', exportUserData);

  pageRoot.querySelector('[data-copy-invite]')?.addEventListener('click', async event => {
    const code = event.currentTarget.dataset.copyInvite || '';
    try {
      await copyTextToClipboard(code);
      showToast('Invite code copied.');
    } catch (error) {
      showToast('Unable to copy invite code.');
    }
  });

  pageRoot.querySelector('#household-name-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    await withSaveFeedback(form, async () => {
      const formData = new FormData(form);
      const name = String(formData.get('name') || '').trim();
      const homeAddress = String(formData.get('homeAddress') || '').trim();
      if (!name) throw new Error('Enter a household name.');
      const household = await api('/api/household', { method: 'PATCH', body: { name, homeAddress } });
      state.household = household;
      await loadRestaurants();
      await renderSettings();
    }, 'Household details updated.');
  });

  pageRoot.querySelector('#email-invite-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    await withSaveFeedback(form, async () => {
      const body = formToBody(form);
      const result = await api('/api/household/invites', { method: 'POST', body });
      const inviteCode = result.invite?.inviteCode || data.household.inviteCode;
      const mailto = buildInviteMailto(result.invite?.email || body.email, result.householdName || data.household.name, inviteCode);
      window.setTimeout(() => { window.location.href = mailto; }, 180);
      await renderSettings();
    }, 'Invite ready.');
  });

  pageRoot.querySelector('#join-household-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const inviteCode = String(new FormData(form).get('inviteCode') || '').trim().toUpperCase();
    if (!inviteCode) {
      showToast('Enter an invite code.');
      return;
    }

    const currentHouseholdName = state.household?.name || data.household?.name || 'your current household';
    const confirmed = window.confirm(`Joining another household will switch this account out of ${currentHouseholdName}. Continue?`);
    if (!confirmed) return;

    await withSaveFeedback(form, async () => {
      const result = await api('/api/household/join', { method: 'POST', body: { inviteCode } });
      state.user = result.user;
      state.household = result.household;
      syncUserAvatarUI();
      connectRealtime();
      await loadBaseData();
      await renderSettings();
    }, 'Joined household.');
  });

}

function kpiCard(label, value, subtext) {
  return `<article class="stat-card"><h3>${escapeHtml(label)}</h3><div class="kpi">${escapeHtml(value)} <small>${escapeHtml(subtext)}</small></div></article>`;
}

function mealPlanSummary(plan) {
  return `<div class="list-item"><div class="list-title"><strong>${titleCase(plan.mealType)}${plan.time ? ` · ${formatMealTime(plan.time)}` : ''}</strong><span class="badge ${plan.status === 'eaten' ? 'good' : plan.status === 'skipped' ? 'warn' : 'accent'}">${plan.status}</span></div><p>${escapeHtml(getPlanName(plan))}</p>${plan.notes ? `<p class="muted">${escapeHtml(plan.notes)}</p>` : ''}</div>`;
}

function suggestionItem(item) {
  return `<div class="list-item"><div class="list-title"><strong>${escapeHtml(item.name)}</strong><span class="badge accent">${item.type}</span></div><p class="muted">${escapeHtml(item.cuisine || 'Any cuisine')} • ${item.rating || 0}/5</p><p>${escapeHtml(item.reason)}</p></div>`;
}

function recipeItem(recipe) {
  return `
    <div class="list-item">
      <div class="list-title">
        <strong>${escapeHtml(recipe.name)}</strong>
        <span class="item-actions">
          ${recipe.originalScan ? `<button class="small-btn" type="button" data-view-recipe-scan="${recipe._id}">View Scan</button>` : ''}
          <button class="danger small-btn" data-delete-recipe="${recipe._id}">Delete</button>
        </span>
      </div>
      <div class="badge-row">
        ${(recipe.mealTypes || []).map(type => `<span class="badge accent">${escapeHtml(type)}</span>`).join('')}
        ${recipe.cuisine ? `<span class="badge">${escapeHtml(recipe.cuisine)}</span>` : ''}
        ${recipe.favorite ? '<span class="badge good">favorite</span>' : ''}
        ${recipe.importSource === 'printed' ? '<span class="badge">printed import</span>' : ''}
        ${recipe.aiCleaned ? `<span class="badge accent" title="AI confidence ${Math.round((Number(recipe.aiConfidence) || 0) * 100)}%">AI cleaned</span>` : ''}
        ${recipe.originalScan ? '<span class="badge">scan saved</span>' : ''}
      </div>
      <p class="muted">${formatDurationMinutes(recipe.prepTime || 0)} prep • ${formatDurationMinutes(recipe.cookTime || 0)} cook • ${starRating(recipe.rating || 0)} • cooked ${recipe.timesCooked || 0}x</p>
      ${(recipe.ingredients || []).length ? `<p>${recipe.ingredients.slice(0, 4).map(item => escapeHtml(item.name)).join(', ')}${recipe.ingredients.length > 4 ? '…' : ''}</p>` : ''}
    </div>
  `;
}



function getRestaurantCuisineList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function collectRestaurantCuisines(form) {
  const selected = [...form.querySelectorAll('[data-restaurant-cuisine-option]:checked')]
    .map(input => input.value)
    .filter(Boolean);
  return [...new Set(selected)].join(', ');
}

function addressAutocompleteDatalist() {
  const addresses = [state.household?.homeAddress, ...state.restaurants.map(restaurant => restaurant.location)]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const unique = [...new Set(addresses)];
  if (!unique.length) return '';
  return `<datalist id="address-autocomplete-options">${unique.map(address => `<option value="${escapeAttr(address)}"></option>`).join('')}</datalist>`;
}

function restaurantCuisinePicker(selectedValue = '', idPrefix = 'restaurant') {
  const selected = new Set(getRestaurantCuisineList(selectedValue).map(value => value.toLowerCase()));
  return `
    <fieldset class="restaurant-cuisine-field wide">
      <legend>Cuisine</legend>
      <input type="hidden" name="cuisine" value="${escapeAttr(getRestaurantCuisineList(selectedValue).join(', '))}" />
      <div class="restaurant-cuisine-options">
        ${restaurantCuisineOptions.map(cuisine => {
          const id = `${idPrefix}-cuisine-${slugify(cuisine)}`;
          const checked = selected.has(cuisine.toLowerCase()) ? 'checked' : '';
          return `
            <label class="restaurant-cuisine-option" for="${escapeAttr(id)}">
              <input id="${escapeAttr(id)}" type="checkbox" value="${escapeAttr(cuisine)}" data-restaurant-cuisine-option ${checked} />
              <span>${escapeHtml(cuisine)}</span>
            </label>
          `;
        }).join('')}
      </div>
    </fieldset>
  `;
}

function restaurantRandomFilterGroups() {
  const tagOptions = getRestaurantTagFilterOptions();
  return `
    <div class="slot-filter-group">
      <span class="slot-filter-label">Cuisine</span>
      <div class="slot-checkbox-grid">
        ${restaurantCuisineOptions.map(cuisine => slotCheckbox('cuisines', cuisine, cuisine)).join('')}
      </div>
    </div>
    ${tagOptions.length ? `
      <div class="slot-filter-group">
        <span class="slot-filter-label">Tags</span>
        <button class="secondary slot-tag-trigger" type="button" data-open-tag-filter>
          Choose Tags <span data-tag-count>0 selected</span>
        </button>
        <div class="slot-tag-modal" data-slot-tag-modal aria-hidden="true">
          <div class="slot-tag-modal-card" role="dialog" aria-modal="true" aria-label="Choose restaurant tags">
            <div class="slot-tag-modal-head">
              <div>
                <h4>Filter By Tags</h4>
                <p class="muted">Choose any tags to include in the spin.</p>
              </div>
              <button class="small-btn" type="button" data-close-tag-filter aria-label="Close tag filters">×</button>
            </div>
            <div class="slot-checkbox-grid slot-tag-grid">
              ${tagOptions.map(tag => slotCheckbox('tags', tag, tag)).join('')}
            </div>
            <div class="action-row modal-actions">
              <button class="primary small-btn" type="button" data-close-tag-filter>Done</button>
              <button class="ghost small-btn" type="button" data-clear-tag-filter>Clear</button>
            </div>
          </div>
        </div>
      </div>
    ` : ''}
    <div class="slot-filter-group single">
      ${slotNativeCheckbox('favoriteOnly', '1', 'Favorited only')}
      ${slotNativeCheckbox('wantToGoOnly', '1', 'Want To Go only')}
    </div>
  `;
}

function getRestaurantTagFilterOptions() {
  return [...new Set(state.restaurants.flatMap(restaurant => restaurant.tags || []))]
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function slotNativeCheckbox(name, value, label) {
  const id = `slot-${name}-${slugify(value) || 'option'}`;
  return `
    <label class="slot-native-check" for="${escapeAttr(id)}">
      <input id="${escapeAttr(id)}" type="checkbox" name="${escapeAttr(name)}" value="${escapeAttr(value)}" />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function slotCheckbox(name, value, label, ariaLabel = '') {
  const id = `slot-${name}-${slugify(value) || 'option'}`;
  const labelText = ariaLabel || label;
  return `
    <label class="slot-check" for="${escapeAttr(id)}" aria-label="${escapeAttr(labelText)}">
      <input id="${escapeAttr(id)}" type="checkbox" name="${escapeAttr(name)}" value="${escapeAttr(value)}" />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}


function bindSlotTagFilterModal(form) {
  if (!form) return;
  const modal = form.querySelector('[data-slot-tag-modal]');
  const count = form.querySelector('[data-tag-count]');
  if (!modal) return;

  document.body.appendChild(modal);

  const tagInputs = () => [...modal.querySelectorAll('[name="tags"]')];
  const updateCount = () => {
    if (!count) return;
    const selected = tagInputs().filter(input => input.checked).length;
    count.textContent = selected ? `${selected} selected` : '0 selected';
  };
  const close = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('slot-tag-modal-open');
  };
  const open = () => {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('slot-tag-modal-open');
    requestAnimationFrame(() => modal.querySelector('[data-close-tag-filter]')?.focus());
  };

  form.querySelector('[data-open-tag-filter]')?.addEventListener('click', event => {
    event.preventDefault();
    open();
  });
  modal.querySelectorAll('[data-close-tag-filter]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      close();
    });
  });
  modal.querySelector('[data-clear-tag-filter]')?.addEventListener('click', event => {
    event.preventDefault();
    tagInputs().forEach(input => { input.checked = false; });
    updateCount();
  });
  modal.addEventListener('pointerdown', event => {
    if (event.target === modal) close();
  });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  tagInputs().forEach(input => input.addEventListener('change', updateCount));
  updateCount();
}

function normalizeExternalUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '#';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function mapLinkForAddress(address) {
  const value = String(address || '').trim();
  if (!value) return '#';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
}

function slotMachinePlaceholder() {
  return `
    <div class="slot-machine-window slot-machine-trigger" data-spin-slot role="button" tabindex="0" aria-label="Spin for a restaurant" aria-live="polite">
      <div class="slot-reel winner"><span>Tap To Spin</span></div>
    </div>
    <p class="muted slot-machine-hint">Tap the reel to choose from the restaurants that match your filters.</p>
  `;
}

function getRandomRestaurantFilters(form) {
  const formData = new FormData(form);
  const selectedTags = [...document.querySelectorAll('body > [data-slot-tag-modal] [name="tags"]:checked')]
    .map(input => String(input.value || '').toLowerCase());
  return {
    maxPrice: String(formData.get('maxPrice') || ''),
    minRating: Number(formData.get('minRating') || 0),
    maxDistance: Number(formData.get('maxDistance') || 0),
    cuisines: formData.getAll('cuisines').map(value => String(value).toLowerCase()),
    tags: selectedTags,
    favoriteOnly: formData.get('favoriteOnly') === '1',
    wantToGoOnly: formData.get('wantToGoOnly') === '1'
  };
}

function getFilteredRandomRestaurants(filters) {
  const maxPriceRank = filters.maxPrice ? filters.maxPrice.length : Infinity;
  return state.restaurants.filter(restaurant => {
    const priceRank = String(restaurant.priceLevel || '$$').length;
    const cuisines = getRestaurantCuisineList(restaurant.cuisine).map(value => value.toLowerCase());
    const tags = (restaurant.tags || []).map(value => String(value).toLowerCase());
    const rating = Number(restaurant.rating || 0);

    if (priceRank > maxPriceRank) return false;
    if (filters.minRating && rating < filters.minRating) return false;
    if (filters.cuisines.length && !filters.cuisines.some(cuisine => cuisines.includes(cuisine))) return false;
    if (filters.tags.length && !filters.tags.some(tag => tags.includes(tag))) return false;
    if (filters.favoriteOnly && !restaurant.favorite) return false;
    if (filters.wantToGoOnly && !restaurant.wantToGo) return false;
    if (filters.maxDistance) {
      const distance = Number(restaurant.distanceMiles);
      if (!Number.isFinite(distance) || distance > filters.maxDistance) return false;
    }
    return true;
  });
}

function pickWeightedRestaurant(restaurants) {
  if (!restaurants.length) return null;
  const now = Date.now();
  const weighted = restaurants.flatMap(restaurant => {
    const ratingBoost = Math.max(1, Math.round(Number(restaurant.rating || 0) + 1));
    const favoriteBoost = restaurant.favorite ? 3 : 0;
    const daysSince = restaurant.lastVisitedAt
      ? Math.min(14, Math.floor((now - new Date(restaurant.lastVisitedAt).getTime()) / 86400000))
      : 14;
    const recencyBoost = Math.max(1, Math.floor(daysSince / 3));
    return Array.from({ length: ratingBoost + favoriteBoost + recencyBoost }, () => restaurant);
  });
  return weighted[Math.floor(Math.random() * weighted.length)] || restaurants[Math.floor(Math.random() * restaurants.length)];
}

function spinRandomRestaurant(form) {
  const resultRoot = $('#random-result');
  if (!resultRoot || resultRoot.dataset.spinning === '1') return;

  const filters = getRandomRestaurantFilters(form);
  const candidates = getFilteredRandomRestaurants(filters);

  if (!candidates.length) {
    resultRoot.innerHTML = '<div class="empty">No saved restaurants match those filters.</div>';
    return;
  }

  const pick = pickWeightedRestaurant(candidates);
  const reelItems = candidates.length >= 3 ? candidates : [...candidates, ...candidates, ...candidates];
  let tick = 0;
  let lastSwap = 0;
  const duration = 1750;
  const startTime = performance.now();
  resultRoot.dataset.spinning = '1';
  resultRoot.classList.add('spinning');
  resultRoot.innerHTML = `
    <div class="slot-machine-window slot-machine-trigger spinning" data-spin-slot role="button" tabindex="-1" aria-disabled="true" aria-label="Restaurant selector spinning" aria-live="polite">
      <div class="slot-reel winner"><span>${escapeHtml(reelItems[0]?.name || 'Spin')}</span></div>
    </div>
    <p class="muted slot-machine-hint">Spinning through ${candidates.length} matching ${candidates.length === 1 ? 'spot' : 'spots'}...</p>
  `;

  const animateSpin = now => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const swapDelay = 42 + easedProgress * 128;
    const reel = resultRoot.querySelector('.slot-reel span');

    if (reel && now - lastSwap >= swapDelay) {
      tick += 1;
      lastSwap = now;
      const restaurant = reelItems[tick % reelItems.length];
      reel.classList.remove('slot-name-swap');
      void reel.offsetWidth;
      reel.textContent = restaurant?.name || 'Restaurant';
      reel.classList.add('slot-name-swap');
    }

    if (progress < 1) {
      window.requestAnimationFrame(animateSpin);
      return;
    }

    delete resultRoot.dataset.spinning;
    resultRoot.classList.remove('spinning');
    resultRoot.innerHTML = renderSlotMachinePick(pick, candidates.length);
  };

  window.requestAnimationFrame(animateSpin);
}

function renderSlotMachinePick(restaurant, poolSize) {
  const dishes = (restaurant.favoriteDishes || []).join(', ');
  const tags = (restaurant.tags || []).join(', ');
  return `
    <div class="slot-machine-pick">
      <div class="slot-machine-window slot-machine-trigger settled" data-spin-slot role="button" tabindex="0" aria-label="Spin again for another restaurant">
        <div class="slot-reel winner"><span>${escapeHtml(restaurant.name || 'Restaurant')}</span></div>
      </div>
      <div class="slot-pick-details">
        <div>
          <strong>${escapeHtml(restaurant.name || 'Restaurant')}</strong>
          <p class="muted">${escapeHtml(restaurant.cuisine || 'Any cuisine')} • ${escapeHtml(restaurant.priceLevel || '$$')} • ${starRating(restaurant.rating || 0)}${restaurantDistanceText(restaurant) ? ` • ${escapeHtml(restaurantDistanceText(restaurant))}` : ''}</p>
        </div>
        <span class="badge accent">${poolSize} match${poolSize === 1 ? '' : 'es'}</span>
      </div>
      ${dishes ? `<p><strong>Go-to:</strong> ${escapeHtml(dishes)}</p>` : ''}
      ${tags ? `<p class="muted">${escapeHtml(tags)}</p>` : ''}
    </div>
  `;
}

function hasHouseholdHomeCoordinates() {
  const coordinates = state.household?.homeCoordinates;
  return coordinates?.lat !== null && coordinates?.lat !== undefined && coordinates?.lat !== ''
    && coordinates?.lng !== null && coordinates?.lng !== undefined && coordinates?.lng !== ''
    && Number.isFinite(Number(coordinates.lat))
    && Number.isFinite(Number(coordinates.lng));
}

function restaurantDistanceText(restaurant) {
  if (restaurant?.distanceMiles === null || restaurant?.distanceMiles === undefined || restaurant?.distanceMiles === '') return '';
  const distance = Number(restaurant.distanceMiles);
  if (!Number.isFinite(distance)) return '';
  return distance < 10 ? `${distance.toFixed(1)} mi` : `${Math.round(distance)} mi`;
}

function getSortedRestaurants(source = state.restaurants) {
  const items = [...source];
  const sortMode = state.restaurantSort || 'favorite';
  const nameCompare = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });

  return items.sort((a, b) => {
    if (sortMode === 'name') return nameCompare(a, b);
    if (sortMode === 'rating') return (Number(b.rating || 0) - Number(a.rating || 0)) || nameCompare(a, b);
    if (sortMode === 'cuisine') return String(a.cuisine || 'zz').localeCompare(String(b.cuisine || 'zz'), undefined, { sensitivity: 'base' }) || nameCompare(a, b);
    if (sortMode === 'price') return String(a.priceLevel || '').length - String(b.priceLevel || '').length || nameCompare(a, b);
    if (sortMode === 'recent') return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    return Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  });
}

function restaurantSortOptions() {
  const options = [
    ['favorite', 'Favorites first'],
    ['recent', 'Recently updated'],
    ['name', 'Name A–Z'],
    ['rating', 'Highest rated'],
    ['cuisine', 'Cuisine'],
    ['price', 'Price']
  ];
  return options.map(([value, label]) => option(value, label, state.restaurantSort || 'favorite')).join('');
}


function wantToGoRestaurantItem(restaurant) {
  const distance = restaurantDistanceText(restaurant);
  return `
    <article class="want-to-go-item" data-restaurant-card="${restaurant._id}">
      <strong>${escapeHtml(restaurant.name || 'Restaurant')}</strong>
      ${restaurant.location ? `<a href="${escapeAttr(mapLinkForAddress(restaurant.location))}" target="_blank" rel="noopener">${escapeHtml(restaurant.location)}</a>` : '<span class="muted">No location saved</span>'}
      ${distance ? `<span class="restaurant-distance"><i class="ti ti-route"></i>${escapeHtml(distance)}</span>` : ''}
    </article>
  `;
}

function restaurantItem(restaurant) {
  if (String(state.editingRestaurantId) === String(restaurant._id)) return restaurantEditCard(restaurant);
  const dishes = (restaurant.favoriteDishes || []).join(', ');
  const tags = (restaurant.tags || []).join(', ');
  const isMenuOpen = String(state.openRestaurantMenuId) === String(restaurant._id);
  return `
    <article class="restaurant-card" data-restaurant-card="${restaurant._id}">
      <div class="restaurant-card-top">
        <div class="restaurant-card-titleblock">
          <h3>${escapeHtml(restaurant.name)}</h3>
          <p class="muted">${escapeHtml(restaurant.cuisine || 'Any cuisine')}</p>
          <p class="restaurant-price-line">${escapeHtml(restaurant.priceLevel || '$$')}</p>
        </div>
        <div class="restaurant-card-controls">
          <button class="restaurant-favorite-btn ${restaurant.favorite ? 'active' : ''}" type="button" data-favorite-restaurant="${restaurant._id}" aria-label="${restaurant.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${restaurant.favorite ? 'true' : 'false'}">
            <span class="material-symbols-outlined" aria-hidden="true">favorite</span>
          </button>
          <div class="restaurant-menu-wrap">
            <button class="restaurant-kebab-btn" type="button" data-restaurant-menu="${restaurant._id}" aria-label="Restaurant actions" aria-expanded="${isMenuOpen ? 'true' : 'false'}">
              <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
            </button>
            <div class="restaurant-action-menu ${isMenuOpen ? 'open' : ''}">
              <button type="button" data-edit-restaurant="${restaurant._id}">Edit</button>
              <button class="danger-menu-item" type="button" data-delete-restaurant="${restaurant._id}">Delete</button>
            </div>
          </div>
        </div>
      </div>
      <div class="badge-row">
        ${restaurant.cuisine ? `<span class="badge accent">${escapeHtml(restaurant.cuisine)}</span>` : ''}
        <span class="badge">${starRating(restaurant.rating || 0)}</span>
      </div>
      ${dishes ? `<p><strong>Go-to:</strong> ${escapeHtml(dishes)}</p>` : ''}
      ${tags ? `<p class="muted">${escapeHtml(tags)}</p>` : ''}
      ${restaurant.location ? `<p class="restaurant-location"><a href="${escapeAttr(mapLinkForAddress(restaurant.location))}" target="_blank" rel="noopener">${escapeHtml(restaurant.location)}</a></p>` : ''}
      ${restaurantDistanceText(restaurant) ? `<p class="restaurant-distance"><i class="ti ti-route"></i>${escapeHtml(restaurantDistanceText(restaurant))}</p>` : ''}
      ${restaurant.link ? `<p class="restaurant-link"><a href="${escapeAttr(normalizeExternalUrl(restaurant.link))}" target="_blank" rel="noopener">Open Link</a></p>` : ''}
      <p class="muted restaurant-visits">Visited ${restaurant.timesVisited || 0}x</p>
    </article>
  `;
}

function restaurantUpdateBody(restaurant, overrides = {}) {
  return {
    name: restaurant.name || '',
    cuisine: restaurant.cuisine || '',
    priceLevel: restaurant.priceLevel || '$$',
    location: restaurant.location || '',
    link: restaurant.link || '',
    favoriteDishes: restaurant.favoriteDishes || [],
    tags: restaurant.tags || [],
    rating: Number(restaurant.rating || 0),
    favorite: Boolean(restaurant.favorite),
    wantToGo: Boolean(restaurant.wantToGo),
    ...overrides
  };
}

function restaurantEditCard(restaurant) {
  return `
    <article class="restaurant-card restaurant-card-editing">
      <form class="restaurant-edit-form" data-restaurant-edit-form="${restaurant._id}">
        <h3>Edit Restaurant</h3>
        <div class="form-grid restaurant-edit-grid">
          <label>Name<input name="name" required value="${escapeAttr(restaurant.name || '')}" /></label>
          ${restaurantCuisinePicker(restaurant.cuisine || '', `edit-restaurant-${restaurant._id}`)}
          <label>Price<select name="priceLevel">${['$', '$$', '$$$', '$$$$'].map(value => option(value, value, restaurant.priceLevel || '$$')).join('')}</select></label>
          <label>Rating<select name="rating">${ratingOptions(restaurant.rating || 0)}</select></label>
          <label class="wide">Address<input name="location" value="${escapeAttr(restaurant.location || '')}" autocomplete="street-address" list="address-autocomplete-options" /></label>
          <label class="wide">Link<input name="link" type="url" value="${escapeAttr(restaurant.link || '')}" /></label>
          <label>Favorite Dishes<input name="favoriteDishes" value="${escapeAttr((restaurant.favoriteDishes || []).join(', '))}" /></label>
          <label>Tags<input name="tags" value="${escapeAttr((restaurant.tags || []).join(', '))}" /></label>
          <label class="wide checkbox-line restaurant-favorite"><input type="checkbox" name="favorite" ${restaurant.favorite ? 'checked' : ''} /> Favorite</label>
          <label class="wide checkbox-line restaurant-want-to-go"><input type="checkbox" name="wantToGo" ${restaurant.wantToGo ? 'checked' : ''} /> Want To Go</label>
        </div>
        <div class="restaurant-card-actions">
          <button class="primary small-btn" type="submit">Save</button>
          <button class="ghost small-btn" type="button" data-cancel-restaurant-edit>Cancel</button>
        </div>
      </form>
    </article>
  `;
}

function groceryGroup(category, items) {
  return `
    <div class="list-item">
      <h3>${escapeHtml(category)}</h3>
      <div class="list">
        ${items.map(item => `
          <div class="grocery-item ${item.checked ? 'checked' : ''}">
            <input type="checkbox" data-check-grocery="${item._id}" ${item.checked ? 'checked' : ''} />
            <div>
              <strong class="grocery-name">${escapeHtml(item.name)}</strong>
              <p class="muted">${escapeHtml([item.quantity, item.unit].filter(Boolean).join(' ') || 'No quantity')}</p>
            </div>
            <button class="danger small-btn" data-delete-grocery="${item._id}">Delete</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function historyItem(item) {
  return `
    <div class="list-item">
      <div class="list-title">
        <strong>${escapeHtml(item.name)}</strong>
        ${state.page === 'history' ? `<button class="danger small-btn" data-delete-history="${item._id}">Delete</button>` : `<span class="badge">${item.date}</span>`}
      </div>
      <div class="badge-row">
        <span class="badge accent">${escapeHtml(item.mealType)}</span>
        <span class="badge">${escapeHtml(item.sourceType)}</span>
        ${item.cuisine ? `<span class="badge">${escapeHtml(item.cuisine)}</span>` : ''}
      </div>
      <p class="muted">${item.date} • ${item.rating || 0}/5${item.cost ? ` • $${Number(item.cost).toFixed(2)}` : ''}</p>
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ''}
    </div>
  `;
}

function statBar(name, count, max) {
  const width = Math.max(4, Math.round((count / max) * 100));
  return `<div><div class="list-title"><strong>${escapeHtml(name)}</strong><span class="muted">${count}</span></div><div class="bar"><span style="--w:${width}%"></span></div></div>`;
}

function option(value, label, selected) {
  return `<option value="${escapeAttr(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function ratingOptions(selected = 0) {
  return [0, 1, 2, 3, 4, 5].map(value => option(value, value ? '★'.repeat(value) : 'No rating', selected)).join('');
}

function recipeRatingOptions(selected = 3) {
  return [1, 2, 3, 4, 5]
    .map(value => option(value, '★'.repeat(value), selected))
    .join('');
}

function starRating(value) {
  const rating = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  const stars = '★'.repeat(rating);
  return `<span class="star-rating" aria-label="${rating} out of 5 stars">${stars}</span>`;
}

function durationInputsToMinutes(form, prefix) {
  const hoursInput = form.querySelector(`[name="${prefix}Hours"]`);
  const minutesInput = form.querySelector(`[name="${prefix}Minutes"]`);
  const hours = Math.max(0, parseInt(hoursInput?.value || '0', 10) || 0);
  const minutes = Math.max(0, Math.min(59, parseInt(minutesInput?.value || '0', 10) || 0));
  return (hours * 60) + minutes;
}

function formatDurationMinutes(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formToBody(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function groupBy(items, getter) {
  return items.reduce((groups, item) => {
    const key = getter(item);
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function getPlanName(plan) {
  if (!plan) return '';
  if (plan.sourceType === 'recipe') return state.recipes.find(recipe => String(recipe._id) === String(plan.sourceId))?.name || plan.customName || 'Recipe';
  if (plan.sourceType === 'restaurant') return state.restaurants.find(restaurant => String(restaurant._id) === String(plan.sourceId))?.name || plan.customName || 'Restaurant';
  return plan.customName || buildCustomMealName(plan.customProtein, plan.customSides || []);
}

function titleCase(value) {
  return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}


function getPlannerDisplayDays() {
  if (state.plannerView === '1week') return 7;
  if (state.plannerView === '3weeks') return 21;
  if (state.plannerView === 'month') return 42;
  return 14;
}

function getPlannerRangeStart() {
  if (state.plannerDisplay === 'cards' && state.plannerCenterToday && !state.plannerPreviousWeek) {
    return addDays(dateISO(new Date()), -3);
  }
  const baseStart = state.plannerPreviousWeek ? addDays(state.weekStart, -7) : state.weekStart;
  if (state.plannerView === 'month') return startOfMonthGrid(baseStart);
  return baseStart;
}

function getPlannerRangeLabel() {
  const dates = state.planner?.dates || [];
  if (!dates.length) return 'No dates loaded';
  const start = plannerRangeDateFormatter.format(new Date(`${dates[0]}T12:00:00`));
  const end = plannerRangeDateFormatter.format(new Date(`${dates[dates.length - 1]}T12:00:00`));
  return `${start} – ${end}`;
}

function startOfMonthGrid(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0);
  return startOfWeek(first);
}

function movePlannerPeriod(direction) {
  if (state.plannerView === 'month') {
    state.weekStart = addMonths(state.weekStart, direction);
    return;
  }
  state.weekStart = addDays(state.weekStart, direction * getPlannerDisplayDays());
}

function addMonths(isoDate, months) {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return startOfWeek(date);
}

function plannerStatusMarkup(status) {
  if (status === 'eaten') return '<span class="meal-checkmark" aria-label="Eaten" title="Eaten">✓</span>';
  if (status === 'skipped') return '<span class="badge warn">skipped</span>';
  return '';
}

function dateISO(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  return dateISO(copy);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateISO(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function formatInviteCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .split('')
    .map(char => `<span>${escapeHtml(char)}</span>`)
    .join('');
}

async function exportUserData() {
  try {
    const response = await fetch('/api/export/user-data', {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Export failed: ${response.status}`);

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const householdName = slugify(data.household?.name || 'homeplate');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${householdName}-user-data-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('User data exported.');
  } catch (error) {
    showToast(error.message || 'Unable to export user data.');
  }
}

function slugify(value) {
  return String(value || 'homeplate')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'homeplate';
}

function buildInviteMailto(email, householdName, inviteCode) {
  const subject = `Join ${householdName || 'my household'} on HomePlate`;
  const body = [
    `I sent you an invite to join ${householdName || 'my household'} on HomePlate.`,
    '',
    `Create an account and use this household invite code: ${String(inviteCode || '').toUpperCase()}`,
    '',
    'After signing up, enter the invite code to join the shared meal planner.'
  ].join('\n');
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyTextToClipboard(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('No text to copy.');
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Copy failed.');
}

function escapeInitials(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return escapeHtml((parts.length ? parts.slice(0, 2).map(part => part[0]).join('') : 'U').toUpperCase());
}

function avatarMarkup(user, variant = '') {
  const profilePic = user?.profilePic || '';
  const name = user?.name || 'User';
  const variantClass = variant ? ` user-avatar--${variant}` : '';
  return `
    <span class="user-avatar${variantClass}" aria-label="${escapeAttr(name)} avatar">
      ${profilePic ? `<img class="user-avatar-img" src="${escapeAttr(profilePic)}" alt="${escapeAttr(name)} profile picture" />` : `<span class="user-avatar-fallback">${escapeInitials(name)}</span>`}
    </span>
  `;
}

function syncUserAvatarUI() {
  const name = state.user?.name || 'User';
  const profilePic = state.user?.profilePic || '';
  const avatarTargets = [
    { name: $('#topnav-user-name'), image: $('#topnav-avatar-img'), fallback: $('#topnav-avatar-fallback') },
    { name: $('#mobile-sidebar-user-name'), image: $('#mobile-sidebar-avatar-img'), fallback: $('#mobile-sidebar-avatar-fallback') }
  ];

  avatarTargets.forEach(target => {
    if (target.name) target.name.textContent = name;
    if (target.image) {
      target.image.src = profilePic;
      target.image.classList.toggle('hidden', !profilePic);
    }
    if (target.fallback) {
      target.fallback.textContent = escapeInitials(name).replace(/&amp;/g, '&');
      target.fallback.classList.toggle('hidden', Boolean(profilePic));
    }
  });
}

async function updateAccount(payload) {
  const result = await api('/api/account', { method: 'PUT', body: payload });
  if (result.user) {
    state.user = result.user;
    syncUserAvatarUI();
  }
  return result;
}

async function imageFileToOptimizedDataUrl(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');

  const rawDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });

  const sourceImage = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to process the selected image.'));
    image.src = rawDataUrl;
  });

  const avatarSize = 512;
  const sourceWidth = Math.max(1, sourceImage.naturalWidth || sourceImage.width || 1);
  const sourceHeight = Math.max(1, sourceImage.naturalHeight || sourceImage.height || 1);
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const cropX = Math.round((sourceWidth - cropSize) / 2);
  const cropY = Math.round((sourceHeight - cropSize) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = avatarSize;
  canvas.height = avatarSize;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return rawDataUrl;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#e8e8ee';
  context.fillRect(0, 0, avatarSize, avatarSize);
  context.drawImage(sourceImage, cropX, cropY, cropSize, cropSize, 0, 0, avatarSize, avatarSize);
  let optimized = canvas.toDataURL('image/webp', 0.88);
  if (!optimized || optimized === 'data:,') optimized = canvas.toDataURL('image/jpeg', 0.88);
  if (optimized.length > 1500000) throw new Error('Avatar image is too large. Please choose a smaller image.');
  return optimized;
}



function getDefaultMealTime(mealType) {
  if (mealType === 'breakfast') return '08:00';
  if (mealType === 'lunch') return '12:30';
  return '18:30';
}

function formatMealTime(value) {
  if (!value) return '';
  const [hour, minute] = String(value).split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function getStoredTheme() {
  return 'light';
}

function applyTheme(theme) {
  const safeTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = safeTheme;
}

let tactileAudioContext = null;
let lastTactileSoundAt = 0;

function bindTactileSounds() {
  document.addEventListener('pointerdown', event => {
    const target = event.target.closest('button, .nav-item, input[type="checkbox"]');
    if (!target || target.disabled) return;
    playTactileSound();
  }, { capture: true });
}

function playTactileSound() {
  const now = performance.now();
  if (now - lastTactileSoundAt < 45) return;
  lastTactileSoundAt = now;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  tactileAudioContext ||= new AudioContextClass();

  const context = tactileAudioContext;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(420, start);
  oscillator.frequency.exponentialRampToValueAtTime(220, start + 0.035);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.025, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.055);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.06);
}

function getStoredAccentColor() {
  return defaultAccentColor;
}

function applyAccentColor(color = defaultAccentColor) {
  const accent = defaultAccentColor;
  const root = document.documentElement;
  root.style.setProperty('--brand', accent);
  root.style.setProperty('--brand-hover', shadeHex(accent, -12));
  root.style.setProperty('--brand-light', hexToRgba(accent, 0.12));
  root.style.setProperty('--brand-border', hexToRgba(accent, 0.22));
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-2', shadeHex(accent, -12));
}

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(clean)) return { r: 74, g: 19, b: 240 };
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shadeHex(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  const shade = channel => Math.max(0, Math.min(255, Math.round(channel + (percent / 100) * 255)));
  return `#${[shade(r), shade(g), shade(b)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}



function isMobileWebSidebarViewport() {
  return window.matchMedia('(max-width: 980px)').matches;
}

function renderPanelEdgeToggleIcon(isOpen) {
  const panelEdgeToggle = document.getElementById('panelEdgeToggle');
  if (!panelEdgeToggle) return;

  panelEdgeToggle.innerHTML = `<svg class="icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
    </svg>`;
  panelEdgeToggle.setAttribute('aria-label', isOpen && isMobileWebSidebarViewport() ? 'Sidebar open' : 'Open sidebar');
  panelEdgeToggle.setAttribute('aria-expanded', String(Boolean(isOpen) && isMobileWebSidebarViewport()));
}

function scrollMobileWebSidebarToTop() {
  if (!isMobileWebSidebarViewport()) return;
  const controlPanel = document.getElementById('controlPanel');
  const scrollInner = controlPanel?.querySelector?.('.control-panel-scroll-inner');

  [controlPanel, scrollInner].forEach(element => {
    if (!element) return;
    element.scrollTop = 0;
    element.scrollLeft = 0;
    if (typeof element.scrollTo === 'function') {
      try {
        element.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch (error) {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
    }
  });
}

function setMobileWebSidebarOpen(isOpen) {
  const nextOpen = Boolean(isOpen) && isMobileWebSidebarViewport();
  document.body.classList.toggle('mobile-drawer-open', nextOpen);
  document.body.classList.remove('mobile-sidebar-open');

  const controlPanel = document.getElementById('controlPanel');
  if (controlPanel) controlPanel.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');

  if (nextOpen) {
    scrollMobileWebSidebarToTop();
    requestAnimationFrame(scrollMobileWebSidebarToTop);
  }

  renderPanelEdgeToggleIcon(nextOpen);
}

function closeMobileWebSidebarForModal() {
  if (!isMobileWebSidebarViewport()) return;
  setMobileWebSidebarOpen(false);
}

function syncMobileAppBarHeight() {
  const topnav = document.querySelector('.topnav');
  const root = document.documentElement;
  if (!topnav || !root) return;

  if (!isMobileWebSidebarViewport()) {
    root.style.removeProperty('--mobile-app-bar-height');
    return;
  }

  const measuredHeight = Math.ceil(topnav.getBoundingClientRect().height || 0);
  root.style.setProperty('--mobile-app-bar-height', `${measuredHeight > 0 ? measuredHeight : 54}px`);
}

function initializeMobileWebSidebar() {
  const controlPanel = document.getElementById('controlPanel');
  const panelEdgeToggle = document.getElementById('panelEdgeToggle');
  if (!controlPanel || !panelEdgeToggle) return;

  const isSidebarOpen = () => document.body.classList.contains('mobile-drawer-open');
  const isInsideSidebar = target => Boolean(target?.closest?.('#controlPanel'));
  const isToggle = target => Boolean(target?.closest?.('#panelEdgeToggle'));
  const isModalOpen = () => Boolean(document.querySelector('#meal-time-modal.open, .time-modal-overlay.open'));

  const syncMobileSidebarState = () => {
    syncMobileAppBarHeight();

    if (!isMobileWebSidebarViewport()) {
      setMobileWebSidebarOpen(false);
      controlPanel.removeAttribute('aria-hidden');
      renderPanelEdgeToggleIcon(false);
      requestAnimationFrame(updateActiveNavHover);
      return;
    }

    controlPanel.setAttribute('aria-hidden', isSidebarOpen() ? 'false' : 'true');
    renderPanelEdgeToggleIcon(isSidebarOpen());
  };

  panelEdgeToggle.addEventListener('click', event => {
    if (!isMobileWebSidebarViewport()) return;
    event.preventDefault();
    event.stopPropagation();
    setMobileWebSidebarOpen(!isSidebarOpen());
  });

  controlPanel.querySelectorAll('[data-mobile-drawer-close]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setMobileWebSidebarOpen(false);
    });
  });

  document.addEventListener('click', event => {
    if (!isMobileWebSidebarViewport() || !isSidebarOpen() || isModalOpen()) return;
    if (isInsideSidebar(event.target) || isToggle(event.target)) return;
    setMobileWebSidebarOpen(false);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isMobileWebSidebarViewport() && isSidebarOpen()) {
      setMobileWebSidebarOpen(false);
    }
  });

  window.addEventListener('resize', syncMobileSidebarState);
  window.addEventListener('orientationchange', () => requestAnimationFrame(syncMobileSidebarState));

  if (typeof ResizeObserver !== 'undefined') {
    const topnav = document.querySelector('.topnav');
    if (topnav) {
      window.__homeplateMobileTopnavObserver?.disconnect?.();
      window.__homeplateMobileTopnavObserver = new ResizeObserver(() => syncMobileAppBarHeight());
      window.__homeplateMobileTopnavObserver.observe(topnav);
    }
  }

  requestAnimationFrame(syncMobileSidebarState);
  syncMobileSidebarState();
}

function setupMagneticNav() {
  return;
  const navList = document.querySelector('.topnav-nav');
  const navLinks = [...document.querySelectorAll('.topnav-nav .nav-item')];
  if (!navList || !navLinks.length) return;

  let clearNavTimer = null;

  navLinks.forEach(link => {
    link.addEventListener('pointerenter', () => {
      clearTimeout(clearNavTimer);
      setNavHover(link);
    });

    link.addEventListener('focus', () => {
      clearTimeout(clearNavTimer);
      setNavHover(link);
    });
  });

  navList.addEventListener('pointermove', event => {
    clearTimeout(clearNavTimer);
    const link = event.target.closest('.nav-item');
    if (link && navList.contains(link)) setNavHover(link);
  });

  navList.addEventListener('pointerleave', () => {
    clearTimeout(clearNavTimer);
    clearNavTimer = setTimeout(updateActiveNavHover, 450);
  });

  navList.addEventListener('focusout', event => {
    if (!navList.contains(event.relatedTarget)) updateActiveNavHover();
  });

  window.addEventListener('resize', updateActiveNavHover);
}

function setNavHover(link) {
  return;
  if (isMobileWebSidebarViewport()) return;
  const navList = document.querySelector('.topnav-nav');
  if (!navList || !link || appShell.classList.contains('hidden')) return;
  const navRect = navList.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  if (!linkRect.width || !linkRect.height) return;
  navList.style.setProperty('--nav-hover-x', `${linkRect.left - navRect.left}px`);
  navList.style.setProperty('--nav-hover-y', `${linkRect.top - navRect.top}px`);
  navList.style.setProperty('--nav-hover-w', `${linkRect.width}px`);
  navList.style.setProperty('--nav-hover-h', `${linkRect.height}px`);
  navList.style.setProperty('--nav-hover-opacity', '1');
}

function updateActiveNavHover() {
  return;
  const active = document.querySelector('.topnav-nav .nav-item.active') || document.querySelector('.topnav-nav .nav-item');
  if (active) setNavHover(active);
}

function showToast(message) {
  toast.textContent = message;
  window.clearTimeout(showToast.timeout);
  window.clearTimeout(showToast.hideTimeout);
  toast.classList.remove('hidden');
  requestAnimationFrame(() => toast.classList.add('show'));
  showToast.timeout = window.setTimeout(() => {
    toast.classList.remove('show');
    showToast.hideTimeout = window.setTimeout(() => toast.classList.add('hidden'), 220);
  }, 3200);
}
