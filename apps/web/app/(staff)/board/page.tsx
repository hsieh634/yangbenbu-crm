'use client';

import { Board } from '@/components/board/board';
import { RequirePermission } from '@/components/shell/guards';

export default function BoardPage() {
  return (
    <RequirePermission permission="board:read">
      <Board />
    </RequirePermission>
  );
}
