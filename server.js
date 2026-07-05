import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;

if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable.');
}

if (!MONGODB_URI) {
  throw new Error('Missing MONGODB_URI environment variable.');
}

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public')));

mongoose.set('strictQuery', true);
await mongoose.connect(MONGODB_URI);

const objectId = mongoose.Schema.Types.ObjectId;

const householdSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  inviteCode: { type: String, required: true, unique: true, index: true },
  createdBy: { type: objectId, ref: 'User' }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true },
  householdId: { type: objectId, ref: 'Household', required: true },
  role: { type: String, enum: ['owner', 'member'], default: 'member' }
}, { timestamps: true });

const ingredientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  quantity: { type: String, default: '', trim: true },
  unit: { type: String, default: '', trim: true },
  category: { type: String, default: 'Other', trim: true }
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  householdId: { type: objectId, ref: 'Household', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  mealTypes: [{ type: String, enum: ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'] }],
  cuisine: { type: String, default: '', trim: true, index: true },
  ingredients: [ingredientSchema],
  instructions: { type: String, default: '', trim: true },
  prepTime: { type: Number, default: 0, min: 0 },
  cookTime: { type: Number, default: 0, min: 0 },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'easy' },
  tags: [{ type: String, trim: true }],
  rating: { type: Number, min: 0, max: 5, default: 0 },
  favorite: { type: Boolean, default: false },
  timesCooked: { type: Number, default: 0, min: 0 },
  lastCookedAt: { type: Date },
  createdBy: { type: objectId, ref: 'User' }
}, { timestamps: true });

const restaurantSchema = new mongoose.Schema({
  householdId: { type: objectId, ref: 'Household', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  cuisine: { type: String, default: '', trim: true, index: true },
  priceLevel: { type: String, enum: ['$', '$$', '$$$', '$$$$'], default: '$$' },
  location: { type: String, default: '', trim: true },
  favoriteDishes: [{ type: String, trim: true }],
  tags: [{ type: String, trim: true }],
  rating: { type: Number, min: 0, max: 5, default: 0 },
  favorite: { type: Boolean, default: false },
  timesVisited: { type: Number, default: 0, min: 0 },
  lastVisitedAt: { type: Date },
  createdBy: { type: objectId, ref: 'User' }
}, { timestamps: true });

const mealPlanSchema = new mongoose.Schema({
  householdId: { type: objectId, ref: 'Household', required: true, index: true },
  date: { type: String, required: true, index: true },
  mealType: { type: String, enum: ['breakfast', 'lunch', 'dinner'], required: true },
  sourceType: { type: String, enum: ['recipe', 'restaurant', 'custom'], default: 'custom' },
  sourceId: { type: objectId, default: null },
  customName: { type: String, default: '', trim: true },
  status: { type: String, enum: ['planned', 'eaten', 'skipped'], default: 'planned' },
  notes: { type: String, default: '', trim: true },
  updatedBy: { type: objectId, ref: 'User' }
}, { timestamps: true });
mealPlanSchema.index({ householdId: 1, date: 1, mealType: 1 }, { unique: true });

const groceryItemSchema = new mongoose.Schema({
  householdId: { type: objectId, ref: 'Household', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  quantity: { type: String, default: '', trim: true },
  unit: { type: String, default: '', trim: true },
  category: { type: String, default: 'Other', trim: true },
  checked: { type: Boolean, default: false },
  addedBy: { type: objectId, ref: 'User' },
  recipeId: { type: objectId, ref: 'Recipe' }
}, { timestamps: true });

const mealHistorySchema = new mongoose.Schema({
  householdId: { type: objectId, ref: 'Household', required: true, index: true },
  date: { type: String, required: true, index: true },
  mealType: { type: String, enum: ['breakfast', 'lunch', 'dinner'], required: true },
  sourceType: { type: String, enum: ['recipe', 'restaurant', 'custom'], default: 'custom' },
  sourceId: { type: objectId, default: null },
  name: { type: String, required: true, trim: true },
  cuisine: { type: String, default: '', trim: true },
  rating: { type: Number, min: 0, max: 5, default: 0 },
  notes: { type: String, default: '', trim: true },
  cost: { type: Number, min: 0, default: 0 },
  createdBy: { type: objectId, ref: 'User' }
}, { timestamps: true });
mealHistorySchema.index({ householdId: 1, date: 1, mealType: 1, sourceType: 1, sourceId: 1, name: 1 });

const Household = mongoose.model('Household', householdSchema);
const User = mongoose.model('User', userSchema);
const Recipe = mongoose.model('Recipe', recipeSchema);
const Restaurant = mongoose.model('Restaurant', restaurantSchema);
const MealPlan = mongoose.model('MealPlan', mealPlanSchema);
const GroceryItem = mongoose.model('GroceryItem', groceryItemSchema);
const MealHistory = mongoose.model('MealHistory', mealHistorySchema);

function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function tokenFor(user) {
  return jwt.sign({ userId: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    householdId: user.householdId,
    role: user.role
  };
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function parseIngredientLines(textOrArray) {
  if (Array.isArray(textOrArray)) {
    return textOrArray
      .map(item => ({
        name: String(item.name || '').trim(),
        quantity: String(item.quantity || '').trim(),
        unit: String(item.unit || '').trim(),
        category: String(item.category || 'Other').trim() || 'Other'
      }))
      .filter(item => item.name);
  }

  return String(textOrArray || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length >= 4) {
        return { quantity: parts[0], unit: parts[1], name: parts[2], category: parts[3] || 'Other' };
      }
      if (parts.length === 3) {
        return { quantity: parts[0], unit: parts[1], name: parts[2], category: 'Other' };
      }
      return { quantity: '', unit: '', name: line, category: 'Other' };
    })
    .filter(item => item.name);
}

function getDateRange(weekStart) {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error('Invalid weekStart date. Use YYYY-MM-DD.');
  }
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    return date.toISOString().slice(0, 10);
  });
}

