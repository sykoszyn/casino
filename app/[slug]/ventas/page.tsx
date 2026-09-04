import { PageHeader } from '@/components/page-header';

export default function VentasPage() {
  return (
    <div>
      <PageHeader title="Ventas" description="Seguimiento de ventas generadas desde WhatsApp" />
      <div className="m-6 rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
        Próximamente.
      </div>
    </div>
  );
}
