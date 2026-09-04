import { redirect } from 'next/navigation';

export default function ProjectRootPage({ params }: { params: { slug: string } }) {
  redirect(`/${params.slug}/overview`);
}