function startOfCurrentWeek() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token.' });

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.userId).lean();
    if (!user) return res.status(401).json({ error: 'Invalid auth token.' });

    req.user = user;
    req.householdId = user.householdId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired auth token.' });
  }
}

async function getSourceNameAndCuisine(sourceType, sourceId, customName, householdId) {
  if (sourceType === 'recipe' && sourceId) {
    const recipe = await Recipe.findOne({ _id: sourceId, householdId }).lean();
    return { name: recipe?.name || customName || 'Recipe', cuisine: recipe?.cuisine || '' };
  }
  if (sourceType === 'restaurant' && sourceId) {
    const restaurant = await Restaurant.findOne({ _id: sourceId, householdId }).lean();
    return { name: restaurant?.name || customName || 'Restaurant', cuisine: restaurant?.cuisine || '' };
  }
  return { name: customName || 'Custom meal', cuisine: '' };
}

async function upsertHistoryFromPlan(plan, userId) {
  if (plan.status !== 'eaten') return;

  const { name, cuisine } = await getSourceNameAndCuisine(
    plan.sourceType,
    plan.sourceId,
    plan.customName,
    plan.householdId
  );

  await MealHistory.findOneAndUpdate(
    {
      householdId: plan.householdId,
      date: plan.date,
      mealType: plan.mealType,
      sourceType: plan.sourceType,
      sourceId: plan.sourceId || null,
      name
    },
    {
      householdId: plan.householdId,
      date: plan.date,
      mealType: plan.mealType,
      sourceType: plan.sourceType,
      sourceId: plan.sourceId || null,
      name,
      cuisine,
      notes: plan.notes || '',
      createdBy: userId
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (plan.sourceType === 'recipe' && plan.sourceId) {
    await Recipe.updateOne(
      { _id: plan.sourceId, householdId: plan.householdId },
      { $inc: { timesCooked: 1 }, $set: { lastCookedAt: new Date(`${plan.date}T12:00:00.000Z`) } }
    );
  }

  if (plan.sourceType === 'restaurant' && plan.sourceId) {
    await Restaurant.updateOne(
      { _id: plan.sourceId, householdId: plan.householdId },
      { $inc: { timesVisited: 1 }, $set: { lastVisitedAt: new Date(`${plan.date}T12:00:00.000Z`) } }
    );
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'meal-planner', time: new Date().toISOString() });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, householdName, inviteCode } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

    let household;
    let role = 'member';
    if (inviteCode) {
      household = await Household.findOne({ inviteCode: String(inviteCode).trim().toUpperCase() });
      if (!household) return res.status(404).json({ error: 'Invite code was not found.' });
    } else {
      household = await Household.create({
        name: householdName || `${name}'s Household`,
        inviteCode: generateInviteCode()
      });
      role = 'owner';
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      passwordHash,
      householdId: household._id,
      role
    });

    if (!household.createdBy) {
      household.createdBy = user._id;
      await household.save();
    }

    res.status(201).json({ token: tokenFor(user), user: publicUser(user), household });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Signup failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: String(email || '').toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

    const household = await Household.findById(user.householdId).lean();
    res.json({ token: tokenFor(user), user: publicUser(user), household });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Login failed.' });
  }
});

