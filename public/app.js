const mealTypes = ['breakfast', 'lunch', 'dinner'];
const restaurantCuisineOptions = ['American', 'Asian', 'BBQ', 'Chinese', 'German', 'Italian', 'Japanese', 'Korean', 'Mexican'];
const accentColorOptions = ['#4A13F0', '#F0134A', '#B913F0', '#F0B913', '#4AF013'];
const defaultAccentColor = '#4A13F0';
const dayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const plannerWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const plannerDateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const state = {
  token: getStoredToken(),
  user: null,
  household: null,
  page: 'planner',
  weekStart: startOfWeek(new Date()),
  plannerView: localStorage.getItem('mealPlannerView') || '2weeks',
  plannerDisplay: localStorage.getItem('mealPlannerDisplay') || 'cards',
  plannerPreviousWeek: localStorage.getItem('mealPlannerPreviousWeek') === '1',
  recipes: [],
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
  socket: null,
  realtimeRefreshTimer: null,
  realtimeRefreshInFlight: false,
  realtimeRefreshQueued: false
};

let recipeImportScan = { dataUrl: '', name: '', type: '' };

const $ = selector => document.querySelector(selector);
const pageRoot = $('#page-root');
const toast = $('#toast');
const authScreen = $('#auth-screen');
const appShell = $('#app-shell');

init();

function init() {
  applyTheme('light');
  applyAccentColor(defaultAccentColor);
  $('#today-label').textContent = fullDateFormatter.format(new Date());
  bindAuth();
  bindShell();
  bindTactileSounds();
  initializeMobileWebSidebar();

  if (state.token) {
    bootApp().catch(() => logout());
  }
}

