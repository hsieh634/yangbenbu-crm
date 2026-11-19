import { NotFoundException, type PipeTransform } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 路徑參數的 ID 格式不對時回 404（與「不存在」相同），不透露任何資訊 */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) throw new NotFoundException();
    return value;
  }
}
