const mealTypes = ['breakfast', 'lunch', 'dinner'];
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
  recipes: [],
  restaurants: [],
  planner: { dates: [], plans: [] },
  grocery: [],
  history: [],
  stats: null,
  suggestions: []
};

const $ = selector => document.querySelector(selector);
const pageRoot = $('#page-root');
const toast = $('#toast');
const authScreen = $('#auth-screen');
const appShell = $('#app-shell');

init();

function init() {
  applyTheme(getStoredTheme());
  applyAccentColor(getStoredAccentColor());
  $('#today-label').textContent = fullDateFormatter.format(new Date());
  bindAuth();
  bindShell();
  setupMagneticNav();
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
    state.page = 'settings';
    setActiveNav('settings');
    await renderCurrentPage();
  });

  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', async () => {
      state.page = button.dataset.page;
      document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === state.page));
      requestAnimationFrame(() => setNavHover(button));
      setMobileWebSidebarOpen(false);
      await renderCurrentPage();
    });
  });

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
  $('#household-name').textContent = me.household?.name || 'Meal Planner';
  syncUserAvatarUI();
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  setActiveNav(state.page);
  requestAnimationFrame(() => updateActiveNavHover());
  await loadBaseData();
  await renderCurrentPage();
}

async function loadBaseData() {
  await Promise.all([
    loadRecipes(),
    loadRestaurants(),
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
  if (state.page === 'dashboard') return renderDashboard();
  if (state.page === 'planner') return renderPlanner();
  if (state.page === 'recipes') return renderRecipes();
  if (state.page === 'restaurants') return renderRestaurants();
  if (state.page === 'grocery') return renderGrocery();
  if (state.page === 'history') return renderHistory();
  if (state.page === 'stats') return renderStats();
  if (state.page === 'settings') return renderSettings();
}

function setActiveNav(page) {
  appShell.dataset.page = page;
  document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  $('#page-title').textContent = titleCase(page === 'grocery' ? 'Grocery List' : page);
  requestAnimationFrame(() => updateActiveNavHover());
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

async function loadPlanner() {
  state.planner = await api(`/api/planner?weekStart=${state.weekStart}`);
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

  pageRoot.innerHTML = `
    <section class="form-card planner-toolbar">
      <div>
        <h3>Weekly Planner</h3>
        <p class="muted">Use the calendar to add breakfast, lunch, or dinner for each day.</p>
      </div>
      <div class="toolbar">
        <button class="secondary" id="prev-week">Previous</button>
        <button class="ghost" id="this-week">This Week</button>
        <button class="secondary" id="next-week">Next</button>
        <button class="primary" id="generate-grocery">Generate Grocery List</button>
      </div>
    </section>
    <section class="calendar-grid" aria-label="Weekly meal calendar">
      ${state.planner.dates.map(date => `
        <article class="calendar-day" data-date="${date}">
          <header class="calendar-day-header">
            <div>
              <span class="calendar-day-name">${plannerWeekdayFormatter.format(new Date(`${date}T12:00:00`))}</span>
              <span class="calendar-day-date">${plannerDateFormatter.format(new Date(`${date}T12:00:00`))}</span>
            </div>
            <button class="calendar-add-btn" type="button" data-add-date="${date}" aria-label="Add meal for ${date}">+</button>
          </header>
          <div class="calendar-meals">
            ${(plansByDate[date] || []).length ? plansByDate[date].map(plannerMealItem).join('') : '<div class="empty compact">No meals planned.</div>'}
          </div>
        </article>
      `).join('')}
    </section>
  `;

  $('#prev-week').addEventListener('click', async () => {
    state.weekStart = addDays(state.weekStart, -7);
    await loadPlanner();
    renderPlanner();
  });

  $('#next-week').addEventListener('click', async () => {
    state.weekStart = addDays(state.weekStart, 7);
    await loadPlanner();
    renderPlanner();
  });

  $('#this-week').addEventListener('click', async () => {
    state.weekStart = startOfWeek(new Date());
    await loadPlanner();
    renderPlanner();
  });

  $('#generate-grocery').addEventListener('click', async () => {
    const result = await api('/api/grocery/generate-from-plan', { method: 'POST', body: { weekStart: state.weekStart } });
    await loadGrocery();
    showToast(`Added ${result.createdCount} grocery item${result.createdCount === 1 ? '' : 's'} from planned recipes.`);
  });

  pageRoot.querySelectorAll('[data-add-date]').forEach(button => {
    button.addEventListener('click', () => openCalendarMealForm(button.dataset.addDate));
  });

  pageRoot.querySelectorAll('[data-edit-plan]').forEach(button => {
    button.addEventListener('click', () => {
      const plan = state.planner.plans.find(item => String(item._id) === String(button.dataset.editPlan));
      if (plan) openCalendarMealForm(plan.date, plan);
    });
  });

  pageRoot.querySelectorAll('[data-delete-plan]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/planner/${button.dataset.deletePlan}`, { method: 'DELETE' });
      await loadPlanner();
      showToast('Meal cleared.');
      renderPlanner();
    });
  });
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

  const close = () => closeCalendarMealModal();

  const syncSourceFields = () => {
    const type = sourceTypeSelect.value;
    form.querySelectorAll('[data-source-field]').forEach(field => {
      field.classList.toggle('open', field.dataset.sourceField === type);
    });
  };

  sourceTypeSelect.addEventListener('change', syncSourceFields);
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
      const body = {
        date: data.date,
        mealType: data.mealType,
        time: data.time || getDefaultMealTime(data.mealType),
        sourceType: data.sourceType,
        sourceId: data.sourceType === 'recipe' ? data.recipeId : data.sourceType === 'restaurant' ? data.restaurantId : null,
        customName: data.sourceType === 'custom' ? data.customName : '',
        status: data.status,
        notes: data.notes
      };

      await api('/api/planner/slot', { method: 'PUT', body });
      if (data.planId && data.originalMealType && data.originalMealType !== data.mealType) {
        await api(`/api/planner/${data.planId}`, { method: 'DELETE' });
      }
      await Promise.all([loadPlanner(), loadHistory(), loadStats(), loadRecipes(), loadRestaurants()]);
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
  const selectedMealType = plan?.mealType || 'dinner';
  const selectedTime = plan?.time || getDefaultMealTime(selectedMealType);

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
            ${option('recipe', 'Recipe', sourceType)}
            ${option('restaurant', 'Restaurant', sourceType)}
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
      <div class="source-field-expander ${sourceType === 'custom' ? 'open' : ''}" data-source-field="custom">
        <div class="source-field-inner">
          <input name="customName" data-custom-input placeholder="Custom meal" value="${escapeAttr(plan?.customName || '')}" />
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

function plannerMealItem(plan) {
  return `
    <article class="calendar-meal">
      <div class="calendar-meal-main">
        <div class="badge-row">
          <span class="badge accent">${escapeHtml(plan.mealType)}</span>
          ${plan.time ? `<span class="badge">${formatMealTime(plan.time)}</span>` : ''}
        </div>
        <strong>${escapeHtml(getPlanName(plan))}</strong>
        ${plan.notes ? `<p class="muted">${escapeHtml(plan.notes)}</p>` : ''}
      </div>
      <div class="calendar-meal-actions">
        <span class="badge ${plan.status === 'eaten' ? 'good' : plan.status === 'skipped' ? 'warn' : ''}">${escapeHtml(plan.status)}</span>
        <button class="small-btn" type="button" data-edit-plan="${plan._id}">Edit</button>
        <button class="danger small-btn" type="button" data-delete-plan="${plan._id}">Clear</button>
      </div>
    </article>
  `;
}

function renderRecipes() {
  pageRoot.innerHTML = `
    <section class="grid two">
      <form id="recipe-form" class="form-card">
        <h3>Add Recipe</h3>
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

  pageRoot.querySelectorAll('[data-delete-recipe]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/recipes/${button.dataset.deleteRecipe}`, { method: 'DELETE' });
      await Promise.all([loadRecipes(), loadPlanner(), loadStats()]);
      showToast('Recipe deleted.');
      renderRecipes();
    });
  });
}

