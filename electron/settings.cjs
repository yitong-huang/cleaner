const fs = require('fs')
const path = require('path')

const SIMILARITY_LEVELS = ['strict', 'default', 'loose']

const DEFAULT_SETTINGS = {
  similarityLevel: 'default',
}

function settingsFilePath(userDataPath) {
  return path.join(userDataPath, 'settings.json')
}

function normalizeSettings(raw) {
  const next = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return next
  if (SIMILARITY_LEVELS.includes(raw.similarityLevel)) {
    next.similarityLevel = raw.similarityLevel
  }
  return next
}

function loadSettings(userDataPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFilePath(userDataPath), 'utf8'))
    return normalizeSettings(raw)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(userDataPath, patch) {
  const current = loadSettings(userDataPath)
  const next = normalizeSettings({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) })
  const file = settingsFilePath(userDataPath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2))
  return next
}

module.exports = {
  SIMILARITY_LEVELS,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  normalizeSettings,
}