function bindAuth() {
  document.querySelectorAll('[data-auth-tab]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.classList.remove('active'));
      button.classList.add('active');
      const mode = button.dataset.authTab;
      $('#login-form').classList.toggle('hidden', mode !== 'login');
      $('#signup-form').classList.toggle('hidden', mode !== 'signup');
      $('#auth-error').textContent = '';
    });
  });

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

  $('#household-banner-btn')?.addEventListener('click', async () => {
    await openSettingsPage('household');
  });

  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', async () => {
      state.page = button.dataset.page;
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

  $('#quick-suggest-btn').addEventListener('click', async () => {
    state.page = 'dashboard';
    setActiveNav('dashboard');
    await loadSuggestions({ mealType: 'dinner' });
    renderDashboard();
    showToast('Dinner suggestions refreshed.');
  });

  $('#quick-random-btn').addEventListener('click', async () => {
    state.page = 'restaurants';
    setActiveNav('restaurants');
    await loadRestaurants();
    renderRestaurants();
    setTimeout(() => $('#random-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  });
}

async function bootApp() {
  const me = await api('/api/me');
  state.user = me.user;
  state.household = me.household;
  connectRealtime();
  $('#household-name').textContent = me.household?.name || 'Meal Planner';
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
    $('#household-name').textContent = me.household?.name || 'Meal Planner';
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
  updateHouseholdBannerVisibility();
  if (state.page === 'dashboard') return renderDashboard();
  if (state.page === 'planner') return renderPlanner();
  if (state.page === 'recipes') return renderRecipes();
  if (state.page === 'restaurants') return renderRestaurants();
  if (state.page === 'grocery') return renderGrocery();
  if (state.page === 'history') return renderHistory();
  if (state.page === 'stats') return renderStats();
  if (state.page === 'settings') return renderSettings();
}

function updateHouseholdBannerVisibility() {
  const button = $('#household-banner-btn');
  if (!button) return;
  button.classList.toggle('hidden', state.page === 'settings');
}

function setActiveNav(page) {
  appShell.dataset.page = page;
  document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  $('#page-title').textContent = titleCase(page === 'grocery' ? 'Grocery List' : page);
  updateHouseholdBannerVisibility();
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

  pageRoot.innerHTML = `
    <section class="form-card planner-toolbar">
      <div class="planner-toolbar-copy">
        <h3>Meal Planner</h3>
        <p class="muted">${escapeHtml(rangeLabel)} · Sunday-first planning for breakfast, lunch, and dinner.</p>
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
      </div>
      <div class="toolbar">
        <button class="secondary" id="prev-week">Previous</button>
        <button class="ghost" id="this-week">Current</button>
        <button class="secondary" id="next-week">Next</button>
        <button class="primary" id="generate-grocery">Generate Grocery List</button>
      </div>
    </section>
    <section class="calendar-grid ${fullCalendar ? 'full-calendar-grid' : 'daily-planner-grid'}" aria-label="${fullCalendar ? 'Full meal calendar' : 'Daily meal planner'}">
      ${fullCalendar ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => `<div class="full-calendar-weekday">${day}</div>`).join('') : ''}
      ${state.planner.dates.map(date => plannerDayCard(date, plansByDate[date] || [], fullCalendar)).join('')}
    </section>
  `;

  $('#prev-week').addEventListener('click', async () => {
    movePlannerPeriod(-1);
    await loadPlanner();
    renderPlanner();
  });

  $('#next-week').addEventListener('click', async () => {
    movePlannerPeriod(1);
    await loadPlanner();
    renderPlanner();
  });

  $('#this-week').addEventListener('click', async () => {
    state.weekStart = startOfWeek(new Date());
    state.plannerPreviousWeek = false;
    localStorage.setItem('mealPlannerPreviousWeek', '0');
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
    localStorage.setItem('mealPlannerPreviousWeek', state.plannerPreviousWeek ? '1' : '0');
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
    details.push(`Sides: ${sides}`);
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

function renderRecipes() {
  pageRoot.innerHTML = `
    <section class="grid two">
      <form id="recipe-form" class="form-card">
        <div class="form-heading-row">
          <h3>Add Recipe</h3>
          <button class="secondary small-btn" id="open-recipe-import" type="button"><i class="ti ti-camera"></i>Import Printed Recipe</button>
        </div>
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
          <label class="wide checkbox-line"><input type="checkbox" name="favorite" /> Favorite</label>
        </div>
        <button class="primary full" type="submit">Save Recipe</button>
      </form>
      <article class="card">
        <h3>Recipe Library</h3>
        <p class="muted">${state.recipes.length} saved recipe${state.recipes.length === 1 ? '' : 's'}.</p>
        <div class="list">${state.recipes.length ? state.recipes.map(recipeItem).join('') : '<div class="empty">Add your first recipe to start planning meals.</div>'}</div>
      </article>
    </section>
  `;

  $('#open-recipe-import')?.addEventListener('click', openRecipeImportModal);

  $('#recipe-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withSaveFeedback(formElement, async () => {
      const body = formToBody(formElement);
      body.prepTime = durationInputsToMinutes(formElement, 'prep');
      delete body.prepHours;
      delete body.prepMinutes;
      body.favorite = getFormCheckboxChecked(formElement, 'favorite');
      await api('/api/recipes', { method: 'POST', body });
      formElement.reset();
      await Promise.all([loadRecipes(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);
      renderRecipes();
    }, 'Recipe saved.');
  });

  pageRoot.querySelectorAll('[data-view-recipe-scan]').forEach(button => {
    button.addEventListener('click', () => {
      const recipe = state.recipes.find(item => String(item._id) === String(button.dataset.viewRecipeScan));
      openRecipeScan(recipe);
    });
  });

  pageRoot.querySelectorAll('[data-delete-recipe]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/recipes/${button.dataset.deleteRecipe}`, { method: 'DELETE' });
      await Promise.all([loadRecipes(), loadPlanner(), loadStats()]);
      showToast('Recipe deleted.');
      renderRecipes();
    });
  });
}

function openRecipeImportModal() {
  closeMobileWebSidebarForModal();
  recipeImportScan = { dataUrl: '', name: '', type: '' };
  document.querySelector('.recipe-import-overlay')?.remove();
  document.body.classList.add('modal-open');

  const overlay = document.createElement('section');
  overlay.className = 'time-modal-overlay recipe-import-overlay';
  overlay.innerHTML = `
    <article class="time-modal-card recipe-import-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-import-title">
      <header class="time-modal-header">
        <div>
          <h3 id="recipe-import-title">Import Printed Recipe</h3>
          <p class="muted">Upload a photo or PDF, review the details, then save it to your recipe library.</p>
        </div>
        <button class="secondary modal-close-btn" type="button" data-close-recipe-import aria-label="Close import modal">×</button>
      </header>
      <div class="time-modal-body">
        <div class="time-modal-body-inner">
          <form id="recipe-import-form" class="calendar-meal-form recipe-import-form">
            <div class="recipe-import-upload">
              <label class="wide">Recipe Photo or PDF
                <input id="recipe-import-file" name="recipeFile" type="file" accept="image/*,application/pdf" capture="environment" />
              </label>
              <div id="recipe-import-preview" class="recipe-import-preview empty">No scan selected.</div>
            </div>
            <label class="wide">Extracted or Typed Text <span class="optional">paste OCR text here if you have it</span><textarea name="importText" placeholder="Paste detected recipe text, or type from the printed page."></textarea></label>
            <div class="action-row recipe-import-actions">
              <button class="secondary" id="recipe-import-parse" type="button"><i class="ti ti-wand"></i>Fill From Text</button>
              <button class="secondary" id="recipe-import-clear-scan" type="button"><i class="ti ti-trash"></i>Clear Scan</button>
            </div>
            <div class="form-grid compact-form-grid recipe-import-fields">
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
              <label class="wide">Ingredients<textarea name="ingredientsText" placeholder="One ingredient per line"></textarea></label>
              <label class="wide">Instructions<textarea name="instructions" placeholder="Recipe steps"></textarea></label>
              <label class="wide">Import Notes<input name="importNotes" placeholder="Binder page, handwritten note, source, etc." /></label>
              <label class="wide checkbox-line"><input type="checkbox" name="favorite" /> Favorite</label>
            </div>
            <div class="modal-actions action-row">
              <button class="secondary" type="button" data-close-recipe-import>Cancel</button>
              <button class="primary" type="submit">Save Imported Recipe</button>
            </div>
          </form>
        </div>
      </div>
    </article>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeRecipeImportModal();
  });
  overlay.querySelectorAll('[data-close-recipe-import]').forEach(button => button.addEventListener('click', closeRecipeImportModal));
  overlay.querySelector('#recipe-import-file')?.addEventListener('change', handleRecipeImportFile);
  overlay.querySelector('#recipe-import-clear-scan')?.addEventListener('click', clearRecipeImportScan);
  overlay.querySelector('#recipe-import-parse')?.addEventListener('click', () => fillRecipeImportFromText(overlay.querySelector('#recipe-import-form')));
  overlay.querySelector('#recipe-import-form')?.addEventListener('submit', saveImportedRecipe);
}

function closeRecipeImportModal() {
  const overlay = document.querySelector('.recipe-import-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.classList.add('closing');
  window.setTimeout(() => {
    overlay.remove();
    if (!document.querySelector('.time-modal-overlay.open')) document.body.classList.remove('modal-open');
  }, 180);
}

async function handleRecipeImportFile(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const preview = document.querySelector('#recipe-import-preview');
  try {
    recipeImportScan = await recipeSourceFileToDataUrl(file);
    if (preview) {
      preview.classList.remove('empty');
      preview.innerHTML = recipeImportScan.type.startsWith('image/')
        ? `<img src="${escapeAttr(recipeImportScan.dataUrl)}" alt="Uploaded recipe scan" /><span>${escapeHtml(recipeImportScan.name)}</span>`
        : `<div><i class="ti ti-file-type-pdf"></i><strong>${escapeHtml(recipeImportScan.name)}</strong><p class="muted">PDF scan attached.</p></div>`;
    }
    const nameInput = document.querySelector('#recipe-import-form [name="name"]');
    if (nameInput && !nameInput.value.trim()) nameInput.value = titleFromFileName(file.name);
  } catch (error) {
    recipeImportScan = { dataUrl: '', name: '', type: '' };
    if (preview) {
      preview.classList.add('empty');
      preview.textContent = 'No scan selected.';
    }
    showToast(error.message || 'Unable to read recipe scan.');
  }
}

function clearRecipeImportScan() {
  recipeImportScan = { dataUrl: '', name: '', type: '' };
  const fileInput = document.querySelector('#recipe-import-file');
  const preview = document.querySelector('#recipe-import-preview');
  if (fileInput) fileInput.value = '';
  if (preview) {
    preview.classList.add('empty');
    preview.textContent = 'No scan selected.';
  }
}

function fillRecipeImportFromText(form) {
  if (!form) return;
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
  await withSaveFeedback(formElement, async () => {
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
    await api('/api/recipes', { method: 'POST', body });
    await Promise.all([loadRecipes(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);
    closeRecipeImportModal();
    renderRecipes();
  }, 'Printed recipe imported.');
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
    source.onerror = () => reject(new Error('Unable to process the selected image.'));
    source.src = rawDataUrl;
  });

  const maxEdge = 1400;
  const width = image.naturalWidth || image.width || 1;
  const height = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return { dataUrl: rawDataUrl, name: file.name, type: file.type };
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let optimized = canvas.toDataURL('image/webp', 0.82);
  if (!optimized || optimized === 'data:,') optimized = canvas.toDataURL('image/jpeg', 0.82);
  if (optimized.length > 1500000) throw new Error('Recipe scan is too large. Please crop the photo or use a smaller image.');
  return { dataUrl: optimized, name: file.name, type: file.type };
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
  const link = document.createElement('a');
  link.href = recipe.originalScan;
  link.target = '_blank';
  link.rel = 'noopener';
  link.download = recipe.originalScanName || `${slugify(recipe.name || 'recipe')}-scan`;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
          <button class="primary slot-spin-btn" type="submit">Spin</button>
        </form>
        <div id="random-result" class="slot-machine-result">
          ${slotMachinePlaceholder()}
        </div>
      </article>
      ${addressAutocompleteDatalist()}
    </section>
    <section class="card restaurant-list-section">
      <div class="section-head restaurant-list-head">
        <div>
          <h3>${showingWantToGo ? 'Want To' : 'Saved Restaurants'}</h3>
          <p class="muted">${visibleCount} saved ${visibleCount === 1 ? 'spot' : 'spots'}</p>
        </div>
        <div class="restaurant-list-tools">
          <div class="restaurant-view-toggle ${showingWantToGo ? 'want-active' : 'saved-active'}" role="group" aria-label="Restaurant list view" data-restaurant-list-toggle>
            <button class="${showingWantToGo ? '' : 'active'}" type="button" data-restaurant-list-view="saved">Saved</button>
            <button class="${showingWantToGo ? 'active' : ''}" type="button" data-restaurant-list-view="want">Want To</button>
          </div>
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
  randomRestaurantForm.addEventListener('submit', event => {
    event.preventDefault();
    spinRandomRestaurant(event.currentTarget);
  });
  bindSlotTagFilterModal(randomRestaurantForm);

  pageRoot.querySelector('[data-restaurant-list-toggle]')?.addEventListener('click', event => {
    const button = event.target.closest('[data-restaurant-list-view]');
    const nextView = button?.dataset.restaurantListView || (state.restaurantListView === 'want' ? 'saved' : 'want');
    state.restaurantListView = nextView === 'want' ? 'want' : 'saved';
    localStorage.setItem('mealPlannerRestaurantListView', state.restaurantListView);
    state.editingRestaurantId = '';
    state.openRestaurantMenuId = '';
    renderRestaurants();
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
      <article class="card">
        <h3>Meal History</h3>
        <div class="list">${state.history.length ? state.history.map(historyItem).join('') : '<div class="empty">History is saved when meals are eaten or added manually.</div>'}</div>
      </article>
    </section>
  `;

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
      $('#household-name').textContent = household?.name || 'Meal Planner';
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
      $('#household-name').textContent = result.household?.name || 'Meal Planner';
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
    <div class="slot-machine-window" aria-live="polite">
      <div class="slot-reel winner"><span>Tap Spin</span></div>
    </div>
    <p class="muted slot-machine-hint">Only the restaurant name appears on the reel.</p>
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
  const submitButton = form.querySelector('[type="submit"]');
  if (!resultRoot) return;

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
  submitButton.disabled = true;
  resultRoot.classList.add('spinning');
  resultRoot.innerHTML = `
    <div class="slot-machine-window spinning" aria-live="polite">
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

    submitButton.disabled = false;
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
      <div class="slot-machine-window settled">
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
  const baseStart = state.plannerPreviousWeek ? addDays(state.weekStart, -7) : state.weekStart;
  if (state.plannerView === 'month') return startOfMonthGrid(baseStart);
  return baseStart;
}

function getPlannerRangeLabel() {
  const dates = state.planner?.dates || [];
  if (!dates.length) return 'No dates loaded';
  const start = plannerDateFormatter.format(new Date(`${dates[0]}T12:00:00`));
  const end = plannerDateFormatter.format(new Date(`${dates[dates.length - 1]}T12:00:00`));
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
