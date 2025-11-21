// Simple, minimal auth microservice
const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');

// Load/save users as a Map stored in users.json
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return new Map(JSON.parse(data));
    }
  } catch (e) {
    console.warn('Could not load users.json, starting empty');
  }
  return new Map();
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(Array.from(users.entries())), 'utf8');
  } catch (e) {
    console.error('Failed to save users.json:', e.message);
  }
}

const users = loadUsers(); // email -> { id, email, name, password, lastLogin }

// Simple config
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ACCESS_EXP = '15m';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// In-memory stores
const attempts = new Map(); // email -> { count, last }

function checkAttempts(email) {
  const a = attempts.get(email);
  if (!a) return { allowed: true, remaining: MAX_ATTEMPTS };
  if (Date.now() - a.last > LOCKOUT_MS) { attempts.delete(email); return { allowed: true, remaining: MAX_ATTEMPTS }; }
  if (a.count >= MAX_ATTEMPTS) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: MAX_ATTEMPTS - a.count };
}

function recordAttempt(email, ok) {
  if (ok) return attempts.delete(email);
  const prev = attempts.get(email) || { count: 0, last: 0 };
  prev.count = prev.count + 1;
  prev.last = Date.now();
  attempts.set(email, prev);
}

function generateAccess(email, id) {
  return jwt.sign({ email, userId: id }, JWT_SECRET, { expiresIn: ACCESS_EXP });
}

// Routes
app.post('/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (users.has(email)) return res.status(409).json({ error: 'user exists' });
  const id = uuidv4();
  users.set(email, { id, email, name: name || '', password, lastLogin: null });
  saveUsers(users);
  return res.status(201).json({ message: 'registered', user: { id, email, name: name || '' } });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const a = checkAttempts(email);
  if (!a.allowed) return res.status(429).json({ error: 'too many attempts' });
  const user = users.get(email);
  if (!user || user.password !== password) {
    recordAttempt(email, false);
    return res.status(401).json({ error: 'invalid credentials', remaining: (a.remaining || 0) - 1 });
  }
  // success
  recordAttempt(email, true);
  user.lastLogin = new Date().toISOString();
  saveUsers(users);

  const accessToken = generateAccess(user.email, user.id);
  return res.json({ accessToken, expiresIn: ACCESS_EXP });
});
// NOTE: refresh endpoint removed — service issues short-lived access tokens only

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auth service listening on ${PORT}`));