app.get('/api/me', authenticate, async (req, res) => {
  const household = await Household.findById(req.householdId).lean();
  res.json({ user: publicUser(req.user), household });
});

app.get('/api/household', authenticate, async (req, res) => {
  const [household, members] = await Promise.all([
    Household.findById(req.householdId).lean(),
    User.find({ householdId: req.householdId }).select('name email role createdAt').sort({ createdAt: 1 }).lean()
  ]);
  res.json({ household, members });
});

app.patch('/api/household', authenticate, async (req, res) => {
  const update = {};
  if (req.body.name) update.name = String(req.body.name).trim();
  const household = await Household.findByIdAndUpdate(req.householdId, update, { new: true }).lean();
  res.json(household);
});

app.get('/api/recipes', authenticate, async (req, res) => {
  const { q, mealType, cuisine, tag } = req.query;
  const filter = { householdId: req.householdId };
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
  if (mealType) filter.mealTypes = mealType;
  if (cuisine) filter.cuisine = { $regex: `^${escapeRegex(cuisine)}$`, $options: 'i' };
  if (tag) filter.tags = { $regex: `^${escapeRegex(tag)}$`, $options: 'i' };

  const recipes = await Recipe.find(filter).sort({ favorite: -1, updatedAt: -1 }).lean();
  res.json(recipes);
});

app.post('/api/recipes', authenticate, async (req, res) => {
  try {
    const recipe = await Recipe.create({
      householdId: req.householdId,
      name: req.body.name,
      mealTypes: Array.isArray(req.body.mealTypes) ? req.body.mealTypes : normalizeTags(req.body.mealTypes),
      cuisine: req.body.cuisine || '',
      ingredients: parseIngredientLines(req.body.ingredientsText ?? req.body.ingredients),
      instructions: req.body.instructions || '',
      prepTime: Number(req.body.prepTime || 0),
      cookTime: Number(req.body.cookTime || 0),
      difficulty: req.body.difficulty || 'easy',
      tags: normalizeTags(req.body.tags),
      rating: Number(req.body.rating || 0),
      favorite: Boolean(req.body.favorite),
      createdBy: req.user._id
    });
    res.status(201).json(recipe);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create recipe.' });
  }
});

app.put('/api/recipes/:id', authenticate, async (req, res) => {
  const update = {
    name: req.body.name,
    mealTypes: Array.isArray(req.body.mealTypes) ? req.body.mealTypes : normalizeTags(req.body.mealTypes),
    cuisine: req.body.cuisine || '',
    ingredients: parseIngredientLines(req.body.ingredientsText ?? req.body.ingredients),
    instructions: req.body.instructions || '',
    prepTime: Number(req.body.prepTime || 0),
    cookTime: Number(req.body.cookTime || 0),
    difficulty: req.body.difficulty || 'easy',
    tags: normalizeTags(req.body.tags),
    rating: Number(req.body.rating || 0),
    favorite: Boolean(req.body.favorite)
  };
  const recipe = await Recipe.findOneAndUpdate({ _id: req.params.id, householdId: req.householdId }, update, { new: true });
  if (!recipe) return res.status(404).json({ error: 'Recipe not found.' });
  res.json(recipe);
});

app.delete('/api/recipes/:id', authenticate, async (req, res) => {
  await Recipe.deleteOne({ _id: req.params.id, householdId: req.householdId });
  await MealPlan.updateMany({ householdId: req.householdId, sourceType: 'recipe', sourceId: req.params.id }, { sourceId: null, customName: 'Deleted recipe' });
  res.json({ ok: true });
});

app.get('/api/restaurants', authenticate, async (req, res) => {
  const { q, cuisine, tag, priceLevel } = req.query;
  const filter = { householdId: req.householdId };
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
  if (cuisine) filter.cuisine = { $regex: `^${escapeRegex(cuisine)}$`, $options: 'i' };
  if (tag) filter.tags = { $regex: `^${escapeRegex(tag)}$`, $options: 'i' };
  if (priceLevel) filter.priceLevel = priceLevel;

  const restaurants = await Restaurant.find(filter).sort({ favorite: -1, updatedAt: -1 }).lean();
  res.json(restaurants);
});

