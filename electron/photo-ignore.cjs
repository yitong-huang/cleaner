const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function groupKeyFromPaths(paths) {
  const sorted = [...paths].map(String).sort()
  return crypto.createHash('sha1').update(sorted.join('\n')).digest('hex')
}

function groupKeyFromIds(ids) {
  const sorted = [...ids].map(String).filter(Boolean).sort()
  return crypto.createHash('sha1').update(sorted.join('\n')).digest('hex')
}

function ignoreFilePath(userDataPath) {
  return path.join(userDataPath, 'ignored-photo-groups.json')
}

function loadIgnoredKeys(userDataPath) {
  const file = ignoreFilePath(userDataPath)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(raw?.keys)) return []
    return raw.keys.filter((k) => typeof k === 'string')
  } catch {
    return []
  }
}

function saveIgnoredKeys(userDataPath, keys) {
  const file = ignoreFilePath(userDataPath)
  const unique = [...new Set(keys.filter((k) => typeof k === 'string'))]
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ keys: unique, updatedAt: new Date().toISOString() }, null, 2))
  return unique
}

function addIgnoredGroup(userDataPath, paths, explicitKey = null) {
  const key = explicitKey || groupKeyFromPaths(paths)
  const next = [...loadIgnoredKeys(userDataPath), key]
  saveIgnoredKeys(userDataPath, next)
  return key
}

module.exports = {
  groupKeyFromPaths,
  groupKeyFromIds,
  loadIgnoredKeys,
  saveIgnoredKeys,
  addIgnoredGroup,
}
