import Link from 'next/link';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Project } from '@/lib/types';

const statusVariant = {
  active: 'success',
  inactive: 'secondary',
  archived: 'outline',
} as const;

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link href={`/${project.slug}/overview`}>
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="uppercase">{project.name}</CardTitle>
            <Badge variant={statusVariant[project.status]}>{project.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Creado {new Date(project.created_at).toLocaleDateString('es-AR')}
          </p>
        </CardHeader>
      </Card>
    </Link>
  );
}
