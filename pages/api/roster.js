import { getRoster } from '../../lib/sheets.js'

export default async function handler(req, res) {
  try {
    const roster = await getRoster()
    // roster is null if no sheet config -> client will use fallback
    return res.status(200).json({ roster })
  } catch (e) {
    console.error(e)
    return res.status(200).json({ roster: null })
  }
}
