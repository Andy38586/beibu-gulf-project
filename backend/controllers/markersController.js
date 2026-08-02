import * as markersRepo from '../repositories/markersRepository.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'
import { logger } from '../utils/logger.js'
import { sendSuccess } from '../utils/response.js'

export async function getAll(req, res, next) {
  try {
    // @arch-note P0-02: 只返回当前用户的标记
    const markers = await markersRepo.findByUserId(req.user.id)
    sendSuccess(res, markers)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取标注列表失败:', error)
    }
    next(error)
  }
}
export async function getOne(req, res, next) {
  try {
    const marker = await markersRepo.findById(req.params.id)
    if (!marker) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '标注不存在')
    }
    // @arch-note SEC-001: 归属校验，非本人标注返回 403（与 updateOne/deleteOne 对齐）
    if (marker.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权查看他人标注')
    }
    sendSuccess(res, marker)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('获取标注失败:', error)
    }
    next(error)
  }
}
export async function createOne(req, res, next) {
  try {
    const { name, lng, lat, note } = req.body

    // B-2（阶段6 复核）: null 不是合法坐标——`null === undefined` 为 false 会让
    // `{"lng": null}` 绕过必填检查，且 Number(null)=0 通过数值校验后被存为 (0, lat)。
    if (!name || lng === undefined || lng === null || lat === undefined || lat === null) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少必要字段: name, lng, lat')
    }
    // @arch-note M-01: 坐标数值 + 范围校验（防 NaN/字符串/越界坐标污染后续空间计算）
    if (
      !Number.isFinite(Number(lng)) ||
      !Number.isFinite(Number(lat)) ||
      Number(lng) < -180 ||
      Number(lng) > 180 ||
      Number(lat) < -90 ||
      Number(lat) > 90
    ) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '坐标无效: lng ∈ [-180,180], lat ∈ [-90,90]')
    }
    // @arch-note P0-02: 归属强制取自登录身份，不接受客户端传入
    const newMarker = await markersRepo.create({
      name,
      lng: Number(lng),
      lat: Number(lat),
      note: note || '',
      userId: req.user.id,
    })
    sendSuccess(res, newMarker, 201)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('创建标注失败:', error)
    }
    next(error)
  }
}
export async function updateOne(req, res, next) {
  try {
    // @arch-note P0-02: 归属校验，非本人标记返回 403
    const existing = await markersRepo.findById(req.params.id)
    if (!existing) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '标注不存在')
    }
    if (existing.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权操作他人标注')
    }
    // @arch-note M-01: 更新坐标同样校验数值/范围（与 createOne 对齐）
    const { lng, lat } = req.body
    if (lng !== undefined || lat !== undefined) {
      // B-2（阶段6 复核）: null 是无效更新值——`lng ?? existing.lng` 会用旧值通过校验，
      // 但下方 `Number(null)=0` 会把坐标篡改为 0。此处直接拒绝。
      if (lng === null || lat === null) {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, '坐标无效: null 不是合法坐标值')
      }
      const checkLng = lng ?? existing.lng
      const checkLat = lat ?? existing.lat
      if (
        !Number.isFinite(Number(checkLng)) ||
        !Number.isFinite(Number(checkLat)) ||
        Number(checkLng) < -180 ||
        Number(checkLng) > 180 ||
        Number(checkLat) < -90 ||
        Number(checkLat) > 90
      ) {
        throw new BusinessError(
          ErrorCode.INVALID_PARAMS,
          '坐标无效: lng ∈ [-180,180], lat ∈ [-90,90]'
        )
      }
      if (lng !== undefined) req.body.lng = Number(lng)
      if (lat !== undefined) req.body.lat = Number(lat)
    }
    const updated = await markersRepo.update(req.params.id, req.body)
    if (!updated) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '标注不存在')
    }
    sendSuccess(res, updated)
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('更新标注失败:', error)
    }
    next(error)
  }
}
export async function deleteOne(req, res, next) {
  try {
    // @arch-note P0-02: 归属校验，非本人标记返回 403
    const existing = await markersRepo.findById(req.params.id)
    if (!existing) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '标注不存在')
    }
    if (existing.userId !== req.user.id) {
      throw new BusinessError(ErrorCode.FORBIDDEN, '无权操作他人标注')
    }
    const success = await markersRepo.remove(req.params.id)
    if (!success) {
      throw new BusinessError(ErrorCode.NOT_FOUND, '标注不存在')
    }
    res.status(204).send()
  } catch (error) {
    if (!(error instanceof BusinessError)) {
      logger.error('删除标注失败:', error)
    }
    next(error)
  }
}
