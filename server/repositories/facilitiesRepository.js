import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FILE_MAP = {
  hospital: 'qz_hospital.json',
  primary_school: 'qz_primary_school.json',
  middle_school: 'qz_middle_school.json',
  park: 'qz_park.json',
  bus_station: 'qz_bus_station.json',
  mall: 'qz_mall_and_supermarket.json',
  xiaoqu: 'xiaoqu.json',
}
async function readJsonFile(filename) {
  const filePath = path.join(__dirname, '../data', filename)
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content)
}
export async function findByType(type) {
  const filename = FILE_MAP[type]
  if (!filename) return null
  return readJsonFile(filename)
}
export async function findXiaoqu() {
  return readJsonFile(FILE_MAP.xiaoqu)
}
export function getAvailableTypes() {
  return Object.keys(FILE_MAP).filter((k) => k !== 'xiaoqu')
}
