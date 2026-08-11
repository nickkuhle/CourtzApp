import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'reservations.json')

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(DATA_FILE)
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({}, null, 2), 'utf8')
  }
}

function normalizeReservations(data) {
  const next = {}
  if (!data || typeof data !== 'object') return next

  for (const [key, slots] of Object.entries(data)) {
    if (slots && typeof slots === 'object') {
      const cleanedSlots = {}
      for (const [slotLabel, slotValue] of Object.entries(slots)) {
        if (slotValue == null) continue
        cleanedSlots[slotLabel] = Array.isArray(slotValue) ? slotValue : [slotValue]
      }
      if (Object.keys(cleanedSlots).length > 0) {
        next[key] = cleanedSlots
      }
    }
  }

  return next
}

export async function readReservations() {
  await ensureDataFile()
  const raw = await fs.readFile(DATA_FILE, 'utf8')
  try {
    return normalizeReservations(JSON.parse(raw))
  } catch {
    return {}
  }
}

export async function writeReservations(data) {
  await ensureDataFile()
  const serialized = JSON.stringify(data, null, 2)
  const tempFile = `${DATA_FILE}.tmp`
  await fs.writeFile(tempFile, serialized, 'utf8')
  await fs.rename(tempFile, DATA_FILE)
}

export async function toggleReservation({ location, date, courtId, slot, name }) {
  if (!location || !date || !slot || !name) {
    throw new Error('Missing reservation fields')
  }

  const reservations = await readReservations()
  const key = `${location}|${date}|${courtId}`
  const current = { ...(reservations[key] || {}) }
  const arr = Array.isArray(current[slot]) ? [...current[slot]] : []
  const index = arr.indexOf(name)

  if (index !== -1) {
    arr.splice(index, 1)
    if (arr.length) {
      current[slot] = arr
    } else {
      delete current[slot]
    }
  } else {
    arr.push(name)
    current[slot] = arr
  }

  if (Object.keys(current).length > 0) {
    reservations[key] = current
  } else {
    delete reservations[key]
  }

  await writeReservations(reservations)
  return reservations
}
