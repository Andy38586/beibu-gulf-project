import { ApiProperty } from '@nestjs/swagger'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

// DTO 白名单校验：对齐老 Express authController 的入参校验顺序与文案（逐字节），
// 但不留裸 body 透传——只挑白名单字段、非字符串显式拒绝（Express 对 number 等
// 垃圾类型会带病穿透，前端契约永不发此形态，收口为 400001）

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/

// 密码强度：至少包含大小写字母和数字（对齐 Express register 同款正则）
export { PASSWORD_REGEX }

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
    // 以下三道校验的顺序与文案逐字节对齐 Express register
    if (dto.username.length < 2 || dto.username.length > 20) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名长度应在 2-20 个字符之间')
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
