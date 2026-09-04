import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Project } from '@/lib/types';

/**
 * El layout de [slug] y la página que se renderiza adentro necesitan las dos
 * el mismo proyecto. React `cache()` dedupea llamadas idénticas dentro de un
 * mismo request, así que esto evita pegarle a Supabase dos veces por cada
 * navegación (antes cada página volvía a buscar el proyecto por su cuenta).
 */
export const getProjectBySlug = cache(async (slug: string): Promise<Project | null> => {
  const supabase = createClient();
  const { data } = await supabase.from('projects').select('*').eq('slug', slug).single();
  return data;
});
