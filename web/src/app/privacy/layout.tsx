import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Nouri — Confidentialité · الخصوصية · Privacy',
  description: 'Politique de confidentialité de Nouri : pas de compte, pas de publicité, pas de statistiques.',
}

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children
}
