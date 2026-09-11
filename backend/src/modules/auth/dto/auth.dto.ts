import { ApiProperty } from '@nestjs/swagger'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

// DTO 白名单校验：对齐老 Express authController 的入参校验顺序与文案（逐字节），
// 但不留裸 body 透传——只挑白名单字段、非字符串显式拒绝（Express 对 number 等
// 垃圾类型会带病穿透，前端契约永不发此形态，收口为 400001）

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/

// 密码强度：至少包含大小写字母和数字（对齐 Express register 同款正则）
export { PASSWORD_REGEX }

/**
 * 用户名字符集（注册约束）：仅中英文、数字、下划线。
 *
 * 09-11 补齐：此前该规则**只存在于前端**（LoginPanel.vue 的 usernameRegex），后端
 * RegisterBody 无字符集限制 —— 前端比后端严，正是 76a15b65 那个「合法账号永远登不进」
 * bug 的同一病灶（那次只把前端校验下沉到 register 分支止血，未在后端补校验）。
 * 现后端成为权威判据，前端副本删除（跨进程规则不保留副本）。
 */
export const USERNAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9_]+$/

export class CredentialsBody {
  @ApiProperty({ description: '用户名（2-20 字符）', example: 'demo_user' })
  username!: string

  @ApiProperty({ description: '密码（≥6 位，须含大小写字母与数字）', example: 'Passw0rd' })
  password!: string

  // 非空校验对齐 Express login/register 第一道：文案与顺序一致
  static assertNotEmpty(body: Record<string, unknown>): void {
    const { username, password } = body
    if (!username || !password) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名和密码不能为空')
    }
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名和密码必须为字符串')
    }
  }
}

export class LoginBody extends CredentialsBody {
  static parse(raw: unknown): LoginBody {
    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    CredentialsBody.assertNotEmpty(body)
    const dto = new LoginBody()
    dto.username = body.username as string
    dto.password = body.password as string
    return dto
  }
}

export class RegisterBody extends CredentialsBody {
  static parse(raw: unknown): RegisterBody {
    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    CredentialsBody.assertNotEmpty(body)
    const dto = new RegisterBody()
    dto.username = body.username as string
    dto.password = body.password as string
    // 以下四道校验的顺序与文案对齐 Express register（第四道为 09-11 补齐的用户名字符集）
    if (dto.username.length < 2 || dto.username.length > 20) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名长度应在 2-20 个字符之间')
    }
    if (!USERNAME_REGEX.test(dto.username)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名仅限中英文、数字和下划线')
    }
    if (dto.password.length < 6) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '密码长度不能少于 6 位')
    }
    if (!PASSWORD_REGEX.test(dto.password)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '密码必须包含大小写字母和数字')
    }
    return dto
  }
}