app.post('/api/restaurants', authenticate, async (req, res) => {
  try {
    const restaurant = await Restaurant.create({
      householdId: req.householdId,
      name: req.body.name,
      cuisine: req.body.cuisine || '',
      priceLevel: req.body.priceLevel || '$$',
      location: req.body.location || '',
      favoriteDishes: normalizeTags(req.body.favoriteDishes),
      tags: normalizeTags(req.body.tags),
      rating: Number(req.body.rating || 0),
      favorite: Boolean(req.body.favorite),
      createdBy: req.user._id
    });
    res.status(201).json(restaurant);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create restaurant.' });
  }
});

app.put('/api/restaurants/:id', authenticate, async (req, res) => {
  const update = {
    name: req.body.name,
    cuisine: req.body.cuisine || '',
    priceLevel: req.body.priceLevel || '$$',
    location: req.body.location || '',
    favoriteDishes: normalizeTags(req.body.favoriteDishes),
    tags: normalizeTags(req.body.tags),
    rating: Number(req.body.rating || 0),
    favorite: Boolean(req.body.favorite)
  };
  const restaurant = await Restaurant.findOneAndUpdate({ _id: req.params.id, householdId: req.householdId }, update, { new: true });
  if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });
  res.json(restaurant);
});

app.delete('/api/restaurants/:id', authenticate, async (req, res) => {
  await Restaurant.deleteOne({ _id: req.params.id, householdId: req.householdId });
  await MealPlan.updateMany({ householdId: req.householdId, sourceType: 'restaurant', sourceId: req.params.id }, { sourceId: null, customName: 'Deleted restaurant' });
  res.json({ ok: true });
});

app.get('/api/restaurants/random', authenticate, async (req, res) => {
  const { cuisine, tag, priceLevel } = req.query;
  const filter = { householdId: req.householdId };
  if (cuisine) filter.cuisine = { $regex: escapeRegex(cuisine), $options: 'i' };
  if (tag) filter.tags = { $regex: escapeRegex(tag), $options: 'i' };
  if (priceLevel) filter.priceLevel = priceLevel;

  const restaurants = await Restaurant.find(filter).lean();
  if (!restaurants.length) return res.status(404).json({ error: 'No matching restaurants found.' });

  const now = Date.now();
  const weighted = restaurants.flatMap(restaurant => {
    const ratingBoost = Math.max(1, Math.round((restaurant.rating || 0) + 1));
    const favoriteBoost = restaurant.favorite ? 2 : 0;
    const daysSince = restaurant.lastVisitedAt
      ? Math.min(14, Math.floor((now - new Date(restaurant.lastVisitedAt).getTime()) / 86400000))
      : 14;
    const recencyBoost = Math.max(1, Math.floor(daysSince / 3));
    const weight = ratingBoost + favoriteBoost + recencyBoost;
    return Array.from({ length: weight }, () => restaurant);
  });

  const pick = weighted[Math.floor(Math.random() * weighted.length)];
  res.json({ pick, poolSize: restaurants.length });
});