function renderRestaurants() {
  pageRoot.innerHTML = `
    <section class="grid two">
      <form id="restaurant-form" class="form-card">
        <h3>Add Restaurant</h3>
        <div class="form-grid">
          <label>Name<input name="name" required placeholder="Favorite taco spot" /></label>
          <label>Cuisine<input name="cuisine" placeholder="Mexican, Pizza, Sushi" /></label>
          <label>Price<select name="priceLevel"><option>$</option><option selected>$$</option><option>$$$</option><option>$$$$</option></select></label>
          <label>Rating<select name="rating">${ratingOptions()}</select></label>
          <label class="wide">Location or Link<input name="location" placeholder="Address, Google Maps, DoorDash link" /></label>
          <label>Favorite Dishes<input name="favoriteDishes" placeholder="wings, tacos, ramen" /></label>
          <label>Tags<input name="tags" placeholder="late night, cheap, delivery" /></label>
          <label class="wide checkbox-line restaurant-favorite"><input type="checkbox" name="favorite" /> Favorite</label>
        </div>
        <button class="primary full" type="submit">Save Restaurant</button>
      </form>
      <article class="card" id="random-form">
        <h3>Random Restaurant Selector</h3>
        <p class="muted">Pick a food mood and let the app choose from your saved spots.</p>
        <form id="random-restaurant-form" class="form-grid">
          <label>Cuisine / Mood<input name="cuisine" placeholder="pizza, Mexican, burgers" /></label>
          <label>Tag<input name="tag" placeholder="delivery, cheap, date night" /></label>
          <label>Price<select name="priceLevel"><option value="">Any</option><option>$</option><option>$$</option><option>$$$</option><option>$$$$</option></select></label>
          <button class="primary" type="submit">Pick One</button>
        </form>
        <div id="random-result" class="list"></div>
      </article>
    </section>
    <section class="card">
      <h3>Restaurant List</h3>
      <div class="list">${state.restaurants.length ? state.restaurants.map(restaurantItem).join('') : '<div class="empty">Add favorite restaurants to use the random selector.</div>'}</div>
    </section>
  `;

  $('#restaurant-form').addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    await withSaveFeedback(formElement, async () => {
      const body = formToBody(formElement);
      body.favorite = getFormCheckboxChecked(formElement, 'favorite');
      await api('/api/restaurants', { method: 'POST', body });
      formElement.reset();
      await Promise.all([loadRestaurants(), loadSuggestions({ mealType: 'dinner' }), loadStats()]);
      renderRestaurants();
    }, 'Restaurant saved.');
  });

  $('#random-restaurant-form').addEventListener('submit', async event => {
    event.preventDefault();
    const values = formToBody(event.currentTarget);
    const query = new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, value]) => value))).toString();
    try {
      const result = await api(`/api/restaurants/random${query ? `?${query}` : ''}`);
      $('#random-result').innerHTML = `<div class="list-item"><strong>${escapeHtml(result.pick.name)}</strong><p class="muted">${escapeHtml(result.pick.cuisine || 'Any cuisine')} • ${result.pick.priceLevel} • ${result.pick.rating || 0}/5</p><p>${escapeHtml((result.pick.tags || []).join(', ') || 'No tags yet')}</p></div>`;
    } catch (error) {
      $('#random-result').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  });

  pageRoot.querySelectorAll('[data-delete-restaurant]').forEach(button => {
    button.addEventListener('click', async () => {
      await api(`/api/restaurants/${button.dataset.deleteRestaurant}`, { method: 'DELETE' });
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
    const result = await api('/api/grocery/generate-from-plan', { method: 'POST', body: { weekStart: state.weekStart } });
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
  const activeAccent = getStoredAccentColor();
  const activeTheme = getStoredTheme();
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
      <article class="card">
        <h3>Household</h3>
        <p class="muted">Share this invite code with your wife or anyone else you want in the meal planner.</p>
        <div class="invite-code-row">
          <div class="kpi invite-code" aria-label="Household invite code">${formatInviteCode(data.household.inviteCode)}</div>
          <button class="secondary copy-invite-btn" type="button" data-copy-invite="${escapeHtml(String(data.household.inviteCode || '').toUpperCase())}"><i class="ti ti-copy"></i>Copy</button>
        </div>
        <p>${escapeHtml(data.household.name)}</p>
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
        <h3>Accent Color</h3>
        <p class="muted">Choose the app accent color for buttons, badges, navigation, and highlights.</p>
        <div class="accent-picker" aria-label="Accent color options">
          ${accentColorOptions.map(color => `
            <button class="accent-swatch ${color === activeAccent ? 'active' : ''}" type="button" data-accent-color="${color}" style="--swatch:${color}" aria-label="Use accent color ${color}">
              <span>${color}</span>
            </button>
          `).join('')}
        </div>
      </article>
      <article class="card">
        <h3>Appearance</h3>
        <p class="muted">Switch between light and dark mode for the app shell.</p>
        <div class="theme-toggle" role="group" aria-label="Theme options" data-theme-toggle-state="${activeTheme}">
          <button class="theme-option ${activeTheme === 'light' ? 'active' : ''}" type="button" data-theme-option="light">Light</button>
          <button class="theme-option ${activeTheme === 'dark' ? 'active' : ''}" type="button" data-theme-option="dark">Dark</button>
        </div>
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

  pageRoot.querySelectorAll('[data-accent-color]').forEach(button => {
    button.addEventListener('click', () => {
      const color = button.dataset.accentColor;
      if (!accentColorOptions.includes(color)) return;
      localStorage.setItem('mealPlannerAccentColor', color);
      applyAccentColor(color);
      pageRoot.querySelectorAll('[data-accent-color]').forEach(item => item.classList.toggle('active', item.dataset.accentColor === color));
      showToast(`Accent color updated to ${color}.`);
      requestAnimationFrame(updateActiveNavHover);
    });
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

  pageRoot.querySelector('.theme-toggle')?.addEventListener('click', () => {
    const nextTheme = getStoredTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mealPlannerTheme', nextTheme);
    applyTheme(nextTheme);
    const themeToggle = pageRoot.querySelector('.theme-toggle');
    if (themeToggle) themeToggle.dataset.themeToggleState = nextTheme;
    pageRoot.querySelectorAll('[data-theme-option]').forEach(item => item.classList.toggle('active', item.dataset.themeOption === nextTheme));
    requestAnimationFrame(updateActiveNavHover);
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
        <button class="danger small-btn" data-delete-recipe="${recipe._id}">Delete</button>
      </div>
      <div class="badge-row">
        ${(recipe.mealTypes || []).map(type => `<span class="badge accent">${escapeHtml(type)}</span>`).join('')}
        ${recipe.cuisine ? `<span class="badge">${escapeHtml(recipe.cuisine)}</span>` : ''}
        ${recipe.favorite ? '<span class="badge good">favorite</span>' : ''}
      </div>
      <p class="muted">${formatDurationMinutes(recipe.prepTime || 0)} prep • ${formatDurationMinutes(recipe.cookTime || 0)} cook • ${starRating(recipe.rating || 0)} • cooked ${recipe.timesCooked || 0}x</p>
      ${(recipe.ingredients || []).length ? `<p>${recipe.ingredients.slice(0, 4).map(item => escapeHtml(item.name)).join(', ')}${recipe.ingredients.length > 4 ? '…' : ''}</p>` : ''}
    </div>
  `;
}

function restaurantItem(restaurant) {
  return `
    <div class="list-item">
      <div class="list-title">
        <strong>${escapeHtml(restaurant.name)}</strong>
        <button class="danger small-btn" data-delete-restaurant="${restaurant._id}">Delete</button>
      </div>
      <div class="badge-row">
        ${restaurant.cuisine ? `<span class="badge accent">${escapeHtml(restaurant.cuisine)}</span>` : ''}
        <span class="badge">${restaurant.priceLevel}</span>
        ${restaurant.favorite ? '<span class="badge good">favorite</span>' : ''}
      </div>
      <p class="muted">${restaurant.rating || 0}/5 • visited ${restaurant.timesVisited || 0}x</p>
      ${restaurant.location ? `<p>${escapeHtml(restaurant.location)}</p>` : ''}
    </div>
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

function ratingOptions() {
  return [0, 1, 2, 3, 4, 5].map(value => option(value, `${value}/5`, 0)).join('');
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
  return plan.customName || 'Custom meal';
}

function titleCase(value) {
  return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function dateISO(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function startOfWeek(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
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
  const saved = localStorage.getItem('mealPlannerTheme');
  return saved === 'dark' ? 'dark' : 'light';
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
  const saved = localStorage.getItem('mealPlannerAccentColor');
  return accentColorOptions.includes(saved) ? saved : defaultAccentColor;
}

function applyAccentColor(color) {
  const accent = accentColorOptions.includes(color) ? color : defaultAccentColor;
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
