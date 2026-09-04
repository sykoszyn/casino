import { PageHeader } from '@/components/page-header';

export default function ConfiguracionPage({ params }: { params: { slug: string } }) {
  return (
    <div>
      <PageHeader title="Configuración" description="Ajustes del proyecto" />
      <div className="m-6 max-w-lg space-y-2 text-sm text-muted-foreground">
        <p>
          Slug del proyecto: <code className="rounded bg-secondary px-1.5 py-0.5 text-foreground">{params.slug}</code>
        </p>
        <p>Próximamente: miembros del equipo, webhooks salientes y respuestas automáticas.</p>
      </div>
    </div>
  );
}
