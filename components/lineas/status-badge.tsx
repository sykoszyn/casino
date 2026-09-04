import { Badge } from '@/components/ui/badge';
import type { InstanceStatus } from '@/lib/types';

const config: Record<InstanceStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  connected: { label: 'Conectada', variant: 'success' },
  qr_pending: { label: 'Esperando QR', variant: 'warning' },
  connecting: { label: 'Conectando', variant: 'warning' },
  error: { label: 'Error', variant: 'destructive' },
  disconnected: { label: 'Desconectada', variant: 'secondary' },
};

export function StatusBadge({ status }: { status: InstanceStatus }) {
  const { label, variant } = config[status];
  return <Badge variant={variant}>{label}</Badge>;
}
