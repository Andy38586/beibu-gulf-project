/** 把任意入参收为记录形态：非对象（含 null）落空记录。DTO.parse 的共用入口。 */
export function asRecord(raw: unknown): Record<string, unknown> {
  return (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
}