app.get('/api/planner', authenticate, async (req, res) => {
  try {
    const weekStart = req.query.weekStart || startOfCurrentWeek();
    const dates = getDateRange(weekStart);
    const plans = await MealPlan.find({ householdId: req.householdId, date: { $in: dates } }).lean();
    res.json({ weekStart, dates, plans });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/planner/slot', authenticate, async (req, res) => {
  try {
    const { date, mealType, sourceType, sourceId, customName, status, notes } = req.body;
    if (!date || !mealType) return res.status(400).json({ error: 'date and mealType are required.' });

    const plan = await MealPlan.findOneAndUpdate(
      { householdId: req.householdId, date, mealType },
      {
        householdId: req.householdId,
        date,
        mealType,
        sourceType: sourceType || 'custom',
        sourceId: sourceId || null,
        customName: customName || '',
        status: status || 'planned',
        notes: notes || '',
        updatedBy: req.user._id
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await upsertHistoryFromPlan(plan, req.user._id);
    res.json(plan);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update meal slot.' });
  }
});

app.delete('/api/planner/:id', authenticate, async (req, res) => {
  await MealPlan.deleteOne({ _id: req.params.id, householdId: req.householdId });
  res.json({ ok: true });
});

app.get('/api/grocery', authenticate, async (req, res) => {
  const items = await GroceryItem.find({ householdId: req.householdId }).sort({ checked: 1, category: 1, name: 1 }).lean();
  res.json(items);
});

app.post('/api/grocery', authenticate, async (req, res) => {
  try {
    const item = await GroceryItem.create({
      householdId: req.householdId,
      name: req.body.name,
      quantity: req.body.quantity || '',
      unit: req.body.unit || '',
      category: req.body.category || 'Other',
      checked: Boolean(req.body.checked),
      addedBy: req.user._id,
      recipeId: req.body.recipeId || null
    });
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create grocery item.' });
  }
});

app.put('/api/grocery/:id', authenticate, async (req, res) => {
  const update = {
    name: req.body.name,
    quantity: req.body.quantity || '',
    unit: req.body.unit || '',
    category: req.body.category || 'Other',
    checked: Boolean(req.body.checked)
  };
  const item = await GroceryItem.findOneAndUpdate({ _id: req.params.id, householdId: req.householdId }, update, { new: true });
  if (!item) return res.status(404).json({ error: 'Grocery item not found.' });
  res.json(item);
});

app.delete('/api/grocery/:id', authenticate, async (req, res) => {
  await GroceryItem.deleteOne({ _id: req.params.id, householdId: req.householdId });
  res.json({ ok: true });
});

app.post('/api/grocery/clear-checked', authenticate, async (req, res) => {
  const result = await GroceryItem.deleteMany({ householdId: req.householdId, checked: true });
  res.json({ ok: true, deleted: result.deletedCount });
});

app.post('/api/grocery/generate-from-plan', authenticate, async (req, res) => {
  try {
    const weekStart = req.body.weekStart || startOfCurrentWeek();
    const dates = getDateRange(weekStart);
    const plans = await MealPlan.find({ householdId: req.householdId, date: { $in: dates }, sourceType: 'recipe', sourceId: { $ne: null } }).lean();
    const recipeIds = [...new Set(plans.map(plan => String(plan.sourceId)))];
    const recipes = await Recipe.find({ householdId: req.householdId, _id: { $in: recipeIds } }).lean();

    const existing = await GroceryItem.find({ householdId: req.householdId, checked: false }).lean();
    const existingKeys = new Set(existing.map(item => `${item.name.toLowerCase()}|${item.category.toLowerCase()}|${item.unit.toLowerCase()}`));
    const created = [];

    for (const recipe of recipes) {
      for (const ingredient of recipe.ingredients || []) {
        const key = `${ingredient.name.toLowerCase()}|${String(ingredient.category || 'Other').toLowerCase()}|${String(ingredient.unit || '').toLowerCase()}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        created.push(await GroceryItem.create({
          householdId: req.householdId,
          name: ingredient.name,
          quantity: ingredient.quantity || '',
          unit: ingredient.unit || '',
          category: ingredient.category || 'Other',
          addedBy: req.user._id,
          recipeId: recipe._id
        }));
      }
    }

    res.status(201).json({ createdCount: created.length, items: created });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not generate grocery list.' });
  }
});

app.get('/api/history', authenticate, async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 250);
  const history = await MealHistory.find({ householdId: req.householdId }).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
  res.json(history);
});

app.post('/api/history', authenticate, async (req, res) => {
  try {
    const { name, cuisine } = await getSourceNameAndCuisine(req.body.sourceType, req.body.sourceId, req.body.name, req.householdId);
    const history = await MealHistory.create({
      householdId: req.householdId,
      date: req.body.date,
      mealType: req.body.mealType,
      sourceType: req.body.sourceType || 'custom',
      sourceId: req.body.sourceId || null,
      name,
      cuisine: req.body.cuisine || cuisine,
      rating: Number(req.body.rating || 0),
      notes: req.body.notes || '',
      cost: Number(req.body.cost || 0),
      createdBy: req.user._id
    });
    res.status(201).json(history);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not add meal history.' });
  }
});

app.delete('/api/history/:id', authenticate, async (req, res) => {
  await MealHistory.deleteOne({ _id: req.params.id, householdId: req.householdId });
  res.json({ ok: true });
});

app.get('/api/suggestions', authenticate, async (req, res) => {
  const { mealType, cuisine } = req.query;
  const history = await MealHistory.find({ householdId: req.householdId }).sort({ date: -1 }).limit(80).lean();
  const recentNames = new Set(history.slice(0, 14).map(item => item.name.toLowerCase()));

  const recipeFilter = { householdId: req.householdId };
  if (mealType) recipeFilter.mealTypes = mealType;
  if (cuisine) recipeFilter.cuisine = { $regex: escapeRegex(cuisine), $options: 'i' };

  const restaurantFilter = { householdId: req.householdId };
  if (cuisine) restaurantFilter.cuisine = { $regex: escapeRegex(cuisine), $options: 'i' };

  const [recipes, restaurants] = await Promise.all([
    Recipe.find(recipeFilter).lean(),
    Restaurant.find(restaurantFilter).lean()
  ]);

  const scoredRecipes = recipes.map(recipe => ({
    type: 'recipe',
    id: recipe._id,
    name: recipe.name,
    cuisine: recipe.cuisine,
    rating: recipe.rating,
    reason: recentNames.has(recipe.name.toLowerCase())
      ? 'Good match, but you had it recently.'
      : recipe.favorite
        ? 'Favorite recipe you have not eaten recently.'
        : recipe.rating >= 4
          ? 'Highly rated recipe option.'
          : 'Recipe option that fits the selected filters.',
    score: (recipe.favorite ? 3 : 0) + (recipe.rating || 0) + (recentNames.has(recipe.name.toLowerCase()) ? -3 : 2) + (recipe.timesCooked ? 0.5 : 1)
  }));

  const scoredRestaurants = restaurants.map(restaurant => ({
    type: 'restaurant',
    id: restaurant._id,
    name: restaurant.name,
    cuisine: restaurant.cuisine,
    rating: restaurant.rating,
    reason: recentNames.has(restaurant.name.toLowerCase())
      ? 'Restaurant match, but you had it recently.'
      : restaurant.favorite
        ? 'Favorite restaurant that fits the mood.'
        : restaurant.rating >= 4
          ? 'Highly rated restaurant option.'
          : 'Restaurant option that fits the selected filters.',
    score: (restaurant.favorite ? 3 : 0) + (restaurant.rating || 0) + (recentNames.has(restaurant.name.toLowerCase()) ? -3 : 1)
  }));

  const suggestions = [...scoredRecipes, ...scoredRestaurants]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  res.json(suggestions);
});

app.get('/api/stats', authenticate, async (req, res) => {
  const [recipes, restaurants, history, groceryOpen, groceryTotal, plans] = await Promise.all([
    Recipe.find({ householdId: req.householdId }).lean(),
    Restaurant.find({ householdId: req.householdId }).lean(),
    MealHistory.find({ householdId: req.householdId }).sort({ date: -1 }).limit(365).lean(),
    GroceryItem.countDocuments({ householdId: req.householdId, checked: false }),
    GroceryItem.countDocuments({ householdId: req.householdId }),
    MealPlan.find({ householdId: req.householdId }).lean()
  ]);

  const cuisineCounts = {};
  const mealTypeCounts = {};
  let homeCooked = 0;
  let restaurantMeals = 0;

  for (const item of history) {
    if (item.cuisine) cuisineCounts[item.cuisine] = (cuisineCounts[item.cuisine] || 0) + 1;
    mealTypeCounts[item.mealType] = (mealTypeCounts[item.mealType] || 0) + 1;
    if (item.sourceType === 'recipe') homeCooked += 1;
    if (item.sourceType === 'restaurant') restaurantMeals += 1;
  }

  const topRecipes = recipes
    .slice()
    .sort((a, b) => (b.timesCooked || 0) - (a.timesCooked || 0))
    .slice(0, 5)
    .map(recipe => ({ id: recipe._id, name: recipe.name, timesCooked: recipe.timesCooked || 0, rating: recipe.rating || 0 }));

  const topRestaurants = restaurants
    .slice()
    .sort((a, b) => (b.timesVisited || 0) - (a.timesVisited || 0))
    .slice(0, 5)
    .map(restaurant => ({ id: restaurant._id, name: restaurant.name, timesVisited: restaurant.timesVisited || 0, rating: restaurant.rating || 0 }));

  const planned = plans.filter(plan => plan.status !== 'skipped').length;
  const eaten = plans.filter(plan => plan.status === 'eaten').length;

  res.json({
    totals: {
      recipes: recipes.length,
      restaurants: restaurants.length,
      history: history.length,
      groceryOpen,
      groceryTotal,
      planned,
      eaten,
      planningCompletion: planned ? Math.round((eaten / planned) * 100) : 0,
      homeCooked,
      restaurantMeals
    },
    cuisineCounts,
    mealTypeCounts,
    topRecipes,
    topRestaurants
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Meal planner running on port ${PORT}`);
});
