import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** 以共用的 Zod schema 驗證 body／query，與前端使用同一份規則 */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '輸入資料格式不正確',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
